/**
 * claimsForecast.ts — minimal Claims Board pull for the unified forecast.
 * Reads PARENT claim rows (status, est_pay, paid, paid date, DOS, sent date,
 * payor) PLUS each claim's HCPCS subitem lines (code + units), so the engine can
 * value unpaid claims by actual-pay history → product-specific conservative
 * estimate (never the est_pay/charge field). Matches engine.py / the Sheet exactly.
 * (Deliberately NOT allClaims.ts, which sums subitems and drops Future Claim.)
 */
import { mondayQuery } from "../monday";
import type { ClaimRow, ClaimLine } from "@/lib/subscription/unifiedForecast";

export const FORECAST_CLAIMS_BOARD_ID = 18245429780;
const COL = {
  status: "color_mkxmywtb",
  payor: "color_mkxmhypt",
  est: "numeric_mm2xdtk6",
  paid: "numeric_mm115q76",       // Primary Paid (A) — actual paid amount
  dos: "date_mkwr7spz",
  sent: "date_mm14rk8d",
  paidDate: "date_mm11zg2f",      // Primary Paid Date (D)
} as const;
const COLS = Object.values(COL);
// Subitem (Claims Subitems Board) columns: HCPC code + claim/order quantity.
const SUB = { hcpc: "color_mm1cdvq8", qtyClaim: "numeric_mm20r76b", qtyOrder: "numeric_mm1czbyg" } as const;
const SUBCOLS = Object.values(SUB);

interface CV { id: string; text: string }
interface Sub { id: string; column_values: CV[] }
interface Item { id: string; name: string; column_values: CV[]; subitems?: Sub[] }
interface PageResp { boards: Array<{ items_page: { cursor: string | null; items: Item[] } }> }
interface NextResp { next_items_page: { cursor: string | null; items: Item[] } }

const SUBQ = `subitems{id column_values(ids:$s){id text}}`;
const PAGE = `query($b:ID!,$c:[String!]!,$s:[String!]!){boards(ids:[$b]){items_page(limit:200){cursor items{id name column_values(ids:$c){id text} ${SUBQ}}}}}`;
const NEXT = `query($cur:String!,$c:[String!]!,$s:[String!]!){next_items_page(cursor:$cur,limit:200){cursor items{id name column_values(ids:$c){id text} ${SUBQ}}}}`;

const num = (s: string) => { const x = parseFloat(String(s || "").replace(/[$,]/g, "")); return isFinite(x) ? x : 0; };
const get = (cvs: CV[], id: string) => (cvs.find((c) => c.id === id)?.text ?? "").trim();

function mapLines(it: Item): ClaimLine[] {
  return (it.subitems ?? []).map((s) => ({
    hcpcs: get(s.column_values, SUB.hcpc),
    units: num(get(s.column_values, SUB.qtyClaim)) || num(get(s.column_values, SUB.qtyOrder)) || 1,
  }));
}

function map(it: Item): ClaimRow {
  return {
    claim_status: get(it.column_values, COL.status),
    primary_payor: get(it.column_values, COL.payor),
    est_pay: num(get(it.column_values, COL.est)),
    primary_paid: num(get(it.column_values, COL.paid)),
    dos: get(it.column_values, COL.dos),
    claim_sent_date: get(it.column_values, COL.sent),
    primary_paid_date: get(it.column_values, COL.paidDate),
    claim_name: it.name,
    item_id: it.id,
    lines: mapLines(it),
  };
}

export async function fetchForecastClaims(): Promise<ClaimRow[]> {
  const out: ClaimRow[] = [];
  const first = await mondayQuery<PageResp>(PAGE, { b: String(FORECAST_CLAIMS_BOARD_ID), c: COLS, s: SUBCOLS });
  for (const it of first.boards[0]?.items_page?.items ?? []) out.push(map(it));
  let cursor = first.boards[0]?.items_page?.cursor ?? null;
  while (cursor) {
    const n = await mondayQuery<NextResp>(NEXT, { cur: cursor, c: COLS, s: SUBCOLS });
    for (const it of n.next_items_page?.items ?? []) out.push(map(it));
    cursor = n.next_items_page?.cursor ?? null;
  }
  return out;
}
