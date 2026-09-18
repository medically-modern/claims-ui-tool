// Verification tests for the BCBS / Anthem pre-submit validator.
// Mirrors the scenarios in ANTHEM_SUBMISSION_RULES.md plus the real
// cases that motivated this feature (Kai Burridge stale MA address,
// Jerry Domanico POS=Office mismatch).

import { describe, expect, it } from "vitest";
import {
  evaluateBcbsSubmit,
  parsePatientStateFromAddress,
  isBcbsByPayerLabel,
  isBcbsByPayorId,
  ANTHEM_NY_PAYER_ID,
  HORIZON_NJ_PAYER_ID,
  CARECENTRIX_FL_PAYER_ID,
  LEGACY_HORIZON_NJ_PAYER_ID,
  BCBS_TN_PAYER_ID,
  BCBS_WY_PAYER_ID,
  resolveLabelRoutedBluePlan,
  canOverrideHardStops,
  requiredPayerIdFor,
  requiredPosFor,
  billingRouteForState,
  missingLineModifiersForRoute,
  missingLineModifiers,
  EXPECTED_LINE_MODIFIERS_BY_ROUTE,
  EXPECTED_LINE_MODIFIERS_BY_PAYER,
} from "./bcbsSubmitGuard";

describe("parsePatientStateFromAddress", () => {
  it("parses NY from Brooklyn-style address", () => {
    expect(parsePatientStateFromAddress("123 Main St, Brooklyn, NY 11201, US"))
      .toBe("NY");
  });

  it("parses NJ", () => {
    expect(parsePatientStateFromAddress("45 Pine Ave, Newark, NJ 07102, US"))
      .toBe("NJ");
  });

  it("parses FL as its own bucket, not OTHER", () => {
    expect(parsePatientStateFromAddress("900 Ocean Dr, Miami, FL 33139, US"))
      .toBe("FL");
  });

  it("buckets MA as OTHER", () => {
    expect(parsePatientStateFromAddress("12 Elm St, Waltham, MA 02451, US"))
      .toBe("OTHER");
  });

  it("returns UNKNOWN on blank", () => {
    expect(parsePatientStateFromAddress("")).toBe("UNKNOWN");
    expect(parsePatientStateFromAddress(null)).toBe("UNKNOWN");
    expect(parsePatientStateFromAddress(undefined)).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when no state code is parseable", () => {
    expect(parsePatientStateFromAddress("just a name, no state info"))
      .toBe("UNKNOWN");
  });

  it("handles lowercase state", () => {
    expect(parsePatientStateFromAddress("123 Main St, Brooklyn, ny 11201"))
      .toBe("NY");
  });
});

describe("isBcbsByPayerLabel", () => {
  it("matches BCBS variants", () => {
    expect(isBcbsByPayerLabel("Anthem BCBS Co.")).toBe(true);
    expect(isBcbsByPayerLabel("Empire BCBS NY")).toBe(true);
    expect(isBcbsByPayerLabel("Blue Cross Blue Shield")).toBe(true);
    expect(isBcbsByPayerLabel("Horizon BCBS NJ")).toBe(true);
    // Florida Blue carries none of the other tokens but IS a Blues plan.
    expect(isBcbsByPayerLabel("Florida Blue")).toBe(true);
    expect(isBcbsByPayerLabel("BCBS FL")).toBe(true);
    expect(isBcbsByPayerLabel("Anthem Healthcare")).toBe(true);
  });

  it("rejects non-BCBS payers", () => {
    expect(isBcbsByPayerLabel("Aetna")).toBe(false);
    expect(isBcbsByPayerLabel("United Healthcare")).toBe(false);
    expect(isBcbsByPayerLabel("Cigna")).toBe(false);
    expect(isBcbsByPayerLabel("")).toBe(false);
    expect(isBcbsByPayerLabel(null)).toBe(false);
  });
});

describe("isBcbsByPayorId", () => {
  it("recognizes 803 and 11345", () => {
    expect(isBcbsByPayorId("803")).toBe(true);
    expect(isBcbsByPayorId("11345")).toBe(true);
    expect(isBcbsByPayorId(" 11345 ")).toBe(true);
  });

  it("keeps the legacy NJ ID 11348 in scope", () => {
    // 14 claims are still open on 11348; a resubmission must stay
    // inside the guard rather than skipping it entirely.
    expect(isBcbsByPayorId("11348")).toBe(true);
    expect(isBcbsByPayorId(" 11348 ")).toBe(true);
  });

  it("rejects unrelated IDs", () => {
    expect(isBcbsByPayorId("MCDNY")).toBe(false);
    expect(isBcbsByPayorId("87726")).toBe(false);
    expect(isBcbsByPayorId(null)).toBe(false);
  });
});

describe("evaluateBcbsSubmit — out of scope", () => {
  it("returns applies=false for non-BCBS claims", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Aetna",
      payorId: "87726",
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: [],
    });
    expect(r.applies).toBe(false);
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe("evaluateBcbsSubmit — happy paths", () => {
  it("NY patient + 803 + POS Home — no errors", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "803",
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH123"],
    });
    expect(r.applies).toBe(true);
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("NJ patient + 11345 + POS Home + line auths present — no errors", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "11345",
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: ["AUTH-A", "AUTH-B"],
    });
    expect(r.applies).toBe(true);
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("MA patient + 803 + POS Office — no errors", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "803",
      placeOfService: "Office",
      patientState: "OTHER",
      lineAuthIds: ["AUTH-X"],
    });
    expect(r.applies).toBe(true);
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe("evaluateBcbsSubmit — hard stops", () => {
  it("blocks NY patient routed to 11345 (Kai Burridge-style stale address)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "11345",
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
    });
    expect(r.applies).toBe(true);
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("WRONG_PAYER_NY");
  });

  it("blocks NJ patient routed to 803", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "803",
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: [],
    });
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("WRONG_PAYER_NJ");
  });

  it("blocks MA patient routed via 11345", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "11345",
      placeOfService: "Office",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("WRONG_PAYER_OTHER");
  });

  it("blocks Jerry Domanico case: in-NY/NJ patient with POS Office", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "803",
      placeOfService: "Office", // wrong: should be Home for NY
      patientState: "NY",
      lineAuthIds: ["AUTH"],
    });
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("WRONG_POS_NY_OR_NJ");
  });

  it("blocks out-of-state patient with POS Home", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "803",
      placeOfService: "Home", // wrong: out-of-state should be Office
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("WRONG_POS_OTHER");
  });

  it("blocks when state can't be parsed", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "803",
      placeOfService: "Home",
      patientState: "UNKNOWN",
      lineAuthIds: ["AUTH"],
    });
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("STATE_UNKNOWN");
    // No follow-on errors when state is unknown — early return.
    expect(r.hardStops.length).toBe(1);
  });

  it("flags multiple issues at once (wrong payer + wrong POS)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "803", // wrong for NJ
      placeOfService: "Office", // wrong for NJ
      patientState: "NJ",
      lineAuthIds: [],
    });
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("WRONG_PAYER_NJ");
    expect(codes).toContain("WRONG_POS_NY_OR_NJ");
  });

  it("fires when payor ID is blank (still BCBS by label)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: null,
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
    });
    const codes = r.hardStops.map((h) => h.code);
    expect(codes).toContain("WRONG_PAYER_NY");
  });
});

describe("evaluateBcbsSubmit — soft warnings", () => {
  it("warns when routing to 11345 with at least one missing line auth", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: HORIZON_NJ_PAYER_ID,
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: ["AUTH-A", "", "AUTH-C"],
      lineProducts: ["A4239", "A4232", "E2103"],
    });
    expect(r.hardStops).toEqual([]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].code).toBe("CARECENTRIX_AUTH_GAP");
    expect(r.warnings[0].productsMissingAuth).toEqual(["A4232"]);
  });

  it("warns when all line auths are blank", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: HORIZON_NJ_PAYER_ID,
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: [null, undefined, ""],
      lineProducts: ["A4239", "A4232", "E2103"],
    });
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].productsMissingAuth.length).toBe(3);
  });

  it("does not warn when all line auths are present", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: HORIZON_NJ_PAYER_ID,
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: ["AUTH-A", "AUTH-B"],
      lineProducts: ["A4239", "A4232"],
    });
    expect(r.warnings).toEqual([]);
  });

  it("does not warn for NY claim (not routed to Horizon NJ)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: ANTHEM_NY_PAYER_ID,
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["", ""], // no auths but doesn't matter for non-NJ
      lineProducts: ["A4239", "A4232"],
    });
    expect(r.warnings).toEqual([]);
  });
});

// ── Legacy Horizon NJ payer ID (11348 → 11345 cutover) ──────────────────────
// Claims submitted before the cutover are still open on 11348. A
// resubmission has to stay inside the guard AND has to get through it:
// a soft warning is fine, a hard stop would strand the claim.
describe("evaluateBcbsSubmit — legacy NJ payer ID 11348", () => {
  const NJ_ON_LEGACY = {
    payerLabel: "Horizon BCBS NJ",
    payorId: LEGACY_HORIZON_NJ_PAYER_ID,
    placeOfService: "Home" as const,
    patientState: "NJ" as const,
    lineAuthIds: ["AUTH-A", "AUTH-B"],
  };

  it("does NOT hard-stop an NJ claim still sitting on 11348", () => {
    const r = evaluateBcbsSubmit(NJ_ON_LEGACY);
    expect(r.applies).toBe(true);
    expect(r.hardStops).toEqual([]);
    expect(canOverrideHardStops(r)).toBe(false);
  });

  it("raises a soft LEGACY_NJ_PAYER_ID warning naming 11345 as the new ID", () => {
    const r = evaluateBcbsSubmit(NJ_ON_LEGACY);
    const w = r.warnings.find((x) => x.code === "LEGACY_NJ_PAYER_ID");
    expect(w).toBeDefined();
    expect(w!.message).toContain(LEGACY_HORIZON_NJ_PAYER_ID);
    expect(w!.message).toContain(HORIZON_NJ_PAYER_ID);
  });

  it("still checks POS on a legacy claim (POS Office is a hard stop)", () => {
    const r = evaluateBcbsSubmit({ ...NJ_ON_LEGACY, placeOfService: "Office" });
    expect(r.hardStops.map((h) => h.code)).toEqual(["WRONG_POS_NY_OR_NJ"]);
    // POS-only, so the operator can still override it — the legacy payer
    // ID doesn't lock the dialog the way a real payer mismatch would.
    expect(canOverrideHardStops(r)).toBe(true);
  });

  it("still raises the CareCentrix auth gap on a legacy claim", () => {
    const r = evaluateBcbsSubmit({
      ...NJ_ON_LEGACY,
      lineAuthIds: ["AUTH-A", ""],
      lineProducts: ["A4239", "A4232"],
    });
    expect(r.hardStops).toEqual([]);
    const gap = r.warnings.find((w) => w.code === "CARECENTRIX_AUTH_GAP");
    expect(gap).toBeDefined();
    expect(gap!.productsMissingAuth).toEqual(["A4232"]);
    expect(gap!.message).toContain(LEGACY_HORIZON_NJ_PAYER_ID);
  });

  it("still applies NJ modifier rules to a legacy claim", () => {
    const r = evaluateBcbsSubmit({
      ...NJ_ON_LEGACY,
      lineHcpcs: ["A4232", "A4230"],
      lineModifiers: [["KX"], ["KX"]],
    });
    expect(r.hardStops).toEqual([]);
    expect(r.warnings.some((w) => w.code === "MODIFIER_MISMATCH")).toBe(true);
  });

  it("blank payor ID for an NJ patient is still a hard stop (not legacy)", () => {
    const r = evaluateBcbsSubmit({ ...NJ_ON_LEGACY, payorId: null });
    expect(r.hardStops.map((h) => h.code)).toContain("WRONG_PAYER_NJ");
  });

  it("11348 on a NY patient is still a hard stop — wrong state, not legacy", () => {
    const r = evaluateBcbsSubmit({ ...NJ_ON_LEGACY, patientState: "NY" });
    expect(r.hardStops.map((h) => h.code)).toContain("WRONG_PAYER_NY");
  });
});

describe("evaluateBcbsSubmit — modifier mismatch", () => {
  it("warns when a CareCentrix (NJ) line has KX instead of NU+SC (Esther Reich)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Horizon BCBS",
      payorId: HORIZON_NJ_PAYER_ID,
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: ["AUTH-A", "AUTH-B"],
      lineHcpcs: ["A4232", "A4230"],
      lineModifiers: [["KX"], ["KX"]],
    });
    expect(r.hardStops).toEqual([]);
    expect(r.warnings.some((w) => w.code === "MODIFIER_MISMATCH")).toBe(true);
  });

  it("no modifier warning when NJ lines carry NU+SC / NU", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Horizon BCBS",
      payorId: HORIZON_NJ_PAYER_ID,
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: ["AUTH-A", "AUTH-B", "AUTH-C"],
      lineHcpcs: ["A4230", "A4232", "A4239"],
      lineModifiers: [["NU", "SC"], ["NU", "SC"], ["NU"]],
    });
    expect(r.warnings).toEqual([]);
  });

  it("no modifier warning when NY (803) lines carry KX / KF+KX+CG", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: ANTHEM_NY_PAYER_ID,
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
      lineHcpcs: ["A4230", "A4232", "A4239"],
      lineModifiers: [["KX"], ["KX"], ["KF", "KX", "CG"]],
    });
    expect(r.warnings).toEqual([]);
  });

  it("flags NY (803) line carrying NU+SC (should be KX)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: ANTHEM_NY_PAYER_ID,
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
      lineHcpcs: ["A4230"],
      lineModifiers: [["NU", "SC"]],
    });
    expect(r.warnings.some((w) => w.code === "MODIFIER_MISMATCH")).toBe(true);
  });

  it("flags 803 A4239 missing KF/CG", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: ANTHEM_NY_PAYER_ID,
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
      lineHcpcs: ["A4239"],
      lineModifiers: [["KX"]],
    });
    expect(r.warnings.some((w) => w.code === "MODIFIER_MISMATCH")).toBe(true);
  });

  it("ignores HCPCS with no canonical expectation (E0784)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: ANTHEM_NY_PAYER_ID,
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
      lineHcpcs: ["E0784"],
      lineModifiers: [["KX", "NU"]],
    });
    expect(r.warnings).toEqual([]);
  });

  it("skips the modifier check entirely when lineModifiers not provided", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: ANTHEM_NY_PAYER_ID,
      placeOfService: "Home",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
    });
    expect(r.warnings).toEqual([]);
  });
});

describe("evaluateBcbsSubmit — scope detection by payor ID alone", () => {
  it("fires for a generic payer label when payor ID is 803", () => {
    // Misrouting protection: even if the operator forgot to label this
    // as Anthem, payor ID 803 means we ARE sending to Anthem NY, so
    // the validator should apply.
    const r = evaluateBcbsSubmit({
      payerLabel: "Some Random Payer",
      payorId: "803",
      placeOfService: "Office",
      patientState: "NY",
      lineAuthIds: ["AUTH"],
    });
    expect(r.applies).toBe(true);
    // NY + POS Office is a hard stop.
    expect(r.hardStops.some((h) => h.code === "WRONG_POS_NY_OR_NJ")).toBe(true);
  });
});


describe("evaluateBcbsSubmit — BCBS Tennessee (direct, SB890)", () => {
  it("clears a clean TN claim: SB890 + POS Home + NU lines, no 803/Office stops", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS TN",
      payorId: BCBS_TN_PAYER_ID,
      placeOfService: "Home",
      patientState: "OTHER",
      lineAuthIds: ["AUTH", "", ""],
      lineHcpcs: ["A4239", "A4224", "A4225"],
      lineModifiers: [["NU"], ["NU"], ["NU"]],
    });
    expect(r.applies).toBe(true);
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("does NOT force 803/Office for a TN patient (the old BlueCard trap)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS TN",
      payorId: BCBS_TN_PAYER_ID,
      placeOfService: "Home",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.hardStops.some((h) => h.code === "WRONG_PAYER_OTHER")).toBe(false);
    expect(r.hardStops.some((h) => h.code === "WRONG_POS_OTHER")).toBe(false);
  });

  it("hard-stops when a TN claim has the wrong payer ID (e.g. left on 803)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS TN",
      payorId: "803",
      placeOfService: "Home",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.hardStops.some((h) => h.code === "WRONG_PAYER_LABEL_ROUTED")).toBe(true);
  });

  it("hard-stops when POS is Office for TN (should be Home/12)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS TN",
      payorId: BCBS_TN_PAYER_ID,
      placeOfService: "Office",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.hardStops.some((h) => h.code === "WRONG_POS_LABEL_ROUTED")).toBe(true);
  });

  it("warns (soft) when a TN line is missing the NU modifier", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS TN",
      payorId: BCBS_TN_PAYER_ID,
      placeOfService: "Home",
      patientState: "OTHER",
      lineAuthIds: ["AUTH", ""],
      lineHcpcs: ["A4239", "A4224"],
      lineModifiers: [["NU"], ["KX"]],
    });
    expect(r.warnings.some((w) => w.code === "MODIFIER_MISMATCH")).toBe(true);
    expect(r.hardStops).toEqual([]);
  });

  it("resolveLabelRoutedBluePlan matches by label and by SB890 id", () => {
    expect(resolveLabelRoutedBluePlan("BCBS TN", null)?.payerId).toBe(BCBS_TN_PAYER_ID);
    expect(resolveLabelRoutedBluePlan(null, "SB890")?.payerId).toBe(BCBS_TN_PAYER_ID);
    expect(resolveLabelRoutedBluePlan("Anthem BCBS", "803")).toBeNull();
  });
});


describe("evaluateBcbsSubmit — BCBS Wyoming (direct, 53767)", () => {
  it("clears a clean WY claim: 53767 + POS Home, no 803/Office forcing (Sue Snider Guerra)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS Wyoming",
      payorId: BCBS_WY_PAYER_ID,
      placeOfService: "Home",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.applies).toBe(true);
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("does NOT force 803/Office for a WY patient (the old BlueCard trap)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS Wyoming",
      payorId: BCBS_WY_PAYER_ID,
      placeOfService: "Home",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.hardStops.some((h) => h.code === "WRONG_PAYER_OTHER")).toBe(false);
    expect(r.hardStops.some((h) => h.code === "WRONG_POS_OTHER")).toBe(false);
  });

  it("keeps the row's POS — Office does NOT hard-stop for WY (requiredPos null)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS Wyoming",
      payorId: BCBS_WY_PAYER_ID,
      placeOfService: "Office",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.hardStops).toEqual([]);
  });

  it("hard-stops when a WY claim has the wrong payer ID (e.g. left on 803)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS Wyoming",
      payorId: "803",
      placeOfService: "Home",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.hardStops.some((h) => h.code === "WRONG_PAYER_LABEL_ROUTED")).toBe(true);
  });

  it("resolveLabelRoutedBluePlan matches WY by label and by 53767 id", () => {
    expect(resolveLabelRoutedBluePlan("BCBS Wyoming", null)?.payerId).toBe(BCBS_WY_PAYER_ID);
    expect(resolveLabelRoutedBluePlan(null, "53767")?.payerId).toBe(BCBS_WY_PAYER_ID);
    expect(resolveLabelRoutedBluePlan("BCBS Wyoming", null)?.requiredPos).toBeNull();
  });
});

// ── Operator override of POS hard stops ──────────────────────────────────────
// Rare-but-real: a NY/NJ patient who really should bill at POS 11. The
// guard dialog offers an override for POS stops only — never for payer
// ID or unresolvable address.

// ── BCBS FL (Florida Blue via CareCentrix, 11345) ───────────────────────────
// As of the 2026-09-10 CareCentrix amendment, Florida patients are in
// network through CareCentrix Florida Blue. Before it they fell through
// the "any other state" rule and billed Anthem 803 + POS Office, so these
// cases guard the new branch AND the fact that it no longer leaks to 803.
//
// FL shares destination payer ID 11345 with Horizon NJ but is a SEPARATE
// billing route: the fee schedules differ on A4230.
describe("evaluateBcbsSubmit — BCBS FL (Florida Blue via CareCentrix)", () => {
  const FL_BASE = {
    payerLabel: "Florida Blue",
    payorId: CARECENTRIX_FL_PAYER_ID,
    placeOfService: "Home" as const,
    patientState: "FL" as const,
    lineAuthIds: ["AUTH-A", "AUTH-B"],
  };

  it("clean FL claim on 11345 + POS Home passes with no stops or warnings", () => {
    const r = evaluateBcbsSubmit(FL_BASE);
    expect(r.applies).toBe(true);
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("requiredPayerIdFor(FL) is 11345, NOT 803", () => {
    expect(requiredPayerIdFor("FL")).toBe(CARECENTRIX_FL_PAYER_ID);
    expect(requiredPayerIdFor("FL")).not.toBe(ANTHEM_NY_PAYER_ID);
  });

  it("requiredPosFor(FL) is Home, NOT Office", () => {
    expect(requiredPosFor("FL")).toBe("Home");
  });

  it("hard-stops an FL patient still sitting on Anthem 803", () => {
    const r = evaluateBcbsSubmit({ ...FL_BASE, payorId: ANTHEM_NY_PAYER_ID });
    expect(r.hardStops.map((h) => h.code)).toContain("WRONG_PAYER_FL");
    expect(r.hardStops[0].message).toContain(CARECENTRIX_FL_PAYER_ID);
    // Payer-ID stops are never overridable.
    expect(canOverrideHardStops(r)).toBe(false);
  });

  it("hard-stops a blank payor ID on an FL patient", () => {
    const r = evaluateBcbsSubmit({ ...FL_BASE, payorId: null });
    expect(r.hardStops.map((h) => h.code)).toContain("WRONG_PAYER_FL");
  });

  it("hard-stops FL on the legacy NJ ID 11348 — FL was never on 11348", () => {
    const r = evaluateBcbsSubmit({
      ...FL_BASE,
      payorId: LEGACY_HORIZON_NJ_PAYER_ID,
    });
    expect(r.hardStops.map((h) => h.code)).toContain("WRONG_PAYER_FL");
    // The legacy soft-warning escape hatch is NJ-only.
    expect(r.warnings.some((w) => w.code === "LEGACY_NJ_PAYER_ID")).toBe(false);
  });

  it("hard-stops POS Office on an FL patient, and it IS overridable", () => {
    const r = evaluateBcbsSubmit({ ...FL_BASE, placeOfService: "Office" });
    expect(r.hardStops.map((h) => h.code)).toEqual(["WRONG_POS_NY_OR_NJ"]);
    expect(canOverrideHardStops(r)).toBe(true);
  });

  // The BlueCard case from the handoff: an out-of-area Blues member (card
  // says BCBS PA) who LIVES in Florida. Address is the master switch, so
  // this routes to 11345 — the pre-amendment behaviour would have sent it
  // to 803 + POS Office.
  it("routes an out-of-state Blues member living in FL to 11345, not 803", () => {
    const onFlRoute = evaluateBcbsSubmit({
      payerLabel: "BCBS PA",
      payorId: CARECENTRIX_FL_PAYER_ID,
      placeOfService: "Home",
      patientState: "FL",
      lineAuthIds: ["AUTH-A"],
    });
    expect(onFlRoute.applies).toBe(true);
    expect(onFlRoute.hardStops).toEqual([]);

    const onAnthem = evaluateBcbsSubmit({
      payerLabel: "BCBS PA",
      payorId: ANTHEM_NY_PAYER_ID,
      placeOfService: "Office",
      patientState: "FL",
      lineAuthIds: ["AUTH-A"],
    });
    expect(onAnthem.hardStops.map((h) => h.code)).toEqual([
      "WRONG_PAYER_FL",
      "WRONG_POS_NY_OR_NJ",
    ]);
  });

  it("raises the CareCentrix auth gap on an FL claim missing a line auth", () => {
    const r = evaluateBcbsSubmit({
      ...FL_BASE,
      lineAuthIds: ["AUTH-A", ""],
      lineProducts: ["A4239", "A4232"],
    });
    expect(r.hardStops).toEqual([]);
    const gap = r.warnings.find((w) => w.code === "CARECENTRIX_AUTH_GAP");
    expect(gap).toBeDefined();
    expect(gap!.productsMissingAuth).toEqual(["A4232"]);
    expect(gap!.message).toContain("Florida Blue");
    expect(gap!.message).toContain(CARECENTRIX_FL_PAYER_ID);
    // Florida auth must be secured before start of care — the detail line
    // has to say so rather than reusing the generic NJ copy.
    expect(gap!.detail).toContain("before start of care");
  });

  it("does not raise the auth gap when every FL line carries an auth", () => {
    const r = evaluateBcbsSubmit({
      ...FL_BASE,
      lineProducts: ["A4239", "A4232"],
    });
    expect(r.warnings).toEqual([]);
  });
});

// ── The shared-11345 split: NJ and FL price A4230 differently ───────────────
// This is the case that forced the modifier table off payer-ID keying.
// A4230 with an SC is correct for NJ and UNPRICED in Florida (277 reject,
// "No rate on file ..."), so the same payer ID must yield two verdicts.
describe("modifiers on the shared 11345 destination — NJ vs FL", () => {
  const A4230_NU_ONLY = {
    lineAuthIds: ["AUTH-A"],
    lineHcpcs: ["A4230"],
    lineModifiers: [["NU"]],
    placeOfService: "Home" as const,
  };
  const A4230_NU_SC = { ...A4230_NU_ONLY, lineModifiers: [["NU", "SC"]] };

  it("NJ still requires NU+SC on A4230 — NU alone is flagged", () => {
    const r = evaluateBcbsSubmit({
      ...A4230_NU_ONLY,
      payerLabel: "Horizon BCBS NJ",
      payorId: HORIZON_NJ_PAYER_ID,
      patientState: "NJ",
    });
    const w = r.warnings.find((x) => x.code === "MODIFIER_MISMATCH");
    expect(w).toBeDefined();
    expect(w!.message).toContain("SC");
  });

  it("FL accepts A4230 with NU alone — same payer ID, no warning", () => {
    const r = evaluateBcbsSubmit({
      ...A4230_NU_ONLY,
      payerLabel: "Florida Blue",
      payorId: CARECENTRIX_FL_PAYER_ID,
      patientState: "FL",
    });
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("NJ accepts A4230 with NU+SC — the mirror of the FL case", () => {
    const r = evaluateBcbsSubmit({
      ...A4230_NU_SC,
      payerLabel: "Horizon BCBS NJ",
      payorId: HORIZON_NJ_PAYER_ID,
      patientState: "NJ",
    });
    expect(r.warnings).toEqual([]);
  });

  it("FL A4232 keeps NU+SC — NU alone is flagged", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Florida Blue",
      payorId: CARECENTRIX_FL_PAYER_ID,
      placeOfService: "Home",
      patientState: "FL",
      lineAuthIds: ["AUTH-A"],
      lineHcpcs: ["A4232"],
      lineModifiers: [["NU"]],
    });
    expect(r.warnings.some((w) => w.code === "MODIFIER_MISMATCH")).toBe(true);
  });

  it("FL polices E0784 / E2103 as NU (NJ leaves them unchecked)", () => {
    const fl = evaluateBcbsSubmit({
      payerLabel: "Florida Blue",
      payorId: CARECENTRIX_FL_PAYER_ID,
      placeOfService: "Home",
      patientState: "FL",
      lineAuthIds: ["AUTH-A", "AUTH-B"],
      lineHcpcs: ["E0784", "E2103"],
      lineModifiers: [["KX"], ["KX"]],
    });
    expect(fl.warnings.some((w) => w.code === "MODIFIER_MISMATCH")).toBe(true);

    const nj = evaluateBcbsSubmit({
      payerLabel: "Horizon BCBS NJ",
      payorId: HORIZON_NJ_PAYER_ID,
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: ["AUTH-A", "AUTH-B"],
      lineHcpcs: ["E0784", "E2103"],
      lineModifiers: [["KX"], ["KX"]],
    });
    expect(nj.warnings).toEqual([]);
  });

  it("a clean full FL line set raises nothing", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Florida Blue",
      payorId: CARECENTRIX_FL_PAYER_ID,
      placeOfService: "Home",
      patientState: "FL",
      lineAuthIds: ["A", "B", "C", "D", "E"],
      lineHcpcs: ["A4230", "A4232", "A4239", "E0784", "E2103"],
      lineModifiers: [["NU"], ["NU", "SC"], ["NU"], ["NU"], ["NU"]],
    });
    expect(r.hardStops).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("the FL detail line names the NU-only A4230 rule", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Florida Blue",
      payorId: CARECENTRIX_FL_PAYER_ID,
      placeOfService: "Home",
      patientState: "FL",
      lineAuthIds: ["AUTH-A"],
      lineHcpcs: ["A4239"],
      lineModifiers: [["KX"]],
    });
    const w = r.warnings.find((x) => x.code === "MODIFIER_MISMATCH");
    expect(w!.detail).toContain("Florida Blue");
    expect(w!.detail).toContain("A4230 \u2192 NU");
  });
});

// Route keying is the mechanism the NJ/FL split depends on — check it
// directly so a regression points at the table, not at a claim scenario.
describe("billingRouteForState / EXPECTED_LINE_MODIFIERS_BY_ROUTE", () => {
  it("maps each bucket to its route", () => {
    expect(billingRouteForState("NY")).toBe("ANTHEM_NY");
    expect(billingRouteForState("OTHER")).toBe("ANTHEM_NY");
    expect(billingRouteForState("NJ")).toBe("HORIZON_NJ");
    expect(billingRouteForState("FL")).toBe("CARECENTRIX_FL");
    expect(billingRouteForState("UNKNOWN")).toBeNull();
  });

  it("NJ and FL are distinct routes despite sharing payer ID 11345", () => {
    expect(CARECENTRIX_FL_PAYER_ID).toBe(HORIZON_NJ_PAYER_ID);
    expect(billingRouteForState("FL")).not.toBe(billingRouteForState("NJ"));
    expect(EXPECTED_LINE_MODIFIERS_BY_ROUTE.CARECENTRIX_FL.A4230)
      .toEqual(["NU"]);
    expect(EXPECTED_LINE_MODIFIERS_BY_ROUTE.HORIZON_NJ.A4230)
      .toEqual(["NU", "SC"]);
  });

  it("missingLineModifiersForRoute splits A4230 by route", () => {
    expect(missingLineModifiersForRoute("CARECENTRIX_FL", "A4230", ["NU"]))
      .toEqual([]);
    expect(missingLineModifiersForRoute("HORIZON_NJ", "A4230", ["NU"]))
      .toEqual(["SC"]);
  });

  it("returns [] for a null route or an unpoliced code", () => {
    expect(missingLineModifiersForRoute(null, "A4230", [])).toEqual([]);
    expect(missingLineModifiersForRoute("HORIZON_NJ", "E0784", [])).toEqual([]);
  });

  it("the deprecated payer-ID shim still resolves 11345 to NJ", () => {
    expect(EXPECTED_LINE_MODIFIERS_BY_PAYER[HORIZON_NJ_PAYER_ID].A4230)
      .toEqual(["NU", "SC"]);
    expect(missingLineModifiers(HORIZON_NJ_PAYER_ID, "A4230", ["NU"]))
      .toEqual(["SC"]);
  });
});

describe("canOverrideHardStops", () => {
  const NY_POS_OFFICE = {
    payerLabel: "Empire BCBS",
    payorId: ANTHEM_NY_PAYER_ID,
    placeOfService: "Office" as const,
    patientState: "NY" as const,
    lineAuthIds: ["AUTH"],
  };

  it("allows override when the only stop is the NY/NJ POS rule", () => {
    const r = evaluateBcbsSubmit(NY_POS_OFFICE);
    expect(r.hardStops.map((h) => h.code)).toEqual(["WRONG_POS_NY_OR_NJ"]);
    expect(r.hardStops[0].overridable).toBe(true);
    expect(canOverrideHardStops(r)).toBe(true);
  });

  it("allows override for the out-of-state POS rule", () => {
    const r = evaluateBcbsSubmit({
      ...NY_POS_OFFICE,
      patientState: "OTHER",
      placeOfService: "Home",
    });
    expect(r.hardStops.map((h) => h.code)).toEqual(["WRONG_POS_OTHER"]);
    expect(canOverrideHardStops(r)).toBe(true);
  });

  it("allows override for a label-routed POS mismatch (BCBS TN at Office)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "BCBS Tennessee",
      payorId: BCBS_TN_PAYER_ID,
      placeOfService: "Office",
      patientState: "OTHER",
      lineAuthIds: ["AUTH"],
    });
    expect(r.hardStops.map((h) => h.code)).toEqual(["WRONG_POS_LABEL_ROUTED"]);
    expect(canOverrideHardStops(r)).toBe(true);
  });

  it("refuses override when a payer ID stop rides along with the POS stop", () => {
    const r = evaluateBcbsSubmit({ ...NY_POS_OFFICE, payorId: HORIZON_NJ_PAYER_ID });
    expect(r.hardStops.some((h) => h.code === "WRONG_PAYER_NY")).toBe(true);
    expect(canOverrideHardStops(r)).toBe(false);
  });

  it("refuses override for an unresolvable patient state", () => {
    const r = evaluateBcbsSubmit({ ...NY_POS_OFFICE, patientState: "UNKNOWN" });
    expect(r.hardStops.map((h) => h.code)).toEqual(["STATE_UNKNOWN"]);
    expect(r.hardStops[0].overridable).toBeUndefined();
    expect(canOverrideHardStops(r)).toBe(false);
  });

  it("is false when there is nothing to override", () => {
    const r = evaluateBcbsSubmit({ ...NY_POS_OFFICE, placeOfService: "Home" });
    expect(r.hardStops).toEqual([]);
    expect(canOverrideHardStops(r)).toBe(false);
  });
});
