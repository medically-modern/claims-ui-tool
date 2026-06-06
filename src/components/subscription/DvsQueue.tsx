/**
 * DvsQueue.tsx — Medicaid Supplies DVS workstation, wired live.
 *
 * Reads from Subscription Board (board 18407459988) via Monday GraphQL.
 * Per-row + bulk Run DVS write 'Trigger DVS' to color_mm2narpj. Monday
 * automation watches that flip and kicks the ePACES Playwright bot,
 * which writes Running -> Success / Failed / MLTC back to the same
 * column. We poll every 15s ONLY when at least one visible row is
 * in an in-flight state ('Trigger DVS' / 'Running' / 'Retry Queued')
 * so the operator sees the queue evolve without burning Monday API
 * quota when nothing's pending.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, ChevronDown, ChevronRight, Loader2, Play,
  RefreshCw, Send, AlertCircle, XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

import { fetchDvsPatients, type DvsRow } from "@/api/queries/dvsPatients";
import { bulkTriggerDvs, setDvsTrigger } from "@/api/setDvsTrigger";

type ToggleMode = "today-or-earlier" | "all";

const IN_FLIGHT: ReadonlySet<string> = new Set(["Trigger DVS", "Running", "Retry Queued"]);
const POLL_MS = 15_000;

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}
function isOnOrBeforeToday(iso: string): boolean {
  if (!iso) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  return d <= today;
}

// ─── Badges ──────────────────────────────────────────────────────────────────
function DvsStatusBadge({ s }: { s: string }) {
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const cfg: Record<string, { cls: string; icon: typeof CheckCircle2; spin?: boolean }> = {
    "Trigger DVS":   { cls: "bg-blue-50 text-blue-700 border-blue-200",          icon: Send },
    "Running":       { cls: "bg-purple-50 text-purple-700 border-purple-200",    icon: Loader2, spin: true },
    "Success":       { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
    "Failed":        { cls: "bg-red-50 text-red-700 border-red-200",             icon: XCircle },
    "MLTC":          { cls: "bg-orange-50 text-orange-700 border-orange-200",    icon: AlertCircle },
    "Manual Review": { cls: "bg-yellow-50 text-yellow-700 border-yellow-200",    icon: AlertCircle },
    "Retry Queued":  { cls: "bg-sky-50 text-sky-700 border-sky-200",             icon: RefreshCw, spin: true },
  };
  const c = cfg[s];
  if (!c) return <span className="text-xs">{s}</span>;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={c.cls}>
      <Icon className={`mr-1 h-3 w-3 ${c.spin ? "animate-spin" : ""}`} />
      {s === "MLTC" ? "MLTC (denial)" : s}
    </Badge>
  );
}
function ClaimStatusBadge({ s }: { s: string }) {
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const cfg: Record<string, string> = {
    "Payment Incorrect": "bg-yellow-50 text-yellow-700 border-yellow-200",
    "Submit Claims":     "bg-slate-50 text-slate-700 border-slate-200",
    "Claims Running":    "bg-purple-50 text-purple-700 border-purple-200",
    "Claims Paid":       "bg-emerald-50 text-emerald-700 border-emerald-200",
    "Claims Denied":     "bg-red-50 text-red-700 border-red-200",
    "Claims Error":      "bg-red-50 text-red-700 border-red-200",
  };
  return <Badge variant="outline" className={cfg[s] ?? "bg-slate-50 text-slate-700 border-slate-200"}>{s}</Badge>;
}

// ─── Main ────────────────────────────────────────────────────────────────────
export function DvsQueue() {
  const [rows, setRows] = useState<DvsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<ToggleMode>("today-or-earlier");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);

  // ─── Fetch + smart polling ──────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const data = await fetchDvsPatients();
      setRows(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Smart polling: only when at least one row is in an in-flight state.
  // Re-evaluates on every rows change so it cleanly starts after Run DVS
  // and stops once all of those have settled.
  const inFlightCount = useMemo(
    () => rows.filter((r) => IN_FLIGHT.has(r.triggerDvs)).length,
    [rows],
  );
  const pollingActive = inFlightCount > 0;
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pollingActive) {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [pollingActive, refresh]);

  useEffect(() => { setLastClickedIdx(null); }, [mode, search]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((p) => {
      if (mode === "today-or-earlier" && !isOnOrBeforeToday(p.nextOrderDate)) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, mode, search]);

  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) { visibleIds.forEach((id) => next.delete(id)); }
      else             { visibleIds.forEach((id) => next.add(id)); }
      return next;
    });
  }
  function toggleOne(id: string, idx: number, shift: boolean) {
    if (shift && lastClickedIdx !== null && lastClickedIdx !== idx) {
      const from = Math.min(lastClickedIdx, idx);
      const to   = Math.max(lastClickedIdx, idx);
      setSelected((prev) => {
        const next = new Set(prev);
        for (let i = from; i <= to; i++) {
          const rowId = visible[i]?.id;
          if (rowId) next.add(rowId);
        }
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    setLastClickedIdx(idx);
  }
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ─── Run DVS (single) ──────────────────────────────────────────────────
  async function runDvs(p: DvsRow) {
    // Optimistic flip so the badge changes instantly
    setRows((r) => r.map((x) => (x.id === p.id ? { ...x, triggerDvs: "Trigger DVS" } : x)));
    try {
      await setDvsTrigger(p.id);
      toast.success(`Run DVS queued: ${p.name}`);
      // Trigger a refresh shortly to start the polling clock if not already
      void refresh();
    } catch (e) {
      // Roll back optimistic flip
      setRows((r) => r.map((x) => (x.id === p.id ? { ...x, triggerDvs: p.triggerDvs } : x)));
      toast.error(`Couldn't trigger DVS: ${p.name}`, {
        description: (e as Error).message,
        duration: 10_000,
      });
    }
  }

  // ─── Run DVS (bulk, parallel chunks of 10) ─────────────────────────────
  async function runDvsBulk() {
    if (bulkRunning || selected.size === 0) return;
    setBulkRunning(true);
    const ids = Array.from(selected);
    const total = ids.length;
    const toastId = toast.loading(`Triggering DVS for ${total} patient${total === 1 ? "" : "s"}…`);

    // Optimistic flip everything that's about to fire
    setRows((r) => r.map((x) => (selected.has(x.id) ? { ...x, triggerDvs: "Trigger DVS" } : x)));

    try {
      const { successIds, failures } = await bulkTriggerDvs(ids, (done, t) => {
        toast.loading(`Triggering DVS for ${t} patient${t === 1 ? "" : "s"}… (${done}/${t})`, { id: toastId });
      });
      if (failures.length === 0) {
        toast.success(`Triggered DVS for ${successIds.length} patient${successIds.length === 1 ? "" : "s"}`, {
          id: toastId,
          description: "ePACES bot will work through the queue.",
        });
      } else {
        // Roll back the failures' optimistic flips
        const failedSet = new Set(failures.map((f) => f.id));
        setRows((r) => r.map((x) => failedSet.has(x.id)
          ? { ...x, triggerDvs: rows.find((y) => y.id === x.id)?.triggerDvs ?? x.triggerDvs }
          : x,
        ));
        toast.error(`Triggered ${successIds.length}, ${failures.length} failed`, {
          id: toastId,
          description: failures.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join("\n")
            + (failures.length > 3 ? `\n…and ${failures.length - 3} more` : ""),
          duration: 12_000,
        });
      }
    } finally {
      setBulkRunning(false);
      setSelected(new Set());
      void refresh();
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────
  if (loading && rows.length === 0) {
    return (
      <Card className="p-12 text-center">
        <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-muted-foreground" />
        <div className="text-sm text-muted-foreground">Loading Medicaid Supplies patients…</div>
      </Card>
    );
  }
  if (error && rows.length === 0) {
    return (
      <Card className="p-6 border-red-200 bg-red-50">
        <div className="font-semibold text-red-900 mb-1">Couldn't load DVS queue</div>
        <div className="text-sm text-red-800 mb-3">{error}</div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Pill toggle */}
          <div className="inline-flex rounded-md border bg-card p-1">
            <button
              type="button"
              onClick={() => setMode("today-or-earlier")}
              className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                mode === "today-or-earlier"
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Today or earlier
            </button>
            <button
              type="button"
              onClick={() => setMode("all")}
              className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                mode === "all"
                  ? "bg-emerald-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All
            </button>
          </div>

          <div className="flex-1 min-w-[200px]">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient name"
              className="max-w-xs"
            />
          </div>

          <div className="text-xs text-muted-foreground tabular-nums">
            {visible.length} of {rows.length} Medicaid Supplies
          </div>

          {pollingActive && (
            <div className="text-xs text-purple-700 inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Polling every 15s — {inFlightCount} in flight</span>
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2">
            <div className="text-sm text-emerald-900">
              <strong className="tabular-nums">{selected.size}</strong> selected
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={bulkRunning}>
                Clear
              </Button>
              <Button size="sm" onClick={runDvsBulk} disabled={bulkRunning} className="bg-emerald-700 hover:bg-emerald-800 text-white">
                {bulkRunning
                  ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Running…</>
                  : <><Play className="mr-1 h-3.5 w-3.5" /> Run DVS for {selected.size}</>}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {visible.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No Medicaid Supplies patients match the current filters.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[42px]">
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all visible" />
                </TableHead>
                <TableHead className="w-[28px]"></TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>DVS Status</TableHead>
                <TableHead>Claim Status</TableHead>
                <TableHead>Claim Paid Amount</TableHead>
                <TableHead>Claim Paid Date</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p, idx) => {
                const isExpanded = expanded.has(p.id);
                const isSelected = selected.has(p.id);
                const inFlight = IN_FLIGHT.has(p.triggerDvs);
                return (
                  <>
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => toggleExpanded(p.id)}
                      data-state={isSelected ? "selected" : undefined}
                    >
                      <TableCell
                        onClick={(e) => { e.stopPropagation(); toggleOne(p.id, idx, e.shiftKey); }}
                      >
                        <Checkbox checked={isSelected} aria-label={`Select ${p.name}`} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">{p.phone}</div>
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtDate(p.nextOrderDate)}</TableCell>
                      <TableCell><DvsStatusBadge s={p.triggerDvs} /></TableCell>
                      <TableCell><ClaimStatusBadge s={p.claimsStatus} /></TableCell>
                      <TableCell className="tabular-nums">
                        {p.claimPaidAmount || <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtDate(p.claimPaidDate)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="outline" onClick={() => void runDvs(p)} disabled={inFlight}>
                          <Play className="mr-1 h-3 w-3" />Run DVS
                        </Button>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow key={`${p.id}-x`} className="bg-muted/30">
                        <TableCell colSpan={9} className="py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 px-2">
                            <DetailField label="First Denied Date" value={fmtDate(p.firstDeniedDate)} />
                            <DetailField label="Retry Count" value={p.retryCount ? String(p.retryCount) : "—"} />
                            <DetailField label="Last Attempted" value={fmtDate(p.lastAttempted)} />
                            <DetailField label="Retry Next Date" value={fmtDate(p.retryNextDate)} />
                            <DetailField label="Denial Reason" value={p.denialReason || "—"} />
                            <DetailField label="A4232 Claim" value={p.a4232Claim || "—"} />
                            <DetailField label="A4230 Claim" value={p.a4230Claim || "—"} />
                            <DetailField label="Claims Error" value={p.claimsError || "—"} wide />
                            <DetailField label="Claims Denial Reason" value={p.claimsDenialReason || "—"} wide />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function DetailField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 md:col-span-3" : ""}>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5 tabular-nums break-words">{value}</div>
    </div>
  );
}
