// Query: every item on the Claims Board, mapped to the rich `Claim` shape
// used by pages/Claims.tsx (Primary Board) and pages/ClaimDetail.tsx.
//
// Filters out terminal/pre-submission statuses ("Future Claim",
// "Not Started Yet", "Submit Claim") which belong to other views, and
// "Bad Debt" (terminal write-off). Includes everything else so the
// existing client-side category filters (ERA Review / Late / Denied /
// Outstanding / Paid / All) can work.

import { mondayQuery, CLAIMS_BOARD_ID } from "../monday";
import type {
  Claim,
  ServiceLine,
  PrimaryStatus,
  Status277,
  ClaimStatusCategory,
  DenialAnalysis,
} from "@/lib/claims/types";

// ---------- column id reference (parent board) ----------
// Source: MONDAY_BOARD_SCHEMA.md. Re-run scripts/refresh-monday-schema.sh if
// any of these column ids stop matching reality.

const COL = {
  DOB: "text_mkp3y5ax",
  MEMBER_ID: "text_mktat89m",
  PRIMARY_PAYOR: "color_mkxmhypt",
  SECONDARY_PAYER: "color_mkxq1a2p",
  SECONDARY_ID: "text_mkxwcqfy",
  DOS: "date_mkwr7spz",
  CLAIM_SENT_DATE: "date_mm14rk8d",
  // The EFT effective date written by the Stedi-Monday backend from the
  // 835 BPR segment (check_issue_or_eft_effective_date_16). This is the
  // ground truth for "when does the money hit the bank".
  PRIMARY_PAID_DATE: "date_mm11zg2f",
  CLAIM_ID: "text_mm1zpzrs",
  PAYER_CLAIM_NUMBER: "text_mm2nfytt",
  PRIMARY_STATUS: "color_mkxmywtb",
  CLAIM_TYPE: "color_mm2nvk1p",
  PARENT_CLAIM_ID: "text_mm3559h4",
  DIAGNOSIS: "color_mky2gpz5",
  PRIMARY_PAID: "numeric_mm115q76",
  PR_AMOUNT: "numeric_mkxmc2rh",
  NOTES: "long_text_mkzrx7ke",
  NEXT_ACTION_DATE: "date_mkxpynj",
  S277_STATUS: "color_mm1z1pb2",
  S277_REJECTED_REASON: "text_mm1zsp2x",
  CLAIM_STATUS_CATEGORY: "color_mm2qbcpy",
  CLAIM_STATUS_DETAIL: "long_text_mm2qapj6",
  LAST_CLAIM_STATUS_CHECK: "date_mm2qrazz",
  RAW_ERA_DATE: "text_mm2047g9",
  RAW_ERA_CLAIM_STATUS: "text_mm20k1zv",
} as const;

// ---------- subitem column id reference ----------

const SUB_COL = {
  HCPC: "color_mm1cdvq8",
  MODIFIERS: "dropdown_mm1z7je9",
  PAYMENT_STATUS: "color_mm35f2e7",
  ORDER_QTY: "numeric_mm1czbyg",
  CLAIM_QTY: "numeric_mm20r76b",
  CHARGE_AMOUNT: "numeric_mm1za8v5",
  EST_PAY: "numeric_mm1zspsy",
  PRIMARY_PAID: "numeric_mm11v6th",
  RAW_ALLOWED: "numeric_mm1gtdts",
  RAW_PAID: "numeric_mm201t4y",
  // Parsed-from-ERA columns the Stedi backend writes per service line.
  // Used to populate the Patient Responsibility / CO / OA / PI breakdown
  // on the Review ERA detail view.
  PARSED_COINSURANCE: "numeric_mm11aqr1",
  PARSED_DEDUCTIBLE: "numeric_mm1g3nvh",
  PARSED_COPAY: "numeric_mm1gtd3e",
  PARSED_PR: "numeric_mm1gredn",
  PARSED_CO: "numeric_mm1gken",
  PARSED_OA: "numeric_mm1gh22d",
  PARSED_PI: "numeric_mm1gqkvz",
  PARSED_ADJUSTMENT_CODES: "dropdown_mm2p2pr3",
  PARSED_ADJUSTMENT_REASONS: "long_text_mm1g7xmy",
  CARC: "dropdown_mm2pthcy",
  RARC: "dropdown_mm2pjdcf",
  DENIAL_ANALYSIS: "color_mm2ppwry",
  LINK_TO_ORIGINAL: "text_mm35d81y",
} as const;

// ---------- HCPCS → product label ----------
// HCPC code is authoritative for the product category. Monday subitem names
// drift (sometimes "Cartridge" vs "Cartridges", sometimes "Infusion Set" on
// an A4225 row); the HCPC code is the source of truth.
const HCPC_TO_PRODUCT: Record<string, string> = {
  // Infusion sets
  A4224: "Infusion Sets",
  A4230: "Infusion Sets",
  A4231: "Infusion Sets",
  // Cartridges / reservoirs for the pump
  A4225: "Cartridges",
  A4232: "Cartridges",
  // CGM
  A4239: "CGM Sensors",
  E2103: "CGM Monitor",
  // Pump itself
  E0784: "Insulin Pump",
};

// ---------- GraphQL ----------

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
    items_page: { cursor: string | null; items: MondayItem[] };
  }>;
  next?: { cursor: string | null; items: MondayItem[] };
}

// Only request the columns we actually map. The board has ~66 parent columns
// and ~54 subitem columns; we use ~21+16. Restricting projection cuts the
// response size 3-4× and the API responds noticeably faster.
const PARENT_COLUMN_IDS = Object.values(COL)
  .map((id) => `"${id}"`)
  .join(", ");
const SUBITEM_COLUMN_IDS = Object.values(SUB_COL)
  .map((id) => `"${id}"`)
  .join(", ");

const PAGE_QUERY = `
  query AllClaims($cursor: String) {
    boards(ids: [${CLAIMS_BOARD_ID}]) {
      items_page(limit: 500, cursor: $cursor) {
        cursor
        items {
          id
          name
          created_at
          column_values(ids: [${PARENT_COLUMN_IDS}]) {
            id
            text
            value
            type
          }
          subitems {
            id
            name
            column_values(ids: [${SUBITEM_COLUMN_IDS}]) {
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

// ---------- mapping helpers ----------

function col(item: { column_values: MondayColumnValue[] }, id: string) {
  return item.column_values.find((c) => c.id === id);
}

function txt(item: { column_values: MondayColumnValue[] }, id: string): string {
  return col(item, id)?.text?.trim() || "";
}

function num(item: { column_values: MondayColumnValue[] }, id: string): number {
  const t = txt(item, id);
  if (!t) return 0;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function arr(item: { column_values: MondayColumnValue[] }, id: string): string[] {
  const t = txt(item, id);
  if (!t) return [];
  return t
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isoOrNull(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Coerce Monday's Primary status label into the widened PrimaryStatus type. */
function mapPrimaryStatus(label: string): PrimaryStatus {
  const t = label.trim();
  // Normalize Monday's lowercase-r "Request rejected"
  if (t.toLowerCase() === "request rejected") return "Request Rejected";
  // Trust the rest (the type now includes every Monday Primary label).
  if (
    [
      "Submit Claim",
      "Submitted",
      "Outstanding",
      "Late",
      "Review",
      "Appeals",
      "Paid",
      "Denied (Or Partly)",
      "Bad Debt",
      "Future Claim",
      "Not Started Yet",
    ].includes(t)
  ) {
    return t as PrimaryStatus;
  }
  // Default for empty / unknown — treat as Outstanding so the row is visible
  // somewhere instead of silently vanishing.
  return "Outstanding";
}

function mapStatus277(label: string): Status277 {
  switch (label.trim()) {
    case "Payer Accepted":
      return "Payer Accepted";
    case "Stedi Accepted":
      return "Stedi Accepted";
    case "Payer Rejected":
      return "Payer Rejected";
    case "Stedi Rejected":
      return "Stedi Rejected";
    default:
      return null;
  }
}

function mapClaimStatusCategory(label: string): ClaimStatusCategory {
  const t = label.trim();
  if (
    [
      "Paid",
      "Denied",
      "Pending",
      "In Process",
      "Requests Info",
      "No Match",
      "Error",
    ].includes(t)
  ) {
    return t as ClaimStatusCategory;
  }
  return null;
}

function mapDenialAnalysis(label: string): DenialAnalysis {
  const t = label.trim();
  // Mapping from Monday's Denial Analysis labels (18 values) to the frontend's
  // shorter enum (~12). Monday is more granular; collapse where needed.
  const map: Record<string, NonNullable<DenialAnalysis>> = {
    "No auth": "No Auth",
    "Wrong modifiers": "Wrong Modifiers",
    "SoS (units/frequency)": "Units / Frequency",
    "Invalid dx code": "Invalid Diagnosis Code",
    "Docs required": "Documentation Required",
    "Pump/monitor not on file": "Pump / Monitor Not on File",
    "Inpatient / SNF / Hospice": "Inpatient / SNF / Hospice",
    "Inactive coverage": "Inactive Coverage",
    "Timely filing": "Timely Filing",
    "Duplicate claim": "Duplicate Claim",
    "Wrong payer": "Wrong Payer",
    "Other / Review": "Other / Needs Review",
  };
  return map[t] ?? null;
}

/** Returns the product label for a known HCPC, or empty string when unmapped. */
function productFromHcpc(hcpc: string): string {
  return HCPC_TO_PRODUCT[hcpc.toUpperCase()] ?? "";
}

// ---------- subitem mapper ----------

function mapSubitemToLine(sub: MondaySubitem): ServiceLine {
  const hcpc = txt(sub, SUB_COL.HCPC);
  const primaryPaid = num(sub, SUB_COL.PRIMARY_PAID) || num(sub, SUB_COL.RAW_PAID);
  const allowed = num(sub, SUB_COL.RAW_ALLOWED);
  // Patient-responsibility breakdown, populated by the Stedi ERA parser
  // into discrete numeric columns on each subitem.
  const coinsurance = num(sub, SUB_COL.PARSED_COINSURANCE);
  const deductible = num(sub, SUB_COL.PARSED_DEDUCTIBLE);
  const copay = num(sub, SUB_COL.PARSED_COPAY);
  const prAmount = num(sub, SUB_COL.PARSED_PR);
  const coAmount = num(sub, SUB_COL.PARSED_CO);
  const oaAmount = num(sub, SUB_COL.PARSED_OA);
  const piAmount = num(sub, SUB_COL.PARSED_PI);
  const carcCodes = arr(sub, SUB_COL.CARC);
  const rarcCodes = arr(sub, SUB_COL.RARC);
  const adjustmentReasons = arr(sub, SUB_COL.PARSED_ADJUSTMENT_REASONS);
  // HCPC code is authoritative — the data team's subitem names drift, but
  // the HCPC column is a controlled status field. Fall back to subitem name
  // only when the HCPC code is missing or unrecognized.
  const product = productFromHcpc(hcpc) || sub.name?.trim() || hcpc;
  return {
    id: sub.id,
    product,
    hcpcs: hcpc || sub.name,
    modifiers: arr(sub, SUB_COL.MODIFIERS),
    units: num(sub, SUB_COL.CLAIM_QTY) || num(sub, SUB_COL.ORDER_QTY),
    charge: num(sub, SUB_COL.CHARGE_AMOUNT),
    estPay: num(sub, SUB_COL.EST_PAY),
    primaryPaid,
    allowed,
    deductible,
    coinsurance,
    copay,
    // Total patient responsibility — what the patient owes. Prefer the
    // explicit Parsed PR Amount when set; fall back to the sum of its
    // components so the field is meaningful even on older claims where
    // the rollup column wasn't populated.
    patientResponsibility: prAmount || coinsurance + deductible + copay,
    carc: carcCodes,
    rarc: rarcCodes,
    adjustmentReasons,
    remarkText: [],
    denialAnalysis: mapDenialAnalysis(txt(sub, SUB_COL.DENIAL_ANALYSIS)),
    coAmount,
    prAmount,
    oaAmount,
    piAmount,
  };
}

// ---------- parent item mapper ----------

export function mapMondayItemToClaim(item: MondayItem): Claim {
  const lines = (item.subitems ?? []).map(mapSubitemToLine);
  // Prefer the parent Primary Paid (A) column when set, otherwise fall back
  // to summing each subitem's Primary Paid. The Monday data team enters this
  // inconsistently — Review-status claims fill the parent, Paid-status
  // claims often only fill subitems.
  const parentPrimaryPaid = num(item, COL.PRIMARY_PAID);
  const subitemPrimaryPaidSum = lines.reduce((sum, l) => sum + l.primaryPaid, 0);
  const primaryPaid = parentPrimaryPaid || subitemPrimaryPaidSum;
  const prAmount = num(item, COL.PR_AMOUNT);
  const estPay = lines.reduce((sum, l) => sum + l.estPay, 0);
  const rawEraDate = isoOrNull(txt(item, COL.RAW_ERA_DATE));

  return {
    id: txt(item, COL.CLAIM_ID) || item.id,
    mondayItemId: item.id,
    patientName: item.name,
    dob: txt(item, COL.DOB),
    dos: isoOrNull(txt(item, COL.DOS)) ?? "",
    primaryPayor: txt(item, COL.PRIMARY_PAYOR),
    insuranceType: "", // not currently tracked as a separate Monday column
    memberId: txt(item, COL.MEMBER_ID),
    claimSentDate: isoOrNull(txt(item, COL.CLAIM_SENT_DATE)),
    primaryStatus: mapPrimaryStatus(txt(item, COL.PRIMARY_STATUS)),
    status277: mapStatus277(txt(item, COL.S277_STATUS)),
    rejected277Reason: txt(item, COL.S277_REJECTED_REASON) || null,
    claimStatusCategory: mapClaimStatusCategory(
      txt(item, COL.CLAIM_STATUS_CATEGORY),
    ),
    claimStatusDetail: txt(item, COL.CLAIM_STATUS_DETAIL) || null,
    lastClaimStatusCheck: isoOrNull(txt(item, COL.LAST_CLAIM_STATUS_CHECK)),
    claimId: txt(item, COL.CLAIM_ID),
    payerClaimNumber: txt(item, COL.PAYER_CLAIM_NUMBER) || null,
    estPay,
    primaryPaid,
    prAmount,
    rawEraDate,
    rawEraClaimStatus: txt(item, COL.RAW_ERA_CLAIM_STATUS) || null,
    // From the BPR effective date — when the money actually hits our bank.
    // Populated by the Stedi-Monday backend for every ERA received.
    primaryPaidDate: isoOrNull(txt(item, COL.PRIMARY_PAID_DATE)),
    secondaryPayer: txt(item, COL.SECONDARY_PAYER) || null,
    denialAction: null,
    nextActionDate: isoOrNull(txt(item, COL.NEXT_ACTION_DATE)),
    notes: txt(item, COL.NOTES) || undefined,
    activity: [],
    lines,
  };
}

// ---------- fetcher ----------

/**
 * Fetch every claim on the Claims Board, paginating until done.
 * Excludes terminal/pre-submission states (Submit Claim, Future Claim,
 * Not Started Yet) so the Primary Board only shows in-flight work.
 *
 * If you want the *full* set including pre-submission, set
 * `excludePreSubmission: false`.
 */
export async function fetchAllClaims(opts?: {
  excludePreSubmission?: boolean;
}): Promise<Claim[]> {
  const excludePreSubmission = opts?.excludePreSubmission ?? true;
  let cursor: string | null = null;
  const all: Claim[] = [];
  // Pagination loop. items_page returns cursor=null when there's no next page.
  do {
    const data = await mondayQuery<QueryResponse>(PAGE_QUERY, { cursor });
    const page = data.boards[0]?.items_page;
    const items = page?.items ?? [];
    for (const item of items) {
      all.push(mapMondayItemToClaim(item));
    }
    cursor = page?.cursor ?? null;
  } while (cursor);

  if (!excludePreSubmission) return all;

  const exclude = new Set<PrimaryStatus>([
    "Submit Claim",
    "Future Claim",
    "Not Started Yet",
  ]);
  return all.filter((c) => !exclude.has(c.primaryStatus));
}
