#!/usr/bin/env python3
"""
monthly-financials-sheet.py — append last month's KPI column to the
"Monthly Financials" tab of the Cash Flow Forecast Google Sheet.

Runs on the 1st of each month (scheduled Claude task), or manually:

    MONDAY_API_TOKEN=... RAILWAY_TOKEN=... python3 scripts/monthly-financials-sheet.py
    python3 scripts/monthly-financials-sheet.py --month 2026-07 --dry-run

Env:
  MONDAY_API_TOKEN                     required
  GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON   optional — if unset, fetched from
                                       Railway using RAILWAY_TOKEN
  RAILWAY_TOKEN                        required when SA JSON not provided

Definitions (agreed with Brandon 2026-08-01):
  * Patient counts: Subscription Board snapshot at run time (1st of month
    = end-of-prior-month state). sensors = type "Sensors" or
    "Sensors & Supplies"; supplies = "Supplies" or "Sensors & Supplies".
  * Attrition: items whose Status column moved to Paused/Dead/Cancel
    during the month per Monday activity log, minus any that returned to
    Active by the last event in the window.
  * ARR: sum of ARR column over Active patients. Product ARR split =
    per-fill revenue x 4 (x6 for Medicaid primaries) over Active patients.
  * Monthly revenue: Claims Board items with DOS in the month, EXCLUDING
    groups whose title contains "Non-latest" (superseded thread
    ancestors). Line value = subitem Est Pay, falling back to Charge.
    Product split by HCPC: E0784 pump / E2103 monitor / A4239 sensors /
    A4224 A4225 A4230 A4231 A4232 supplies.
  * COGS: for each counted claim, the matched subscription patient's
    per-fill sensors cost (if the claim has sensor lines) + supplies cost
    (if supply lines) + $8.25 shipping unless the claim is pump-only.
    Sensors fallback $500 / supplies fallback $314 when the patient's
    cost column is blank. Pump & monitor hardware cost is NOT tracked.
  * Fixed costs: written as 30000 ONLY when the month column is first
    created; never overwritten afterwards (operator-editable).
"""

import argparse
import datetime as dt
import json
import os
import sys
import time
from zoneinfo import ZoneInfo

import requests

# ── Constants ──────────────────────────────────────────────────────────────
SHEET_ID = "1YaB_vh7hV0xIsnmMM3eGssP4dHCxzT5Izmi5iatjfbM"
TAB = "Monthly Financials"
SUB_BOARD = 18407459988
CLAIMS_BOARD = 18245429780

MONDAY_URL = "https://api.monday.com/v2"
RAILWAY_URL = "https://backboard.railway.com/graphql/v2"
RAILWAY_IDS = dict(
    p="997051d7-c660-4ad4-8630-5148c261929f",
    e="8882e36b-eb6a-43b4-8f7d-2a0b3c6ca7c1",
    s="99ac2cda-8b7c-4c8a-9cb5-c8d9b6c50f44",
)

# Subscription Board columns
C_STATUS, C_TYPE, C_PRIMARY = "color_mm2t7tdy", "color_mm273mv8", "color_mm254qxj"
C_SENSTYPE = "color_mkxmdscr"   # Sensors Type — weights the monitor SKU average
C_SENS_REV, C_SENS_COST = "numeric_mkxj6a3d", "numeric_mkxjxmga"
C_SUPP_REV, C_SUPP_COST = "numeric_mm27rypj", "numeric_mm27hem2"
C_TOT_REV, C_SHIP, C_ARR = "numeric_mm2xsjm5", "numeric_mm2xxmp4", "numeric_mm2xsqyd"
SUB_COLS = [C_STATUS, C_TYPE, C_PRIMARY, C_SENSTYPE, C_SENS_REV, C_SENS_COST,
            C_SUPP_REV, C_SUPP_COST, C_TOT_REV, C_SHIP, C_ARR]

C_PAYOR = "color_mkxmhypt"  # Claims Board: Primary Payor label (for payer mix)
C_PPAID = "numeric_mm115q76"  # Claims Board: Primary Paid (A) — realization check
KNOWN_CODES = {"E0784", "E2103", "A4239"} | {"A4224", "A4225", "A4230", "A4231", "A4232"}

# Payer families for the mix section — fixed row order on the sheet.
PAYER_FAMILIES = ["Medicare A&B", "Anthem BCBS", "Other Blues", "Fidelis",
                  "United / UMR", "Aetna", "NY Medicaid", "Cigna", "Humana",
                  "Wellcare", "NYSHIP", "Other"]


def payer_family(label):
    s = (label or "").strip()
    sl = s.lower()
    if s == "Medicare A&B":
        return "Medicare A&B"
    if sl.startswith("anthem"):
        return "Anthem BCBS"
    if sl.startswith("bcbs") or sl.startswith("horizon"):
        return "Other Blues"
    if sl.startswith("fidelis"):
        return "Fidelis"
    if sl.startswith("united") or sl == "umr":
        return "United / UMR"
    if sl.startswith("aetna"):
        return "Aetna"
    if s == "Medicaid":
        return "NY Medicaid"
    if s in ("Cigna", "Humana", "Wellcare", "NYSHIP"):
        return s
    return "Other"

# Claims Board columns
C_DOS, C_SUBID = "date_mkwr7spz", "text_mm3ahdn3"
S_HCPC, S_ESTPAY, S_CHARGE = "color_mm1cdvq8", "numeric_mm1zspsy", "numeric_mm1za8v5"
S_MODS = "dropdown_mm1z7je9"  # line modifiers — KI/KJ mark rental months 2-13

# Cardinal SKU Tracker (live hardware costs; see cardinal_sku_service.py)
SKU_BOARD = 18420366344
SKU_DESC, SKU_PRICE, SKU_STATUS = "text_mm4wazkc", "numeric_mm4wd6b", "color_mm4wr14r"

MEDICAID_PRIMARIES = {"Fidelis Medicaid", "Anthem BCBS Medicaid (JLJ)",
                      "United Medicaid", "Medicaid"}
SUPPLY_CODES = {"A4224", "A4225", "A4230", "A4231", "A4232"}
SHIPPING_PER_ORDER = 8.25
SENSORS_COST_FALLBACK, SUPPLIES_COST_FALLBACK = 500.0, 314.0
FIXED_COST_DEFAULT = 30000

# Row map (1-indexed sheet rows; column A holds labels, months go B, C, ...)
HEADER_ROW = 3
ROWS = {
    # Patient blocks (2026-08-01 layout): unique / half-height spacer /
    # sensors / supplies / subscriptions-total (=sensors+supplies formula).
    "total_u": 5, "total_sens": 7, "total_supp": 8, "total_tot": 9,
    "active_u": 11, "active_sens": 13, "active_supp": 14, "active_tot": 15,
    "paused_u": 17, "paused_sens": 19, "paused_supp": 20, "paused_tot": 21,
    "new_u": 23, "new_sens": 25, "new_supp": 26, "new_tot": 27,  # created in month
    "attr_u": 29, "attr_sens": 31, "attr_supp": 32, "attr_tot": 33,
    "arr_total": 36, "arr_sens": 37, "arr_supp": 38,
    "rev_pump": 41, "rev_monitor": 42, "rev_sensor": 43, "rev_supplies": 44,
    "rev_total": 45,
    "pump_orders": 46, "monitor_orders": 47,   # claim counts by DOS, tie to rev rows
    "avg_weighted": 49, "avg_sens": 50, "avg_supp": 51,
    # Per-product P&L: COGS / GP / margins / net all mirror the
    # pump-monitor-sensor-supplies-total revenue layout.
    "cogs_pump": 54, "cogs_monitor": 55, "cogs_sensor": 56,
    "cogs_supplies": 57, "cogs_ship": 58, "cogs_total": 59,
    # Per-unit averages actually used this month (informational rows)
    "unit_pump": 60, "unit_monitor": 61, "unit_sensor": 62, "unit_supplies": 63,
    "gp_pump": 66, "gp_monitor": 67, "gp_sensor": 68, "gp_supplies": 69, "gp_total": 70,
    "gm_pump": 71, "gm_monitor": 72, "gm_sensor": 73, "gm_supplies": 74, "gm_total": 75,
    "fixed": 78,
    "np_pump": 79, "np_monitor": 80, "np_sensor": 81, "np_supplies": 82, "np_total": 83,
    "nm_pump": 84, "nm_monitor": 85, "nm_sensor": 86, "nm_supplies": 87, "nm_total": 88,
    # Mix section (2026-08-01): product shares are formulas off the rows
    # above; payer shares are computed values (12 fixed family rows).
    "mixrev_pump": 91, "mixrev_monitor": 92, "mixrev_sensor": 93, "mixrev_supplies": 94,
    "mixgp_pump": 96, "mixgp_monitor": 97, "mixgp_sensor": 98, "mixgp_supplies": 99,
    "payer_rev_start": 102,   # 12 rows, PAYER_FAMILIES order
    "payer_gp_start": 116,    # 12 rows, PAYER_FAMILIES order
    # Per-patient unit economics (weighted over Active patients with
    # revenue; COGS = sensors+supplies only, no hardware/shipping)
    "pp_order_rev": 130, "pp_order_cogs": 131, "pp_order_gp": 132,
    "pp_ann_rev": 134, "pp_ann_cogs": 135, "pp_ann_gp": 136,
    # LTV & pump payback (2026-08-01)
    "ltv_churn": 139, "ltv_life": 140, "ltv_val": 141,
    "pb_new_pumps": 143, "pb_spend": 144, "pb_rentals": 145,
    "pb_rental_rev": 146, "pb_months": 147,
    # Realization check (DOS month = target − 2): primary + secondary +
    # patient (Stripe) collections vs Est. Pay
    "real_month": 150, "real_est": 151, "real_coll": 152,
    "real_sec": 153, "real_pt": 154, "real_tot": 155, "real_rate": 156,
    # Month-over-month deltas (formulas vs previous column; blank on first)
    "d_rev": 159, "d_gp": 160, "d_np": 161, "d_arr": 162,
    "d_active": 163, "d_new": 164, "d_attr": 165,
    # Self-audit footer
    "audit_revsum": 168, "audit_gpsum": 169, "audit_unmatched": 170,
    "audit_unknown": 171, "audit_blankstatus": 172, "audit_status": 173,
}
LAST_ROW = 173

SECONDARY_BOARD = 18413019028
S2_PAID = "numeric_mm115q76"    # secondary ERA paid amount (secondary board)
S2_PT_PAID = "numeric_mm3q2vpb" # patient amount paid via Stripe pay-link


def num(v):
    try:
        return float(str(v).replace(",", "").replace("$", "")) if v not in (None, "") else 0.0
    except ValueError:
        return 0.0


# ── Monday API ─────────────────────────────────────────────────────────────
def monday(query, variables=None, token=None, retries=4):
    for attempt in range(retries):
        r = requests.post(MONDAY_URL, json={"query": query, "variables": variables or {}},
                          headers={"Authorization": token, "API-Version": "2024-10"},
                          timeout=120)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code == 200 and "errors" not in body:
            return body["data"]
        if attempt == retries - 1:
            raise RuntimeError(f"Monday API error: {r.status_code} {str(body)[:400]}")
        time.sleep(10 * (attempt + 1))


def pull_subscription_snapshot(token):
    """All Subscription Board items -> list of dicts keyed by column id."""
    items, cursor = [], None
    q_first = """query($b:[ID!],$c:[String!]){boards(ids:$b){items_page(limit:500){
      cursor items{id name created_at group{title} column_values(ids:$c){id text}}}}}"""
    q_next = """query($cur:String!,$c:[String!]){next_items_page(limit:500,cursor:$cur){
      cursor items{id name created_at group{title} column_values(ids:$c){id text}}}}"""
    while True:
        if cursor is None:
            d = monday(q_first, {"b": [SUB_BOARD], "c": SUB_COLS}, token)
            page = d["boards"][0]["items_page"]
        else:
            d = monday(q_next, {"cur": cursor, "c": SUB_COLS}, token)
            page = d["next_items_page"]
        for it in page["items"]:
            row = {"id": it["id"], "name": it["name"],
                   "created_at": it.get("created_at") or "",
                   "group": (it.get("group") or {}).get("title", "")}
            row.update({cv["id"]: (cv["text"] or "") for cv in it["column_values"]})
            items.append(row)
        cursor = page.get("cursor")
        if not cursor:
            break
    return items


def pull_month_claims(token, first_day, last_day):
    """Claims with DOS in [first_day, last_day], with subitem lines."""
    claims, cursor = [], None
    q_first = """query($b:ID!,$rules:CompareValue!){boards(ids:[$b]){items_page(limit:100,
      query_params:{rules:[{column_id:"%s",compare_value:$rules,operator:between}]}){
      cursor items{id name group{title} column_values(ids:["%s","%s","%s"]){id text}
        subitems{column_values(ids:["%s","%s","%s","%s"]){id text}}}}}}""" % (
        C_DOS, C_SUBID, C_PAYOR, C_PPAID, S_HCPC, S_ESTPAY, S_CHARGE, S_MODS)
    q_next = """query($cur:String!){next_items_page(limit:100,cursor:$cur){
      cursor items{id name group{title} column_values(ids:["%s","%s","%s"]){id text}
        subitems{column_values(ids:["%s","%s","%s","%s"]){id text}}}}}""" % (
        C_SUBID, C_PAYOR, C_PPAID, S_HCPC, S_ESTPAY, S_CHARGE, S_MODS)
    while True:
        if cursor is None:
            d = monday(q_first, {"b": CLAIMS_BOARD, "rules": [first_day, last_day]}, token)
            page = d["boards"][0]["items_page"]
        else:
            d = monday(q_next, {"cur": cursor}, token)
            page = d["next_items_page"]
        claims.extend(page["items"])
        cursor = page.get("cursor")
        if not cursor:
            break
    return [c for c in claims if "non-latest" not in (c.get("group") or {}).get("title", "").lower()]


def pull_hardware_costs(token, subs):
    """Pump + monitor hardware costs from the Cardinal SKU Tracker.

    Pump = simple average of the Mobi and t:slim pump SKUs (Brandon
    2026-08-01: 'use an average of mobi and tandem' — 780G/iLet excluded
    as outliers). Monitor = receiver/reader price weighted by the
    historical subscription base's Sensors Type mix (Dexcom G6/G7 vs
    FreeStyle Libre)."""
    q = """query{boards(ids:[%d]){items_page(limit:100){items{
      name column_values(ids:["%s","%s","%s"]){id text}}}}}""" % (
        SKU_BOARD, SKU_DESC, SKU_PRICE, SKU_STATUS)
    items = monday(q, {}, token)["boards"][0]["items_page"]["items"]
    pump_prices, g6, g7, libre = [], 0.0, 0.0, []
    for it in items:
        cv = {c["id"]: (c["text"] or "") for c in it["column_values"]}
        name, desc = it["name"].lower(), cv.get(SKU_DESC, "").lower()
        price = num(cv.get(SKU_PRICE))
        if price <= 0 or cv.get(SKU_STATUS, "").strip().lower() == "inactive":
            continue
        if "insulin pump" in desc and ("mobi" in name or "t:slim" in name):
            pump_prices.append(price)
        elif "receiver" in desc or ("reader" in desc and "libre" in desc):
            if "g6" in name.lower():
                g6 = price
            elif "g7" in name.lower():
                g7 = price
            elif "libre" in name.lower():
                libre.append(price)
    avg_pump = round(sum(pump_prices) / len(pump_prices), 2) if pump_prices else 0.0
    libre_price = round(sum(libre) / len(libre), 2) if libre else 0.0

    # Weight receiver price by the base's Sensors Type mix (Guardian/
    # Simplera have no receiver SKU — display is the pump — excluded).
    w = {"g6": 0, "g7": 0, "libre": 0}
    for s in subs:
        st = (s.get(C_SENSTYPE) or "").lower()
        if "g6" in st:
            w["g6"] += 1
        elif "g7" in st or "dexcom" in st:
            w["g7"] += 1
        elif "libre" in st:
            w["libre"] += 1
    tot_w = sum(w.values())
    avg_monitor = (round((w["g6"] * g6 + w["g7"] * g7 + w["libre"] * libre_price)
                         / tot_w, 2) if tot_w else 0.0)
    detail = dict(pump_skus=len(pump_prices), g6_price=g6, g7_price=g7,
                  libre_price=libre_price, weights=w)
    return avg_pump, avg_monitor, detail


def pull_secondary_collections(token, first_day, last_day):
    """Secondary-board collections for a DOS window: (secondary insurance
    paid, patient/Stripe paid). Separate items from the primary claims, so
    no overlap with the primary Paid column."""
    sec = pt = 0.0
    cursor = None
    q_first = """query($b:ID!,$rules:CompareValue!){boards(ids:[$b]){items_page(limit:200,
      query_params:{rules:[{column_id:"%s",compare_value:$rules,operator:between}]}){
      cursor items{group{title} column_values(ids:["%s","%s"]){id text}}}}}""" % (
        C_DOS, S2_PAID, S2_PT_PAID)
    q_next = """query($cur:String!){next_items_page(limit:200,cursor:$cur){
      cursor items{group{title} column_values(ids:["%s","%s"]){id text}}}}""" % (
        S2_PAID, S2_PT_PAID)
    while True:
        if cursor is None:
            d = monday(q_first, {"b": SECONDARY_BOARD, "rules": [first_day, last_day]}, token)
            page = d["boards"][0]["items_page"]
        else:
            d = monday(q_next, {"cur": cursor}, token)
            page = d["next_items_page"]
        for it in page["items"]:
            if "non-latest" in (it.get("group") or {}).get("title", "").lower():
                continue
            cv = {c["id"]: (c["text"] or "") for c in it["column_values"]}
            sec += num(cv.get(S2_PAID))
            pt += num(cv.get(S2_PT_PAID))
        cursor = page.get("cursor")
        if not cursor:
            break
    return round(sec, 2), round(pt, 2)


def compute_realization(token, year, month):
    """Realization for the DOS month two months before (year, month):
    Est. Pay vs primary + secondary + patient collections to date."""
    rm = month - 2 if month > 2 else month + 10
    ry = year if month > 2 else year - 1
    r_first = dt.date(ry, rm, 1)
    r_last = dt.date(ry + (rm == 12), (rm % 12) + 1, 1) - dt.timedelta(days=1)
    r_est = r_coll = 0.0
    for c in pull_month_claims(token, r_first.isoformat(), r_last.isoformat()):
        pcv = {v["id"]: (v["text"] or "") for v in c["column_values"]}
        r_coll += num(pcv.get(C_PPAID))
        for sub in c.get("subitems") or []:
            cv = {v["id"]: (v["text"] or "") for v in sub["column_values"]}
            if cv.get(S_HCPC, "").strip().upper() in KNOWN_CODES:
                r_est += num(cv.get(S_ESTPAY)) or num(cv.get(S_CHARGE))
    r_sec, r_pt = pull_secondary_collections(
        token, r_first.isoformat(), r_last.isoformat())
    return dict(month=r_first.strftime("%b %Y"), est=round(r_est, 2),
                collected=round(r_coll, 2), secondary=r_sec, patient=r_pt)


def refresh_prior_realizations(svc, token, target_label):
    """Re-measure the realization block of EVERY existing month column
    (except the one just written) so collections keep maturing instead of
    freezing at the ~2-month mark. Only the realization value cells are
    touched — nothing else in old columns is rewritten."""
    hdr = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=f"'{TAB}'!{HEADER_ROW}:{HEADER_ROW}",
        valueRenderOption="UNFORMATTED_VALUE").execute().get("values", [[]])[0]
    data = []
    for idx, cell in enumerate(hdr):
        if idx == 0:
            continue
        lab = norm_header(cell)
        if not lab or lab == target_label:
            continue
        try:
            d = dt.datetime.strptime(lab, "%b %Y")
        except ValueError:
            continue
        r = compute_realization(token, d.year, d.month)
        colx = col_letter(idx)
        for key, val in (("real_month", r["month"]), ("real_est", r["est"]),
                         ("real_coll", r["collected"]), ("real_sec", r["secondary"]),
                         ("real_pt", r["patient"])):
            data.append({"range": f"'{TAB}'!{colx}{ROWS[key]}", "values": [[val]]})
        print(f"Re-measured realization for column {colx} ({lab}): "
              f"{r['month']} est={r['est']} coll={r['collected']}+{r['secondary']}+{r['patient']}")
    if data:
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=SHEET_ID,
            body={"valueInputOption": "USER_ENTERED", "data": data}).execute()
    return len(data) // 5


def pull_pause_events(token, from_iso, to_iso):
    """Status-column activity log events for the window."""
    events, page = [], 1
    q = """query($b:[ID!],$f:ISO8601DateTime!,$t:ISO8601DateTime!,$p:Int!){
      boards(ids:$b){activity_logs(from:$f,to:$t,column_ids:["%s"],limit:100,page:$p){
      created_at data}}}""" % C_STATUS
    while True:
        d = monday(q, {"b": [SUB_BOARD], "f": from_iso, "t": to_iso, "p": page}, token)
        logs = d["boards"][0]["activity_logs"] or []
        events.extend(logs)
        if len(logs) < 100:
            break
        page += 1
    return events


def label_from(blob):
    """Extract a status label from an activity-log value blob."""
    if not isinstance(blob, dict):
        return ""
    lb = blob.get("label")
    if isinstance(lb, dict):
        return (lb.get("text") or "").strip()
    return (blob.get("text") or blob.get("label") or "").strip() if isinstance(lb, (str, type(None))) else ""


# ── KPI computation ────────────────────────────────────────────────────────
def compute(token, year, month):
    first = dt.date(year, month, 1)
    last = (dt.date(year + (month == 12), (month % 12) + 1, 1) - dt.timedelta(days=1))

    # 1. Subscription snapshot
    subs = pull_subscription_snapshot(token)
    by_id = {s["id"]: s for s in subs}
    by_name = {}
    for s in subs:
        by_name.setdefault(s["name"].strip().lower(), s)

    def is_sens(s): return s.get(C_TYPE, "") in ("Sensors", "Sensors & Supplies")
    def is_supp(s): return s.get(C_TYPE, "") in ("Supplies", "Sensors & Supplies")

    def bucket(pred):
        g = [s for s in subs if pred(s)]
        return dict(unique=len(g), sensors=sum(map(is_sens, g)), supplies=sum(map(is_supp, g)))

    def created_in_month(s):
        """Board item created during the target month (ET). New subscriptions
        = new board items; un-pauses of existing patients don't count."""
        raw = s.get("created_at", "")
        if not raw:
            return False
        try:
            d = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            d = d.astimezone(ZoneInfo("America/New_York")).date()
        except ValueError:
            return False
        return first <= d <= last

    counts = {
        "total": bucket(lambda s: True),
        "active": bucket(lambda s: s.get(C_STATUS, "").lower() == "active"),
        "paused": bucket(lambda s: s.get(C_STATUS, "").lower() == "paused"),
        "new": bucket(created_in_month),
    }

    active = [s for s in subs if s.get(C_STATUS, "").lower() == "active"]
    def mult(s): return 6 if s.get(C_PRIMARY, "").strip() in MEDICAID_PRIMARIES else 4
    # ARR ties to the UI Financials dashboard (unifiedForecast.ts line ~112):
    # everyone EXCEPT the "Not Active Patients" board group — Paused included.
    # Brandon chose this basis 2026-08-01 so sheet == dashboard.
    arr_pop = [s for s in subs if "not active" not in s.get("group", "").lower()]
    arr_total = sum(num(s.get(C_ARR)) for s in arr_pop)
    arr_sens = sum(num(s.get(C_SENS_REV)) * mult(s) for s in arr_pop)
    arr_supp = sum(num(s.get(C_SUPP_REV)) * mult(s) for s in arr_pop)

    def avg(vals): return round(sum(vals) / len(vals), 2) if vals else 0
    avg_weighted = avg([num(s.get(C_TOT_REV)) for s in active if num(s.get(C_TOT_REV)) > 0])
    avg_sens = avg([num(s.get(C_SENS_REV)) for s in active if num(s.get(C_SENS_REV)) > 0])
    avg_supp = avg([num(s.get(C_SUPP_REV)) for s in active if num(s.get(C_SUPP_REV)) > 0])

    # Per-patient unit economics: Active patients with revenue. Order
    # COGS = sensors + supplies cost only (Brandon 2026-08-01 — no
    # hardware/shipping). Annual = per-order × fills/year (4, ×6 Medicaid).
    pp_pop = [s for s in active if num(s.get(C_TOT_REV)) > 0]
    def pp_cogs(s): return num(s.get(C_SENS_COST)) + num(s.get(C_SUPP_COST))
    pp = dict(
        order_rev=avg_weighted,
        order_cogs=avg([pp_cogs(s) for s in pp_pop]),
        ann_rev=avg([num(s.get(C_TOT_REV)) * mult(s) for s in pp_pop]),
        ann_cogs=avg([pp_cogs(s) * mult(s) for s in pp_pop]),
    )

    # 2. Month claims -> revenue by product + COGS
    claims = pull_month_claims(token, first.isoformat(), last.isoformat())
    rev = dict(pump=0.0, monitor=0.0, sensors=0.0, supplies=0.0)
    cogs = dict(pump=0.0, monitor=0.0, sensors=0.0, supplies=0.0, shipping=0.0)
    avg_pump, avg_monitor, hw_detail = pull_hardware_costs(token, subs)
    pump_orders = monitor_orders = new_pumps = 0
    sens_fills = supp_fills = 0
    rental_pumps = 0; rental_rev = 0.0
    unmatched = unknown_lines = 0
    payer_agg = {f: dict(rev=0.0, gp=0.0) for f in PAYER_FAMILIES}
    for c in claims:
        has_sens = has_supp = False
        codes = set()
        claim_rev = claim_cogs = 0.0
        for sub in c.get("subitems") or []:
            cv = {v["id"]: (v["text"] or "") for v in sub["column_values"]}
            code = cv.get(S_HCPC, "").strip().upper()
            val = num(cv.get(S_ESTPAY)) or num(cv.get(S_CHARGE))
            codes.add(code)
            if code == "E0784":
                rev["pump"] += val; claim_rev += val
                # Hardware ships on purchase / first rental month only —
                # KI (months 2-3) and KJ (months 4-13) lines are rentals
                # of a pump we already bought.
                mods = cv.get(S_MODS, "").upper()
                if "KI" not in mods and "KJ" not in mods:
                    new_pumps += 1
                    claim_cogs += avg_pump
                else:
                    rental_pumps += 1
                    rental_rev += val
            elif code == "E2103":
                rev["monitor"] += val; claim_rev += val
                claim_cogs += avg_monitor
            elif code == "A4239":
                rev["sensors"] += val; claim_rev += val; has_sens = True
            elif code in SUPPLY_CODES:
                rev["supplies"] += val; claim_rev += val; has_supp = True
            elif code:
                unknown_lines += 1
        pcv = {v["id"]: (v["text"] or "") for v in c["column_values"]}
        sub_item_id = (pcv.get(C_SUBID) or "").strip()
        patient = by_id.get(sub_item_id) or by_name.get(c["name"].strip().lower())
        if patient is None and (has_sens or has_supp):
            unmatched += 1
        if has_sens:
            cost = num(patient.get(C_SENS_COST)) if patient else 0
            cost = cost if cost > 0 else SENSORS_COST_FALLBACK
            cogs["sensors"] += cost; claim_cogs += cost; sens_fills += 1
        if has_supp:
            cost = num(patient.get(C_SUPP_COST)) if patient else 0
            cost = cost if cost > 0 else SUPPLIES_COST_FALLBACK
            cogs["supplies"] += cost; claim_cogs += cost; supp_fills += 1
        pump_orders += "E0784" in codes
        monitor_orders += "E2103" in codes
        pump_only = codes and codes <= {"E0784"}
        if not pump_only:
            cogs["shipping"] += SHIPPING_PER_ORDER; claim_cogs += SHIPPING_PER_ORDER
        fam = payer_family(pcv.get(C_PAYOR, ""))
        payer_agg[fam]["rev"] += claim_rev
        payer_agg[fam]["gp"] += claim_rev - claim_cogs

    cogs["pump"] = round(avg_pump * new_pumps, 2)
    cogs["monitor"] = round(avg_monitor * monitor_orders, 2)

    tot_rev_mix = sum(v["rev"] for v in payer_agg.values())
    tot_gp_mix = sum(v["gp"] for v in payer_agg.values())
    payer_mix = {
        f: dict(rev_share=(v["rev"] / tot_rev_mix if tot_rev_mix else 0),
                gp_share=(v["gp"] / tot_gp_mix if tot_gp_mix else 0))
        for f, v in payer_agg.items()
    }

    # 3. Attrition from activity log (whole calendar month, ET-agnostic UTC pad)
    events = pull_pause_events(
        token, f"{first.isoformat()}T00:00:00Z",
        (last + dt.timedelta(days=1)).isoformat() + "T04:00:00Z")
    final_state = {}   # pulse_id -> (created_at, to_label)
    for ev in events:
        try:
            data = json.loads(ev["data"])
        except (TypeError, ValueError):
            continue
        pid = str(data.get("pulse_id") or "")
        to_label = label_from(data.get("value") or {})
        if not pid or not to_label:
            continue
        prev = final_state.get(pid)
        if prev is None or ev["created_at"] > prev[0]:
            final_state[pid] = (ev["created_at"], to_label)
    lost_ids = [pid for pid, (_, lab) in final_state.items()
                if any(k in lab.lower() for k in ("paus", "dead", "cancel"))]
    lost = [by_id[p] for p in lost_ids if p in by_id]
    attr = dict(unique=len(lost), sensors=sum(map(is_sens, lost)),
                supplies=sum(map(is_supp, lost)))

    # 4. Realization check: DOS month two months back — how much of its
    # Est. Pay has actually been collected by now (primary + secondary +
    # patient). Prior columns are re-measured on every run (see
    # refresh_prior_realizations), so these numbers mature over time.
    realization = compute_realization(token, year, month)

    return {
        "counts": counts, "attrition": attr,
        "arr": dict(total=round(arr_total, 2), sensors=round(arr_sens, 2), supplies=round(arr_supp, 2)),
        "revenue": {k: round(v, 2) for k, v in rev.items()},
        "avg": dict(weighted=avg_weighted, sensors=avg_sens, supplies=avg_supp),
        "per_patient": pp,
        "cogs": {k: round(v, 2) for k, v in cogs.items()},
        "orders": dict(pump=pump_orders, monitor=monitor_orders),
        "hardware": dict(new_pumps=new_pumps, avg_pump_cost=avg_pump,
                         avg_monitor_cost=avg_monitor, **hw_detail),
        "unit_cogs": dict(
            pump=avg_pump, monitor=avg_monitor,
            sensors=round(cogs["sensors"] / sens_fills, 2) if sens_fills else 0,
            supplies=round(cogs["supplies"] / supp_fills, 2) if supp_fills else 0),
        "payer_mix": payer_mix,
        "payback": dict(new_pumps=new_pumps, rental_pumps=rental_pumps,
                        rental_rev=round(rental_rev, 2)),
        "realization": realization,
        "audit": dict(unmatched=unmatched, unknown_lines=unknown_lines,
                      blank_status=sum(1 for s in subs if not s.get(C_STATUS, "").strip())),
        "claims_counted": len(claims),
    }


# ── Sheets ─────────────────────────────────────────────────────────────────
def col_letter(idx0):
    s, n = "", idx0 + 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def get_sheets_service():
    raw = os.getenv("GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        rt = os.getenv("RAILWAY_TOKEN", "").strip()
        if not rt:
            sys.exit("Need GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON or RAILWAY_TOKEN")
        q = "query($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}"
        r = requests.post(RAILWAY_URL, json={"query": q, "variables": RAILWAY_IDS},
                          headers={"Authorization": f"Bearer {rt}"}, timeout=60)
        raw = r.json()["data"]["variables"]["GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON"]
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    creds = Credentials.from_service_account_info(
        json.loads(raw), scopes=["https://www.googleapis.com/auth/spreadsheets"])
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def norm_header(cell):
    """Normalize a header cell to 'Mon YYYY' — handles date-serial parses."""
    s = str(cell).strip()
    try:
        serial = float(s)
        d = dt.date(1899, 12, 30) + dt.timedelta(days=int(serial))
        return d.strftime("%b %Y")
    except ValueError:
        return s


def write_column(svc, kpis, year, month, dry_run=False):
    label = dt.date(year, month, 1).strftime("%b %Y")
    hdr = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=f"'{TAB}'!{HEADER_ROW}:{HEADER_ROW}",
        valueRenderOption="UNFORMATTED_VALUE").execute().get("values", [[]])[0]
    norm = [norm_header(h) for h in hdr]
    if label in norm:
        idx = norm.index(label)
        created = False
    else:
        idx = max(len(hdr), 1)  # first empty header cell after existing months
        created = True
    col = col_letter(idx)

    R = ROWS
    c = kpis["counts"]; a = kpis["attrition"]; arr = kpis["arr"]
    rev = kpis["revenue"]; avg = kpis["avg"]
    cells = {
        R["total_u"]: c["total"]["unique"], R["total_sens"]: c["total"]["sensors"], R["total_supp"]: c["total"]["supplies"],
        R["active_u"]: c["active"]["unique"], R["active_sens"]: c["active"]["sensors"], R["active_supp"]: c["active"]["supplies"],
        R["paused_u"]: c["paused"]["unique"], R["paused_sens"]: c["paused"]["sensors"], R["paused_supp"]: c["paused"]["supplies"],
        R["new_u"]: c["new"]["unique"], R["new_sens"]: c["new"]["sensors"], R["new_supp"]: c["new"]["supplies"],
        R["attr_u"]: a["unique"], R["attr_sens"]: a["sensors"], R["attr_supp"]: a["supplies"],
        # Block totals: subscriptions = sensors + supplies (dual-type counts once per product)
        **{R[f"{blk}_tot"]: f"={col}{R[f'{blk}_sens']}+{col}{R[f'{blk}_supp']}"
           for blk in ("total", "active", "paused", "new", "attr")},
        R["arr_total"]: arr["total"], R["arr_sens"]: arr["sensors"], R["arr_supp"]: arr["supplies"],
        R["rev_pump"]: rev["pump"], R["rev_monitor"]: rev["monitor"],
        R["rev_sensor"]: rev["sensors"], R["rev_supplies"]: rev["supplies"],
        R["rev_total"]: f"=SUM({col}{R['rev_pump']}:{col}{R['rev_supplies']})",
        R["pump_orders"]: kpis["orders"]["pump"], R["monitor_orders"]: kpis["orders"]["monitor"],
        R["avg_weighted"]: avg["weighted"], R["avg_sens"]: avg["sensors"], R["avg_supp"]: avg["supplies"],
    }
    cg = kpis["cogs"]
    cells.update({
        R["cogs_pump"]: cg["pump"], R["cogs_monitor"]: cg["monitor"],
        R["cogs_sensor"]: cg["sensors"], R["cogs_supplies"]: cg["supplies"],
        R["cogs_ship"]: cg["shipping"],
        R["cogs_total"]: f"=SUM({col}{R['cogs_pump']}:{col}{R['cogs_ship']})",
        R["unit_pump"]: kpis["unit_cogs"]["pump"],
        R["unit_monitor"]: kpis["unit_cogs"]["monitor"],
        R["unit_sensor"]: kpis["unit_cogs"]["sensors"],
        R["unit_supplies"]: kpis["unit_cogs"]["supplies"],
    })
    # Per-product GP / margins / net mirror the revenue rows. Shipping COGS
    # and any GP-vs-fixed gap only hit the Total rows (product nets exclude
    # shipping by design — Brandon 2026-08-01).
    products = [("pump", "rev_pump"), ("monitor", "rev_monitor"),
                ("sensor", "rev_sensor"), ("supplies", "rev_supplies")]
    for key, rev_key in products:
        rev_c, cogs_c = f"{col}{R[rev_key]}", f"{col}{R[f'cogs_{key}']}"
        gp_c, np_c = f"{col}{R[f'gp_{key}']}", f"{col}{R[f'np_{key}']}"
        cells[R[f"gp_{key}"]] = f"={rev_c}-{cogs_c}"
        cells[R[f"gm_{key}"]] = f"=IF({rev_c}=0,\"\",{gp_c}/{rev_c})"
        cells[R[f"np_{key}"]] = (f"={gp_c}-IF({col}{R['rev_total']}=0,0,"
                                 f"{col}{R['fixed']}*{rev_c}/{col}{R['rev_total']})")
        cells[R[f"nm_{key}"]] = f"=IF({rev_c}=0,\"\",{np_c}/{rev_c})"
    rt = f"{col}{R['rev_total']}"
    cells[R["gp_total"]] = f"={rt}-{col}{R['cogs_total']}"
    cells[R["gm_total"]] = f"=IF({rt}=0,\"\",{col}{R['gp_total']}/{rt})"
    cells[R["np_total"]] = f"={col}{R['gp_total']}-{col}{R['fixed']}"
    cells[R["nm_total"]] = f"=IF({rt}=0,\"\",{col}{R['np_total']}/{rt})"
    # Product mix — formulas off the revenue / GP rows above
    gt = f"{col}{R['gp_total']}"
    for key in ("pump", "monitor", "sensor", "supplies"):
        cells[R[f"mixrev_{key}"]] = f"=IF({rt}=0,\"\",{col}{R[f'rev_{key}']}/{rt})"
        cells[R[f"mixgp_{key}"]] = f"=IF({gt}=0,\"\",{col}{R[f'gp_{key}']}/{gt})"
    # Payer mix — computed shares, PAYER_FAMILIES row order
    for i, fam in enumerate(PAYER_FAMILIES):
        share = kpis["payer_mix"].get(fam, {})
        cells[R["payer_rev_start"] + i] = round(share.get("rev_share", 0), 4)
        cells[R["payer_gp_start"] + i] = round(share.get("gp_share", 0), 4)
    # Per-patient unit economics (GP rows are sheet formulas)
    pp = kpis["per_patient"]
    cells[R["pp_order_rev"]] = pp["order_rev"]
    cells[R["pp_order_cogs"]] = pp["order_cogs"]
    cells[R["pp_order_gp"]] = f"={col}{R['pp_order_rev']}-{col}{R['pp_order_cogs']}"
    cells[R["pp_ann_rev"]] = pp["ann_rev"]
    cells[R["pp_ann_cogs"]] = pp["ann_cogs"]
    cells[R["pp_ann_gp"]] = f"={col}{R['pp_ann_rev']}-{col}{R['pp_ann_cogs']}"

    # LTV: churn = attrition / active; lifetime = 1/churn months; LTV =
    # lifetime in years × annual GP per patient.
    cells[R["ltv_churn"]] = (f"=IF({col}{R['active_u']}=0,\"\","
                             f"{col}{R['attr_u']}/{col}{R['active_u']})")
    cells[R["ltv_life"]] = f"=IF(N({col}{R['ltv_churn']})=0,\"\",1/{col}{R['ltv_churn']})"
    cells[R["ltv_val"]] = (f"=IF(N({col}{R['ltv_life']})=0,\"\","
                           f"{col}{R['ltv_life']}/12*{col}{R['pp_ann_gp']})")
    # Pump payback
    pb = kpis["payback"]
    cells[R["pb_new_pumps"]] = pb["new_pumps"]
    cells[R["pb_spend"]] = f"={col}{R['cogs_pump']}"
    cells[R["pb_rentals"]] = pb["rental_pumps"]
    cells[R["pb_rental_rev"]] = pb["rental_rev"]
    cells[R["pb_months"]] = (f"=IF(OR(N({col}{R['pb_rentals']})=0,N({col}{R['pb_rental_rev']})=0),\"\","
                             f"{col}{R['unit_pump']}/({col}{R['pb_rental_rev']}/{col}{R['pb_rentals']}))")
    # Realization check (DOS month −2, primary collections only for now)
    rl = kpis["realization"]
    cells[R["real_month"]] = rl["month"]
    cells[R["real_est"]] = rl["est"]
    cells[R["real_coll"]] = rl["collected"]
    cells[R["real_sec"]] = rl["secondary"]
    cells[R["real_pt"]] = rl["patient"]
    cells[R["real_tot"]] = f"=SUM({col}{R['real_coll']}:{col}{R['real_pt']})"
    cells[R["real_rate"]] = f"=IF(N({col}{R['real_est']})=0,\"\",{col}{R['real_tot']}/{col}{R['real_est']})"
    # Month-over-month deltas — reference the previous month column;
    # blank on the sheet's first month column.
    if idx > 1:
        pc = col_letter(idx - 1)
        for k, r_ in (("d_rev", "rev_total"), ("d_gp", "gp_total"),
                      ("d_np", "np_total"), ("d_arr", "arr_total")):
            cells[R[k]] = f"=IF(N({pc}{R[r_]})=0,\"\",{col}{R[r_]}/{pc}{R[r_]}-1)"
        for k, r_ in (("d_active", "active_u"), ("d_new", "new_u"), ("d_attr", "attr_u")):
            cells[R[k]] = f"=IF({pc}{R[r_]}=\"\",\"\",{col}{R[r_]}-{pc}{R[r_]})"
    else:
        for k in ("d_rev", "d_gp", "d_np", "d_arr", "d_active", "d_new", "d_attr"):
            cells[R[k]] = ""
    # Self-audit footer
    au = kpis["audit"]
    cells[R["audit_revsum"]] = (f"=SUM({col}{R['payer_rev_start']}:"
                                f"{col}{R['payer_rev_start'] + len(PAYER_FAMILIES) - 1})-1")
    cells[R["audit_gpsum"]] = (f"=SUM({col}{R['payer_gp_start']}:"
                               f"{col}{R['payer_gp_start'] + len(PAYER_FAMILIES) - 1})-1")
    cells[R["audit_unmatched"]] = au["unmatched"]
    cells[R["audit_unknown"]] = au["unknown_lines"]
    cells[R["audit_blankstatus"]] = au["blank_status"]
    cells[R["audit_status"]] = (f"=IF(AND(ABS(N({col}{R['audit_revsum']}))<0.005,"
                                f"ABS(N({col}{R['audit_gpsum']}))<0.005,"
                                f"N({col}{R['audit_unmatched']})=0,"
                                f"N({col}{R['audit_unknown']})=0),\"OK\",\"CHECK\")")
    cells[HEADER_ROW] = label
    if created:
        cells[R["fixed"]] = FIXED_COST_DEFAULT  # never overwrite an existing month's fixed costs

    if dry_run:
        print(f"[dry-run] would write column {col} ({label}), created={created}")
        for row in sorted(cells):
            print(f"  {col}{row} = {cells[row]}")
        return col, created

    # Header goes in RAW so "Jul 2026" stays text instead of a date serial.
    svc.spreadsheets().values().update(
        spreadsheetId=SHEET_ID, range=f"'{TAB}'!{col}{HEADER_ROW}",
        valueInputOption="RAW", body={"values": [[label]]}).execute()
    data = [{"range": f"'{TAB}'!{col}{row}", "values": [[val]]}
            for row, val in cells.items() if row != HEADER_ROW]
    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=SHEET_ID,
        body={"valueInputOption": "USER_ENTERED", "data": data}).execute()

    if created and col != "B":
        # copy number/percent/bold formats from column B onto the new column
        meta = svc.spreadsheets().get(spreadsheetId=SHEET_ID, fields="sheets.properties").execute()
        sid = next(s["properties"]["sheetId"] for s in meta["sheets"]
                   if s["properties"]["title"] == TAB)
        svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID, body={"requests": [{
            "copyPaste": {
                "source": {"sheetId": sid, "startRowIndex": HEADER_ROW - 1, "endRowIndex": LAST_ROW,
                           "startColumnIndex": 1, "endColumnIndex": 2},
                "destination": {"sheetId": sid, "startRowIndex": HEADER_ROW - 1, "endRowIndex": LAST_ROW,
                                "startColumnIndex": idx, "endColumnIndex": idx + 1},
                "pasteType": "PASTE_FORMAT"}}]}).execute()
    return col, created


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="YYYY-MM to compute (default: previous month, ET)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token = os.getenv("MONDAY_API_TOKEN", "").strip()
    if not token:
        sys.exit("MONDAY_API_TOKEN env var required")

    if args.month:
        year, month = map(int, args.month.split("-"))
    else:
        today = dt.datetime.now(ZoneInfo("America/New_York")).date()
        prev = today.replace(day=1) - dt.timedelta(days=1)
        year, month = prev.year, prev.month

    print(f"Computing KPIs for {year}-{month:02d} ...")
    kpis = compute(token, year, month)
    print(json.dumps(kpis, indent=2))

    svc = get_sheets_service()
    col, created = write_column(svc, kpis, year, month, dry_run=args.dry_run)
    print(f"{'Would write' if args.dry_run else 'Wrote'} column {col} "
          f"({'new' if created else 'existing — fixed costs preserved'}).")
    if not args.dry_run:
        n = refresh_prior_realizations(
            svc, token, dt.date(year, month, 1).strftime("%b %Y"))
        print(f"Re-measured realization for {n} prior month column(s).")


if __name__ == "__main__":
    main()
