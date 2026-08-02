/**
 * FinancialsHub.tsx — the Financials top-level tab.
 *
 * Four sub-tabs with a hard LIVE vs SNAPSHOT split:
 *   - KPIs        (SNAPSHOT · default) — north-star goal view from the sheet
 *   - Monthly     (SNAPSHOT)           — the Monthly Financials model, verbatim
 *   - Realization (SNAPSHOT)           — vintage collections, maturity chart
 *   - Forecast    (LIVE)               — the existing forward-looking dashboard
 *
 * SNAPSHOT tabs render the Cash Flow Forecast Google Sheet via the backend
 * proxy (GET /monthly-financials). The sheet is the single source of truth,
 * written on the 1st of each month by the scheduled job — this component
 * deliberately computes NOTHING itself, so UI and sheet can never disagree.
 */

import { useMemo, useState } from "react";
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

// Validated categorical palette (scripts/validate_palette.js — all checks
// pass; contrast WARN on sky/amber is relieved by legend + table view).
const GAP_COLORS = {
  inflight: "#0ea5e9",   // waiting on payer
  ratevar: "#f59e0b",    // estimate above contract — fix the estimate
  pipeline: "#8b5cf6",   // secondary / patient pipeline
  denied: "#f43f5e",     // adjudicated $0 — work it
  partial: "#9f1239",    // partial denial — appeal it
} as const;

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
const findRow = (tab: SheetTab, prefix: string) =>
  tab.rows.find((r) => r.label.toLowerCase().startsWith(prefix.toLowerCase()));

const latest = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];

/** Months since a "Jul 2026"-style label (approx, for maturity badges). */
function monthsOld(label: string): number {
  const d = new Date(`1 ${label}`);
  if (isNaN(+d)) return 99;
  return (Date.now() - +new Date(d.getFullYear(), d.getMonth() + 1, 1)) / (30.4 * 864e5);
}

function SnapshotBadge({ asOf }: { asOf?: string }) {
  return (
    <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-600 font-medium">
      SNAPSHOT · as of {asOf ?? "—"} · updates on the 1st
    </Badge>
  );
}

function LiveBadge() {
  return (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 font-medium">
      LIVE · computed from the boards right now
    </Badge>
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
  const activeRow = findRow(tab, "Active patients");
  const active = latest(activeRow?.raw ?? [])
  const netAdds = latest(findRow(tab, "Net patient adds")?.values ?? []);
  const churn = latest(findRow(tab, "Churn %")?.values ?? []);
  const arr = latest(findRow(tab, "ARR")?.values ?? []);
  const arp = latest(findRow(tab, "ARP")?.values ?? []);
  const goal = 1000;
  const pct = typeof active === "number" ? Math.min(100, (active / goal) * 100) : 0;

  const metricRows = tab.rows.filter((r) => r.row >= 4 && r.row <= 14 && r.label);

  return (
    <div className="space-y-4">
      {/* Hero: north star */}
      <Card className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              Active patients — north star
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[44px] font-bold tabular-nums tracking-tight">
                {typeof active === "number" ? active.toLocaleString() : "—"}
              </span>
              <span className="text-[15px] text-muted-foreground">of {goal.toLocaleString()} goal</span>
            </div>
            <div className="mt-2 h-2.5 w-[340px] max-w-full rounded-full bg-slate-100">
              <div className="h-2.5 rounded-full bg-sky-600" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex gap-8">
            <div>
              <div className="text-[12px] text-muted-foreground">Net adds ({asOf})</div>
              <div className="text-[24px] font-semibold tabular-nums">{netAdds ?? "—"}</div>
            </div>
            <div>
              <div className="text-[12px] text-muted-foreground">Churn (pure)</div>
              <div className="text-[24px] font-semibold tabular-nums">{churn ?? "—"}</div>
            </div>
            <div>
              <div className="text-[12px] text-muted-foreground">ARR</div>
              <div className="text-[24px] font-semibold tabular-nums">{arr ?? "—"}</div>
            </div>
            <div>
              <div className="text-[12px] text-muted-foreground">ARP — value scoreboard</div>
              <div className="text-[24px] font-semibold tabular-nums">{arp ?? "—"}</div>
            </div>
          </div>
        </div>
      </Card>

      {/* Trend table: metrics × months */}
      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-semibold">Metric</th>
              {tab.months.map((m) => (
                <th key={m} className="py-2 px-3 text-right font-semibold">{m}</th>
              ))}
              <th className="py-2 pl-4 font-semibold">Trend</th>
            </tr>
          </thead>
          <tbody>
            {metricRows.map((r) => {
              const isRealization = r.label.toLowerCase().startsWith("true realization");
              const immature = isRealization && asOf !== undefined && monthsOld(asOf) < 2;
              return (
                <tr key={r.row} className={cn("border-b last:border-0", immature && "opacity-50")}>
                  <td className="py-2 pr-4 font-medium">
                    {r.label}
                    {immature && (
                      <Badge variant="outline" className="ml-2 text-[10px] border-amber-300 bg-amber-50 text-amber-700">
                        matures — ignore until 2+ mo old
                      </Badge>
                    )}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className="py-2 px-3 text-right tabular-nums">{v || "—"}</td>
                  ))}
                  <td className="py-2 pl-4"><Sparkline values={r.raw} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Monthly Model view ──────────────────────────────────────────────────────
const SECTION_HEADERS = [
  "PATIENTS", "REVENUE", "COGS", "GROSS PROFIT", "FIXED COSTS",
  "PRODUCT & INSURANCE MIX", "PER-PATIENT UNIT ECONOMICS",
  "LTV & PUMP PAYBACK", "MONTH-OVER-MONTH DELTAS", "SELF-AUDIT",
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
        // stop collecting once the definitions block starts
        if (out.length && r.label.length > 120) continue;
        current.rows.push(r);
      }
    }
    return out;
  }, [tab]);

  const auditRow = findRow(tab, "Audit status");
  const auditOk = latest(auditRow?.values ?? []) === "OK";

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
        const isOpen = open[s.title.split(" ")[0]] ?? false;
        const key = s.title.split(" ")[0];
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
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-4 font-medium">&nbsp;</th>
                      {tab.months.map((m) => (
                        <th key={m} className="py-1.5 px-3 text-right font-medium">{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.filter((r) => r.values.some((v) => v !== "")).map((r) => (
                      <tr key={r.row} className="border-b last:border-0 border-slate-100">
                        <td className={cn("py-1.5 pr-4",
                          r.label.startsWith("   ") ? "pl-5 text-muted-foreground italic" : "font-medium")}>
                          {r.label.trim()}
                        </td>
                        {r.values.map((v, i) => (
                          <td key={i} className="py-1.5 px-3 text-right tabular-nums">{v || "—"}</td>
                        ))}
                      </tr>
                    ))}
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

  const maturity = months.map((m, i) => ({
    month: m,
    age: raw("Days since month end")[i] ?? 0,
    rate: (raw("True realization rate")[i] ?? 0) * 100,
  })).sort((a, b) => (a.age as number) - (b.age as number));

  const gap = months.map((m, i) => ({
    month: m,
    "In flight (waiting on payer)": raw("   · not yet adjudicated")[i] ?? 0,
    "Rate variance (fix the estimate)": raw("   · paid short — rate variance")[i] ?? 0,
    "Secondary / patient pipeline": raw("Remaining — secondary & patient")[i] ?? 0,
    "Denied $0 (work it)": raw("   · adjudicated, paid $0")[i] ?? 0,
    "Partial denial (appeal it)": raw("   · paid short — partial denial")[i] ?? 0,
  }));

  const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="text-[13px] font-semibold">Maturity curve — true realization % vs. age of DOS month</div>
          <div className="text-[12px] text-muted-foreground mb-2">
            Young months read low by design; each point moves up and right every monthly re-measure.
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={maturity} margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
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
          <div className="text-[13px] font-semibold">Remaining gap by DOS month — what kind of money is missing</div>
          <div className="text-[12px] text-muted-foreground mb-2">
            Sky/violet = wait · amber = fix the estimate · rose = work or appeal the claim.
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
                  ["Rate variance (fix the estimate)", GAP_COLORS.ratevar],
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
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 pr-4 font-semibold">Metric</th>
              {months.map((m) => (
                <th key={m} className="py-1.5 px-3 text-right font-semibold">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tab.rows
              .filter((r) => r.row >= 4 && r.label && r.label.length < 120 && r.values.some((v) => v !== ""))
              .map((r) => (
                <tr key={r.row} className="border-b last:border-0 border-slate-100">
                  <td className={cn("py-1.5 pr-4",
                    r.label.startsWith("   ") ? "pl-5 text-muted-foreground italic" : "font-medium")}>
                    {r.label.trim()}
                  </td>
                  {r.values.map((v, i) => (
                    <td key={i} className="py-1.5 px-3 text-right tabular-nums">{v || "—"}</td>
                  ))}
                </tr>
              ))}
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
          {snapshot ? <SnapshotBadge asOf={asOf} /> : <LiveBadge />}
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
