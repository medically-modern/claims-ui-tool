/**
 * claimHistory.ts — what a patient's last claim says about tonight's order.
 *
 * Runbook step 7: "When in doubt read the last claim: paid in full, $0
 * coinsurance, no insurance change → no cost this time — unless the calendar
 * year rolled over (deductible reset)." This module computes that sentence
 * instead of leaving it to be remembered, and it is the banner above claim
 * history in the patient profile (Brandon, 2026-09-20).
 *
 * It answers a question about the NEXT order's cost to the patient, which is
 * why it feeds the Confirm decision on OOP payers and is not part of the Last
 * Claim Paid circle (that circle asks whether the last claim paid, full stop).
 */
import type { Claim } from "@/lib/claims/types";

export type BannerTone = "clear" | "caution" | "none";

export interface ClaimBanner {
  tone: BannerTone;
  /** One sentence, e.g. "Last claim 7/14 — paid in full, patient owed $0." */
  headline: string;
  /** The qualifiers, e.g. "Same plan as today, same calendar year → this order should cost them nothing." */
  detail: string;
  /** Which halves of the heuristic broke, for the hover / tests. */
  flags: Array<"not-paid" | "patient-owed" | "plan-changed" | "year-rolled">;
  /** The claim the banner is about. */
  claim: Claim | null;
}

/** Same payer name, ignoring case, spacing and punctuation drift between boards. */
export function samePayer(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

function fmtDos(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[2])}/${Number(m[3])}` : iso;
}

/** Sort key: newest DOS first. Claims are used as they arrive, sorted here. */
export function newestFirst(claims: Claim[]): Claim[] {
  return [...claims].sort((a, b) => (b.dos || "").localeCompare(a.dos || ""));
}

/**
 * The banner for a patient, given their claims, the payer on their
 * subscription today, and today's date (yyyy-mm-dd, passed in so this stays
 * pure). Uses the newest claim that actually reached a payer verdict — a
 * claim still in flight tells you nothing about cost.
 */
export function lastClaimBanner(
  claims: Claim[],
  currentPayer: string | null | undefined,
  today: string,
): ClaimBanner {
  const settled = newestFirst(claims).find((c) => c.primaryStatus === "Paid" || c.primaryStatus === "Denied" || c.primaryPaid > 0);
  if (!settled) {
    return { tone: "none", headline: "No settled claim on file yet.", detail: "Nothing to read cost from — the first claim is still out or was never sent.", flags: [], claim: null };
  }

  const flags: ClaimBanner["flags"] = [];
  const paidInFull = settled.primaryStatus === "Paid" && settled.primaryPaid > 0;
  if (!paidInFull) flags.push("not-paid");
  if (settled.prAmount > 0) flags.push("patient-owed");
  if (!samePayer(settled.primaryPayor, currentPayer)) flags.push("plan-changed");
  if (settled.dos.slice(0, 4) !== today.slice(0, 4)) flags.push("year-rolled");

  const owed = settled.prAmount > 0 ? `patient owed $${settled.prAmount.toFixed(2)}` : "patient owed $0";
  const paidTxt = paidInFull ? "paid in full" : settled.primaryStatus === "Denied" ? "denied" : `paid $${settled.primaryPaid.toFixed(2)}`;
  const headline = `Last claim ${fmtDos(settled.dos)} — ${paidTxt}, ${owed}.`;

  if (flags.length === 0) {
    return { tone: "clear", headline, detail: "Same plan as today, same calendar year → this order should cost them nothing.", flags, claim: settled };
  }
  const why: string[] = [];
  if (flags.includes("plan-changed")) why.push(`plan changed since then (${settled.primaryPayor || "unknown"} → ${currentPayer || "unknown"})`);
  if (flags.includes("year-rolled")) why.push("new calendar year — deductible may have reset");
  if (flags.includes("patient-owed")) why.push("they owed money last time");
  if (flags.includes("not-paid")) why.push("that claim did not pay in full");
  return { tone: "caution", headline, detail: `Cost this time is not a given: ${why.join("; ")}.`, flags, claim: settled };
}
