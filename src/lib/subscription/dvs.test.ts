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
  it("Medicaid + due + nothing run = needed", () => {
    expect(dvsState(base).kind).toBe("needed");
  });

  describe('"…" — an answer is already coming', () => {
    it("covers queued, running and retry", () => {
      for (const label of ["Trigger DVS", "Running", "Retry Queued"]) {
        expect(dvsState({ ...base, triggerDvs: label }).kind).toBe("running");
      }
      expect(dvsState({ ...base, triggerDvs: "Running" }))
        .toMatchObject({ label: "DVS running" });
    });

    // The whole point of the claim gate: a clean DVS is only half of it,
    // because for Medicaid the claim has to PAY before the order ships.
    it("covers a clean DVS whose claim is still out", () => {
      expect(dvsState({ ...base, triggerDvs: "Success", claimsStatus: "Claims Running" }))
        .toMatchObject({ kind: "running", label: "DVS clear — claim claims running" });
      expect(dvsState({ ...base, triggerDvs: "Success", claimsStatus: "Submit Claims" }).kind)
        .toBe("running");
      expect(dvsState({ ...base, triggerDvs: "Success", claimsStatus: "" }))
        .toMatchObject({ kind: "running", label: "DVS clear — waiting on the claim" });
    });

    it("does NOT go green on a clean DVS alone", () => {
      expect(dvsState({ ...base, triggerDvs: "Success" }).kind).not.toBe("cleared");
    });
  });

  it("goes green only when the DVS is clean AND the claim paid", () => {
    expect(dvsState({ ...base, triggerDvs: "Success", claimsStatus: "Claims Paid" }))
      .toEqual({ kind: "cleared", label: "DVS clear, claim paid" });
  });

  // Yameen Ali, 2026-09-21: the claim came back "Claims Paid" but the bot left
  // Trigger DVS parked at "Retry Queued". The claim is the end of the ladder,
  // so a paid claim clears the circle regardless of a stale in-flight trigger
  // label — otherwise the row hangs on "…" for an order that's already good.
  it("goes green on a paid claim even when Trigger DVS is a stale in-flight label", () => {
    for (const t of ["Retry Queued", "Trigger DVS", "Running"]) {
      expect(dvsState({ ...base, triggerDvs: t, claimsStatus: "Claims Paid" }))
        .toEqual({ kind: "cleared", label: "DVS clear, claim paid" });
    }
  });

  describe("red X — somebody has to go look", () => {
    it("covers a stopped DVS", () => {
      for (const label of ["Failed", "Manual Review", "MLTC"]) {
        expect(dvsState({ ...base, triggerDvs: label }).kind).toBe("failed");
      }
    });
    it("covers a hard-stopped claim after a clean DVS", () => {
      for (const c of ["Claims Denied", "Claims Error"]) {
        expect(dvsState({ ...base, triggerDvs: "Success", claimsStatus: c }).kind).toBe("failed");
      }
    });
    it("treats a Payment Incorrect claim as a light-red overridable stop, not a hard fail", () => {
      // The claim paid the wrong amount — the operator reads the per-code
      // payments and can ship anyway, so this is "underpaid", not "failed".
      expect(dvsState({ ...base, triggerDvs: "Success", claimsStatus: "Payment Incorrect" }))
        .toEqual({ kind: "underpaid", label: "Medicaid paid the wrong amount" });
    });
    it("surfaces an unrecognised Trigger DVS label instead of passing it", () => {
      expect(dvsState({ ...base, triggerDvs: "Something New" }))
        .toMatchObject({ kind: "failed", label: 'Trigger DVS = "Something New"' });
    });
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
