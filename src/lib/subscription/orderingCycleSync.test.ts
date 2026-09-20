import { describe, expect, it } from "vitest";
import { describeSync, planSync } from "./orderingCycleSync";
import type { LanePatient } from "./lanes";

const ok = { tone: "ok", label: "ok" } as const;
const bad = { tone: "bad", label: "no" } as const;
const base = {
  id: "1", mondayItemId: "1", name: "A", phone: "", primaryPayer: "Medicaid", nextOrderDate: "2026-09-19",
  subscriptionType: "Supplies", patientStatus: "Active",
  confirmation: ok, benefits: ok, auth: ok, lastPaid: ok, mr: ok,
} as unknown as LanePatient;

describe("planSync", () => {
  it("promotes a five-green Order Prep row and demotes a held Ready to Order row", () => {
    const rows = [
      { ...base, mondayItemId: "1", orderingCycle: "Order Prep" },
      { ...base, mondayItemId: "2", orderingCycle: "Ready to Order", auth: bad },
      { ...base, mondayItemId: "3", orderingCycle: "Ready to Order", confirmation: { ...ok, needsRead: "note 2d ago" } },
    ] as unknown as LanePatient[];
    expect(planSync(rows).map((w) => [w.itemId, w.to])).toEqual([["1", "Ready to Order"], ["2", "Order Prep"], ["3", "Order Prep"]]);
  });
  it("leaves the lifecycle labels, paused and not-active rows, and already-correct rows alone", () => {
    const rows = [
      { ...base, mondayItemId: "1", orderingCycle: "Next Order Awaiting" },
      { ...base, mondayItemId: "2", orderingCycle: "Order" },
      { ...base, mondayItemId: "3", orderingCycle: "Order Prep", patientStatus: "Paused", pauseReason: "No confirmation" },
      { ...base, mondayItemId: "4", orderingCycle: "Order Prep", isNotActive: true },
      { ...base, mondayItemId: "5", orderingCycle: "Ready to Order" },
      { ...base, mondayItemId: "6", orderingCycle: "" },
    ] as unknown as LanePatient[];
    expect(planSync(rows)).toEqual([]);
  });
  it("describes the writes", () => {
    expect(describeSync([{ itemId: "1", name: "A", from: "Order Prep", to: "Ready to Order" }, { itemId: "2", name: "B", from: "Ready to Order", to: "Order Prep" }])).toBe("1 → Ready to Order · 1 → Order Prep");
  });
});
