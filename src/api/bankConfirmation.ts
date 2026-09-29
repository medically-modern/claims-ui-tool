// Data layer for the Bank Confirmation tab (Hit Bank? gate, 2026-09-29).
//
// Reads every row parked in "Paid, but NOT in Bank" on both Claims boards
// and rolls them up into DEPOSITS — one ACH / check / Stripe payout covers
// many claims, and the bank confirms a deposit, not a claim. Grouping key
// is the 835 trace (TRN02 = check or EFT number) + payment date + the BPR
// deposit total, so a deposit that spans the Primary and Secondary boards
// shows up once.
//
// Writes go through the backend (/admin/hit-bank/mark) so the group move
// happens in the same call as the Hit Bank? write.

import { useQuery } from "@tanstack/react-query";
import { mondayQuery, CLAIMS_BOARD_ID, SECONDARY_BOARD_ID } from "./monday";
import { NOT_IN_BANK_GROUP, HIT_BANK_COL, type PaidBoard } from "./routePaidGroup";

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export type HitBankLabel = "Yes" | "Mismatch";

const COLS: Record<PaidBoard, Record<string, string>> = {
  primary: {
    payer:        "color_mkxmhypt",
    paid:         "numeric_mm115q76",
    paidDate:     "date_mm11zg2f",
    method:       "color_mm3jh0x2",
    depositTotal: "numeric_mm3jm85z",
    eftDate:      "date_mm3je93r",
    trace:        "text_mm1gz8ss",
    checkNumber:  "text_mm11m3fh",
    originator:   "text_mm3jpw1b",
    hitBank:      HIT_BANK_COL.primary,
  },
  secondary: {
    payer:        "color_mkxq1a2p",
    payerRaw:     "text_mm3a2yax",
    paid:         "numeric_mm115q76",
    paidDate:     "date_mm11zg2f",
    method:       "color_mm3jpg86",
    depositTotal: "numeric_mm3js9d0",
    eftDate:      "date_mm3jq5zk",
    trace:        "text_mm1gz8ss",
    checkNumber:  "text_mm11m3fh",
    originator:   "text_mm3jz59k",
    stripeCharge: "text_mm3qsjdf",
    hitBank:      HIT_BANK_COL.secondary,
  },
};

export interface ParkedClaim {
  itemId: string;
  board: PaidBoard;
  patientName: string;
  payer: string;
  paid: number | null;
  paidDate: string | null;
  method: string;            // ACH / CHK / FWT / "" (Stripe)
  depositTotal: number | null;
  eftDate: string | null;
  trace: string;
  checkNumber: string;
  originator: string;
  stripeCharge: string;
  hitBank: string;           // "" | "Mismatch" (Yes rows have already moved)
}

export type DepositKind = "ACH" | "CHK" | "FWT" | "Stripe" | "Other";

export interface Deposit {
  key: string;
  kind: DepositKind;
  payer: string;
  /** ERA payment / EFT date — when the money should have landed. */
  expectedDate: string | null;
  /** BPR02 deposit total from the 835 (net of any PLB offsets). This is
   *  the number that must match the bank, not the sum of claim payments. */
  depositTotal: number | null;
  claimPaidSum: number;
  reference: string;         // trace / check # / Stripe charge id
  originator: string;
  claims: ParkedClaim[];
  mismatch: boolean;
  businessDaysWaiting: number | null;
  overdue: boolean;
}

/** Business days after which a still-unconfirmed deposit is flagged. */
export const OVERDUE_BUSINESS_DAYS: Record<DepositKind, number> = {
  ACH: 3, FWT: 3, CHK: 10, Stripe: 5, Other: 5,
};

const QUERY = `
  query ParkedGroup($boardId: [ID!]!, $groupId: [String!]!, $cols: [String!]!, $cursor: String) {
    boards(ids: $boardId) {
      groups(ids: $groupId) {
        items_page(limit: 200, cursor: $cursor) {
          cursor
          items { id name column_values(ids: $cols) { id text } }
        }
      }
    }
  }
`;

interface Resp {
  boards: { groups: { items_page: { cursor: string | null; items: {
    id: string; name: string; column_values: { id: string; text: string | null }[];
  }[] } }[] }[];
}

function num(t: string): number | null {
  if (!t) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function fetchBoard(board: PaidBoard): Promise<ParkedClaim[]> {
  const cols = COLS[board];
  const boardId = board === "primary" ? CLAIMS_BOARD_ID : SECONDARY_BOARD_ID;
  const out: ParkedClaim[] = [];
  let cursor: string | null = null;
  do {
    const r: Resp = await mondayQuery<Resp>(QUERY, {
      boardId: [String(boardId)],
      groupId: [NOT_IN_BANK_GROUP[board]],
      cols: Object.values(cols),
      cursor,
    });
    const page = r.boards?.[0]?.groups?.[0]?.items_page;
    for (const it of page?.items ?? []) {
      const v = (key: string) =>
        cols[key] ? (it.column_values.find((c) => c.id === cols[key])?.text ?? "").trim() : "";
      out.push({
        itemId:       it.id,
        board,
        patientName:  it.name,
        payer:        v("payerRaw") || v("payer"),
        paid:         num(v("paid")),
        paidDate:     v("paidDate") || null,
        method:       v("method").toUpperCase(),
        depositTotal: num(v("depositTotal")),
        eftDate:      v("eftDate") || null,
        trace:        v("trace"),
        checkNumber:  v("checkNumber"),
        originator:   v("originator"),
        stripeCharge: v("stripeCharge"),
        hitBank:      v("hitBank"),
      });
    }
    cursor = page?.cursor ?? null;
  } while (cursor);
  return out;
}

export function businessDaysBetween(fromIso: string | null, to: Date): number | null {
  if (!fromIso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromIso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let n = 0;
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

function kindOf(c: ParkedClaim): DepositKind {
  if (c.method === "ACH" || c.method === "CHK" || c.method === "FWT") return c.method;
  if (c.stripeCharge) return "Stripe";
  return "Other";
}

export function groupDeposits(claims: ParkedClaim[], today: Date = new Date()): Deposit[] {
  const map = new Map<string, Deposit>();
  for (const c of claims) {
    const kind = kindOf(c);
    const reference = kind === "Stripe" ? c.stripeCharge : (c.trace || c.checkNumber);
    const expectedDate = c.eftDate || c.paidDate;
    // No reference at all -> the claim is its own deposit.
    const key = reference
      ? `${kind}|${reference}|${expectedDate ?? ""}|${c.depositTotal ?? ""}`
      : `item|${c.board}|${c.itemId}`;
    let d = map.get(key);
    if (!d) {
      d = {
        key, kind, payer: c.payer, expectedDate,
        depositTotal: kind === "Stripe" ? null : c.depositTotal,
        claimPaidSum: 0, reference, originator: c.originator,
        claims: [], mismatch: false, businessDaysWaiting: null, overdue: false,
      };
      map.set(key, d);
    }
    d.claims.push(c);
    d.claimPaidSum += c.paid ?? 0;
    if (c.hitBank === "Mismatch") d.mismatch = true;
  }
  for (const d of map.values()) {
    d.businessDaysWaiting = businessDaysBetween(d.expectedDate, today);
    d.overdue = d.businessDaysWaiting != null
      && d.businessDaysWaiting > OVERDUE_BUSINESS_DAYS[d.kind];
    d.claimPaidSum = Math.round(d.claimPaidSum * 100) / 100;
  }
  return Array.from(map.values()).sort((a, b) =>
    (b.businessDaysWaiting ?? -1) - (a.businessDaysWaiting ?? -1)
    || a.payer.localeCompare(b.payer));
}

export async function fetchParkedClaims(): Promise<ParkedClaim[]> {
  const [p, s] = await Promise.all([fetchBoard("primary"), fetchBoard("secondary")]);
  return [...p, ...s];
}

export const BANK_CONFIRMATION_QUERY_KEY = ["bank-confirmation"] as const;

export function useParkedClaims() {
  return useQuery({
    queryKey: BANK_CONFIRMATION_QUERY_KEY,
    queryFn: fetchParkedClaims,
    staleTime: 60_000,
  });
}

export function isHitBankMarkConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

/** Set Hit Bank? on every claim in a deposit (both boards), then the
 *  backend moves Yes rows to Paid And Closed. */
export async function markDeposit(
  deposit: Deposit,
  label: HitBankLabel | null,
): Promise<void> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new Error("Hit Bank marking needs VITE_API_BASE_URL and VITE_ADMIN_API_KEY.");
  }
  const byBoard: Record<PaidBoard, string[]> = { primary: [], secondary: [] };
  for (const c of deposit.claims) byBoard[c.board].push(c.itemId);
  for (const board of ["primary", "secondary"] as PaidBoard[]) {
    if (!byBoard[board].length) continue;
    const res = await fetch(`${API_BASE}/admin/hit-bank/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
      body: JSON.stringify({ board, item_ids: byBoard[board], label }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        if (b && typeof b === "object" && "detail" in b) detail = String(b.detail);
      } catch { /* keep HTTP status */ }
      throw new Error(detail);
    }
  }
}
