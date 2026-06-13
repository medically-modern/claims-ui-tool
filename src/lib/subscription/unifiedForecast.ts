/**
 * unifiedForecast.ts — single forecast engine shared by the dashboard.
 * Mirrors engine.py EXACTLY. In-flight from the Claims board; future orders
 * from the Subscription board (future-only, past-order rule, Medicaid eMedNY +
 * 60d recurrence); secondary +30; supplier spread; plugs.
 */
export interface SubRow {
  group_title: string; primary_insurance: string; next_order_date: string;
  total_revenue: number; total_gp: number; total_cost: number; shipping_cost: number;
  oop_estimate: number; coinsurance: number; ded_remaining: number;
}
export interface ClaimRow {
  claim_status: string; est_pay: number; dos: string; claim_sent_date: string;
  primary_payor: string;
}
export interface UAssumptions {
  primaryLag: number; secondaryLag: number; dosLag: number; resentLag: number;
  medicaidCycle: number; horizon: number; reorderRate: number; collectionRate: number;
  startingCash: number; supplierOwed: number; supplierSpreadDays: number;
  monthlyFixedCost: number; staleDays: number;
}
export const UDEFAULT: UAssumptions = {
  primaryLag: 26, secondaryLag: 30, dosLag: 26, resentLag: 25, medicaidCycle: 60,
  horizon: 90, reorderRate: 1, collectionRate: 1, startingCash: 210000,
  supplierOwed: 288000, supplierSpreadDays: 45, monthlyFixedCost: 30000, staleDays: 7,
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
function isMedicaid(p: string): boolean { return (p || "").trim() === "Medicaid"; }
function isMedicareAB(p: string): boolean { return /^medicare a&?b$/i.test((p || "").trim()); }
function emedny(od: Date): Date {
  const daysUntilWed = (3 - od.getDay() + 7) % 7;
  return addDays(od, daysUntilWed + 22);
}
function splitRevenue(payer: string, rev: number, oop: number, coins: number, ded: number): [number, number] {
  if (rev <= 0) return [0, 0];
  if (isMedicareAB(payer)) return [rev * 0.8, rev * 0.2];
  if (isMedicaid(payer)) return [rev, 0];
  if (oop > 0) { const sec = Math.min(oop, rev); return [rev - sec, sec]; }
  const cf = coins > 1 ? coins / 100 : coins;
  const pr = Math.min(cf * rev + ded, rev);
  if (pr > 0) return [rev - pr, pr];
  return [rev, 0];
}

export interface UResult {
  weekly: Array<{ wk: number; primary: number; secondary: number; inflight: number; rev: number; cost: number; supplier: number; burn: number; net: number; balance: number }>;
  dbal: number[];
  totals: { primary: number; secondary: number; inflight: number; cost: number; rev: number };
}

export function buildUnified(subs: SubRow[], claims: ClaimRow[], today: Date, a: UAssumptions = UDEFAULT): UResult {
  const winEnd = addDays(today, a.horizon);
  const inWin = (d: Date) => d >= today && d <= winEnd;
  type Ev = { day: number; kind: string; amt: number };
  const events: Ev[] = [];
  const add = (d: Date, kind: string, amt: number) => { if (amt !== 0 && inWin(d)) events.push({ day: dayDiff(d, today), kind, amt }); };

  for (const r of subs) {
    if ((r.group_title || "").toLowerCase().includes("not active")) continue;
    const rev = r.total_revenue || 0; if (rev <= 0) continue;
    const cost = r.total_gp !== 0 ? rev - r.total_gp : (r.total_cost || 0) + (r.shipping_cost || 0);
    const payer = r.primary_insurance;
    const [prim, sec] = splitRevenue(payer, rev, r.oop_estimate || 0, r.coinsurance || 0, r.ded_remaining || 0);
    const base = pDate(r.next_order_date); if (!base) continue;
    if (dayDiff(base, today) < -a.staleDays) continue; // >7d stale
    const ods = [base];
    if (isMedicaid(payer)) { let od = addDays(base, a.medicaidCycle); while (od <= winEnd) { ods.push(od); od = addDays(od, a.medicaidCycle); } }
    for (const od of ods) {
      const payP = isMedicaid(payer) ? emedny(od) : addDays(od, a.primaryLag);
      const paySec = addDays(payP, a.secondaryLag);
      const rm = a.reorderRate, cr = a.collectionRate;
      add(payP, "cost", -cost * rm);
      add(payP, "primary", prim * rm * cr);
      add(paySec, "secondary", sec * rm * cr);
    }
  }
  const INFLIGHT = new Set(["Outstanding", "Review", "Late", "Future Claim"]);
  for (const r of claims) {
    if (!INFLIGHT.has((r.claim_status || "").trim())) continue;
    const ep = r.est_pay || 0; if (ep <= 0) continue;
    const dos = pDate(r.dos), sent = pDate(r.claim_sent_date);
    if (!dos && !sent) continue;
    let cash: Date | null = null;
    if (dos) { const d1 = addDays(dos, a.dosLag); if (d1 >= today) cash = d1; }
    if (!cash && sent) { const d2 = addDays(sent, a.resentLag); if (d2 >= today) cash = d2; }
    if (!cash) cash = addDays(today, 7);
    add(cash, "inflight", ep * a.collectionRate);
  }

  const wk = Array.from({ length: 13 }, () => ({ primary: 0, secondary: 0, inflight: 0, cost: 0 }));
  for (const e of events) { const w = Math.floor(e.day / 7); if (w >= 0 && w < 13) { if (e.kind === "cost") wk[w].cost += -e.amt; else (wk[w] as any)[e.kind] += e.amt; } }
  const dailyBurn = a.monthlyFixedCost * 12 / 365;
  const dailySup = a.supplierOwed / a.supplierSpreadDays;
  const overlap = (ws: number, we: number, lo: number, hi: number) => Math.max(0, Math.min(we, hi) - Math.max(ws, lo) + 1);
  const weekly = []; let bal = a.startingCash;
  for (let w = 0; w < 13; w++) {
    const ws = 7 * w, we = ws + 6;
    const sup = overlap(ws, we, 1, a.supplierSpreadDays) * dailySup;
    const burn = overlap(ws, we, 1, a.horizon) * dailyBurn;
    const rev = wk[w].primary + wk[w].secondary + wk[w].inflight;
    const net = rev - wk[w].cost - sup - burn; bal += net;
    weekly.push({ wk: w + 1, ...wk[w], rev, supplier: sup, burn, net, balance: bal });
  }
  const dmap: Record<number, number> = {};
  for (const e of events) dmap[e.day] = (dmap[e.day] || 0) + e.amt;
  let cum = 0; const dbal: number[] = [];
  for (let i = 0; i <= a.horizon; i++) { cum += dmap[i] || 0; dbal.push(a.startingCash + cum - dailyBurn * i - dailySup * Math.min(i, a.supplierSpreadDays)); }
  const T = (k: string) => weekly.reduce((s, r) => s + (r as any)[k], 0);
  return { weekly, dbal, totals: { primary: T("primary"), secondary: T("secondary"), inflight: T("inflight"), cost: T("cost"), rev: T("rev") } };
}
