/**
 * unifiedForecast.ts — single forecast engine shared by the dashboard.
 * Mirrors engine.py EXACTLY (verified). In-flight from the Claims board; future
 * orders from the Subscription board (future-only, past-order rule, Medicaid
 * eMedNY + 60d recurrence); secondary +30; supplier spread; plugs. Mon–Sun weeks.
 */
export interface SubRow {
  group_title: string; primary_insurance: string; next_order_date: string; patient_name?: string;
  total_revenue: number; total_gp: number; total_cost: number; shipping_cost: number;
  oop_estimate: number; coinsurance: number; ded_remaining: number;
}
export interface ClaimLine { hcpcs: string; units: number; }
export interface ClaimRow {
  claim_status: string; est_pay: number; dos: string; claim_sent_date: string;
  primary_payor: string; claim_name?: string; primary_paid: number; primary_paid_date: string;
  item_id?: string; lines?: ClaimLine[];
}

// Conservative per-unit estimates by HCPCS (mirrors src/lib/claims/cashflow.ts +
// engine.py). Used only when we have no actual reimbursement for a claim/patient.
const CONSERVATIVE: Record<string, { medicare?: number; default: number }> = {
  E0784: { medicare: 300, default: 2500 }, E2103: { default: 150 },
  A4224: { default: 15 }, A4225: { default: 3 }, A4230: { default: 6 },
  A4231: { default: 6 }, A4232: { default: 3 }, A4239: { default: 150 },
};
const payorClass = (p: string) => (/^medicare\s+a&?b$/i.test((p || "").trim()) ? "medicare" : "other");
function conservativeFor(hcpcs: string, payor: string): number | undefined {
  const e = CONSERVATIVE[(hcpcs || "").trim().toUpperCase()];
  if (!e) return undefined;
  return (payorClass(payor) === "medicare" ? e.medicare : undefined) ?? e.default;
}
/** Σ conservativeFor(line) over a claim's HCPCS lines; undefined if no recognized line. */
function productConservative(r: ClaimRow): number | undefined {
  let tot = 0, got = false;
  for (const l of r.lines || []) {
    const v = conservativeFor(l.hcpcs, r.primary_payor);
    if (v !== undefined) { tot += v * (l.units || 1); got = true; }
  }
  return got ? tot : undefined;
}
/** Group a claim by product (claims carry pumps; the subscription board doesn't):
 *  pump (E0784) > cgm (A4239) > supplies (other codes). */
function productCategory(r: ClaimRow): string {
  const hcs = (r.lines || []).map((l) => (l.hcpcs || "").trim().toUpperCase());
  if (hcs.includes("E0784")) return "pump";
  if (hcs.includes("A4239")) return "cgm";
  return hcs.length ? "supplies" : "unknown";
}
// Collapse plan variants that share one rate. All Fidelis plans (Commercial,
// Medicare, Medicaid, Low-Cost) reimburse the same → treat them as one payer.
function normPayer(p: string): string {
  const s = (p || "").trim();
  return /^fidelis/i.test(s) ? "Fidelis" : s;
}
// Brandon-entered known rates for payer×product combos with NO paid history yet.
// Add an entry once the rate is known; it then shows in the forecast and drops off
// the "needs a real estimate" list. Keys are `${normPayer}|${category}`.
const MANUAL_RATES: Record<string, number> = { "Cigna|pump": 4200 };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export interface UAssumptions {
  primaryLag: number; secondaryLag: number; dosLag: number; resentLag: number;
  medicaidCycle: number; horizon: number; reorderRate: number; collectionRate: number;
  startingCash: number; supplierOwed: number; supplierSpreadDays: number;
  monthlyFixedCost: number; staleDays: number; newPatientsPerWeek: number;
}
export const UDEFAULT: UAssumptions = {
  primaryLag: 26, secondaryLag: 30, dosLag: 26, resentLag: 25, medicaidCycle: 60,
  horizon: 90, reorderRate: 1, collectionRate: 1, startingCash: 210000,
  supplierOwed: 288000, supplierSpreadDays: 45, monthlyFixedCost: 30000, staleDays: 7,
  newPatientsPerWeek: 0,
};

function pDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const a = String(s).trim().split("/");
  if (a.length === 3) return new Date(+a[2], +a[0] - 1, +a[1]);
  return null;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayDiff(a: Date, b: Date): number { return Math.round((a.getTime() - b.getTime()) / 86400000); }
function iso(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function isMedicaid(p: string): boolean { return (p || "").trim() === "Medicaid"; }
function isMedicareAB(p: string): boolean { return /^medicare a&?b$/i.test((p || "").trim()); }
function emedny(od: Date): Date { return addDays(od, (3 - od.getDay() + 7) % 7 + 22); }
function splitRevenue(payer: string, rev: number, _oop: number, _coins: number, _ded: number): [number, number] {
  // Only Medicare A&B has a secondary (80/20). Everything else (Medicaid + all
  // commercial) is treated as 100% primary for now. (A future OOP-based split for
  // commercial plans can reintroduce _oop/_coins/_ded.)
  if (rev <= 0) return [0, 0];
  if (isMedicareAB(payer)) return [rev * 0.8, rev * 0.2];
  return [rev, 0];
}

export interface UEvent { dateISO: string; dos: string; kind: string; amount: number; patient: string; payer: string; week: number; }
export interface UResult {
  weekly: Array<{ wk: number; mon: string; primary: number; secondary: number; inflight: number; rev: number; cost: number; supplier: number; burn: number; net: number; balance: number }>;
  dbal: number[]; firstMon: string; nweeks: number; events: UEvent[];
  kpis: { bal30: number; bal60: number; bal90: number; minBal: number; minDay: number; runway: number | null; revenue: number; prod: number; supplier: number; burn: number; costTotal: number; netCash: number; flatBurn: number; maxBurn: number; denialTotal: number };
  totals: { primary: number; secondary: number; inflight: number; cost: number; rev: number };
  missingCombos: Array<{ payer: string; category: string; count: number; amount: number }>;
}

export function buildUnified(subs: SubRow[], claims: ClaimRow[], today: Date, a: UAssumptions = UDEFAULT): UResult {
  const winEnd = addDays(today, a.horizon);
  const inWin = (d: Date) => d >= today && d <= winEnd;
  type Ev = { day: number; dateISO: string; dos: string; kind: string; amt: number; patient: string; payer: string };
  const events: Ev[] = [];
  const add = (d: Date, kind: string, amt: number, patient: string, payer: string, dos: string) => { if (amt !== 0 && inWin(d)) events.push({ day: dayDiff(d, today), dateISO: iso(d), dos, kind, amt, patient, payer }); };

  const active = subs.filter((r) => !(r.group_title || "").toLowerCase().includes("not active"));
  // Pass 1: roster averages over rows WITH financials (used for growth + no-financials placeholders).
  let gN = 0, gCost = 0, gPrim = 0, gSec = 0;
  for (const r of active) {
    const rev = r.total_revenue || 0; if (rev <= 0) continue;
    const cost = r.total_gp !== 0 ? rev - r.total_gp : (r.total_cost || 0) + (r.shipping_cost || 0);
    const [prim, sec] = splitRevenue(r.primary_insurance, rev, r.oop_estimate || 0, r.coinsurance || 0, r.ded_remaining || 0);
    gN++; gCost += cost; gPrim += prim; gSec += sec;
  }
  const avgCost = gN ? gCost / gN : 0, avgPrim = gN ? gPrim / gN : 0, avgSec = gN ? gSec / gN : 0;
  // Pass 2: future orders. No order date → paused → exclude. >7d stale → exclude.
  // Rows missing financials → roster-average placeholder so nothing is missed.
  for (const r of active) {
    const base = pDate(r.next_order_date); if (!base) continue;
    if (dayDiff(base, today) < -a.staleDays) continue;
    const rev = r.total_revenue || 0, payer = r.primary_insurance, nm = r.patient_name || "", hasFin = rev > 0;
    let prim: number, sec: number, cost: number;
    if (hasFin) {
      cost = r.total_gp !== 0 ? rev - r.total_gp : (r.total_cost || 0) + (r.shipping_cost || 0);
      [prim, sec] = splitRevenue(payer, rev, r.oop_estimate || 0, r.coinsurance || 0, r.ded_remaining || 0);
    } else { prim = avgPrim; sec = avgSec; cost = avgCost; }
    const ods = [base];
    if (hasFin && isMedicaid(payer)) { let od = addDays(base, a.medicaidCycle); while (od <= winEnd) { ods.push(od); od = addDays(od, a.medicaidCycle); } }
    for (const od of ods) {
      const payP = (hasFin && isMedicaid(payer)) ? emedny(od) : addDays(od, a.primaryLag);
      const paySec = addDays(payP, a.secondaryLag);
      const rm = a.reorderRate, cr = a.collectionRate, od_iso = iso(od);
      add(payP, "cost", -cost * rm, nm, payer, od_iso);
      add(payP, "primary", prim * rm * cr, nm, payer, od_iso);
      add(paySec, "secondary", sec * rm * cr, nm, payer, od_iso);
    }
  }
  // Claims: include by PAYMENT STATE, not the status label, to avoid double-counting.
  //   already received (paid date ≤ today) → exclude (in our bank)
  //   known future EFT date           → include at that date (actual paid amt, else est, else $300)
  //   unpaid                          → include at est cash date (cascade), est_pay else $300 conservative
  //   denied / bad debt               → excluded from cash flow, totalled for display
  const DENIAL = new Set(["Denied (Or Partly)", "Bad Debt"]);
  let denialTotal = 0; const seenClaims = new Set<string>();
  // Payer × product actual-pay matrix: median of primary_paid (>0) for each
  // (payer, product-category) — what we KNOW we'll get paid for that insurer+product
  // (e.g. Fidelis pump = $4,000), per Brandon's rule.
  const matHist: Record<string, number[]> = {};
  for (const r of claims) { const p = r.primary_paid || 0; if (p > 0) (matHist[`${normPayer(r.primary_payor)}|${productCategory(r)}`] ??= []).push(p); }
  const payerProduct: Record<string, number> = {};
  for (const k in matHist) payerProduct[k] = median(matHist[k]);
  // Expected pay for a claim with NO recorded payment (Brandon's rule): what we actually
  // get paid for this payer×product → product-specific HCPCS conservative (only for
  // payer+product combos with no history, e.g. Magnacare/United pump) → $300. NEVER est_pay.
  // `track` records combos that fell back to conservative so we can flag them for review.
  const missing: Record<string, { payer: string; category: string; count: number; amount: number }> = {};
  const estimateUnpaid = (r: ClaimRow, track = false): number => {
    const cat = productCategory(r);
    const payer = normPayer(r.primary_payor);
    const key = `${payer}|${cat}`;
    if (payerProduct[key] !== undefined) return payerProduct[key];
    if (MANUAL_RATES[key] !== undefined) return MANUAL_RATES[key];
    const pc = productConservative(r);
    const amt = pc !== undefined ? pc : 300;
    if (track) { const m = (missing[key] ??= { payer, category: cat, count: 0, amount: 0 }); m.count++; m.amount += amt; }
    return amt;
  };
  for (const r of claims) {
    const st = (r.claim_status || "").trim();
    const sig = [r.claim_name, r.dos, r.claim_sent_date, r.est_pay, r.primary_paid, r.primary_paid_date, st].join("|");
    if (seenClaims.has(sig)) continue;   // drop exact-duplicate claim rows (same claim entered multiple times)
    seenClaims.add(sig);
    const paid = r.primary_paid || 0, cr = a.collectionRate;
    const nm = r.claim_name || "", payer = r.primary_payor;
    const dosD = pDate(r.dos), sentD = pDate(r.claim_sent_date), dosISO = dosD ? iso(dosD) : "";
    if (DENIAL.has(st)) { denialTotal += paid > 0 ? paid : estimateUnpaid(r); continue; }
    const ppd = pDate(r.primary_paid_date);
    if (ppd) {                                    // payment recorded → use paid amount + paid date (even if status=Review)
      if (ppd <= today) continue;                 // already in our bank → exclude
      add(ppd, "inflight", (paid > 0 ? paid : estimateUnpaid(r, true)) * cr, nm, payer, dosISO); // future EFT date
      continue;
    }
    if (st === "Paid") continue;                  // paid, no date recorded → already in bank
    if (!dosD && !sentD) continue;
    let cash: Date | null = null;
    if (dosD) { const d1 = addDays(dosD, a.dosLag); if (d1 >= today) cash = d1; }
    if (!cash && sentD) { const d2 = addDays(sentD, a.resentLag); if (d2 >= today) cash = d2; }
    if (!cash) cash = addDays(today, 7);
    add(cash, "inflight", estimateUnpaid(r, true) * cr, nm, payer, dosISO);   // unpaid → actual/conservative estimate
  }

  // Projected growth: N new patients each Monday (from today forward), at roster averages.
  if (a.newPatientsPerWeek > 0 && gN > 0) {
    const nP = a.newPatientsPerWeek, rm = a.reorderRate, cr = a.collectionRate;
    for (let m = addDays(today, -((today.getDay() + 6) % 7)); m <= winEnd; m = addDays(m, 7)) {
      if (m < today) continue;
      const payP = addDays(m, a.primaryLag), paySec = addDays(payP, a.secondaryLag), mi = iso(m);
      add(payP, "cost", -avgCost * nP * rm, `New patients (${nP})`, "Projected growth", mi);
      add(payP, "primary", avgPrim * nP * rm * cr, `New patients (${nP})`, "Projected growth", mi);
      add(paySec, "secondary", avgSec * nP * rm * cr, `New patients (${nP})`, "Projected growth", mi);
    }
  }

  const todOff = (today.getDay() + 6) % 7;
  const nweeks = Math.floor((a.horizon + todOff) / 7) + 1;
  const firstMon = addDays(today, -todOff);
  const wk = Array.from({ length: nweeks }, () => ({ primary: 0, secondary: 0, inflight: 0, cost: 0 }));
  const uevents: UEvent[] = [];
  for (const e of events) {
    const w = Math.floor((e.day + todOff) / 7);
    if (w >= 0 && w < nweeks) { if (e.kind === "cost") wk[w].cost += -e.amt; else (wk[w] as any)[e.kind] += e.amt; }
    uevents.push({ dateISO: e.dateISO, dos: e.dos, kind: e.kind, amount: e.amt, patient: e.patient, payer: e.payer, week: w });
  }
  const dailyBurn = a.monthlyFixedCost * 12 / 365;
  const dailySup = a.supplierOwed / a.supplierSpreadDays;
  const overlap = (ws: number, we: number, lo: number, hi: number) => Math.max(0, Math.min(we, hi) - Math.max(ws, lo) + 1);
  const weekly = []; let bal = a.startingCash;
  for (let w = 0; w < nweeks; w++) {
    const ws = 7 * w - todOff, we = ws + 6;
    const sup = overlap(ws, we, 1, a.supplierSpreadDays) * dailySup;
    const burn = overlap(ws, we, 1, a.horizon) * dailyBurn;
    const rev = wk[w].primary + wk[w].secondary + wk[w].inflight;
    const net = rev - wk[w].cost - sup - burn; bal += net;
    weekly.push({ wk: w + 1, mon: iso(addDays(firstMon, 7 * w)), ...wk[w], rev, supplier: sup, burn, net, balance: bal });
  }
  const dmap: Record<number, number> = {};
  for (const e of events) dmap[e.day] = (dmap[e.day] || 0) + e.amt;
  let cum = 0; const dbal: number[] = []; const dbal0: number[] = [];
  for (let i = 0; i <= a.horizon; i++) { cum += dmap[i] || 0; const sp = dailySup * Math.min(i, a.supplierSpreadDays); dbal.push(a.startingCash + cum - dailyBurn * i - sp); dbal0.push(a.startingCash + cum - sp); }
  const T = (key: string) => weekly.reduce((s, r) => s + (r as any)[key], 0);
  const revenue = T("rev"), prod = T("cost"), supT = T("supplier"), burnT = T("burn");
  const costTotal = prod + supT + burnT, netCash = revenue - costTotal;
  const k = 12 / 365;
  const flatBurn = (revenue - prod - supT) / (k * a.horizon);
  const maxBurn = dbal0[a.horizon] / (k * a.horizon); // monthly burn at which the DAY-90 (ending) balance = 0
  const minBal = Math.min(...dbal), minDay = dbal.indexOf(minBal);
  const rw = dbal.findIndex((b) => b < 0);
  const kpis = { bal30: dbal[30], bal60: dbal[60], bal90: dbal[90], minBal, minDay, runway: rw < 0 ? null : rw, revenue, prod, supplier: supT, burn: burnT, costTotal, netCash, flatBurn, maxBurn, denialTotal };
  const missingCombos = Object.values(missing).sort((a, b) => b.amount - a.amount);
  return { weekly, dbal, firstMon: iso(firstMon), nweeks, events: uevents, kpis, totals: { primary: T("primary"), secondary: T("secondary"), inflight: T("inflight"), cost: T("cost"), rev: revenue }, missingCombos };
}
