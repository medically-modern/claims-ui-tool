/**
 * Forecast.tsx — Cash Flow Forecast (route: /forecast).
 * Renders the UNIFIED engine (lib/subscription/unifiedForecast) which ties
 * exactly to the Google Sheet model: in-flight from the Claims board, future
 * orders from the Subscription board (future-only + Medicaid recurrence),
 * eMedNY timing, secondary +30, supplier spread, plugs.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowLeft, RefreshCw, Wallet, CalendarClock, AlertTriangle, TrendingUp } from "lucide-react";

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
    if (Math.abs(n) >= 1_000_000) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e3).toFixed(1)}K`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
const pnum = (s: unknown) => { const x = parseFloat(String(s ?? "").replace(/[$,]/g, "")); return isFinite(x) ? x : 0; };

function Money({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] font-medium">{label}</Label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
        <Input type="number" className="pl-5 tabular-nums h-9" value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)} />
      </div>
    </div>
  );
}
function NumIn({ label, value, onChange, suffix }: { label: string; value: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] font-medium">{label}</Label>
      <div className="relative">
        <Input type="number" className="pr-7 tabular-nums h-9" value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)} />
        {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
function Tile({ label, value, sub, tone = "neutral", icon }: { label: string; value: string; sub?: string; tone?: string; icon?: React.ReactNode }) {
  const dot: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700", danger: "bg-rose-100 text-rose-700",
    info: "bg-sky-100 text-sky-700", neutral: "bg-slate-100 text-slate-700",
  };
  return (
    <Card className="p-5">
      <div className={cn("grid h-9 w-9 place-items-center rounded-lg", dot[tone] ?? dot.neutral)}>{icon ?? <Wallet className="h-4 w-4" />}</div>
      <div className="mt-3 text-[26px] font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-[13px] font-medium mt-1">{label}</div>
      {sub && <div className="text-[12px] text-muted-foreground mt-0.5 tabular-nums">{sub}</div>}
    </Card>
  );
}
function ChartTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload ?? {};
  const row = (l: string, v: number, c: string) => (
    <div className="flex items-center justify-between gap-6 text-[12px]"><span style={{ color: c }}>{l}</span><span className="tabular-nums font-medium" style={{ color: c }}>{fmt(v)}</span></div>
  );
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-md">
      <div className="text-[13px] font-semibold mb-1">{d.label}</div>
      {row("Primary in", d.Primary ?? 0, "#0EA5E9")}
      {row("Secondary in", d.Secondary ?? 0, "#10B981")}
      {row("In-flight claims", d["In-flight"] ?? 0, "#6366F1")}
      {row("Product cost", d.Cost ?? 0, "#F87171")}
      {row("Supplier draw", d.Supplier ?? 0, "#a78bfa")}
      {row("Fixed burn", d.Burn ?? 0, "#fbbf24")}
      <div className="mt-1 border-t pt-1">{row("Net cash flow", d.Net ?? 0, (d.Net ?? 0) >= 0 ? "#059669" : "#dc2626")}</div>
      {row("Bank balance (end)", d.Balance ?? 0, "#0f172a")}
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

  const subs: SubRow[] = useMemo(() => (subData ?? []).map((p: any) => ({
    group_title: p.isNotActive ? "Not Active Patients" : "Subscriptions",
    primary_insurance: p.primaryPayer || "",
    next_order_date: p.nextOrderDate || "",
    total_revenue: p.financials?.totalRevenue ?? 0,
    total_gp: p.financials?.totalGP ?? 0,
    total_cost: p.financials?.totalCost ?? 0,
    shipping_cost: p.financials?.shippingCost ?? 0,
    oop_estimate: pnum(p.oopEstimate),
    coinsurance: pnum(p.coinsurancePct),
    ded_remaining: pnum(p.dedRemaining),
  })), [subData]);
  const claims: ClaimRow[] = claimsQ.data ?? [];

  const today = useMemo(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }, []);
  const res = useMemo(() => buildUnified(subs, claims, today, {
    ...UDEFAULT, startingCash, supplierOwed, monthlyFixedCost, supplierSpreadDays,
    reorderRate: reorderPct / 100, collectionRate: collectionPct / 100,
  }), [subs, claims, today, startingCash, supplierOwed, monthlyFixedCost, supplierSpreadDays, reorderPct, collectionPct]);

  const chartData = res.weekly.map((w) => ({
    label: `Wk ${w.wk}`, Primary: Math.round(w.primary), Secondary: Math.round(w.secondary),
    "In-flight": Math.round(w.inflight), Cost: -Math.round(w.cost), Supplier: -Math.round(w.supplier),
    Burn: -Math.round(w.burn), Net: Math.round(w.net), Balance: Math.round(w.balance),
  }));
  const dbal = res.dbal, t = res.totals;
  const minBal = Math.min(...dbal), minDay = dbal.indexOf(minBal);
  const runway = dbal.findIndex((b) => b < 0);
  const gm = t.primary + t.secondary - t.cost;
  const updated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

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
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { refetch(); claimsQ.refetch(); }} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Money label="Cash in bank" value={startingCash} onChange={setStartingCash} />
            <Money label="Owed to supplier" value={supplierOwed} onChange={setSupplierOwed} />
            <Money label="Fixed costs / month" value={monthlyFixedCost} onChange={setMonthlyFixedCost} />
            <NumIn label="Supplier payoff" value={supplierSpreadDays} onChange={setSupplierSpreadDays} suffix="d" />
            <NumIn label="Reorder rate" value={reorderPct} onChange={setReorderPct} suffix="%" />
            <NumIn label="Collection rate" value={collectionPct} onChange={setCollectionPct} suffix="%" />
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Tile tone={dbal[90] >= 0 ? "success" : "danger"} label="Balance @ 90 days" value={fmt(dbal[90], true)} sub={`opens ${fmt(startingCash, true)}`} />
          <Tile tone="info" icon={<CalendarClock className="h-4 w-4" />} label="Balance @ 30 / 60" value={fmt(dbal[30], true)} sub={`60d: ${fmt(dbal[60], true)}`} />
          <Tile tone={runway < 0 ? "success" : "danger"} icon={<AlertTriangle className="h-4 w-4" />} label="Runway" value={runway < 0 ? "90+ days" : `${runway} days`} sub={`min ${fmt(minBal, true)} @ day ${minDay}`} />
          <Tile tone="neutral" icon={<TrendingUp className="h-4 w-4" />} label="Revenue in (90d)" value={fmt(t.rev, true)} sub={`primary ${fmt(t.primary, true)} · sec ${fmt(t.secondary, true)}`} />
          <Tile tone="neutral" label="In-flight claims" value={fmt(t.inflight, true)} sub="open claims collected" />
          <Tile tone="neutral" icon={<TrendingUp className="h-4 w-4" />} label="Subscription GM" value={fmt(gm, true)} sub={`${(100 * gm / Math.max(t.primary + t.secondary, 1)).toFixed(1)}% of sub rev`} />
        </div>

        <Card className="p-6">
          <h3 className="text-[16px] font-semibold mb-3">Projected cash &amp; bank balance (weekly)</h3>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
              <YAxis yAxisId="c" stroke="#64748b" fontSize={12} tickFormatter={(v) => fmt(v, true)} />
              <YAxis yAxisId="b" orientation="right" stroke="#0f172a" fontSize={12} tickFormatter={(v) => fmt(v, true)} />
              <Tooltip content={<ChartTip />} />
              <Legend />
              <ReferenceLine yAxisId="b" y={0} stroke="#ef4444" strokeDasharray="4 4" />
              <Bar yAxisId="c" dataKey="Primary" stackId="a" fill="#0EA5E9" />
              <Bar yAxisId="c" dataKey="Secondary" stackId="a" fill="#10B981" />
              <Bar yAxisId="c" dataKey="In-flight" stackId="a" fill="#6366F1" />
              <Bar yAxisId="c" dataKey="Cost" stackId="a" fill="#F87171" />
              <Bar yAxisId="c" dataKey="Supplier" stackId="a" fill="#a78bfa" />
              <Bar yAxisId="c" dataKey="Burn" stackId="a" fill="#fbbf24" />
              <Line yAxisId="b" type="monotone" dataKey="Balance" stroke="#0f172a" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6 overflow-x-auto">
          <h3 className="text-[16px] font-semibold mb-3">Weekly trace (mirrors the sheet)</h3>
          <table className="w-full text-[12px] tabular-nums">
            <thead><tr className="text-left text-muted-foreground border-b">
              <th className="py-1 pr-3">Week</th><th className="text-right px-2">Primary</th><th className="text-right px-2">Secondary</th><th className="text-right px-2">In-flight</th><th className="text-right px-2">Product cost</th><th className="text-right px-2">Supplier</th><th className="text-right px-2">Burn</th><th className="text-right px-2">Net</th><th className="text-right pl-2">Balance</th>
            </tr></thead>
            <tbody>
              {res.weekly.map((w) => (
                <tr key={w.wk} className="border-b last:border-0">
                  <td className="py-1 pr-3">{w.wk}</td>
                  <td className="text-right px-2">{fmt(w.primary)}</td>
                  <td className="text-right px-2">{fmt(w.secondary)}</td>
                  <td className="text-right px-2">{fmt(w.inflight)}</td>
                  <td className="text-right px-2 text-rose-600">{fmt(w.cost)}</td>
                  <td className="text-right px-2 text-violet-600">{fmt(w.supplier)}</td>
                  <td className="text-right px-2 text-amber-600">{fmt(w.burn)}</td>
                  <td className={cn("text-right px-2 font-medium", w.net < 0 ? "text-rose-600" : "text-emerald-700")}>{fmt(w.net)}</td>
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
