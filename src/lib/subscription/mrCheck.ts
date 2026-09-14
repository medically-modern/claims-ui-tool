/**
 * mrCheck.ts — the 5th checkpoint: are the patient's medical records valid?
 *
 * Spec: REORDER_PROCESS.md § "The MR check" (Brandon, 2026-09-14). This is a
 * REFERRAL-SOURCE rule, not a payer rule:
 *
 *   MR valid (MN Expiry today or later)                     → green   · fine for anyone
 *   MR not valid, referral source is anyone else            → light green · OK to order, chase the records
 *   MR not valid, referral source = District Endochrine     → red     · cannot order — records first
 *
 * "Not valid" covers both an expired MN Expiry and a blank one: a patient
 * with no expiry on file has no records we can point to, so for the one
 * source with the hard stop that is a stop, and for everyone else it's the
 * same advisory it would be if the date had lapsed.
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

  if (mrIsValid(expiry, today)) {
    return {
      tone: "ok",
      label: "Valid",
      detail: `MR expires ${fmtDay(expiry)}${source ? ` · referral: ${source}` : ""}`,
      pill: fmtDay(expiry).replace(/, \d{4}$/, ""),
    };
  }
  const why = expiry ? `MR expired ${fmtDay(expiry)}` : "No MR expiry on file";
  if (hardStop) {
    return {
      tone: "bad",
      label: "Not valid",
      detail: `${why} · ${source} referral — can't order until the records are updated`,
    };
  }
  return {
    tone: "ok",
    light: true,
    label: "Not valid · OK to order",
    detail: `${why} · OK to order${source ? ` (${source} referral)` : ""} — chase the records`,
  };
}
