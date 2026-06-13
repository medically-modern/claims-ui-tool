import { describe, it, expect } from "vitest";
import {
  buildForecast, splitRevenue, primaryPayDate, orderDatesFor, orderState,
  coinsuranceFraction, isMedicareAB, parseLocalDate, addDays, ymd, DEFAULT_ASSUMPTIONS,
  type ForecastPatient, type ForecastAssumptions,
} from "./forecast";
import { medicaidPaymentDate } from "@/lib/claims/cashflow";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const TODAY = new Date(2026, 5, 13); // 2026-06-13 local

function patient(over: Partial<ForecastPatient> = {}): ForecastPatient {
  return {
    id: over.id ?? "p1",
    name: over.name ?? "Test Patient",
    primaryPayer: over.primaryPayer ?? "Anthem BCBS Commercial",
    secondaryPayer: over.secondaryPayer ?? "None",
    subscriptionType: over.subscriptionType ?? "Sensors",
    status: over.status ?? "Active",
    isNotActive: over.isNotActive ?? false,
    nextOrderDate: over.nextOrderDate ?? ymd(addDays(TODAY, 5)),
    revenue: over.revenue ?? 1000,
    cost: over.cost ?? 400,
    oopEstimate: over.oopEstimate ?? 0,
    coinsuranceFrac: over.coinsuranceFrac ?? 0,
    dedRemaining: over.dedRemaining ?? 0,
    primaryClaimPaid: over.primaryClaimPaid ?? "",
    secondaryClaimPaid: over.secondaryClaimPaid ?? "",
    claimsPaidDate: over.claimsPaidDate ?? "",
    claimsStatus: over.claimsStatus ?? "",
    hasOpenClaim: over.hasOpenClaim,
  };
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
describe("coinsuranceFraction", () => {
  it("treats values <=1 as fractions", () => expect(coinsuranceFraction("0.2")).toBeCloseTo(0.2));
  it("treats values >1 as percents", () => expect(coinsuranceFraction("20")).toBeCloseTo(0.2));
  it("strips % sign", () => expect(coinsuranceFraction("20%")).toBeCloseTo(0.2));
  it("zero/blank -> 0", () => { expect(coinsuranceFraction("0")).toBe(0); expect(coinsuranceFraction("")).toBe(0); });
  it("caps at 1", () => expect(coinsuranceFraction("250")).toBeLessThanOrEqual(1));
});

describe("isMedicareAB", () => {
  it("matches Medicare A&B exactly", () => expect(isMedicareAB("Medicare A&B")).toBe(true));
  it("does not match Medicare Advantage plans", () => {
    expect(isMedicareAB("Aetna Medicare")).toBe(false);
    expect(isMedicareAB("United Medicare")).toBe(false);
    expect(isMedicareAB("Anthem BCBS Medicare")).toBe(false);
  });
  it("does not match Medicaid", () => expect(isMedicareAB("Medicaid")).toBe(false));
});

// ─── Revenue split ──────────────────────────────────────────────────────────
describe("splitRevenue", () => {
  it("Medicare A&B = 80/20", () => {
    const s = splitRevenue(patient({ primaryPayer: "Medicare A&B", revenue: 1000 }));
    expect(s.basis).toBe("medicare_80_20");
    expect(s.primary).toBeCloseTo(800);
    expect(s.secondary).toBeCloseTo(200);
  });
  it("pure Medicaid = 100% primary", () => {
    const s = splitRevenue(patient({ primaryPayer: "Medicaid", revenue: 564.3 }));
    expect(s.basis).toBe("medicaid_full_primary");
    expect(s.primary).toBeCloseTo(564.3);
    expect(s.secondary).toBe(0);
  });
  it("commercial with OOP estimate uses it as the secondary portion", () => {
    const s = splitRevenue(patient({ primaryPayer: "Aetna Commercial", revenue: 1000, oopEstimate: 150 }));
    expect(s.basis).toBe("oop_estimate");
    expect(s.secondary).toBeCloseTo(150);
    expect(s.primary).toBeCloseTo(850);
  });
  it("commercial w/o OOP falls back to coins% + deductible", () => {
    const s = splitRevenue(patient({ primaryPayer: "Cigna", revenue: 1000, coinsuranceFrac: 0.2, dedRemaining: 100 }));
    expect(s.basis).toBe("coins_plus_deductible");
    expect(s.secondary).toBeCloseTo(300); // 0.2*1000 + 100
    expect(s.primary).toBeCloseTo(700);
  });
  it("commercial with no PR signal = all primary", () => {
    const s = splitRevenue(patient({ primaryPayer: "Cigna", revenue: 1000 }));
    expect(s.basis).toBe("no_pr_data_all_primary");
    expect(s.primary).toBeCloseTo(1000);
    expect(s.secondary).toBe(0);
  });
  it("split always sums to revenue", () => {
    for (const p of [
      patient({ primaryPayer: "Medicare A&B", revenue: 954 }),
      patient({ primaryPayer: "Medicaid", revenue: 564.3 }),
      patient({ primaryPayer: "Cigna", revenue: 1000, oopEstimate: 250 }),
      patient({ primaryPayer: "Humana", revenue: 1000, coinsuranceFrac: 0.2, dedRemaining: 5000 }), // PR capped at rev
    ]) {
      const s = splitRevenue(p);
      expect(s.primary + s.secondary).toBeCloseTo(p.revenue);
      expect(s.primary).toBeGreaterThanOrEqual(0);
      expect(s.secondary).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── Pay-date timing ──────────────────────────────────────────────────────────
const A = (o: Partial<ForecastAssumptions> = {}) => ({ ...o });
describe("primaryPayDate", () => {
  const a = { primaryLagDays: 25, secondaryLagDays: 30, dosLagDays: 25, medicaidCycleDays: 60, horizonDays: 90, reorderRate: 1, collectionRate: 1, startingCash: 0, supplierOwed: 0, supplierSpreadDays: 30, monthlyFixedCost: 0, granularity: "week" as const, includePaused: true };
  it("non-Medicaid = order + 25 days", () => {
    const order = new Date(2026, 5, 1);
    expect(ymd(primaryPayDate(patient({ primaryPayer: "Cigna" }), order, a))).toBe(ymd(addDays(order, 25)));
  });
  it("Medicaid uses the eMedNY cycle (matches cashflow.ts)", () => {
    const order = new Date(2026, 5, 1);
    expect(ymd(primaryPayDate(patient({ primaryPayer: "Medicaid" }), order, a)))
      .toBe(ymd(medicaidPaymentDate(order)));
  });
});

// ─── Order generation / recurrence ──────────────────────────────────────────
describe("orderDatesFor", () => {
  const a = { primaryLagDays: 25, secondaryLagDays: 30, dosLagDays: 25, medicaidCycleDays: 60, horizonDays: 90, reorderRate: 1, collectionRate: 1, startingCash: 0, supplierOwed: 0, supplierSpreadDays: 30, monthlyFixedCost: 0, granularity: "week" as const, includePaused: true };
  it("non-Medicaid: single upcoming order", () => {
    const o = orderDatesFor(patient({ primaryPayer: "Cigna", nextOrderDate: ymd(addDays(TODAY, 10)) }), TODAY, a);
    expect(o.length).toBe(1);
  });
  it("Medicaid: next order + a +60-day recurrence within 90 days", () => {
    const o = orderDatesFor(patient({ primaryPayer: "Medicaid", nextOrderDate: ymd(addDays(TODAY, 5)) }), TODAY, a);
    expect(o.length).toBe(2); // day +5 and day +65
    expect(o[1].occurrence).toBe(1);
    expect(ymd(o[1].date)).toBe(ymd(addDays(o[0].date, 60)));
  });
  it("Medicaid: rolls a stale past Next Order forward to upcoming occurrences", () => {
    const o = orderDatesFor(patient({ primaryPayer: "Medicaid", nextOrderDate: "2026-02-06" }), TODAY, a);
    expect(o.length).toBeGreaterThanOrEqual(1);
    // every generated order should be recent/future, not months old
    for (const x of o) expect(x.date.getTime()).toBeGreaterThan(addDays(TODAY, -40).getTime());
  });
  it("excludes orders beyond the horizon", () => {
    const o = orderDatesFor(patient({ primaryPayer: "Cigna", nextOrderDate: ymd(addDays(TODAY, 200)) }), TODAY, a);
    expect(o.length).toBe(0);
  });
});

// ─── Order classification ─────────────────────────────────────────────────────
describe("orderState", () => {
  it("future order = projected", () => expect(orderState(patient(), addDays(TODAY, 10), TODAY)).toBe("projected"));
  it("past order, denied", () => expect(orderState(patient({ primaryClaimPaid: "Denied" }), addDays(TODAY, -10), TODAY)).toBe("denied"));
  it("past order, paid date present = settled", () => expect(orderState(patient({ claimsPaidDate: "2026-06-08" }), addDays(TODAY, -10), TODAY)).toBe("settled"));
  it("past order, no info = in-flight", () => expect(orderState(patient(), addDays(TODAY, -10), TODAY)).toBe("in-flight"));
});

// ─── End-to-end reconciliation invariants (accuracy bar) ──────────────────────
describe("buildForecast — reconciliation invariants", () => {
  const base = { startingCash: 100000, supplierOwed: 0, monthlyFixedCost: 0, horizonDays: 90, granularity: "week" as const };

  it("balanceIn90 == netStartingCash + netOperatingCash (exact reconciliation)", () => {
    const f = buildForecast(
      [patient({ primaryPayer: "Medicare A&B", revenue: 954, cost: 500, nextOrderDate: ymd(addDays(TODAY, 3)) }),
       patient({ id: "p2", primaryPayer: "Medicaid", revenue: 564.3, cost: 314, nextOrderDate: ymd(addDays(TODAY, 2)) })],
      TODAY, { ...base, monthlyFixedCost: 30000 });
    expect(f.kpis.balanceIn90).toBeCloseTo(f.kpis.netStartingCash + f.kpis.netOperatingCash, 1);
  });

  it("opens at cash in bank (supplier payable is NOT netted at day 0)", () => {
    const f = buildForecast([patient()], TODAY, { startingCash: 50000, supplierOwed: 12000 });
    expect(f.kpis.netStartingCash).toBeCloseTo(50000);
    expect(f.balanceCurve[0].balance).toBeCloseTo(50000); // day 0 = full cash
  });

  it("bucket inflows/cost sum to KPI totals", () => {
    const f = buildForecast(
      Array.from({ length: 20 }, (_, i) => patient({ id: `p${i}`, primaryPayer: i % 2 ? "Medicaid" : "Medicare A&B", revenue: 800 + i, cost: 300, nextOrderDate: ymd(addDays(TODAY, (i % 30))) })),
      TODAY, { ...base, monthlyFixedCost: 10000 });
    const bPrim = f.buckets.reduce((s, b) => s + b.primaryIn, 0);
    const bSec = f.buckets.reduce((s, b) => s + b.secondaryIn, 0);
    const bCost = f.buckets.reduce((s, b) => s + b.costOut, 0);
    const bBurn = f.buckets.reduce((s, b) => s + b.burn, 0);
    expect(bPrim).toBeCloseTo(f.kpis.primaryIn, 0);
    expect(bSec).toBeCloseTo(f.kpis.secondaryIn, 0);
    expect(bCost).toBeCloseTo(f.kpis.costOut, 0);
    expect(bBurn).toBeCloseTo(f.kpis.burnOut, 0);
  });

  it("last bucket endBalance == balanceIn90 (bucket curve matches daily curve)", () => {
    const f = buildForecast(
      [patient({ primaryPayer: "Medicaid", revenue: 564, cost: 314, nextOrderDate: ymd(addDays(TODAY, 4)) })],
      TODAY, { ...base, monthlyFixedCost: 8000, granularity: "week" });
    const last = f.buckets[f.buckets.length - 1];
    expect(last.endBalance).toBeCloseTo(f.kpis.balanceIn90, 0);
  });

  it("balanceCurve has horizon+1 points", () => {
    const f = buildForecast([patient()], TODAY, { horizonDays: 90 });
    expect(f.balanceCurve.length).toBe(91);
  });

  it("revenueIn = primaryIn + secondaryIn", () => {
    const f = buildForecast([patient({ primaryPayer: "Medicare A&B", revenue: 1000, cost: 0, nextOrderDate: ymd(addDays(TODAY, 3)) })], TODAY, base);
    expect(f.kpis.revenueIn).toBeCloseTo(f.kpis.primaryIn + f.kpis.secondaryIn);
  });
});

// ─── Plugs ────────────────────────────────────────────────────────────────────
describe("buildForecast — plugs scale correctly", () => {
  const p = () => patient({ primaryPayer: "Medicare A&B", revenue: 1000, cost: 400, nextOrderDate: ymd(addDays(TODAY, 3)) });
  it("collectionRate scales revenue but not cost", () => {
    const full = buildForecast([p()], TODAY, { startingCash: 0, collectionRate: 1 });
    const half = buildForecast([p()], TODAY, { startingCash: 0, collectionRate: 0.5 });
    expect(half.kpis.revenueIn).toBeCloseTo(full.kpis.revenueIn * 0.5, 1);
    expect(half.kpis.costOut).toBeCloseTo(full.kpis.costOut, 1); // cost unchanged
  });
  it("reorderRate scales projected revenue AND cost", () => {
    const full = buildForecast([p()], TODAY, { startingCash: 0, reorderRate: 1 });
    const half = buildForecast([p()], TODAY, { startingCash: 0, reorderRate: 0.5 });
    expect(half.kpis.revenueIn).toBeCloseTo(full.kpis.revenueIn * 0.5, 1);
    expect(half.kpis.costOut).toBeCloseTo(full.kpis.costOut * 0.5, 1);
  });
});

// ─── Runway + headroom (answer the hiring / +$20k question) ────────────────────
describe("buildForecast — runway & headroom", () => {
  it("no shortfall when cash is ample -> runway null", () => {
    const f = buildForecast([patient()], TODAY, { startingCash: 1_000_000, monthlyFixedCost: 1000 });
    expect(f.kpis.runwayDays).toBeNull();
  });
  it("runway triggers when burn exceeds cash", () => {
    const f = buildForecast([], TODAY, { startingCash: 10000, monthlyFixedCost: 30000, horizonDays: 90 });
    // ~$1k/day burn on $10k -> negative around day 10
    expect(f.kpis.runwayDays).not.toBeNull();
    expect(f.kpis.runwayDays!).toBeGreaterThan(5);
    expect(f.kpis.runwayDays!).toBeLessThan(15);
  });
  it("adding monthlyHeadroom keeps min balance ~ >= 0; adding more breaks it", () => {
    const pts = [patient({ primaryPayer: "Medicaid", revenue: 564, cost: 314, nextOrderDate: ymd(addDays(TODAY, 5)) })];
    const f = buildForecast(pts, TODAY, { startingCash: 50000, monthlyFixedCost: 10000 });
    const hr = f.kpis.monthlyHeadroom;
    expect(hr).toBeGreaterThan(0);
    const atHeadroom = buildForecast(pts, TODAY, { startingCash: 50000, monthlyFixedCost: 10000 + hr });
    expect(atHeadroom.kpis.minBalance).toBeGreaterThanOrEqual(-1); // ~0 within rounding
    const overHeadroom = buildForecast(pts, TODAY, { startingCash: 50000, monthlyFixedCost: 10000 + hr + 2000 });
    expect(overHeadroom.kpis.minBalance).toBeLessThan(0);
  });
});

// ─── Scope filters + settled exclusion ─────────────────────────────────────────
describe("buildForecast — scope & settled", () => {
  it("excludes Not Active group", () => {
    const f = buildForecast([patient({ isNotActive: true })], TODAY, {});
    expect(f.kpis.patientsInScope).toBe(0);
  });
  it("includes Paused by default, can be excluded", () => {
    const pts = [patient({ status: "Paused" })];
    expect(buildForecast(pts, TODAY, { includePaused: true }).kpis.patientsInScope).toBe(1);
    expect(buildForecast(pts, TODAY, { includePaused: false }).kpis.patientsInScope).toBe(0);
  });
  it("a past-dated subscription order is NOT projected (claims pipeline owns it)", () => {
    const f = buildForecast(
      [patient({ primaryPayer: "Cigna", revenue: 1000, cost: 400, nextOrderDate: ymd(addDays(TODAY, -10)) })],
      TODAY, { startingCash: 0 });
    expect(f.kpis.primaryIn).toBeCloseTo(0); // future-only; already-placed orders come from claims
    expect(f.kpis.costOut).toBeCloseTo(0);
  });
});


// ─── Claims A/R pipeline ────────────────────────────────────────────────────
describe("buildForecast — claims pipeline", () => {
  it("submitted claim lands at DOS + dosLag (25) with no cost", () => {
    const pipe = [{ id: "c1", patientName: "Pipe Pt", payor: "Cigna", kind: "primary" as const, dos: ymd(addDays(TODAY, -5)), sentDate: ymd(addDays(TODAY, -4)), payDate: null, amount: 1000 }];
    const f = buildForecast([], TODAY, { startingCash: 0 }, pipe);
    // pay date = DOS-5 + 25 = TODAY+20, inside window
    expect(f.kpis.primaryIn).toBeCloseTo(1000, 0);
    expect(f.kpis.costOut).toBeCloseTo(0); // pipeline carries no cost
    const ev = f.events.find((e) => e.patientId === "c1");
    expect(ev?.date).toBe(ymd(addDays(TODAY, 20)));
    expect(ev?.state).toBe("in-flight");
  });
  it("uses a known ERA pay date when present", () => {
    const pipe = [{ id: "c2", patientName: "x", payor: "Aetna Commercial", kind: "primary" as const, dos: ymd(addDays(TODAY, -40)), sentDate: ymd(addDays(TODAY, -38)), payDate: ymd(addDays(TODAY, 3)), amount: 500 }];
    const f = buildForecast([], TODAY, { startingCash: 0 }, pipe);
    expect(f.events.find((e) => e.patientId === "c2")?.date).toBe(ymd(addDays(TODAY, 3)));
  });
  it("pipeline inflow + future-order projection do not double count (different orders)", () => {
    const sub = [patient({ id: "p1", primaryPayer: "Cigna", revenue: 1000, cost: 400, nextOrderDate: ymd(addDays(TODAY, 5)) })];
    const pipe = [{ id: "p1-claim", patientName: "n", payor: "Cigna", kind: "primary" as const, dos: ymd(addDays(TODAY, -3)), sentDate: null, payDate: null, amount: 900 }];
    const f = buildForecast(sub, TODAY, { startingCash: 0, collectionRate: 1 }, pipe);
    // future order primary (1000) + pipeline (900) both counted once
    expect(f.kpis.primaryIn).toBeCloseTo(1900, 0);
  });
  it("collectionRate scales pipeline; reorderRate does not", () => {
    const pipe = [{ id: "c3", patientName: "x", payor: "Cigna", kind: "primary" as const, dos: ymd(addDays(TODAY, -2)), sentDate: null, payDate: null, amount: 1000 }];
    const full = buildForecast([], TODAY, { startingCash: 0 }, pipe);
    const coll = buildForecast([], TODAY, { startingCash: 0, collectionRate: 0.9 }, pipe);
    const reorder = buildForecast([], TODAY, { startingCash: 0, reorderRate: 0.5 }, pipe);
    expect(coll.kpis.primaryIn).toBeCloseTo(full.kpis.primaryIn * 0.9, 1);
    expect(reorder.kpis.primaryIn).toBeCloseTo(full.kpis.primaryIn, 1); // unaffected
  });
});

// ─── Supplier payable spread over 30 days ───────────────────────────────────
describe("buildForecast — supplier payable spread", () => {
  it("$300k owed spreads to ~$10k/day over 30 days; balance opens at cash and draws down", () => {
    const f = buildForecast([], TODAY, { startingCash: 200000, supplierOwed: 300000, supplierSpreadDays: 30, horizonDays: 90 });
    expect(f.balanceCurve[0].balance).toBeCloseTo(200000);          // opens at cash in bank
    expect(f.balanceCurve[30].balance).toBeCloseTo(200000 - 300000); // fully drawn by day 30 = -100k
    expect(f.balanceCurve[60].balance).toBeCloseTo(-100000);        // flat after 30 (no other flows)
    expect(f.kpis.supplierOut).toBeCloseTo(300000);
    // ~$10k/day for first 30 days
    expect(f.balanceCurve[1].balance).toBeCloseTo(190000);
    expect(f.balanceCurve[15].balance).toBeCloseTo(200000 - 150000);
  });
  it("supplier draw shows in buckets and bucket burns/supplier sum to KPI", () => {
    const f = buildForecast([], TODAY, { startingCash: 100000, supplierOwed: 60000, supplierSpreadDays: 30, monthlyFixedCost: 30000, granularity: "week" });
    const sup = f.buckets.reduce((s, b) => s + b.supplier, 0);
    expect(sup).toBeCloseTo(f.kpis.supplierOut, 0);
    expect(sup).toBeCloseTo(60000, 0);
  });
  it("balanceIn90 == startingCash + netOperatingCash (with supplier in netOpCash)", () => {
    const f = buildForecast(
      [patient({ primaryPayer: "Medicare A&B", revenue: 954, cost: 500, nextOrderDate: ymd(addDays(TODAY, 3)) })],
      TODAY, { startingCash: 200000, supplierOwed: 275000, supplierSpreadDays: 30, monthlyFixedCost: 25000 });
    expect(f.kpis.balanceIn90).toBeCloseTo(f.kpis.netStartingCash + f.kpis.netOperatingCash, 0);
    expect(f.kpis.netStartingCash).toBeCloseTo(200000);
  });
});
describe("buildForecast — transition de-dupe", () => {
  it("suppresses a near-term subscription order when the patient already has an open claim", () => {
    const near = patient({ primaryPayer: "Cigna", revenue: 1000, cost: 400, nextOrderDate: ymd(addDays(TODAY, 3)), hasOpenClaim: true });
    expect(orderDatesFor(near, TODAY, { ...DEFAULT_ASSUMPTIONS }).length).toBe(0);
    // a far-future order (next cycle) is still kept
    const far = patient({ primaryPayer: "Cigna", revenue: 1000, nextOrderDate: ymd(addDays(TODAY, 70)), hasOpenClaim: true });
    expect(orderDatesFor(far, TODAY, { ...DEFAULT_ASSUMPTIONS }).length).toBe(1);
    // without an open claim, the near-term order is kept
    const noClaim = patient({ primaryPayer: "Cigna", revenue: 1000, nextOrderDate: ymd(addDays(TODAY, 3)) });
    expect(orderDatesFor(noClaim, TODAY, { ...DEFAULT_ASSUMPTIONS }).length).toBe(1);
  });
});
