import { describe, expect, it } from "vitest";
import {
  CONFIRM_OOP_THRESHOLD, PAYER_GROUPS, RULES, confirmPolicy, eligibilityIsFresh,
  isFirstOrder, parseMoney, payerGroupFor, ruleById,
} from "./payerRules";

const TODAY = "2026-09-20";

describe("payerGroupFor", () => {
  it("routes the named payers and falls back to Everyone else", () => {
    expect(payerGroupFor("Medicaid").id).toBe("medicaid");
    expect(payerGroupFor("United Medicaid").id).toBe("medicaid");
    expect(payerGroupFor("Medicare A&B").id).toBe("medicare");
    expect(payerGroupFor("Fidelis Low-Cost").id).toBe("fidelis");
    for (const p of ["Aetna Commercial", "Horizon BCBS", "United Medicare", "Cigna", "", null, undefined]) {
      expect(payerGroupFor(p).id).toBe("commercial");
    }
  });
  it("every group and rule is addressable, and rule ids are unique", () => {
    expect(PAYER_GROUPS.map((g) => g.id)).toEqual(["medicaid", "medicare", "fidelis", "commercial"]);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const r of RULES) expect(ruleById(r.id)).toBe(r);
  });
});

describe("isFirstOrder / parseMoney", () => {
  it("reads Order Type", () => {
    expect(isFirstOrder("First Order")).toBe(true);
    expect(isFirstOrder("Reorder")).toBe(false);
    expect(isFirstOrder("")).toBe(false);
  });
  it("money: digits parse, prose is unknown, never zero", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("0")).toBe(0);
    expect(parseMoney("-57.32")).toBe(-57.32);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("Incomplete benefits data")).toBeNull();
    expect(parseMoney('No rates available for "MagnaCare" with serving "CGM"')).toBeNull();
  });
});

describe("confirmPolicy", () => {
  const base = { orderDate: "2026-09-25", today: TODAY, firstOrder: false };
  it("no reply is OK when OOP ≤ $5 and the fill is profitable", () => {
    const p = confirmPolicy({ ...base, oopEstimate: "$0.00", totalGp: "312.4" });
    expect(p.affirmativeOnly).toBe(false);
    expect(p.ruleId).toBe("confirm.no-reply-ok");
    expect(p.flags).toEqual([]);
    expect(p.why).toContain("$0");
    expect(p.why).toContain("$312.40");
  });
  it(`OOP over $${CONFIRM_OOP_THRESHOLD} needs a yes`, () => {
    const p = confirmPolicy({ ...base, oopEstimate: "$5.01", totalGp: "300" });
    expect(p.affirmativeOnly).toBe(true);
    expect(p.ruleId).toBe("confirm.oop-over-threshold");
    expect(confirmPolicy({ ...base, oopEstimate: "$5.00", totalGp: "300" }).affirmativeOnly).toBe(false);
  });
  it("a money-losing fill needs a yes, read off the board's Total GP", () => {
    const p = confirmPolicy({ ...base, oopEstimate: "$0", totalGp: "-57.32" });
    expect(p.affirmativeOnly).toBe(true);
    expect(p.ruleId).toBe("confirm.fill-loses-money");
    expect(p.why).toContain("−$57.32");
  });
  it("blank OOP inside 20 days: unknown, blocks, and raises the OOP-unknown badge", () => {
    const p = confirmPolicy({ ...base, oopEstimate: "", totalGp: "300" });
    expect(p.affirmativeOnly).toBe(true);
    expect(p.ruleId).toBe("confirm.oop-unknown");
    expect(p.flags.map((f) => f.id)).toEqual(["oop-unknown"]);
  });
  it("prose in OOP Estimate is unknown too, and the badge quotes it", () => {
    const p = confirmPolicy({ ...base, oopEstimate: "Incomplete benefits data", totalGp: "300" });
    expect(p.ruleId).toBe("confirm.oop-unknown");
    expect(p.flags[0].detail).toContain("Incomplete benefits data");
  });
  it("blank OOP more than 20 days out: still unknown (blocks), but no badge — the estimate isn't due yet", () => {
    const p = confirmPolicy({ ...base, orderDate: "2026-11-01", oopEstimate: "", totalGp: "300" });
    expect(p.affirmativeOnly).toBe(true);
    expect(p.ruleId).toBe("confirm.oop-unknown");
    expect(p.flags).toEqual([]);
    expect(p.why).toContain("not computed yet");
  });
  it("blank Total GP: GP-unknown badge, and it blocks when OOP is fine", () => {
    const p = confirmPolicy({ ...base, oopEstimate: "$0", totalGp: "" });
    expect(p.ruleId).toBe("confirm.gp-unknown");
    expect(p.flags.map((f) => f.id)).toEqual(["gp-unknown"]);
  });
  it("both blank inside the window: both badges, OOP decides the verdict", () => {
    const p = confirmPolicy({ ...base, oopEstimate: "", totalGp: "" });
    expect(p.ruleId).toBe("confirm.oop-unknown");
    expect(p.flags.map((f) => f.id)).toEqual(["oop-unknown", "gp-unknown"]);
  });
  it("first order: no badges, no confirmation needed, whatever the money says", () => {
    const p = confirmPolicy({ ...base, firstOrder: true, oopEstimate: "", totalGp: "" });
    expect(p.affirmativeOnly).toBe(false);
    expect(p.ruleId).toBe("first-order");
    expect(p.flags).toEqual([]);
  });
});

describe("eligibilityIsFresh (Medicare: 7 days and same month)", () => {
  const rule = { days: 7, sameMonth: true, today: TODAY };
  it("fresh when checked within 7 days of a future order date, same month", () => {
    expect(eligibilityIsFresh({ ...rule, lastCheck: "2026-09-20", orderDate: "2026-09-25" }).fresh).toBe(true);
  });
  it("stale when older than 7 days, or checked in a different month", () => {
    expect(eligibilityIsFresh({ ...rule, lastCheck: "2026-09-10", orderDate: "2026-09-25" }).fresh).toBe(false);
    // Aug 31 does not cover a Sep 1 order.
    expect(eligibilityIsFresh({ ...rule, lastCheck: "2026-08-31", orderDate: "2026-09-01", today: "2026-08-31" }).fresh).toBe(false);
  });
  it("a late order's date of service is today, not the order date", () => {
    // Order was due Sep 10, ordering tonight, checked today → fresh.
    const r = eligibilityIsFresh({ ...rule, lastCheck: "2026-09-20", orderDate: "2026-09-10" });
    expect(r.fresh).toBe(true);
    expect(r.dos).toBe(TODAY);
  });
  it("never checked is not fresh", () => {
    expect(eligibilityIsFresh({ ...rule, lastCheck: "", orderDate: "2026-09-25" }).fresh).toBe(false);
  });
});
