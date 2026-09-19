/**
 * dvs.ts — the Medicaid DVS state of an Authorization circle.
 *
 * NY Medicaid does not hold a standing authorization for CGM supplies the way
 * a commercial payer does. Eligibility is re-verified per order through
 * ePACES (a DVS — Dispensing Validation System — check), and the result only
 * counts for that order. So for a Medicaid patient with an order due, the
 * question the Authorization column has to answer is not "is there an auth on
 * file?" but "has DVS been run for THIS order?".
 *
 * Brandon, 2026-09-19: "for the Medicaid ones, for order due, they should all
 * be like an open circle with an M logo. I should be able to multi-select
 * them, and then … press a button that says Run DVS."
 *
 * So: an open circle means "DVS not run for this order" — not a data gap and
 * not a failure, a step waiting to be taken, and the operator takes it in bulk
 * from the board. Monday's automation watches Trigger DVS (color_mm2narpj) and
 * runs the ePACES bot, which writes Running → Success / Failed / MLTC back to
 * the same column; those states are what turns the circle gray, green or
 * amber without anyone refreshing a thing.
 *
 * ⚠️ Success does NOT force the circle green on its own. It hands the row back
 * to the ordinary sensors/supplies auth derivation, so a row whose auth column
 * genuinely says Denied stays red even after a clean DVS. Turning that green
 * would be the one failure mode that actually costs money.
 */

/** Trigger DVS labels that mean "a run is already on its way". */
const DVS_IN_FLIGHT = new Set(["Trigger DVS", "Running", "Retry Queued"]);

/** Trigger DVS labels that mean "the bot is done and a human is needed". */
const DVS_NEEDS_HUMAN: Record<string, string> = {
  "Failed": "DVS failed — needs a manual ePACES check",
  "Manual Review": "DVS flagged for manual review",
  "MLTC": "Managed long-term care plan — DVS does not apply, bill the plan",
};

export type DvsState =
  /** Not a Medicaid row, or no order due — DVS is not part of this circle. */
  | { kind: "n/a" }
  /** Order due, nothing run yet. Open circle + M, selectable for Run DVS. */
  | { kind: "needed" }
  /** Queued or running. Gray + M; nothing to do but wait for the bot. */
  | { kind: "inFlight"; label: string }
  /** Bot finished but could not answer. Amber + M. */
  | { kind: "needsHuman"; label: string }
  /** Clean DVS for this order. Defer to the ordinary auth derivation. */
  | { kind: "ok" };

export interface DvsInputs {
  /** Primary insurance label (color_mm254qxj). */
  payer: string | null | undefined;
  /** Next order date, yyyy-mm-dd (date_mkp0nvf1). */
  orderDate: string | null | undefined;
  /** Trigger DVS label (color_mm2narpj). */
  triggerDvs: string | null | undefined;
  /** Today, yyyy-mm-dd. Passed in so the derivation stays pure. */
  today: string;
}

/**
 * Medicaid is matched loosely on purpose. The board's payer dropdown is
 * free-ish and already carries "United Medicaid" alongside "Medicaid"
 * (measured 2026-09-19: 263 + 1 of 264 Medicaid-primary actives). A managed
 * Medicaid plan still needs the DVS.
 */
export function isMedicaid(payer: string | null | undefined): boolean {
  return /medicaid/i.test(String(payer ?? ""));
}

/** An order is due once its date arrives — ISO dates compare lexically. */
export function orderIsDue(orderDate: string | null | undefined, today: string): boolean {
  const d = String(orderDate ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today;
}

export function dvsState(p: DvsInputs): DvsState {
  if (!isMedicaid(p.payer) || !orderIsDue(p.orderDate, p.today)) return { kind: "n/a" };
  const label = String(p.triggerDvs ?? "").trim();
  if (!label) return { kind: "needed" };
  if (DVS_IN_FLIGHT.has(label)) {
    return { kind: "inFlight", label: label === "Running" ? "DVS running" : "DVS requested" };
  }
  const human = DVS_NEEDS_HUMAN[label];
  if (human) return { kind: "needsHuman", label: human };
  if (/^success$/i.test(label)) return { kind: "ok" };
  // An unrecognised label is a data question, not an all-clear. Treat it the
  // way the board treats every other unknown: surface it, don't hide it.
  return { kind: "needsHuman", label: `Trigger DVS = "${label}"` };
}

// ─── The Run DVS guard ───────────────────────────────────────────────────────
/**
 * Which rows the board will fire a DVS for.
 *
 * Brandon, 2026-09-19: "It should only allow it if the confirm is either a
 * check or a gray, not if it's a red x cancel. (if it's a red x cancel, the
 * user would need to click into the profile to override it to a confirm)."
 *
 * A red Confirm is the patient having said no — cancelled or asked to pause.
 * Running a DVS there spends an ePACES check on an order that isn't happening
 * and, worse, leaves a valid-looking auth on a row nobody should order for.
 * Green (confirmed, including a delay) and gray (no reply yet) both pass: the
 * DVS is a precondition, and waiting on the patient is not a reason to skip
 * the prep work. Overriding a red is a deliberate act, and it happens in the
 * profile where the operator has to say why.
 */
export function canRunDvs(p: {
  auth: { dvsNeeded?: boolean };
  confirmation: { tone: string };
}): boolean {
  return !!p.auth.dvsNeeded && p.confirmation.tone !== "bad";
}
