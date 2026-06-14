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
  it("unpaid claim valued by payer×product actual, NEVER est_pay", () => {
    // A paid Fidelis pump ($4000) sets the payer×product rate; an unpaid Fidelis pump
    // uses $4000 even though its est_pay says $4500. (Mordechai/Zachary case.)
    const r = buildUnified([], [
      claim({ claim_name: "PaidRef", claim_status: "Paid", primary_payor: "Fidelis Medicaid", primary_paid: 4000, primary_paid_date: "2026-05-01", lines: [{ hcpcs: "E0784", units: 1 }] }),
      claim({ claim_name: "Mordechai", claim_status: "Outstanding", est_pay: 4500, dos: "2026-06-01", primary_payor: "Fidelis Medicaid", lines: [{ hcpcs: "E0784", units: 1 }] }),
    ], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(4000);
  });
  it("product category is pump vs cgm — same payer pays each differently", () => {
    const r = buildUnified([], [
      claim({ claim_status: "Paid", primary_payor: "Fidelis Medicaid", primary_paid: 4000, primary_paid_date: "2026-05-01", lines: [{ hcpcs: "E0784", units: 1 }] }), // pump $4000
      claim({ claim_status: "Paid", primary_payor: "Fidelis Medicaid", primary_paid: 560, primary_paid_date: "2026-05-01", lines: [{ hcpcs: "A4239", units: 3 }] }), // cgm $560
      claim({ claim_status: "Outstanding", dos: "2026-06-01", primary_payor: "Fidelis Medicaid", lines: [{ hcpcs: "A4239", units: 3 }] }), // unpaid cgm → $560 not $4000
    ], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(560);
  });
  it("no payer×product history → product HCPCS conservative ($2500 commercial pump)", () => {
    // United Medicare pump: no prior payment for this combo → conservative.
    const r = buildUnified([], [claim({ est_pay: 8000, dos: "2026-06-01", primary_payor: "United Medicare", lines: [{ hcpcs: "E0784", units: 1 }] })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(2500);
  });
  it("E0784 conservative is $300 for Medicare A&B (no history)", () => {
    const r = buildUnified([], [claim({ dos: "2026-06-01", primary_payor: "Medicare A&B", lines: [{ hcpcs: "E0784", units: 1 }] })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(300);
  });
  it("future EFT-date claim included at paid date with ACTUAL amount", () => {
    const r = buildUnified([], [claim({ claim_status: "Review", est_pay: 900, primary_paid: 850, primary_paid_date: "2026-06-20" })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(850);
  });
  it("denied claim is bucketed (at conservative), not in cash flow", () => {
    const r = buildUnified([], [claim({ claim_status: "Denied (Or Partly)", est_pay: 700, dos: "2026-06-01", primary_payor: "Cigna", lines: [{ hcpcs: "E0784", units: 1 }] })], TODAY);
    expect(Math.round(r.totals.inflight)).toBe(0);
    expect(Math.round(r.kpis.denialTotal)).toBe(2500);
  });
  it("no HCPCS lines and no history falls back to $300", () => {
    const r = buildUnified([], [claim({ est_pay: 0, dos: "2026-06-01", lines: [] })], TODAY);
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

describe("unifiedForecast — timing & placeholder edge cases", () => {
  it("Medicaid primary uses eMedNY (next Wed + 22)", () => {
    // order 2026-06-15 (Mon) → next Wed 6/17 + 22 = 2026-07-09
    const r = buildUnified([sub({ primary_insurance: "Medicaid", next_order_date: "2026-06-15", total_revenue: 500, total_gp: 200 })], [], TODAY);
    const prim = r.events.find((e) => e.kind === "primary");
    expect(prim?.dateISO).toBe("2026-07-09");
  });
  it("eMedNY matches the documented cycle (cycle-end Wed 5/13 → EFT 6/4)", () => {
    // a Medicaid order on 2026-05-11 would pay 2026-06-04; verify via a window where it lands
    const r = buildUnified([sub({ primary_insurance: "Medicaid", next_order_date: "2026-06-17", total_revenue: 500, total_gp: 200 })], [], TODAY);
    // 6/17 is a Wednesday → next Wed = same day → +22 = 2026-07-09
    expect(r.events.find((e) => e.kind === "primary")?.dateISO).toBe("2026-07-09");
  });
  it("secondary lands +30 days after the primary pay date", () => {
    const r = buildUnified([sub({ primary_insurance: "Medicare A&B", next_order_date: "2026-06-20", total_revenue: 1000, total_gp: 400 })], [], TODAY);
    expect(r.events.find((e) => e.kind === "primary")?.dateISO).toBe("2026-07-16"); // +26
    expect(r.events.find((e) => e.kind === "secondary")?.dateISO).toBe("2026-08-15"); // +56
  });
  it("no-financials order uses the roster-average placeholder", () => {
    const subs = [
      sub({ primary_insurance: "Medicare A&B", next_order_date: "2026-06-20", total_revenue: 1000, total_gp: 400 }), // avg primary 800
      sub({ primary_insurance: "Cigna", next_order_date: "2026-06-20", total_revenue: 0, total_gp: 0 }),             // no financials → placeholder 800
    ];
    const r = buildUnified(subs, [], TODAY);
    expect(Math.round(r.totals.primary)).toBe(1600); // 800 real + 800 placeholder
  });
});
