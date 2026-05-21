// Query: every item on the Secondary Claims Board, mapped to the SecClaim
// shape used by components/claims/SecondaryBoard.tsx.
//
// The Secondary board (id 18413019028) holds items spawned from the
// Primary board when an operator clicks Mark Paid. Spawn carries forward
// the patient + primary-snapshot data and pre-fills Submission Type
// (Forwarded / Insurance / Patient). The Stedi ERA writeback later
// populates Secondary Paid (A) etc. when the secondary payer's 835 arrives.
//
// The frontend doesn't use Monday's "Secondary Status" label verbatim —
// it derives a SecondaryStatus enum that drives bucketing
// (Insurance / Patient / Outstanding / ERA Review). Logic: ERA-arrived
// rows go to ERA Review; rest is routed by Submission Type when status
// is still "Submit", or by Monday status for downstream states.

import { mondayQuery, SECONDARY_BOARD_ID } from "../monday";
import type {
  SecClaim,
  SecLine,
  SecondaryStatus,
  PrReason,
} from "@/components/claims/SecondaryBoard";

// ---------- column id reference (parent) ----------

const COL = {
  DOB: "text_mkp3y5ax",
  SECONDARY_PAYER: "color_mkxq1a2p",
  // Two "Secondary Member ID" columns exist on this board — text_mm3a7ega is
  // the renamed one introduced after the schema cleanup. text_mkxwcqfy is
  // the legacy one inherited from the primary-board duplicate. Prefer the
  // new column; fall back to the legacy one when it's the only one filled.
  SECONDARY_MEMBER_ID: "text_mm3a7ega",
  SECONDARY_MEMBER_ID_LEGACY: "text_mkxwcqfy",
  PRIMARY_PAYOR: "color_mm3a93ek",
  PRIMARY_MEMBER_ID: "text_mktat89m",
  DOS: "date_mkwr7spz",
  CLAIM_SENT_DATE: "date_mm14rk8d",
  CLAIM_RESENT_DATE: "date_mm29scz",
  CLAIM_TYPE: "color_mm2nvk1p",
  DIAGNOSIS: "color_mky2gpz5",
  CUSTOMER_ORDER: "text_mkwzbcme",
  CLAIM_ID: "text_mm1zpzrs",
  PRIMARY_CLAIM_ID: "text_mm3atf1c",
  PARENT_CLAIM_ID: "text_mm3559h4",
  // Primary snapshot (copied from primary item during Mark Paid spawn)
  PRIMARY_PAID_AMOUNT: "numeric_mm3as81b",
  PRIMARY_PR_AMOUNT: "numeric_mm3ak2za",
  PRIMARY_PAID_DATE: "date_mm3a9bdm",
  FORWARDED_FROM_PRIMARY_DATE: "date_mm3a8h3a",
  PATIENT_BILLED_DATE: "date_mm3avzpm",
  // Secondary ERA outputs (written by stedi-monday-integration writeback).
  // SECONDARY_PAID_DATE = date_mm11zg2f (the "(D)" column) is what the
  // backend's ERA_PARENT_COLUMN_MAP populates. date_mm3apmee is the
  // operator-entered alternate; we don't read that for cash flow.
  SECONDARY_PAID_AMOUNT: "numeric_mm115q76", // "Secondary Paid (A)"
  SECONDARY_PAID_DATE: "date_mm11zg2f",       // "Secondary Paid Date (D)"
  SECONDARY_ICN: "text_mm2nfytt",             // "Payer Claim Number"
  CHECK_NUMBER: "text_mm11m3fh",
  RAW_ERA_DATE: "text_mm2047g9",
  RAW_ERA_CLAIM_STATUS: "text_mm20k1zv",
  RAW_TOTAL_CHARGE: "numeric_mm1ghydj",
  // Exact secondary payer name from the 835 N1 (PR) loop — populated by
  // services/secondary_era_writeback.py when an ERA arrives. The status
  // column above only carries a small set of predefined labels; this
  // is the true payer name (e.g. "AARP SUPPLEMENTAL HEALTH PLANS FROM
  // UNITEDHEALTHCARE") for display.
  SECONDARY_PAYER_RAW_NAME: "text_mm3a2yax",
  // Bank deposit reconciliation — secondary board column IDs differ
  // from the primary board (the columns were created independently on
  // each board, and Monday assigns new IDs per board).
  BANK_DEPOSIT_TOTAL: "numeric_mm3js9d0",
  BANK_PAYMENT_METHOD: "color_mm3jpg86",
  BANK_PAYER_ORIG_ID: "text_mm3jz59k",
  BANK_EFT_DATE: "date_mm3jq5zk",
  // Remittance Trace Number (TRN segment of the 835). Reused from the
  // existing raw_remittance_trace column on the duplicated board —
  // same id as primary because the column was inherited at board
  // duplication time. Surfaced as "Trace # (TRN)" in the Bank Info
  // strip because that's the universal identifier visible in the
  // bank's ACH addenda for PayPlus/ECHO-mediated payments (the BPR
  // payer originator id is the underlying payer, not the processor
  // that actually shows up in Chase).
  RAW_REMITTANCE_TRACE: "text_mm1gz8ss",
  // Workflow
  SUBMISSION_TYPE: "color_mm3awg8g",
  SECONDARY_STATUS: "color_mm3a5yak",
  // Payor Confirmed — Yes once the operator has reviewed in the Confirm
  // Payor tab. Forwarded crossovers auto-confirm at spawn.
  PAYOR_CONFIRMED: "color_mm3bhy6m",
  DAYS_OUTSTANDING: "color_mm29awe7",
  NOTES: "long_text_mkzrx7ke",
  NEXT_ACTION_DATE: "date_mkxpynj",
} as const;

// ---------- subitem column ids (secondary subitem board) ----------

const SUB_COL = {
  HCPC: "color_mm1cdvq8",
  MODIFIERS: "dropdown_mm1z7je9",
  ORDER_QTY: "numeric_mm1czbyg",
  CLAIM_QTY: "numeric_mm20r76b",
  CHARGE_AMOUNT: "numeric_mm1za8v5",
  EST_PAY: "numeric_mm1zspsy",
  // Primary snapshot (per line) — copied from the original primary subitem
  PRIMARY_PAID_LINE: "numeric_mm3az8d",
  // Secondary ERA outputs
  SECONDARY_PAID_LINE: "numeric_mm11v6th",     // "Secondary Paid (line)"
  SECONDARY_PAID_DATE_LINE: "date_mm11sjph",
  SECONDARY_CHECK_NUMBER: "text_mm11ex1z",
  // PR breakdown
  PARSED_COINSURANCE: "numeric_mm11aqr1",
  PARSED_DEDUCTIBLE: "numeric_mm1g3nvh",
  PARSED_COPAY: "numeric_mm1gtd3e",
  PARSED_PR: "numeric_mm1gredn",
  PARSED_CO: "numeric_mm1gken",
  PARSED_OA: "numeric_mm1gh22d",
  PARSED_PI: "numeric_mm1gqkvz",
  CARC: "dropdown_mm2pthcy",
  RARC: "dropdown_mm2pjdcf",
  DENIAL_ANALYSIS: "color_mm2ppwry",
} as const;

// ---------- HCPC → product label (same map as primary) ----------

const HCPC_TO_PRODUCT: Record<string, string> = {
  A4224: "Infusion Sets",
  A4230: "Infusion Sets",
  A4231: "Infusion Sets",
  A4225: "Cartridges",
  A4232: "Cartridges",
  A4239: "CGM Sensors",
  E2103: "CGM Monitor",
  E0784: "Insulin Pump",
};

// ---------- GraphQL types ----------

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
}

const PARENT_COLUMN_IDS = Object.values(COL)
  .map((id) => `"${id}"`)
  .join(", ");
const SUBITEM_COLUMN_IDS = Object.values(SUB_COL)
  .map((id) => `"${id}"`)
  .join(", ");

const PAGE_QUERY = `
  query AllSecondaryClaims($cursor: String) {
    boards(ids: [${SECONDARY_BOARD_ID}]) {
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

// ---------- helpers ----------

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
function isoDateOrEmpty(value: string): string {
  if (!value) return "";
  // Monday returns dates as YYYY-MM-DD already; date_columns surface that
  // in `text`. Just normalize and return.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}
function productFromHcpc(hcpc: string): string {
  return HCPC_TO_PRODUCT[hcpc.toUpperCase()] ?? "";
}

// ---------- status derivation ----------

/**
 * Decide which SecondaryStatus a row should occupy based on Monday columns.
 *
 * Priority order:
 *   1. Secondary ERA arrived (paid amount > 0 or ERA date set) -> ERA Review
 *   2. Monday Secondary Status maps to a terminal/late state -> use it
 *   3. Otherwise route by Submission Type when status is still "Submit"
 */
function deriveStatus(
  submissionType: string,
  secondaryStatus: string,
  secondaryPaidAmount: number,
  rawEraDate: string,
  payorConfirmed: boolean,
): SecondaryStatus {
  const hasEra = secondaryPaidAmount > 0 || !!rawEraDate;
  if (hasEra) return "Secondary ERA Received";

  // Pre-confirmation: operator hasn't reviewed in the Confirm Payor tab.
  // Forwarded auto-confirms at spawn, so this branch only catches
  // Insurance/Patient items awaiting human delegation.
  if (!payorConfirmed && submissionType !== "Forwarded") {
    return "Awaiting Payor Confirmation";
  }

  switch (secondaryStatus) {
    case "Forwarded":
      // Backend spawns Forwarded-type secondaries at this status. Don't
      // care about Submission Type at this point — Forwarded means
      // "waiting for the crossover ERA from Medigap." Goes in Outstanding.
      return "Primary Paid - Forwarded";
    case "Submitted":
      return "Secondary Submitted";
    case "Paid":
      return "Secondary Paid";
    case "Sent to Patient":
      return "Sent to Patient";
    case "Patient Paid":
      return "Patient Paid";
    case "Bad Debt":
      return "Bad Debt";
    default:
      // status is "Submit", "Outstanding", "Late", "Review" — route
      // by Submission Type. Insurance + Patient types spawn at "Submit"
      // because they need operator review before any action; Forwarded
      // never lands here anymore (the case above catches it first).
      switch (submissionType) {
        case "Insurance":
          return "Primary Paid - Submit Secondary";
        case "Patient":
          return "Sent to Patient";
        case "Forwarded":
        default:
          return "Primary Paid - Forwarded";
      }
  }
}

function derivePrReason(
  coinsurance: number,
  deductible: number,
  copay: number,
): PrReason | undefined {
  if (deductible > 0 && deductible >= coinsurance && deductible >= copay)
    return "Deductible";
  if (coinsurance > 0) return "Coinsurance";
  if (copay > 0) return "Copay";
  return undefined;
}

// ---------- mappers ----------

function mapSubitem(sub: MondaySubitem, hasSecondaryEra: boolean): SecLine {
  const hcpc = txt(sub, SUB_COL.HCPC);
  const product = productFromHcpc(hcpc) || sub.name?.trim() || hcpc;
  const primaryPaid = num(sub, SUB_COL.PRIMARY_PAID_LINE);
  const charge = num(sub, SUB_COL.CHARGE_AMOUNT);
  const coinsurance = num(sub, SUB_COL.PARSED_COINSURANCE);
  const deductible = num(sub, SUB_COL.PARSED_DEDUCTIBLE);
  const copay = num(sub, SUB_COL.PARSED_COPAY);
  const pr = num(sub, SUB_COL.PARSED_PR);

  // "Primary adjustment" — what the primary withheld on this line.
  // Best derived from the difference: charge - primaryPaid - PR.
  // Anything negative collapses to 0 (some lines are paid in full).
  const primaryAdj = Math.max(charge - primaryPaid - pr, 0);

  // Patient share remaining after primary settles — what the secondary
  // is on the hook for. Same shape the mock data uses.
  const remaining = pr || coinsurance + deductible + copay;

  // hasLineEra distinguishes "this column is genuinely blank on Monday"
  // (Medicare-supplement CLP-only ERAs that never report per-line paid
  // amounts) from "the column read \$0" (line truly paid zero). We need
  // the distinction because the UI's Denied state is gated on
  // linePaid === 0; without it every CLP-only line would be flagged as
  // Denied. The check is on the raw text — num() coalesces blank to 0.
  const lineEraRaw = txt(sub, SUB_COL.SECONDARY_PAID_LINE);
  const hasLineEra = hasSecondaryEra && lineEraRaw !== "";
  const secondaryPaid = num(sub, SUB_COL.SECONDARY_PAID_LINE);
  const oaAmount = num(sub, SUB_COL.PARSED_OA);
  // Patient responsibility AFTER the secondary settles — only meaningful
  // when an ERA has actually arrived. We approximate as PR-coinsurance/
  // deductible/copay minus the secondary's contribution; bound at 0.
  const patientResp = hasLineEra
    ? Math.max(remaining - secondaryPaid, 0)
    : undefined;

  return {
    id: sub.id,
    product,
    hcpcs: hcpc || sub.name,
    modifiers: arr(sub, SUB_COL.MODIFIERS),
    charge,
    primaryPaid,
    primaryAdj,
    remaining,
    coinsuranceCopay: coinsurance + copay,
    deductible,
    secondaryPaid: hasLineEra ? secondaryPaid : undefined,
    secondaryAdj: hasLineEra ? Math.max(remaining - secondaryPaid - (patientResp ?? 0), 0) : undefined,
    patientResp,
    status: hasLineEra
      ? secondaryPaid > 0
        ? "Paid"
        : "Denied/Partial"
      : "Pending",
  };
}

export function mapMondayItemToSecClaim(item: MondayItem): SecClaim {
  const submissionType = txt(item, COL.SUBMISSION_TYPE);
  const secondaryStatus = txt(item, COL.SECONDARY_STATUS);
  const secondaryPaidAmount = num(item, COL.SECONDARY_PAID_AMOUNT);
  const rawEraDate = txt(item, COL.RAW_ERA_DATE);
  const payorConfirmed = txt(item, COL.PAYOR_CONFIRMED) === "Yes";
  const status = deriveStatus(
    submissionType,
    secondaryStatus,
    secondaryPaidAmount,
    rawEraDate,
    payorConfirmed,
  );
  const hasSecondaryEra = status === "Secondary ERA Received" ||
    status === "Secondary Paid";

  const lines = (item.subitems ?? []).map((s) => mapSubitem(s, hasSecondaryEra));

  // Aggregate amounts. Prefer parent columns; fall back to subitem sums.
  const primaryPaid = num(item, COL.PRIMARY_PAID_AMOUNT) ||
    lines.reduce((s, l) => s + l.primaryPaid, 0);
  const primaryAdj = lines.reduce((s, l) => s + l.primaryAdj, 0);
  // "Remaining" at the claim level = what the secondary owes after primary.
  // = sum of line-level PR (when set) else coinsurance+deductible+copay.
  const remaining = num(item, COL.PRIMARY_PR_AMOUNT) ||
    lines.reduce((s, l) => s + l.remaining, 0);

  const claimLevelDeductible = lines.reduce((s, l) => s + (l.deductible ?? 0), 0);

  // Secondary payer name: take the Secondary Payer status label, fall back
  // to "—" for blank.
  const secondaryPayerLabel = txt(item, COL.SECONDARY_PAYER);
  // "Medicare Suppl." is a sentinel the backend writes for Forwarded
  // crossovers when the real supplemental payer name isn't known until
  // the ERA arrives. Display it as-is — once the ERA lands, the writeback
  // overwrites this column with the actual payer name.

  // Prefer the renamed Secondary Member ID column when set; fall back to
  // the legacy duplicated-from-primary column.
  const secondaryMemberId =
    txt(item, COL.SECONDARY_MEMBER_ID) ||
    txt(item, COL.SECONDARY_MEMBER_ID_LEGACY);

  const claimTypeLabel = txt(item, COL.CLAIM_TYPE);
  const claimType: SecClaim["type"] =
    claimTypeLabel === "Corrected" ? "Corrected" : "Original";

  // PR reason / breakdown (only meaningful when patient owes a balance —
  // i.e. status is Sent to Patient, or ERA Received with patientResp > 0).
  const coinsuranceTotal = lines.reduce((s, l) => s + (l.coinsuranceCopay ?? 0), 0);
  const deductibleTotal = claimLevelDeductible;
  const prReason = derivePrReason(coinsuranceTotal, deductibleTotal, 0);

  // Forwarded crossover hint
  const forwardedFlag = submissionType === "Forwarded";
  const expectedCrossoverEra = forwardedFlag
    ? "10-14 days after primary"
    : undefined;

  const secondaryPayerRawName = txt(item, COL.SECONDARY_PAYER_RAW_NAME);

  return {
    id: txt(item, COL.CLAIM_ID) || item.id,
    mondayItemId: item.id,
    parentClaimId: txt(item, COL.PARENT_CLAIM_ID) ||
      txt(item, COL.PRIMARY_CLAIM_ID) ||
      item.id,
    status,
    secondaryPayerRawName: secondaryPayerRawName || undefined,
    payorConfirmed,
    rawSecondaryStatus: secondaryStatus || undefined,
    patientName: item.name,
    primaryPayor: txt(item, COL.PRIMARY_PAYOR),
    secondaryPayer: secondaryPayerLabel || null,
    primaryMemberId: txt(item, COL.PRIMARY_MEMBER_ID),
    secondaryMemberId,
    dos: isoDateOrEmpty(txt(item, COL.DOS)),
    diagnosis: txt(item, COL.DIAGNOSIS),
    type: claimType,
    primaryPaid,
    primaryAdj,
    primaryPayDate: isoDateOrEmpty(txt(item, COL.PRIMARY_PAID_DATE)),
    primarySentDate: isoDateOrEmpty(txt(item, COL.CLAIM_SENT_DATE)) || undefined,
    primaryIcn: txt(item, COL.PRIMARY_CLAIM_ID),
    remaining,
    claimLevelDeductible: claimLevelDeductible || undefined,
    expectedCrossoverEra,
    forwardedFlag,
    // Secondary ERA fields (only meaningful when hasSecondaryEra)
    secondarySentDate: hasSecondaryEra
      ? isoDateOrEmpty(txt(item, COL.CLAIM_SENT_DATE)) || undefined
      : undefined,
    secondaryEraDate: hasSecondaryEra
      ? isoDateOrEmpty(rawEraDate) || undefined
      : undefined,
    secondaryPayDate: hasSecondaryEra
      ? isoDateOrEmpty(txt(item, COL.SECONDARY_PAID_DATE)) || undefined
      : undefined,
    secondaryIcn: hasSecondaryEra
      ? txt(item, COL.SECONDARY_ICN) || undefined
      : undefined,
    secondaryPaid: hasSecondaryEra ? secondaryPaidAmount : undefined,
    // Bank deposit reconciliation — present whenever the ERA writeback
    // populated these columns. Drives the Bank Info strip in the ERA
    // Review detail view.
    bankDepositTotal: num(item, COL.BANK_DEPOSIT_TOTAL) || null,
    bankPaymentMethod: txt(item, COL.BANK_PAYMENT_METHOD) || null,
    bankPayerOriginatorId: txt(item, COL.BANK_PAYER_ORIG_ID) || null,
    bankEftDate: isoDateOrEmpty(txt(item, COL.BANK_EFT_DATE)) || null,
    bankTraceNumber: txt(item, COL.RAW_REMITTANCE_TRACE) || null,
    secondaryAdj: hasSecondaryEra
      ? Math.max(remaining - secondaryPaidAmount, 0)
      : undefined,
    patientResp: hasSecondaryEra
      ? Math.max(remaining - secondaryPaidAmount, 0)
      : undefined,
    prReason,
    prBreakdown:
      coinsuranceTotal + deductibleTotal > 0
        ? {
            coinsurance: coinsuranceTotal,
            copay: 0,
            deductible: deductibleTotal,
          }
        : undefined,
    lines,
  };
}

// ---------- fetcher ----------

/**
 * Fetch every item on the Secondary Claims Board, paginating until done.
 * By default filters out terminal/closed rows (Secondary Paid, Patient
 * Paid, Bad Debt) — the SecondaryBoard view only cares about in-flight
 * work. Pass `{ includeAll: true }` to override.
 */
export async function fetchAllSecondaryClaims(opts?: {
  includeAll?: boolean;
}): Promise<SecClaim[]> {
  let cursor: string | null = null;
  const all: SecClaim[] = [];
  do {
    const data = await mondayQuery<QueryResponse>(PAGE_QUERY, { cursor });
    const page = data.boards[0]?.items_page;
    const items = page?.items ?? [];
    for (const item of items) {
      all.push(mapMondayItemToSecClaim(item));
    }
    cursor = page?.cursor ?? null;
  } while (cursor);

  if (opts?.includeAll) return all;

  const terminal = new Set<SecondaryStatus>([
    "Secondary Paid",
    "Patient Paid",
    "Bad Debt",
  ]);
  return all.filter((c) => !terminal.has(c.status));
}
