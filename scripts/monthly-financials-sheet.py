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
C_SENS_REV, C_SENS_COST = "numeric_mkxj6a3d", "numeric_mkxjxmga"
C_SUPP_REV, C_SUPP_COST = "numeric_mm27rypj", "numeric_mm27hem2"
C_TOT_REV, C_SHIP, C_ARR = "numeric_mm2xsjm5", "numeric_mm2xxmp4", "numeric_mm2xsqyd"
SUB_COLS = [C_STATUS, C_TYPE, C_PRIMARY, C_SENS_REV, C_SENS_COST,
            C_SUPP_REV, C_SUPP_COST, C_TOT_REV, C_SHIP, C_ARR]

# Claims Board columns
C_DOS, C_SUBID = "date_mkwr7spz", "text_mm3ahdn3"
S_HCPC, S_ESTPAY, S_CHARGE = "color_mm1cdvq8", "numeric_mm1zspsy", "numeric_mm1za8v5"

MEDICAID_PRIMARIES = {"Fidelis Medicaid", "Anthem BCBS Medicaid (JLJ)",
                      "United Medicaid", "Medicaid"}
SUPPLY_CODES = {"A4224", "A4225", "A4230", "A4231", "A4232"}
SHIPPING_PER_ORDER = 8.25
SENSORS_COST_FALLBACK, SUPPLIES_COST_FALLBACK = 500.0, 314.0
FIXED_COST_DEFAULT = 30000

# Row map (1-indexed sheet rows; column A holds labels, months go B, C, ...)
HEADER_ROW = 3
ROWS = {
    "total_u": 5, "total_sens": 6, "total_supp": 7,
    "active_u": 9, "active_sens": 10, "active_supp": 11,
    "paused_u": 13, "paused_sens": 14, "paused_supp": 15,
    "attr_u": 17, "attr_sens": 18, "attr_supp": 19,
    "arr_total": 22, "arr_sens": 23, "arr_supp": 24,
    "rev_pump": 27, "rev_monitor": 28, "rev_sensor": 29, "rev_supplies": 30,
    "rev_total": 31,
    "avg_weighted": 33, "avg_sens": 34, "avg_supp": 35,
    # Per-product P&L (restructured 2026-08-01): COGS / GP / margins / net
    # all mirror the pump-monitor-sensor-supplies-total revenue layout.
    "cogs_pump": 38, "cogs_monitor": 39, "cogs_sensor": 40,
    "cogs_supplies": 41, "cogs_ship": 42, "cogs_total": 43,
    "gp_pump": 46, "gp_monitor": 47, "gp_sensor": 48, "gp_supplies": 49, "gp_total": 50,
    "gm_pump": 51, "gm_monitor": 52, "gm_sensor": 53, "gm_supplies": 54, "gm_total": 55,
    "fixed": 58,
    "np_pump": 59, "np_monitor": 60, "np_sensor": 61, "np_supplies": 62, "np_total": 63,
    "nm_pump": 64, "nm_monitor": 65, "nm_sensor": 66, "nm_supplies": 67, "nm_total": 68,
}
LAST_ROW = 68


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
      cursor items{id name column_values(ids:$c){id text}}}}}"""
    q_next = """query($cur:String!,$c:[String!]){next_items_page(limit:500,cursor:$cur){
      cursor items{id name column_values(ids:$c){id text}}}}"""
    while True:
        if cursor is None:
            d = monday(q_first, {"b": [SUB_BOARD], "c": SUB_COLS}, token)
            page = d["boards"][0]["items_page"]
        else:
            d = monday(q_next, {"cur": cursor, "c": SUB_COLS}, token)
            page = d["next_items_page"]
        for it in page["items"]:
            row = {"id": it["id"], "name": it["name"]}
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
      cursor items{id name group{title} column_values(ids:["%s"]){id text}
        subitems{column_values(ids:["%s","%s","%s"]){id text}}}}}}""" % (
        C_DOS, C_SUBID, S_HCPC, S_ESTPAY, S_CHARGE)
    q_next = """query($cur:String!){next_items_page(limit:100,cursor:$cur){
      cursor items{id name group{title} column_values(ids:["%s"]){id text}
        subitems{column_values(ids:["%s","%s","%s"]){id text}}}}}""" % (
        C_SUBID, S_HCPC, S_ESTPAY, S_CHARGE)
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

    counts = {
        "total": bucket(lambda s: True),
        "active": bucket(lambda s: s.get(C_STATUS, "").lower() == "active"),
        "paused": bucket(lambda s: s.get(C_STATUS, "").lower() == "paused"),
    }

    active = [s for s in subs if s.get(C_STATUS, "").lower() == "active"]
    def mult(s): return 6 if s.get(C_PRIMARY, "").strip() in MEDICAID_PRIMARIES else 4
    arr_total = sum(num(s.get(C_ARR)) for s in active)
    arr_sens = sum(num(s.get(C_SENS_REV)) * mult(s) for s in active)
    arr_supp = sum(num(s.get(C_SUPP_REV)) * mult(s) for s in active)

    def avg(vals): return round(sum(vals) / len(vals), 2) if vals else 0
    avg_weighted = avg([num(s.get(C_TOT_REV)) for s in active if num(s.get(C_TOT_REV)) > 0])
    avg_sens = avg([num(s.get(C_SENS_REV)) for s in active if num(s.get(C_SENS_REV)) > 0])
    avg_supp = avg([num(s.get(C_SUPP_REV)) for s in active if num(s.get(C_SUPP_REV)) > 0])

    # 2. Month claims -> revenue by product + COGS
    claims = pull_month_claims(token, first.isoformat(), last.isoformat())
    rev = dict(pump=0.0, monitor=0.0, sensors=0.0, supplies=0.0)
    cogs = dict(pump=0.0, monitor=0.0, sensors=0.0, supplies=0.0, shipping=0.0)
    for c in claims:
        has_sens = has_supp = False
        codes = set()
        for sub in c.get("subitems") or []:
            cv = {v["id"]: (v["text"] or "") for v in sub["column_values"]}
            code = cv.get(S_HCPC, "").strip().upper()
            val = num(cv.get(S_ESTPAY)) or num(cv.get(S_CHARGE))
            codes.add(code)
            if code == "E0784":
                rev["pump"] += val
            elif code == "E2103":
                rev["monitor"] += val
            elif code == "A4239":
                rev["sensors"] += val; has_sens = True
            elif code in SUPPLY_CODES:
                rev["supplies"] += val; has_supp = True
        sub_item_id = next((v["text"] for v in c["column_values"] if v["id"] == C_SUBID), "") or ""
        patient = by_id.get(sub_item_id.strip()) or by_name.get(c["name"].strip().lower())
        if has_sens:
            cost = num(patient.get(C_SENS_COST)) if patient else 0
            cogs["sensors"] += cost if cost > 0 else SENSORS_COST_FALLBACK
        if has_supp:
            cost = num(patient.get(C_SUPP_COST)) if patient else 0
            cogs["supplies"] += cost if cost > 0 else SUPPLIES_COST_FALLBACK
        pump_only = codes and codes <= {"E0784"}
        if not pump_only:
            cogs["shipping"] += SHIPPING_PER_ORDER

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

    return {
        "counts": counts, "attrition": attr,
        "arr": dict(total=round(arr_total, 2), sensors=round(arr_sens, 2), supplies=round(arr_supp, 2)),
        "revenue": {k: round(v, 2) for k, v in rev.items()},
        "avg": dict(weighted=avg_weighted, sensors=avg_sens, supplies=avg_supp),
        "cogs": {k: round(v, 2) for k, v in cogs.items()},
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
        R["attr_u"]: a["unique"], R["attr_sens"]: a["sensors"], R["attr_supp"]: a["supplies"],
        R["arr_total"]: arr["total"], R["arr_sens"]: arr["sensors"], R["arr_supp"]: arr["supplies"],
        R["rev_pump"]: rev["pump"], R["rev_monitor"]: rev["monitor"],
        R["rev_sensor"]: rev["sensors"], R["rev_supplies"]: rev["supplies"],
        R["rev_total"]: f"=SUM({col}{R['rev_pump']}:{col}{R['rev_supplies']})",
        R["avg_weighted"]: avg["weighted"], R["avg_sens"]: avg["sensors"], R["avg_supp"]: avg["supplies"],
    }
    cg = kpis["cogs"]
    cells.update({
        R["cogs_pump"]: cg["pump"], R["cogs_monitor"]: cg["monitor"],
        R["cogs_sensor"]: cg["sensors"], R["cogs_supplies"]: cg["supplies"],
        R["cogs_ship"]: cg["shipping"],
        R["cogs_total"]: f"=SUM({col}{R['cogs_pump']}:{col}{R['cogs_ship']})",
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


if __name__ == "__main__":
    main()
