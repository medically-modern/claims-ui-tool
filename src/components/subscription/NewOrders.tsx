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
import { ArrowRight, Loader2, RefreshCw as ReloadIcon, Search, Send, SlidersHorizontal } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNewOrders } from "@/hooks/subscription/useNewOrders";
import {
  ACCEPTED_PARTIAL_GROUP_ID, ORDER_GROUP_ID, RETURNS_GROUP_ID, SHIPPED_DELIVERED_GROUP_ID, type NewOrderRow,
} from "@/api/queries/newOrders";
import {
  monitorMergeTarget, orderCategories, orderStatusBorder, pillClass, posLabel, preCheckTone,
} from "@/lib/subscription/orderBoard";
import { mergeMonitorIntoSensors, placeOrder } from "@/api/setNewOrder";
import { orderProductLines, orderProgress, type OrderStage, type ProductLine } from "@/lib/subscription/orderFulfillment";
import { useOpenPatient } from "./patient/openPatient";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { CreateOrderDialog } from "./order/CreateOrderDialog";
import { Plus } from "lucide-react";

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

const ORDER_GRID = "grid grid-cols-[36px_minmax(190px,1fr)_120px_140px_minmax(160px,0.9fr)_minmax(170px,0.9fr)_minmax(300px,1.7fr)_120px] gap-4";

const CAT_TAG: Record<string, string> = {
  Sensors:  "bg-sky-100 text-sky-800",
  Supplies: "bg-violet-100 text-violet-800",
  Pump:     "bg-indigo-100 text-indigo-800",
  Monitor:  "bg-teal-100 text-teal-800",
};

/** Ground + signature required — shown as a small "GNDSR" flag on the order. */
const isGndsr = (shipMethod: string) => /gndsr|signature/i.test(shipMethod);

/** Width of the leading GNDSR gutter, shared by every category line so the
 *  category pills align across lines and rows (GNDSR or not). */
const GNDSR_GUTTER = "w-[52px] shrink-0";

/** One category's line: a fixed-width lead slot (GNDSR on the first line), the
 *  tag, and its items (type ×qty). The lead sits in the SAME items-center row as
 *  the tag pill, so the two pills are always vertically aligned. */
function CategoryLine({ cat, lead }: { cat: ReturnType<typeof orderCategories>[number]; lead?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <div className={GNDSR_GUTTER}>{lead}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={cn("inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold", CAT_TAG[cat.category])}>{cat.category}</span>
        {cat.items.length > 0 && (
          <span className="font-medium">{cat.items.map((i) => `${i.name}${i.qty ? ` ${i.qty}` : ""}`).join(" · ")}</span>
        )}
      </div>
    </div>
  );
}

/** The daily Order view — the Order group, designed to be read at a glance. */
function OrderList({ rows, onOpen, onOpenProfile, onMerge, mergingId, selected, onToggle, onToggleAll, allSelectableChecked, onOrder, orderingId }: {
  rows: NewOrderRow[]; onOpen: (r: NewOrderRow) => void; onOpenProfile: (r: NewOrderRow) => void;
  onMerge: (monitor: NewOrderRow, sensors: NewOrderRow) => void; mergingId: string | null;
  selected: Set<string>; onToggle: (id: string, idx: number, shift: boolean) => void; onToggleAll: () => void;
  allSelectableChecked: boolean;
  onOrder: (r: NewOrderRow) => void; orderingId: string | null;
}) {
  const canOrder = (r: NewOrderRow) => r.orderStatus.trim() === "Order";
  return (
    <div className="text-[13px] overflow-x-auto">
      <div className={cn(ORDER_GRID, "sticky top-0 z-10 rounded-t-lg border-b border-l-4 border-l-transparent bg-slate-100 px-4 py-3 text-[15px] font-bold tracking-normal text-slate-700 items-end")}>
        <div className="flex items-center"><Checkbox checked={allSelectableChecked} onCheckedChange={onToggleAll} aria-label="Select all orderable" /></div>
        <div>Patient</div>
        <div>Order Date</div>
        <div>Pre-Check</div>
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
            <button type="button" onClick={() => onOpenProfile(r)} className="min-w-0 text-left" title="Open the full patient profile">
              <div className="font-semibold truncate hover:underline">{r.name}</div>
              {r.dob && <div className="text-[11px] text-muted-foreground tabular-nums">DOB {r.dob}</div>}
            </button>
            <div className="tabular-nums">{fmtDate(r.orderDate)}</div>
            <div>{r.preCheck
              ? <span title={r.preCheckDetail || undefined}><Pill label={r.preCheck} tone={preCheckTone(r.preCheck)} /></span>
              : <span className="text-[12px] text-muted-foreground">—</span>}</div>
            <div className="min-w-0 font-medium truncate">{r.subscriptionType || "—"}</div>
            <div className="min-w-0">
              <div className="truncate">{r.primaryInsurance || "—"}</div>
              {pos && <Pill label="Office" tone="amber" />}
            </div>
            {/* GNDSR rides in the first category line's lead slot, so it shares
                that pill's items-center row and the two align exactly; every line
                carries the same-width slot, so pills line up down the column. */}
            <button type="button" onClick={() => onOpen(r)} className="min-w-0 space-y-1 text-left">
              {cats.length ? cats.map((c, ci) => (
                <CategoryLine key={c.category} cat={c}
                  lead={ci === 0 && isGndsr(r.shipMethod)
                    ? <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold bg-slate-200 text-slate-600" title={r.shipMethod}>GNDSR</span>
                    : undefined} />
              ))
                : <div className="pl-[60px] text-[12px] text-muted-foreground">No products on the order</div>}
              {monitorOnly && (
                <div className="pl-[60px]" onClick={(e) => e.stopPropagation()}>
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
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-[12px] text-muted-foreground hover:text-foreground"
                onClick={() => onOpen(r)} title="Order details — POS, DDP, edit products">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
              {orderable ? (
                <Button size="sm" className="h-8 gap-1.5 bg-[#0f5c47] text-[12px] hover:bg-[#0c4a39]" disabled={orderingId === r.id}
                  onClick={() => onOrder(r)} title={isGndsr(r.shipMethod) ? "Place this order" : "Place this order"}>
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

/** API Status → a pill tone (same vocabulary as the Pre-Check pill). */
function apiTone(s: string): Parameters<typeof pillClass>[0] {
  const l = s.trim().toLowerCase();
  if (!l) return "slate";
  if (/error|hold|cannot|fail|reject|denied|deleted/.test(l)) return "red";
  if (/deliver|success|accepted/.test(l)) return "green";
  if (/ship/.test(l)) return "blue";
  if (/warning|review|substitution needed|backorder|partial/.test(l)) return "amber";
  return "slate";
}
const numOf = (s: string) => { const n = Number(String(s).replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };

const OVERVIEW_HEADER = "sticky top-0 z-10 rounded-t-lg border-b bg-slate-100 px-4 py-2.5 text-[13px] font-bold tracking-normal text-slate-700 items-end";
// Fixed / content-hugging tracks so the columns pack together left-to-right with
// even gaps (no fr tracks ballooning the middle). Order Details, Shipment Status
// and Courier Status sit close since they belong to the same sub-row; the extra
// width falls off the right edge (Brandon, 2026-09-21).
const OVERVIEW_GRID = "grid grid-cols-[160px_104px_fit-content(280px)_116px_fit-content(300px)_132px] gap-x-5";

/** Title-case a category ("Infusion set" → "Infusion Set"). */
const catLabel = (c: string) => c.replace(/\b\w/g, (m) => m.toUpperCase());

type Tone = Parameters<typeof pillClass>[0];
type ShipRef = NonNullable<ProductLine["ship"]>;
/** A single order-detail row for the Overview: one line item. */
interface OvRow { key: string; cat: string; name: string; status: { label: string; tone: Tone }; ship?: ShipRef }

/** Per-product shipment status. "Swapped" wins so a Cardinal substitution is
 *  always visible; delivery is order-level, so a shipped line reads "Delivered"
 *  once the order has a delivery date. */
function prodStatus(p: ProductLine, delivered: boolean): { label: string; tone: Tone } {
  if (p.substitution) return { label: "Swapped", tone: "amber" };
  if (p.state === "backordered") return { label: "Backordered", tone: "red" };
  if (p.state === "shipped") return delivered ? { label: "Delivered", tone: "green" } : { label: "Shipped", tone: "blue" };
  return { label: "Pending", tone: "slate" };
}

// Orders placed before Cardinal went live, and any DDP order, have no Cardinal
// shipment tracking — they show a single blue "DDP" pill instead of per-product
// shipment statuses (Brandon, 2026-09-21).
const DDP_CUTOVER = "2026-06-30";
const isDdpOrder = (r: NewOrderRow) => /ddp/i.test(r.ddpOrder) || (!!r.orderDate && r.orderDate < DDP_CUTOVER);

/** Order-level shipment bucket, for the Shipment-status filter and sort. Ranked
 *  problems-first so "Shipment status" sort surfaces what needs attention. */
const SHIP_BUCKET: Record<OrderStage, { label: string; rank: number }> = {
  error:       { label: "Error", rank: 0 },
  backordered: { label: "Backordered", rank: 1 },
  partial:     { label: "Partially shipped", rank: 2 },
  accepted:    { label: "Accepted", rank: 3 },
  sent:        { label: "Sent", rank: 4 },
  shipped:     { label: "Shipped", rank: 5 },
  delivered:   { label: "Delivered", rank: 6 },
};
function shipBucket(r: NewOrderRow): { label: string; rank: number } {
  if (isDdpOrder(r)) return { label: "DDP", rank: 8 };
  return SHIP_BUCKET[orderProgress(r.lineItemDetail, r.apiStatus, r.deliveryDate).stage];
}

/** The order's detail rows: one per line item from the Line Item Detail (real
 *  SKU names + shipment), or — before Cardinal writes any detail — one per
 *  ordered category from the board. */
function overviewRows(r: NewOrderRow): OvRow[] {
  const lines = orderProductLines(r.lineItemDetail);
  const delivered = !!r.deliveryDate;
  if (lines.length) {
    return lines.map((p) => ({
      key: p.sku, cat: p.cat, name: `${p.name}${p.qty ? ` ×${p.qty}` : ""}`,
      status: prodStatus(p, delivered), ship: p.ship,
    }));
  }
  return orderCategories(r).map((c, idx) => ({
    key: `c${idx}`, cat: c.category,
    name: c.items.map((it) => `${it.name}${it.qty ? ` ${it.qty}` : ""}`).join(", ") || "—",
    status: { label: "Pending", tone: "slate" },
  }));
}

/**
 * One placed-orders list, one row PER line item. Columns read left→right as:
 * who + when, what the item is, its shipment status, its courier tracking, and
 * the order-level Cardinal status + delivery date (Brandon, 2026-09-21).
 */
function OverviewList({ rows, onOpen }: { rows: NewOrderRow[]; onOpen: (r: NewOrderRow) => void }) {
  return (
    <div className="text-[13px] overflow-x-auto">
      <div className={cn(OVERVIEW_GRID, OVERVIEW_HEADER)}>
        <div>Patient</div><div>Order Date</div><div>Order Details</div><div>Shipment Status</div><div>Courier Status</div><div>Cardinal Status</div>
      </div>
      {rows.map((r) => {
        const detail = overviewRows(r);
        const ddp = isDdpOrder(r);
        const patientCell = (
          <div className="min-w-0"><div className="font-semibold truncate">{r.name}</div>{r.dob && <div className="text-[11px] text-muted-foreground tabular-nums">DOB {r.dob}</div>}</div>
        );
        const dateCell = <div className="tabular-nums whitespace-nowrap">{fmtDate(r.orderDate)}</div>;
        const cardinalCell = (
          <div className="space-y-1">
            {r.apiStatus ? <span title={r.apiMessage || undefined}><Pill label={r.apiStatus} tone={apiTone(r.apiStatus)} /></span> : <span className="text-muted-foreground">—</span>}
            {r.deliveryDate && <div className="text-[11px] tabular-nums text-emerald-700">Delivered {fmtDate(r.deliveryDate)}</div>}
          </div>
        );
        return (
          <div key={r.id} className={cn(OVERVIEW_GRID, "cursor-pointer border-b px-4 py-2.5 gap-y-1.5 items-center hover:bg-muted/40")} onClick={() => onOpen(r)}>
            {detail.map((row, i) => (
              <div key={row.key} className="contents">
                {i === 0 ? patientCell : <div />}
                {i === 0 ? dateCell : <div />}
                {/* Order Details — "Category: Name ×qty", one line */}
                <div className="text-[12px] leading-snug">
                  {row.cat ? <><span className="font-semibold">{catLabel(row.cat)}:</span> {row.name}</> : row.name}
                </div>
                {/* Shipment Status — one blue DDP pill for DDP / pre-cutover orders */}
                <div>{ddp ? (i === 0 ? <Pill label="DDP" tone="blue" /> : null) : <Pill label={row.status.label} tone={row.status.tone} />}</div>
                {/* Courier Status — "Shipped <date>: <tracking>", one line */}
                <div className="text-[12px] whitespace-nowrap">
                  {!ddp && row.ship ? (
                    <>
                      <span className="tabular-nums text-muted-foreground">Shipped {fmtDate(row.ship.date)}: </span>
                      <a href={`https://www.google.com/search?q=${encodeURIComponent(row.ship.tracking)}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">{row.ship.carrier} {row.ship.tracking}</a>
                    </>
                  ) : null}
                </div>
                {i === 0 ? cardinalCell : <div />}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Returns — flat reference table. */
function FlatTable({ rows, onOpen }: { rows: NewOrderRow[]; onOpen: (r: NewOrderRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>Order Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>API Status</TableHead>
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
              <TableCell className="text-[12px]" title={r.apiMessage || undefined}>{r.apiStatus || "—"}</TableCell>
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

// Resolve an Order-board row to its Subscription-board patient so a name click
// opens the same full profile as the Due tab (Brandon, 2026-09-20).
const normNm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const normDb = (v: string) => {
  const s = String(v || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (iso) return iso[1] + iso[2] + iso[3];
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (us) return us[3] + us[1].padStart(2, "0") + us[2].padStart(2, "0");
  return s.replace(/\D/g, "");
};
function findSubId(subs: Array<{ mondayItemId: string; name: string; dob?: string }>, r: { name: string; dob: string }): string | null {
  const nm = normNm(r.name);
  if (!nm) return null;
  const matches = subs.filter((s) => normNm(s.name) === nm);
  if (matches.length <= 1) return matches[0]?.mondayItemId ?? null;
  const db = normDb(r.dob);
  return (matches.find((s) => normDb(s.dob ?? "") === db) ?? matches[0]).mondayItemId;
}

export function NewOrders() {
  const { data, loading, isFetching, error, refetch, dataUpdatedAt } = useNewOrders();
  const [view, setView] = useState<OrderView>("order");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<NewOrderRow | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [preCheckFilter, setPreCheckFilter] = useState<"all" | "ready">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orderingId, setOrderingId] = useState<string | null>(null);
  const [bulkOrdering, setBulkOrdering] = useState(false);
  // Overview is one placed-orders list (both post-send groups), filterable and
  // sortable by shipment status and Cardinal (API) status (Brandon, 2026-09-21).
  const [apiFilter, setApiFilter] = useState("all");
  const [shipFilter, setShipFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"date-desc" | "date-asc" | "name" | "ship" | "cardinal">("date-desc");
  const [createOpen, setCreateOpen] = useState(false);
  const lastIdx = useRef<number | null>(null);

  // A name click opens the full patient profile (same page as the Due tab); if
  // no matching subscription patient is found, fall back to the order panel.
  const { open: openProfile } = useOpenPatient();
  const subs = useSubscriptionPatients();
  const openProfileFor = (r: NewOrderRow) => {
    const id = findSubId(subs.data ?? [], { name: r.name, dob: r.dob });
    if (id) openProfile(id); else setDetail(r);
  };

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
  const overviewCount = useMemo(() => data.filter((r) => r.groupId === ACCEPTED_PARTIAL_GROUP_ID || r.groupId === SHIPPED_DELIVERED_GROUP_ID).length, [data]);
  // The status values actually present in the placed-orders universe.
  const isPlaced = (r: NewOrderRow) => r.groupId === ACCEPTED_PARTIAL_GROUP_ID || r.groupId === SHIPPED_DELIVERED_GROUP_ID;
  const apiStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) if (isPlaced(r) && r.apiStatus.trim()) set.add(r.apiStatus.trim());
    return [...set].sort();
  }, [data]);
  // Shipment-status buckets present, ordered by their rank (problems first).
  const shipStatuses = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of data) if (isPlaced(r)) { const b = shipBucket(r); seen.set(b.label, b.rank); }
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data;
    if (view === "order") list = list.filter((r) => r.groupId === ORDER_GROUP_ID);
    else if (view === "returns") list = list.filter((r) => r.groupId === RETURNS_GROUP_ID);
    else if (view === "overview") {
      list = list.filter(isPlaced);
      if (apiFilter !== "all") list = list.filter((r) => r.apiStatus.trim() === apiFilter);
      if (shipFilter !== "all") list = list.filter((r) => shipBucket(r).label === shipFilter);
    }
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.memberId.toLowerCase().includes(q) || r.id.includes(q));
    if (view === "order" && preCheckFilter === "ready") list = list.filter((r) => r.preCheck.trim().toLowerCase().startsWith("good to go"));
    const byDate = (a: NewOrderRow, b: NewOrderRow, dir: 1 | -1) => {
      if (!a.orderDate && !b.orderDate) return 0;
      if (!a.orderDate) return 1;
      if (!b.orderDate) return -1;
      return dir * a.orderDate.localeCompare(b.orderDate);
    };
    // Order view is always earliest-first; Overview honors the sort control.
    if (view === "order") return [...list].sort((a, b) => byDate(a, b, 1));
    if (view !== "overview") return [...list].sort((a, b) => byDate(a, b, -1));
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "date-asc":  return byDate(a, b, 1);
        case "name":      return a.name.localeCompare(b.name);
        case "ship":      return shipBucket(a).rank - shipBucket(b).rank || byDate(a, b, -1);
        case "cardinal":  return a.apiStatus.trim().localeCompare(b.apiStatus.trim()) || byDate(a, b, -1);
        default:          return byDate(a, b, -1);
      }
    });
  }, [data, view, search, preCheckFilter, apiFilter, shipFilter, sortKey]);

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

  const isDdp = (r: NewOrderRow) => /ddp/i.test(r.ddpOrder);
  const markOne = async (r: NewOrderRow) => {
    setOrderingId(r.id);
    const ddp = isDdp(r);
    try {
      await placeOrder(r.id, { ddp });
      toast.success(`${r.name} → ${ddp ? "Process Claim (submit via DDP)" : "Ordered"}`);
      setSelected((prev) => { const n = new Set(prev); n.delete(r.id); return n; });
      await refetch();
    } catch (e) {
      toast.error("Couldn't place the order", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setOrderingId(null);
    }
  };
  const markSelected = async () => {
    const chosen = selectable.filter((r) => selected.has(r.id));
    if (!chosen.length) return;
    setBulkOrdering(true);
    let ok = 0;
    try {
      // Per row: DDP → Process Claim, everything else → Ordered.
      for (const r of chosen) { try { await placeOrder(r.id, { ddp: isDdp(r) }); ok++; } catch { /* keep going, report at end */ } }
      if (ok === chosen.length) toast.success(`${ok} order${ok === 1 ? "" : "s"} placed`);
      else toast.warning(`${ok} of ${chosen.length} placed — ${chosen.length - ok} failed`);
      clearSel();
      await refetch();
    } finally {
      setBulkOrdering(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Order / Overview / Returns — on the left, ahead of the table (Brandon, 2026-09-20). */}
        <div className="inline-flex items-center rounded-lg border bg-card p-0.5 text-[12px] font-semibold">
          {([
            ["order", "Order"],
            ["overview", `Overview${overviewCount ? ` (${overviewCount})` : ""}`],
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

        {view === "order" && (
          <Select value={preCheckFilter} onValueChange={(v) => setPreCheckFilter(v as "all" | "ready")}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All pre-checks</SelectItem>
              <SelectItem value="ready">Good to Go only</SelectItem>
            </SelectContent>
          </Select>
        )}

        {view === "overview" && (
          <>
            <Select value={shipFilter} onValueChange={setShipFilter}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All shipment statuses</SelectItem>
                {shipStatuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={apiFilter} onValueChange={setApiFilter}>
              <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cardinal statuses</SelectItem>
                {apiStatuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="date-desc">Newest first</SelectItem>
                <SelectItem value="date-asc">Oldest first</SelectItem>
                <SelectItem value="name">Patient A–Z</SelectItem>
                <SelectItem value="ship">Shipment status</SelectItem>
                <SelectItem value="cardinal">Cardinal status</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9 gap-1.5 text-[12px]" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New order
            </Button>
          </>
        )}

        <div className="relative ml-auto w-[240px]">
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
          ? <OrderList rows={rows} onOpen={setDetail} onOpenProfile={openProfileFor} onMerge={(m, se) => void doMerge(m, se)} mergingId={mergingId}
              selected={selected} onToggle={onToggle} onToggleAll={onToggleAll} allSelectableChecked={allSelectableChecked}
              onOrder={(r) => void markOne(r)} orderingId={orderingId} />
          : view === "overview"
          ? <OverviewList rows={rows} onOpen={setDetail} />
          : <FlatTable rows={rows} onOpen={setDetail} />}
        {rows.length === 0 && !loading && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search ? "No orders match the search."
              : view === "order" ? (preCheckFilter === "ready" ? "No orders are Good to Go right now." : "Nothing in the Order group right now.")
              : view === "returns" ? "No returns."
              : view === "overview" ? (shipFilter !== "all" || apiFilter !== "all" ? "No orders match those filters." : "No placed orders yet.")
              : "No orders on the board yet."}
          </div>
        )}
      </Card>

      <OrderDetailSheet row={detail} open={!!detail} onClose={() => setDetail(null)} onChanged={() => void refetch()} />
      <CreateOrderDialog open={createOpen} onClose={() => setCreateOpen(false)} rows={data}
        onCreated={() => { setView("order"); void refetch(); }} />
    </div>
  );
}
