/**
 * claimsForecast.ts — minimal Claims Board pull for the unified forecast.
 * Reads PARENT claim rows only (status, est_pay, DOS, sent date, payor) so the
 * dashboard's in-flight input matches engine.py / the Google Sheet exactly.
 * (Deliberately NOT allClaims.ts, which sums subitems and drops Future Claim.)
 */
import { mondayQuery } from "../monday";
import type { ClaimRow } from "@/lib/subscription/unifiedForecast";

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

interface CV { id: string; text: string }
interface Item { id: string; name: string; column_values: CV[] }
interface PageResp { boards: Array<{ items_page: { cursor: string | null; items: Item[] } }> }
interface NextResp { next_items_page: { cursor: string | null; items: Item[] } }

const PAGE = `query($b:ID!,$c:[String!]!){boards(ids:[$b]){items_page(limit:500){cursor items{id name column_values(ids:$c){id text}}}}}`;
const NEXT = `query($cur:String!,$c:[String!]!){next_items_page(cursor:$cur,limit:500){cursor items{id name column_values(ids:$c){id text}}}}`;

const num = (s: string) => { const x = parseFloat(String(s || "").replace(/[$,]/g, "")); return isFinite(x) ? x : 0; };
const get = (it: Item, id: string) => (it.column_values.find((c) => c.id === id)?.text ?? "").trim();

function map(it: Item): ClaimRow {
  return {
    claim_status: get(it, COL.status),
    primary_payor: get(it, COL.payor),
    est_pay: num(get(it, COL.est)),
    primary_paid: num(get(it, COL.paid)),
    dos: get(it, COL.dos),
    claim_sent_date: get(it, COL.sent),
    primary_paid_date: get(it, COL.paidDate),
    claim_name: it.name,
  };
}

export async function fetchForecastClaims(): Promise<ClaimRow[]> {
  const out: ClaimRow[] = [];
  const first = await mondayQuery<PageResp>(PAGE, { b: String(FORECAST_CLAIMS_BOARD_ID), c: COLS });
  for (const it of first.boards[0]?.items_page?.items ?? []) out.push(map(it));
  let cursor = first.boards[0]?.items_page?.cursor ?? null;
  while (cursor) {
    const n = await mondayQuery<NextResp>(NEXT, { cur: cursor, c: COLS });
    for (const it of n.next_items_page?.items ?? []) out.push(map(it));
    cursor = n.next_items_page?.cursor ?? null;
  }
  return out;
}
