/**
 * mrCheck.ts — the 5th checkpoint: are the patient's medical records valid?
 *
 * Spec: REORDER_PROCESS.md § "The MR check" (Brandon, 2026-09-14) and the
 * Payer rules tab (2026-09-20). This is a REFERRAL-SOURCE rule, not a payer
 * rule, and it follows the dark/light convention in payerRules.ts:
 *
 *   MR valid (MN Expiry today or later)                          → dark green · the column says yes, for anyone
 *   MR expired, referral source is anyone else                    → LIGHT green · rule: order anyway, chase the records
 *   MR expired, referral source = District Endochrine             → LIGHT red · rule: records first, no order
 *   MN Expiry BLANK                                               → LIGHT red · rule: unknown can't count as valid
 *
 * Blank used to render as an outline circle that passed for ordinary
 * sources. Brandon (2026-09-20): every state is a yes or a no, and a blank
 * is a no, so that a blank forces someone to fill it in. Rare — 6 of 747
 * active patients on the last count. No "expiring soon" state, by design.
 *
 * Live board, 2026-09-20: 315 valid, 422 expired, 6 blank; all 4 District
 * Endochrine patients valid. Referral Source is blank on 432 of 787 rows —
 * the hard stop only sees patients whose source is set.
 *
 * Pure: no Monday, no React. The board's `Referral Source` label is spelled
 * "District Endochrine" (label id 9); the rule matches both spellings so a
 * future label fix doesn't silently turn the hard stop off.
 */
import type { Checkpoint } from "@/components/subscription/mockData";

/** Referral sources whose patients can't be reordered without valid MR. */
export const MR_HARD_STOP_SOURCES = ["district endochrine", "district endocrine"] as const;

export function isMrHardStopSource(referralSource: string | undefined | null): boolean {
  const s = String(referralSource ?? "").trim().toLowerCase();
  return !!s && (MR_HARD_STOP_SOURCES as readonly string[]).includes(s);
}

/** Local calendar day as yyyy-mm-dd — same rule as lanes.todayIso. */
function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fmtDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** True when `iso` is a plain yyyy-mm-dd on or after today. */
export function mrIsValid(mnExpiry: string | undefined | null, today: string = localTodayIso()): boolean {
  const v = String(mnExpiry ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return v >= today;
}

export function deriveMr(opts: {
  mnExpiry: string | undefined | null;
  referralSource: string | undefined | null;
  today?: string;
}): Checkpoint {
  const today = opts.today ?? localTodayIso();
  const expiry = String(opts.mnExpiry ?? "").trim().slice(0, 10);
  const hardStop = isMrHardStopSource(opts.referralSource);
  const source = String(opts.referralSource ?? "").trim();
  const src = source ? ` (${source} referral)` : "";

  if (mrIsValid(expiry, today)) {
    return {
      tone: "ok",
      label: "Valid",
      detail: `MR expires ${fmtDay(expiry)}${source ? ` · referral: ${source}` : ""}`,
      pill: fmtDay(expiry).replace(/, \d{4}$/, ""),
    };
  }
  if (!expiry) {
    // Blank — never recorded. A no for everyone: the column has nothing to
    // say, and the rule is what says stop until somebody fills it in.
    return {
      tone: "bad",
      light: true,
      ruleId: "mr.blank",
      why: `MN Expiry is blank${src} — unknown can't count as valid; record the date`,
      label: "Not on file",
      detail: `No MN Expiry recorded${src}. The order waits until the date is filled in.`,
    };
  }
  const expiredOn = `MR expired ${fmtDay(expiry)}`;
  if (hardStop) {
    return {
      tone: "bad",
      light: true,
      ruleId: "mr.expired-hard-stop",
      why: `${source} referral — records first, no order`,
      label: "Not valid",
      detail: `${expiredOn} · ${source} referral — can't order until the records are updated`,
    };
  }
  return {
    tone: "ok",
    light: true,
    ruleId: "mr.expired-order-anyway",
    why: `${expiredOn}${src} — OK to order, chase the records`,
    label: "Not valid · OK to order",
    detail: `${expiredOn} · OK to order${src} — chase the records`,
  };
}
