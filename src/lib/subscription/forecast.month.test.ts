import { describe, it, expect } from "vitest";
import { buildForecast, ymd, addDays, type ForecastPatient } from "./forecast";
const TODAY = new Date(2026, 5, 13);
const p = (o: Partial<ForecastPatient>): ForecastPatient => ({ id: o.id ?? "p", name: "n", primaryPayer: o.primaryPayer ?? "Medicaid", secondaryPayer: "None", subscriptionType: "Supplies", status: "Active", isNotActive: false, nextOrderDate: o.nextOrderDate ?? ymd(addDays(TODAY, 5)), revenue: o.revenue ?? 564, cost: o.cost ?? 314, oopEstimate: 0, coinsuranceFrac: 0, dedRemaining: 0, primaryClaimPaid: "", secondaryClaimPaid: "", claimsPaidDate: "", claimsStatus: "" });
describe("monthly granularity reconciles", () => {
  it("bucket totals == KPI totals and last endBalance == balanceIn90 (month)", () => {
    const pts = Array.from({ length: 30 }, (_, i) => p({ id: `p${i}`, primaryPayer: i % 3 ? "Medicaid" : "Medicare A&B", revenue: 600 + i, nextOrderDate: ymd(addDays(TODAY, i)) }));
    const f = buildForecast(pts, TODAY, { startingCash: 80000, monthlyFixedCost: 20000, granularity: "month" });
    const bP = f.buckets.reduce((s, b) => s + b.primaryIn, 0);
    const bC = f.buckets.reduce((s, b) => s + b.costOut, 0);
    const bB = f.buckets.reduce((s, b) => s + b.burn, 0);
    expect(bP).toBeCloseTo(f.kpis.primaryIn, 0);
    expect(bC).toBeCloseTo(f.kpis.costOut, 0);
    expect(bB).toBeCloseTo(f.kpis.burnOut, 0);
    expect(f.buckets[f.buckets.length - 1].endBalance).toBeCloseTo(f.kpis.balanceIn90, 0);
  });
});
