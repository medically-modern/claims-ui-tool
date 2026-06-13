/**
 * forecast.ts — Subscription Board cash-flow forecasting engine.
 *
 * PURPOSE (the questions this must answer precisely):
 *   1. How much operating cash do I have to work with over the next 90 days?
 *   2. What will my bank balance be in 30 / 60 / 90 days?
 *   3. If fixed costs rise (e.g. +$20k/mo), can I absorb it? (→ runway, headroom)
 *   4. Can I afford to hire? (→ headroom = max additional monthly burn before $0)
 *
 * MODEL (locked with Brandon 2026-06-13):
 *   - Each order → primary inflow + cost outflow at orderDate + 25 calendar days
 *     (Medicaid uses the precise eMedNY cycle from cashflow.ts instead of +25).
 *   - Secondary inflow at primaryPayDate + 30 days, when a secondary/PR portion
 *     exists (paid by a secondary insurer OR by the patient directly).
 *   - Revenue split: Medicare A&B = 80/20 primary/secondary; pure Medicaid =
 *     100% primary; everyone else = secondary is the patient-responsibility /
 *     OOP portion (OOP Estimate column, else coinsurance% × revenue + deductible
 *     remaining), primary is the rest.
 *   - Recurrence: only pure Medicaid recurs in a 90-day window (60-day cycle);
 *     a second (and possibly third) order is projected at +60-day steps. All
 *     other payers contribute their single Next Order.
 *   - Two plugs: reorderRate (% of projected orders that actually happen) and
 *     collectionRate (% of billed revenue actually collected). Cost is NOT
 *     scaled by collectionRate — a denied order still cost us the product.
 *   - Bank balance anchors on (cash in bank − amount owed to supplier), then
 *     runs net cash flow (inflows − cost − fixed-cost burn) forward.
 *
 * The Monday data is never mutated; all math lives here. Mirrors the structure
 * and testability of lib/claims/cashflow.ts and reuses its Medicaid timing.
 */

import { isPureMedicaid, medicaidPaymentDate } from "@/lib/claims/cashflow";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";

// ─── Date helpers (local-time, no UTC drift — same discipline as cashflow.ts) ─
export function parseLocalDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : startOfDay(d);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}
function diffDays(later: Date, earlier: Date): number {
  return Math.round(
    (startOfDay(later).getTime() - startOfDay(earlier).getTime()) / 86_400_000,
  );
}

// ─── Number parsing ───────────────────────────────────────────────────────────
export function parseNum(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Coinsurance can arrive as a fraction (0.2), a percent (20), or "20%".
 *  Normalise to a 0..1 fraction. Values >1 are treated as percents. */
export function coinsuranceFraction(raw: string | number | null | undefined): number {
  const n = parseNum(raw);
  if (n <= 0) return 0;
  const f = n <= 1 ? n : n / 100;
  return Math.min(Math.max(f, 0), 1);
}

// ─── Payer classification ─────────────────────────────────────────────────────
/** Strictly traditional Medicare A&B (the 80/20 case). Medicare *Advantage*
 *  plans ("Aetna Medicare", "United Medicare", "Anthem BCBS Medicare") are NOT
 *  A&B and fall through to the OOP-based split — same boundary cashflow.ts uses. */
export function isMedicareAB(payer: string | null | undefined): boolean {
  return /^medicare\s*a&?b$/i.test((payer || "").trim());
}

// ─── Public types ─────────────────────────────────────────────────────────────
export type SubType = "Sensors" | "Supplies" | "Sensors & Supplies" | string;

/** Minimal, engine-only patient shape. Decoupled from the Monday types so the
 *  engine is trivially unit-testable. Build one with forecastPatientFromLive(). */
export interface ForecastPatient {
  id: string;
  name: string;
  primaryPayer: string;
  /** "Secondary Insurance" text. "None"/"" = no secondary insurer. */
  secondaryPayer: string;
  subscriptionType: SubType;
  status: string; // Active | Paused | "" ...
  isNotActive: boolean;
  nextOrderDate: string; // YYYY-MM-DD
  revenue: number; // Total Revenue for one order
  cost: number; // order cost (COGS) for one order
  oopEstimate: number; // precomputed patient OOP for the order (0 = unknown)
  coinsuranceFrac: number; // 0..1
  dedRemaining: number; // $ deductible remaining
  // Claims actuals (subscription-side rollup), about the most recent claim:
  primaryClaimPaid: string; // Fully Paid | Denied | Partial | ""
  secondaryClaimPaid: string; // Fully Paid | Outstanding | None | ""
  claimsPaidDate: string; // YYYY-MM-DD | ""
  claimsStatus: string; // Claims Paid | Claims Denied | ""
}

export interface ForecastAssumptions {
  primaryLagDays: number; // 25
  secondaryLagDays: number; // 30
  medicaidCycleDays: number; // 60
  horizonDays: number; // 90
  reorderRate: number; // 0..1 — % of projected orders that actually happen
  collectionRate: number; // 0..1 — % of billed revenue actually collected
  startingCash: number; // cash in bank today
  supplierOwed: number; // amount currently owed to supplier (a payable)
  monthlyFixedCost: number; // operating burn / month
  granularity: "week" | "month";
  includePaused: boolean; // include Paused-status patients (default true)
}

export const DEFAULT_ASSUMPTIONS: ForecastAssumptions = {
  primaryLagDays: 25,
  secondaryLagDays: 30,
  medicaidCycleDays: 60,
  horizonDays: 90,
  reorderRate: 1,
  collectionRate: 1,
  startingCash: 0,
  supplierOwed: 0,
  monthlyFixedCost: 0,
  granularity: "week",
  includePaused: true,
};

export type EventKind = "primary" | "secondary" | "cost";
export type OrderState = "settled" | "in-flight" | "denied" | "projected";

export interface CashEvent {
  patientId: string;
  patientName: string;
  payor: string;
  kind: EventKind;
  /** Signed dollars: inflows positive, cost negative. Already scaled by the
   *  applicable reorder/collection plugs. */
  amount: number;
  date: string; // YYYY-MM-DD the cash moves
  orderDate: string; // YYYY-MM-DD the order is placed
  occurrence: number; // 0 = next order, 1 = first Medicaid recurrence, ...
  state: OrderState;
  subscriptionType: SubType;
}

export interface RevenueSplit {
  primary: number;
  secondary: number;
  basis:
    | "medicare_80_20"
    | "medicaid_full_primary"
    | "oop_estimate"
    | "coins_plus_deductible"
    | "no_pr_data_all_primary"
    | "no_revenue";
}

export interface TimeBucket {
  key: string; // ISO start of bucket
  label: string;
  primaryIn: number;
  secondaryIn: number;
  costOut: number; // positive number
  burn: number; // positive number
  net: number; // primaryIn + secondaryIn − costOut − burn
  endBalance: number; // running bank balance at the end of this bucket
}

export interface GroupAgg {
  key: string;
  revenue: number;
  cost: number;
  gp: number;
  orders: number;
  patients: number;
}

export interface ForecastKpis {
  netStartingCash: number; // startingCash − supplierOwed
  balanceIn30: number;
  balanceIn60: number;
  balanceIn90: number; // balance at end of horizon
  minBalance: number;
  minBalanceDate: string;
  netOperatingCash: number; // inflows − cost − burn across the window
  revenueIn: number; // primary + secondary collected in window
  primaryIn: number;
  secondaryIn: number;
  costOut: number;
  burnOut: number;
  /** Largest additional monthly fixed cost we could add and still keep the
   *  balance ≥ 0 for the whole window. Directly answers "can I hire / absorb
   *  +$20k?". Infinity-safe: returns a large number if never binding. */
  monthlyHeadroom: number;
  runwayDays: number | null; // days until balance < 0; null = no shortfall in window
  lockedInflow: number; // settled + in-flight inflow in window (vs projected)
  projectedInflow: number;
  patientsInScope: number;
  ordersInWindow: number;
}

export interface ForecastResult {
  events: CashEvent[];
  balanceCurve: Array<{ date: string; balance: number }>;
  buckets: TimeBucket[];
  byPayer: GroupAgg[];
  byType: GroupAgg[];
  kpis: ForecastKpis;
  assumptions: ForecastAssumptions;
  windowStart: string;
  windowEnd: string;
}

// ─── Live → engine mapper ──────────────────────────────────────────────────────
const NOT_ACTIVE_GROUP_ID = "group_mkp19fyp";

export function forecastPatientFromLive(p: LiveSubscriptionPatient): ForecastPatient {
  const f = p.financials;
  // Cost: trust the board's own net where possible so order GP reconciles
  // exactly to the Total GP column (handles whether shipping is already inside
  // Total Cost). Fall back to Total Cost + Shipping when GP is absent.
  const revenue = f ? f.totalRevenue : 0;
  let cost = 0;
  if (f) {
    if (revenue > 0 && f.totalGP !== 0) cost = revenue - f.totalGP;
    else cost = f.totalCost + f.shippingCost;
  }
  return {
    id: p.id,
    name: p.name,
    primaryPayer: p.primaryPayer || "",
    secondaryPayer: p.secondaryInsurance || "",
    subscriptionType: p.subscriptionType,
    status: p.patientStatus || "",
    isNotActive: p.isNotActive || p.groupId === NOT_ACTIVE_GROUP_ID,
    nextOrderDate: p.nextOrderDate || "",
    revenue,
    cost,
    oopEstimate: parseNum(p.oopEstimate),
    coinsuranceFrac: coinsuranceFraction(p.coinsurancePct),
    dedRemaining: parseNum(p.dedRemaining),
    primaryClaimPaid: p.primaryClaimPaid || "",
    secondaryClaimPaid: p.secondaryClaimPaid || "",
    claimsPaidDate: p.claimsPaidDate || "",
    claimsStatus: p.claimsStatusCol || "",
  };
}

// ─── Core math ─────────────────────────────────────────────────────────────────
/** Split one order's revenue into primary (lands at +25) and secondary (+55). */
export function splitRevenue(p: ForecastPatient): RevenueSplit {
  const rev = p.revenue;
  if (rev <= 0) return { primary: 0, secondary: 0, basis: "no_revenue" };

  if (isMedicareAB(p.primaryPayer)) {
    return { primary: rev * 0.8, secondary: rev * 0.2, basis: "medicare_80_20" };
  }
  if (isPureMedicaid(p.primaryPayer)) {
    return { primary: rev, secondary: 0, basis: "medicaid_full_primary" };
  }
  // Everyone else: secondary = patient-responsibility / OOP portion.
  if (p.oopEstimate > 0) {
    const sec = Math.min(p.oopEstimate, rev);
    return { primary: rev - sec, secondary: sec, basis: "oop_estimate" };
  }
  const pr = Math.min(p.coinsuranceFrac * rev + p.dedRemaining, rev);
  if (pr > 0) {
    return { primary: rev - pr, secondary: pr, basis: "coins_plus_deductible" };
  }
  // No PR signal at all → assume the primary pays the whole order.
  return { primary: rev, secondary: 0, basis: "no_pr_data_all_primary" };
}

/** Primary pay date for an order. Medicaid → eMedNY cycle; others → +lag. */
export function primaryPayDate(p: ForecastPatient, orderDate: Date, a: ForecastAssumptions): Date {
  if (isPureMedicaid(p.primaryPayer)) return startOfDay(medicaidPaymentDate(orderDate));
  return addDays(orderDate, a.primaryLagDays);
}

/** Generate the order dates a patient contributes within the window. Medicaid
 *  recurs every `medicaidCycleDays`; everyone else contributes one Next Order.
 *  We roll Medicaid forward so a stale past Next Order still yields the correct
 *  upcoming occurrences. We keep any order whose cash could still land today or
 *  later (i.e. orderDate not so old its pay date is already past). */
export function orderDatesFor(
  p: ForecastPatient,
  today: Date,
  a: ForecastAssumptions,
): Array<{ date: Date; occurrence: number }> {
  const base = parseLocalDate(p.nextOrderDate);
  if (!base) return [];
  const horizonEnd = addDays(today, a.horizonDays);
  // An order placed up to ~ (primaryLag + a few) days ago can still pay in the
  // future; older than that and its primary cash is already in the past.
  const earliest = addDays(today, -(a.primaryLagDays + 7));

  if (!isPureMedicaid(p.primaryPayer)) {
    // Single order. Include it if it's anywhere from `earliest` to horizonEnd;
    // the windowing step keeps only cash that lands today-or-later.
    if (base.getTime() < earliest.getTime() || base.getTime() > horizonEnd.getTime()) {
      // Past order whose cash already landed, or beyond the window.
      return base.getTime() > horizonEnd.getTime() ? [] : [{ date: base, occurrence: 0 }];
    }
    return [{ date: base, occurrence: 0 }];
  }

  // Medicaid: step by cycle from the first occurrence ≥ earliest.
  const cycle = Math.max(1, a.medicaidCycleDays);
  let first = base;
  if (first.getTime() < earliest.getTime()) {
    const steps = Math.ceil(diffDays(earliest, first) / cycle);
    first = addDays(first, steps * cycle);
  }
  const out: Array<{ date: Date; occurrence: number }> = [];
  let occ = Math.max(0, Math.round(diffDays(first, base) / cycle));
  for (let d = first; d.getTime() <= horizonEnd.getTime(); d = addDays(d, cycle)) {
    out.push({ date: d, occurrence: occ });
    occ += 1;
    if (out.length > 12) break; // safety
  }
  return out;
}

/** Classify an order against the patient's claims actuals. Future orders are
 *  always "projected" (claims columns describe a *past* cycle). For the current
 *  cycle we read the rollup. */
export function orderState(p: ForecastPatient, orderDate: Date, today: Date): OrderState {
  if (orderDate.getTime() > today.getTime()) return "projected";
  if (/denied/i.test(p.primaryClaimPaid) || /denied/i.test(p.claimsStatus)) return "denied";
  const paid = parseLocalDate(p.claimsPaidDate);
  if (paid || /fully paid|paid/i.test(p.primaryClaimPaid) || /claims paid/i.test(p.claimsStatus)) {
    return "settled";
  }
  return "in-flight";
}

// ─── Build forecast ──────────────────────────────────────────────────────────
export function buildForecast(
  patients: ForecastPatient[],
  today: Date = new Date(),
  partial: Partial<ForecastAssumptions> = {},
): ForecastResult {
  const a: ForecastAssumptions = { ...DEFAULT_ASSUMPTIONS, ...partial };
  const t0 = startOfDay(today);
  const windowStart = t0;
  const windowEnd = addDays(t0, a.horizonDays);

  const inScope = patients.filter(
    (p) => !p.isNotActive && (a.includePaused || !/paused/i.test(p.status)),
  );

  const events: CashEvent[] = [];
  let ordersInWindow = 0;
  const payerSet = new Set<string>();

  for (const p of inScope) {
    const split = splitRevenue(p);
    const orders = orderDatesFor(p, t0, a);
    for (const { date: orderDate, occurrence } of orders) {
      const state = orderState(p, orderDate, t0);
      const isProjected = state === "projected";
      const reorderMult = isProjected ? a.reorderRate : 1;
      const payP = primaryPayDate(p, orderDate, a);
      const paySec = addDays(payP, a.secondaryLagDays);
      // Settled primary lands on its actual paid date when we have one.
      const settledDate = parseLocalDate(p.claimsPaidDate);
      const primaryDate = state === "settled" && settledDate ? settledDate : payP;

      const inWindow = (d: Date) =>
        d.getTime() >= windowStart.getTime() && d.getTime() <= windowEnd.getTime();
      if (inWindow(payP)) ordersInWindow += 1;
      payerSet.add(p.primaryPayer || "—");

      // Cost outflow — always incurred (even on denials); scaled only by reorder.
      if (p.cost > 0) {
        events.push({
          patientId: p.id, patientName: p.name, payor: p.primaryPayer || "—",
          kind: "cost", amount: -(p.cost * reorderMult), date: ymd(payP),
          orderDate: ymd(orderDate), occurrence, state, subscriptionType: p.subscriptionType,
        });
      }

      // Primary inflow.
      if (split.primary > 0 && state !== "denied") {
        const amount =
          state === "settled"
            ? split.primary // already collected — trust the order's primary value
            : split.primary * reorderMult * a.collectionRate;
        events.push({
          patientId: p.id, patientName: p.name, payor: p.primaryPayer || "—",
          kind: "primary", amount, date: ymd(primaryDate),
          orderDate: ymd(orderDate), occurrence, state, subscriptionType: p.subscriptionType,
        });
      }

      // Secondary / patient-responsibility inflow at +30 from primary.
      const secondaryAlreadyPaid = /fully paid/i.test(p.secondaryClaimPaid);
      if (split.secondary > 0 && state !== "denied" && !secondaryAlreadyPaid) {
        const amount = split.secondary * reorderMult * a.collectionRate;
        events.push({
          patientId: p.id, patientName: p.name, payor: p.primaryPayer || "—",
          kind: "secondary", amount, date: ymd(paySec),
          orderDate: ymd(orderDate), occurrence, state, subscriptionType: p.subscriptionType,
        });
      }
    }
  }

  // ─── Daily balance curve over [windowStart, windowEnd] ──────────────────────
  const dailyBurn = (a.monthlyFixedCost * 12) / 365;
  const netStartingCash = a.startingCash - a.supplierOwed;
  const dayNet = new Map<string, number>(); // ymd → signed cash (events only)
  for (const e of events) {
    const d = parseLocalDate(e.date)!;
    if (d.getTime() < windowStart.getTime() || d.getTime() > windowEnd.getTime()) continue;
    dayNet.set(e.date, (dayNet.get(e.date) ?? 0) + e.amount);
  }
  // balance[i] = netStartingCash + cumulative cash through day i − burn×i.
  // Burn accrues for days 1..horizon (today's burn is already reflected in the
  // opening cash), so the total burn over the curve is exactly dailyBurn×horizon
  // — which makes balanceIn90 reconcile to netStartingCash + netOperatingCash.
  const balanceCurve: Array<{ date: string; balance: number }> = [];
  let cumCash = 0;
  let minBalance = Infinity;
  let minBalanceDate = ymd(windowStart);
  let runwayDays: number | null = null;
  for (let i = 0; i <= a.horizonDays; i++) {
    const d = addDays(windowStart, i);
    const key = ymd(d);
    cumCash += dayNet.get(key) ?? 0;
    const b = netStartingCash + cumCash - dailyBurn * i;
    balanceCurve.push({ date: key, balance: round2(b) });
    if (b < minBalance) { minBalance = b; minBalanceDate = key; }
    if (runwayDays === null && b < 0) runwayDays = i;
  }
  const bal = netStartingCash + cumCash - dailyBurn * a.horizonDays;

  // ─── Window KPIs ────────────────────────────────────────────────────────────
  const winEvents = events.filter((e) => {
    const d = parseLocalDate(e.date)!;
    return d.getTime() >= windowStart.getTime() && d.getTime() <= windowEnd.getTime();
  });
  const sum = (pred: (e: CashEvent) => boolean) =>
    winEvents.filter(pred).reduce((s, e) => s + e.amount, 0);
  const primaryIn = sum((e) => e.kind === "primary");
  const secondaryIn = sum((e) => e.kind === "secondary");
  const costOut = -sum((e) => e.kind === "cost"); // positive
  const burnOut = round2(dailyBurn * a.horizonDays);
  const revenueIn = round2(primaryIn + secondaryIn);
  const netOperatingCash = round2(revenueIn - costOut - burnOut);
  const lockedInflow = round2(
    winEvents.filter((e) => e.kind !== "cost" && (e.state === "settled" || e.state === "in-flight"))
      .reduce((s, e) => s + e.amount, 0),
  );
  const projectedInflow = round2(
    winEvents.filter((e) => e.kind !== "cost" && e.state === "projected")
      .reduce((s, e) => s + e.amount, 0),
  );

  const balanceAt = (days: number) => {
    const idx = Math.min(days, a.horizonDays);
    return balanceCurve[idx]?.balance ?? bal;
  };

  // Headroom: max extra monthly fixed cost keeping balance ≥ 0 across the window.
  // Adding ΔM/month reduces balance on day i by ΔM*(12/365)*i. Binding day is the
  // one minimising balance[i] / ((12/365)*i). (Day 0 has no extra burn.)
  let monthlyHeadroom = Infinity;
  for (let i = 1; i <= a.horizonDays; i++) {
    const perDay = (12 / 365) * i;
    const cap = balanceCurve[i].balance / perDay;
    if (cap < monthlyHeadroom) monthlyHeadroom = cap;
  }
  if (!Number.isFinite(monthlyHeadroom)) monthlyHeadroom = balanceAt(a.horizonDays);

  // ─── Buckets (week/month) for the bar chart ─────────────────────────────────
  const buckets = bucketize(winEvents, windowStart, windowEnd, a, netStartingCash, dailyBurn);

  // ─── Breakdowns (one order's economics per event-group; use primary+secondary
  //     revenue and cost, deduped by patient+orderDate so we don't double count) ─
  const { byPayer, byType } = breakdowns(winEvents);

  const kpis: ForecastKpis = {
    netStartingCash: round2(netStartingCash),
    balanceIn30: balanceAt(30),
    balanceIn60: balanceAt(60),
    balanceIn90: balanceAt(90),
    minBalance: round2(minBalance),
    minBalanceDate,
    netOperatingCash,
    revenueIn,
    primaryIn: round2(primaryIn),
    secondaryIn: round2(secondaryIn),
    costOut: round2(costOut),
    burnOut,
    monthlyHeadroom: round2(monthlyHeadroom),
    runwayDays,
    lockedInflow,
    projectedInflow,
    patientsInScope: inScope.length,
    ordersInWindow,
  };

  return {
    events,
    balanceCurve,
    buckets,
    byPayer,
    byType,
    kpis,
    assumptions: a,
    windowStart: ymd(windowStart),
    windowEnd: ymd(windowEnd),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function bucketStartKey(d: Date, granularity: "week" | "month"): { key: string; label: string } {
  if (granularity === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    return {
      key: ymd(start),
      label: start.toLocaleString("en-US", { month: "short", year: "2-digit" }),
    };
  }
  // Week starting Monday.
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  const start = addDays(d, -day);
  return {
    key: ymd(start),
    label: start.toLocaleString("en-US", { month: "short", day: "numeric" }),
  };
}

function bucketize(
  winEvents: CashEvent[],
  windowStart: Date,
  windowEnd: Date,
  a: ForecastAssumptions,
  netStartingCash: number,
  dailyBurn: number,
): TimeBucket[] {
  const map = new Map<string, TimeBucket>();
  const order: string[] = [];
  // Seed buckets across the whole window so empty periods still render.
  for (let d = bucketStartFloor(windowStart, a.granularity); d.getTime() <= windowEnd.getTime(); d = nextBucket(d, a.granularity)) {
    const { key, label } = bucketStartKey(d, a.granularity);
    if (!map.has(key)) {
      map.set(key, { key, label, primaryIn: 0, secondaryIn: 0, costOut: 0, burn: 0, net: 0, endBalance: 0 });
      order.push(key);
    }
  }
  for (const e of winEvents) {
    const d = parseLocalDate(e.date)!;
    const { key } = bucketStartKey(d, a.granularity);
    const b = map.get(key);
    if (!b) continue;
    if (e.kind === "primary") b.primaryIn += e.amount;
    else if (e.kind === "secondary") b.secondaryIn += e.amount;
    else b.costOut += -e.amount;
  }
  // Burn per bucket = dailyBurn × days of the bucket that fall inside the window.
  for (const key of order) {
    const b = map.get(key)!;
    const start = parseLocalDate(key)!;
    const end = bucketEnd(start, a.granularity);
    const burnStart = addDays(windowStart, 1); // day 0 carries no burn (see curve)
    const lo = Math.max(start.getTime(), burnStart.getTime());
    const hi = Math.min(end.getTime(), windowEnd.getTime());
    const days = hi >= lo ? Math.round((hi - lo) / 86_400_000) + 1 : 0;
    b.burn = round2(dailyBurn * days);
  }
  // Net + running balance.
  let bal = netStartingCash;
  const out: TimeBucket[] = [];
  for (const key of order) {
    const b = map.get(key)!;
    b.primaryIn = round2(b.primaryIn);
    b.secondaryIn = round2(b.secondaryIn);
    b.costOut = round2(b.costOut);
    b.net = round2(b.primaryIn + b.secondaryIn - b.costOut - b.burn);
    bal = round2(bal + b.net);
    b.endBalance = bal;
    out.push(b);
  }
  return out;
}

function bucketStartFloor(d: Date, g: "week" | "month"): Date {
  if (g === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  const day = (d.getDay() + 6) % 7;
  return addDays(d, -day);
}
function nextBucket(d: Date, g: "week" | "month"): Date {
  if (g === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return addDays(d, 7);
}
function bucketEnd(start: Date, g: "week" | "month"): Date {
  if (g === "month") return new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return addDays(start, 6);
}

/** Aggregate the window's economics by payer and by subscription type. We sum
 *  inflows and cost from the cash events (already plug-scaled), and count
 *  distinct orders (patient+orderDate) so "orders" is meaningful. */
function breakdowns(winEvents: CashEvent[]): { byPayer: GroupAgg[]; byType: GroupAgg[] } {
  function agg(keyOf: (e: CashEvent) => string): GroupAgg[] {
    const m = new Map<string, { revenue: number; cost: number; orders: Set<string>; patients: Set<string> }>();
    for (const e of winEvents) {
      const k = keyOf(e) || "—";
      if (!m.has(k)) m.set(k, { revenue: 0, cost: 0, orders: new Set(), patients: new Set() });
      const g = m.get(k)!;
      if (e.kind === "cost") g.cost += -e.amount;
      else g.revenue += e.amount;
      g.orders.add(`${e.patientId}|${e.orderDate}`);
      g.patients.add(e.patientId);
    }
    return Array.from(m.entries())
      .map(([key, v]) => ({
        key,
        revenue: round2(v.revenue),
        cost: round2(v.cost),
        gp: round2(v.revenue - v.cost),
        orders: v.orders.size,
        patients: v.patients.size,
      }))
      .sort((x, y) => y.revenue - x.revenue);
  }
  return {
    byPayer: agg((e) => e.payor),
    byType: agg((e) => String(e.subscriptionType)),
  };
}
