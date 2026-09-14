/**
 * mrCheck.ts — the 5th checkpoint: are the patient's medical records valid?
 *
 * Spec: REORDER_PROCESS.md § "The MR check" (Brandon, 2026-09-14). This is a
 * REFERRAL-SOURCE rule, not a payer rule:
 *
 *   MR valid (MN Expiry today or later)                     → green   · fine for anyone
 *   MR not valid (expired), referral source is anyone else  → light green · OK to order, chase the records
 *   MR not valid (expired), referral source = District Endochrine → red · cannot order — records first
 *   MN Expiry BLANK                                         → an empty outline circle, "Not on file"
 *
 * Blank is its own state, not "not valid": it means the date was never
 * recorded — we don't know, and it was missed (Brandon, 2026-09-14). For
 * every ordinary referral source that's a pass (the check is advisory for
 * them anyway) with a visible gap to fill in. For a District Endochrine
 * referral an unknown can't count as valid, so it holds the order the same
 * way a missing eligibility check would — the circle stays blank, the tone
 * is pending, and the patient lands in the Medical Records tab until the
 * expiry is recorded. No "expiring soon" state, by design.
 *
 * Live board, 2026-09-14: 262 active patients valid, 449 expired, 6 blank;
 * all 3 District Endochrine patients valid. Referral Source is blank on
 * 432 of 787 rows — the hard stop only sees patients whose source is set.
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
  if (!expiry) {
    // Blank — never recorded. Shown as a blank circle either way; only the
    // hard-stop source lets it hold the order.
    return hardStop
      ? {
          tone: "pending",
          unknown: true,
          label: "Not on file",
          detail: `No MN Expiry recorded · ${source} referral — can't confirm the records, so the order waits until it's filled in`,
        }
      : {
          tone: "ok",
          unknown: true,
          label: "Not on file",
          detail: `No MN Expiry recorded — we don't know; it was missed${source ? ` (${source} referral)` : ""}. OK to order; fill it in`,
        };
  }
  const why = `MR expired ${fmtDay(expiry)}`;
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
