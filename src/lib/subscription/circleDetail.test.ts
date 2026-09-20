import { describe, expect, it } from "vitest";
import { describeCircle, parseCodeResult, sinceLastOrder, suggestedMatches } from "./circleDetail";
import type { Checkpoint } from "@/components/subscription/mockData";

const TODAY = "2026-09-20";

// Tara Pratt, 2026-09-20: Medicaid, Supplies, no reply, DVS not run, MR expired.
type P = Parameters<typeof describeCircle>[2];
const tara = {
  name: "Tara Pratt", primaryPayer: "Medicaid", subscriptionType: "Supplies",
  oopEstimate: "$0", financials: { totalGP: 271.89 },
  lastEligibilityCheck: "2026-09-12", suggestedPrimary: "Medicaid", cobCheck: "OK",
  triggerDvs: "", claimsStatusCol: "",
  primaryClaimPaid: "Fully Paid", secondaryClaimPaid: "",
  mnExpiry: "2026-01-08", mrStatus: "MR Expired", referralSource: "Other",
} as unknown as P;

describe("describeCircle", () => {
  it("Confirm — no reply, advanced by rules, Pause only", () => {
    const c: Checkpoint = { tone: "ok", light: true, label: "No reply", ruleId: "confirm.no-reply-ok", why: "…" };
    const d = describeCircle("confirmation", c, tara, TODAY);
    expect(d.headline).toBe("No reply");
    expect(d.verdict).toEqual({ kind: "advanced", text: "OOP Estimate is $0 and GP is $271.89, so no reply is needed" });
    expect(d.action).toBe("pause");
  });
  it("Confirm — held → Advance only", () => {
    const c: Checkpoint = { tone: "bad", light: true, label: "No reply", ruleId: "confirm.oop-over-threshold", why: "OOP $40 needs a yes" };
    const d = describeCircle("confirmation", c, tara, TODAY);
    expect(d.verdict?.kind).toBe("held");
    expect(d.action).toBe("advance");
  });
  it("Eligibility — last checked + suggested primary with a match", () => {
    const d = describeCircle("benefits", { tone: "ok", label: "Active" }, tara, TODAY);
    expect(d.facts.find((f) => f.label === "Last checked")?.value).toBe("Sep 12, 2026 · 8d ago");
    expect(d.facts.find((f) => f.label === "Suggested Primary")).toEqual({ label: "Suggested Primary", value: "Medicaid", tone: undefined, mark: "ok" });
    expect(d.action).toBe("pause");
  });
  it("Eligibility — mismatch reads as ✗", () => {
    const p = { ...tara, suggestedPrimary: "Fidelis Low-Cost" };
    const d = describeCircle("benefits", { tone: "bad", light: true, label: "Active", ruleId: "elig.primary-mismatch", why: "…" }, p, TODAY);
    expect(d.facts.find((f) => f.label === "Suggested Primary")).toMatchObject({ value: "Fidelis Low-Cost · mismatch", mark: "bad", tone: "bad" });
    expect(d.action).toBe("run-eligibility");
  });
  it("Auth — Medicaid DVS not run → Required, Run DVS", () => {
    const d = describeCircle("auth", { tone: "warn", label: "Required", medicaidDvs: true, dvsNeeded: true }, tara, TODAY);
    expect(d.headline).toBe("Required — run DVS");
    expect(d.action).toBe("run-dvs");
  });
  it("Auth — non-DVS names each category once: mixed statuses in the headline, dates below", () => {
    const p = { ...tara, primaryPayer: "Aetna", subscriptionType: "Sensors & Supplies", sensorsAuthStatus: "Auth Valid", sensorsAuthStart: "2026-06-01", sensorsAuthEnd: "2026-11-30", sensorsAuthUnits: "20", suppliesAuthStatus: "No Auth Needed" } as unknown as P;
    const d = describeCircle("auth", { tone: "ok", label: "Auth Valid / No Auth Needed" }, p, TODAY);
    expect(d.headline).toBe("Sensors: Auth Valid · Supplies: No Auth Needed");
    expect(d.facts).toEqual([{ label: "Sensors", value: "Jun 1, 2026 → Nov 30, 2026 · 20 units" }]);
  });
  it("Auth — non-DVS, same status everywhere → one headline, no lines", () => {
    const p = { ...tara, primaryPayer: "Fidelis Low-Cost", subscriptionType: "Sensors & Supplies", sensorsAuthStatus: "No Auth Needed", suppliesAuthStatus: "No Auth Needed", sensorsAuthUnits: "0" } as unknown as P;
    const d = describeCircle("auth", { tone: "ok", label: "No Auth Needed / No Auth Needed" }, p, TODAY);
    expect(d.headline).toBe("Sensors & Supplies — no auth needed");
    expect(d.facts).toEqual([]);
    const one = describeCircle("auth", { tone: "ok", label: "No Auth Needed" }, { ...p, subscriptionType: "Sensors" } as unknown as P, TODAY);
    expect(one.headline).toBe("Sensors — no auth needed");
  });
  it("Auth — cleared Medicaid DVS lists what each code paid, with a full-amount check", () => {
    const p = { ...tara, triggerDvs: "Success", claimsStatusCol: "Claims Paid", a4230Claim: "Paid: $456.00", a4232Claim: "Paid: $108.30", infusionSet1Qty: "3", cartridgeQty: "3", claimsPaidDate: "2026-09-20" } as unknown as P;
    const d = describeCircle("auth", { tone: "ok", label: "DVS clear, claim paid", medicaidDvs: true }, p, TODAY);
    expect(d.facts.map((f) => [f.label, f.value, f.mark])).toEqual([
      ["Infusion sets", "$456 · full", "ok"],
      ["Cartridges", "$108.30 · full", "ok"],
      ["Paid", "Sep 20, 2026", undefined],
    ]);
    expect(d.action).toBe("pause");
  });
  it("Last paid — primary and secondary", () => {
    const d = describeCircle("lastPaid", { tone: "ok", label: "Fully Paid" }, tara, TODAY);
    expect(d.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Primary claim: Fully Paid", "Secondary claim: None"]);
  });
  it("MR — status, expiry, and why ordering is fine", () => {
    const d = describeCircle("mr", { tone: "ok", light: true, label: "Not valid · OK to order", ruleId: "mr.expired-order-anyway", why: "…" }, tara, TODAY);
    expect(d.headline).toBe("MR Expired");
    expect(d.facts[0]).toEqual({ label: "MN expiry", value: "Jan 8, 2026 · expired 255d ago", tone: "bad" });
    expect(d.verdict).toEqual({ kind: "advanced", text: "medical records don't have to be valid to order for this patient" });
    expect(d.action).toBe("pause");
  });
});

describe("suggestedMatches", () => {
  it("is loose about managed Medicaid and blank/unknown", () => {
    expect(suggestedMatches("Medicaid", "United Medicaid")).toBe(true);
    expect(suggestedMatches("Medicare", "Medicaid")).toBe(false);
    expect(suggestedMatches("Unknown", "Medicaid")).toBeNull();
    expect(suggestedMatches("", "Medicaid")).toBeNull();
  });
});

describe("sinceLastOrder", () => {
  it("keeps what came in since the last order, drops the previous cycle", () => {
    expect(sinceLastOrder("Aug 2, 2026, 2:23 PM ET", "2026-08-22")).toBe(false);
    expect(sinceLastOrder("[8/2/26, 2:23 PM ET] Hello", "2026-08-22")).toBe(false);
    expect(sinceLastOrder("[9/3/26, 9:10 AM ET] Patient CONFIRM:", "2026-08-22")).toBe(true);
    expect(sinceLastOrder("garbage", "2026-08-22")).toBe(true);
    expect(sinceLastOrder("Aug 2, 2026, 2:23 PM ET", "")).toBe(true);
  });
});

describe("parseCodeResult", () => {
  it("reads paid amounts against the box rate, and denials", () => {
    expect(parseCodeResult("A4230", "Paid: $456.00", "3")).toMatchObject({ item: "Infusion sets", paid: 456, expected: 456, full: true });
    expect(parseCodeResult("A4232", "Paid: $72.20", 3)).toMatchObject({ item: "Cartridges", paid: 72.2, expected: 108.3, full: false });
    expect(parseCodeResult("A4232", "Denied: (85) Entity not primary", "")).toMatchObject({ paid: null, denied: "(85) Entity not primary", full: false });
    expect(parseCodeResult("A4232", "", "3")).toBeNull();
  });
});
