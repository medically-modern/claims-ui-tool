/**
 * NewOrders.tsx — table view of items on the New Order Board
 * (Monday board 18405457690). This is the right-most tab inside
 * the Order Cycle workflow nav, labeled "Order".
 *
 * It is the post-Send-Order view: once an operator clicks Send Order
 * on a Subscription Board row, Brandon's automation lands a row here.
 * Surfacing those rows in the same UI keeps the operator from having
 * to bounce to Monday to see "what did the order actually look like."
 */
import { useMemo, useState } from "react";
import { Loader2, RefreshCw as ReloadIcon, Search } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { useNewOrders } from "@/hooks/subscription/useNewOrders";
import type { NewOrderRow } from "@/api/queries/newOrders";

type SortKey =
  | "name" | "orderDate" | "orderStatus" | "primaryInsurance"
  | "subscriptionType" | "cgmType" | "pumpType";

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtQty(s: string) {
  return s ? s : "—";
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

function SortableHead({ label, k, sortKey, sortDir, onClick }: {
  label: string; k: SortKey;
  sortKey: SortKey; sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const arrow  = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={cn(
          "inline-flex items-center hover:text-foreground transition-colors",
          active && "text-foreground",
        )}
      >
        {label}{arrow}
      </button>
    </TableHead>
  );
}

export function NewOrders() {
  const { data, loading, isFetching, error, refetch, dataUpdatedAt } = useNewOrders();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("orderDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "orderDate" ? "desc" : "asc"); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data.filter((r) => {
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.memberId.toLowerCase().includes(q) ||
        r.id.includes(q)
      );
    });
    const sorted = [...list].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? "");
      const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? "");
      if (sortKey === "orderDate") {
        // Empty dates sort to bottom regardless of direction so a
        // missing date can't hide a real one.
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
      }
      return sortDir === "asc"
        ? av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" })
        : bv.localeCompare(av, undefined, { numeric: true, sensitivity: "base" });
    });
    return sorted;
  }, [data, search, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessPill
          isFetching={isFetching}
          dataUpdatedAt={dataUpdatedAt}
          onRefresh={() => void refetch()}
        />
        {loading && data.length === 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading orders…
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700"
                title={error}>
            Failed to load — showing last cached
          </span>
        )}
        <div className="ml-auto relative w-[280px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, member ID, item ID"
            className="pl-9"
          />
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {data.length} orders
        </div>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Patient"          k="name"             sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Order Date"       k="orderDate"        sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Status"           k="orderStatus"      sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Primary Insurance" k="primaryInsurance" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Subscription"     k="subscriptionType" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="CGM"              k="cgmType"          sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <TableHead className="text-right">CGM Qty<br /><span className="text-[10px] font-normal text-muted-foreground">sensor / monitor</span></TableHead>
              <SortableHead label="Pump"             k="pumpType"         sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <TableHead className="text-right">Pump Qty</TableHead>
              <TableHead>Inf Set 1</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Inf Set 2</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Cartridge</TableHead>
              <TableHead className="text-right">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">{r.name}</TableCell>
                <TableCell className="tabular-nums">{fmtDate(r.orderDate)}</TableCell>
                <TableCell className="text-[12px]">{r.orderStatus || "—"}</TableCell>
                <TableCell className="text-[12px]">{r.primaryInsurance || "—"}</TableCell>
                <TableCell className="text-[12px]">{r.subscriptionType || "—"}</TableCell>
                <TableCell className="text-[12px]">{r.cgmType || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(r.qtyCgmSensors)} / {fmtQty(r.qtyCgmMonitor)}</TableCell>
                <TableCell className="text-[12px]">{r.pumpType || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(r.qtyPump)}</TableCell>
                <TableCell className="text-[12px]">{r.infusionSet1Type || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(r.qtyInfusionSet1)}</TableCell>
                <TableCell className="text-[12px]">{r.infusionSet2Type || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(r.qtyInfusionSet2)}</TableCell>
                <TableCell className="text-[12px]">{r.cartridgeType || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(r.qtyCartridge)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 && !loading && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search ? "No orders match the search." : "No orders on the board yet."}
          </div>
        )}
      </Card>
    </div>
  );
}
