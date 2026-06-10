/**
 * dvsPatients.ts — Live fetch of Medicaid Supplies patients from the
 * Subscription Board for the DVS workstation UI.
 *
 * Filter rules:
 *   - Primary Insurance (color_mm254qxj) === "Medicaid" (pure NY
 *     Medicaid only; Fidelis/United/Anthem Medicaid managed-care
 *     variants go through a different path).
 *   - Subscription type (color_mm273mv8) is NOT "Sensors" — Sensors-
 *     only patients don't need DVS.
 *
 * We page all items (board has 100s) and filter client-side. Could
 * later switch to items_page_by_column_values for a Monday-side
 * filter once we know the column-filter cost vs full-page tradeoff.
 */

import { mondayQuery } from "../monday";

export const SUBSCRIPTION_BOARD_ID = 18407459988;

// Column ids on the Subscription Board.
export const SUB_DVS_COL = {
  primary_insurance:  "color_mm254qxj",
  subscription_type:  "color_mm273mv8",
  // Patient Status (Active / Paused / Not Active). Used to exclude
  // paused patients from the DVS queue — same happy-path rule as
  // Order Prep: paused patients live in their own bucket, they shouldn't
  // clutter views that are about taking action now.
  patient_status:     "color_mm2t7tdy",
  phone:              "phone_mkp0q3cw",
  next_order:         "date_mkp0nvf1",  // verified 2026-06-10 — was date_mkwr7spz which doesn't exist; every row's nextOrderDate was empty so the 'today-or-earlier' filter dropped them all
  trigger_dvs:        "color_mm2narpj",
  claims_status:      "color_mm2n5rkg",
  claim_paid_amount:  "text_mm2nxwze",
  claim_paid_date:    "date_mm2nr2vz",
  first_denied_date:  "date_mm2nzgeg",
  retry_count:        "numeric_mm2nckkb",
  last_attempted:     "date_mm2nrrfs",
  retry_next_date:    "date_mm2nffhc",
  denial_reason:      "long_text_mm2nf5b1",
  a4232_claim:        "text_mm2nmrjt",
  a4230_claim:        "text_mm2nfyyw",
  claims_error:       "text_mm2nj16f",
  claims_denial:      "text_mm2nvf5d",
} as const;

const READ_COLUMN_IDS = Object.values(SUB_DVS_COL);

export type DvsTriggerLabel =
  | ""                  // never triggered
  | "Trigger DVS"
  | "Running"
  | "Success"
  | "Failed"
  | "MLTC"
  | "Manual Review"
  | "Retry Queued";

export type ClaimsStatusLabel =
  | ""
  | "Payment Incorrect"
  | "Submit Claims"
  | "Claims Running"
  | "Claims Paid"
  | "Claims Denied"
  | "Claims Error";

export interface DvsRow {
  id: string;                 // Monday item id
  name: string;
  phone: string;
  nextOrderDate: string;      // YYYY-MM-DD
  primaryInsurance: string;   // raw label
  subscriptionType: string;
  patientStatus:    string;
  triggerDvs: DvsTriggerLabel;
  claimsStatus: ClaimsStatusLabel;
  claimPaidAmount: string;
  claimPaidDate: string;
  firstDeniedDate: string;
  retryCount: number;
  lastAttempted: string;
  retryNextDate: string;
  denialReason: string;
  a4232Claim: string;
  a4230Claim: string;
  claimsError: string;
  claimsDenialReason: string;
}

interface ColumnValue { id: string; text: string }
interface MondayItem {
  id: string;
  name: string;
  column_values: ColumnValue[];
}
interface PageResponse {
  boards: Array<{
    items_page: { cursor: string | null; items: MondayItem[] };
  }>;
}
interface NextPageResponse {
  next_items_page: { cursor: string | null; items: MondayItem[] };
}

const PAGE_QUERY = `
  query DvsFirstPage($boardId: ID!, $cols: [String!]!) {
    boards(ids: [$boardId]) {
      items_page(limit: 500) {
        cursor
        items {
          id
          name
          column_values(ids: $cols) { id text }
        }
      }
    }
  }
`;
const NEXT_QUERY = `
  query DvsNextPage($cursor: String!, $cols: [String!]!) {
    next_items_page(cursor: $cursor, limit: 500) {
      cursor
      items {
        id
        name
        column_values(ids: $cols) { id text }
      }
    }
  }
`;

function get(item: MondayItem, colId: string): string {
  return (item.column_values.find((c) => c.id === colId)?.text ?? "").trim();
}
function num(item: MondayItem, colId: string): number {
  const s = get(item, colId);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function mapItem(item: MondayItem): DvsRow {
  return {
    id: item.id,
    name: item.name,
    phone:               get(item, SUB_DVS_COL.phone),
    nextOrderDate:       get(item, SUB_DVS_COL.next_order),
    primaryInsurance:    get(item, SUB_DVS_COL.primary_insurance),
    subscriptionType:    get(item, SUB_DVS_COL.subscription_type),
    patientStatus:       get(item, SUB_DVS_COL.patient_status),
    triggerDvs:          (get(item, SUB_DVS_COL.trigger_dvs) || "") as DvsTriggerLabel,
    claimsStatus:        (get(item, SUB_DVS_COL.claims_status) || "") as ClaimsStatusLabel,
    claimPaidAmount:     get(item, SUB_DVS_COL.claim_paid_amount),
    claimPaidDate:       get(item, SUB_DVS_COL.claim_paid_date),
    firstDeniedDate:     get(item, SUB_DVS_COL.first_denied_date),
    retryCount:          num(item, SUB_DVS_COL.retry_count),
    lastAttempted:       get(item, SUB_DVS_COL.last_attempted),
    retryNextDate:       get(item, SUB_DVS_COL.retry_next_date),
    denialReason:        get(item, SUB_DVS_COL.denial_reason),
    a4232Claim:          get(item, SUB_DVS_COL.a4232_claim),
    a4230Claim:          get(item, SUB_DVS_COL.a4230_claim),
    claimsError:         get(item, SUB_DVS_COL.claims_error),
    claimsDenialReason:  get(item, SUB_DVS_COL.claims_denial),
  };
}

/**
 * Fetch all DVS-eligible patients from the Subscription Board.
 * Filter: Primary Insurance === 'Medicaid' AND subscription type !== 'Sensors'.
 */
export async function fetchDvsPatients(): Promise<DvsRow[]> {
  const out: DvsRow[] = [];

  let resp = await mondayQuery<PageResponse>(PAGE_QUERY, {
    boardId: String(SUBSCRIPTION_BOARD_ID),
    cols: READ_COLUMN_IDS,
  });
  let items = resp.boards[0]?.items_page?.items ?? [];
  let cursor = resp.boards[0]?.items_page?.cursor ?? null;
  for (const item of items) out.push(mapItem(item));

  while (cursor) {
    const next = await mondayQuery<NextPageResponse>(NEXT_QUERY, {
      cursor,
      cols: READ_COLUMN_IDS,
    });
    items = next.next_items_page?.items ?? [];
    cursor = next.next_items_page?.cursor ?? null;
    for (const item of items) out.push(mapItem(item));
  }

  return out.filter((p) =>
    p.primaryInsurance === "Medicaid" &&
    p.subscriptionType !== "Sensors" &&
    // Paused patients have their own bucket on Order Cycle; DVS view
    // is for take-action-now rows, so they shouldn't appear here either.
    p.patientStatus !== "Paused",
  );
}
