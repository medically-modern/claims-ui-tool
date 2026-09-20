/**
 * checks.ts — the five checks, computed from plain board values.
 *
 * Every function here takes strings as Monday holds them and returns a
 * Checkpoint. The Monday plumbing lives in api/queries/subscriptionPatients.ts;
 * this file is pure so the rules can be tested one board value at a time.
 *
 * Each check follows the same shape (see payerRules.ts for the convention):
 *
 *   1. BASELINE — what the column says on its own, the same for every payer.
 *   2. RULED    — the baseline with the patient's payer-group rules applied.
 *
 * When the two agree the mark is dark and carries no rule. When a rule changes
 * the answer the mark is light, `why` says what decided it, and `ruleId` lets
 * the Rules tab count how often each rule fired tonight.
 *
 * First orders short-circuit all of it: nothing holds a first order, so every
 * check that would not pass on its own passes by rule (Brandon, 2026-09-20).
 */
import type {
  Checkpoint, CheckpointTone, SubscriptionType,
} from "@/components/subscription/mockData";
import { deriveMr } from "./mrCheck";
import { readSignal } from "./confirmationSignals";
import { dvsState } from "./dvs";
import { renderAuth } from "./authStatus";
import {
  confirmPolicy, eligibilityIsFresh, fmtUsd, isFirstOrder, parseMoney,
  payerGroupFor,
  type PatientFlag, type PayerGroup, type PayerGroupId, type RuleId,
} from "./payerRules";
import { fmtStamp, stampFor } from "./orderStamps";

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** Everything the five checks read, as the board holds it (trimmed text). */
export interface CheckInputs {
  today: string;
  primaryInsurance: string;
  orderDate: string;
  orderType: string;
  subscriptionType: SubscriptionType;
  // Confirm
  patientOrderResponse: string;
  patientInsuranceResponse: string;
  patientHelpMessage: string;
  patientChangeSummary: string;
  reorderTextSent: string;
  coordinatorNotes: string;
  notesUpdatedAt: number | null;
  lastPatientContact: string;
  oopEstimate: string;
  /** Total GP as raw text — blank must stay distinguishable from 0. */
  totalGp: string;
  /** Correspondence Reviewed / Confirm Override cells (lib/subscription/orderStamps). */
  correspondenceReviewed: string;
  confirmOverride: string;
  // Eligibility
  active: string;
  runCheck: string;
  lastEligibilityError: string;
  facilityFlags: string;
  lastEligibilityCheck: string;
  cobCheck: string;
  suggestedPrimary: string;
  // Authorization
  sensorsAuthStatus: string;
  suppliesAuthStatus: string;
  triggerDvs: string;
  claimsStatus: string;
  insuranceChange: string;
  // Last claim paid
  primaryClaimPaid: string;
  secondaryClaimPaid: string;
  secondaryAmount: string;
  // Medical records
  mnExpiry: string;
  referralSource: string;
}

export interface DerivedChecks {
  confirmation: Checkpoint;
  benefits: Checkpoint;
  auth: Checkpoint;
  lastPaid: Checkpoint;
  mr: Checkpoint;
  firstOrder: boolean;
  payerGroup: PayerGroupId;
  flags: PatientFlag[];
}

// ─── The dark/light seam ────────────────────────────────────────────────────

/**
 * Apply a rule's verdict to a baseline. If the rule agrees with the column the
 * baseline comes back untouched (dark). If it changes the tone the result is
 * light, with the rule's reason and id attached and any render hints that
 * belong to the old verdict (blank outline, "…") cleared.
 */
function ruled(
  baseline: Checkpoint,
  ruleId: RuleId,
  verdict: { tone: CheckpointTone; why: string; label?: string; detail?: string },
): Checkpoint {
  if (verdict.tone === baseline.tone) return baseline;
  return {
    ...baseline,
    tone: verdict.tone,
    label: verdict.label ?? baseline.label,
    detail: verdict.detail ?? baseline.detail,
    light: true,
    why: verdict.why,
    ruleId,
    unknown: undefined,
    awaiting: undefined,
  };
}

/**
 * First order: nothing holds it, so any check that would not pass on its own
 * passes by rule. The one thing that still stands is a dark red — a column
 * that says no outright (the patient cancelled, the insurance is Inactive,
 * the patient is deceased or admitted). Those are not blockers to clear;
 * they are the answer.
 */
function firstOrderPass(baseline: Checkpoint): Checkpoint {
  if (baseline.tone === "bad" && !baseline.light) return baseline;
  return ruled(baseline, "first-order", {
    tone: "ok",
    why: "First order — nothing holds a first order; it goes straight to Ready to Order",
  });
}

// ─── Check 1 — Confirm ──────────────────────────────────────────────────────

/**
 * Extract change-list items from the latest Patient Change Summary entry.
 *
 * Josh's reorder backend appends a new block to this column on every patient
 * submission. Blocks are separated by a blank line; the first line of each
 * block is a `[timestamp] Patient ACTION:` header and the remaining lines are
 * the human-readable change list. Only the LATEST block is surfaced — older
 * blocks are history and stay in the column for the profile. Boilerplate
 * lines ("no changes" / "Cancelled order") are dropped.
 */
export function parseLatestChangeLines(summary: string): string[] {
  if (!summary) return [];
  const entries = summary.split(/\n\s*\n/).map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return [];
  const lastEntry = entries[entries.length - 1];
  const lines = lastEntry.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(1).filter(
    (line) => !/no changes|no detail changes|cancelled order/i.test(line),
  );
}

export function deriveConfirmation(i: CheckInputs, firstOrder: boolean): { check: Checkpoint; flags: PatientFlag[] } {
  const por = i.patientOrderResponse;
  const reviewed = stampFor(i.correspondenceReviewed, i.orderDate);
  const signal = readSignal({
    helpMessage:        i.patientHelpMessage,
    coordinatorNotes:   i.coordinatorNotes,
    notesUpdatedAt:     i.notesUpdatedAt,
    lastPatientContact: i.lastPatientContact,
    orderDate:          i.orderDate,
    reviewedAt:         reviewed?.at ?? null,
  });
  // What the patient changed: the parsed change summary (address, order date,
  // CGM/pump type, infusion sets, insurance); the standalone Patient Insurance
  // Response column is the fallback for older patients whose summary is empty.
  const changes = parseLatestChangeLines(i.patientChangeSummary);
  if (changes.length === 0 && i.patientInsuranceResponse === "Changed") {
    changes.push(`Insurance: ${i.patientInsuranceResponse}`);
  }
  const extras: Partial<Checkpoint> = {
    needsRead:      signal.needsRead ? signal.summary : undefined,
    needsReadLines: signal.lines.length ? signal.lines : undefined,
    changes:        changes.length ? changes : undefined,
    patientMessage: i.patientHelpMessage || undefined,
  };

  // ── Baseline: the Patient Order Response column on its own ──────────────
  // Monday's label is "Delay" (Brian Gillen sat grey because this compared
  // against "Delayed"); prefix-match so both spellings count. Delaying moves
  // the order date, so against the date the row shows the patient HAS answered
  // — a plain check, the delay itself is in the detail (Brandon, 2026-09-19).
  const delayed = /^delay/i.test(por);
  let baseline: Checkpoint;
  if (por === "Confirmed") {
    baseline = { tone: "ok", label: "Confirmed", ...extras };
  } else if (delayed) {
    baseline = {
      tone: "ok", label: "Confirmed", delayed: true, ...extras,
      detail: "Patient chose to delay — the order date has already moved",
    };
  } else if (/^(cancel|pause)$/i.test(por)) {
    // Cancel is permanent (→ Inactive), Pause is temporary (→ Paused + a
    // reason). The operator decides; the circle stops it reading as nothing.
    baseline = {
      tone: "bad", label: "Patient said no", ...extras,
      detail: por === "Cancel"
        ? "Patient cancelled - move to Inactive with a dead reason"
        : "Patient asked to pause - set Paused with a pause reason",
    };
  } else if (/^no response/i.test(por)) {
    baseline = { tone: "pending", label: "No reply", ...extras };
  } else {
    // Blank. "Awaiting" = the reorder text went out and nobody answered;
    // "Not sent" = the 20-day text hasn't fired yet. Same verdict, the label
    // tells the Comms sheet which sentence to show.
    baseline = { tone: "pending", label: i.reorderTextSent ? "Awaiting" : "Not sent", ...extras };
  }

  // ── Ruled ────────────────────────────────────────────────────────────────
  // Confirm is decided per patient, not per payer: no reply is fine when the
  // patient owes nothing and the fill is profitable, and not otherwise. The
  // policy is only consulted when the column did not answer — a Confirmed or
  // a Cancel is the column speaking, for everyone.
  const policy = confirmPolicy({
    oopEstimate: i.oopEstimate, totalGp: i.totalGp,
    orderDate: i.orderDate, today: i.today, firstOrder,
  });
  if (firstOrder) return { check: firstOrderPass(baseline), flags: policy.flags };

  // An operator's override for THIS order: they looked, decided, and said
  // why. It turns a no into a yes and is shown as such (light, with the
  // reason) — never silently (Brandon, 2026-09-20).
  const override = stampFor(i.confirmOverride, i.orderDate);
  if (override && baseline.tone !== "ok") {
    return {
      check: {
        ...baseline, tone: "ok", light: true, ruleId: "confirm.override",
        why: `Overridden by ${override.initials} ${fmtStamp(override)}${override.reason ? ` — ${override.reason}` : ""}`,
        overrideReason: override.reason || `Overridden by ${override.initials}`,
        unknown: undefined, awaiting: undefined,
      },
      flags: policy.flags,
    };
  }
  if (baseline.tone !== "pending") return { check: baseline, flags: policy.flags };

  const check = ruled(baseline, policy.ruleId, policy.affirmativeOnly
    ? { tone: "bad", why: policy.why, detail: "No reply yet, and no reply is not enough here — get a yes, or override in the profile" }
    : { tone: "ok",  why: policy.why, detail: "No reply yet, and none is needed — the rules say order" });
  return { check, flags: policy.flags };
}

// ─── Check 2 — Eligibility ──────────────────────────────────────────────────

export function deriveEligibility(i: CheckInputs, group: PayerGroup, firstOrder: boolean): Checkpoint {
  const ff = i.facilityFlags.toLowerCase();
  const active = i.active;

  // Facility flags win before any Active value: they describe billing-impact
  // states that hold regardless of the policy's verdict.
  //   Deceased     — never ship, never bill (Allan Blaer, 2026-07-22: the flag
  //                  was on the board, nothing surfaced it, an order shipped
  //                  and the claim is unsubmittable).
  //   Hospital/SNF — DME can't be separately billed during the stay.
  //   Hospice      — a payer rule: billable on Medicare A&B with the GW
  //                  modifier, a stop everywhere else until the path is checked.
  if (ff.includes("deceased")) {
    return { tone: "bad", label: "Deceased", detail: "Payer reported a date of death (or flag set by ops). Do not ship or bill." };
  }
  if (ff.includes("hospital") || /\bsnf\b/.test(ff) || /hospital|snf/i.test(active)) {
    return { tone: "bad", label: "Hospital/SNF", detail: "Active admission — DME can't be separately billed during the stay." };
  }
  if (ff.includes("hospice")) {
    const baseline: Checkpoint = {
      tone: "warn", label: "Hospice",
      detail: "Active hospice election — Medicare A&B bills with the GW modifier; other payers may deny.",
    };
    if (firstOrder) return firstOrderPass(baseline);
    return group.eligibility.hospiceOk
      ? ruled(baseline, "elig.hospice-medicare", { tone: "ok",  why: "Hospice is billable on Medicare A&B with the GW modifier" })
      : ruled(baseline, "elig.hospice-other",    { tone: "bad", why: `Hospice on ${group.name === "Everyone else" ? i.primaryInsurance || "this payer" : group.name} — verify the billing path before shipping` });
  }

  // ── Baseline: the Active? column ─────────────────────────────────────────
  let baseline: Checkpoint;
  if (active === "Active") {
    baseline = { tone: "ok", label: "Active" };
  } else if (active === "Inactive" || active === "Medicare Advantage") {
    baseline = {
      tone: "bad", label: active,
      detail: active === "Medicare Advantage" ? "The payer on file is wrong — the patient is on a Medicare Advantage plan" : undefined,
    };
  } else if (active === "Failed") {
    baseline = { tone: "warn", label: "Failed Check", detail: i.lastEligibilityError || "Stedi rejected the request; no reason recorded. Re-run." };
  } else if (active) {
    baseline = { tone: "warn", label: active };
  } else if (i.runCheck === "Failed") {
    baseline = { tone: "warn", label: "Failed Check", detail: i.lastEligibilityError || "Stedi rejected the request; no reason recorded. Re-run." };
  } else if (i.runCheck === "Batch" || i.runCheck === "Run") {
    // In flight — a verdict is coming from Stedi. "…", not a colour.
    baseline = {
      tone: "pending", awaiting: true,
      label: i.runCheck === "Batch" ? "In Batch" : "Checking…",
      detail: i.runCheck === "Batch" ? "Awaiting Stedi batch result" : "Real-time check in flight",
    };
  } else {
    // Blank and nothing running. The board clears Active? when an order goes
    // out, so this is the resting state for most of the board: eligibility
    // has not been checked for THIS cycle yet. Amber — there is an action.
    baseline = { tone: "warn", label: "Not run", detail: "Eligibility has not been checked for this order — run it" };
  }

  if (firstOrder) return firstOrderPass(baseline);
  if (baseline.tone !== "ok") return baseline;

  // ── Ruled: the payer's own conditions, each can only turn Active red ──────
  const e = group.eligibility;
  if (e.freshnessDays != null) {
    const f = eligibilityIsFresh({
      lastCheck: i.lastEligibilityCheck, orderDate: i.orderDate, today: i.today,
      days: e.freshnessDays, sameMonth: e.sameMonth,
    });
    if (!f.fresh) {
      const when = i.lastEligibilityCheck
        ? `last checked ${i.lastEligibilityCheck.slice(0, 10)}${f.ageDays != null ? ` (${f.ageDays} days before the ${f.dos} date of service)` : ""}`
        : "no check date recorded";
      return ruled(baseline, "elig.medicare-freshness", {
        tone: "bad",
        why: `${group.name}: the check must be within ${e.freshnessDays} days of the date of service${e.sameMonth ? " and in the same month" : ""} — ${when}`,
        detail: "Active, but the check is too old for this order — re-run eligibility",
      });
    }
  }
  if (e.cobCheck && /other primary/i.test(i.cobCheck)) {
    return ruled(baseline, "elig.cob-other-primary", {
      tone: "bad",
      why: "COB Check reads Other Primary Reported — another payer is primary and the claim would deny",
      detail: "Active, but the payer reports a different primary — resolve COB before ordering",
    });
  }
  if (e.primaryMatch && i.suggestedPrimary && !/^(unknown|failed)$/i.test(i.suggestedPrimary)
      && i.suggestedPrimary !== i.primaryInsurance) {
    return ruled(baseline, "elig.primary-mismatch", {
      tone: "bad",
      why: `Suggested Primary reads ${i.suggestedPrimary}; Primary Insurance is ${i.primaryInsurance || "blank"} — fix the payer or review`,
      detail: "Active, but under a different payer than the one on file",
    });
  }
  return baseline;
}

// ─── Check 3 — Authorization ────────────────────────────────────────────────

export function deriveAuthorization(i: CheckInputs, group: PayerGroup, firstOrder: boolean): Checkpoint {
  // Only the categories this patient is served for count. (Medicaid is
  // Supplies-only on 258 of 264 active rows, so sensors are irrelevant there.)
  const sensorsServed  = i.subscriptionType !== "Supplies";
  const suppliesServed = i.subscriptionType !== "Sensors";
  const labels = [
    sensorsServed  ? i.sensorsAuthStatus  : "",
    suppliesServed ? i.suppliesAuthStatus : "",
  ].filter(Boolean);

  // ── Medicaid with an order due: the DVS → paid-claim ladder ──────────────
  // Still mirroring Monday, across three of its columns instead of one.
  // Supplies Auth Status alone can't answer "clear to order?" for Medicaid,
  // because it flips to Auth Valid the moment DVS succeeds — before the claim
  // has paid, and the sequence is DVS, get paid, THEN order. Every state below
  // is a value some Monday column is actually holding (Brandon, 2026-09-19),
  // so these marks are dark.
  if (group.auth === "dvs") {
    const dvs = dvsState({
      payer: i.primaryInsurance, orderDate: i.orderDate,
      triggerDvs: i.triggerDvs, claimsStatus: i.claimsStatus, today: i.today,
    });
    let baseline: Checkpoint;
    switch (dvs.kind) {
      case "needed":  baseline = { ...columnAuth(labels), dvsNeeded: true, medicaidDvs: true }; break;
      case "running": baseline = { tone: "pending", awaiting: true, label: dvs.label, medicaidDvs: true }; break;
      case "cleared": baseline = { tone: "ok",  label: dvs.label, medicaidDvs: true }; break;
      case "failed":  baseline = { tone: "bad", label: dvs.label, medicaidDvs: true }; break;
      default:        baseline = columnAuth(labels);
    }
    return firstOrder ? firstOrderPass(baseline) : baseline;
  }

  // ── Everyone else: the column speaks ─────────────────────────────────────
  const baseline = columnAuth(labels);
  if (firstOrder) return firstOrderPass(baseline);

  if (group.auth === "never") {
    return ruled(baseline, "auth.medicare-never", {
      tone: "ok",
      why: `An authorization is never required on ${group.name}`,
      detail: `Board says ${baseline.label} — irrelevant on ${group.name}`,
    });
  }
  if (group.auth === "column-plan-change" && sensorsServed && /^yes$/i.test(i.insuranceChange)) {
    return ruled(baseline, "auth.fidelis-plan-change", {
      tone: "bad",
      why: `${group.name}: the plan changed since the last order — re-evaluate the sensor auth under the new plan (Child Health Plus needs one)`,
      detail: `Board says ${baseline.label}, but Insurance Change? is Yes — the auth belongs to the old plan`,
    });
  }
  return baseline;
}

/** Supplies/Sensors Auth Status → a circle. A blank is amber ("nobody has
 *  looked"), not an outline: there is an action (Brandon, 2026-09-20). */
function columnAuth(labels: string[]): Checkpoint {
  const r = renderAuth(labels);
  if (r.unknown) {
    return { tone: "warn", label: "Not set", detail: "No auth status recorded for the categories served — nobody has looked" };
  }
  return { tone: r.tone, label: r.label };
}

// ─── Check 4 — Last claim paid ──────────────────────────────────────────────

function claimTone(v: string): CheckpointTone {
  if (!v) return "pending";
  if (/^none$/i.test(v)) return "ok";  // explicit "no secondary"
  if (/(Paid|Fully Paid|Patient Paid)/i.test(v)) return "ok";
  if (/Denied/i.test(v)) return "bad";
  return "warn";  // Partial / Outstanding / Underpaid
}

export function deriveLastPaid(i: CheckInputs, group: PayerGroup, firstOrder: boolean): Checkpoint {
  const pri = i.primaryClaimPaid;
  const sec = i.secondaryClaimPaid;
  // Verified Monday labels 2026-06-07:
  //   Primary Claim Paid?:   Denied / Fully Paid / Partial / Outstanding
  //   Secondary Claim Paid?: Fully Paid / None / Outstanding
  // Empty Secondary = no claim sent yet (or no secondary); explicit "None" =
  // no secondary insurance. Both resolved → ok.
  const priTone = claimTone(pri);
  const secTone: CheckpointTone = !sec ? "ok" : claimTone(sec);
  const tones = [priTone, secTone];
  let tone: CheckpointTone = "ok";
  if (tones.includes("bad")) tone = "bad";
  else if (tones.includes("warn")) tone = "warn";
  else if (tones.includes("pending")) tone = "warn"; // blank primary on a reorder: a gap to fill

  // 'Primary: <status>; Secondary: <status>' — with the $ gap inlined when the
  // secondary is outstanding, so ops see $25 vs $2,500 without opening the row.
  const parts: string[] = [];
  if (pri) parts.push(`Primary: ${pri}`);
  if (sec && !/^none$/i.test(sec)) {
    const money = parseMoney(i.secondaryAmount);
    parts.push(/outstanding/i.test(sec) && money != null
      ? `Secondary: ${fmtUsd(money)} outstanding`
      : `Secondary: ${sec}`);
  }
  const baseline: Checkpoint = {
    tone,
    label: pri || "Not recorded",
    detail: parts.length ? parts.join("; ") : (pri ? undefined : "No claim status recorded for the last order"),
  };
  if (firstOrder) return firstOrderPass(baseline);

  // ── Ruled: Medicare's open secondary does not hold the reorder ───────────
  if (group.claims.secondaryOpenOk && priTone === "ok" && /outstanding/i.test(sec)) {
    return ruled(baseline, "claims.medicare-secondary-open", {
      tone: "ok",
      why: `${group.name}: the primary paid; an open secondary does not hold a reorder`,
    });
  }
  return baseline;
}

// ─── Check 5 — Medical records ──────────────────────────────────────────────

export function deriveMedicalRecords(i: CheckInputs, firstOrder: boolean): Checkpoint {
  const baseline = deriveMr({ mnExpiry: i.mnExpiry, referralSource: i.referralSource, today: i.today });
  return firstOrder ? firstOrderPass(baseline) : baseline;
}

// ─── All five ───────────────────────────────────────────────────────────────

export function deriveChecks(i: CheckInputs): DerivedChecks {
  const group = payerGroupFor(i.primaryInsurance);
  const firstOrder = isFirstOrder(i.orderType);
  const confirmation = deriveConfirmation(i, firstOrder);
  return {
    confirmation: confirmation.check,
    benefits: deriveEligibility(i, group, firstOrder),
    auth: deriveAuthorization(i, group, firstOrder),
    lastPaid: deriveLastPaid(i, group, firstOrder),
    mr: deriveMedicalRecords(i, firstOrder),
    firstOrder,
    payerGroup: group.id,
    flags: confirmation.flags,
  };
}
