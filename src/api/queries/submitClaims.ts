// Query: claims that are awaiting submission (Primary status = "Submit Claim").
// Maps Monday item shape to the ThreadClaim shape used by PrimarySubmitBoard.
//
// Column ID reference is sourced from MONDAY_BOARD_SCHEMA.md (see
// scripts/refresh-monday-schema.sh). If the board ever changes column IDs
// or status label indices, regenerate that file and update the constants
// in this module.

import { mondayQuery, CLAIMS_BOARD_ID } from "../monday";
import type {
  ThreadClaim,
  ThreadClaimType,
  ThreadItem,
  ItemStatus,
} from "@/lib/claims/threads";

// Column IDs on the Claims Board (parent items). See MONDAY_BOARD_SCHEMA.md.
const COL = {
  PRIMARY_STATUS: "color_mkxmywtb",
  CLAIM_TYPE: "color_mm2nvk1p",
  PRIMARY_PAYOR: "color_mkxmhypt",
  DIAGNOSIS: "color_mky2gpz5",
  DOS: "date_mkwr7spz",
  DOB: "text_mkp3y5ax",
  MEMBER_ID: "text_mktat89m",
  PARENT_CLAIM_ID: "text_mm3559h4",
  CLAIM_ID: "text_mm1zpzrs",
  PAYER_CLAIM_NUMBER: "text_mm2nfytt",
} as const;

// Column IDs on the Subitems board. See MONDAY_BOARD_SCHEMA.md.
const SUB_COL = {
  HCPC: "color_mm1cdvq8",
  MODIFIERS: "dropdown_mm1z7je9",
  PAYMENT_STATUS: "color_mm35f2e7",
  CLAIM_QTY: "numeric_mm20r76b",
  CHARGE_AMOUNT: "numeric_mm1za8v5",
  EST_PAY: "numeric_mm1zspsy",
  PRIMARY_PAID: "numeric_mm11v6th",
  CARC: "dropdown_mm2pthcy",
  RARC: "dropdown_mm2pjdcf",
  DENIAL_ANALYSIS: "color_mm2ppwry",
  LINK_TO_ORIGINAL: "text_mm35d81y",
} as const;

// Status label index for "Submit Claim" on the Primary column. The Monday
// items_page query_params filter operates on numeric label index for status
// columns. If a label is renamed/re-indexed, refresh the schema and update.
const SUBMIT_CLAIM_LABEL_INDEX = 6;

interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
  type: string;
}

interface MondaySubitem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}

interface MondayItem {
  id: string;
  name: string;
  created_at: string;
  column_values: MondayColumnValue[];
  subitems: MondaySubitem[] | null;
}

interface QueryResponse {
  boards: Array<{
    items_page: {
      cursor: string | null;
      items: MondayItem[];
    };
  }>;
}

// Monday's `compare_value` is a polymorphic scalar that doesn't bind cleanly
// through GraphQL variables, so we build the query string with the constants
// inlined. Constants are not user-controlled — they reference the schema —
// so no injection concern.
const QUERY = `
  query SubmitClaims {
    boards(ids: [${CLAIMS_BOARD_ID}]) {
      items_page(
        limit: 100
        query_params: {
          rules: [
            { column_id: "${COL.PRIMARY_STATUS}", compare_value: [${SUBMIT_CLAIM_LABEL_INDEX}], operator: any_of }
          ]
        }
      ) {
        cursor
        items {
          id
          name
          created_at
          column_values {
            id
            text
            value
            type
          }
          subitems {
            id
            name
            column_values {
              id
              text
              value
              type
            }
          }
        }
      }
    }
  }
`;

/** Look up a column value by column id. */
function col(item: { column_values: MondayColumnValue[] }, id: string) {
  return item.column_values.find((c) => c.id === id);
}

function textOf(item: { column_values: MondayColumnValue[] }, id: string): string {
  return col(item, id)?.text?.trim() || "";
}

function numberOf(
  item: { column_values: MondayColumnValue[] },
  id: string,
): number {
  const t = textOf(item, id);
  if (!t) return 0;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function modifiersOf(item: { column_values: MondayColumnValue[] }): string[] {
  const t = textOf(item, SUB_COL.MODIFIERS);
  if (!t) return [];
  return t
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Map Monday's Payment Status label to the frontend's ItemStatus enum.
 * Reference labels in MONDAY_BOARD_SCHEMA.md → `color_mm35f2e7`.
 */
function mapItemStatus(label: string): ItemStatus {
  switch (label.trim().toLowerCase()) {
    case "paid/done":
    case "paid":
    case "done":
      return "Paid/Done";
    case "denied/partial":
    case "denied":
      return "Denied";
    case "partial":
      return "Partial";
    case "pending follow-up":
    case "pending follow up":
      return "Pending Follow-up";
    default:
      return "Pending";
  }
}

function mapClaimType(label: string): ThreadClaimType {
  return label.trim().toLowerCase() === "corrected" ? "Corrected" : "Original";
}

function mapSubitem(sub: MondaySubitem): ThreadItem {
  const statusLabel = textOf(sub, SUB_COL.PAYMENT_STATUS);
  const hcpc = textOf(sub, SUB_COL.HCPC) || sub.name;
  return {
    id: sub.id,
    hcpc,
    modifiers: modifiersOf(sub),
    qty: numberOf(sub, SUB_COL.CLAIM_QTY),
    charge: numberOf(sub, SUB_COL.CHARGE_AMOUNT),
    est_pay: numberOf(sub, SUB_COL.EST_PAY),
    status: mapItemStatus(statusLabel),
    paid_amount: numberOf(sub, SUB_COL.PRIMARY_PAID),
    carc_codes: textOf(sub, SUB_COL.CARC) || undefined,
    rarc_codes: textOf(sub, SUB_COL.RARC) || undefined,
    denial_bucket: textOf(sub, SUB_COL.DENIAL_ANALYSIS) || undefined,
    linked_to_original_item_id: textOf(sub, SUB_COL.LINK_TO_ORIGINAL) || undefined,
  };
}

function mapItemToThreadClaim(item: MondayItem): ThreadClaim {
  const parentClaimId = textOf(item, COL.PARENT_CLAIM_ID);
  return {
    id: textOf(item, COL.CLAIM_ID) || item.id, // prefer Claim ID column when set
    type: mapClaimType(textOf(item, COL.CLAIM_TYPE)),
    // Everything fetched here is filtered to Primary=Submit Claim,
    // which corresponds to the frontend's "Awaiting Submission" state.
    status: "Awaiting Submission",
    patient: {
      name: item.name,
      dob: textOf(item, COL.DOB),
      member_id: textOf(item, COL.MEMBER_ID),
    },
    payer: textOf(item, COL.PRIMARY_PAYOR),
    diagnosis: textOf(item, COL.DIAGNOSIS) || undefined,
    dos: textOf(item, COL.DOS),
    icn: textOf(item, COL.PAYER_CLAIM_NUMBER) || undefined,
    parent_claim_id: parentClaimId || undefined,
    items: (item.subitems ?? []).map(mapSubitem),
    createdAt: new Date(item.created_at).getTime() || Date.now(),
  };
}

/**
 * Fetch all claims whose Primary status is "Submit Claim".
 * Includes both root claims (NEW CLAIMS bucket) and follow-ups (RESUBMIT).
 */
export async function fetchSubmitClaims(): Promise<ThreadClaim[]> {
  const data = await mondayQuery<QueryResponse>(QUERY);
  const items = data.boards[0]?.items_page?.items ?? [];
  return items.map(mapItemToThreadClaim);
}
