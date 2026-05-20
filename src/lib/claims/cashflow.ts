// Cash-flow bucketing across both the Primary Claims Board and the
// Secondary Claims Board.
//
// Buckets:
//   - "soonEra"      → ERA in hand (primary or secondary), future pay date
//   - "soonMedicaid" → pure Medicaid no ERA, settles within 7 days
//   - "expectedPrimaryNonMedicaid" → non-Medicaid primary no-ERA <21 days
//   - "expectedPrimaryMedicaid"    → pure Medicaid no-ERA >7 days away
//   - "expectedSecondaryConfirm"   → secondary awaiting operator to pick a
//     destination (Confirm Payor tab; status = Awaiting Payor Confirmation)
//   - "expectedSecondaryInsurance" → secondary in flight to a payer
//     (Submit Claim / Forwarded / Submitted) awaiting ERA
//   - "expectedSecondaryPatient"   → secondary type=Patient, awaiting payment
//   - "highRisk"     → non-Medicaid primary no ERA, 21+ days old
//   - "settled"      → already paid (paid date in the past)
//   - "out"          → pre-submission, write-off, terminal — not inflow
//
// Cash flow contribution per claim:
//   - settled primary ERA in hand future pay  → secondary cash flow (the
//     primary's already landed, money was counted then)
//   - primary awaiting ERA                    → est. pay
//   - secondary ERA in hand future pay        → secondaryPaid (what AARP/Medigap
//     will deposit)
//   - secondary awaiting ERA / patient        → c.remaining (the PR the primary
//     passed down)

import type { Claim } from "./types";
import type { SecClaim } from "@/components/claims/SecondaryBoard";

// Pure Medicaid only — variants like "Fidelis Medicaid" or "United Medicaid"
// pay on commercial timelines, not the 3-Wednesday cycle.
const PURE_MEDICAID_PAYERS = new Set(["Medicaid"]);

export function isPureMedicaid(payer: string | null | undefined): boolean {
  return !!payer && PURE_MEDICAID_PAYERS.has(payer.trim());
}

/**
 * eMedNY payment cycle rule. Verified against eMedNY's official
 * published cycle calendar (cycle 2543: end Wed 5/13/2026, check
 * release Wed 6/3/2026):
 *
 *   EFT date = cycle_end_Wednesday + 21 days
 *
 * where cycle_end_Wednesday is the next Wednesday ON OR AFTER the
 * submission date. Claims sent ON a Wednesday stay in THAT day's
 * cycle — they do not roll forward.
 *
 * Example: claim sent Wed 5/13 → cycle ends 5/13 → EFT Wed 6/3.
 * Example: claim sent Mon 5/18 → cycle ends Wed 5/20 → EFT Wed 6/10.
 *
 * Mirrors the backend _emedny_pay_date in services/claims_submission_
 * service.py — keep both in sync.
 */
export function medicaidPaymentDate(sentDate: Date): Date {
  const dow = sentDate.getDay(); // 0=Sun, 3=Wed
  const daysUntilWed = (3 - dow + 7) % 7;
  const cycleEnd = new Date(sentDate);
  cycleEnd.setDate(cycleEnd.getDate() + daysUntilWed);
  const eft = new Date(cycleEnd);
  eft.setDate(eft.getDate() + 21);
  return eft;
}

export type CashFlowBucket =
  | "soonEra"
  | "soonMedicaid"
  | "expectedPrimaryNonMedicaid"
  | "expectedPrimaryMedicaid"
  | "expectedSecondaryConfirm"
  | "expectedSecondaryInsurance"
  | "expectedSecondaryPatient"
  | "highRisk"
  | "settled"
  | "out";

const SOON_HORIZON_DAYS = 7;
/** Non-Medicaid no-ERA claims younger than this are still expected to pay.
 *  Older than this and we treat it as stuck / High Risk. */
const EXPECTED_AGE_LIMIT_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRE_OR_TERMINAL: ReadonlySet<string> = new Set([
  "Submit Claim",
  "Future Claim",
  "Not Started Yet",
  "Bad Debt",
  "Request Rejected",
]);

/** Bucket a primary-board Claim. */
export function classifyForCashFlow(claim: Claim, today: Date): CashFlowBucket {
  const todayMs = today.getTime();

  // Check paid date FIRST. The Primary status field doesn't tell us
  // whether money has actually hit the bank — the paid date does.
  if (claim.primaryPaidDate) {
    const paidMs = new Date(claim.primaryPaidDate).getTime();
    if (Number.isFinite(paidMs)) {
      if (paidMs <= todayMs) return "settled";
      const daysAway = Math.ceil((paidMs - todayMs) / MS_PER_DAY);
      if (daysAway > SOON_HORIZON_DAYS) {
        // Future ERA more than 7 days out → still scheduled inflow, but
        // there isn't a perfect Expected sub-bucket; treat as
        // expectedPrimaryNonMedicaid (Medicaid prefills usually fall
        // within the 7-day Soon window anyway).
        return isPureMedicaid(claim.primaryPayor)
          ? "expectedPrimaryMedicaid"
          : "expectedPrimaryNonMedicaid";
      }
      return isPureMedicaid(claim.primaryPayor) ? "soonMedicaid" : "soonEra";
    }
  }

  if (PRE_OR_TERMINAL.has(claim.primaryStatus)) return "out";
  if (claim.primaryStatus === "Paid") return "out";

  // No ERA yet — pure Medicaid uses the eMedNY cycle math.
  if (isPureMedicaid(claim.primaryPayor) && claim.claimSentDate) {
    const sent = new Date(claim.claimSentDate);
    if (Number.isFinite(sent.getTime())) {
      const projectedPay = medicaidPaymentDate(sent);
      const daysAway = Math.ceil(
        (projectedPay.getTime() - todayMs) / MS_PER_DAY,
      );
      return daysAway <= SOON_HORIZON_DAYS
        ? "soonMedicaid"
        : "expectedPrimaryMedicaid";
    }
  }

  // Non-Medicaid without ERA — Expected if still within normal payer
  // turnaround (< 21 days), High Risk past that.
  if (claim.claimSentDate) {
    const sent = new Date(claim.claimSentDate);
    if (Number.isFinite(sent.getTime())) {
      const ageDays = Math.floor((todayMs - sent.getTime()) / MS_PER_DAY);
      return ageDays < EXPECTED_AGE_LIMIT_DAYS
        ? "expectedPrimaryNonMedicaid"
        : "highRisk";
    }
  }

  return "highRisk";
}

/** Bucket a secondary-board SecClaim. */
export function classifyForCashFlowSecondary(
  claim: SecClaim,
  today: Date,
): CashFlowBucket {
  const todayMs = today.getTime();

  // Settled / closed-out states first.
  if (
    claim.status === "Patient Paid" ||
    claim.status === "Bad Debt"
  ) {
    return "out";
  }

  // Pay date already in the past → already landed, exclude from inflow.
  if (claim.secondaryPayDate) {
    const paidMs = new Date(claim.secondaryPayDate).getTime();
    if (Number.isFinite(paidMs)) {
      if (paidMs <= todayMs) return "settled";
      // ERA received with future pay date → Soon (ERA received).
      return "soonEra";
    }
  }

  // Confirm Payor — operator hasn't yet picked Insurance vs Patient on
  // a freshly-spawned secondary. This is the same predicate the
  // Secondary Board uses to put a row in its "Confirm Payor" tab
  // (see bucketFor() in SecondaryBoard.tsx). These claims can't move
  // forward until the operator acts, so the cash flow tile surfaces
  // them as their own line.
  if (claim.status === "Awaiting Payor Confirmation") {
    return "expectedSecondaryConfirm";
  }

  // No pay date yet. Patient-type goes to its own Expected sub-bucket.
  // Either the operator hasn't sent the statement yet, or it's out for
  // patient payment.
  if (
    claim.status === "Sent to Patient" ||
    (claim.secondaryPayer === "Patient")
  ) {
    return "expectedSecondaryPatient";
  }

  // Insurance/Forwarded — in flight to a secondary payer. Covers three
  // status values: "Primary Paid - Submit Secondary" (operator has
  // confirmed payor but hasn't fired the 837), "Primary Paid -
  // Forwarded" (Medicare auto-crossover, awaiting payer ERA), and
  // "Secondary Submitted" (837 sent, awaiting ERA). Rolled together
  // because from a cash-flow standpoint they all represent dollars
  // expected from an insurance payer.
  return "expectedSecondaryInsurance";
}

/**
 * Dollar contribution to cash flow for a primary claim. ERA-in-hand uses
 * the actual Primary Paid; otherwise project from est pay.
 */
export function expectedInflowAmount(claim: Claim): number {
  if (claim.primaryPaidDate) return claim.primaryPaid;
  return claim.estPay;
}

/**
 * Dollar contribution to cash flow for a secondary claim. ERA-in-hand
 * uses the actual Secondary Paid; otherwise project from the PR the
 * primary passed down (c.remaining).
 */
export function expectedInflowAmountSecondary(claim: SecClaim): number {
  if (claim.secondaryPayDate && claim.secondaryPaid != null) {
    return claim.secondaryPaid;
  }
  return claim.remaining;
}

/**
 * One claim's contribution to a Cash Flow bucket, in just the form the
 * drill-down drawer needs to render: who, when service happened, when
 * money is expected, and how much. `kind` lets the drawer route clicks
 * (primaries open ClaimDetail; secondaries currently link to their
 * parent primary since the Secondary Board doesn't have its own detail
 * page). `payDate` is null when we don't yet have an ERA-stamped pay
 * date — the column shows a dash in that case.
 */
export interface CashFlowEntry {
  id: string;
  mondayItemId: string;
  name: string;
  dos: string | null;
  payDate: string | null;
  amount: number;
  kind: "primary" | "secondary";
}

export interface BucketStat {
  count: number;
  total: number;
  entries: CashFlowEntry[];
}

export interface CashFlowStats {
  // Aggregate
  totalOpen: BucketStat;
  primaryTotal: BucketStat;
  secondaryTotal: BucketStat;

  // Soon
  soon: BucketStat;
  soonEra: BucketStat;
  soonMedicaid: BucketStat;

  // Expected (split five ways)
  expected: BucketStat;
  expectedPrimaryNonMedicaid: BucketStat;
  expectedPrimaryMedicaid: BucketStat;
  expectedSecondaryConfirm: BucketStat;
  expectedSecondaryInsurance: BucketStat;
  expectedSecondaryPatient: BucketStat;

  // High risk (primary only)
  highRisk: BucketStat;

  // Per-tile pump-claim breakdown. A claim counts as a pump claim when
  // any service line has HCPCS E0784. Pumps run $4k-$6k per claim so
  // they outsize the rest of the dollar totals — this lets the operator
  // see how much of each tile is "pump money" specifically.
  totalOpenPumps: BucketStat;
  soonPumps: BucketStat;
  expectedPumps: BucketStat;
  highRiskPumps: BucketStat;
}

function emptyStat(): BucketStat {
  return { count: 0, total: 0, entries: [] };
}

function addToStat(stat: BucketStat, entry: CashFlowEntry): void {
  stat.count += 1;
  stat.total += entry.amount;
  stat.entries.push(entry);
}

// CMS HCPCS for the insulin pump. A claim with this code on any line
// counts as a "pump claim" for Cash Flow breakdown purposes.
const PUMP_HCPCS = "E0784";

function claimHasPump(c: Claim): boolean {
  return (c.lines || []).some((l) => (l.hcpcs || "").trim() === PUMP_HCPCS);
}

function secClaimHasPump(c: SecClaim): boolean {
  return (c.lines || []).some((l) => (l.hcpcs || "").trim() === PUMP_HCPCS);
}

/** Pay date for the drill-down drawer. ERA-in-hand → use that ERA's
 *  pay date. Pure-Medicaid awaiting ERA → use the projected eMedNY
 *  cycle pay date. Otherwise null (drawer shows a dash). */
function projectedPrimaryPayDate(c: Claim): string | null {
  if (c.primaryPaidDate) return c.primaryPaidDate;
  if (isPureMedicaid(c.primaryPayor) && c.claimSentDate) {
    const sent = new Date(c.claimSentDate);
    if (!Number.isNaN(sent.getTime())) {
      return medicaidPaymentDate(sent).toISOString().slice(0, 10);
    }
  }
  return null;
}

function entryFromPrimary(c: Claim, amount: number): CashFlowEntry {
  return {
    id: c.id,
    mondayItemId: c.mondayItemId,
    name: c.patientName,
    dos: c.dos || null,
    payDate: projectedPrimaryPayDate(c),
    amount,
    kind: "primary",
  };
}

function entryFromSecondary(c: SecClaim, amount: number): CashFlowEntry {
  return {
    id: c.id,
    mondayItemId: c.mondayItemId ?? c.id,
    name: c.patientName,
    dos: c.dos || null,
    // Secondaries: prefer the ERA pay date; otherwise leave blank since
    // there's no equivalent eMedNY-style projection for crossovers.
    payDate: c.secondaryPayDate || null,
    amount,
    kind: "secondary",
  };
}

/** Merge multiple BucketStats into one. Entries are concatenated; the
 *  drawer sorts them at render time. Used to build the parent tiles
 *  (Soon, Expected, Total Open) out of their constituent sub-buckets,
 *  and to expose Primary / Secondary slices of Total Open. */
function mergeStats(...stats: BucketStat[]): BucketStat {
  const merged = emptyStat();
  for (const s of stats) {
    merged.count += s.count;
    merged.total += s.total;
    merged.entries.push(...s.entries);
  }
  return merged;
}

export function computeCashFlow(
  claims: Claim[],
  secondaryClaims: SecClaim[] = [],
  today: Date = new Date(),
): CashFlowStats {
  const buckets: Record<
    Exclude<CashFlowBucket, "settled" | "out">,
    BucketStat
  > = {
    soonEra: emptyStat(),
    soonMedicaid: emptyStat(),
    expectedPrimaryNonMedicaid: emptyStat(),
    expectedPrimaryMedicaid: emptyStat(),
    expectedSecondaryConfirm: emptyStat(),
    expectedSecondaryInsurance: emptyStat(),
    expectedSecondaryPatient: emptyStat(),
    highRisk: emptyStat(),
  };

  // Pump-claim counters per tile. Built in parallel with the main
  // buckets so the breakdown reflects exactly the same claim set.
  const soonPumps = emptyStat();
  const expectedPumps = emptyStat();
  const highRiskPumps = emptyStat();

  // Per-kind slices of Total Open. The Total Open tile's "Primary" and
  // "Secondary" sub-rows drill in via these.
  const primaryTotal = emptyStat();
  const secondaryTotal = emptyStat();

  for (const c of claims) {
    const bucket = classifyForCashFlow(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const amount = expectedInflowAmount(c);
    const entry = entryFromPrimary(c, amount);
    addToStat(buckets[bucket], entry);
    addToStat(primaryTotal, entry);
    if (claimHasPump(c)) {
      if (bucket === "soonEra" || bucket === "soonMedicaid") {
        addToStat(soonPumps, entry);
      } else if (
        bucket === "expectedPrimaryNonMedicaid" ||
        bucket === "expectedPrimaryMedicaid"
      ) {
        addToStat(expectedPumps, entry);
      } else if (bucket === "highRisk") {
        addToStat(highRiskPumps, entry);
      }
    }
  }

  for (const c of secondaryClaims) {
    const bucket = classifyForCashFlowSecondary(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const amount = expectedInflowAmountSecondary(c);
    const entry = entryFromSecondary(c, amount);
    addToStat(buckets[bucket], entry);
    addToStat(secondaryTotal, entry);
    if (secClaimHasPump(c)) {
      if (bucket === "soonEra") {
        addToStat(soonPumps, entry);
      } else if (
        bucket === "expectedSecondaryConfirm" ||
        bucket === "expectedSecondaryInsurance" ||
        bucket === "expectedSecondaryPatient"
      ) {
        addToStat(expectedPumps, entry);
      }
    }
  }

  // Parent tiles compose from their sub-buckets so the drill-down
  // drawer can show the same combined entry list shown on the tile.
  const soon = mergeStats(buckets.soonEra, buckets.soonMedicaid);
  const expected = mergeStats(
    buckets.expectedPrimaryNonMedicaid,
    buckets.expectedPrimaryMedicaid,
    buckets.expectedSecondaryConfirm,
    buckets.expectedSecondaryInsurance,
    buckets.expectedSecondaryPatient,
  );
  const totalOpen = mergeStats(soon, expected, buckets.highRisk);
  const totalOpenPumps = mergeStats(soonPumps, expectedPumps, highRiskPumps);

  return {
    totalOpen,
    primaryTotal,
    secondaryTotal,
    soon,
    soonEra: buckets.soonEra,
    soonMedicaid: buckets.soonMedicaid,
    expected,
    expectedPrimaryNonMedicaid: buckets.expectedPrimaryNonMedicaid,
    expectedPrimaryMedicaid: buckets.expectedPrimaryMedicaid,
    expectedSecondaryConfirm: buckets.expectedSecondaryConfirm,
    expectedSecondaryInsurance: buckets.expectedSecondaryInsurance,
    expectedSecondaryPatient: buckets.expectedSecondaryPatient,
    highRisk: buckets.highRisk,
    totalOpenPumps,
    soonPumps,
    expectedPumps,
    highRiskPumps,
  };
}
