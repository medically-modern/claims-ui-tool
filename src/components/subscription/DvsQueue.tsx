/**
 * DvsQueue.tsx — Medicaid Supplies DVS workstation.
 *
 * The "today or earlier" toggle + multi-select + Run DVS bulk button
 * is the 95% workflow: open the tab, click "select all", click Run
 * DVS, then triage anything that doesn't pass.
 *
 * Reads from dvsMock for now — wire to Monday's Subscription Board
 * later. Run DVS writes "Trigger DVS" to color_mm2narpj per selected
 * row; the ePACES Playwright bot watches for that label flip and
 * fires the actual DVS request.
 */

import { useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, Check, CheckCircle2, ChevronDown,
  ChevronRight, FileText, Loader2, Play, RefreshCw, Send, XCircle,
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

import { type DvsPatient, getDvsPatients } from "./dvsMock";

type ToggleMode = "today-or-earlier" | "all";

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

// ─── DVS Status / Claim Status badges ────────────────────────────────────────
function DvsStatusBadge({ s }: { s: string }) {
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const cfg: Record<string, { cls: string; icon: typeof Check }> = {
    "Trigger DVS": { cls: "bg-blue-50 text-blue-700 border-blue-200",          icon: Send },
    "Running":     { cls: "bg-purple-50 text-purple-700 border-purple-200",     icon: Loader2 },
    "Success":     { cls: "bg-emerald-50 text-emerald-700 border-emerald-200",  icon: CheckCircle2 },
    "Failed":      { cls: "bg-red-50 text-red-700 border-red-200",              icon: XCircle },
  };
  const c = cfg[s];
  if (!c) return <span className="text-xs">{s}</span>;
  const Icon = c.icon;
  return (
    <Badge variant="outline" className={c.cls}>
      <Icon className={`mr-1 h-3 w-3 ${s === "Running" ? "animate-spin" : ""}`} />
      {s}
    </Badge>
  );
}

function ClaimStatusBadge({ s }: { s: string }) {
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const cfg: Record<string, string> = {
    "Claim Pending": "bg-slate-50 text-slate-700 border-slate-200",
    "Claim Paid":    "bg-emerald-50 text-emerald-700 border-emerald-200",
    "Claim Denied":  "bg-red-50 text-red-700 border-red-200",
    "Claim Partial": "bg-yellow-50 text-yellow-700 border-yellow-200",
  };
  const cls = cfg[s] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return <Badge variant="outline" className={cls}>{s}</Badge>;
}

// ─── Main component ─────────────────────────────────────────────────────────
export function DvsQueue() {
  const [mode, setMode] = useState<ToggleMode>("today-or-earlier");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const allPatients = useMemo(() => getDvsPatients(), []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allPatients.filter((p) => {
      if (mode === "today-or-earlier" && !isOnOrBeforeToday(p.nextOrderDate)) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allPatients, mode, search]);

  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Per-row Run DVS — writes "Trigger DVS" to color_mm2narpj (mock).
  async function runDvs(p: DvsPatient) {
    setOverrides((o) => ({ ...o, [p.id]: "Trigger DVS" }));
    toast.success(`Run DVS queued: ${p.name}`, {
      description: `Trigger DVS column flipped on Monday. ePACES bot will pick it up.`,
    });
  }

  // Bulk Run DVS — sequential per row (~150ms each) with a progress count.
  // Sequential keeps Monday's rate limit happy and makes failures legible
  // per-row. For real wiring, we'd want a /admin/dvs/bulk-trigger backend
  // route that does the writes server-side and reports back.
  async function runDvsBulk() {
    if (bulkRunning || selected.size === 0) return;
    setBulkRunning(true);
    const ids = Array.from(selected);
    const total = ids.length;
    let done = 0;

    const toastId = toast.loading(`Triggering DVS for ${total} patient${total === 1 ? "" : "s"}…`);
    for (const id of ids) {
      await new Promise((r) => setTimeout(r, 150));
      setOverrides((o) => ({ ...o, [id]: "Trigger DVS" }));
      done += 1;
      toast.loading(`Triggering DVS for ${total} patient${total === 1 ? "" : "s"}… (${done}/${total})`, { id: toastId });
    }
    toast.success(`Triggered DVS for ${total} patient${total === 1 ? "" : "s"}`, {
      id: toastId,
      description: "ePACES bot will work through the queue.",
    });
    setBulkRunning(false);
    setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-purple-50 border-purple-200 text-sm">
        <strong className="text-purple-900">Medicaid Supplies DVS workstation.</strong> NY Medicaid auths happen at order time via DVS through ePACES. Toggle to "Today or earlier", select all, click Run DVS — the ePACES Playwright bot fires the actual requests and writes the result back here. Most pass with Claim Paid; failures land in the retry queue for triage.
      </Card>

      {/* Toggle + filters */}
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
            {visible.length} of {allPatients.length} Medicaid Supplies
          </div>
        </div>

        {/* Bulk action bar — appears when any are selected */}
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
                {bulkRunning ? (
                  <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Running…</>
                ) : (
                  <><Play className="mr-1 h-3.5 w-3.5" /> Run DVS for {selected.size}</>
                )}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Table */}
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
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all visible"
                  />
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
              {visible.map((p) => {
                const effectiveDvs = overrides[p.id] ?? p.dvsStatus;
                const isExpanded = expanded.has(p.id);
                const isSelected = selected.has(p.id);
                return (
                  <>
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => toggleExpanded(p.id)}
                      data-state={isSelected ? "selected" : undefined}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(p.id)}
                          aria-label={`Select ${p.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">{p.phone}</div>
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtDate(p.nextOrderDate)}</TableCell>
                      <TableCell><DvsStatusBadge s={effectiveDvs} /></TableCell>
                      <TableCell><ClaimStatusBadge s={p.claimStatus} /></TableCell>
                      <TableCell className="tabular-nums">
                        {p.claimPaidAmount || <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtDate(p.claimPaidDate)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runDvs(p)}
                          disabled={effectiveDvs === "Running" || effectiveDvs === "Trigger DVS"}
                        >
                          <Play className="mr-1 h-3 w-3" />Run DVS
                        </Button>
                      </TableCell>
                    </TableRow>

                    {/* Drop-down — 9 extra columns from the
                        Auth-Escalation→Partial-Approval-Date range
                        not already in the main table */}
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
