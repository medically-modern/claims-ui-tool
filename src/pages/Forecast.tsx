/**
 * Forecast.tsx — Cash Flow Forecast dashboard (route: /forecast).
 *
 * A forward-looking treasury view built from the Subscription Board. Answers:
 *   • How much operating cash will I have over the next 90 days?
 *   • What's my projected bank balance at 30 / 60 / 90 days?
 *   • Can I absorb a fixed-cost increase / afford to hire? (runway + headroom)
 *
 * All math lives in lib/subscription/forecast.ts (pure + unit-tested). This file
 * is presentation only. Built brand-new alongside the Claims Cash Flow tab —
 * it does not touch that surface.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Wallet, CalendarClock,
  PiggyBank, AlertTriangle, Download,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import { useAllClaims } from "@/hooks/useAllClaims";
import { useAllSecondaryClaims } from "@/hooks/useAllSecondaryClaims";
import { computeCashFlow } from "@/lib/claims/cashflow";
import {
  buildForecast, forecastPatientFromLive, parseLocalDate, ymd, addDays,
  type CashEvent, type ForecastResult, type PipelineClaim,
} from "@/lib/subscription/forecast";

// ─── Formatting ───────────────────────────────────────────────────────────────
function fmtMoney(n: number, abbr = false): string {
  if (abbr) {
    if (Math.abs(n) >= 1_000_000) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function clampPct(n: number): number { return Math.min(100, Math.max(0, n)); }

// ─── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, tone = "neutral", icon,
}: {
  label: string; value: string; sub?: string;
  tone?: "neutral" | "success" | "danger" | "info" | "warn";
  icon?: React.ReactNode;
}) {
  const dot = {
    success: "bg-emerald-100 text-emerald-700",
    danger: "bg-rose-100 text-rose-700",
    info: "bg-sky-100 text-sky-700",
    warn: "bg-amber-100 text-amber-700",
    neutral: "bg-slate-100 text-slate-700",
  }[tone];
  return (
    <Card className="p-5">
      <div className={cn("grid h-9 w-9 place-items-center rounded-lg", dot)}>
        {icon ?? <Wallet className="h-4 w-4" />}
      </div>
      <div className="mt-3 text-[26px] font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-[13px] font-medium text-foreground mt-1">{label}</div>
      {sub && <div className="text-[12px] text-muted-foreground mt-0.5 tabular-nums">{sub}</div>}
    </Card>
  );
}

// ─── Assumption number input ──────────────────────────────────────────────────
function MoneyInput({
  label, value, onChange, hint,
}: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] font-medium">{label}</Label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
        <Input
          type="number" inputMode="decimal" className="pl-5 tabular-nums h-9"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
function PctInput({
  label, value, onChange, hint,
}: { label: string; value: number; onChange: (n: number) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] font-medium">{label}</Label>
      <div className="relative">
        <Input
          type="number" min={0} max={100} className="pr-6 tabular-nums h-9"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(clampPct(Number(e.target.value) || 0))}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">%</span>
      </div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

const STATE_PILL: Record<string, string> = {
  settled: "bg-emerald-100 text-emerald-700",
  "in-flight": "bg-sky-100 text-sky-700",
  projected: "bg-slate-100 text-slate-600",
  denied: "bg-rose-100 text-rose-700",
};
const KIND_LABEL: Record<string, string> = { primary: "Primary", secondary: "Secondary", cost: "Cost" };

// ─── Component ────────────────────────────────────────────────────────────────
export function ForecastDashboard({ embedded = false }: { embedded?: boolean }) {
  const { data, loading, isFetching, usingMock, refetch, dataUpdatedAt } = useSubscriptionPatients();

  // Assumptions
  const [startingCash, setStartingCash] = useState(200000);
  const [supplierOwed, setSupplierOwed] = useState(0);
  const [monthlyFixedCost, setMonthlyFixedCost] = useState(0);
  const [reorderPct, setReorderPct] = useState(100);
  const [collectionPct, setCollectionPct] = useState(100);
  const [granularity, setGranularity] = useState<"week" | "month">("week");
  const [includePaused, setIncludePaused] = useState(true);
  const [primaryLag, setPrimaryLag] = useState(26);
  const [secondaryLag, setSecondaryLag] = useState(30);
  const [payerFilter, setPayerFilter] = useState("All payers");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [drill, setDrill] = useState<{ label: string; events: CashEvent[] } | null>(null);

  const patients = useMemo(
    () => (data ?? []).map(forecastPatientFromLive).filter((p) => !p.isNotActive),
    [data],
  );

  // Claims-board A/R pipeline: claims already submitted and awaiting payment.
  // These are the near-term inflows (~DOS+25). We reuse the proven claims
  // cash-flow classifier and take only the confident buckets (Soon = ERA in
  // hand / Medicaid soon; Expected = submitted, in normal turnaround). High
  // Risk (denials / late) and settled are excluded so we don't overstate.
  const { data: claims } = useAllClaims();
  const { data: secondaryClaims } = useAllSecondaryClaims();
  const todayForCf = useMemo(() => new Date(), []);
  const pipelineData = useMemo(() => {
    const cf = computeCashFlow(claims ?? [], secondaryClaims ?? [], todayForCf);
    const list: PipelineClaim[] = [...cf.soon.entries, ...cf.expected.entries].map((e) => ({
      id: e.id, patientName: e.name, payor: e.payor, kind: e.kind,
      dos: e.dos, sentDate: e.claimSentDate, payDate: e.payDate, amount: e.amount,
    }));
    return { list, soonTotal: cf.soon.total, expectedTotal: cf.expected.total };
  }, [claims, secondaryClaims, todayForCf]);

  const filteredPipeline = useMemo(
    () => pipelineData.list.filter((c) => payerFilter === "All payers" || c.payor === payerFilter),
    [pipelineData, payerFilter],
  );

  const payerOptions = useMemo(() => {
    const s = new Set<string>();
    patients.forEach((p) => p.primaryPayer && s.add(p.primaryPayer));
    return ["All payers", ...Array.from(s).sort()];
  }, [patients]);

  // Flag patients who already have an open claim (by normalized name) so the
  // engine can suppress a near-term subscription order that's really the same
  // order already counted in the claims pipeline.
  const flaggedPatients = useMemo(() => {
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const names = new Set(pipelineData.list.map((c) => norm(c.patientName)));
    return patients.map((p) => names.has(norm(p.name)) ? { ...p, hasOpenClaim: true } : p);
  }, [patients, pipelineData]);

  const filteredPatients = useMemo(
    () => flaggedPatients.filter((p) =>
      (payerFilter === "All payers" || p.primaryPayer === payerFilter) &&
      (typeFilter === "All types" || p.subscriptionType === typeFilter)),
    [flaggedPatients, payerFilter, typeFilter],
  );

  const today = useMemo(() => new Date(), []);
  const forecast: ForecastResult = useMemo(
    () => buildForecast(filteredPatients, today, {
      startingCash, supplierOwed, monthlyFixedCost,
      reorderRate: reorderPct / 100, collectionRate: collectionPct / 100,
      primaryLagDays: primaryLag, secondaryLagDays: secondaryLag,
      granularity, includePaused, horizonDays: 90,
    }, filteredPipeline),
    [filteredPatients, filteredPipeline, today, startingCash, supplierOwed, monthlyFixedCost, reorderPct, collectionPct, primaryLag, secondaryLag, granularity, includePaused],
  );

  const k = forecast.kpis;

  // Near-term inflow (strictly after today), for tying to the Claims board.
  const nearTerm = useMemo(() => {
    const t0 = parseLocalDate(forecast.windowStart)!.getTime();
    const inflowBy = (days: number) =>
      forecast.events.filter((e) => e.kind !== "cost").filter((e) => {
        const d = parseLocalDate(e.date)!.getTime();
        return d > t0 && d <= addDays(parseLocalDate(forecast.windowStart)!, days).getTime();
      }).reduce((s, e) => s + e.amount, 0);
    return { d7: inflowBy(7), d21: inflowBy(21), d30: inflowBy(30) };
  }, [forecast]);

  const chartData = useMemo(() => forecast.buckets.map((b) => ({
    label: b.label, key: b.key, range: b.rangeLabel,
    Primary: Math.round(b.primaryIn),
    Secondary: Math.round(b.secondaryIn),
    Cost: -Math.round(b.costOut),
    Burn: -Math.round(b.burn),
    Supplier: -Math.round(b.supplier),
    Balance: Math.round(b.endBalance),
  })), [forecast]);

  // Click a bucket → events that fall inside it.
  function openBucket(key: string, label: string) {
    const start = parseLocalDate(key)!;
    const end = granularity === "month"
      ? new Date(start.getFullYear(), start.getMonth() + 1, 0)
      : addDays(start, 6);
    const wStart = parseLocalDate(forecast.windowStart)!;
    const wEnd = parseLocalDate(forecast.windowEnd)!;
    const lo = Math.max(start.getTime(), wStart.getTime());
    const hi = Math.min(end.getTime(), wEnd.getTime());
    const events = forecast.events
      .filter((e) => { const d = parseLocalDate(e.date)!.getTime(); return d >= lo && d <= hi; })
      .sort((a, b) => a.date.localeCompare(b.date) || Math.abs(b.amount) - Math.abs(a.amount));
    setDrill({ label, events });
  }

  // Drill-down: collapse a bucket's events into ONE net row per patient order
  // (revenue minus cost for that order), instead of separate rev/cost rows.
  const drillRows = useMemo(() => {
    if (!drill) return [];
    const m = new Map<string, { patientName: string; payor: string; date: string; net: number; state: string }>();
    for (const e of drill.events) {
      const key = `${e.patientId}|${e.orderDate}`;
      const g = m.get(key);
      if (!g) m.set(key, { patientName: e.patientName, payor: e.payor, date: e.date, net: e.amount, state: e.state });
      else { g.net += e.amount; if (e.kind !== "cost") g.date = e.date; }
    }
    return Array.from(m.values()).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [drill]);

  // Export the financial model as CSV (imports cleanly into Google Sheets).
  function exportCsv() {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const r: string[] = [];
    r.push(`Cash Flow Forecast,generated ${new Date().toLocaleString("en-US")}`);
    r.push("");
    r.push("ASSUMPTIONS");
    r.push(`Cash in bank,${startingCash}`);
    r.push(`Owed to supplier,${supplierOwed}`);
    r.push(`Supplier spread (days),30`);
    r.push(`Fixed costs / month,${monthlyFixedCost}`);
    r.push(`Reorder rate %,${reorderPct}`);
    r.push(`Collection rate %,${collectionPct}`);
    r.push(`Primary lag (days from order),${primaryLag}`);
    r.push(`Secondary lag (days after primary),${secondaryLag}`);
    r.push(`Payer filter,${esc(payerFilter)}`);
    r.push(`Type filter,${esc(typeFilter)}`);
    r.push("");
    r.push("SUMMARY (next 90 days)");
    r.push(`Bank balance @ 30 days,${k.balanceIn30}`);
    r.push(`Bank balance @ 60 days,${k.balanceIn60}`);
    r.push(`Bank balance @ 90 days,${k.balanceIn90}`);
    r.push(`Min balance,${k.minBalance}`);
    r.push(`Runway (days; blank=none),${k.runwayDays ?? ""}`);
    r.push(`Monthly hiring headroom,${k.monthlyHeadroom}`);
    r.push(`Net operating cash,${k.netOperatingCash}`);
    r.push(`Revenue in,${k.revenueIn}`);
    r.push(`  Primary in,${k.primaryIn}`);
    r.push(`  Secondary in,${k.secondaryIn}`);
    r.push(`Product cost out,${k.costOut}`);
    r.push(`Fixed burn out,${k.burnOut}`);
    r.push(`Supplier paid out,${k.supplierOut}`);
    r.push(`Inflow next 7d,${nearTerm.d7}`);
    r.push(`Inflow next 21d,${nearTerm.d21}`);
    r.push(`Inflow next 30d,${nearTerm.d30}`);
    r.push("");
    r.push(`Claims A/R (from Claims board) — Soon <=7d,${pipelineData.soonTotal}`);
    r.push(`Claims A/R — Expected,${pipelineData.expectedTotal}`);
    r.push("");
    r.push(`${granularity.toUpperCase()} CASH FLOW`);
    r.push("Period,Range,Primary In,Secondary In,Product Cost,Fixed Burn,Supplier Draw,Net,End Balance");
    forecast.buckets.forEach((b) => r.push([b.label, b.rangeLabel, b.primaryIn, b.secondaryIn, b.costOut, b.burn, b.supplier, b.net, b.endBalance].map(esc).join(",")));
    const csv = r.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cash-forecast-${ymd(new Date())}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const runwayLabel = k.runwayDays === null ? "90+ days" : `${k.runwayDays} days`;
  const updated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  return (
    <div className={embedded ? "space-y-4" : "min-h-screen bg-muted/20"}>
      <div className={embedded ? "space-y-4" : "mx-auto max-w-[1400px] px-6 py-6 space-y-4"}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {!embedded && <Link to="/claims"><Button variant="ghost" size="sm" className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button></Link>}
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Cash Flow Forecast</h1>
              <p className="text-[13px] text-muted-foreground">
                Projected operating cash over the next 90 days · {k.patientsInScope} patients · {k.ordersInWindow} orders landing in window
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {usingMock && <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">Mock data</span>}
            <span className="text-[11px] text-muted-foreground">Updated {updated}</span>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>

        {/* Assumptions bar */}
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <MoneyInput label="Cash in bank" value={startingCash} onChange={setStartingCash} />
            <MoneyInput label="Owed to supplier" value={supplierOwed} onChange={setSupplierOwed} hint="Spread evenly over 30 days" />
            <MoneyInput label="Fixed costs / month" value={monthlyFixedCost} onChange={setMonthlyFixedCost} hint="Payroll, rent, etc." />
            <PctInput label="Reorder rate" value={reorderPct} onChange={setReorderPct} hint="% of orders that happen" />
            <PctInput label="Collection rate" value={collectionPct} onChange={setCollectionPct} hint="% of billings collected" />
            <div className="space-y-1">
              <Label className="text-[12px] font-medium">Primary payer</Label>
              <Select value={payerFilter} onValueChange={setPayerFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{payerOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px] font-medium">Subscription type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["All types", "Sensors", "Supplies", "Sensors & Supplies"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-5 flex-wrap border-t pt-3">
            <div className="flex items-center gap-2">
              <Label className="text-[12px] font-medium">Granularity</Label>
              <div className="flex rounded-md border overflow-hidden">
                {(["week", "month"] as const).map((g) => (
                  <button key={g} onClick={() => setGranularity(g)}
                    className={cn("px-3 py-1 text-[12px] font-medium capitalize", granularity === g ? "bg-foreground text-background" : "bg-background text-muted-foreground")}>
                    {g}ly
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="paused" checked={includePaused} onCheckedChange={setIncludePaused} />
              <Label htmlFor="paused" className="text-[12px] font-medium">Include paused patients</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[12px] font-medium">Primary lag</Label>
              <div className="relative w-[88px]">
                <Input type="number" min={0} className="pr-7 tabular-nums h-9" value={primaryLag} onChange={(e) => setPrimaryLag(Math.max(0, Number(e.target.value) || 0))} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">d</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[12px] font-medium">Secondary lag</Label>
              <div className="relative w-[88px]">
                <Input type="number" min={0} className="pr-7 tabular-nums h-9" value={secondaryLag} onChange={(e) => setSecondaryLag(Math.max(0, Number(e.target.value) || 0))} />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">d</span>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Model: future orders pay at order +{primaryLag}d (= DOS+{primaryLag - 1}); submitted claims (A/R) land at DOS+{primaryLag - 1}; secondary +{secondaryLag}d later; Medicaid uses the eMedNY cycle &amp; a +60d reorder. Cost only on future orders.
              <span className="block">Includes the live Claims-board A/R pipeline (submitted, awaiting payment) for near-term inflow.</span>
            </div>
          </div>
        </Card>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <KpiTile tone={k.balanceIn90 >= 0 ? "success" : "danger"} icon={<Wallet className="h-4 w-4" />}
            label="Bank balance @ 90 days" value={fmtMoney(k.balanceIn90, true)}
            sub={`opens at ${fmtMoney(k.netStartingCash, true)}`} />
          <KpiTile tone="info" icon={<CalendarClock className="h-4 w-4" />}
            label="Balance @ 30 / 60 days" value={`${fmtMoney(k.balanceIn30, true)}`}
            sub={`60d: ${fmtMoney(k.balanceIn60, true)}`} />
          <KpiTile tone={k.runwayDays === null ? "success" : "danger"} icon={<AlertTriangle className="h-4 w-4" />}
            label="Runway" value={runwayLabel}
            sub={`min ${fmtMoney(k.minBalance, true)} @ ${k.minBalanceDate.slice(5)}`} />
          <KpiTile tone={k.netOperatingCash >= 0 ? "success" : "warn"} icon={k.netOperatingCash >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            label="Net operating cash (90d)" value={fmtMoney(k.netOperatingCash, true)}
            sub={`in ${fmtMoney(k.revenueIn, true)} · out ${fmtMoney(k.costOut + k.burnOut, true)}`} />
          <KpiTile tone="neutral" icon={<PiggyBank className="h-4 w-4" />}
            label="Monthly hiring headroom" value={fmtMoney(k.monthlyHeadroom, true)}
            sub="extra fixed cost before $0" />
          <KpiTile tone="neutral" icon={<TrendingUp className="h-4 w-4" />}
            label="Revenue in (90d)" value={fmtMoney(k.revenueIn, true)}
            sub={`primary ${fmtMoney(k.primaryIn, true)} · sec ${fmtMoney(k.secondaryIn, true)}`} />
        </div>

        {/* Main chart */}
        <Card className="p-6">
          <div className="mb-3">
            <h3 className="text-[16px] font-semibold">Projected cash &amp; bank balance</h3>
            <p className="text-[12px] text-muted-foreground">
              <span className="font-medium text-sky-600">Bars (left axis)</span> = cash in/out per {granularity}; <span className="font-medium text-foreground">line (right axis)</span> = projected bank balance. {granularity === "week" ? "Each bar covers Mon–Sun; the label is that Monday." : "Each bar is a calendar month; the balance is end-of-month."} Click a bar to drill in.
            </p>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData} onClick={(e: any) => { const p = e?.activePayload?.[0]?.payload; if (p) openBucket(p.key, p.label); }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
              <YAxis yAxisId="cash" stroke="#0EA5E9" fontSize={12} tickFormatter={(v) => fmtMoney(v, true)}
                label={{ value: "Cash flow (bars)", angle: -90, position: "insideLeft", fill: "#0EA5E9", fontSize: 12, style: { textAnchor: "middle" } }} />
              <YAxis yAxisId="bal" orientation="right" stroke="#0f172a" fontSize={12} tickFormatter={(v) => fmtMoney(v, true)}
                label={{ value: "Bank balance (line)", angle: 90, position: "insideRight", fill: "#0f172a", fontSize: 12, style: { textAnchor: "middle" } }} />
              <Tooltip content={<ForecastTooltip />} />
              <Legend />
              <ReferenceLine yAxisId="bal" y={0} stroke="#ef4444" strokeDasharray="4 4" />
              <Bar yAxisId="cash" dataKey="Primary" stackId="a" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="cash" dataKey="Secondary" stackId="a" fill="#10B981" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="cash" dataKey="Cost" stackId="a" fill="#F87171" radius={[0, 0, 3, 3]} />
              <Bar yAxisId="cash" dataKey="Burn" stackId="a" fill="#fbbf24" />
              <Bar yAxisId="cash" dataKey="Supplier" stackId="a" fill="#a78bfa" radius={[0, 0, 3, 3]} />
              <Line yAxisId="bal" type="monotone" dataKey="Balance" stroke="#0f172a" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-4 flex-wrap">
              <span>Claims A/R (from Claims board): Soon ≤7d <b className="text-foreground tabular-nums">{fmtMoney(pipelineData.soonTotal, true)}</b> · Expected <b className="text-foreground tabular-nums">{fmtMoney(pipelineData.expectedTotal, true)}</b> · Total <b className="text-foreground tabular-nums">{fmtMoney(pipelineData.soonTotal + pipelineData.expectedTotal, true)}</b></span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <span>Inflow next 7d <b className="text-foreground tabular-nums">{fmtMoney(nearTerm.d7, true)}</b> · 21d <b className="text-foreground tabular-nums">{fmtMoney(nearTerm.d21, true)}</b> · 30d <b className="text-foreground tabular-nums">{fmtMoney(nearTerm.d30, true)}</b></span>
              <span>Locked (settled/in-flight): <b className="text-foreground tabular-nums">{fmtMoney(k.lockedInflow, true)}</b> · Projected: <b className="text-foreground tabular-nums">{fmtMoney(k.projectedInflow, true)}</b></span>
            </div>
            <div className="text-[10px]">A/R total ties to the Claims board; it lands across ~30–40 days because Medicaid pays on the eMedNY cycle (often weeks 4–6), not all within 21 days.</div>
          </div>
        </Card>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BreakdownCard title="By primary payer" subtitle="Window revenue, cost, and gross profit per payer." rows={forecast.byPayer.slice(0, 12)} />
          <BreakdownCard title="By subscription type" subtitle="Sensors vs Supplies vs bundle." rows={forecast.byType} />
        </div>

        {loading && <div className="text-center text-[13px] text-muted-foreground py-6">Loading subscription roster…</div>}
      </div>

      {/* Drill-down drawer */}
      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{drill?.label} — cash events</SheetTitle>
            <SheetDescription>
              {drillRows.length} patient orders · net {fmtMoney(drillRows.reduce((s, r) => s + r.net, 0))} (revenue − cost; excludes fixed burn &amp; supplier draw)
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Net cash</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drillRows.map((r, i) => (
                  <TableRow key={`${r.patientName}-${r.date}-${i}`}>
                    <TableCell className="text-[13px] font-medium">{r.patientName}</TableCell>
                    <TableCell className="text-[12px]">{r.payor}</TableCell>
                    <TableCell className="text-[12px] tabular-nums">{r.date}</TableCell>
                    <TableCell className={cn("text-right text-[13px] tabular-nums font-semibold", r.net < 0 ? "text-rose-600" : "text-emerald-700")}>
                      {fmtMoney(r.net)}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", STATE_PILL[r.state])}>{r.state}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function Forecast() {
  return <ForecastDashboard />;
}

function ForecastTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload ?? {};
  const row = (label: string, val: number, color: string) => (
    <div className="flex items-center justify-between gap-6 text-[12px]">
      <span style={{ color }}>{label}</span>
      <span className="tabular-nums font-medium" style={{ color }}>{fmtMoney(val)}</span>
    </div>
  );
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-md">
      <div className="text-[13px] font-semibold mb-1">{d.range ?? d.label}</div>
      {row("Primary in", d.Primary ?? 0, "#0EA5E9")}
      {row("Secondary in", d.Secondary ?? 0, "#10B981")}
      {row("Product cost", d.Cost ?? 0, "#F87171")}
      {row("Fixed burn", d.Burn ?? 0, "#fbbf24")}
      {row("Supplier draw", d.Supplier ?? 0, "#a78bfa")}
      <div className="mt-1 border-t pt-1">{row("Bank balance (end)", d.Balance ?? 0, "#0f172a")}</div>
    </div>
  );
}

function BreakdownCard({
  title, subtitle, rows,
}: { title: string; subtitle: string; rows: Array<{ key: string; revenue: number; cost: number; gp: number; orders: number; patients: number }> }) {
  return (
    <Card className="p-6">
      <div className="mb-3">
        <h3 className="text-[16px] font-semibold">{title}</h3>
        <p className="text-[12px] text-muted-foreground">{subtitle}</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{title.includes("payer") ? "Payer" : "Type"}</TableHead>
            <TableHead className="text-right">Orders</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">GP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="text-[13px] font-medium">{r.key}</TableCell>
              <TableCell className="text-right text-[13px] tabular-nums">{r.orders}</TableCell>
              <TableCell className="text-right text-[13px] tabular-nums font-semibold">{fmtMoney(r.revenue, true)}</TableCell>
              <TableCell className="text-right text-[13px] tabular-nums">{fmtMoney(r.cost, true)}</TableCell>
              <TableCell className={cn("text-right text-[13px] tabular-nums", r.gp >= 0 ? "text-emerald-700" : "text-rose-600")}>{fmtMoney(r.gp, true)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
