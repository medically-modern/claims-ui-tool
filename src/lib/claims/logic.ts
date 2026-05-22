import type { Claim, LineStatus, SuggestedOutcome } from "./types";

export const VARIANCE_TOLERANCE = 5;

export function daysBetween(from: string | null | undefined, to = new Date()): number | null {
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Effective last-submission date for aging. When a denial was resolved
 * back to Outstanding the operator stamps Claim Resent Date today, and
 * the Late ERA / Cash Flow clocks should restart from that point.
 *
 * Returns the more recent of Claim Sent Date and Claim Resent Date, or
 * null when neither is set.
 */
export function effectiveSentDate(claim: Claim): string | null {
  const sent = claim.claimSentDate;
  const resent = claim.claimResentDate;
  if (!sent && !resent) return null;
  if (!sent) return resent ?? null;
  if (!resent) return sent;
  return new Date(resent) > new Date(sent) ? resent : sent;
}

export function claimAge(claim: Claim): number | null {
  return daysBetween(effectiveSentDate(claim));
}

/**
 * Late-ERA aging threshold for this claim. Appeals get a 60-day window
 * because payers commonly take 30-45 days to respond to a clean appeal;
 * everything else uses the standard 21-day window matching Cash Flow's
 * High Risk bucket.
 */
export function lateEraThresholdDays(claim: Claim): number {
  return claim.denialAction === "Appeal" ? 60 : 21;
}

/**
 * True when the claim is in an active "docs uploaded, awaiting payer
 * response" snooze. Operator clicked "Uploaded Docs" in the detail
 * view → backend stamped Late Action Date (date_mm153jp1) to a future
 * date → row drops out of the Late ERA bucket until that date passes.
 *
 * Snooze is compared at day granularity (Monday's date columns are
 * stored as YYYY-MM-DD), so clicking at any time today and seeing the
 * row immediately gone is the right behavior.
 */
export function isLateEraSnoozed(claim: Claim): boolean {
  if (!claim.lateActionDate) return false;
  const d = new Date(claim.lateActionDate);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() > today.getTime();
}

export function eraReceived(claim: Claim): boolean {
  return Boolean(
    claim.rawEraDate ||
      claim.primaryPaidDate ||
      claim.primaryPaid > 0 ||
      claim.rawEraClaimStatus,
  );
}

/**
 * Effective Patient Responsibility — sum of deductible + coinsurance +
 * copay across all service lines on the claim. The parent's prAmount
 * field on Monday is denormalized and routinely lags the per-line ERA
 * breakdown (e.g. an ERA writeback updates each line's coinsurance but
 * not the parent's PR Amount column). The line totals are the source
 * of truth from the 835; use them.
 *
 * Falls back to claim.prAmount when there are no line items (legacy /
 * pre-ERA rows where only the parent column is populated).
 */
export function effectivePr(claim: Claim): number {
  if (!claim.lines || claim.lines.length === 0) return claim.prAmount;
  return claim.lines.reduce(
    (sum, l) => sum + l.deductible + l.coinsurance + l.copay,
    0,
  );
}

export function variance(claim: Claim): number {
  // Variance = what's still missing after the primary paid AND the patient
  // owes their share. estPay − primaryPaid − PR. PR uses effectivePr so
  // the math agrees with the per-line Difference column on ClaimDetail.
  return claim.estPay - claim.primaryPaid - effectivePr(claim);
}

export function variancePretty(claim: Claim): { label: string; tone: "balanced" | "short" | "over" } {
  const v = variance(claim);
  if (Math.abs(v) <= VARIANCE_TOLERANCE) return { label: "Balanced", tone: "balanced" };
  if (v > 0) return { label: `$${v.toFixed(2)} short`, tone: "short" };
  return { label: `$${Math.abs(v).toFixed(2)} over expected`, tone: "over" };
}

// CARCs we know are "workable" denials — operator needs to take action
// (resubmit corrected, file appeal, contact payer, etc.). Used to flag
// whether a denial is in our standard playbook vs. something new.
// Not exhaustive; new combos surface as "Needs Review" until added.
const ACTIONABLE_CARC = new Set([
  "11",  // Diagnosis inconsistent with procedure
  "16",  // Claim/service lacks information
  "18",  // Duplicate claim
  "22",  // Coordination of benefits
  "27",  // Expenses incurred after coverage terminated
  "29",  // Time limit for filing has expired
  "31",  // Patient cannot be identified
  "39",  // Services denied at the time auth was needed
  "50",  // Not medically necessary
  "96",  // Non-covered charges
  "97",  // Payment included in another service
  "107", // Related qualifying procedure not paid
  "109", // Claim/service not covered by this payer (wrong payer)
  "151", // Payment adjusted (frequency)
  "167", // Diagnosis is not covered
  "197", // Precertification missing
  "198", // Precertification was required
  "199", // Revenue code / service date conflict
  "204", // Service not covered by the plan
]);

export function lineHasActionableDenial(carc: string[]): boolean {
  return carc.some((c) => ACTIONABLE_CARC.has(c.replace(/^[A-Z]+-?/i, "")));
}

export function lineStatus(line: Claim["lines"][number]): LineStatus {
  const actionable = lineHasActionableDenial(line.carc);
  // $0 paid + any CARC = Denied. The CARC may or may not be in our
  // ACTIONABLE list (Wrong Payer / CO-109 is the canonical example
  // we missed before — the payer says nope, we get $0, that's a denial
  // even if we don't yet have a playbook entry).
  if (line.primaryPaid <= 0 && line.carc.length > 0) return "Denied";
  if (line.primaryPaid > 0 && line.primaryPaid + line.patientResponsibility + line.coAmount < line.charge - 0.5 && actionable) {
    return "Partial";
  }
  if (line.primaryPaid > 0) return "Paid";
  if (line.patientResponsibility > 0) return "PR";
  return "Needs Review";
}

export function suggestedOutcome(claim: Claim): SuggestedOutcome {
  const age = claimAge(claim) ?? 0;
  const era = eraReceived(claim);
  const errorish = ["Error", "No Match", "Requests Info"].includes(claim.claimStatusCategory ?? "");

  if (!era) {
    if (age >= 30) return "Needs Investigation";
    if (age >= 15) return "Status Check Needed";
    return "Waiting";
  }
  const v = Math.abs(variance(claim));
  const anyActionable = claim.lines.some((l) => lineHasActionableDenial(l.carc));
  if (v <= VARIANCE_TOLERANCE && !anyActionable) return "Likely Paid / Resolved";
  if (errorish) return "Needs Investigation";
  return "Likely Partial Denial";
}

export function priorityOf(claim: Claim): "red" | "yellow" | "green" | "gray" {
  const age = claimAge(claim) ?? 0;
  const era = eraReceived(claim);
  if (claim.primaryStatus === "Paid") return "green";
  if (
    claim.primaryStatus === "Denied (Or Partly)" ||
    ["Denied", "Requests Info", "Error", "No Match"].includes(claim.claimStatusCategory ?? "") ||
    (age > 30 && !era) ||
    (claim.nextActionDate && new Date(claim.nextActionDate) < new Date())
  ) return "red";
  if (
    (age >= 15 && !era) ||
    claim.primaryStatus === "Review" ||
    !claim.status277 ||
    ["Pending", "In Process"].includes(claim.claimStatusCategory ?? "")
  ) return "yellow";
  return "gray";
}

export function shortIssue(claim: Claim): string {
  if (claim.primaryStatus === "Paid") return "—";
  if (claim.primaryStatus === "Denied (Or Partly)") return "Denial — needs action";
  const era = eraReceived(claim);
  const age = claimAge(claim) ?? 0;
  if (!era && age >= 15) return `No ERA after ${age} days`;
  if (!era) return `Awaiting ERA (${age}d)`;
  if (claim.primaryStatus === "Review") return "ERA arrived — review";
  return "—";
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  // Monday date columns hand back date-only strings like "2026-04-15".
  // new Date("2026-04-15") parses that as UTC midnight, so
  // toLocaleDateString in any negative-offset timezone (e.g. America/
  // New_York at UTC-4/5) rolls the date back one day — DOS shown as
  // 04/14 when Monday stores 04/15. Detect the YYYY-MM-DD shape and
  // construct as a local date instead so the day matches Monday's cell.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (ymd) {
    const [, y, m, day] = ymd;
    const local = new Date(Number(y), Number(m) - 1, Number(day));
    return local.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  }
  // Full ISO datetimes still go through the default parser — they
  // carry a timezone so there's no ambiguity to fix.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

// Friendly meanings for CARC codes
const CARC_MEANINGS: Record<string, string> = {
  "16": "Claim lacks information",
  "18": "Duplicate claim",
  "27": "Coverage terminated",
  "29": "Timely filing limit",
  "45": "Charge exceeds fee schedule (routine)",
  "50": "Not medically necessary",
  "96": "Non-covered charge",
  "97": "Bundled / included in another service",
  "109": "Wrong payer",
  "151": "Billed too many units / frequency issue",
  "167": "Diagnosis not covered",
  "197": "Precertification / authorization missing",
  "198": "Precert exceeded",
  "204": "Service not covered under plan",
};

export function carcMeaning(code: string): string | null {
  const k = code.replace(/^[A-Z]+-?/i, "");
  return CARC_MEANINGS[k] ?? null;
}
