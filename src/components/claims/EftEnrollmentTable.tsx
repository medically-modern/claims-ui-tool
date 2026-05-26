// EFT Enrollment tracker — the 5th top-level tab on the Claims page.
//
// Reads both Primary and Secondary Claims Boards filtered to rows where
// Payer EFT'd? = "No" (i.e. paper-check ERAs the operator still needs
// to enroll in EFT). Combined into one operator-friendly table grouped
// by payer so high-volume payers stack together.
//
// Per-row actions:
//   Mark Submitted -> POST /admin/eft-enrollment/mark action=submitted
//                     stamps EFT Submitted Date + status=Submitted
//   Mark Approved  -> action=approved
//                     status=Approved + Payer EFT'd?=Yes
//                     (the /monday/eftd-flipped webhook then auto-moves
//                      the row to Paid And Closed, so it falls off this
//                      tracker on next refetch)
//   Mark Denied    -> action=denied
//                     status=Denied; row stays in tracker for retry
//
// Inline notes editor saves to the existing Action Context column
// (text_mm29v2ph) shared with the claim's other workflow notes.

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
  const cfg =
    status === "Approved"   ? { tone: "bg-emerald-100 text-emerald-800 border-emerald-200", label: "Approved" } :
    status === "Submitted"  ? { tone: "bg-amber-100 text-amber-800 border-amber-200",       label: "Submitted" } :
    status === "Denied"     ? { tone: "bg-rose-100 text-rose-800 border-rose-200",          label: "Denied" } :
    status === "Not Started"? { tone: "bg-muted text-muted-foreground border-border",       label: "Not Started" } :
                              { tone: "bg-muted text-muted-foreground border-border",       label: "—" };
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", cfg.tone)}>
      {cfg.label}
    </span>
  );
}

interface FilterState {
  search: string;
  status: "all" | "not-started" | "submitted" | "approved" | "denied";
  board:  "all" | "primary" | "secondary";
  payer:  "all" | string;
}

const INITIAL_FILTERS: FilterState = {
  search: "",
  status: "all",
  board:  "all",
  payer:  "all",
};

export function EftEnrollmentTable() {
  const qc = useQueryClient();
  const { data: rows, isLoading, isFetching, refetch, error } = useEftEnrollmentRows();
  const today = useMemo(() => new Date(), []);

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [actionBusy, setActionBusy] = useState<Record<string, EftEnrollmentAction | null>>({});
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  // Distinct payer list for the filter dropdown.
  const payerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) {
      if (r.payer) set.add(r.payer);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Filter pipeline.
  const visible = useMemo(() => {
    const list = (rows ?? []).filter((r) => {
      if (filters.board !== "all" && r.board !== filters.board) return false;
      if (filters.payer !== "all" && r.payer !== filters.payer) return false;
      if (filters.status !== "all") {
        const want =
          filters.status === "not-started" ? "Not Started" :
          filters.status === "submitted"   ? "Submitted"   :
          filters.status === "approved"    ? "Approved"    :
                                              "Denied";
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
    // Group by payer, then by patient within a payer for stable ordering.
    list.sort((a, b) => {
      if (a.payer !== b.payer) return a.payer.localeCompare(b.payer);
      return a.patientName.localeCompare(b.patientName);
    });
    return list;
  }, [rows, filters]);

  // Same-payer counts surfaced as a small badge so the operator can see
  // "this payer has N rows waiting, prioritize."
  const payerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      m.set(r.payer, (m.get(r.payer) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  // Stats above the table.
  const stats = useMemo(() => {
    const all = rows ?? [];
    const byStatus = {
      "Not Started": 0, "Submitted": 0, "Approved": 0, "Denied": 0,
    } as Record<string, number>;
    for (const r of all) byStatus[r.enrollmentStatus ?? "Not Started"] += 1;
    return {
      total:      all.length,
      notStarted: byStatus["Not Started"],
      submitted:  byStatus["Submitted"],
      approved:   byStatus["Approved"],
      denied:     byStatus["Denied"],
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
      toast({
        title: `${row.patientName} → ${action[0].toUpperCase()}${action.slice(1)}`,
        description:
          action === "submitted" ? "Enrollment submission date stamped." :
          action === "approved"  ? "Marked approved — row will move to Paid And Closed." :
                                   "Marked denied — try again with a different contact.",
      });
      await qc.invalidateQueries({ queryKey: EFT_ENROLLMENT_QUERY_KEY });
    } catch (e) {
      const status = e instanceof EftEnrollmentMarkError ? e.status : undefined;
      toast({
        title: `Couldn't ${action} ${row.patientName}`,
        description: (e as Error).message,
        // 400 = operator-fixable; surface the backend detail
        duration: status === 400 ? 12_000 : 6_000,
      });
    } finally {
      setActionBusy((p) => ({ ...p, [row.itemId]: null }));
    }
  }

  async function saveNotes(row: EftEnrollmentRow) {
    const draft = notesDraft[row.itemId];
    if (draft == null) return; // never edited
    if (draft === row.notes) return; // no change
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
      {/* Header tiles */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Total" value={stats.total} tone="default" />
        <StatTile label="Not Started" value={stats.notStarted} tone="muted" />
        <StatTile label="Submitted" value={stats.submitted} tone="amber" />
        <StatTile label="Approved" value={stats.approved} tone="emerald" />
        <StatTile label="Denied" value={stats.denied} tone="rose" />
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
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
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
                  <TableHead className="min-w-[180px]">Patient</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="min-w-[180px]">Payer</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Check #</TableHead>
                  <TableHead className="text-right">Deposit</TableHead>
                  <TableHead>Trace # / Originator</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead className="min-w-[220px]">Notes</TableHead>
                  <TableHead className="min-w-[260px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                      No rows match the filters. Either you've enrolled every payer, or
                      adjust the filters above.
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((row, idx) => {
                    const prev = idx === 0 ? null : visible[idx - 1];
                    const newPayer = !prev || prev.payer !== row.payer;
                    const days = daysBetween(row.submittedDate, today);
                    const sameCount = payerCounts.get(row.payer) ?? 0;
                    const busy = actionBusy[row.itemId] ?? null;
                    const noteValue = notesDraft[row.itemId] ?? row.notes;
                    return (
                      <TableRow
                        key={row.itemId}
                        className={cn(newPayer && idx > 0 && "border-t-4 border-t-border")}
                      >
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
                        <TableCell className="font-mono text-xs">{row.checkNumber || "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {fmtMoney(row.bankDepositTotal)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5 font-mono text-[10px] leading-tight">
                            {row.bankTraceNumber && <span>TRN {row.bankTraceNumber}</span>}
                            {row.bankPayerOriginatorId && <span>ORIG {row.bankPayerOriginatorId}</span>}
                            {!row.bankTraceNumber && !row.bankPayerOriginatorId && <span>—</span>}
                          </div>
                        </TableCell>
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
                        <TableCell>
                          <Textarea
                            value={noteValue}
                            onChange={(e) =>
                              setNotesDraft((p) => ({ ...p, [row.itemId]: e.target.value }))
                            }
                            onBlur={() => void saveNotes(row)}
                            placeholder="Notes (saves on blur)"
                            className="min-h-[60px] text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy != null}
                              onClick={() => void runAction(row, "submitted")}
                              className="h-7 text-xs"
                            >
                              {busy === "submitted"
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <Send className="mr-1 h-3 w-3" />}
                              Submitted
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy != null}
                              onClick={() => void runAction(row, "approved")}
                              className="h-7 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-xs"
                            >
                              {busy === "approved"
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <CheckCircle2 className="mr-1 h-3 w-3" />}
                              Approved
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy != null}
                              onClick={() => void runAction(row, "denied")}
                              className="h-7 bg-rose-50 text-rose-800 hover:bg-rose-100 text-xs"
                            >
                              {busy === "denied"
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <Ban className="mr-1 h-3 w-3" />}
                              Denied
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
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

function StatTile({
  label, value, tone,
}: {
  label: string;
  value: number;
  tone: "default" | "muted" | "amber" | "emerald" | "rose";
}) {
  const cls =
    tone === "amber"   ? "text-amber-700" :
    tone === "emerald" ? "text-emerald-700" :
    tone === "rose"    ? "text-rose-700" :
    tone === "muted"   ? "text-muted-foreground" :
                         "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", cls)}>{value}</div>
      </CardContent>
    </Card>
  );
}
