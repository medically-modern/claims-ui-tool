import { describe, it, expect } from "vitest";
import { buildUnified, UDEFAULT, type SubRow, type ClaimRow } from "./unifiedForecast";

const TODAY = new Date(2026, 5, 13); // 2026-06-13
const sub = (o: Partial<SubRow>): SubRow => ({
  group_title: "Subscriptions", primary_insurance: "", next_order_date: "",
  total_revenue: 0, total_gp: 0, total_cost: 0, shipping_cost: 0,
  oop_estimate: 0, coinsurance: 0, ded_remaining: 0, ...o,
});

describe("unifiedForecast", () => {
  it("Medicare A&B future order: 80/20 split, cost = rev - GP", () => {
    const r = buildUnified([sub({ primary_insurance: "Medicare A&B", next_order_date: "2026-06-20", total_revenue: 1000, total_gp: 400 })], [], TODAY);
    expect(Math.round(r.totals.primary)).toBe(800);
    expect(Math.round(r.totals.secondary)).toBe(200);
    expect(Math.round(r.totals.cost)).toBe(600);
    expect(Math.round(r.totals.inflight)).toBe(0);
  });

  it("excludes subscription orders >7 days stale", () => {
    const r = buildUnified([sub({ primary_insurance: "Cigna", next_order_date: "2026-06-01", total_revenue: 1000, total_gp: 400 })], [], TODAY);
    expect(Math.round(r.totals.primary)).toBe(0);
    expect(Math.round(r.totals.cost)).toBe(0);
  });

  it("in-flight claim lands via DOS+26", () => {
    const claims: ClaimRow[] = [{ claim_status: "Outstanding", est_pay: 900, dos: "2026-06-01", claim_sent_date: "", primary_payor: "X" }];
    const r = buildUnified([], claims, TODAY);
    expect(Math.round(r.totals.inflight)).toBe(900);
  });

  it("Medicaid recurs +60d within the 90-day window", () => {
    // order 2026-06-15 → eMedNY pay in window; +60 = 2026-08-14 → eMedNY also in window → 2 orders
    const r = buildUnified([sub({ primary_insurance: "Medicaid", next_order_date: "2026-06-15", total_revenue: 500, total_gp: 200 })], [], TODAY);
    expect(Math.round(r.totals.primary)).toBe(1000); // two orders × 500 (100% primary)
    expect(Math.round(r.totals.secondary)).toBe(0);
  });

  it("defaults match the sheet inputs", () => {
    expect(UDEFAULT.supplierSpreadDays).toBe(45);
    expect(UDEFAULT.primaryLag).toBe(26);
    expect(UDEFAULT.secondaryLag).toBe(30);
    expect(UDEFAULT.dosLag).toBe(26);
  });
});
