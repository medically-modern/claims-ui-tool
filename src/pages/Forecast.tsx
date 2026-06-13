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
  PiggyBank, AlertTriangle,
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
  const pipeline: PipelineClaim[] = useMemo(() => {
    const cf = computeCashFlow(claims ?? [], secondaryClaims ?? [], todayForCf);
    return [...cf.soon.entries, ...cf.expected.entries].map((e) => ({
      id: e.id, patientName: e.name, payor: e.payor, kind: e.kind,
      dos: e.dos, sentDate: e.claimSentDate, payDate: e.payDate, amount: e.amount,
    }));
  }, [claims, secondaryClaims, todayForCf]);

  const filteredPipeline = useMemo(
    () => pipeline.filter((c) => payerFilter === "All payers" || c.payor === payerFilter),
    [pipeline, payerFilter],
  );

  const payerOptions = useMemo(() => {
    const s = new Set<string>();
    patients.forEach((p) => p.primaryPayer && s.add(p.primaryPayer));
    return ["All payers", ...Array.from(s).sort()];
  }, [patients]);

  const filteredPatients = useMemo(
    () => patients.filter((p) =>
      (payerFilter === "All payers" || p.primaryPayer === payerFilter) &&
      (typeFilter === "All types" || p.subscriptionType === typeFilter)),
    [patients, payerFilter, typeFilter],
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

  const chartData = useMemo(() => forecast.buckets.map((b) => ({
    label: b.label, key: b.key,
    Primary: Math.round(b.primaryIn),
    Secondary: Math.round(b.secondaryIn),
    Cost: -Math.round(b.costOut),
    Burn: -Math.round(b.burn),
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
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>

        {/* Assumptions bar */}
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <MoneyInput label="Cash in bank" value={startingCash} onChange={setStartingCash} />
            <MoneyInput label="Owed to supplier" value={supplierOwed} onChange={setSupplierOwed} hint="Netted from opening cash" />
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
              Bars: inflows (up) and cost + fixed-cost burn (down) per {granularity}. Line: projected bank balance. Click a bar to drill in.
            </p>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData} onClick={(e: any) => { const p = e?.activePayload?.[0]?.payload; if (p) openBucket(p.key, p.label); }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
              <YAxis yAxisId="cash" stroke="#64748b" fontSize={12} tickFormatter={(v) => fmtMoney(v, true)} />
              <YAxis yAxisId="bal" orientation="right" stroke="#0f172a" fontSize={12} tickFormatter={(v) => fmtMoney(v, true)} />
              <Tooltip formatter={(v: number, name: string) => [fmtMoney(v), name]} labelStyle={{ color: "#0F172A", fontWeight: 600 }} />
              <Legend />
              <ReferenceLine yAxisId="bal" y={0} stroke="#ef4444" strokeDasharray="4 4" />
              <Bar yAxisId="cash" dataKey="Primary" stackId="a" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="cash" dataKey="Secondary" stackId="a" fill="#10B981" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="cash" dataKey="Cost" stackId="a" fill="#F87171" radius={[0, 0, 3, 3]} />
              <Bar yAxisId="cash" dataKey="Burn" stackId="a" fill="#fbbf24" radius={[0, 0, 3, 3]} />
              <Line yAxisId="bal" type="monotone" dataKey="Balance" stroke="#0f172a" strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span>Locked (settled/in-flight) inflow: <b className="text-foreground tabular-nums">{fmtMoney(k.lockedInflow, true)}</b></span>
            <span>Projected inflow: <b className="text-foreground tabular-nums">{fmtMoney(k.projectedInflow, true)}</b></span>
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
              {drill?.events.length ?? 0} events · net {fmtMoney((drill?.events ?? []).reduce((s, e) => s + e.amount, 0))}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(drill?.events ?? []).map((e, i) => (
                  <TableRow key={`${e.patientId}-${e.kind}-${e.date}-${i}`}>
                    <TableCell className="text-[13px] font-medium">{e.patientName}</TableCell>
                    <TableCell className="text-[12px]">{e.payor}</TableCell>
                    <TableCell className="text-[12px]">{KIND_LABEL[e.kind]}</TableCell>
                    <TableCell className="text-[12px] tabular-nums">{e.date}</TableCell>
                    <TableCell className={cn("text-right text-[13px] tabular-nums font-semibold", e.amount < 0 ? "text-rose-600" : "text-emerald-700")}>
                      {fmtMoney(e.amount)}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", STATE_PILL[e.state])}>{e.state}</span>
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
