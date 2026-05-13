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
 * Medicaid payment rule:
 *   - Submitted Sun/Mon/Tue/Wed  → 3rd Wednesday strictly after submission
 *   - Submitted Thu/Fri/Sat      → 4th Wednesday strictly after submission
 *
 * Examples:
 *   sent Wed 2026-05-13 → paid Wed 2026-06-03 (3rd Wed after)
 *   sent Thu 2026-05-14 → paid Wed 2026-06-10 (4th Wed after)
 */
export function medicaidPaymentDate(sentDate: Date): Date {
  const dow = sentDate.getDay(); // 0=Sun … 6=Sat
  const wedNumber = dow >= 4 ? 4 : 3; // Thu-Sat get the 4th Wed; rest get 3rd
  const target = new Date(sentDate);
  // Advance to first Wednesday strictly AFTER sent date
  do {
    target.setDate(target.getDate() + 1);
  } while (target.getDay() !== 3);
  // Add (wedNumber - 1) more weeks
  target.setDate(target.getDate() + 7 * (wedNumber - 1));
  return target;
}

export type CashFlowBucket =
  | "soon"
  | "medicaid1plus"
  | "highRisk"
  | "settled"
  | "out";

const SOON_HORIZON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const PRE_OR_TERMINAL: ReadonlySet<string> = new Set([
  "Submit Claim",
  "Future Claim",
  "Not Started Yet",
  "Bad Debt",
  "Request Rejected",
  "Paid", // Status "Paid" means closed/booked; cash already in bank.
]);

export function classifyForCashFlow(claim: Claim, today: Date): CashFlowBucket {
  if (PRE_OR_TERMINAL.has(claim.primaryStatus)) return "out";

  const todayMs = today.getTime();

  // ERA in hand → use the EFT effective date as the settle signal
  if (claim.primaryPaidDate) {
    const paidMs = new Date(claim.primaryPaidDate).getTime();
    if (!Number.isFinite(paidMs)) return "highRisk"; // bad data, treat conservatively
    if (paidMs <= todayMs) return "settled"; // already cleared
    return "soon"; // EFT in the future — clear, near-term inflow
  }

  // No ERA yet — bucket by payer behavior
  if (isPureMedicaid(claim.primaryPayor) && claim.claimSentDate) {
    const sent = new Date(claim.claimSentDate);
    if (Number.isFinite(sent.getTime())) {
      const projectedPay = medicaidPaymentDate(sent);
      const daysAway = Math.ceil(
        (projectedPay.getTime() - todayMs) / MS_PER_DAY,
      );
      return daysAway <= SOON_HORIZON_DAYS ? "soon" : "medicaid1plus";
    }
  }

  // Non-Medicaid without ERA → could land at $0
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
  soon: BucketStat;
  medicaid1plus: BucketStat;
  highRisk: BucketStat;
  totalOpen: BucketStat;
}

export function computeCashFlow(
  claims: Claim[],
  today: Date = new Date(),
): CashFlowStats {
  const empty = (): BucketStat => ({ count: 0, total: 0 });
  const out: Record<"soon" | "medicaid1plus" | "highRisk", BucketStat> = {
    soon: empty(),
    medicaid1plus: empty(),
    highRisk: empty(),
  };

  for (const c of claims) {
    const bucket = classifyForCashFlow(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const amount = expectedInflowAmount(c);
    out[bucket].count += 1;
    out[bucket].total += amount;
  }

  const totalOpen: BucketStat = {
    count: out.soon.count + out.medicaid1plus.count + out.highRisk.count,
    total: out.soon.total + out.medicaid1plus.total + out.highRisk.total,
  };

  return { ...out, totalOpen };
}
