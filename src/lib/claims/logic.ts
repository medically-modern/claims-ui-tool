import type { Claim, LineStatus, SuggestedOutcome } from "./types";

export const VARIANCE_TOLERANCE = 5;

export function daysBetween(from: string | null | undefined, to = new Date()): number | null {
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function claimAge(claim: Claim): number | null {
  return daysBetween(claim.claimSentDate);
}

export function eraReceived(claim: Claim): boolean {
  return Boolean(
    claim.rawEraDate ||
      claim.primaryPaidDate ||
      claim.primaryPaid > 0 ||
      claim.rawEraClaimStatus,
  );
}

export function variance(claim: Claim): number {
  // Variance = what's still missing after the primary paid AND the patient
  // owes their share. estPay − primaryPaid − prAmount.
  return claim.estPay - claim.primaryPaid - claim.prAmount;
}

export function variancePretty(claim: Claim): { label: string; tone: "balanced" | "short" | "over" } {
  const v = variance(claim);
  if (Math.abs(v) <= VARIANCE_TOLERANCE) return { label: "Balanced", tone: "balanced" };
  if (v > 0) return { label: `$${v.toFixed(2)} short`, tone: "short" };
  return { label: `$${Math.abs(v).toFixed(2)} over expected`, tone: "over" };
}

const ACTIONABLE_CARC = new Set([
  "16", "18", "27", "29", "50", "96", "97", "151", "167", "197", "198", "199", "204",
]);

export function lineHasActionableDenial(carc: string[]): boolean {
  return carc.some((c) => ACTIONABLE_CARC.has(c.replace(/^[A-Z]+-?/i, "")));
}

export function lineStatus(line: Claim["lines"][number]): LineStatus {
  const actionable = lineHasActionableDenial(line.carc);
  if (line.primaryPaid <= 0 && actionable) return "Denied";
  if (line.primaryPaid > 0 && line.primaryPaid + line.patientResponsibility + line.coAmount < line.charge - 0.5 && actionable) {
    return "Partial";
  }
  if (line.primaryPaid > 0) return "Paid";
  if (line.patientResponsibility > 0) return "PR";
  if (line.carc.length && !actionable) return "Paid";
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
