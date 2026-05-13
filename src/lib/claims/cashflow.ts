// Cash-flow bucketing for the Primary Board summary tile.
//
// Three buckets:
//   - "soon"          → low-risk inflow expected within ~7 days
//   - "medicaid1plus" → pure Medicaid scheduled for a Wednesday >7 days out
//   - "highRisk"      → no ERA yet, non-Medicaid — could land at $0
//
// "settled" (paid date already in the past) and "out" (pre-submission /
// terminal write-off) claims are excluded from all buckets.

import type { Claim } from "./types";

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
 * Cycles run Thursday → Wednesday. Each cycle ends on a Wednesday. The
 * Check Date is the following Monday. EFT is initiated on the Wednesday
 * 2 weeks and 2 days after the Check Date — which simplifies to:
 *
 *   EFT date = cycle_end_Wednesday + 21 days
 *
 * where cycle_end_Wednesday is the next Wednesday on or after the
 * submission date.
 *
 * Examples (verified against the eMedNY cycle calendar):
 *   sent Wed 2026-04-15 → cycle end 04/15 → paid Wed 2026-05-06
 *   sent Mon 2026-04-20 → cycle end 04/22 → paid Wed 2026-05-13
 *   sent Tue 2026-04-28 → cycle end 04/29 → paid Wed 2026-05-20
 *   sent Wed 2026-05-13 → cycle end 05/13 → paid Wed 2026-06-03
 *   sent Thu 2026-05-14 → cycle end 05/20 → paid Wed 2026-06-10
 */
export function medicaidPaymentDate(sentDate: Date): Date {
  const dow = sentDate.getDay(); // 0=Sun, 3=Wed
  // Days until the next Wednesday (0 if sentDate is already a Wed)
  const daysUntilWed = (3 - dow + 7) % 7;
  const cycleEnd = new Date(sentDate);
  cycleEnd.setDate(cycleEnd.getDate() + daysUntilWed);
  const eft = new Date(cycleEnd);
  eft.setDate(eft.getDate() + 21);
  return eft;
}

export type CashFlowBucket =
  | "soonEra"        // Soon — ERA in hand, future paid date
  | "soonMedicaid"   // Soon — pure Medicaid, no ERA, next Wed cycle
  | "expected"       // pure Medicaid 1+ Wk OR non-Medicaid no-ERA, < 21 days old
  | "highRisk"       // non-Medicaid, no ERA, 21+ days old — likely stuck
  | "settled"
  | "out";

const SOON_HORIZON_DAYS = 7;
/** Non-Medicaid no-ERA claims younger than this are still expected to pay.
 *  Older than this and we treat it as stuck / High Risk. */
const EXPECTED_AGE_LIMIT_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Pre-submission / written-off / rejected — these are out of the cash flow
// pipeline entirely. Notably "Paid" is NOT in this set: a Medicaid claim
// pre-filled with a future paid date often has status="Paid" (lives in the
// "Medicaid Outstanding (Paid but didn't hit bank yet)" group). Those should
// count as inflow until the date passes — the paid-date check below handles
// the actual settled-vs-pending decision.
const PRE_OR_TERMINAL: ReadonlySet<string> = new Set([
  "Submit Claim",
  "Future Claim",
  "Not Started Yet",
  "Bad Debt",
  "Request Rejected",
]);

export function classifyForCashFlow(claim: Claim, today: Date): CashFlowBucket {
  const todayMs = today.getTime();

  // Check paid date FIRST. The Primary status field doesn't tell us
  // whether money has actually hit the bank — the paid date does.
  //   - paidDate <= today      → settled (excluded from inflow)
  //   - today < paidDate <= +7 → Soon (lands within the week)
  //   - paidDate > +7          → Expected (further-out scheduled deposit)
  // This handles Medicaid Outstanding (status=Review, future paid date)
  // correctly without any status-based special case.
  if (claim.primaryPaidDate) {
    const paidMs = new Date(claim.primaryPaidDate).getTime();
    if (Number.isFinite(paidMs)) {
      if (paidMs <= todayMs) return "settled";
      const daysAway = Math.ceil((paidMs - todayMs) / MS_PER_DAY);
      return daysAway <= SOON_HORIZON_DAYS ? "soonEra" : "expected";
    }
  }

  // No paid date — bucket by status
  if (PRE_OR_TERMINAL.has(claim.primaryStatus)) return "out";
  // Status "Paid" without a paid date is an oddity — treat as settled rather
  // than reclassifying as inflow (we don't know the EFT, can't project).
  if (claim.primaryStatus === "Paid") return "out";

  // No ERA yet — bucket by payer + claim age
  if (isPureMedicaid(claim.primaryPayor) && claim.claimSentDate) {
    const sent = new Date(claim.claimSentDate);
    if (Number.isFinite(sent.getTime())) {
      const projectedPay = medicaidPaymentDate(sent);
      const daysAway = Math.ceil(
        (projectedPay.getTime() - todayMs) / MS_PER_DAY,
      );
      return daysAway <= SOON_HORIZON_DAYS ? "soonMedicaid" : "expected";
    }
  }

  // Non-Medicaid without ERA — Expected while still in the normal payer
  // turnaround window (< 21 days from claim sent date). At 21+ days, treat
  // as High Risk (likely stuck, denied, or otherwise not coming).
  if (claim.claimSentDate) {
    const sent = new Date(claim.claimSentDate);
    if (Number.isFinite(sent.getTime())) {
      const ageDays = Math.floor((todayMs - sent.getTime()) / MS_PER_DAY);
      return ageDays < EXPECTED_AGE_LIMIT_DAYS ? "expected" : "highRisk";
    }
  }

  // No sent date and no ERA — treat conservatively as High Risk
  return "highRisk";
}

/**
 * Best estimate of how many dollars this claim will deposit. If we have an
 * ERA, use the actual Primary Paid amount; otherwise project from est pay.
 */
export function expectedInflowAmount(claim: Claim): number {
  if (claim.primaryPaidDate) return claim.primaryPaid;
  return claim.estPay;
}

export interface BucketStat {
  count: number;
  total: number;
}

export interface CashFlowStats {
  /** Combined Soon = ERA-in-hand + Medicaid-next-Wed. */
  soon: BucketStat;
  /** Sub-bucket of Soon: ERA received, future paid date. */
  soonEra: BucketStat;
  /** Sub-bucket of Soon: pure Medicaid, no ERA, settles within 7 days. */
  soonMedicaid: BucketStat;
  /** Pure Medicaid 1+ Wk + non-Medicaid no-ERA under 21 days old. */
  expected: BucketStat;
  /** Non-Medicaid no-ERA, 21+ days old (likely stuck). */
  highRisk: BucketStat;
  totalOpen: BucketStat;
}

export function computeCashFlow(
  claims: Claim[],
  today: Date = new Date(),
): CashFlowStats {
  const empty = (): BucketStat => ({ count: 0, total: 0 });
  const out: Record<
    "soonEra" | "soonMedicaid" | "expected" | "highRisk",
    BucketStat
  > = {
    soonEra: empty(),
    soonMedicaid: empty(),
    expected: empty(),
    highRisk: empty(),
  };

  for (const c of claims) {
    const bucket = classifyForCashFlow(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const amount = expectedInflowAmount(c);
    out[bucket].count += 1;
    out[bucket].total += amount;
  }

  const soon: BucketStat = {
    count: out.soonEra.count + out.soonMedicaid.count,
    total: out.soonEra.total + out.soonMedicaid.total,
  };
  const totalOpen: BucketStat = {
    count: soon.count + out.expected.count + out.highRisk.count,
    total: soon.total + out.expected.total + out.highRisk.total,
  };

  return { ...out, soon, totalOpen };
}
