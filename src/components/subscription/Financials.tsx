/**
 * Financials.tsx — Subscription Board → Financials tab.
 *
 * Read-only financial visibility. Aggregates per-patient revenue / cost /
 * gross profit pulled from the Subscription Board into:
 *   - Topline KPI tiles (this-month revenue/cost/GP, MRR proxy, ARR, GP %)
 *   - Monthly forecast bar chart (Revenue + Cost + GP for next 6 months)
 *   - Subscription type breakdown (Sensors / Supplies / Sensors & Supplies)
 *   - Top payers table (rev, cost, GP, GP %, patient count)
 *   - Per-patient drill-down table (sortable)
 */

import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownAZ, ArrowUpAZ, DollarSign } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  ORDER_PREP_PATIENTS, PAYER_OPTIONS, SubscriptionPatient, SubscriptionType,
} from "./mockData";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtMoney(n: number, abbr = false) {
  if (abbr) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(n: number, dp = 1) {
  return `${(n * 100).toFixed(dp)}%`;
}
function monthKey(iso: string) {
  if (!iso || iso.length < 7) return "";
  return iso.slice(0, 7); // YYYY-MM
}
function monthLabel(key: string) {
  if (!key) return "—";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// ─── Patients with non-zero financials only ─────────────────────────────────
const PATIENTS_WITH_FIN = ORDER_PREP_PATIENTS.filter((p) => p.financials && p.financials.totalRevenue > 0);

// ─── KPI tile ────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "success" | "danger" | "info";
}) {
  const dot = {
    success: "bg-emerald-100 text-emerald-700",
    danger:  "bg-rose-100 text-rose-700",
    info:    "bg-sky-100 text-sky-700",
    neutral: "bg-slate-100 text-slate-700",
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg", dot)}>
          <DollarSign className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-[28px] font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-[13px] font-medium text-foreground mt-1">{label}</div>
      {sub && <div className="text-[12px] text-muted-foreground mt-0.5 tabular-nums">{sub}</div>}
    </Card>
  );
}

// ─── Sort helpers for patient table ──────────────────────────────────────────
type SortKey = "name" | "payer" | "type" | "nextOrder" | "revenue" | "cost" | "gp" | "gpPct" | "arr";
type Dir = "asc" | "desc";

function compareBy(a: SubscriptionPatient, b: SubscriptionPatient, key: SortKey): number {
  const fa = a.financials!;
  const fb = b.financials!;
  switch (key) {
    case "name":      return a.name.localeCompare(b.name);
    case "payer":     return a.primaryPayer.localeCompare(b.primaryPayer);
    case "type":      return a.subscriptionType.localeCompare(b.subscriptionType);
    case "nextOrder": return a.nextOrderDate.localeCompare(b.nextOrderDate);
    case "revenue":   return fa.totalRevenue - fb.totalRevenue;
    case "cost":      return fa.totalCost - fb.totalCost;
    case "gp":        return fa.totalGP - fb.totalGP;
    case "gpPct":     return (fa.totalGP / Math.max(fa.totalRevenue, 1)) - (fb.totalGP / Math.max(fb.totalRevenue, 1));
    case "arr":       return fa.arr - fb.arr;
  }
}

const SUB_TYPE_COLOR: Record<SubscriptionType, string> = {
  "Sensors":            "#0EA5E9",
  "Supplies":           "#7C3AED",
  "Sensors & Supplies": "#EA580C",
};

const SUB_TYPE_PILL: Record<SubscriptionType, string> = {
  "Sensors":            "bg-sky-100 text-sky-700",
  "Supplies":           "bg-violet-100 text-violet-700",
  "Sensors & Supplies": "bg-orange-100 text-orange-700",
};

// ─── Component ───────────────────────────────────────────────────────────────
export function Financials() {
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>("All payers");
  const [type, setType] = useState<string>("All types");
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<Dir>("desc");

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "name" || k === "payer" || k === "type" || k === "nextOrder" ? "asc" : "desc"); }
  };

  const filtered = useMemo(() => {
    return PATIENTS_WITH_FIN.filter((p) => {
      if (search) {
        const q = search.trim().toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.mondayItemId.includes(q)) return false;
      }
      if (payer !== "All payers" && p.primaryPayer !== payer) return false;
      if (type !== "All types" && p.subscriptionType !== type) return false;
      return true;
    });
  }, [search, payer, type]);

  // ─── Topline aggregates (filtered) ────────────────────────────────────────
  const totals = useMemo(() => {
    const acc = { rev: 0, cost: 0, gp: 0, ship: 0, arr: 0, arp: 0, count: 0,
      sensorsRev: 0, suppliesRev: 0, sensorsGP: 0, suppliesGP: 0 };
    for (const p of filtered) {
      const f = p.financials!;
      acc.rev += f.totalRevenue;
      acc.cost += f.totalCost;
      acc.gp += f.totalGP;
      acc.ship += f.shippingCost;
      acc.arr += f.arr;
      acc.arp += f.arp;
      acc.sensorsRev += f.sensorsRevenue;
      acc.suppliesRev += f.suppliesRevenue;
      acc.sensorsGP += f.sensorsGP;
      acc.suppliesGP += f.suppliesGP;
      acc.count += 1;
    }
    return acc;
  }, [filtered]);

  // ─── Monthly forecast ────────────────────────────────────────────────────
  // Group by next-order-date month for the next 6 months. Each order
  // contributes its revenue/cost/GP to that month's bucket.
  const monthly = useMemo(() => {
    const now = new Date();
    now.setDate(1);
    const buckets: Record<string, { rev: number; cost: number; gp: number; count: number }> = {};
    for (let i = 0; i < 6; i++) {
      const d = new Date(now);
      d.setMonth(now.getMonth() + i);
      const k = d.toISOString().slice(0, 7);
      buckets[k] = { rev: 0, cost: 0, gp: 0, count: 0 };
    }
    for (const p of filtered) {
      const k = monthKey(p.nextOrderDate);
      if (!buckets[k]) continue;
      const f = p.financials!;
      buckets[k].rev += f.totalRevenue;
      buckets[k].cost += f.totalCost;
      buckets[k].gp += f.totalGP;
      buckets[k].count += 1;
    }
    return Object.entries(buckets).map(([k, v]) => ({
      month: monthLabel(k),
      Revenue: Math.round(v.rev),
      Cost: Math.round(v.cost),
      GP: Math.round(v.gp),
      Orders: v.count,
    }));
  }, [filtered]);

  // ─── By subscription type ────────────────────────────────────────────────
  const byType = useMemo(() => {
    const acc: Record<SubscriptionType, { rev: number; gp: number; count: number }> = {
      "Sensors":            { rev: 0, gp: 0, count: 0 },
      "Supplies":           { rev: 0, gp: 0, count: 0 },
      "Sensors & Supplies": { rev: 0, gp: 0, count: 0 },
    };
    for (const p of filtered) {
      const f = p.financials!;
      acc[p.subscriptionType].rev += f.totalRevenue;
      acc[p.subscriptionType].gp += f.totalGP;
      acc[p.subscriptionType].count += 1;
    }
    return Object.entries(acc).map(([name, v]) => ({
      name, value: Math.round(v.rev), gp: Math.round(v.gp), count: v.count,
    }));
  }, [filtered]);

  // ─── By payer ────────────────────────────────────────────────────────────
  const byPayer = useMemo(() => {
    const acc: Record<string, { rev: number; cost: number; gp: number; arr: number; count: number }> = {};
    for (const p of filtered) {
      const f = p.financials!;
      if (!acc[p.primaryPayer]) acc[p.primaryPayer] = { rev: 0, cost: 0, gp: 0, arr: 0, count: 0 };
      acc[p.primaryPayer].rev  += f.totalRevenue;
      acc[p.primaryPayer].cost += f.totalCost;
      acc[p.primaryPayer].gp   += f.totalGP;
      acc[p.primaryPayer].arr  += f.arr;
      acc[p.primaryPayer].count += 1;
    }
    return Object.entries(acc).map(([payer, v]) => ({
      payer,
      ...v,
      gpPct: v.rev > 0 ? v.gp / v.rev : 0,
    })).sort((a, b) => b.rev - a.rev);
  }, [filtered]);

  // ─── Sorted patient list ─────────────────────────────────────────────────
  const sortedPatients = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const c = compareBy(a, b, sortKey);
      return sortDir === "asc" ? c : -c;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const gpPct = totals.rev > 0 ? totals.gp / totals.rev : 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, Monday ID"
          />
        </div>
        <Select value={payer} onValueChange={setPayer}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>{PAYER_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All types">All types</SelectItem>
            <SelectItem value="Sensors">Sensors</SelectItem>
            <SelectItem value="Supplies">Supplies</SelectItem>
            <SelectItem value="Sensors & Supplies">Sensors & Supplies</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Topline KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile tone="success" label="Total Revenue (forecasted)"
          value={fmtMoney(totals.rev, true)}
          sub={`${totals.count} patient${totals.count === 1 ? "" : "s"}, avg ${fmtMoney(totals.rev / Math.max(totals.count, 1))}`} />
        <KpiTile tone="danger" label="Total Cost"
          value={fmtMoney(totals.cost, true)}
          sub={`shipping ${fmtMoney(totals.ship, true)}`} />
        <KpiTile tone="info" label="Gross Profit"
          value={fmtMoney(totals.gp, true)}
          sub={`GP margin ${fmtPct(gpPct)}`} />
        <KpiTile tone="success" label="ARR (annualized)"
          value={fmtMoney(totals.arr, true)}
          sub={`profit ${fmtMoney(totals.arp, true)}`} />
        <KpiTile tone="neutral" label="MRR (approx.)"
          value={fmtMoney(totals.arr / 12, true)}
          sub={`per-order avg ${fmtMoney(totals.rev / Math.max(totals.count, 1))}`} />
        <KpiTile tone="neutral" label="Sensors / Supplies split"
          value={`${fmtPct(totals.sensorsRev / Math.max(totals.rev, 1), 0)} / ${fmtPct(totals.suppliesRev / Math.max(totals.rev, 1), 0)}`}
          sub={`${fmtMoney(totals.sensorsRev, true)} / ${fmtMoney(totals.suppliesRev, true)}`} />
      </div>

      {/* Monthly forecast */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[16px] font-semibold">Monthly forecast — next 6 months</h3>
            <p className="text-[12px] text-muted-foreground">
              Bucketed by patient's Next Order Date. Bar shows expected revenue, cost, and gross profit per month.
            </p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" stroke="#64748b" />
            <YAxis tickFormatter={(v) => fmtMoney(v, true)} stroke="#64748b" />
            <Tooltip
              formatter={(value: number, name: string) => [
                name === "Orders" ? value : fmtMoney(value as number),
                name,
              ]}
              labelStyle={{ color: "#0F172A", fontWeight: 600 }}
            />
            <Legend />
            <Bar dataKey="Revenue" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Cost"    fill="#F87171" radius={[4, 4, 0, 0]} />
            <Bar dataKey="GP"      fill="#10B981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Subscription type + top payers side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-3">
            <h3 className="text-[16px] font-semibold">By Subscription Type</h3>
            <p className="text-[12px] text-muted-foreground">Revenue share across Sensors, Supplies, and the bundled subscription.</p>
          </div>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={220}>
              <PieChart>
                <Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                  {byType.map((entry) => (
                    <Cell key={entry.name} fill={SUB_TYPE_COLOR[entry.name as SubscriptionType]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2 text-[13px]">
              {byType.map((row) => (
                <div key={row.name} className="flex items-center justify-between gap-2">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                    SUB_TYPE_PILL[row.name as SubscriptionType])}>{row.name}</span>
                  <div className="text-right tabular-nums">
                    <div className="font-semibold">{fmtMoney(row.value, true)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.count} pt · GP {fmtMoney(row.gp, true)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-3">
            <h3 className="text-[16px] font-semibold">Top Payers by Revenue</h3>
            <p className="text-[12px] text-muted-foreground">Top 10 payers across the cohort with revenue, GP, and margin.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payer</TableHead>
                <TableHead className="text-right">Patients</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">GP</TableHead>
                <TableHead className="text-right">GP %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byPayer.slice(0, 10).map((row) => (
                <TableRow key={row.payer}>
                  <TableCell className="font-medium">{row.payer}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{fmtMoney(row.rev, true)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(row.gp, true)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums",
                    row.gpPct >= 0.4 ? "text-emerald-700 font-semibold"
                    : row.gpPct >= 0.25 ? "text-amber-700"
                    : "text-rose-700 font-semibold")}>
                    {fmtPct(row.gpPct)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Per-patient drill-down */}
      <Card className="p-0 overflow-hidden">
        <div className="px-6 py-4 border-b bg-muted/40">
          <h3 className="text-[16px] font-semibold">Per-Patient Detail</h3>
          <p className="text-[12px] text-muted-foreground">
            {filtered.length} patient{filtered.length === 1 ? "" : "s"} with non-zero financials. Click a column header to sort.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Patient"        sk="name"      cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHead label="Type"           sk="type"      cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHead label="Primary Payer"  sk="payer"     cur={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHead label="Next Order"     sk="nextOrder" cur={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              <SortHead label="Revenue"        sk="revenue"   cur={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              <SortHead label="Cost"           sk="cost"      cur={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              <SortHead label="GP"             sk="gp"        cur={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              <SortHead label="GP %"           sk="gpPct"     cur={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
              <SortHead label="ARR"            sk="arr"       cur={sortKey} dir={sortDir} onClick={toggleSort} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPatients.slice(0, 200).map((p) => {
              const f = p.financials!;
              const pct = f.totalGP / Math.max(f.totalRevenue, 1);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="text-[13px] font-semibold">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", SUB_TYPE_PILL[p.subscriptionType])}>
                      {p.subscriptionType}
                    </span>
                  </TableCell>
                  <TableCell className="text-[13px]">{p.primaryPayer}</TableCell>
                  <TableCell className="text-right tabular-nums text-[13px]">{p.nextOrderDate || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-[13px] font-semibold">{fmtMoney(f.totalRevenue)}</TableCell>
                  <TableCell className="text-right tabular-nums text-[13px]">{fmtMoney(f.totalCost)}</TableCell>
                  <TableCell className="text-right tabular-nums text-[13px]">{fmtMoney(f.totalGP)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums text-[13px]",
                    pct >= 0.4 ? "text-emerald-700 font-semibold"
                    : pct >= 0.25 ? "text-amber-700"
                    : "text-rose-700 font-semibold")}>
                    {fmtPct(pct, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[13px]">{fmtMoney(f.arr, true)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {sortedPatients.length > 200 && (
          <div className="px-6 py-3 text-[11px] text-muted-foreground text-center border-t">
            Showing top 200 of {sortedPatients.length}. Refine filters to narrow further.
          </div>
        )}
      </Card>
    </div>
  );
}

function SortHead({
  label, sk, cur, dir, onClick, align,
}: {
  label: string;
  sk: SortKey;
  cur: SortKey;
  dir: Dir;
  onClick: (k: SortKey) => void;
  align?: "right";
}) {
  const active = cur === sk;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <Button variant="ghost" size="sm" onClick={() => onClick(sk)} className="h-7 px-2 text-[11px] font-bold uppercase tracking-wider gap-1">
        {label}
        {active && (dir === "asc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />)}
      </Button>
    </TableHead>
  );
}
