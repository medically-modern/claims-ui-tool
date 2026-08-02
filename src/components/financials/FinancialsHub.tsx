/**
 * FinancialsHub.tsx — the Financials top-level tab.
 *
 * Four sub-tabs with a hard LIVE vs SNAPSHOT split:
 *   - KPIs        (default) — LIVE north-star hero + month-end snapshot table/charts
 *   - Monthly     (SNAPSHOT)           — the Monthly Financials model, verbatim
 *   - Realization (SNAPSHOT)           — vintage collections, maturity chart
 *   - Forecast    (LIVE)               — the existing forward-looking dashboard
 *
 * SNAPSHOT data renders the Cash Flow Forecast Google Sheet via the backend
 * proxy (GET /monthly-financials) — the sheet is the single source of truth,
 * written on the 1st by the scheduled job; this component recomputes nothing
 * from it. The KPI hero's Active patients / ARR / ARP are the only LIVE
 * numbers, summed from the Subscription Board query, and are labeled LIVE.
 */

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChevronDown, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ForecastDashboard } from "@/pages/Forecast";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";

// ─── Types from GET /monthly-financials ─────────────────────────────────────
interface SheetRow { row: number; label: string; values: string[]; raw: (number | null)[] }
interface SheetTab { months: string[]; rows: SheetRow[] }
interface MonthlyFinancialsPayload {
  sheet_id: string;
  generated_at: number;
  cache_age_seconds: number;
  kpis: SheetTab;
  monthly: SheetTab;
  realization: SheetTab;
  error?: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const SHEET_URL = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

// Validated categorical palettes (dataviz scripts/validate_palette.js).
const GAP_COLORS = {
  inflight: "#0ea5e9",   // waiting on payer
  pipeline: "#8b5cf6",   // secondary / patient pipeline
  denied: "#f43f5e",     // adjudicated $0 — work it
  partial: "#9f1239",    // partial denial — appeal it
} as const;
const SERIES_2 = { a: "#0284c7", b: "#7c3aed" } as const; // rev/GP, ARR/ARP

function useMonthlyFinancials() {
  return useQuery<MonthlyFinancialsPayload>({
    queryKey: ["monthly-financials"],
    queryFn: async () => {
      if (!API_BASE) throw new Error("VITE_API_BASE_URL not configured");
      const res = await fetch(`${API_BASE}/monthly-financials`);
      if (!res.ok) throw new Error(`Backend ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json;
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const findRow = (tab: SheetTab | undefined, prefix: string) =>
  tab?.rows.find((r) => r.label.trim().toLowerCase().startsWith(prefix.toLowerCase()));

const latest = <T,>(arr: T[] | undefined): T | undefined =>
  arr && arr.length ? arr[arr.length - 1] : undefined;

function monthsOld(label: string): number {
  const d = new Date(`1 ${label}`);
  if (isNaN(+d)) return 99;
  return (Date.now() - +new Date(d.getFullYear(), d.getMonth() + 1, 1)) / (30.4 * 864e5);
}

const fmtMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000 ? `$${Math.round(n / 1000).toLocaleString()}k`
      : `$${Math.round(n).toLocaleString()}`;

function LivePill() {
  return (
    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-700">
      LIVE
    </span>
  );
}
function MonthEndPill({ m }: { m?: string }) {
  return (
    <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold tracking-wide text-slate-500">
      MONTH-END{m ? ` · ${m.toUpperCase()}` : ""}
    </span>
  );
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const coords = pts
    .map((v, i) => `${(i / (pts.length - 1)) * 56},${18 - ((v - min) / span) * 16}`)
    .join(" ");
  return (
    <svg width="60" height="20" className="inline-block align-middle">
      <polyline points={coords} fill="none" stroke="#64748b" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── KPIs view ───────────────────────────────────────────────────────────────
function KpisView({ data }: { data: MonthlyFinancialsPayload }) {
  const tab = data.kpis;
  const asOf = latest(tab.months);

  // LIVE numbers — summed from the Subscription Board right now, same
  // bases as the sheet: active = Status "Active"; ARR/ARP exclude only
  // the Not Active Patients group.
  const { data: patients, usingMock } = useSubscriptionPatients();
  const live = useMemo(() => {
    if (!patients || usingMock) return null;
    let active = 0, arr = 0, arp = 0;
    for (const p of patients as any[]) {
      // strict board status — the ops-normalized patientStatus folds
      // blank/"Not Active" into Active and would overcount (652 vs 613)
      if (p.rawPatientStatus === "Active") active++;
      if (!p.isNotActive) {
        arr += p.financials?.arr ?? 0;
        arp += p.financials?.arp ?? 0;
      }
    }
    return { active, arr, arp };
  }, [patients, usingMock]);

  const snapActive = latest(findRow(tab, "Active unique patients")?.raw);
  const netAdds = latest(findRow(tab, "Net patient adds")?.values);
  const churn = latest(findRow(tab, "Churn %")?.values);
  const snapArr = latest(findRow(tab, "ARR")?.raw);
  const snapArp = latest(findRow(tab, "ARP")?.raw);

  const activeShown = live?.active ?? (typeof snapActive === "number" ? snapActive : undefined);
  const arrShown = live?.arr ?? (typeof snapArr === "number" ? snapArr : undefined);
  const arpShown = live?.arp ?? (typeof snapArp === "number" ? snapArp : undefined);
  const heroPill = live ? <LivePill /> : <MonthEndPill m={asOf} />;

  const metricRows = tab.rows.filter((r) => r.row >= 4 && r.row <= 14 && r.label);

  // Month-end chart data from the Monthly Financials tab
  const m = data.monthly;
  const chartData = m.months.map((month, i) => ({
    month,
    active: findRow(m, "Active unique patients")?.raw[i] ?? null,
    revenue: findRow(m, "Total revenue")?.raw[i] ?? null,
    gp: findRow(m, "Total gross profit")?.raw[i] ?? null,
    arr: findRow(m, "Annualized gross revenue")?.raw[i] ?? null,
    arp: findRow(m, "Annualized recurring profit")?.raw[i] ?? null,
  }));

  return (
    <div className="space-y-4">
      {/* Hero: LIVE north stars — patients left, key financials right */}
      <Card className="p-6">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              Patients {heroPill}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[46px] font-bold tabular-nums tracking-tight">
                {activeShown !== undefined ? activeShown.toLocaleString() : "—"}
              </span>
              <span className="text-[15px] text-muted-foreground">active unique patients</span>
            </div>
            <div className="mt-2 flex items-center gap-6 text-[13px]">
              <span>
                <span className="text-muted-foreground">Net adds </span>
                <span className="font-semibold tabular-nums">{netAdds ?? "—"}</span>
              </span>
              <span>
                <span className="text-muted-foreground">Churn </span>
                <span className="font-semibold tabular-nums italic">{churn ?? "—"}</span>
              </span>
              <MonthEndPill m={asOf} />
            </div>
          </div>
          <div className="md:border-l md:pl-8">
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              Key financials {heroPill}
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[46px] font-bold tabular-nums tracking-tight">
                {arpShown !== undefined ? fmtMoney(arpShown) : "—"}
              </span>
              <span className="text-[15px] text-muted-foreground">ARP</span>
            </div>
            <div className="mt-2 text-[13px]">
              <span className="text-muted-foreground">ARR </span>
              <span className="text-[17px] font-semibold tabular-nums">
                {arrShown !== undefined ? fmtMoney(arrShown) : "—"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Month-end snapshot table */}
      <Card className="p-4 overflow-x-auto">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          Month-end snapshots <MonthEndPill />
        </div>
        <table className="text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-[340px] py-2 pr-4 font-semibold">Metric</th>
              {tab.months.map((mo) => (
                <th key={mo} className="w-28 py-2 px-3 text-right font-semibold">{mo}</th>
              ))}
              <th className="py-2 pl-5 font-semibold">Trend</th>
            </tr>
          </thead>
          <tbody>
            {metricRows.map((r) => {
              const isPct = r.values.some((v) => v.endsWith("%"));
              const isRealization = r.label.toLowerCase().startsWith("true realization");
              const immature = isRealization && asOf !== undefined && monthsOld(asOf) < 2;
              return (
                <tr key={r.row} className={cn("border-b last:border-0 border-slate-100", immature && "opacity-50")}>
                  <td className={cn("py-2 pr-4 font-medium", isPct && "italic")}>
                    {isRealization ? "True realization %" : r.label}
                    {immature && (
                      <Badge variant="outline" className="ml-2 text-[10px] border-amber-300 bg-amber-50 text-amber-700">
                        matures — ignore until 2+ mo old
                      </Badge>
                    )}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className={cn("py-2 px-3 text-right tabular-nums", isPct && "italic text-slate-600")}>
                      {v || "—"}
                    </td>
                  ))}
                  <td className="py-2 pl-5"><Sparkline values={r.raw} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Month-end trend charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            Active unique patients <MonthEndPill />
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={chartData} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="month" fontSize={11} tickLine={false} />
              <YAxis fontSize={11} tickLine={false} width={40} />
              <Tooltip />
              <Line dataKey="active" name="Active unique patients" stroke={SERIES_2.a}
                strokeWidth={2} dot={{ r: 5, fill: SERIES_2.a }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            Revenue & gross profit <MonthEndPill />
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chartData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="month" fontSize={11} tickLine={false} />
              <YAxis tickFormatter={(v) => fmtMoney(v)} fontSize={11} tickLine={false} width={52} />
              <Tooltip formatter={(v: number) => `$${Math.round(v).toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Revenue" fill={SERIES_2.a} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="gp" name="Gross profit" fill={SERIES_2.b} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            ARR & ARP <MonthEndPill />
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={chartData} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="month" fontSize={11} tickLine={false} />
              <YAxis tickFormatter={(v) => fmtMoney(v)} fontSize={11} tickLine={false} width={52} />
              <Tooltip formatter={(v: number) => `$${Math.round(v).toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="arr" name="ARR" stroke={SERIES_2.a} strokeWidth={2}
                dot={{ r: 5, fill: SERIES_2.a }} isAnimationActive={false} />
              <Line dataKey="arp" name="ARP" stroke={SERIES_2.b} strokeWidth={2}
                dot={{ r: 5, fill: SERIES_2.b }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

// ─── Monthly Model view ──────────────────────────────────────────────────────
const SECTION_HEADERS = [
  "PATIENTS", "REVENUE", "COGS", "GROSS PROFIT", "FIXED COSTS",
  "PRODUCT & INSURANCE MIX", "PER-PATIENT UNIT ECONOMICS",
  "LTV & PUMP PAYBACK", "MONTH-OVER-MONTH DELTAS", "SELF-AUDIT",
];

// Per-unit / per-patient average rows render italic (vs totals bold).
const PER_UNIT_LABELS = [
  "Pump COGS per unit", "Monitor COGS per unit", "Sensor COGS per fill",
  "Supplies COGS per fill", "Average order", "Avg order", "Avg annual",
  "Avg patient lifetime", "Est. pump payback", "Attach rate",
];

// Rows that read as sums / key results: bold with a rule above.
const SUM_LABELS = [
  "Total subscriptions", "Active subscriptions", "Paused subscriptions",
  "New subscriptions", "Churned subscriptions", "Net patient adds",
  "Total revenue", "Total COGS", "Total gross profit", "Total gross margin %",
  "Subscription gross margin %", "Net profit", "Net margin %",
  "Annualized gross revenue", "Annualized recurring profit",
  "Est. LTV", "Audit status",
];

function MonthlyModelView({ data }: { data: MonthlyFinancialsPayload }) {
  const tab = data.monthly;
  const [open, setOpen] = useState<Record<string, boolean>>({ PATIENTS: true, REVENUE: true });

  const sections = useMemo(() => {
    const out: { title: string; rows: SheetRow[] }[] = [];
    let current: { title: string; rows: SheetRow[] } | null = null;
    for (const r of tab.rows) {
      const hdr = SECTION_HEADERS.find((h) => r.label.toUpperCase().startsWith(h));
      if (hdr) {
        current = { title: r.label, rows: [] };
        out.push(current);
      } else if (current && r.label && !r.label.startsWith("Definitions")) {
        if (r.label.length > 120) continue;
        current.rows.push(r);
      }
    }
    return out;
  }, [tab]);

  const auditRow = findRow(tab, "Audit status");
  const auditOk = latest(auditRow?.values) === "OK";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Badge className={cn("font-semibold", auditOk
          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
          : "bg-rose-100 text-rose-800 hover:bg-rose-100")}>
          Self-audit: {auditOk ? "OK — column ties" : "CHECK — investigate before trusting"}
        </Badge>
        <a className="inline-flex items-center gap-1 text-[13px] text-sky-700 hover:underline"
          href={SHEET_URL(data.sheet_id)} target="_blank" rel="noreferrer">
          Open in Google Sheets <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {sections.map((s) => {
        const key = s.title.split(" ")[0];
        const isOpen = open[key] ?? false;
        return (
          <Card key={s.title} className="overflow-hidden">
            <button
              className="flex w-full items-center gap-2 bg-slate-50 px-4 py-2.5 text-left text-[13px] font-semibold hover:bg-slate-100"
              onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {s.title}
            </button>
            {isOpen && (
              <div className="overflow-x-auto px-4 pb-3">
                <table className="text-[13px]">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="w-[360px] py-1.5 pr-6 font-medium">&nbsp;</th>
                      {tab.months.map((mo) => (
                        <th key={mo} className="w-28 py-1.5 px-3 text-right font-medium">{mo}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let prev: SheetRow | null = null;
                      return s.rows.filter((r) => r.values.some((v) => v !== "")).map((r) => {
                      const label = r.label.trim();
                      const gapRows = prev ? r.row - prev.row - 1 : 0;
                      const prevWasSum = prev !== null &&
                        SUM_LABELS.some((l) => prev!.label.trim().startsWith(l));
                      prev = r;
                      const isSub = r.label.startsWith("   ");
                      const isSum = SUM_LABELS.some((l) => label.startsWith(l));
                      const isUnit = PER_UNIT_LABELS.some((l) => label.startsWith(l));
                      const isPct = r.values.some((v) => v.endsWith("%"));
                      return (
                        <Fragment key={r.row}>
                          {gapRows > 0 && (
                            <tr aria-hidden="true">
                              <td colSpan={tab.months.length + 1}
                                className={prevWasSum ? "h-5" : "h-2"} />
                            </tr>
                          )}
                          <tr>
                            <td className={cn("py-1.5 pr-6",
                              isSub && "pl-5 italic text-slate-400",
                              isUnit && !isSub && "italic text-slate-500",
                              isSum && "font-semibold border-t border-slate-300 pt-2",
                              !isSub && !isSum && !isUnit && "font-medium")}>
                              {label}
                            </td>
                            {r.values.map((v, i) => (
                              <td key={i} className={cn("py-1.5 px-3 text-right tabular-nums",
                                isSub && "italic text-slate-400",
                                isUnit && !isSub && "italic text-slate-500",
                                isSum && "font-semibold border-t border-slate-300 pt-2",
                                !isSub && !isUnit && isPct && "italic text-slate-600")}>
                                {v || "—"}
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─── Realization view ────────────────────────────────────────────────────────
function RealizationView({ data }: { data: MonthlyFinancialsPayload }) {
  const tab = data.realization;
  const months = tab.months;
  const raw = (prefix: string) => findRow(tab, prefix)?.raw ?? [];

  const maturity = months.map((mo, i) => ({
    month: mo,
    age: raw("Days since month end")[i] ?? 0,
    rate: ((raw("TRUE realization rate")[i] as number) ?? 0) * 100,
  })).sort((a, b) => (a.age as number) - (b.age as number));

  const gap = months.map((mo, i) => ({
    month: mo,
    "In flight (waiting on payer)": raw("· in flight")[i] ?? 0,
    "Secondary / patient pipeline": raw("· secondary & patient pipeline")[i] ?? 0,
    "Denied $0 (work it)": raw("· denied, paid $0")[i] ?? 0,
    "Partial denial (appeal it)": raw("· partial denial")[i] ?? 0,
  }));

  const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="text-[13px] font-semibold">True realization % vs. age of DOS month</div>
          <div className="text-[12px] text-muted-foreground mb-2">
            Against adjusted Est. Pay (rate variance backed out). Young months read low by design and mature every re-measure.
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={maturity} margin={{ top: 14, right: 24, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="age" type="number" domain={[0, "dataMax + 10"]} tickLine={false}
                label={{ value: "days since month end", position: "insideBottom", offset: -2, fontSize: 11 }}
                fontSize={11} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} fontSize={11} tickLine={false} width={44} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`}
                labelFormatter={(age) => {
                  const p = maturity.find((x) => x.age === age);
                  return p ? `${p.month} · ${age} days old` : `${age} days`;
                }} />
              <Line dataKey="rate" stroke="#0284c7" strokeWidth={2}
                dot={{ r: 5, fill: "#0284c7" }} isAnimationActive={false}
                label={({ x, y, index }: any) => (
                  <text x={x} y={(y ?? 0) - 10} textAnchor="middle" fontSize={11} fill="#334155">
                    {maturity[index]?.month}
                  </text>
                )} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <div className="text-[13px] font-semibold">Remaining (adjusted − collected) by DOS month</div>
          <div className="text-[12px] text-muted-foreground mb-2">
            Sky/violet = wait · rose = work or appeal. Rate variance is already out of the denominator.
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={gap} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="month" fontSize={11} tickLine={false} />
              <YAxis tickFormatter={fmtK} fontSize={11} tickLine={false} width={48} />
              <Tooltip formatter={(v: number) => `$${Math.round(v).toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(
                [
                  ["In flight (waiting on payer)", GAP_COLORS.inflight],
                  ["Secondary / patient pipeline", GAP_COLORS.pipeline],
                  ["Denied $0 (work it)", GAP_COLORS.denied],
                  ["Partial denial (appeal it)", GAP_COLORS.partial],
                ] as const
              ).map(([k, color]) => (
                <Bar key={k} dataKey={k} stackId="gap" fill={color}
                  stroke="#fcfcfb" strokeWidth={1} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Verbatim vintage table */}
      <Card className="p-4 overflow-x-auto">
        <table className="text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-[380px] py-1.5 pr-6 font-semibold">Metric</th>
              {months.map((mo) => (
                <th key={mo} className="w-28 py-1.5 px-3 text-right font-semibold">{mo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              let prev: SheetRow | null = null;
              return tab.rows
              .filter((r) => r.row >= 4 && r.label && r.label.length < 120 && r.values.some((v) => v !== ""))
              .map((r) => {
                const label = r.label.trim();
                const gapRows = prev ? r.row - prev.row - 1 : 0;
                prev = r;
                const isSub = r.label.startsWith("   ");
                const isSum = ["Adjusted Est. Pay", "Collected — total", "TRUE realization", "Remaining ("]
                  .some((l) => label.startsWith(l));
                const isPct = r.values.some((v) => v.endsWith("%"));
                return (
                  <Fragment key={r.row}>
                    {gapRows > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={months.length + 1} className="h-4" />
                      </tr>
                    )}
                    <tr>
                      <td className={cn("py-1.5 pr-6",
                        isSub && "pl-5 italic text-slate-400",
                        isSum && "font-semibold border-t border-slate-300",
                        !isSub && !isSum && "font-medium")}>
                        {label}
                      </td>
                      {r.values.map((v, i) => (
                        <td key={i} className={cn("py-1.5 px-3 text-right tabular-nums",
                          isSub && "italic text-slate-400",
                          isSum && "font-semibold border-t border-slate-300",
                          !isSub && isPct && "italic text-slate-600")}>
                          {v || "—"}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              });
            })()}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Hub ─────────────────────────────────────────────────────────────────────
export default function FinancialsHub() {
  const [sub, setSub] = useState<"kpis" | "model" | "realization" | "forecast">("kpis");
  const { data, isLoading, error, refetch, isFetching } = useMonthlyFinancials();
  const asOf = data ? latest(data.kpis.months) : undefined;

  const snapshot = sub !== "forecast";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={sub} onValueChange={(v) => setSub(v as typeof sub)}>
          <TabsList className="bg-card border">
            <TabsTrigger value="kpis">KPIs</TabsTrigger>
            <TabsTrigger value="model">Monthly Model</TabsTrigger>
            <TabsTrigger value="realization">Realization</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {sub === "forecast" ? (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 font-medium">
              LIVE · computed from the boards right now
            </Badge>
          ) : (
            <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-600 font-medium">
              SNAPSHOT · as of {asOf ?? "—"} · updates on the 1st
            </Badge>
          )}
          {snapshot && (
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
          )}
        </div>
      </div>

      {sub === "forecast" && <ForecastDashboard embedded />}

      {snapshot && isLoading && (
        <Card className="p-8 text-center text-muted-foreground text-sm">Loading monthly snapshots…</Card>
      )}
      {snapshot && !!error && (
        <Card className="p-8 text-center text-sm text-rose-700">
          Couldn't load the monthly snapshot data: {(error as Error).message}.
          The Google Sheet remains the source of truth.
        </Card>
      )}
      {snapshot && data && (
        <>
          {sub === "kpis" && <KpisView data={data} />}
          {sub === "model" && <MonthlyModelView data={data} />}
          {sub === "realization" && <RealizationView data={data} />}
        </>
      )}
    </div>
  );
}
