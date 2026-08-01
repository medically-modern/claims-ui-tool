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
C_PR_AMT = "numeric_mkxmc2rh"   # PR Amount (C) — patient responsibility per primary ERA
C_RAW_PR = "numeric_mm1gdpjq"   # Raw Patient Responsibility (ERA-parsed)
C_ERA_DATE = "text_mm2047g9"    # Raw ERA Date — nonblank = primary adjudicated
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
    # Total/Active blocks: unique, then its exclusive sub-segments
    # (sensors-only / supplies-only / both), then product counts + subs total.
    "total_u": 5, "total_sonly": 6, "total_ponly": 7, "total_dual": 8,
    "total_sens": 10, "total_supp": 11, "total_tot": 12,
    "active_u": 14, "active_sonly": 15, "active_ponly": 16, "active_dual": 17,
    "active_sens": 19, "active_supp": 20, "active_tot": 21,
    "paused_u": 23, "paused_sens": 25, "paused_supp": 26, "paused_dual": 27, "paused_tot": 28,
    "new_u": 30, "new_sens": 32, "new_supp": 33, "new_dual": 34, "new_tot": 35,  # created in month
    # Churn = left the book (→Not Active/Dead) ONLY. Pure churn feeds LTV
    # (Brandon 2026-08-01; Paused-vs-Inactive hygiene enforced going fwd).
    "attr_u": 37, "attr_sens": 39, "attr_supp": 40, "attr_dual": 41, "attr_tot": 42,
    # Pause flow (leading indicators, NOT attrition)
    "pause_new": 44, "pause_res": 45, "pause_net": 46,
    "arr_total": 49, "arr_sens": 50, "arr_supp": 51,
    "rev_pump": 54, "rev_monitor": 55, "rev_sensor": 56, "rev_supplies": 57,
    "rev_total": 58,
    "pump_orders": 59, "monitor_orders": 60,   # claim counts by DOS, tie to rev rows
    "avg_weighted": 62, "avg_sens": 63, "avg_supp": 64,
    # Per-product P&L: COGS / GP / margins / net all mirror the
    # pump-monitor-sensor-supplies-total revenue layout.
    "cogs_pump": 67, "cogs_monitor": 68, "cogs_sensor": 69,
    "cogs_supplies": 70, "cogs_ship": 71, "cogs_total": 72,
    # Per-unit averages actually used this month (informational rows)
    "unit_pump": 73, "unit_monitor": 74, "unit_sensor": 75, "unit_supplies": 76,
    "gp_pump": 79, "gp_monitor": 80, "gp_sensor": 81, "gp_supplies": 82, "gp_total": 83,
    "gm_pump": 84, "gm_monitor": 85, "gm_sensor": 86, "gm_supplies": 87, "gm_total": 88,
    "fixed": 91,
    "np_pump": 92, "np_monitor": 93, "np_sensor": 94, "np_supplies": 95, "np_total": 96,
    "nm_pump": 97, "nm_monitor": 98, "nm_sensor": 99, "nm_supplies": 100, "nm_total": 101,
    # Mix section (2026-08-01): product shares are formulas off the rows
    # above; payer shares are computed values (12 fixed family rows).
    "mixrev_pump": 104, "mixrev_monitor": 105, "mixrev_sensor": 106, "mixrev_supplies": 107,
    "mixgp_pump": 109, "mixgp_monitor": 110, "mixgp_sensor": 111, "mixgp_supplies": 112,
    "payer_rev_start": 115,   # 12 rows, PAYER_FAMILIES order
    "payer_gp_start": 129,    # 12 rows, PAYER_FAMILIES order
    # Per-patient unit economics (weighted over Active patients with
    # revenue; COGS = sensors+supplies only, no hardware/shipping)
    "pp_order_rev": 143, "pp_order_cogs": 144, "pp_order_gp": 145,
    "pp_ann_rev": 147, "pp_ann_cogs": 148, "pp_ann_gp": 149,
    # LTV & pump payback — churn basis = PURE churn (left book)
    "ltv_churn": 152, "ltv_life": 153, "ltv_val": 154,
    "pb_new_pumps": 156, "pb_spend": 157, "pb_rentals": 158,
    "pb_rental_rev": 159, "pb_months": 160,
    # Month-over-month deltas (formulas vs previous column; blank on first)
    "d_rev": 163, "d_gp": 164, "d_np": 165, "d_arr": 166,
    "d_active": 167, "d_new": 168, "d_attr": 169,
    # Self-audit footer
    "audit_revsum": 172, "audit_gpsum": 173, "audit_unmatched": 174,
    "audit_unknown": 175, "audit_blankstatus": 176,
    "audit_rollfwd_total": 177,   # Total − (prev Total + New − Churned)
    "audit_rollfwd_active": 178,  # Active − (prev Active + New − Paused + Resumed − Churned)
    "audit_status": 179,
}
LAST_ROW = 179

# ── Realization tab (own tab — vintage analysis by DOS month) ──────────────
REAL_TAB = "Realization"
REAL_START = (2026, 5)  # earliest DOS month with complete board data
REAL_ROWS = {"age": 4, "est": 5, "coll": 6, "sec": 7, "pt": 8,
             "tot": 9, "rate": 10, "rem_prim": 11,
             "rp_unadj": 12, "rp_zero": 13,          # components of rem_prim
             "rp_ratevar": 14, "rp_denial": 15,      # paid-short, split by line CARC
             "rem_sec": 16,
             # True realization: denominator backs out rate variance; the
             # legit shortfall splits by board group (working vs gave up)
             "adj_est": 18, "true_rate": 19, "legit": 20,
             "still": 21, "lost": 22, "pct_still": 23, "pct_lost": 24}

# Claims Board groups where an unpaid remainder means we ACCEPTED the loss.
# Everything else (Outstanding, Denied, Submitted, Medicaid Outstanding,
# Paid-but-not-EFTd, Future...) counts as still-collecting.
GAVE_UP_GROUPS = ("paid and closed", "bad debt")

# Line-level CARCs that mean part of the line was DENIED (collectible /
# appealable) rather than contractually repriced. CO-45/253/223 etc. are
# contractual (rate variance). PR-1/2/3 are deductible/coins/copay (PR).
DENIAL_CARCS = {"16", "22", "23", "29", "50", "55", "96", "97", "109", "119",
                "150", "151", "167", "197", "198", "204", "242", "B7", "B15"}
S_RAW_PAID = "numeric_mm201t4y"   # subitem: ERA line paid
S_PARSED_PR = "numeric_mm1gredn"  # subitem: ERA line patient responsibility
S_CARC = "dropdown_mm2pthcy"      # subitem: ERA line CARC codes
REAL_HEADER_ROW = 3

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
      cursor items{id name group{title} column_values(ids:["%s","%s","%s","%s","%s","%s"]){id text}
        subitems{column_values(ids:["%s","%s","%s","%s","%s","%s","%s"]){id text}}}}}}""" % (
        C_DOS, C_SUBID, C_PAYOR, C_PPAID, C_PR_AMT, C_RAW_PR, C_ERA_DATE,
        S_HCPC, S_ESTPAY, S_CHARGE, S_MODS, S_RAW_PAID, S_PARSED_PR, S_CARC)
    q_next = """query($cur:String!){next_items_page(limit:100,cursor:$cur){
      cursor items{id name group{title} column_values(ids:["%s","%s","%s","%s","%s","%s"]){id text}
        subitems{column_values(ids:["%s","%s","%s","%s","%s","%s","%s"]){id text}}}}}""" % (
        C_SUBID, C_PAYOR, C_PPAID, C_PR_AMT, C_RAW_PR, C_ERA_DATE,
        S_HCPC, S_ESTPAY, S_CHARGE, S_MODS, S_RAW_PAID, S_PARSED_PR, S_CARC)
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


def compute_realization(token, dos_year, dos_month):
    """Realization for one DOS month: Est. Pay vs primary + secondary +
    patient collections to date, plus the remaining-gap split."""
    r_first = dt.date(dos_year, dos_month, 1)
    r_last = (dt.date(dos_year + (dos_month == 12), (dos_month % 12) + 1, 1)
              - dt.timedelta(days=1))
    r_est = r_coll = pr_total = raw_lost = 0.0
    rp_unadj = rp_zero = rp_ratevar = rp_denial = 0.0
    for c in pull_month_claims(token, r_first.isoformat(), r_last.isoformat()):
        group_title = (c.get("group") or {}).get("title", "").lower()
        gave_up = any(g in group_title for g in GAVE_UP_GROUPS)
        pcv = {v["id"]: (v["text"] or "") for v in c["column_values"]}
        paid = num(pcv.get(C_PPAID))
        r_coll += paid
        # PR established by the primary ERA — the slice owed downstream
        # (secondary insurance and/or patient). Adjudicated = ERA landed.
        adjudicated = bool(pcv.get(C_ERA_DATE, "").strip()) or paid > 0
        pr_c = (num(pcv.get(C_RAW_PR)) or num(pcv.get(C_PR_AMT))) if adjudicated else 0.0
        pr_total += pr_c
        est_c = line_ratevar = line_denial = line_data = 0.0
        for sub in c.get("subitems") or []:
            cv = {v["id"]: (v["text"] or "") for v in sub["column_values"]}
            if cv.get(S_HCPC, "").strip().upper() not in KNOWN_CODES:
                continue
            est_l = num(cv.get(S_ESTPAY)) or num(cv.get(S_CHARGE))
            est_c += est_l
            paid_l, pr_l = num(cv.get(S_RAW_PAID)), num(cv.get(S_PARSED_PR))
            carc = cv.get(S_CARC, "").upper()
            if paid_l > 0 or pr_l > 0 or carc:
                line_data += 1
                short_l = max(0.0, est_l - paid_l - pr_l)
                if short_l >= 0.01:
                    # A denial-class CARC on the line = payer refused part
                    # of it (collectible / appealable). Otherwise the payer
                    # simply allowed less than we estimated (rate variance).
                    codes = {t.strip() for t in carc.replace(";", ",").split(",") if t.strip()}
                    if codes & DENIAL_CARCS:
                        line_denial += short_l
                    else:
                        line_ratevar += short_l
        r_est += est_c
        # Components of the primary-side gap. non_ratevar_short = the
        # legit (collectible-in-principle) part of this claim's gap.
        non_ratevar_short = 0.0
        if not adjudicated:
            rp_unadj += est_c
            non_ratevar_short = est_c
        elif paid <= 0:
            zero_short = max(0.0, est_c - pr_c)
            rp_zero += zero_short
            non_ratevar_short = zero_short
        else:
            claim_short = max(0.0, est_c - paid - pr_c)
            if line_data:
                rp_ratevar += line_ratevar
                rp_denial += line_denial
                non_ratevar_short = line_denial
            else:
                # no line-level ERA data (older claims) — default to rate
                # variance, the benign bucket
                rp_ratevar += claim_short
        if gave_up:
            raw_lost += non_ratevar_short
    r_sec, r_pt = pull_secondary_collections(
        token, r_first.isoformat(), r_last.isoformat())
    # Split the remaining gap: downstream remainder = PR established minus
    # what secondary + patient already paid (capped at the total gap);
    # everything else is primary-side (unadjudicated, underpaid, denied).
    remaining = max(0.0, r_est - (r_coll + r_sec + r_pt))
    rem_sec = min(remaining, max(0.0, pr_total - r_sec - r_pt))
    rem_prim = remaining - rem_sec
    # True realization: back the rate variance out of the denominator,
    # then split the legit shortfall into lost (gave-up groups) vs still
    # collecting (everything else, incl. the secondary/patient pipeline).
    legit_remaining = max(0.0, (r_est - rp_ratevar) - (r_coll + r_sec + r_pt))
    lost = min(raw_lost, legit_remaining)
    still = legit_remaining - lost
    return dict(month=r_first.strftime("%b %Y"), est=round(r_est, 2),
                collected=round(r_coll, 2), secondary=r_sec, patient=r_pt,
                rem_prim=round(rem_prim, 2), rem_sec=round(rem_sec, 2),
                rp_unadj=round(rp_unadj, 2), rp_zero=round(rp_zero, 2),
                rp_ratevar=round(rp_ratevar, 2), rp_denial=round(rp_denial, 2),
                lost=round(lost, 2), still=round(still, 2),
                age_days=(dt.date.today() - r_last).days)


def _ensure_realization_tab(svc):
    """Create the Realization tab with labels/formats if missing. Returns sheetId."""
    meta = svc.spreadsheets().get(spreadsheetId=SHEET_ID, fields="sheets.properties").execute()
    for s in meta["sheets"]:
        if s["properties"]["title"] == REAL_TAB:
            return s["properties"]["sheetId"]
    r = svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID, body={"requests": [{
        "addSheet": {"properties": {"title": REAL_TAB, "gridProperties": {
            "rowCount": 40, "columnCount": 30, "frozenRowCount": 3, "frozenColumnCount": 1}}}}]}
    ).execute()
    sid = r["replies"][0]["addSheet"]["properties"]["sheetId"]
    labels = [
        ["Realization by DOS month"],
        ["One column per date-of-service month, RE-MEASURED on every monthly run — collections to date, so young months read low and mature as payments land."],
        ["Metric"], ["Days since month end"], ["Est. Pay total"],
        ["Collected — primary"], ["Collected — secondary insurance"],
        ["Collected — patient (Stripe)"], ["Collected — total"],
        ["Realization rate %"],
        ["Remaining — primary side (components below)"],
        ["   · not yet adjudicated (in flight)"],
        ["   · adjudicated, paid $0 (denied / stuck)"],
        ["   · paid short — rate variance (est. above contracted rate; not collectible)"],
        ["   · paid short — partial denial (denial CARC on line; work/appeal)"],
        ["Remaining — secondary & patient (PR established, not yet collected)"],
        ["TRUE REALIZATION (rate variance backed out of the denominator)"],
        ["Adjusted Est. Pay (est − rate variance)"],
        ["True realization rate %"],
        ["Legit uncollected (adjusted est − collected)"],
        ["   · still collecting (open on boards + downstream pipeline)"],
        ["   · lost / closed short (Paid And Closed / Bad Debt)"],
        ["   % still collecting (of adjusted Est. Pay)"],
        ["   % lost (of adjusted Est. Pay)"],
        [""],
        ["True realization: denominator = Est. Pay minus rate variance (payer contract rates below our estimates — definitional, not collectible). Legit uncollected splits by Claims Board group: remainder on claims in Paid And Closed / Bad Debt = lost (we accepted it); everything else (Outstanding, Denied, Submitted, Medicaid Outstanding, secondary/patient pipeline) = still collecting."],
    ]
    svc.spreadsheets().values().update(
        spreadsheetId=SHEET_ID, range=f"'{REAL_TAB}'!A1",
        valueInputOption="RAW", body={"values": labels}).execute()
    def numf(r1, r2, typ, pat):
        return {"repeatCell": {"range": {"sheetId": sid, "startRowIndex": r1 - 1, "endRowIndex": r2,
                "startColumnIndex": 1, "endColumnIndex": 30},
                "cell": {"userEnteredFormat": {"numberFormat": {"type": typ, "pattern": pat}}},
                "fields": "userEnteredFormat.numberFormat"}}
    svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID, body={"requests": [
        {"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 1},
         "cell": {"userEnteredFormat": {"textFormat": {"bold": True, "fontSize": 14}}}, "fields": "userEnteredFormat.textFormat"}},
        {"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 2, "endRowIndex": 3, "startColumnIndex": 0, "endColumnIndex": 30},
         "cell": {"userEnteredFormat": {"textFormat": {"bold": True}, "backgroundColor": {"red": 0.92, "green": 0.94, "blue": 0.97}}},
         "fields": "userEnteredFormat"}},
        numf(4, 4, "NUMBER", "#,##0"), numf(5, 9, "CURRENCY", "$#,##0"),
        numf(10, 10, "PERCENT", "0.0%"), numf(11, 16, "CURRENCY", "$#,##0"),
        numf(18, 18, "CURRENCY", "$#,##0"), numf(19, 19, "PERCENT", "0.0%"),
        numf(20, 22, "CURRENCY", "$#,##0"), numf(23, 24, "PERCENT", "0.0%"),
        {"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 11, "endRowIndex": 15, "startColumnIndex": 0, "endColumnIndex": 30},
         "cell": {"userEnteredFormat": {"textFormat": {"italic": True}}}, "fields": "userEnteredFormat.textFormat.italic"}},
        {"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 16, "endRowIndex": 17, "startColumnIndex": 0, "endColumnIndex": 30},
         "cell": {"userEnteredFormat": {"textFormat": {"bold": True}, "backgroundColor": {"red": 0.92, "green": 0.94, "blue": 0.97}}},
         "fields": "userEnteredFormat"}},
        {"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 18, "endRowIndex": 19, "startColumnIndex": 0, "endColumnIndex": 30},
         "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}}, "fields": "userEnteredFormat.textFormat.bold"}},
        {"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 8, "endRowIndex": 10, "startColumnIndex": 0, "endColumnIndex": 30},
         "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}}, "fields": "userEnteredFormat.textFormat.bold"}},
        {"updateDimensionProperties": {"range": {"sheetId": sid, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1},
         "properties": {"pixelSize": 300}, "fields": "pixelSize"}},
    ]}).execute()
    return sid


def update_realization_tab(svc, token, upto_year, upto_month):
    """Write/refresh one column per DOS month from REAL_START through
    (upto_year, upto_month). Every column is fully re-measured each run."""
    _ensure_realization_tab(svc)
    months, y, m = [], *REAL_START
    while (y, m) <= (upto_year, upto_month):
        months.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    data = []
    for i, (yy, mm) in enumerate(months):
        r = compute_realization(token, yy, mm)
        colx = col_letter(i + 1)  # B, C, ...
        RR = REAL_ROWS
        vals = {REAL_HEADER_ROW: r["month"], RR["age"]: r["age_days"],
                RR["est"]: r["est"], RR["coll"]: r["collected"],
                RR["sec"]: r["secondary"], RR["pt"]: r["patient"],
                RR["tot"]: f"=SUM({colx}{RR['coll']}:{colx}{RR['pt']})",
                RR["rate"]: f"=IF(N({colx}{RR['est']})=0,\"\",{colx}{RR['tot']}/{colx}{RR['est']})",
                RR["rem_prim"]: r["rem_prim"], RR["rp_unadj"]: r["rp_unadj"],
                RR["rp_zero"]: r["rp_zero"], RR["rp_ratevar"]: r["rp_ratevar"],
                RR["rp_denial"]: r["rp_denial"], RR["rem_sec"]: r["rem_sec"],
                RR["adj_est"]: f"=MAX(0,{colx}{RR['est']}-{colx}{RR['rp_ratevar']})",
                RR["true_rate"]: f"=IF(N({colx}{RR['adj_est']})=0,\"\",{colx}{RR['tot']}/{colx}{RR['adj_est']})",
                RR["legit"]: f"=MAX(0,{colx}{RR['adj_est']}-{colx}{RR['tot']})",
                RR["still"]: r["still"], RR["lost"]: r["lost"],
                RR["pct_still"]: f"=IF(N({colx}{RR['adj_est']})=0,\"\",{colx}{RR['still']}/{colx}{RR['adj_est']})",
                RR["pct_lost"]: f"=IF(N({colx}{RR['adj_est']})=0,\"\",{colx}{RR['lost']}/{colx}{RR['adj_est']})"}
        data += [{"range": f"'{REAL_TAB}'!{colx}{row}", "values": [[v]]}
                 for row, v in vals.items()]
        print(f"Realization {r['month']}: {r['collected']}+{r['secondary']}+{r['patient']} "
              f"of {r['est']} (age {r['age_days']}d, rem P/S {r['rem_prim']}/{r['rem_sec']})")
    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=SHEET_ID,
        body={"valueInputOption": "USER_ENTERED", "data": data}).execute()
    # month headers must stay literal text, not date serials
    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=SHEET_ID,
        body={"valueInputOption": "RAW", "data": [
            {"range": f"'{REAL_TAB}'!{col_letter(i + 1)}{REAL_HEADER_ROW}",
             "values": [[dt.date(yy, mm, 1).strftime('%b %Y')]]}
            for i, (yy, mm) in enumerate(months)]}).execute()
    return len(months)


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

    def is_dual(s): return s.get(C_TYPE, "") == "Sensors & Supplies"

    def bucket(pred):
        g = [s for s in subs if pred(s)]
        return dict(unique=len(g), sensors=sum(map(is_sens, g)),
                    supplies=sum(map(is_supp, g)), dual=sum(map(is_dual, g)))

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
        # Total = the live book: Active + Paused only (Brandon 2026-08-01).
        # Excludes Not Active/Dead and blank-status items.
        "total": bucket(lambda s: s.get(C_STATUS, "").lower() in ("active", "paused")),
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
    # Patient flows: compare each item's state at the START of the month
    # (previous_value of its first event) to its state at the END (value of
    # its last event). Within-month round trips (pause→resume) net out.
    per_item = {}
    for ev in events:
        try:
            data = json.loads(ev["data"])
        except (TypeError, ValueError):
            continue
        pid = str(data.get("pulse_id") or "")
        if not pid:
            continue
        per_item.setdefault(pid, []).append(
            (ev["created_at"], label_from(data.get("previous_value") or {}),
             label_from(data.get("value") or {})))

    def state(lab):
        l = (lab or "").lower()
        if "not active" in l or "dead" in l or "cancel" in l:
            return "gone"
        if "paus" in l:
            return "paused"
        if "active" in l:
            return "active"
        return ""

    churned_ids = []
    churn_from_active = pause_new = pause_res = 0
    for pid, evs in per_item.items():
        evs.sort(key=lambda e: e[0])
        start = state(evs[0][1]) or "active"
        end = state(evs[-1][2])
        if not end or start == end:
            continue
        if end == "gone":
            churned_ids.append(pid)
            churn_from_active += start == "active"
        elif end == "paused" and start == "active":
            pause_new += 1
        elif end == "active":     # resumed from pause (or rare gone→active)
            pause_res += 1
    churned = [by_id[p] for p in churned_ids if p in by_id]
    attr = dict(unique=len(churned_ids), sensors=sum(map(is_sens, churned)),
                supplies=sum(map(is_supp, churned)), dual=sum(map(is_dual, churned)))
    flows = dict(pause_new=pause_new, pause_res=pause_res,
                 churn_from_active=churn_from_active)

    # (Realization lives on its own tab now — see update_realization_tab.)

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
        "flows": flows,
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
        # Dual (Sensors & Supplies) counts — exact values, not derived, so
        # blank subscription types can't skew them
        R["total_dual"]: c["total"]["dual"], R["active_dual"]: c["active"]["dual"],
        R["paused_dual"]: c["paused"]["dual"], R["new_dual"]: c["new"]["dual"],
        R["attr_dual"]: a["dual"],
        # Exclusive segments (formulas): sensors-only = sensors − dual, etc.
        R["total_sonly"]: f"={col}{R['total_sens']}-{col}{R['total_dual']}",
        R["total_ponly"]: f"={col}{R['total_supp']}-{col}{R['total_dual']}",
        R["active_sonly"]: f"={col}{R['active_sens']}-{col}{R['active_dual']}",
        R["active_ponly"]: f"={col}{R['active_supp']}-{col}{R['active_dual']}",
        R["pause_new"]: kpis["flows"]["pause_new"],
        R["pause_res"]: kpis["flows"]["pause_res"],
        R["pause_net"]: f"={col}{R['pause_new']}-{col}{R['pause_res']}",
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
    # Roll-forward ties (±5 tolerance — reactivations from Gone and
    # blank-status cleanups cause small legitimate residuals):
    #   Total(A+P)  = prev Total + New − Churned
    #   Active      = prev Active + New − Newly paused + Resumed − Churned
    # (Active uses total churn; churn-from-paused inflates the residual
    # slightly, covered by the tolerance.)
    if idx > 1:
        pc = col_letter(idx - 1)
        cells[R["audit_rollfwd_total"]] = (
            f"=IF({pc}{R['total_u']}=\"\",\"\","
            f"{col}{R['total_u']}-({pc}{R['total_u']}"
            f"+{col}{R['new_u']}-{col}{R['attr_u']}))")
        cells[R["audit_rollfwd_active"]] = (
            f"=IF({pc}{R['active_u']}=\"\",\"\","
            f"{col}{R['active_u']}-({pc}{R['active_u']}+{col}{R['new_u']}"
            f"-{col}{R['pause_new']}+{col}{R['pause_res']}-{col}{R['attr_u']}))")
    else:
        cells[R["audit_rollfwd_total"]] = ""
        cells[R["audit_rollfwd_active"]] = ""
    cells[R["audit_status"]] = (f"=IF(AND(ABS(N({col}{R['audit_revsum']}))<0.005,"
                                f"ABS(N({col}{R['audit_gpsum']}))<0.005,"
                                f"N({col}{R['audit_unmatched']})=0,"
                                f"N({col}{R['audit_unknown']})=0,"
                                f"ABS(N({col}{R['audit_rollfwd_total']}))<=5,"
                                f"ABS(N({col}{R['audit_rollfwd_active']}))<=5),\"OK\",\"CHECK\")")
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
        n = update_realization_tab(svc, token, year, month)
        print(f"Realization tab refreshed: {n} DOS month column(s) re-measured.")


if __name__ == "__main__":
    main()
