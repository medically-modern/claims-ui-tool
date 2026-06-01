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
//   NJ            → Payer ID 11348  + POS 12 (Home)
//   any other     → Payer ID 803    + POS 11 (Office)
//
// Soft warning: claims being sent to 11348 (CareCentrix / Horizon NJ)
// where at least one subitem is missing an Auth ID. Doesn't block —
// confirms via a "submit anyway?" dialog.
//
// The validator only fires for claims that look like BCBS / Anthem at
// all. We treat that as: Primary Payor label mentions BCBS / Anthem /
// Blue Cross, OR the PR Payor ID is already set to 803 or 11348.

import type { ThreadClaim } from "./threads";

/** Payer ID for Anthem BCBS NY / Empire — used for NY patients AND for
 *  any out-of-state Blues that aren't NJ (Anthem handles the BlueCard
 *  inter-plan routing on our behalf for those). */
export const ANTHEM_NY_PAYER_ID = "803";

/** Payer ID for Horizon BCBS NJ via CareCentrix — used only when the
 *  patient lives in NJ, regardless of what their card says. */
export const CARECENTRIX_NJ_PAYER_ID = "11348";

export type PatientStateBucket = "NY" | "NJ" | "OTHER" | "UNKNOWN";

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
}

export interface BcbsHardStop {
  code:
    | "STATE_UNKNOWN"
    | "WRONG_PAYER_NY"
    | "WRONG_PAYER_NJ"
    | "WRONG_PAYER_OTHER"
    | "WRONG_POS_NY_OR_NJ"
    | "WRONG_POS_OTHER";
  message: string;
  fix: string;
}

export interface BcbsWarning {
  code: "CARECENTRIX_AUTH_GAP";
  message: string;
  /** Product labels that are missing auth (for the dialog body). */
  productsMissingAuth: string[];
}

export interface BcbsGuardResult {
  /** True when the claim is in scope (BCBS/Anthem by label or routed via 803/11348). */
  applies: boolean;
  hardStops: BcbsHardStop[];
  warnings: BcbsWarning[];
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
    s.includes("horizon")
  );
}

/** True when the PR Payor ID is one of the BCBS routing IDs we manage. */
export function isBcbsByPayorId(payorId: string | null | undefined): boolean {
  if (!payorId) return false;
  const trimmed = payorId.trim();
  return trimmed === ANTHEM_NY_PAYER_ID || trimmed === CARECENTRIX_NJ_PAYER_ID;
}

/** Parse a Monday Address column's text value down to a 2-letter US
 *  state bucket. Monday returns the location column's text in the rough
 *  form "123 Main St, Brooklyn, NY 11201, US". We look for a free-floating
 *  two-letter token (case-insensitive) and bucket to NY / NJ / OTHER.
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
  if (state === "NJ") return CARECENTRIX_NJ_PAYER_ID;
  if (state === "OTHER") return ANTHEM_NY_PAYER_ID;
  return null;
}

/** Resolve the "required" POS for a patient state bucket. */
export function requiredPosFor(state: PatientStateBucket): "Home" | "Office" | null {
  if (state === "NY" || state === "NJ") return "Home";
  if (state === "OTHER") return "Office";
  return null;
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
    } else if (input.patientState === "NJ") {
      hardStops.push({
        code: "WRONG_PAYER_NJ",
        message: `Patient lives in NJ but PR Payor ID is ${
          trimmedPayor || "blank"
        }. NJ patients bill to Horizon BCBS NJ via CareCentrix (${CARECENTRIX_NJ_PAYER_ID}).`,
        fix: `Change PR Payor ID to ${CARECENTRIX_NJ_PAYER_ID}.`,
      });
    } else {
      hardStops.push({
        code: "WRONG_PAYER_OTHER",
        message: `Patient lives outside NY/NJ but PR Payor ID is ${
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
    if (input.patientState === "NY" || input.patientState === "NJ") {
      hardStops.push({
        code: "WRONG_POS_NY_OR_NJ",
        message: `Patient lives in ${input.patientState} but POS is set to ${pos} (CMS ${
          pos === "Office" ? "11" : "12"
        }). NY/NJ patients bill at POS 12 (Home).`,
        fix: "Change POS to Home on this row before submitting.",
      });
    } else {
      hardStops.push({
        code: "WRONG_POS_OTHER",
        message: `Patient lives outside NY/NJ but POS is set to ${pos} (CMS ${
          pos === "Office" ? "11" : "12"
        }). Out-of-state BlueCard claims bill at POS 11 (Office).`,
        fix: "Change POS to Office on this row before submitting.",
      });
    }
  }

  // ---- Soft warning: CareCentrix / Horizon NJ + missing line auth ----
  // Fires when we're about to send to 11348 and at least one subitem
  // doesn't have an Auth ID. Uses the *required* payer for NJ or the
  // currently-selected payer ID, whichever is hitting 11348.
  const isHittingCarecentrix =
    trimmedPayor === CARECENTRIX_NJ_PAYER_ID ||
    (requiredPayer === CARECENTRIX_NJ_PAYER_ID && hardStops.length === 0);
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
      warnings.push({
        code: "CARECENTRIX_AUTH_GAP",
        message:
          "Routing to CareCentrix / Horizon NJ (11348) but no Auth ID is documented on " +
          (missingProducts.length === input.lineAuthIds.length
            ? "any line."
            : missingProducts.join(", ") + "."),
        productsMissingAuth: missingProducts,
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
  });
}
