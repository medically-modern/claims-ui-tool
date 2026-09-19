/**
 * authStatus.ts — rendering Monday's Supplies/Sensors Auth Status.
 *
 * This module is a TRANSLATION, not a judgement. The Authorization circle
 * shows what the board shows; it does not derive a state of its own from the
 * DVS column or anywhere else (Brandon, 2026-09-19: "i want the UI tool to
 * reflect what's on the monday board … i don't want to force circles to show
 * something when the monday board is showing something else").
 *
 * The buckets follow two things that already agree with each other:
 *
 *   - the backend's promotion gate — AUTH_OK here is the same set as AUTH_OK in
 *     stedi-monday-integration/services/order_status_service.py, so a green
 *     circle and a row the backend will promote to Ready to Order are always
 *     the same rows. If one of those sets changes, change both.
 *   - Monday's own label colours on color_mm27snkq / color_mm25t997:
 *       Auth Valid #037f4c · Not Serving #9cd326 · No Auth Needed #4eccc6  → green
 *       Required #ffcb00 · Evaluate #ff6d3b · Auth. Expiring #bb3354       → amber
 *       Auth. Expired #df2f4a · Denied #ff007f                             → red
 *       Submitted #579bfc                                                  → grey
 *
 * "Required" is the label the board now writes to every Medicaid patient the
 * moment their order goes out, so it is the resting state for the biggest
 * population on the board: an auth is needed and nobody has obtained it yet.
 * Amber, not red — red is for an authorization that was asked for and refused.
 */

/** Cleared to order. Must stay identical to the backend's AUTH_OK. */
export const AUTH_OK = new Set(["Auth Valid", "Not Serving", "No Auth Needed"]);

/** Asked and refused, or lapsed. Nothing to do but re-authorize. */
const AUTH_BAD = /^(auth\.? ?expired|denied)$/i;

/** Filed and waiting on the payer — the ball is not in our court. */
const AUTH_PENDING = /^submitted$/i;

export type AuthTone = "ok" | "warn" | "bad" | "pending";

export interface AuthRender {
  tone: AuthTone;
  /** True when the board holds no value at all — render an open circle. */
  unknown?: boolean;
  /** The board's own text, joined when two categories are served. */
  label: string;
}

/**
 * Translate the auth labels that apply to this patient into a circle.
 *
 * `labels` holds only the statuses for categories the patient is actually
 * served for — a Supplies-only patient is not waiting on a sensors auth.
 * An empty list means the board has nothing to say, which is an open circle:
 * a blank is a blank, never a pass and never a failure.
 */
export function renderAuth(labels: string[]): AuthRender {
  const present = labels.filter((l) => l.trim().length > 0);
  if (present.length === 0) return { tone: "pending", unknown: true, label: "Not set" };

  const label = present.join(" / ");
  if (present.every((l) => AUTH_OK.has(l)))        return { tone: "ok", label };
  if (present.some((l) => AUTH_BAD.test(l)))       return { tone: "bad", label };
  if (present.every((l) => AUTH_PENDING.test(l)))  return { tone: "pending", label };
  return { tone: "warn", label };
}
