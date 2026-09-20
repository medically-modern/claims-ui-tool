/**
 * NewOrders.tsx — the "Order" top tab (New Order Board, 18405457690).
 *
 * Three views (Brandon, 2026-09-20): Order is the daily flow and the default;
 * Returns and Overview are for one-off status checks, so they sit off to the
 * right as small toggles rather than in the main flow.
 *
 * The Order view shows only the Order group and reads as: who + when, the
 * status pills, the plan, and what's being sent — the last split into Sensors
 * and Supplies lines (monitor with sensors; pump/cartridge/infusion with
 * supplies), each carrying its own auth IDs, so a sensors-only, supplies-only,
 * or both order all read the same. Click a row for the rest (OrderDetailSheet).
 */
import { useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, RefreshCw as ReloadIcon, Search } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNewOrders } from "@/hooks/subscription/useNewOrders";
import { ORDER_GROUP_ID, RETURNS_GROUP_ID, type NewOrderRow } from "@/api/queries/newOrders";
import {
  monitorMergeTarget, orderCategories, orderStatusBorder, pillClass, posLabel, preCheckTone,
} from "@/lib/subscription/orderBoard";
import { mergeMonitorIntoSensors } from "@/api/setNewOrder";
import { OrderDetailSheet } from "./OrderDetailSheet";

type OrderView = "order" | "returns" | "overview";

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtQty(s: string) { return s ? s : "—"; }

function Pill({ label, tone }: { label: string; tone: Parameters<typeof pillClass>[0] }) {
  return <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1", pillClass(tone))}>{label}</span>;
}

function FreshnessPill({ isFetching, dataUpdatedAt, onRefresh }: {
  isFetching: boolean; dataUpdatedAt: number; onRefresh: () => void;
}) {
  const ageMs = Date.now() - dataUpdatedAt;
  const ageS  = Math.round(ageMs / 1000);
  const ageM  = Math.round(ageMs / 60_000);
  const label = isFetching ? "Refreshing…"
              : ageS < 30   ? "Updated just now"
              : ageS < 60   ? `Updated ${ageS}s ago`
              : ageM < 60   ? `Updated ${ageM}m ago`
              :               `Updated ${Math.round(ageM / 60)}h ago`;
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isFetching}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
        isFetching ? "bg-blue-50 text-blue-700 border-blue-200"
                   : "bg-muted/40 text-muted-foreground border-border hover:bg-muted",
      )}
      title="Click to refresh now"
    >
      {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <ReloadIcon className="h-3 w-3" />}
      {label}
    </button>
  );
}

const ORDER_GRID = "grid grid-cols-[180px_130px_96px_150px_minmax(140px,0.8fr)_minmax(300px,1.3fr)] gap-3";

const CAT_TAG: Record<string, string> = {
  Sensors:  "bg-sky-100 text-sky-800",
  Supplies: "bg-violet-100 text-violet-800",
  Pump:     "bg-amber-100 text-amber-800",
  Monitor:  "bg-teal-100 text-teal-800",
};

/** One category's line: tag, its items, the yes/no device, and an auth check. */
function CategoryLine({ cat }: { cat: ReturnType<typeof orderCategories>[number] }) {
  const single = cat.category === "Pump" || cat.category === "Monitor";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
      <span className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold", CAT_TAG[cat.category])}>{cat.category}</span>
      {cat.items.length > 0 && (
        <span className="font-medium">{cat.items.map((i) => `${i.name}${i.qty ? ` ${i.qty}` : ""}`).join(" · ")}</span>
      )}
      {/* The device that rides with the category: Monitor (sensors) / Pump
          (supplies). The Pump / Monitor categories are themselves the device,
          so no extra chip there. */}
      {!single && cat.device?.on && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
          + {cat.device.label}
        </span>
      )}
      {cat.auths.length > 0 && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800" title={`Auth on file: ${cat.auths.map((a) => a.label).join(", ")}`}>
          <Check className="h-3 w-3" /> Auth
        </span>
      )}
    </div>
  );
}

/** The daily Order view — the Order group, designed to be read at a glance. */
function OrderList({ rows, onOpen, onMerge, mergingId }: {
  rows: NewOrderRow[]; onOpen: (r: NewOrderRow) => void;
  onMerge: (monitor: NewOrderRow, sensors: NewOrderRow) => void; mergingId: string | null;
}) {
  return (
    <div className="text-[13px] overflow-x-auto">
      <div className={cn(ORDER_GRID, "sticky top-0 z-10 rounded-t-lg border-b border-l-4 border-l-transparent bg-slate-100 px-4 py-3 text-[15px] font-bold tracking-normal text-slate-700 items-end")}>
        <div>Patient</div>
        <div>Pre-Check</div>
        <div>Order Date</div>
        <div>Subscription</div>
        <div>Insurance</div>
        <div>Order</div>
      </div>
      {rows.map((r) => {
        const cats = orderCategories(r);
        const pos = posLabel(r.pos);
        const monitorOnly = cats.some((c) => c.monitorOnly);
        const mergeTarget = monitorOnly ? monitorMergeTarget(r, rows) : null;
        return (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(r)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } }}
            className={cn(ORDER_GRID, "cursor-pointer border-b border-l-4 px-4 py-3 items-center hover:bg-muted/40", orderStatusBorder(r.orderStatus))}
            title={r.orderStatus ? `Order status: ${r.orderStatus}` : undefined}
          >
            <div className="min-w-0">
              <div className="font-semibold truncate">{r.name}</div>
              {r.dob && <div className="text-[11px] text-muted-foreground tabular-nums">DOB {r.dob}</div>}
            </div>
            <div>{r.preCheck
              ? <span title={r.preCheckDetail || undefined}><Pill label={r.preCheck} tone={preCheckTone(r.preCheck)} /></span>
              : <span className="text-[12px] text-muted-foreground">—</span>}</div>
            <div className="tabular-nums">{fmtDate(r.orderDate)}</div>
            <div className="min-w-0 font-medium truncate">{r.subscriptionType || "—"}</div>
            <div className="min-w-0">
              <div className="truncate">{r.primaryInsurance || "—"}</div>
              {pos && <Pill label="Office" tone="amber" />}
            </div>
            <div className="space-y-1">
              {r.shipMethod && (
                <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{r.shipMethod}</span>
              )}
              {cats.length ? cats.map((c) => <CategoryLine key={c.category} cat={c} />)
                : <span className="text-[12px] text-muted-foreground">No products on the order</span>}
              {monitorOnly && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="outline" disabled={!mergeTarget || mergingId === r.id}
                    className="h-7 gap-1.5 border-teal-300 bg-teal-50 text-[12px] text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                    title={mergeTarget ? `Move the monitor qty + auth onto ${mergeTarget.name}'s sensors order and delete this one` : "No sensors order on the board for this patient yet"}
                    onClick={() => mergeTarget && onMerge(r, mergeTarget)}>
                    {mergingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    {mergeTarget ? "Add to sensors order" : "No sensors order yet"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Returns / Overview — flat reference tables, kept simple until we design
 *  them properly (Brandon, 2026-09-20: "let's just focus on Order for now"). */
function FlatTable({ rows, onOpen }: { rows: NewOrderRow[]; onOpen: (r: NewOrderRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>Order Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Subscription</TableHead>
            <TableHead>Primary Insurance</TableHead>
            <TableHead>CAH #</TableHead>
            <TableHead>Carrier</TableHead>
            <TableHead>Shipped</TableHead>
            <TableHead>Delivered</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r)}>
              <TableCell className="font-semibold">{r.name}</TableCell>
              <TableCell className="tabular-nums">{fmtDate(r.orderDate)}</TableCell>
              <TableCell className="text-[12px]">{r.orderStatus || "—"}</TableCell>
              <TableCell className="text-[12px]">{r.subscriptionType || "—"}</TableCell>
              <TableCell className="text-[12px]">{r.primaryInsurance || "—"}</TableCell>
              <TableCell className="text-[12px] tabular-nums">{r.cahOrderNumber || "—"}</TableCell>
              <TableCell className="text-[12px]">{r.carrier || "—"}</TableCell>
              <TableCell className="tabular-nums">{r.shipDate ? fmtDate(r.shipDate) : "—"}</TableCell>
              <TableCell className="tabular-nums">{r.deliveryDate ? fmtDate(r.deliveryDate) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function NewOrders() {
  const { data, loading, isFetching, error, refetch, dataUpdatedAt } = useNewOrders();
  const [view, setView] = useState<OrderView>("order");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<NewOrderRow | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const doMerge = async (monitor: NewOrderRow, sensors: NewOrderRow) => {
    setMergingId(monitor.id);
    try {
      await mergeMonitorIntoSensors({ monitorItemId: monitor.id, sensorsItemId: sensors.id, monitorQty: monitor.qtyCgmMonitor, monitorAuthId: monitor.monitorAuthId });
      toast.success(`Monitor moved to ${sensors.name}'s sensors order`);
      await refetch();
    } catch (e) {
      toast.error("Couldn't move the monitor", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setMergingId(null);
    }
  };

  const returnsCount = useMemo(() => data.filter((r) => r.groupId === RETURNS_GROUP_ID).length, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data;
    if (view === "order") list = list.filter((r) => r.groupId === ORDER_GROUP_ID);
    else if (view === "returns") list = list.filter((r) => r.groupId === RETURNS_GROUP_ID);
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.memberId.toLowerCase().includes(q) || r.id.includes(q));
    // Order: soonest order date first; the others: most recent first.
    return [...list].sort((a, b) => {
      if (!a.orderDate && !b.orderDate) return 0;
      if (!a.orderDate) return 1;
      if (!b.orderDate) return -1;
      return view === "order" ? a.orderDate.localeCompare(b.orderDate) : b.orderDate.localeCompare(a.orderDate);
    });
  }, [data, view, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessPill isFetching={isFetching} dataUpdatedAt={dataUpdatedAt} onRefresh={() => void refetch()} />
        {loading && data.length === 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading orders…
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700" title={error}>
            Failed to load — showing last cached
          </span>
        )}

        {/* Order is the flow; Returns / Overview are reference, off to the right. */}
        <div className="ml-auto inline-flex items-center rounded-lg border bg-card p-0.5 text-[12px] font-semibold">
          {([
            ["order", "Order"],
            ["returns", `Returns${returnsCount ? ` (${returnsCount})` : ""}`],
            ["overview", "Overview"],
          ] as const).map(([v, label]) => {
            const on = view === v;
            return (
              <button key={v} type="button" onClick={() => setView(v)}
                className={cn("rounded-md px-2.5 py-1.5 transition-colors", on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {label}
              </button>
            );
          })}
        </div>

        <div className="relative w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, member ID" className="pl-9" />
        </div>
      </div>

      <Card>
        {view === "order" ? <OrderList rows={rows} onOpen={setDetail} onMerge={(m, se) => void doMerge(m, se)} mergingId={mergingId} /> : <FlatTable rows={rows} onOpen={setDetail} />}
        {rows.length === 0 && !loading && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search ? "No orders match the search."
              : view === "order" ? "Nothing in the Order group right now."
              : view === "returns" ? "No returns."
              : "No orders on the board yet."}
          </div>
        )}
      </Card>

      <OrderDetailSheet row={detail} open={!!detail} onClose={() => setDetail(null)} />
    </div>
  );
}
