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
import { useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, RefreshCw as ReloadIcon, Search, Send } from "lucide-react";

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
import { mergeMonitorIntoSensors, markOrdered } from "@/api/setNewOrder";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const ORDER_GRID = "grid grid-cols-[32px_170px_120px_92px_140px_minmax(120px,0.7fr)_minmax(240px,1.1fr)_104px] gap-3";

const CAT_TAG: Record<string, string> = {
  Sensors:  "bg-sky-100 text-sky-800",
  Supplies: "bg-violet-100 text-violet-800",
  Pump:     "bg-indigo-100 text-indigo-800",
  Monitor:  "bg-teal-100 text-teal-800",
};

/** Ground + signature required — shown as a small "GNDSR" flag on the order. */
const isGndsr = (shipMethod: string) => /gndsr|signature/i.test(shipMethod);

/** One category's line: an optional lead flag, the tag, and its items (type ×qty). */
function CategoryLine({ cat, lead }: { cat: ReturnType<typeof orderCategories>[number]; lead?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
      {lead}
      <span className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold", CAT_TAG[cat.category])}>{cat.category}</span>
      {cat.items.length > 0 && (
        <span className="font-medium">{cat.items.map((i) => `${i.name}${i.qty ? ` ${i.qty}` : ""}`).join(" · ")}</span>
      )}
    </div>
  );
}

/** The daily Order view — the Order group, designed to be read at a glance. */
function OrderList({ rows, onOpen, onMerge, mergingId, selected, onToggle, onToggleAll, allSelectableChecked, sortDir, onSortDate, onOrder, orderingId }: {
  rows: NewOrderRow[]; onOpen: (r: NewOrderRow) => void;
  onMerge: (monitor: NewOrderRow, sensors: NewOrderRow) => void; mergingId: string | null;
  selected: Set<string>; onToggle: (id: string, idx: number, shift: boolean) => void; onToggleAll: () => void;
  allSelectableChecked: boolean; sortDir: "asc" | "desc"; onSortDate: () => void;
  onOrder: (r: NewOrderRow) => void; orderingId: string | null;
}) {
  const canOrder = (r: NewOrderRow) => r.orderStatus.trim() === "Order";
  return (
    <div className="text-[13px] overflow-x-auto">
      <div className={cn(ORDER_GRID, "sticky top-0 z-10 rounded-t-lg border-b border-l-4 border-l-transparent bg-slate-100 px-4 py-3 text-[15px] font-bold tracking-normal text-slate-700 items-end")}>
        <div className="flex items-center"><Checkbox checked={allSelectableChecked} onCheckedChange={onToggleAll} aria-label="Select all orderable" /></div>
        <div>Patient</div>
        <div>Pre-Check</div>
        <button type="button" onClick={onSortDate} className="flex items-center gap-1 text-left hover:text-foreground">Order Date {sortDir === "asc" ? "↑" : "↓"}</button>
        <div>Subscription</div>
        <div>Insurance</div>
        <div>Order</div>
        <div className="text-right pr-1">Actions</div>
      </div>
      {rows.map((r, idx) => {
        const cats = orderCategories(r);
        const pos = posLabel(r.pos);
        const monitorOnly = cats.some((c) => c.monitorOnly);
        const mergeTarget = monitorOnly ? monitorMergeTarget(r, rows) : null;
        const orderable = canOrder(r);
        const isSel = selected.has(r.id);
        return (
          <div
            key={r.id}
            className={cn(ORDER_GRID, "border-b border-l-4 px-4 py-3 items-center", orderStatusBorder(r.orderStatus), isSel && "bg-emerald-50/60")}
            title={r.orderStatus ? `Order status: ${r.orderStatus}` : undefined}
          >
            <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
              {orderable && (
                <Checkbox
                  checked={isSel}
                  onClick={(e) => onToggle(r.id, idx, (e as React.MouseEvent).shiftKey)}
                  aria-label={`Select ${r.name}`}
                />
              )}
            </div>
            <button type="button" onClick={() => onOpen(r)} className="min-w-0 text-left">
              <div className="font-semibold truncate hover:underline">{r.name}</div>
              {r.dob && <div className="text-[11px] text-muted-foreground tabular-nums">DOB {r.dob}</div>}
            </button>
            <div>{r.preCheck
              ? <span title={r.preCheckDetail || undefined}><Pill label={r.preCheck} tone={preCheckTone(r.preCheck)} /></span>
              : <span className="text-[12px] text-muted-foreground">—</span>}</div>
            <div className="tabular-nums">{fmtDate(r.orderDate)}</div>
            <div className="min-w-0 font-medium truncate">{r.subscriptionType || "—"}</div>
            <div className="min-w-0">
              <div className="truncate">{r.primaryInsurance || "—"}</div>
              {pos && <Pill label="Office" tone="amber" />}
            </div>
            <button type="button" onClick={() => onOpen(r)} className="space-y-1 text-left">
              {cats.length ? cats.map((c, ci) => (
                <CategoryLine key={c.category} cat={c}
                  lead={ci === 0 && isGndsr(r.shipMethod)
                    ? <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-slate-200 text-slate-600" title={r.shipMethod}>GNDSR</span>
                    : undefined} />
              ))
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
            </button>
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              {orderable ? (
                <Button size="sm" className="h-8 gap-1.5 bg-[#0f5c47] text-[12px] hover:bg-[#0c4a39]" disabled={orderingId === r.id}
                  onClick={() => onOrder(r)} title="Mark this order as Ordered">
                  {orderingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Order
                </Button>
              ) : (
                <span className="text-[11px] text-muted-foreground">{r.orderStatus}</span>
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

const canOrderRow = (r: NewOrderRow) => r.orderStatus.trim() === "Order";

export function NewOrders() {
  const { data, loading, isFetching, error, refetch, dataUpdatedAt } = useNewOrders();
  const [view, setView] = useState<OrderView>("order");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<NewOrderRow | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [preCheckFilter, setPreCheckFilter] = useState<"all" | "ready">("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orderingId, setOrderingId] = useState<string | null>(null);
  const [bulkOrdering, setBulkOrdering] = useState(false);
  const lastIdx = useRef<number | null>(null);

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
    if (view === "order" && preCheckFilter === "ready") list = list.filter((r) => r.preCheck.trim().toLowerCase().startsWith("good to go"));
    // Order: order date sortable (soonest first by default); the others: most recent first.
    return [...list].sort((a, b) => {
      if (!a.orderDate && !b.orderDate) return 0;
      if (!a.orderDate) return 1;
      if (!b.orderDate) return -1;
      if (view === "order") return sortDir === "asc" ? a.orderDate.localeCompare(b.orderDate) : b.orderDate.localeCompare(a.orderDate);
      return b.orderDate.localeCompare(a.orderDate);
    });
  }, [data, view, search, preCheckFilter, sortDir]);

  const selectable = useMemo(() => rows.filter(canOrderRow), [rows]);
  const allSelectableChecked = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const selectedCount = selectable.filter((r) => selected.has(r.id)).length;

  const onToggle = (id: string, idx: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastIdx.current !== null) {
        const lo = Math.min(lastIdx.current, idx), hi = Math.max(lastIdx.current, idx);
        // Range extends the current selection to the clicked row, orderable only.
        for (let i = lo; i <= hi; i++) { const r = rows[i]; if (r && canOrderRow(r)) next.add(r.id); }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastIdx.current = idx;
  };
  const onToggleAll = () => {
    setSelected((prev) => (selectable.length > 0 && selectable.every((r) => prev.has(r.id)) ? new Set() : new Set(selectable.map((r) => r.id))));
    lastIdx.current = null;
  };
  const clearSel = () => { setSelected(new Set()); lastIdx.current = null; };

  const markOne = async (r: NewOrderRow) => {
    setOrderingId(r.id);
    try {
      await markOrdered(r.id);
      toast.success(`${r.name} marked as Ordered`);
      setSelected((prev) => { const n = new Set(prev); n.delete(r.id); return n; });
      await refetch();
    } catch (e) {
      toast.error("Couldn't mark as Ordered", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setOrderingId(null);
    }
  };
  const markSelected = async () => {
    const ids = selectable.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    setBulkOrdering(true);
    let ok = 0;
    try {
      for (const id of ids) { try { await markOrdered(id); ok++; } catch { /* keep going, report at end */ } }
      if (ok === ids.length) toast.success(`${ok} marked as Ordered`);
      else toast.warning(`${ok} of ${ids.length} marked — ${ids.length - ok} failed`);
      clearSel();
      await refetch();
    } finally {
      setBulkOrdering(false);
    }
  };

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
            ["overview", "Overview"],
            ["returns", `Returns${returnsCount ? ` (${returnsCount})` : ""}`],
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

        {view === "order" && (
          <Select value={preCheckFilter} onValueChange={(v) => setPreCheckFilter(v as "all" | "ready")}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All pre-checks</SelectItem>
              <SelectItem value="ready">Good to Go only</SelectItem>
            </SelectContent>
          </Select>
        )}

        <div className="relative w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, member ID" className="pl-9" />
        </div>
      </div>

      {view === "order" && selectedCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px]">
          <span className="font-semibold text-emerald-900">{selectedCount} selected</span>
          <Button size="sm" className="h-8 gap-1.5 bg-[#0f5c47] text-[12px] hover:bg-[#0c4a39]" disabled={bulkOrdering} onClick={() => void markSelected()}>
            {bulkOrdering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Mark {selectedCount} as Ordered
          </Button>
          <button type="button" onClick={clearSel} className="text-[12px] font-medium text-emerald-800 hover:underline">Clear</button>
        </div>
      )}

      <Card>
        {view === "order"
          ? <OrderList rows={rows} onOpen={setDetail} onMerge={(m, se) => void doMerge(m, se)} mergingId={mergingId}
              selected={selected} onToggle={onToggle} onToggleAll={onToggleAll} allSelectableChecked={allSelectableChecked}
              sortDir={sortDir} onSortDate={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              onOrder={(r) => void markOne(r)} orderingId={orderingId} />
          : <FlatTable rows={rows} onOpen={setDetail} />}
        {rows.length === 0 && !loading && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search ? "No orders match the search."
              : view === "order" ? (preCheckFilter === "ready" ? "No orders are Good to Go right now." : "Nothing in the Order group right now.")
              : view === "returns" ? "No returns."
              : "No orders on the board yet."}
          </div>
        )}
      </Card>

      <OrderDetailSheet row={detail} open={!!detail} onClose={() => setDetail(null)} />
    </div>
  );
}
