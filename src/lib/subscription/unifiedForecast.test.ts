import { describe, it, expect } from "vitest";
import { buildUnified, UDEFAULT, type SubRow, type ClaimRow } from "./unifiedForecast";

const TODAY = new Date(2026, 5, 13); // 2026-06-13
const sub = (o: Partial<SubRow>): SubRow => ({
  group_title: "Subscriptions", primary_insurance: "", next_order_date: "",
  total_revenue: 0, total_gp: 0, total_cost: 0, shipping_cost: 0,
  oop_estimate: 0, coinsurance: 0, ded_remaining: 0, ...o,
});
const claim = (o: Partial<ClaimRow>): ClaimRow => ({
  claim_status: "Outstanding", est_pay: 0, dos: "", claim_sent_date: "",
  primary_payor: "X", primary_paid: 0, primary_paid_date: "", ...o,
});

describe("unifiedForecast — subscription", () => {
  it("Medicare A&B future order: 80/20 split, cost = rev - GP", () => {
    const r = buildUnified([sub({ primary_insurance: "Medicare A&B", next_order_date: "2026-06-20", total_revenue: 1000, total_gp: 400 })], [], TODAY);
    expect(Math.round(r.totals.primary)).toBe(800);
    expect(Math.round(r.totals.secondary)).toBe(200);
    expect(Math.round(r.totals.cost)).toBe(600);
  });
  it("excludes subscription orders >7 days stale", () => {
    const r = buildUnified([sub({ primary_insurance: "Cigna", next_order_date: "2026-06-01", total_revenue: 1000, total_gp: 400 })], [], TODAY);
    expect(Math.round(r.totals.primary)).toBe(0);
  });
  it("Medicaid recurs +60d within the 90-day window", () => {
    const r = buildUnified([sub({ primary_insurance: "Medicaid", next_order_date: "2026-06-15", total_revenue: 500, total_gp: 200 })], [], TODAY);
    expect(Math.round(r.totals.primary)).toBe(1000); // two orders × 500
  });
});

describe("unifiedForecast — claims by payment state", () => {
  it("unpaid claim lands via DOS+26 at est_pay", () => {
    const r = buildUnified([], [claim({ est_pay: 900, dos: "2026-06-01" })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(900);
  });
  it("already-received claim (paid date in past) is EXCLUDED", () => {
    const r = buildUnified([], [claim({ claim_status: "Review", est_pay: 4500, dos: "2026-05-19", primary_paid: 533, primary_paid_date: "2026-06-10" })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(0); // Gary Bariatti case
  });
  it("future EFT-date claim included at paid date with ACTUAL amount", () => {
    const r = buildUnified([], [claim({ claim_status: "Review", est_pay: 900, primary_paid: 850, primary_paid_date: "2026-06-20" })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(850);
  });
  it("denied claim is bucketed, not in cash flow", () => {
    const r = buildUnified([], [claim({ claim_status: "Denied (Or Partly)", est_pay: 700, dos: "2026-06-01" })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(0);
    expect(Math.round(r.kpis.denialTotal)).toBe(700);
  });
  it("missing est_pay uses $300 conservative", () => {
    const r = buildUnified([], [claim({ est_pay: 0, dos: "2026-06-01" })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(300);
  });
});

describe("unifiedForecast — growth + defaults", () => {
  it("growth adds revenue vs baseline", () => {
    const subs = [sub({ primary_insurance: "Cigna", next_order_date: "2026-06-20", total_revenue: 1000, total_gp: 400 })];
    const base = buildUnified(subs, [], TODAY);
    const grown = buildUnified(subs, [], TODAY, { ...UDEFAULT, newPatientsPerWeek: 10 });
    expect(grown.totals.rev).toBeGreaterThan(base.totals.rev);
  });
  it("defaults match the sheet inputs", () => {
    expect(UDEFAULT.supplierSpreadDays).toBe(45);
    expect(UDEFAULT.primaryLag).toBe(26);
    expect(UDEFAULT.dosLag).toBe(26);
    expect(UDEFAULT.newPatientsPerWeek).toBe(0);
  });
});
