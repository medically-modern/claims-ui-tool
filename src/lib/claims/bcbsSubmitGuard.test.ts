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
  CARECENTRIX_NJ_PAYER_ID,
  BCBS_TN_PAYER_ID,
  resolveLabelRoutedBluePlan,
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
  it("recognizes 803 and 11348", () => {
    expect(isBcbsByPayorId("803")).toBe(true);
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

  it("NJ patient + 11348 + POS Home + line auths present — no errors", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "11348",
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
  it("blocks NY patient routed to 11348 (Kai Burridge-style stale address)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "11348",
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

  it("blocks MA patient routed via 11348", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: "11348",
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
  it("warns when routing to 11348 with at least one missing line auth", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Anthem BCBS Co.",
      payorId: CARECENTRIX_NJ_PAYER_ID,
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
      payorId: CARECENTRIX_NJ_PAYER_ID,
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
      payorId: CARECENTRIX_NJ_PAYER_ID,
      placeOfService: "Home",
      patientState: "NJ",
      lineAuthIds: ["AUTH-A", "AUTH-B"],
      lineProducts: ["A4239", "A4232"],
    });
    expect(r.warnings).toEqual([]);
  });

  it("does not warn for NY claim (not routed to 11348)", () => {
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

describe("evaluateBcbsSubmit — modifier mismatch", () => {
  it("warns when a CareCentrix (NJ) line has KX instead of NU+SC (Esther Reich)", () => {
    const r = evaluateBcbsSubmit({
      payerLabel: "Horizon BCBS",
      payorId: CARECENTRIX_NJ_PAYER_ID,
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
      payorId: CARECENTRIX_NJ_PAYER_ID,
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


describe("evaluateBcbsSubmit — BCBS Tennessee (CareCentrix, 11345)", () => {
  it("clears a clean TN claim: 11345 + POS Home + NU lines, no 803/Office stops", () => {
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

  it("resolveLabelRoutedBluePlan matches by label and by 11345 id", () => {
    expect(resolveLabelRoutedBluePlan("BCBS TN", null)?.payerId).toBe(BCBS_TN_PAYER_ID);
    expect(resolveLabelRoutedBluePlan(null, "11345")?.payerId).toBe(BCBS_TN_PAYER_ID);
    expect(resolveLabelRoutedBluePlan("Anthem BCBS", "803")).toBeNull();
  });
});
