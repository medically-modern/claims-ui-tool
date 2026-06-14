/**
 * Forecast.tsx — Cash Flow Forecast (route: /forecast + Claims financials tab).
 * Renders the UNIFIED engine (lib/subscription/unifiedForecast) which ties
 * exactly to the cash_flow_model Google Sheet. Mon–Sun weeks.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
} from "recharts";
import { ArrowLeft, RefreshCw, Wallet, CalendarClock, AlertTriangle, TrendingUp, X, ExternalLink, ChevronRight } from "lucide-react";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/1Cn8GAAlMPB8Bc25Xc8CYKmT45a427tSZ0Ykseg7eEbA/edit";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { hasMondayToken } from "@/api/monday";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import { fetchForecastClaims } from "@/api/queries/claimsForecast";
import { buildUnified, UDEFAULT, type SubRow, type ClaimRow } from "@/lib/subscription/unifiedForecast";

function fmt(n: number, abbr = false): string {
  if (abbr) {
    if (Math.abs(n) >= 1e6) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e3).toFixed(1)}K`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
const pnum = (s: unknown) => { const x = parseFloat(String(s ?? "").replace(/[$,]/g, "")); return isFinite(x) ? x : 0; };
const mLabel = (isoStr: string) => { const p = isoStr.split("-"); return `${+p[1]}/${+p[2]}`; };

function MoneyIn({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] font-medium">{label}</Label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
        <Input type="number" className="pl-5 tabular-nums h-9" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      </div>
    </div>
  );
}
function NumIn({ label, value, onChange, suffix }: { label: string; value: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] font-medium">{label}</Label>
      <div className="relative">
        <Input type="number" className="pr-7 tabular-nums h-9" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value) || 0)} />
        {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
function StatBox({ title, rows, tone = "neutral", icon }: { title: string; rows: Array<{ label: string; value: string; color?: string }>; tone?: string; icon?: React.ReactNode }) {
  const dot: Record<string, string> = { success: "bg-emerald-100 text-emerald-700", danger: "bg-rose-100 text-rose-700", info: "bg-sky-100 text-sky-700", neutral: "bg-slate-100 text-slate-700" };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg", dot[tone] ?? dot.neutral)}>{icon ?? <Wallet className="h-5 w-5" />}</div>
        <div className="text-[18px] font-medium text-muted-foreground">{title}</div>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span className="text-[18px] text-muted-foreground">{r.label}</span>
            <span className="text-[18px] font-semibold tabular-nums" style={r.color ? { color: r.color } : undefined}>{r.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[22px] font-semibold tabular-nums">{value}</div>
      <div className="text-[15px] text-muted-foreground">{label}</div>
      {sub && <div className="text-[13px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}
function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload ?? {};
  const rev = (d.Primary ?? 0) + (d.Secondary ?? 0) + (d["In-flight"] ?? 0);
  const prod = -(d.Cost ?? 0);
  const gm = rev - prod;
  const gmP = rev ? Math.round((gm / rev) * 100) : 0;
  const pmP = rev ? Math.round(((d.Net ?? 0) / rev) * 100) : 0;
  const row = (l: string, v: number, c: string) => (
    <div className="flex items-center justify-between gap-6 text-[14px]"><span style={{ color: c }}>{l}</span><span className="tabular-nums font-medium" style={{ color: c }}>{fmt(v)}</span></div>
  );
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-md">
      <div className="text-[15px] font-semibold mb-1">Week of {d.label}</div>
      {row("Primary in", d.Primary ?? 0, "#006383")}
      {row("Secondary in", d.Secondary ?? 0, "#80ADAA")}
      {row("In-flight claims", d["In-flight"] ?? 0, "#4C9A93")}
      {row("Product cost", d.Cost ?? 0, "#CC3366")}
      {row("Supplier draw", d.Supplier ?? 0, "#066FAC")}
      {row("Fixed burn", d.Burn ?? 0, "#98A2B3")}
      <div className="mt-1 border-t pt-1">{row("Net cash flow", d.Net ?? 0, (d.Net ?? 0) >= 0 ? "#006383" : "#CC3366")}</div>
      {row("Bank balance (end)", d.Balance ?? 0, "#093E52")}
      <div className="mt-1 border-t pt-1 text-[14px]">
        <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Gross margin</span><span className="tabular-nums font-medium">{fmt(gm)} · {gmP}%</span></div>
        <div className="flex items-center justify-between gap-6"><span className="text-muted-foreground">Profit margin</span><span className="tabular-nums font-medium">{rev && pmP >= 0 ? `${pmP}%` : "n/a"}</span></div>
      </div>
    </div>
  );
}

export function ForecastDashboard({ embedded = false }: { embedded?: boolean }) {
  const { data: subData, isFetching, refetch, dataUpdatedAt } = useSubscriptionPatients();
  const claimsQ = useQuery<ClaimRow[]>({ queryKey: ["forecast", "claims"], queryFn: fetchForecastClaims, enabled: hasMondayToken(), staleTime: 90_000, gcTime: 24 * 3600_000 });

  const [startingCash, setStartingCash] = useState(210000);
  const [supplierOwed, setSupplierOwed] = useState(288000);
  const [monthlyFixedCost, setMonthlyFixedCost] = useState(30000);
  const [supplierSpreadDays, setSupplierSpreadDays] = useState(45);
  const [reorderPct, setReorderPct] = useState(100);
  const [collectionPct, setCollectionPct] = useState(100);
  const [newPerWeek, setNewPerWeek] = useState(0);
  const [drill, setDrill] = useState<number | null>(null);
  const [mixOpen, setMixOpen] = useState<string | null>(null);
  const [combosOpen, setCombosOpen] = useState(false);

  const subs: SubRow[] = useMemo(() => (subData ?? []).map((p: any) => ({
    group_title: p.isNotActive ? "Not Active Patients" : "Subscriptions",
    primary_insurance: p.primaryPayer || "", next_order_date: p.nextOrderDate || "", patient_name: p.name || "",
    total_revenue: p.financials?.totalRevenue ?? 0, total_gp: p.financials?.totalGP ?? 0,
    total_cost: p.financials?.totalCost ?? 0, shipping_cost: p.financials?.shippingCost ?? 0,
    oop_estimate: pnum(p.oopEstimate), coinsurance: pnum(p.coinsurancePct), ded_remaining: pnum(p.dedRemaining),
  })), [subData]);
  const claims: ClaimRow[] = claimsQ.data ?? [];

  const today = useMemo(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }, []);
  const res = useMemo(() => buildUnified(subs, claims, today, {
    ...UDEFAULT, startingCash, supplierOwed, monthlyFixedCost, supplierSpreadDays,
    reorderRate: reorderPct / 100, collectionRate: collectionPct / 100, newPatientsPerWeek: newPerWeek,
  }), [subs, claims, today, startingCash, supplierOwed, monthlyFixedCost, supplierSpreadDays, reorderPct, collectionPct, newPerWeek]);

  const fin = useMemo(() => {
    const rows = (subData ?? []).filter((p: any) => !p.isNotActive && (p.financials?.totalRevenue ?? 0) > 0);
    const orders = rows.length;
    const N = new Set(rows.map((p: any) => (p.name || "").trim().toLowerCase())).size; // distinct patients
    const sum = (f: (p: any) => number) => rows.reduce((s, p) => s + f(p), 0);
    const rev = sum((p) => p.financials?.totalRevenue ?? 0);
    const gp = sum((p) => p.financials?.totalGP ?? 0);
    const arr = sum((p) => p.financials?.arr ?? 0);
    const arp = sum((p) => p.financials?.arp ?? 0);
    const annualBurn = monthlyFixedCost * 12;
    return {
      N, arr, arp,
      avgRev: orders ? rev / orders : 0, avgCost: orders ? (rev - gp) / orders : 0, avgGP: orders ? gp / orders : 0,
      gmPct: rev ? (gp / rev) * 100 : 0,
      netProfit: arp - annualBurn,
      pmPct: arr ? ((arp - annualBurn) / arr) * 100 : 0,
    };
  }, [subData, monthlyFixedCost]);

  // Subscriptions split by product. A patient row that covers BOTH sensors and supplies
  // is counted as TWO subscriptions (one each). Patients already on two separate rows stay
  // as-is. ARR/ARP are prorated from the row totals using each product's own rev/GP share.
  const mix = useMemo(() => {
    const rows = (subData ?? []).filter((p: any) => !p.isNotActive && (p.financials?.totalRevenue ?? 0) > 0);
    const blank = () => ({ subs: 0, rev: 0, gp: 0, arr: 0, arp: 0, list: [] as any[] });
    const m: any = { sensors: blank(), supplies: blank() };
    for (const p of rows) {
      const f = p.financials || {};
      const tRev = f.totalRevenue || 0, tGp = f.totalGP || 0;
      const multR = tRev ? (f.arr || 0) / tRev : 0;            // orders/yr (revenue basis)
      const multP = tGp ? (f.arp || 0) / tGp : multR;          // profit annualization
      const addLine = (key: string, rev: number, gp: number) => {
        if (rev <= 0) return;
        const b = m[key]; const lineArr = rev * multR, lineArp = gp * multP;
        b.subs++; b.rev += rev; b.gp += gp; b.arr += lineArr; b.arp += lineArp;
        b.list.push({ name: p.name || "—", payer: p.primaryPayer || "—", rev, gp, arr: lineArr, gm: rev ? (gp / rev) * 100 : 0 });
      };
      addLine("sensors", f.sensorsRevenue || 0, f.sensorsGP || 0);
      addLine("supplies", f.suppliesRevenue || 0, f.suppliesGP || 0);
    }
    for (const k of ["sensors", "supplies"]) {
      const b = m[k];
      b.avgRev = b.subs ? b.rev / b.subs : 0; b.avgCost = b.subs ? (b.rev - b.gp) / b.subs : 0; b.avgGP = b.subs ? b.gp / b.subs : 0;
      b.gmPct = b.rev ? (b.gp / b.rev) * 100 : 0;
      b.list.sort((a: any, c: any) => c.rev - a.rev);
    }
    return m;
  }, [subData]);

  const chartData = res.weekly.map((w) => ({
    label: mLabel(w.mon), Primary: Math.round(w.primary), Secondary: Math.round(w.secondary),
    "In-flight": Math.round(w.inflight), Cost: -Math.round(w.cost), Supplier: -Math.round(w.supplier),
    Burn: -Math.round(w.burn), Net: Math.round(w.net), Balance: Math.round(w.balance),
  }));
  const k = res.kpis;
  const updated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  // net-cash-flow labels: green above the up-stack when ≥0, red below the down-stack when <0
  const NetTop = (p: any) => {
    const v = chartData[p.index]?.Net ?? 0; if (v < 0) return null;
    return <text x={p.x + p.width / 2} y={p.y - 8} textAnchor="middle" fontSize={14} fontWeight={700} fill="#006383">{fmt(v, true)}</text>;
  };
  const NetBottom = (p: any) => {
    const v = chartData[p.index]?.Net ?? 0; if (v >= 0) return null;
    return <text x={p.x + p.width / 2} y={p.y + 16} textAnchor="middle" fontSize={14} fontWeight={700} fill="#CC3366">{fmt(v, true)}</text>;
  };

  return (
    <div className={embedded ? "" : "min-h-screen bg-muted/20"}>
      <div className={embedded ? "space-y-4" : "mx-auto max-w-[1400px] px-6 py-6 space-y-4"}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {!embedded && <Link to="/claims"><Button variant="ghost" size="sm" className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button></Link>}
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Cash Flow Forecast</h1>
              <p className="text-[13px] text-muted-foreground">Next 90 days · ties to the cash_flow_model sheet · {claims.length} claims · {subs.filter((s) => s.group_title === "Subscriptions").length} active patients</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Updated {updated}</span>
            <a href={SHEET_URL} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5"><ExternalLink className="h-4 w-4" /> Open Sheet</Button>
            </a>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { refetch(); claimsQ.refetch(); }} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>

        <Card className="p-5">
          <div className="text-[18px] font-semibold mb-3">Key financials</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Active patients" value={fin.N.toLocaleString()} />
            <Metric label="ARR (annual recurring rev)" value={fmt(fin.arr, true)} sub={`avg order rev ${fmt(fin.avgRev)}`} />
            <Metric label="ARP (annual recurring profit)" value={fmt(fin.arp, true)} sub={`avg order cost ${fmt(fin.avgCost)}`} />
            <Metric label="Gross margin" value={`${fin.gmPct.toFixed(1)}%`} sub={`avg GP/order ${fmt(fin.avgGP)}`} />
            <Metric label="Profit margin (after fixed)" value={`${fin.pmPct.toFixed(1)}%`} sub={`net ${fmt(fin.netProfit, true)}/yr`} />
            <Metric label="Denials (not in forecast)" value={fmt(res.kpis.denialTotal, true)} sub="potential if overturned" />
          </div>

          {/* Collapsed by default: break Key Financials into sensors-only vs supplies-only
              (a single patient row covering both products counts as 2 subscriptions). */}
          <div className="mt-4 border-t pt-3">
            <button onClick={() => setMixOpen(mixOpen ? null : "open")}
              className="flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight className={cn("h-4 w-4 transition-transform", mixOpen && "rotate-90")} />
              Break down by subscription · sensors vs supplies
            </button>
            {mixOpen && (["sensors", "supplies"] as const).map((key) => {
              const b = mix[key];
              return (
                <div key={key} className="mt-4">
                  <div className="text-[15px] font-semibold capitalize mb-2">{key} <span className="text-[13px] font-normal text-muted-foreground">· {b.subs.toLocaleString()} subscriptions</span></div>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
                    <Metric label="Subscriptions" value={b.subs.toLocaleString()} />
                    <Metric label="ARR (annual recurring rev)" value={fmt(b.arr, true)} sub={`avg order rev ${fmt(b.avgRev)}`} />
                    <Metric label="ARP (annual recurring profit)" value={fmt(b.arp, true)} sub={`avg order cost ${fmt(b.avgCost)}`} />
                    <Metric label="Gross margin" value={`${b.gmPct.toFixed(1)}%`} sub={`avg GP/order ${fmt(b.avgGP)}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {res.missingCombos.length > 0 && (
          <Card className="p-4 border-amber-300 bg-amber-50/60">
            <button onClick={() => setCombosOpen((o) => !o)} className="flex items-center gap-2 w-full text-left">
              <ChevronRight className={cn("h-4 w-4 text-amber-600 transition-transform", combosOpen && "rotate-90")} />
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-[15px] font-semibold">Payer × product combos needing a real estimate</span>
              <span className="text-[13px] text-muted-foreground">— {res.missingCombos.length} combos on conservative fallback. Revisit once a few get paid.</span>
            </button>
            {combosOpen && (
              <div className="overflow-x-auto mt-3">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-muted-foreground text-left border-b">
                    <th className="py-1 pr-4 font-medium">Payer</th><th className="py-1 pr-4 font-medium">Product</th>
                    <th className="py-1 pr-4 font-medium text-right">Claims</th><th className="py-1 pr-4 font-medium text-right">Conservative $ in forecast</th>
                  </tr></thead>
                  <tbody>
                    {res.missingCombos.map((c, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="py-1 pr-4">{c.payer}</td>
                        <td className="py-1 pr-4 capitalize">{c.category}</td>
                        <td className="py-1 pr-4 text-right tabular-nums">{c.count}</td>
                        <td className="py-1 pr-4 text-right tabular-nums">{fmt(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <MoneyIn label="Cash in bank" value={startingCash} onChange={setStartingCash} />
            <MoneyIn label="Owed to supplier" value={supplierOwed} onChange={setSupplierOwed} />
            <MoneyIn label="Fixed costs / month" value={monthlyFixedCost} onChange={setMonthlyFixedCost} />
            <NumIn label="Supplier payoff" value={supplierSpreadDays} onChange={setSupplierSpreadDays} suffix="d" />
            <NumIn label="Reorder rate" value={reorderPct} onChange={setReorderPct} suffix="%" />
            <NumIn label="Collection rate" value={collectionPct} onChange={setCollectionPct} suffix="%" />
            <NumIn label="New patients / wk" value={newPerWeek} onChange={setNewPerWeek} suffix="+" />
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatBox title="Projected bank balance" tone={k.bal90 >= 0 ? "success" : "danger"} icon={<Wallet className="h-4 w-4" />}
            rows={[{ label: "30 days", value: fmt(k.bal30, true) }, { label: "60 days", value: fmt(k.bal60, true) }, { label: "90 days", value: fmt(k.bal90, true) }]} />
          <StatBox title="Runway" tone={k.runway === null ? "success" : "danger"} icon={<AlertTriangle className="h-4 w-4" />}
            rows={[{ label: "Runway", value: k.runway === null ? "90+ days" : `${k.runway} days` }, { label: `Min balance (day ${k.minDay})`, value: fmt(k.minBal, true) }]} />
          <StatBox title="Net operating cash (90d)" tone={k.netCash >= 0 ? "success" : "danger"} icon={<TrendingUp className="h-4 w-4" />}
            rows={[{ label: "Revenue in", value: fmt(k.revenue, true), color: "#006383" }, { label: "Cash out", value: fmt(k.costTotal, true), color: "#CC3366" }, { label: "Net", value: fmt(k.netCash, true) }]} />
          <StatBox title="Fixed-cost capacity / mo" tone="info" icon={<CalendarClock className="h-4 w-4" />}
            rows={[{ label: "Flat balance (end = start)", value: fmt(k.flatBurn, true) }, { label: "Max before $0", value: fmt(k.maxBurn, true) }]} />
        </div>

        <Card className="p-6">
          <h3 className="text-[20px] font-semibold">Projected cash &amp; bank balance</h3>
          <p className="text-[15px] text-muted-foreground mt-1">Each bar covers Mon–Sun; the label is that Monday. Click a bar to drill in. Number on each bar = that week's net cash flow.</p>
          <div className="flex items-center gap-2 text-[14px] mt-1 mb-1">
            <span className="text-muted-foreground">Bars (left axis) = weekly cash in/out</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium" style={{ color: "#093E52" }}>Line (right axis) = projected bank balance</span>
          </div>
          <ResponsiveContainer width="100%" height={460}>
            <ComposedChart data={chartData} stackOffset="sign" margin={{ top: 32, right: 24, bottom: 8, left: 8 }}
              onClick={(e: any) => { const i = e?.activeTooltipIndex; if (typeof i === "number") setDrill(i); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={14} />
              <YAxis yAxisId="c" stroke="#64748b" fontSize={14} tickFormatter={(v) => fmt(v, true)} />
              <YAxis yAxisId="b" orientation="right" stroke="#093E52" fontSize={14} tickFormatter={(v) => fmt(v, true)} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 14 }} />
              <ReferenceLine yAxisId="b" y={0} stroke="#ef4444" strokeDasharray="4 4" />
              <Bar yAxisId="c" dataKey="Primary" stackId="a" fill="#006383" />
              <Bar yAxisId="c" dataKey="Secondary" stackId="a" fill="#80ADAA" />
              <Bar yAxisId="c" dataKey="In-flight" stackId="a" fill="#4C9A93"><LabelList position="top" content={NetTop} /></Bar>
              <Bar yAxisId="c" dataKey="Cost" stackId="a" fill="#CC3366" />
              <Bar yAxisId="c" dataKey="Supplier" stackId="a" fill="#066FAC" />
              <Bar yAxisId="c" dataKey="Burn" stackId="a" fill="#98A2B3"><LabelList position="bottom" content={NetBottom} /></Bar>
              <Line yAxisId="b" type="monotone" dataKey="Balance" stroke="#093E52" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        {drill !== null && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[16px] font-semibold">Week of {chartData[drill]?.label} — cash events <span className="text-[12px] font-normal text-muted-foreground">(net {fmt(res.weekly[drill]?.net ?? 0)})</span></h3>
              <Button variant="ghost" size="sm" onClick={() => setDrill(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead className="sticky top-0 bg-white"><tr className="text-left text-muted-foreground border-b">
                  <th className="py-1 pr-3">Est. cashflow date</th><th className="pr-3">DOS</th><th className="pr-3">Kind</th><th className="pr-3">Patient / claim</th><th className="pr-3">Payer</th><th className="text-right">Amount</th>
                </tr></thead>
                <tbody>
                  {res.events.filter((e) => e.week === drill).sort((a, b) => a.dateISO.localeCompare(b.dateISO) || Math.abs(b.amount) - Math.abs(a.amount)).map((e, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-3">{e.dateISO}</td>
                      <td className="pr-3">{e.dos || "—"}</td>
                      <td className="pr-3 capitalize">{e.kind}</td>
                      <td className="pr-3">{e.patient}</td>
                      <td className="pr-3">{e.payer}</td>
                      <td className="text-right font-medium" style={{ color: e.amount < 0 ? "#CC3366" : "#006383" }}>{fmt(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="p-6 overflow-x-auto">
          <h3 className="text-[16px] font-semibold mb-3">Weekly trace (mirrors the sheet)</h3>
          <table className="w-full text-[12px] tabular-nums">
            <thead><tr className="text-left text-muted-foreground border-b">
              <th className="py-1 pr-3">Week of</th><th className="text-right px-2">Primary</th><th className="text-right px-2">Secondary</th><th className="text-right px-2">In-flight</th><th className="text-right px-2">Product cost</th><th className="text-right px-2">Supplier</th><th className="text-right px-2">Burn</th><th className="text-right px-2">Net</th><th className="text-right pl-2">Balance</th>
            </tr></thead>
            <tbody>
              {res.weekly.map((w) => (
                <tr key={w.wk} className="border-b last:border-0">
                  <td className="py-1 pr-3">{mLabel(w.mon)}</td>
                  <td className="text-right px-2">{fmt(w.primary)}</td>
                  <td className="text-right px-2">{fmt(w.secondary)}</td>
                  <td className="text-right px-2">{fmt(w.inflight)}</td>
                  <td className="text-right px-2" style={{ color: "#CC3366" }}>{fmt(w.cost)}</td>
                  <td className="text-right px-2" style={{ color: "#066FAC" }}>{fmt(w.supplier)}</td>
                  <td className="text-right px-2" style={{ color: "#98A2B3" }}>{fmt(w.burn)}</td>
                  <td className="text-right px-2 font-medium" style={{ color: w.net < 0 ? "#CC3366" : "#006383" }}>{fmt(w.net)}</td>
                  <td className="text-right pl-2 font-semibold">{fmt(w.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

export default function Forecast() {
  return <ForecastDashboard />;
}
