import { describe, expect, it } from "vitest";
import { answeredForThisOrder, describeCircle, suggestedMatches } from "./circleDetail";
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
    expect(d.facts.find((f) => f.label === "Suggested Primary")).toEqual({ label: "Suggested Primary", value: "Medicaid ✓ matches", tone: "ok" });
    expect(d.action).toBe("pause");
  });
  it("Eligibility — mismatch reads as ✗", () => {
    const p = { ...tara, suggestedPrimary: "Fidelis Low-Cost" };
    const d = describeCircle("benefits", { tone: "bad", light: true, label: "Active", ruleId: "elig.primary-mismatch", why: "…" }, p, TODAY);
    expect(d.facts.find((f) => f.label === "Suggested Primary")?.value).toBe("Fidelis Low-Cost ✗ board says Medicaid");
    expect(d.action).toBe("run-eligibility");
  });
  it("Auth — Medicaid DVS not run → Required, Run DVS", () => {
    const d = describeCircle("auth", { tone: "warn", label: "Required", medicaidDvs: true, dvsNeeded: true }, tara, TODAY);
    expect(d.headline).toBe("Required — run DVS");
    expect(d.action).toBe("run-dvs");
  });
  it("Auth — non-DVS shows the served categories with dates", () => {
    const p = { ...tara, primaryPayer: "Aetna", subscriptionType: "Sensors & Supplies", sensorsAuthStatus: "Auth Valid", sensorsAuthStart: "2026-06-01", sensorsAuthEnd: "2026-11-30", suppliesAuthStatus: "No Auth Needed" } as unknown as P;
    const d = describeCircle("auth", { tone: "ok", label: "Auth Valid / No Auth Needed" }, p, TODAY);
    expect(d.facts.map((f) => `${f.label}: ${f.value}`)).toEqual([
      "Sensors: Auth Valid · Jun 1, 2026 → Nov 30, 2026",
      "Supplies: No Auth Needed",
    ]);
  });
  it("Last paid — primary and secondary", () => {
    const d = describeCircle("lastPaid", { tone: "ok", label: "Fully Paid" }, tara, TODAY);
    expect(d.facts.map((f) => `${f.label}: ${f.value}`)).toEqual(["Primary claim: Fully Paid", "Secondary claim: None"]);
  });
  it("MR — status, expiry, and why ordering is fine", () => {
    const d = describeCircle("mr", { tone: "ok", light: true, label: "Not valid · OK to order", ruleId: "mr.expired-order-anyway", why: "…" }, tara, TODAY);
    expect(d.headline).toBe("MR Expired");
    expect(d.facts[0]).toEqual({ label: "MN expiry", value: "Jan 8, 2026 · expired 255d ago", tone: "bad" });
    expect(d.verdict?.kind).toBe("advanced");
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

describe("answeredForThisOrder", () => {
  it("drops a reply from the previous cycle, keeps this one", () => {
    expect(answeredForThisOrder("Aug 2, 2026, 2:23 PM ET", "2026-09-19")).toBe(false);
    expect(answeredForThisOrder("Sep 3, 2026, 9:10 AM ET", "2026-09-19")).toBe(true);
    expect(answeredForThisOrder("garbage", "2026-09-19")).toBe(true);
  });
});
