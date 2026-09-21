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

/** Trigger DVS labels that mean the bot stopped and a human has to act. */
const DVS_STOPPED: Record<string, string> = {
  "Failed": "DVS failed — needs a manual ePACES check",
  "Manual Review": "DVS flagged for manual review",
  "MLTC": "Managed long-term care plan — DVS does not apply, bill the plan",
};

/** Claims Status labels where the claim stopped hard — a denial or an error.
 *  Nobody orders through these; they need a human on the claim, not a one-click
 *  override. Renders dark red. */
const CLAIM_STOPPED: Record<string, string> = {
  "Claims Denied": "Medicaid claim denied",
  "Claims Error": "Medicaid claim errored",
};

/** The claim paid, but not the amount we billed. Unlike a denial this is a
 *  judgement call — the boxes shipped and Medicaid paid *something*, so the
 *  operator can look at the per-code payments and decide to ship anyway. Light
 *  red, overridable (Brandon, 2026-09-21, re Benedicto Camilo). */
const CLAIM_UNDERPAID = "Payment Incorrect";

/** The one Claims Status that clears a Medicaid order to ship on its own. */
const CLAIM_PAID = "Claims Paid";

export type DvsState =
  /** Not a Medicaid row, or no order due — DVS is not part of this circle. */
  | { kind: "n/a" }
  /** Order due, nothing run yet. Amber, plus the Run DVS checkbox and the M. */
  | { kind: "needed" }
  /** The bot is working, or the claim it raised is still out. Renders "…" —
   *  an answer is coming, wait for it rather than acting. */
  | { kind: "running"; label: string }
  /** DVS clean AND the claim paid. This is the only green. */
  | { kind: "cleared"; label: string }
  /** The claim paid the wrong amount. Light red X — a judgement call the
   *  operator can override to ship, after reading the per-code payments. */
  | { kind: "underpaid"; label: string }
  /** The run or the claim stopped hard. Red X — somebody has to go look. */
  | { kind: "failed"; label: string };

export interface DvsInputs {
  /** Primary insurance label (color_mm254qxj). */
  payer: string | null | undefined;
  /** Next order date, yyyy-mm-dd (date_mkp0nvf1). */
  orderDate: string | null | undefined;
  /** Trigger DVS label (color_mm2narpj). */
  triggerDvs: string | null | undefined;
  /** Claims Status label (color_mm2n5rkg) — the claim the DVS raised. */
  claimsStatus?: string | null;
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

  const trigger = String(p.triggerDvs ?? "").trim();
  const claim   = String(p.claimsStatus ?? "").trim();

  // The claim is the end of the ladder: DVS runs, the claim goes out, the claim
  // PAYS, then the order ships. Once the claim has actually paid, the order is
  // cleared no matter what the Trigger DVS column still reads. The bot leaves
  // stale in-flight labels behind — a row can sit at "Retry Queued" while its
  // claim has already come back "Claims Paid" (Yameen Ali, 2026-09-21). Reading
  // the claim first means a paid claim clears the circle instead of hanging on
  // "…" behind a trigger label the automation never tidied up.
  if (claim === CLAIM_PAID) return { kind: "cleared", label: "DVS clear, claim paid" };
  if (claim === CLAIM_UNDERPAID) return { kind: "underpaid", label: "Medicaid paid the wrong amount" };
  const claimStopped = CLAIM_STOPPED[claim];
  if (claimStopped) return { kind: "failed", label: claimStopped };

  if (!trigger) return { kind: "needed" };
  if (DVS_IN_FLIGHT.has(trigger)) {
    return { kind: "running", label: trigger === "Running" ? "DVS running" : "DVS requested" };
  }
  const stopped = DVS_STOPPED[trigger];
  if (stopped) return { kind: "failed", label: stopped };

  if (!/^success$/i.test(trigger)) {
    // An unrecognised label is a data question, not an all-clear. Surface it.
    return { kind: "failed", label: `Trigger DVS = "${trigger}"` };
  }

  // DVS came back clean but the claim hasn't paid yet. For Medicaid that is
  // only half the gate: the claim goes out on the DVS and has to PAY before the
  // order ships (Brandon: "we get the dvs, we get paid, then we order"). So a
  // clean DVS with a claim still out is "…", not a green light.
  return {
    kind: "running",
    label: claim ? `DVS clear — claim ${claim.toLowerCase()}` : "DVS clear — waiting on the claim",
  };
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
