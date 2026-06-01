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
