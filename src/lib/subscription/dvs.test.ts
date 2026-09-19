import { describe, expect, it } from "vitest";
import { canRunDvs, dvsState, isMedicaid, orderIsDue } from "./dvs";

const TODAY = "2026-09-19";
const base = { payer: "Medicaid", orderDate: "2026-09-18", triggerDvs: "", today: TODAY };

describe("isMedicaid", () => {
  it("matches the plain label and the managed plans spelled around it", () => {
    // Measured on the live board 2026-09-19: 263 "Medicaid" + 1 "United
    // Medicaid" among 264 Medicaid-primary actives. A managed Medicaid plan
    // still needs the DVS.
    for (const p of ["Medicaid", "medicaid", "United Medicaid", "Fidelis Medicaid"]) {
      expect(isMedicaid(p)).toBe(true);
    }
  });
  it("does not match commercial payers or blanks", () => {
    for (const p of ["Aetna", "Medicare", "", null, undefined]) {
      expect(isMedicaid(p)).toBe(false);
    }
  });
});

describe("orderIsDue", () => {
  it("is due on the day and after", () => {
    expect(orderIsDue(TODAY, TODAY)).toBe(true);
    expect(orderIsDue("2026-08-01", TODAY)).toBe(true);
  });
  it("is not due before the date, or with no date at all", () => {
    expect(orderIsDue("2026-09-20", TODAY)).toBe(false);
    expect(orderIsDue("", TODAY)).toBe(false);
    expect(orderIsDue(null, TODAY)).toBe(false);
  });
  it("ignores a time component on the cell", () => {
    expect(orderIsDue("2026-09-18 00:00:00", TODAY)).toBe(true);
  });
});

describe("dvsState", () => {
  it("is not part of the circle for a commercial payer", () => {
    expect(dvsState({ ...base, payer: "Aetna" }).kind).toBe("n/a");
  });
  it("is not part of the circle before the order comes due", () => {
    expect(dvsState({ ...base, orderDate: "2026-10-01" }).kind).toBe("n/a");
  });
  it("Medicaid + due + nothing run = needed (the open circle)", () => {
    expect(dvsState(base).kind).toBe("needed");
  });
  it("treats queued, running and retry as in flight", () => {
    for (const label of ["Trigger DVS", "Running", "Retry Queued"]) {
      expect(dvsState({ ...base, triggerDvs: label }).kind).toBe("inFlight");
    }
    expect(dvsState({ ...base, triggerDvs: "Running" })).toMatchObject({ label: "DVS running" });
  });
  it("hands a clean DVS back to the standing-auth read", () => {
    expect(dvsState({ ...base, triggerDvs: "Success" }).kind).toBe("ok");
  });
  it("asks for a human on failure, manual review and MLTC", () => {
    for (const label of ["Failed", "Manual Review", "MLTC"]) {
      expect(dvsState({ ...base, triggerDvs: label }).kind).toBe("needsHuman");
    }
  });
  it("surfaces an unrecognised label instead of passing it as clear", () => {
    const s = dvsState({ ...base, triggerDvs: "Something New" });
    expect(s.kind).toBe("needsHuman");
    expect(s).toMatchObject({ label: 'Trigger DVS = "Something New"' });
  });
});

describe("canRunDvs", () => {
  const row = (tone: string, dvsNeeded = true) =>
    ({ auth: { dvsNeeded }, confirmation: { tone } });

  it("allows a green Confirm — the patient said yes", () => {
    expect(canRunDvs(row("ok"))).toBe(true);
  });
  it("allows a gray Confirm — no reply yet is not a reason to skip the prep", () => {
    expect(canRunDvs(row("pending"))).toBe(true);
  });
  it("refuses a red Confirm — the patient said no, override in the profile", () => {
    expect(canRunDvs(row("bad"))).toBe(false);
  });
  it("is irrelevant on a row that doesn't need a DVS", () => {
    expect(canRunDvs(row("ok", false))).toBe(false);
  });
});
