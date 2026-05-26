// EFT Enrollment tracker — 5th tab on the Claims page.
//
// Reads both Primary and Secondary Claims Boards filtered to rows where
// Payer EFT'd? = "No" (paper-check ERAs needing EFT enrollment). Merged
// into one operator-friendly table grouped by payer.
//
// Layout (per Brandon, 2026-05-26):
//   Compact row shows: chevron | Patient | Type | Payer | Paid | Status |
//                      Submitted | Days
//   Expanded drawer (toggled per row) shows: bank reconciliation details
//                      (check #, deposit, trace, ORIG, BPR EFT date),
//                      Action Context notes, and the three Mark buttons
//                      Submitted / Accepted / Rejected.
//
// Naming note: Monday's underlying labels are "Approved" / "Denied" at
// indices 3 / 4. The UI here displays them as "Accepted" / "Rejected"
// per the operator's preferred vocabulary. The backend action names
// stay as "approved" / "denied" — same semantics, just display swap.
// If Brandon ever wants Monday's column labels to match, rename them
// in Monday UI directly (right-click column → Customize → labels).

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Send, Ban, RefreshCw, Search, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from "lucide-react";
import {
  useEftEnrollmentRows,
  EFT_ENROLLMENT_QUERY_KEY,
  type EftEnrollmentRow,
  type EftEnrollmentStatus,
} from "@/api/eftEnrollment";
import {
  markEftEnrollment,
  isEftEnrollmentMarkConfigured,
  EftEnrollmentMarkError,
  type EftEnrollmentAction,
} from "@/api/eftEnrollmentMark";
import { setActionContextOnBoard } from "@/api/setActionContextBoardAware";

// ── helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function daysBetween(isoFrom: string | null, isoTo: Date): number | null {
  if (!isoFrom) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoFrom);
  if (!m) return null;
  const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(from.getTime())) return null;
  const ms = isoTo.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function StatusPill({ status }: { status: EftEnrollmentStatus }) {
  const label = status ?? "Not Started";
  const tone =
    status === "Accepted"    ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
    status === "Submitted"   ? "bg-amber-100 text-amber-800 border-amber-200" :
    status === "Rejected"    ? "bg-rose-100 text-rose-800 border-rose-200" :
                               "bg-muted text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", tone)}>
      {label}
    </span>
  );
}

interface FilterState {
  search: string;
  status: "all" | "not-started" | "submitted" | "accepted" | "rejected";
  board:  "all" | "primary" | "secondary";
  payer:  "all" | string;
}

const INITIAL_FILTERS: FilterState = {
  search: "",
  status: "all",
  board:  "all",
  payer:  "all",
};

// ── component ──────────────────────────────────────────────────────────────

export function EftEnrollmentTable() {
  const qc = useQueryClient();
  const { data: rows, isLoading, isFetching, refetch, error } = useEftEnrollmentRows();
  const today = useMemo(() => new Date(), []);

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [actionBusy, setActionBusy] = useState<Record<string, EftEnrollmentAction | null>>({});
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const payerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) {
      if (r.payer) set.add(r.payer);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const visible = useMemo(() => {
    const list = (rows ?? []).filter((r) => {
      if (filters.board !== "all" && r.board !== filters.board) return false;
      if (filters.payer !== "all" && r.payer !== filters.payer) return false;
      if (filters.status !== "all") {
        const want =
          filters.status === "not-started" ? "Not Started" :
          filters.status === "submitted"   ? "Submitted"   :
          filters.status === "accepted"    ? "Accepted"    :
                                              "Rejected";
        const have = r.enrollmentStatus ?? "Not Started";
        if (have !== want) return false;
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const blob = [
          r.patientName, r.payer, r.checkNumber, r.bankTraceNumber,
          r.bankPayerOriginatorId, r.notes,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      if (a.payer !== b.payer) return a.payer.localeCompare(b.payer);
      return a.patientName.localeCompare(b.patientName);
    });
    return list;
  }, [rows, filters]);

  const payerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      m.set(r.payer, (m.get(r.payer) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const byStatus = {
      "Not Started": 0, "Submitted": 0, "Accepted": 0, "Rejected": 0,
    } as Record<string, number>;
    for (const r of all) byStatus[r.enrollmentStatus ?? "Not Started"] += 1;
    return {
      total:      all.length,
      notStarted: byStatus["Not Started"],
      submitted:  byStatus["Submitted"],
      accepted:   byStatus["Accepted"],
      rejected:   byStatus["Rejected"],
    };
  }, [rows]);

  async function runAction(row: EftEnrollmentRow, action: EftEnrollmentAction) {
    if (!isEftEnrollmentMarkConfigured()) {
      toast({
        title: "EFT Enrollment isn't configured",
        description: "Set VITE_API_BASE_URL and VITE_ADMIN_API_KEY at build time.",
      });
      return;
    }
    setActionBusy((p) => ({ ...p, [row.itemId]: action }));
    try {
      await markEftEnrollment(row.itemId, row.board, action);
      const verb =
        action === "submitted" ? "Submitted" :
        action === "approved"  ? "Accepted"  :
                                 "Rejected";
      toast({
        title: `${row.patientName} → ${verb}`,
        description:
          action === "submitted" ? "Enrollment submission date stamped." :
          action === "approved"  ? "Marked accepted — row will move to Paid And Closed." :
                                   "Marked rejected — retry with a different contact.",
      });
      await qc.invalidateQueries({ queryKey: EFT_ENROLLMENT_QUERY_KEY });
    } catch (e) {
      const status = e instanceof EftEnrollmentMarkError ? e.status : undefined;
      toast({
        title: `Couldn't update ${row.patientName}`,
        description: (e as Error).message,
        duration: status === 400 ? 12_000 : 6_000,
      });
    } finally {
      setActionBusy((p) => ({ ...p, [row.itemId]: null }));
    }
  }

  async function saveNotes(row: EftEnrollmentRow) {
    const draft = notesDraft[row.itemId];
    if (draft == null) return;
    if (draft === row.notes) return;
    try {
      await setActionContextOnBoard(row.itemId, row.board, draft);
      toast({ title: "Notes saved", description: row.patientName });
      await qc.invalidateQueries({ queryKey: EFT_ENROLLMENT_QUERY_KEY });
    } catch (e) {
      toast({
        title: "Couldn't save notes",
        description: (e as Error).message,
      });
    }
  }

  function toggle(id: string) {
    setExpanded((p) => ({ ...p, [id]: !p[id] }));
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <div>
            <div className="font-medium">Couldn't load EFT enrollment data</div>
            <div className="text-xs text-muted-foreground">{(error as Error).message}</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header tiles — clicking a tile filters the table to that
          bucket. Total clears the status filter; the other four set it
          to the matching label. Active tile is highlighted. */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile
          label="Total"
          value={stats.total}
          tone="default"
          active={filters.status === "all"}
          onClick={() => setFilters((f) => ({ ...f, status: "all" }))}
        />
        <StatTile
          label="Not Started"
          value={stats.notStarted}
          tone="muted"
          active={filters.status === "not-started"}
          onClick={() => setFilters((f) => ({ ...f, status: "not-started" }))}
        />
        <StatTile
          label="Submitted"
          value={stats.submitted}
          tone="amber"
          active={filters.status === "submitted"}
          onClick={() => setFilters((f) => ({ ...f, status: "submitted" }))}
        />
        <StatTile
          label="Accepted"
          value={stats.accepted}
          tone="emerald"
          active={filters.status === "accepted"}
          onClick={() => setFilters((f) => ({ ...f, status: "accepted" }))}
        />
        <StatTile
          label="Rejected"
          value={stats.rejected}
          tone="rose"
          active={filters.status === "rejected"}
          onClick={() => setFilters((f) => ({ ...f, status: "rejected" }))}
        />
      </section>

      {/* Filters */}
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search patient, payer, check#, trace…"
            className="h-8 w-72 pl-8 text-sm"
          />
        </div>
        <Select
          value={filters.status}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, status: v as FilterState["status"] }))
          }
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="not-started">Not Started</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.board}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, board: v as FilterState["board"] }))
          }
        >
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Board" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Both boards</SelectItem>
            <SelectItem value="primary">Primary only</SelectItem>
            <SelectItem value="secondary">Secondary only</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.payer}
          onValueChange={(v) => setFilters((f) => ({ ...f, payer: v }))}
        >
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="Payer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payers</SelectItem>
            {payerOptions.map((p) => (
              <SelectItem key={p} value={p}>{p} ({payerCounts.get(p) ?? 0})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching
              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="min-w-[180px]">Patient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="min-w-[220px]">Payer</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      No rows match the filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((row, idx) => {
                    const prev = idx === 0 ? null : visible[idx - 1];
                    const newPayer = !prev || prev.payer !== row.payer;
                    const days = daysBetween(row.submittedDate, today);
                    const sameCount = payerCounts.get(row.payer) ?? 0;
                    const isOpen = !!expanded[row.itemId];
                    const busy = actionBusy[row.itemId] ?? null;
                    return (
                      <Row
                        key={row.itemId}
                        row={row}
                        newPayer={newPayer}
                        firstOfList={idx === 0}
                        sameCount={sameCount}
                        days={days}
                        isOpen={isOpen}
                        busy={busy}
                        notesDraft={notesDraft[row.itemId]}
                        onToggle={() => toggle(row.itemId)}
                        onAction={(a) => void runAction(row, a)}
                        onNotesChange={(v) =>
                          setNotesDraft((p) => ({ ...p, [row.itemId]: v }))
                        }
                        onNotesBlur={() => void saveNotes(row)}
                      />
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Row + Drawer ───────────────────────────────────────────────────────────

function Row({
  row, newPayer, firstOfList, sameCount, days, isOpen, busy, notesDraft,
  onToggle, onAction, onNotesChange, onNotesBlur,
}: {
  row: EftEnrollmentRow;
  newPayer: boolean;
  firstOfList: boolean;
  sameCount: number;
  days: number | null;
  isOpen: boolean;
  busy: EftEnrollmentAction | null;
  notesDraft: string | undefined;
  onToggle: () => void;
  onAction: (a: EftEnrollmentAction) => void;
  onNotesChange: (v: string) => void;
  onNotesBlur: () => void;
}) {
  return (
    <>
      <TableRow
        className={cn(
          newPayer && !firstOfList && "border-t-4 border-t-border",
          "cursor-pointer hover:bg-muted/30",
        )}
        onClick={onToggle}
      >
        <TableCell className="w-8 pr-0">
          {isOpen
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="font-medium">{row.patientName}</TableCell>
        <TableCell>
          <Badge variant={row.board === "primary" ? "default" : "secondary"}>
            {row.board === "primary" ? "Primary" : "Secondary"}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">{row.payer || "—"}</span>
            {newPayer && sameCount > 1 && (
              <span className="text-[10px] text-muted-foreground">
                {sameCount} rows for this payer
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-xs tabular-nums">{fmtDate(row.paidDate)}</TableCell>
        <TableCell>
          <StatusPill status={row.enrollmentStatus} />
        </TableCell>
        <TableCell className="text-xs tabular-nums">{fmtDate(row.submittedDate)}</TableCell>
        <TableCell className="text-xs tabular-nums">
          {days != null ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn(
                    "cursor-help",
                    days >= 30 && "text-destructive font-medium",
                    days >= 14 && days < 30 && "text-amber-700 font-medium",
                  )}>
                    {days}d
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Days since EFT enrollment was submitted.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : "—"}
        </TableCell>
      </TableRow>
      {isOpen && (
        <TableRow className="bg-muted/10">
          <TableCell />
          <TableCell colSpan={7} className="px-4 py-4">
            <Drawer
              row={row}
              busy={busy}
              notesDraft={notesDraft}
              onAction={onAction}
              onNotesChange={onNotesChange}
              onNotesBlur={onNotesBlur}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Drawer({
  row, busy, notesDraft, onAction, onNotesChange, onNotesBlur,
}: {
  row: EftEnrollmentRow;
  busy: EftEnrollmentAction | null;
  notesDraft: string | undefined;
  onAction: (a: EftEnrollmentAction) => void;
  onNotesChange: (v: string) => void;
  onNotesBlur: () => void;
}) {
  return (
    <div className="space-y-3">
      {/* Bank info — what the operator needs when calling the payer or
          filling out the EFT enrollment form. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <DetailField label="Check #" value={row.checkNumber} mono />
        <DetailField label="Deposit Total" value={fmtMoney(row.bankDepositTotal)} mono />
        <DetailField label="Trace # (TRN)" value={row.bankTraceNumber} mono />
        <DetailField label="Payer Originator ID" value={row.bankPayerOriginatorId} mono />
        <DetailField label="BPR EFT Date" value={fmtDate(row.bankEftDate)} />
      </div>

      {/* Notes — re-uses the existing Action Context column on both
          boards. Saves on blur so the operator can switch rows
          without losing edits. */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Notes
        </div>
        <Textarea
          value={notesDraft ?? row.notes}
          onChange={(e) => onNotesChange(e.target.value)}
          onBlur={onNotesBlur}
          placeholder="Add notes — payer rep name, ref #, retry reason… (saves on blur)"
          className="mt-1 min-h-[80px] text-xs"
        />
      </div>

      {/* Actions. Buttons are Submitted / Accepted / Rejected per
          Brandon's preferred vocabulary. Backend action names stay
          submitted / approved / denied. */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy != null}
          onClick={() => onAction("submitted")}
          className="h-8"
        >
          {busy === "submitted"
            ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            : <Send className="mr-1 h-3.5 w-3.5" />}
          Mark Submitted
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy != null}
          onClick={() => onAction("approved")}
          className="h-8 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
        >
          {busy === "approved"
            ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
          Mark Accepted
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy != null}
          onClick={() => onAction("denied")}
          className="h-8 bg-rose-50 text-rose-800 hover:bg-rose-100"
        >
          {busy === "denied"
            ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            : <Ban className="mr-1 h-3.5 w-3.5" />}
          Mark Rejected
        </Button>
      </div>
    </div>
  );
}

function DetailField({
  label, value, mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-sm", mono && "font-mono")}>
        {value || "—"}
      </div>
    </div>
  );
}

function StatTile({
  label, value, tone, active, onClick,
}: {
  label: string;
  value: number;
  tone: "default" | "muted" | "amber" | "emerald" | "rose";
  active?: boolean;
  onClick?: () => void;
}) {
  const cls =
    tone === "amber"   ? "text-amber-700" :
    tone === "emerald" ? "text-emerald-700" :
    tone === "rose"    ? "text-rose-700" :
    tone === "muted"   ? "text-muted-foreground" :
                         "text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-card p-4 text-left transition-colors",
        onClick && "hover:bg-accent cursor-pointer",
        active && "ring-2 ring-primary",
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", cls)}>{value}</div>
    </button>
  );
}
