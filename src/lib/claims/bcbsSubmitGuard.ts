// BCBS / Anthem pre-submit validator.
//
// Codifies the routing rules from ANTHEM_SUBMISSION_RULES.md as a pure
// function: given a claim's payer label, PR Payor ID, POS, patient
// state, and per-line auth IDs, return the set of hard-stop errors that
// must block submission and any soft warnings that surface a "Submit
// anyway?" confirmation.
//
// Routing table (master switch is patient's home address state):
//   NY            → Payer ID 803    + POS 12 (Home)
//   NJ            → Payer ID 11345  + POS 12 (Home)
//   FL            → Payer ID 11345  + POS 12 (Home)
//   any other     → Payer ID 803    + POS 11 (Office)
//
// NJ and FL share destination payer ID 11345 (CareCentrix) but are
// DIFFERENT billing routes: Horizon NJ and Florida Blue price their
// supply lines differently, so anything modifier-related is keyed on the
// route (patient state + payer ID), never on the payer ID alone.
//
// Horizon NJ moved from payer ID 11348 to 11345. 11348 stays accepted
// as a LEGACY value: claims already on the wire under it must still be
// resubmittable, so an NJ claim sitting on 11348 raises a soft warning
// and never a hard stop. 11345 is the target for anything new.
//
// Soft warning: claims being sent to CareCentrix — Horizon NJ (11345,
// or legacy 11348) or Florida Blue (11345) — where at least one subitem
// is missing an Auth ID. Doesn't block — confirms via a "submit anyway?"
// dialog.
//
// The validator only fires for claims that look like BCBS / Anthem at
// all. We treat that as: Primary Payor label mentions BCBS / Anthem /
// Blue Cross, OR the PR Payor ID is already set to 803, 11345 or the
// legacy 11348.

import type { ThreadClaim } from "./threads";

/** Payer ID for Anthem BCBS NY / Empire — used for NY patients AND for
 *  any out-of-state Blues that aren't NJ (Anthem handles the BlueCard
 *  inter-plan routing on our behalf for those). */
export const ANTHEM_NY_PAYER_ID = "803";

/** Payer ID for Horizon BCBS NJ via CareCentrix — used only when the
 *  patient lives in NJ, regardless of what their card says. */
export const HORIZON_NJ_PAYER_ID = "11345";

/** The previous Horizon NJ payer ID, retired in favour of 11345. Claims
 *  submitted before the cutover are still open on it, so we keep it
 *  in-scope for the guard (see isBcbsByPayorId) and downgrade the NJ
 *  payer-ID mismatch to a soft warning when a claim is sitting on it —
 *  a resubmission of one of those must never be hard-stopped. */
export const LEGACY_HORIZON_NJ_PAYER_ID = "11348";

/** Payer ID for Florida Blue via CareCentrix. Covers BOTH Florida Blue
 *  members AND Florida BlueCard members (out-of-area Blues members
 *  receiving care in Florida) — keyed on the patient LIVING in FL,
 *  regardless of what their card says, exactly like the NJ rule.
 *
 *  Same numeric ID as Horizon NJ: CareCentrix pays Florida on 11345 too
 *  (confirmed 2026-09-18), per the 2026-09-10 CareCentrix amendment that
 *  brought Florida patients in network. Sharing the ID does NOT mean
 *  sharing the fee schedule — see EXPECTED_LINE_MODIFIERS_BY_ROUTE.
 *
 *  Fallback: Stedi also publishes 11347 / 11347MA as "CareCentrix
 *  Florida Blue". If 11345 ever bounces for a Florida claim, those are
 *  the IDs to try next. */
export const CARECENTRIX_FL_PAYER_ID = "11345";

/** BCBS Tennessee bills DIRECT to the BCBS TN payer ID SB890 (previously
 *  CareCentrix-fronted via a trading partner ID we no longer submit to
 *  for TN). Still routed by label rather than by patient state, like
 *  BCBS WY. POS is Home (12). */
export const BCBS_TN_PAYER_ID = "SB890";

/** BCBS Wyoming is a DIRECT-bill exception: claims go straight to BCBS WY
 *  (payer ID 53767), not through Anthem NY's BlueCard routing (803 + POS
 *  11). Routed by label like BCBS TN, but POS is left as-is — see the
 *  null requiredPos below. */
export const BCBS_WY_PAYER_ID = "53767";

interface LabelRoutedBluePlan {
  payerId: string;
  /** Modifier route key for this plan (see EXPECTED_LINE_MODIFIERS_BY_ROUTE). */
  route: BillingRouteKey;
  /** Required POS for the plan, or null to leave the row's POS alone
   *  (BCBS WY direct-bills at whatever POS is set). */
  requiredPos: "Home" | "Office" | null;
  label: string;
}

/** Blue plans routed to a fixed payer ID + POS by their LABEL, outside the
 *  NY/NJ/other state-based BlueCard logic. BCBS TN (direct, SB890) is
 *  the first. */
const LABEL_ROUTED_BLUE_PLANS: LabelRoutedBluePlan[] = [
  {
    payerId: BCBS_TN_PAYER_ID,
    route: "BCBS_TN",
    requiredPos: "Home",
    label: "BCBS Tennessee",
  },
  {
    payerId: BCBS_WY_PAYER_ID,
    route: "BCBS_WY",
    requiredPos: null,
    label: "BCBS Wyoming",
  },
];

/** Resolve a label-routed Blue plan from the payer label or PR Payor ID.
 *  Returns null for the state-routed Blues (Anthem NY 803 / Horizon NJ
 *  11345, legacy 11348), which keep the patient-state routing rules. */
export function resolveLabelRoutedBluePlan(
  payerLabel: string | null | undefined,
  payorId: string | null | undefined,
): LabelRoutedBluePlan | null {
  const id = (payorId || "").trim();
  const byId = LABEL_ROUTED_BLUE_PLANS.find((p) => p.payerId === id);
  if (byId) return byId;
  const s = (payerLabel || "").toLowerCase();
  if (s.includes("bcbs tn") || s.includes("tennessee")) {
    return LABEL_ROUTED_BLUE_PLANS.find((p) => p.payerId === BCBS_TN_PAYER_ID) ?? null;
  }
  if (s.includes("wyoming") || s.includes("bcbs wy")) {
    return LABEL_ROUTED_BLUE_PLANS.find((p) => p.payerId === BCBS_WY_PAYER_ID) ?? null;
  }
  return null;
}

export type PatientStateBucket = "NY" | "NJ" | "FL" | "OTHER" | "UNKNOWN";

/** A billing ROUTE — the destination plan a claim is actually being sent
 *  to. Distinct from the destination payer ID because NJ and FL both
 *  bill 11345 while carrying different fee schedules, so a payer ID
 *  alone can't identify the route. */
export type BillingRouteKey =
  | "ANTHEM_NY"
  | "HORIZON_NJ"
  | "CARECENTRIX_FL"
  | "BCBS_TN"
  | "BCBS_WY";

/** Resolve the billing route for a patient-state bucket. Null when the
 *  state isn't resolvable (UNKNOWN) — there's no route to check against. */
export function billingRouteForState(
  state: PatientStateBucket,
): BillingRouteKey | null {
  if (state === "NY" || state === "OTHER") return "ANTHEM_NY";
  if (state === "NJ") return "HORIZON_NJ";
  if (state === "FL") return "CARECENTRIX_FL";
  return null;
}

export interface BcbsSubmitGuardInput {
  payerLabel: string | null | undefined;
  payorId: string | null | undefined;
  /** Either "Home" / "Office" (Monday label) or undefined when unset. */
  placeOfService: "Home" | "Office" | null | undefined;
  patientState: PatientStateBucket;
  /** Per-line auth IDs read from each subitem (text_mm1z8nks). One entry
   *  per line; empty string / null / undefined means "no auth on this line". */
  lineAuthIds: Array<string | null | undefined>;
  /** Optional product labels paired 1:1 with lineAuthIds so the warning
   *  message can name which products are missing auth. */
  lineProducts?: Array<string | undefined>;
  /** Per-line HCPCS codes (paired 1:1 with lineModifiers) for the
   *  modifier-mismatch check. When omitted, that check is skipped. */
  lineHcpcs?: Array<string | undefined>;
  /** Per-line modifier arrays, paired 1:1 with lineHcpcs. */
  lineModifiers?: Array<Array<string> | undefined>;
}

export interface BcbsHardStop {
  code:
    | "STATE_UNKNOWN"
    | "WRONG_PAYER_NY"
    | "WRONG_PAYER_NJ"
    | "WRONG_PAYER_FL"
    | "WRONG_PAYER_OTHER"
    // Home-state POS stop. Named for NY/NJ historically; also covers FL,
    // which bills POS 12 (Home) on the same rule.
    | "WRONG_POS_NY_OR_NJ"
    | "WRONG_POS_OTHER"
    | "WRONG_PAYER_LABEL_ROUTED"
    | "WRONG_POS_LABEL_ROUTED";
  message: string;
  fix: string;
  /** True when an operator may knowingly bypass this stop from the
   *  submit dialog (POS rules only — see OVERRIDABLE_HARD_STOP_CODES).
   *  Payer-ID and unknown-state stops are never overridable: those are
   *  real routing errors, not judgment calls. */
  overridable?: boolean;
}

/** Hard stops an operator is allowed to override at submit time.
 *  Deliberately POS-only: the rare legitimate case is a NY/NJ patient
 *  who really was seen at POS 11 (Office), which the state-based
 *  routing table can't know about. */
export const OVERRIDABLE_HARD_STOP_CODES: ReadonlySet<BcbsHardStop["code"]> =
  new Set<BcbsHardStop["code"]>([
    "WRONG_POS_NY_OR_NJ",
    "WRONG_POS_OTHER",
    "WRONG_POS_LABEL_ROUTED",
  ]);

export interface BcbsWarning {
  code: "CARECENTRIX_AUTH_GAP" | "MODIFIER_MISMATCH" | "LEGACY_NJ_PAYER_ID";
  message: string;
  /** Guidance line rendered under the message in the confirm dialog. */
  detail?: string;
  /** Product labels that are missing auth (CARECENTRIX_AUTH_GAP only). */
  productsMissingAuth?: string[];
}

export interface BcbsGuardResult {
  /** True when the claim is in scope (BCBS/Anthem by label or routed via
   *  803 / 11345 (Horizon NJ + Florida Blue) / legacy 11348). */
  applies: boolean;
  hardStops: BcbsHardStop[];
  warnings: BcbsWarning[];
}

/** True when the result is blocked ONLY by overridable (POS) hard stops,
 *  i.e. the submit dialog may offer the "keep POS as-is" escape hatch.
 *  False when there are no hard stops at all, or when any non-overridable
 *  stop (wrong payer ID, unknown patient state) is present — a mixed
 *  result must be fixed properly before it can be submitted. */
export function canOverrideHardStops(result: BcbsGuardResult): boolean {
  return (
    result.hardStops.length > 0 &&
    result.hardStops.every((hs) => OVERRIDABLE_HARD_STOP_CODES.has(hs.code))
  );
}

/** True when this looks like a BCBS / Anthem / Blue Cross claim by label. */
export function isBcbsByPayerLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  const s = label.toLowerCase();
  return (
    s.includes("bcbs") ||
    s.includes("anthem") ||
    s.includes("blue cross") ||
    s.includes("empire") ||
    s.includes("horizon") ||
    // "Florida Blue" is the trading name of Blue Cross and Blue Shield of
    // Florida and carries none of the tokens above. Without this a row
    // labelled that way would skip the guard entirely — including the FL
    // payer-ID stop that is the whole point of the CareCentrix routing.
    s.includes("florida blue")
  );
}

/** True when the PR Payor ID is one of the BCBS routing IDs we manage. */
export function isBcbsByPayorId(payorId: string | null | undefined): boolean {
  if (!payorId) return false;
  const trimmed = payorId.trim();
  return (
    trimmed === ANTHEM_NY_PAYER_ID ||
    trimmed === HORIZON_NJ_PAYER_ID ||
    // Same string as HORIZON_NJ_PAYER_ID today — listed separately so the
    // Florida route stays visible here if either ID ever moves.
    trimmed === CARECENTRIX_FL_PAYER_ID ||
    // Legacy: keeps pre-cutover NJ claims inside the guard instead of
    // silently skipping it on a resubmission.
    trimmed === LEGACY_HORIZON_NJ_PAYER_ID ||
    trimmed === BCBS_TN_PAYER_ID
  );
}

/** Parse a Monday Address column's text value down to a 2-letter US
 *  state bucket. Monday returns the location column's text in the rough
 *  form "123 Main St, Brooklyn, NY 11201, US". We look for a free-floating
 *  two-letter token (case-insensitive) and bucket to NY / NJ / FL / OTHER.
 *
 *  Returns UNKNOWN when we can't pull a state at all — that's a hard
 *  stop on its own ("Can't determine patient state from address"). */
export function parsePatientStateFromAddress(
  addressText: string | null | undefined,
): PatientStateBucket {
  if (!addressText) return "UNKNOWN";
  // First pass: look for a US-style 2-letter state code between commas
  // or before a ZIP, surrounded by word boundaries. This avoids
  // false-positive matches against initials in street names.
  const match = addressText.match(/\b([A-Z]{2})\b(?=\s*\d{5}|,\s*US|,?\s*$)/i);
  if (!match) {
    // Fallback: any standalone 2-letter token. Less safe but covers
    // free-form addresses without a ZIP.
    const loose = addressText.match(/\b([A-Z]{2})\b/);
    if (!loose) return "UNKNOWN";
    return bucketState(loose[1]);
  }
  return bucketState(match[1]);
}

function bucketState(raw: string): PatientStateBucket {
  const s = raw.toUpperCase();
  if (s === "NY") return "NY";
  if (s === "NJ") return "NJ";
  // FL is its own bucket as of the 2026-09-10 CareCentrix amendment —
  // Florida patients are in network through CareCentrix Florida Blue
  // and must NOT fall through to the out-of-state 803 route.
  if (s === "FL") return "FL";
  // Quick allowlist check — only 50 states + DC count as OTHER. Any
  // unexpected token (e.g. country code "US") falls back to UNKNOWN
  // so we don't accidentally treat garbage as a known state.
  if (US_STATE_CODES.has(s)) return "OTHER";
  return "UNKNOWN";
}

const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

/** Resolve the "required" payer ID for a patient state bucket. */
export function requiredPayerIdFor(state: PatientStateBucket): string | null {
  if (state === "NY") return ANTHEM_NY_PAYER_ID;
  if (state === "NJ") return HORIZON_NJ_PAYER_ID;
  if (state === "FL") return CARECENTRIX_FL_PAYER_ID;
  if (state === "OTHER") return ANTHEM_NY_PAYER_ID;
  return null;
}

/** Resolve the "required" POS for a patient state bucket. */
export function requiredPosFor(state: PatientStateBucket): "Home" | "Office" | null {
  if (state === "NY" || state === "NJ" || state === "FL") return "Home";
  if (state === "OTHER") return "Office";
  return null;
}

// ── Canonical line modifiers, keyed by BILLING ROUTE ────────────────────────
// Modifiers are route-specific: the same supply code carries different
// modifiers depending on where the claim lands. They can NOT be keyed on
// the destination payer ID, because Horizon NJ and Florida Blue both bill
// 11345 while pricing the lines differently — most notably A4230, which is
// NU+SC on the NJ schedule and NU-only on the Florida one.
//
// Same-family HCPCS aliases (Aetna A4231, Medicare A4224 / A4225) inherit
// their base code's expectation: A4231 / A4224 follow A4230, A4225 follows
// A4232. No entry for a code means "we have no canonical expectation, so
// don't police it".

const ANTHEM_NY_LINE_MODIFIERS: Record<string, string[]> = {
  A4230: ["KX"],
  A4231: ["KX"],
  A4224: ["KX"],
  A4232: ["KX"],
  A4225: ["KX"],
  A4239: ["KF", "KX", "CG"],
};

/** Horizon NJ via CareCentrix (11345, legacy 11348). E0784 / E2103 are
 *  not policed on this route — the NJ conventions aren't codified yet. */
const HORIZON_NJ_LINE_MODIFIERS: Record<string, string[]> = {
  A4230: ["NU", "SC"],
  A4231: ["NU", "SC"],
  A4224: ["NU", "SC"],
  A4232: ["NU", "SC"],
  A4225: ["NU", "SC"],
  A4239: ["NU"],
};

/** Florida Blue via CareCentrix (11345), per the 2026-09-10 amendment.
 *  Differs from the NJ schedule on A4230 (and its aliases), which is
 *  NU-ONLY in Florida: an SC on an A4230 line is unpriced there and comes
 *  back as a 277 reject ("No rate on file ..."). A4232 keeps NU+SC. */
const CARECENTRIX_FL_LINE_MODIFIERS: Record<string, string[]> = {
  A4230: ["NU"],
  A4231: ["NU"],
  A4224: ["NU"],
  A4232: ["NU", "SC"],
  A4225: ["NU", "SC"],
  A4239: ["NU"],
  E0784: ["NU"],
  E2103: ["NU"],
};

/** BCBS Tennessee (direct, in-network 2026): NU on every line. */
const BCBS_TN_LINE_MODIFIERS: Record<string, string[]> = {
  A4224: ["NU"],
  A4225: ["NU"],
  A4239: ["NU"],
  E0784: ["NU"],
  E2103: ["NU"],
};

/** The canonical table. Keyed by billing route, then by HCPCS. */
export const EXPECTED_LINE_MODIFIERS_BY_ROUTE: Record<
  BillingRouteKey,
  Record<string, string[]>
> = {
  ANTHEM_NY: ANTHEM_NY_LINE_MODIFIERS,
  HORIZON_NJ: HORIZON_NJ_LINE_MODIFIERS,
  CARECENTRIX_FL: CARECENTRIX_FL_LINE_MODIFIERS,
  BCBS_TN: BCBS_TN_LINE_MODIFIERS,
  // BCBS WY direct-bills at whatever the line already carries — nothing
  // canonical to police yet.
  BCBS_WY: {},
};

/** @deprecated Payer-ID-keyed view of the modifier table, kept so older
 *  importers don't break. It is AMBIGUOUS for 11345, which is both the
 *  Horizon NJ and the Florida Blue destination — this shim resolves it to
 *  the NJ schedule, which is what the key meant before Florida existed.
 *  Use EXPECTED_LINE_MODIFIERS_BY_ROUTE (or missingLineModifiersForRoute)
 *  for anything new. */
export const EXPECTED_LINE_MODIFIERS_BY_PAYER: Record<
  string,
  Record<string, string[]>
> = {
  [ANTHEM_NY_PAYER_ID]: ANTHEM_NY_LINE_MODIFIERS,
  [HORIZON_NJ_PAYER_ID]: HORIZON_NJ_LINE_MODIFIERS,
  // Legacy NJ route — same modifier expectations as 11345, so a claim
  // still sitting on 11348 is checked rather than silently skipped.
  [LEGACY_HORIZON_NJ_PAYER_ID]: HORIZON_NJ_LINE_MODIFIERS,
  [BCBS_TN_PAYER_ID]: BCBS_TN_LINE_MODIFIERS,
};

/** Required modifiers that are absent from a line, given the billing
 *  ROUTE and the line's HCPCS. Returns [] when we have no canonical
 *  expectation for that route+code (so we don't police it). Conservative
 *  by design: only flags MISSING required modifiers, not extra ones. */
export function missingLineModifiersForRoute(
  route: BillingRouteKey | null | undefined,
  hcpc: string | null | undefined,
  modifiers: Array<string> | null | undefined,
): string[] {
  if (!route || !hcpc) return [];
  const table = EXPECTED_LINE_MODIFIERS_BY_ROUTE[route];
  if (!table) return [];
  const expected = table[hcpc.trim().toUpperCase()];
  if (!expected) return [];
  const have = new Set(
    (modifiers ?? []).map((m) => (m || "").trim().toUpperCase()),
  );
  return expected.filter((m) => !have.has(m));
}

/** @deprecated Payer-ID-keyed wrapper around missingLineModifiersForRoute.
 *  Resolves 11345 to the Horizon NJ schedule and so will NOT catch a
 *  Florida-specific mismatch (e.g. A4230 carrying SC). Callers that know
 *  the patient's state should use missingLineModifiersForRoute. */
export function missingLineModifiers(
  payerId: string | null | undefined,
  hcpc: string | null | undefined,
  modifiers: Array<string> | null | undefined,
): string[] {
  const table = EXPECTED_LINE_MODIFIERS_BY_PAYER[(payerId || "").trim()];
  if (!table || !hcpc) return [];
  const expected = table[hcpc.trim().toUpperCase()];
  if (!expected) return [];
  const have = new Set(
    (modifiers ?? []).map((m) => (m || "").trim().toUpperCase()),
  );
  return expected.filter((m) => !have.has(m));
}

/** True for either Horizon NJ payer ID — the current 11345 or the
 *  legacy 11348 that pre-cutover claims are still open on. */
export function isHorizonNjPayerId(payorId: string | null | undefined): boolean {
  const trimmed = (payorId || "").trim();
  return (
    trimmed === HORIZON_NJ_PAYER_ID || trimmed === LEGACY_HORIZON_NJ_PAYER_ID
  );
}

/** Human-readable summary of the expected modifier set for a route,
 *  used in the warning's detail line. */
function expectedModifierSummary(route: BillingRouteKey): string {
  switch (route) {
    case "HORIZON_NJ":
      return `Horizon NJ (${HORIZON_NJ_PAYER_ID}) expects A4230/A4232 → NU+SC, A4239 → NU.`;
    case "CARECENTRIX_FL":
      return `Florida Blue via CareCentrix (${CARECENTRIX_FL_PAYER_ID}) expects A4230 → NU (NU only — SC is unpriced in FL), A4232 → NU+SC, A4239/E0784/E2103 → NU.`;
    case "BCBS_TN":
      return `BCBS Tennessee (${BCBS_TN_PAYER_ID}) expects NU on every line.`;
    case "BCBS_WY":
      return `BCBS Wyoming (${BCBS_WY_PAYER_ID}) has no canonical modifier set on file.`;
    case "ANTHEM_NY":
      return `Anthem NY / Empire (${ANTHEM_NY_PAYER_ID}) expects A4230/A4232 → KX, A4239 → KF+KX+CG.`;
  }
}

/** Pure validator. No side effects, no I/O — feed in everything we
 *  need to decide. */
export function evaluateBcbsSubmit(input: BcbsSubmitGuardInput): BcbsGuardResult {
  const applies =
    isBcbsByPayerLabel(input.payerLabel) || isBcbsByPayorId(input.payorId);

  if (!applies) {
    return { applies: false, hardStops: [], warnings: [] };
  }

  const hardStops: BcbsHardStop[] = [];
  const warnings: BcbsWarning[] = [];

  // ---- Label-routed Blue plans (e.g. BCBS TN direct / SB890) ----
  // Identified by label / payer ID rather than patient state. They bill to
  // a fixed payer ID + POS, bypassing the state-based
  // 803/11345 routing below. We validate that the payer ID + POS match the
  // plan and (softly) that lines carry the plan's modifiers (NU).
  const labelRouted = resolveLabelRoutedBluePlan(input.payerLabel, input.payorId);
  if (labelRouted) {
    const trimmedPayor = (input.payorId || "").trim();
    if (trimmedPayor !== labelRouted.payerId) {
      hardStops.push({
        code: "WRONG_PAYER_LABEL_ROUTED",
        message: `${labelRouted.label} bills to ${labelRouted.payerId}, but PR Payor ID is ${
          trimmedPayor || "blank"
        }.`,
        fix: `Change PR Payor ID to ${labelRouted.payerId}.`,
      });
    }
    const lrPos = input.placeOfService ?? "Home";
    if (labelRouted.requiredPos && lrPos !== labelRouted.requiredPos) {
      hardStops.push({
        code: "WRONG_POS_LABEL_ROUTED",
        message: `${labelRouted.label} bills at POS ${
          labelRouted.requiredPos === "Home" ? "12 (Home)" : "11 (Office)"
        } but POS is set to ${lrPos}.`,
        fix: `Change POS to ${labelRouted.requiredPos} on this row before submitting.`,
        overridable: true,
      });
    }
    if (input.lineHcpcs && input.lineModifiers) {
      const issues: string[] = [];
      input.lineHcpcs.forEach((hcpc, idx) => {
        const missing = missingLineModifiersForRoute(
          labelRouted.route,
          hcpc,
          input.lineModifiers?.[idx],
        );
        if (missing.length > 0) {
          const code = (hcpc || `line ${idx + 1}`).toUpperCase();
          const have = (input.lineModifiers?.[idx] ?? []).join("+") || "none";
          issues.push(`${code} missing ${missing.join("+")} (has ${have})`);
        }
      });
      if (issues.length > 0) {
        warnings.push({
          code: "MODIFIER_MISMATCH",
          message:
            "Supply line modifiers don't match the billing route: " +
            issues.join("; ") + ".",
          detail: `${labelRouted.label} (${labelRouted.payerId}) expects NU on every line. Fix the Modifiers on each flagged line, then submit.`,
        });
      }
    }
    return { applies, hardStops, warnings };
  }

  // ---- Patient state must be resolvable ----
  if (input.patientState === "UNKNOWN") {
    hardStops.push({
      code: "STATE_UNKNOWN",
      message:
        "Can't determine patient state from address on the Claims Board.",
      fix:
        "Open the row on Monday and set the Address column so it includes a US state, then retry.",
    });
    // Without a state we can't evaluate the rest of the rules. Return
    // early so the operator focuses on fixing the address first.
    return { applies, hardStops, warnings };
  }

  const requiredPayer = requiredPayerIdFor(input.patientState);
  const requiredPos = requiredPosFor(input.patientState);
  const trimmedPayor = (input.payorId || "").trim();

  // ---- Payer ID matches patient state ----
  if (requiredPayer && trimmedPayor !== requiredPayer) {
    if (input.patientState === "NY") {
      hardStops.push({
        code: "WRONG_PAYER_NY",
        message: `Patient lives in NY but PR Payor ID is ${
          trimmedPayor || "blank"
        }. NY patients bill to Empire BCBS NY (${ANTHEM_NY_PAYER_ID}).`,
        fix: `Change PR Payor ID to ${ANTHEM_NY_PAYER_ID}.`,
      });
    } else if (
      input.patientState === "NJ" &&
      trimmedPayor === LEGACY_HORIZON_NJ_PAYER_ID
    ) {
      // Pre-cutover NJ claim. The destination is still Horizon NJ, just
      // under the retired ID — flag it so the operator can move it to
      // 11345, but never block the resubmission of an open claim.
      warnings.push({
        code: "LEGACY_NJ_PAYER_ID",
        message: `PR Payor ID is the legacy Horizon NJ ID (${LEGACY_HORIZON_NJ_PAYER_ID}). NJ patients now bill to ${HORIZON_NJ_PAYER_ID}.`,
        detail: `Move the row to ${HORIZON_NJ_PAYER_ID} unless this is a resubmission of a claim already open on ${LEGACY_HORIZON_NJ_PAYER_ID}, in which case submit as-is.`,
      });
    } else if (input.patientState === "FL") {
      // Florida patients are in network through CareCentrix Florida Blue
      // as of the 2026-09-10 amendment. Before that they fell through to
      // the out-of-state 803 route, so a Florida row still sitting on 803
      // is exactly the misroute this stop exists to catch.
      hardStops.push({
        code: "WRONG_PAYER_FL",
        message: `Patient lives in FL but PR Payor ID is ${
          trimmedPayor || "blank"
        }. FL patients bill to Florida Blue via CareCentrix (${CARECENTRIX_FL_PAYER_ID}).`,
        fix: `Change PR Payor ID to ${CARECENTRIX_FL_PAYER_ID}.`,
      });
    } else if (input.patientState === "NJ") {
      hardStops.push({
        code: "WRONG_PAYER_NJ",
        message: `Patient lives in NJ but PR Payor ID is ${
          trimmedPayor || "blank"
        }. NJ patients bill to Horizon BCBS NJ via CareCentrix (${HORIZON_NJ_PAYER_ID}).`,
        fix: `Change PR Payor ID to ${HORIZON_NJ_PAYER_ID}.`,
      });
    } else {
      hardStops.push({
        code: "WRONG_PAYER_OTHER",
        message: `Patient lives outside NY/NJ/FL but PR Payor ID is ${
          trimmedPayor || "blank"
        }. Out-of-state BlueCard claims bill to Anthem BCBS NY (${ANTHEM_NY_PAYER_ID}).`,
        fix: `Change PR Payor ID to ${ANTHEM_NY_PAYER_ID}.`,
      });
    }
  }

  // ---- POS matches patient state ----
  // POS defaults to Home on the backend when blank, but the operator
  // should still see an explicit error so the row's POS column matches
  // what will actually be billed.
  const pos = input.placeOfService ?? "Home";
  if (requiredPos && pos !== requiredPos) {
    if (
      input.patientState === "NY" ||
      input.patientState === "NJ" ||
      input.patientState === "FL"
    ) {
      hardStops.push({
        code: "WRONG_POS_NY_OR_NJ",
        message: `Patient lives in ${input.patientState} but POS is set to ${pos} (CMS ${
          pos === "Office" ? "11" : "12"
        }). NY/NJ/FL patients bill at POS 12 (Home).`,
        fix: "Change POS to Home on this row before submitting.",
        overridable: true,
      });
    } else {
      hardStops.push({
        code: "WRONG_POS_OTHER",
        message: `Patient lives outside NY/NJ/FL but POS is set to ${pos} (CMS ${
          pos === "Office" ? "11" : "12"
        }). Out-of-state BlueCard claims bill at POS 11 (Office).`,
        fix: "Change POS to Office on this row before submitting.",
        overridable: true,
      });
    }
  }

  // ---- Soft warning: CareCentrix + missing line auth ----
  // Fires when we're about to send to CareCentrix — Horizon NJ (11345, or
  // a legacy claim still on 11348) or Florida Blue (11345) — and at least
  // one subitem doesn't have an Auth ID. Uses the *required* payer for the
  // state or the currently-selected payer ID, whichever hits CareCentrix.
  //
  // Florida matters at least as much as NJ here: CareCentrix requires
  // authorization BEFORE start of care for Florida members, so a blank
  // Auth ID on a Florida claim is a real risk, not a formality.
  const isHittingCarecentrix =
    isHorizonNjPayerId(trimmedPayor) ||
    trimmedPayor === CARECENTRIX_FL_PAYER_ID ||
    (requiredPayer === HORIZON_NJ_PAYER_ID && hardStops.length === 0) ||
    (requiredPayer === CARECENTRIX_FL_PAYER_ID && hardStops.length === 0);
  if (isHittingCarecentrix) {
    const missingProducts: string[] = [];
    input.lineAuthIds.forEach((auth, idx) => {
      const hasAuth = (auth ?? "").trim().length > 0;
      if (!hasAuth) {
        const label = input.lineProducts?.[idx]?.trim() || `Line ${idx + 1}`;
        missingProducts.push(label);
      }
    });
    if (missingProducts.length > 0) {
      const isFlRoute = input.patientState === "FL";
      const carecentrixPlan = isFlRoute
        ? "CareCentrix / Florida Blue"
        : "CareCentrix / Horizon NJ";
      const carecentrixId =
        !isFlRoute && trimmedPayor === LEGACY_HORIZON_NJ_PAYER_ID
          ? LEGACY_HORIZON_NJ_PAYER_ID
          : isFlRoute
            ? CARECENTRIX_FL_PAYER_ID
            : HORIZON_NJ_PAYER_ID;
      warnings.push({
        code: "CARECENTRIX_AUTH_GAP",
        message:
          `Routing to ${carecentrixPlan} (${carecentrixId}) but no Auth ID is documented on ` +
          (missingProducts.length === input.lineAuthIds.length
            ? "any line."
            : missingProducts.join(", ") + "."),
        detail: isFlRoute
          ? "CareCentrix requires authorization before start of care for Florida members. Confirm the auth was obtained, then submit anyway if it's good."
          : "Confirm with the home plan that auth was obtained, then submit anyway if it's good.",
        productsMissingAuth: missingProducts,
      });
    }
  }

  // ---- Soft warning: supply lines missing the route's canonical modifiers ----
  // Modifiers are route-specific (see EXPECTED_LINE_MODIFIERS_BY_ROUTE):
  //   NY / other (803)     → A4230/A4232 = KX, A4239 = KF+KX+CG
  //   NJ (11345 / 11348)   → A4230/A4232 = NU+SC, A4239 = NU
  //   FL (11345)           → A4230 = NU, A4232 = NU+SC, A4239/E0784/E2103 = NU
  // We check against the ROUTE implied by the patient's state (the correct
  // destination), so a line built with KX while routing to CareCentrix —
  // or NU+SC on an A4230 heading to Florida, where SC is unpriced — is
  // flagged. Only runs when the caller hands us per-line HCPCS + modifiers.
  const billingRoute = billingRouteForState(input.patientState);
  if (input.lineHcpcs && input.lineModifiers && billingRoute) {
    const issues: string[] = [];
    input.lineHcpcs.forEach((hcpc, idx) => {
      const missing = missingLineModifiersForRoute(
        billingRoute,
        hcpc,
        input.lineModifiers?.[idx],
      );
      if (missing.length > 0) {
        const code = (hcpc || `line ${idx + 1}`).toUpperCase();
        const have = (input.lineModifiers?.[idx] ?? []).join("+") || "none";
        issues.push(`${code} missing ${missing.join("+")} (has ${have})`);
      }
    });
    if (issues.length > 0) {
      warnings.push({
        code: "MODIFIER_MISMATCH",
        message:
          "Supply line modifiers don't match the billing route: " +
          issues.join("; ") + ".",
        detail:
          expectedModifierSummary(billingRoute) +
          " Fix the Modifiers on each flagged line, then submit.",
      });
    }
  }

  return { applies, hardStops, warnings };
}

/** Convenience wrapper that pulls fields off a ThreadClaim. Mirrors
 *  evaluateBcbsSubmit but uses the shape PrimarySubmitBoard already
 *  has in hand. */
export function evaluateBcbsSubmitForThreadClaim(
  c: ThreadClaim,
  patientState: PatientStateBucket,
): BcbsGuardResult {
  return evaluateBcbsSubmit({
    payerLabel: c.payer,
    payorId: c.payor_id,
    placeOfService: c.place_of_service ?? null,
    patientState,
    lineAuthIds: c.items.map((i) => i.auth_id),
    lineProducts: c.items.map((i) => i.hcpc),
    lineHcpcs: c.items.map((i) => i.hcpc),
    lineModifiers: c.items.map((i) => i.modifiers),
  });
}
