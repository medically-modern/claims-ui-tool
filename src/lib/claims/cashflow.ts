// Cash-flow bucketing across both the Primary Claims Board and the
// Secondary Claims Board.
//
// Buckets:
//   - "soonEra"      → ERA in hand (primary or secondary), future pay date
//   - "soonMedicaid" → pure Medicaid no ERA, settles within 7 days
//   - "expectedPrimaryNonMedicaid" → non-Medicaid primary no-ERA <21 days
//   - "expectedPrimaryMedicaid"    → pure Medicaid no-ERA >7 days away
//   - "expectedSecondaryInsurance" → secondary (Forwarded/Insurance) awaiting ERA
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
 * eMedNY payment cycle rule.
 * Reference: https://www.emedny.org/hipaa/news/PDFS/CYCLE_CALENDAR.pdf
 *
 *   EFT date = cycle_end_Wednesday + 21 days
 *
 * where cycle_end_Wednesday is the next Wednesday on or after the
 * submission date.
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

  // No pay date yet. Patient-type goes to its own Expected sub-bucket.
  // Either the operator hasn't sent the statement yet, or it's out for
  // patient payment.
  if (
    claim.status === "Sent to Patient" ||
    (claim.secondaryPayer === "Patient")
  ) {
    return "expectedSecondaryPatient";
  }

  // Insurance/Forwarded — awaiting crossover ERA or 837 response. Both
  // bucket as Secondary (Insurance) Expected.
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

export interface BucketStat {
  count: number;
  total: number;
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

  // Expected (split four ways)
  expected: BucketStat;
  expectedPrimaryNonMedicaid: BucketStat;
  expectedPrimaryMedicaid: BucketStat;
  expectedSecondaryInsurance: BucketStat;
  expectedSecondaryPatient: BucketStat;

  // High risk (primary only)
  highRisk: BucketStat;
}

function emptyStat(): BucketStat {
  return { count: 0, total: 0 };
}

function addToStat(stat: BucketStat, amount: number): void {
  stat.count += 1;
  stat.total += amount;
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
    expectedSecondaryInsurance: emptyStat(),
    expectedSecondaryPatient: emptyStat(),
    highRisk: emptyStat(),
  };

  const primaryTotal = emptyStat();
  const secondaryTotal = emptyStat();

  for (const c of claims) {
    const bucket = classifyForCashFlow(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const amount = expectedInflowAmount(c);
    addToStat(buckets[bucket], amount);
    addToStat(primaryTotal, amount);
  }

  for (const c of secondaryClaims) {
    const bucket = classifyForCashFlowSecondary(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const amount = expectedInflowAmountSecondary(c);
    addToStat(buckets[bucket], amount);
    addToStat(secondaryTotal, amount);
  }

  const soon: BucketStat = {
    count: buckets.soonEra.count + buckets.soonMedicaid.count,
    total: buckets.soonEra.total + buckets.soonMedicaid.total,
  };
  const expected: BucketStat = {
    count:
      buckets.expectedPrimaryNonMedicaid.count +
      buckets.expectedPrimaryMedicaid.count +
      buckets.expectedSecondaryInsurance.count +
      buckets.expectedSecondaryPatient.count,
    total:
      buckets.expectedPrimaryNonMedicaid.total +
      buckets.expectedPrimaryMedicaid.total +
      buckets.expectedSecondaryInsurance.total +
      buckets.expectedSecondaryPatient.total,
  };
  const totalOpen: BucketStat = {
    count: soon.count + expected.count + buckets.highRisk.count,
    total: soon.total + expected.total + buckets.highRisk.total,
  };

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
    expectedSecondaryInsurance: buckets.expectedSecondaryInsurance,
    expectedSecondaryPatient: buckets.expectedSecondaryPatient,
    highRisk: buckets.highRisk,
  };
}
