import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  HoverCard, HoverCardContent, HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Search, Plus, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown,
  ChevronLeft, ChevronRight as ChevronRightIcon, ExternalLink,
} from "lucide-react";
import { UNIQUE_COMBOS, type UniqueCombo } from "@/lib/claims/uniqueCombos";
import {
  usePlaybookCombos,
  PLAYBOOK_COMBOS_QUERY_KEY,
} from "@/hooks/usePlaybookCombos";
import {
  verifyPlaybookCombo,
  startRefreshPlaybook,
  fetchRefreshPlaybookStatus,
  isRefreshSummary,
  isPlaybookApiConfigured,
} from "@/api/playbook";
import {
  DRIVE_ERA_FOLDER_URL,
  DENIAL_PLAYBOOK_SHEET_URL,
} from "@/lib/claims/playbookConfig";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ColKey = keyof UniqueCombo;
type ColDef = {
  key: ColKey;
  label: string;
  width?: string;
  align?: "right";
  className?: string;
  numeric?: boolean;
  filterable?: boolean;
};

const CORE_COLUMNS: ColDef[] = [
  { key: "CARC Code(s)", label: "CARC", width: "w-24", filterable: true },
  { key: "RARC Code(s)", label: "RARC", width: "w-24", filterable: true },
  { key: "CARC Remarks", label: "CARC Remarks", className: "min-w-[260px]", filterable: true },
  { key: "RARC Remarks", label: "RARC Remarks", className: "min-w-[260px]", filterable: true },
  { key: "Denial Analysis", label: "Denial Analysis", className: "min-w-[220px]", filterable: true },
  { key: "Verified: Denial Analysis", label: "Verified", width: "w-28", filterable: true },
  { key: "Count", label: "Count", align: "right", width: "w-24", numeric: true },
];

const EXTRA_COLUMNS: ColDef[] = [
  { key: "# Distinct Payers", label: "# Payers", align: "right", width: "w-24", numeric: true },
  { key: "# Distinct HCPCs", label: "# HCPCs", align: "right", width: "w-24", numeric: true },
  { key: "Payers (all)", label: "Payers (all)", className: "min-w-[220px]", filterable: true },
  { key: "HCPCs (all)", label: "HCPCs (all)", className: "min-w-[180px]", filterable: true },
  { key: "Example Patient", label: "Ex. Patient", className: "min-w-[160px]", filterable: true },
  { key: "Example Payer", label: "Ex. Payer", className: "min-w-[160px]", filterable: true },
  { key: "Example HCPC", label: "Ex. HCPC", width: "w-28", filterable: true },
  { key: "Example Check / Trace #", label: "Ex. Check / Trace #", className: "min-w-[180px]", filterable: true },
  { key: "Example ERA File", label: "Ex. ERA File", className: "min-w-[260px]", filterable: true },
  { key: "Notes (classifier)", label: "Notes", className: "min-w-[200px]", filterable: true },
];

function fmtCell(val: UniqueCombo[ColKey]): string {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "—";
    return Number.isInteger(val) ? String(val) : val.toFixed(0);
  }
  const s = String(val).trim();
  if (!s || s.toLowerCase() === "nan" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return "—";
  return s;
}

const VERIFIED_OPTIONS = ["Yes", "No"] as const;
const PAGE_SIZE_OPTIONS = [15, 25, 50, 100, "all"] as const;
type PageSize = typeof PAGE_SIZE_OPTIONS[number];

export function DenialAnalysisTable() {
  const [search, setSearch] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [carcFilter, setCarcFilter] = useState<string>("all");
  const [rarcFilter, setRarcFilter] = useState<string>("all");
  const [analysisFilter, setAnalysisFilter] = useState<string>("all");
  const [verifiedFilter, setVerifiedFilter] = useState<"all" | "yes" | "no">("all");
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" } | null>({
    key: "Count", dir: "desc",
  });
  const [pageSize, setPageSize] = useState<PageSize>(15);
  const [page, setPage] = useState(0);

  // Editable per-row state.
  // analysisByRow / verifiedByRow hold the operator's pending value
  // for each row. After a successful save these get persisted to the
  // backend Sheet via /admin/playbook/verify-combo, and the React
  // Query cache for PLAYBOOK_COMBOS_QUERY_KEY is invalidated so the
  // table re-fetches the live data on the next render.
  const [analysisByRow, setAnalysisByRow] = useState<Record<number, string>>({});
  const [verifiedByRow, setVerifiedByRow] = useState<Record<number, string>>({});
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [playbookSyncBusy, setPlaybookSyncBusy] = useState(false);
  const queryClient = useQueryClient();

  /**
   * Sync Playbook — fires the backend's refresh-playbook cycle and
   * polls for completion. Same fire-and-poll flow that lived on
   * ClaimDetail; lifted here because the Denial Analysis Playbook
   * page is the right home for it (workbook-level operation, not
   * patient-specific). First-run backfills can take 10+ minutes,
   * so we poll /admin/refresh-playbook-status rather than blocking
   * on ?wait=true.
   */
  async function triggerPlaybookSync() {
    if (!isPlaybookApiConfigured()) {
      toast.error(
        "Playbook API not configured (missing VITE_API_BASE_URL or VITE_ADMIN_API_KEY).",
      );
      return;
    }

    const POLL_INTERVAL_MS = 5_000;
    const MAX_POLL_MS = 15 * 60 * 1000;
    let baseline: string | null = null;
    try {
      const pre = await fetchRefreshPlaybookStatus();
      if (isRefreshSummary(pre)) baseline = pre.started_at;
    } catch {
      // ignore — kick off anyway
    }

    setPlaybookSyncBusy(true);
    try {
      await startRefreshPlaybook();
      toast.message("Playbook sync started.", {
        description:
          "Pulling new ERAs from Stedi, archiving to Drive, " +
          "appending new combos to the sheet. Watching for completion…",
      });
    } catch (e) {
      setPlaybookSyncBusy(false);
      toast.error("Couldn't start playbook sync.", {
        description: (e as Error).message,
      });
      return;
    }

    const startedAt = Date.now();
    const tick = async () => {
      try {
        const status = await fetchRefreshPlaybookStatus();
        if (
          isRefreshSummary(status) &&
          status.ended_at &&
          (!baseline || status.started_at > baseline)
        ) {
          if (status.error) {
            toast.error("Playbook sync finished with an error.", {
              description: status.error,
            });
          } else {
            toast.success("Playbook synced.", {
              description:
                `${status.transactions_processed} new ERA(s), ` +
                `${status.combos_new} new combo(s), ` +
                `${status.drive_uploads} Drive upload(s).`,
            });
          }
          void queryClient.invalidateQueries({
            queryKey: PLAYBOOK_COMBOS_QUERY_KEY,
          });
          setPlaybookSyncBusy(false);
          return;
        }
      } catch {
        // transient hiccup; keep polling
      }
      if (Date.now() - startedAt >= MAX_POLL_MS) {
        toast.message("Playbook sync still running.", {
          description:
            "Hit the 15-minute UI watch limit. The job continues " +
            "server-side — check Railway logs for [REFRESH] entries.",
        });
        setPlaybookSyncBusy(false);
        return;
      }
      window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
    };
    window.setTimeout(() => void tick(), POLL_INTERVAL_MS);
  }

  /**
   * Persist a row's Denial Analysis + Verified state to the Sheet.
   *
   *   newAnalysis = ""   →  Verified column cleared (verified_analysis="")
   *   newAnalysis = "X"  →  Sheet row gets Verified: Denial Analysis = X
   *
   * The backend's force_refresh runs inline as part of the same call
   * so the next ERA hitting this combo (or this table on next reload)
   * sees the new state without waiting for the hourly cron.
   *
   * On failure we toast the error and revert the local override so
   * the UI doesn't show a value that didn't actually persist.
   */
  async function persistRow(
    rowIndex: number,
    row: UniqueCombo,
    newAnalysis: string,
  ) {
    if (!isPlaybookApiConfigured()) {
      toast.error(
        "Playbook API not configured (VITE_API_BASE_URL or VITE_ADMIN_API_KEY missing).",
      );
      return;
    }
    const carc = String(row["CARC Code(s)"] ?? "").trim();
    const rarc = String(row["RARC Code(s)"] ?? "").trim();
    if (!carc && !rarc) {
      toast.error("Can't save: row has no CARC or RARC.");
      return;
    }
    setSavingRow(rowIndex);
    try {
      await verifyPlaybookCombo({
        carc,
        rarc,
        verifiedAnalysis: newAnalysis,
      });
      // Bust the live-playbook cache so this table + ClaimDetail
      // pickers + remark chips all re-fetch and see the new bucket.
      void queryClient.invalidateQueries({ queryKey: PLAYBOOK_COMBOS_QUERY_KEY });
      if (newAnalysis) {
        toast.success(`Saved: ${newAnalysis}`, {
          description: `${carc || "—"} / ${rarc || "—"}`,
        });
      } else {
        toast.success("Cleared verification.", {
          description: `${carc || "—"} / ${rarc || "—"}`,
        });
      }
    } catch (e) {
      toast.error("Couldn't save to the Playbook sheet.", {
        description: (e as Error).message,
      });
      // Revert the local override on failure so the UI matches the
      // sheet truth instead of showing a value we couldn't persist.
      setAnalysisByRow((p) => {
        const next = { ...p };
        delete next[rowIndex];
        return next;
      });
      setVerifiedByRow((p) => {
        const next = { ...p };
        delete next[rowIndex];
        return next;
      });
    } finally {
      setSavingRow(null);
    }
  }

  // Live playbook from /admin/playbook/combos. Falls back to the
  // bundled UNIQUE_COMBOS snapshot when the API isn't configured or
  // before the first fetch lands. Every UNIQUE_COMBOS reference in
  // this component now reads from combosSource so verifying a combo
  // in ClaimDetail flows through to this table on the next query
  // revalidation (the verify-save call in ClaimDetail invalidates
  // PLAYBOOK_COMBOS_QUERY_KEY explicitly so it's immediate).
  const { data: livePlaybook } = usePlaybookCombos();
  const combosSource: UniqueCombo[] = useMemo(
    () => ((livePlaybook?.rows as UniqueCombo[] | undefined) ?? UNIQUE_COMBOS),
    [livePlaybook],
  );

  const baseOptions = useMemo(() => {
    const set = new Set<string>();
    combosSource.forEach((r) => {
      const v = String(r["Denial Analysis"] ?? "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [combosSource]);
  const [customOptions, setCustomOptions] = useState<string[]>([]);
  const allOptions = useMemo(
    () => Array.from(new Set([...baseOptions, ...customOptions])).sort(),
    [baseOptions, customOptions],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [newOption, setNewOption] = useState("");

  const COLUMNS = useMemo(
    () => (showExtra ? [...CORE_COLUMNS, ...EXTRA_COLUMNS] : CORE_COLUMNS),
    [showExtra],
  );

  const stats = useMemo(() => {
    const total = combosSource.length;
    const verified = combosSource.filter(
      (r, i) =>
        (verifiedByRow[i] ?? String(r["Verified: Denial Analysis"] ?? "")).toLowerCase() === "yes",
    ).length;
    const totalCount = combosSource.reduce((s, r) => s + (Number(r.Count) || 0), 0);
    return { total, verified, unverified: total - verified, totalCount };
  }, [combosSource, verifiedByRow]);

  const rowEffective = (i: number, key: ColKey, raw: UniqueCombo[ColKey]) => {
    if (key === "Denial Analysis") return analysisByRow[i] ?? String(raw ?? "");
    if (key === "Verified: Denial Analysis") {
      return verifiedByRow[i] ??
        (String(raw ?? "").toLowerCase() === "yes" ? "Yes" : "No");
    }
    return raw;
  };

  // Unique values for filter dropdowns
  const carcOptions = useMemo(() => {
    const set = new Set<string>();
    combosSource.forEach((r) => {
      String(r["CARC Code(s)"] ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean).forEach((v) => set.add(v));
    });
    return Array.from(set).sort();
  }, [combosSource]);
  const rarcOptions = useMemo(() => {
    const set = new Set<string>();
    combosSource.forEach((r) => {
      String(r["RARC Code(s)"] ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean).forEach((v) => set.add(v));
    });
    return Array.from(set).sort();
  }, [combosSource]);

  const filteredRows = useMemo(() => {
    return combosSource.map((r, i) => ({ r, i })).filter(({ r, i }) => {
      const ver =
        (verifiedByRow[i] ?? String(r["Verified: Denial Analysis"] ?? "")).toLowerCase() === "yes";
      if (verifiedFilter === "yes" && !ver) return false;
      if (verifiedFilter === "no" && ver) return false;

      if (carcFilter !== "all") {
        const codes = String(r["CARC Code(s)"] ?? "").split(/[,;]/).map((s) => s.trim());
        if (!codes.includes(carcFilter)) return false;
      }
      if (rarcFilter !== "all") {
        const codes = String(r["RARC Code(s)"] ?? "").split(/[,;]/).map((s) => s.trim());
        if (!codes.includes(rarcFilter)) return false;
      }
      if (analysisFilter !== "all") {
        const cur = analysisByRow[i] ?? String(r["Denial Analysis"] ?? "");
        if (cur !== analysisFilter) return false;
      }

      if (search) {
        const q = search.toLowerCase();
        const hit = [...CORE_COLUMNS, ...EXTRA_COLUMNS].some((c) =>
          String(rowEffective(i, c.key, r[c.key]) ?? "").toLowerCase().includes(q),
        );
        if (!hit) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, verifiedFilter, carcFilter, rarcFilter, analysisFilter, verifiedByRow, analysisByRow]);

  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const { key, dir } = sort;
    const numeric = [...CORE_COLUMNS, ...EXTRA_COLUMNS].find((c) => c.key === key)?.numeric;
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      const av = rowEffective(a.i, key, a.r[key]);
      const bv = rowEffective(b.i, key, b.r[key]);
      if (numeric) {
        return ((Number(av) || 0) - (Number(bv) || 0)) * (dir === "asc" ? 1 : -1);
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * (dir === "asc" ? 1 : -1);
    });
    return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, sort, analysisByRow, verifiedByRow]);

  const effectivePageSize = pageSize === "all" ? sortedRows.length || 1 : pageSize;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / effectivePageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = sortedRows.slice(safePage * effectivePageSize, safePage * effectivePageSize + effectivePageSize);

  const toggleSort = (key: ColKey) => {
    setSort((s) =>
      !s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Denial Analysis Playbook</h2>
        {/* Playbook-level controls. These live HERE on the workbook
            page (not the per-patient denial workflow) because they
            operate against the whole playbook, not a single claim.
            Each wraps a HoverCard so the operator can hover to see
            what the control does without having to remember. */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
              <a
                href={DRIVE_ERA_FOLDER_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
              >
                ERA Drive folder
                <ExternalLink className="h-3 w-3" />
              </a>
            </HoverCardTrigger>
            <HoverCardContent align="end" className="w-80 text-sm">
              <p className="font-semibold">ERA Drive folder</p>
              <p className="mt-1 text-muted-foreground">
                Every 835 ERA we receive from Stedi gets archived
                here as raw JSON. The hourly cron parses these files
                to extract unique (CARC, RARC) denial combos and
                append them to the source Google Sheet.
              </p>
            </HoverCardContent>
          </HoverCard>

          <HoverCard openDelay={150} closeDelay={100}>
            <HoverCardTrigger asChild>
              <a
                href={DENIAL_PLAYBOOK_SHEET_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
              >
                Source Google Sheet
                <ExternalLink className="h-3 w-3" />
              </a>
            </HoverCardTrigger>
            <HoverCardContent align="end" className="w-80 text-sm">
              <p className="font-semibold">Source Google Sheet</p>
              <p className="mt-1 text-muted-foreground">
                The actual <em>"Unique Combos"</em> tab in Google
                Sheets — same data you see in the table on this
                page, just shown directly through Sheets. Useful for
                bulk-editing, leaving comments, or trusting your
                eyes on a row. Edits round-trip: anything changed
                here shows up in this UI after the next refresh.
              </p>
            </HoverCardContent>
          </HoverCard>

          {isPlaybookApiConfigured() && (
            <HoverCard openDelay={150} closeDelay={100}>
              <HoverCardTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={playbookSyncBusy}
                  onClick={() => void triggerPlaybookSync()}
                >
                  {playbookSyncBusy ? "Syncing…" : "Sync Playbook"}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent align="end" className="w-80 text-sm">
                <p className="font-semibold">Sync Playbook</p>
                <p className="mt-1 text-muted-foreground">
                  Automatically syncs every hour — press it to sync
                  immediately. Pulls any new 835s from Stedi,
                  archives the JSONs to the Drive folder, and
                  appends any unseen (CARC, RARC) combos to the
                  source sheet. Verified columns on existing rows
                  are preserved.
                </p>
              </HoverCardContent>
            </HoverCard>
          )}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Unique Combos" value={String(stats.total)} />
        <StatCard label="Verified" value={String(stats.verified)} tone="success" />
        <StatCard label="Unverified" value={String(stats.unverified)} tone="warning" />
        <StatCard label="Total Denial Lines" value={String(stats.totalCount)} />
      </section>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search all columns…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <Select value={carcFilter} onValueChange={(v) => { setCarcFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="CARC" /></SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">All CARC</SelectItem>
              {carcOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={rarcFilter} onValueChange={(v) => { setRarcFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="RARC" /></SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">All RARC</SelectItem>
              {rarcOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={analysisFilter} onValueChange={(v) => { setAnalysisFilter(v); setPage(0); }}>
            <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Denial Analysis" /></SelectTrigger>
            <SelectContent className="max-h-[300px]">
              <SelectItem value="all">All Denial Analysis</SelectItem>
              {allOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={verifiedFilter} onValueChange={(v) => { setVerifiedFilter(v as typeof verifiedFilter); setPage(0); }}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Verified" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Verified</SelectItem>
              <SelectItem value="yes">Verified</SelectItem>
              <SelectItem value="no">Unverified</SelectItem>
            </SelectContent>
          </Select>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                New denial reason
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add new denial reason</DialogTitle>
              </DialogHeader>
              <Input
                placeholder="e.g. Prior authorization required"
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                autoFocus
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => {
                    const v = newOption.trim();
                    if (v && !allOptions.includes(v)) setCustomOptions((p) => [...p, v]);
                    setNewOption("");
                    setAddOpen(false);
                  }}
                >
                  Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={() => setShowExtra((s) => !s)} className="gap-1">
            {showExtra ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {showExtra ? "Hide extra details" : "Show extra details"}
          </Button>

          {(carcFilter !== "all" || rarcFilter !== "all" || analysisFilter !== "all" ||
            verifiedFilter !== "all" || sort) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCarcFilter("all"); setRarcFilter("all"); setAnalysisFilter("all");
                setVerifiedFilter("all"); setSort(null); setPage(0);
              }}
            >
              Reset
            </Button>
          )}

          <div className="ml-auto text-xs text-muted-foreground">
            {sortedRows.length} of {combosSource.length} rows
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-340px)] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-20">
                <TableRow className="border-b-2 hover:bg-transparent">
                  {COLUMNS.map((c) => {
                    const sorted = sort?.key === c.key ? sort.dir : null;
                    const isSorted = sorted !== null;
                    return (
                      <TableHead
                        key={c.key as string}
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          c.width, c.className,
                          "whitespace-nowrap select-none cursor-pointer",
                          "bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/70",
                          "h-11 px-3 text-xs uppercase tracking-wide font-bold text-foreground",
                          "border-b transition-colors hover:bg-muted",
                          isSorted && "text-primary",
                        )}
                      >
                        <div className={cn(
                          "flex items-center gap-1.5",
                          c.align === "right" && "justify-end",
                        )}>
                          <span>{c.label}</span>
                          <span className="inline-flex h-3 w-3 items-center justify-center shrink-0">
                            {sorted === "asc" ? <ArrowUp className="h-3 w-3" /> :
                              sorted === "desc" ? <ArrowDown className="h-3 w-3" /> :
                                <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </span>
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map(({ r, i }) => {
                  const currentAnalysis = analysisByRow[i] ?? String(r["Denial Analysis"] ?? "");
                  const currentVerified =
                    verifiedByRow[i] ??
                    (String(r["Verified: Denial Analysis"] ?? "").toLowerCase() === "yes" ? "Yes" : "No");

                  return (
                    <TableRow key={i} className="align-top">
                      {COLUMNS.map((c) => {
                        if (c.key === "Denial Analysis") {
                          // Auto-save on change. Picking a new bucket
                          // here means "I want this combo verified as
                          // X" — equivalent to clicking Verify in the
                          // ClaimDetail inline picker. Local state is
                          // updated optimistically; persistRow handles
                          // toast + cache invalidate + revert on error.
                          // Verified column auto-flips to Yes alongside.
                          return (
                            <TableCell key={c.key as string} className="text-sm">
                              <Select
                                value={currentAnalysis || undefined}
                                disabled={savingRow === i}
                                onValueChange={(v) => {
                                  setAnalysisByRow((p) => ({ ...p, [i]: v }));
                                  setVerifiedByRow((p) => ({ ...p, [i]: "Yes" }));
                                  void persistRow(i, r, v);
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Select…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {allOptions.map((opt) => (
                                    <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {savingRow === i && (
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  Saving…
                                </div>
                              )}
                            </TableCell>
                          );
                        }
                        if (c.key === "Verified: Denial Analysis") {
                          // Yes → confirm the current Denial Analysis
                          // bucket as verified on the Sheet.
                          // No → clear the Verified column (sets
                          // verified_analysis = "" on the row).
                          return (
                            <TableCell key={c.key as string} className="text-sm">
                              <Select
                                value={currentVerified}
                                disabled={savingRow === i}
                                onValueChange={(v) => {
                                  setVerifiedByRow((p) => ({ ...p, [i]: v }));
                                  if (v === "Yes") {
                                    if (!currentAnalysis) {
                                      toast.error(
                                        "Pick a Denial Analysis bucket first.",
                                      );
                                      // Revert — can't mark Yes without
                                      // a bucket to verify against.
                                      setVerifiedByRow((p) => {
                                        const n = { ...p };
                                        delete n[i];
                                        return n;
                                      });
                                      return;
                                    }
                                    void persistRow(i, r, currentAnalysis);
                                  } else {
                                    void persistRow(i, r, "");
                                  }
                                }}
                              >
                                <SelectTrigger
                                  className={cn(
                                    "h-8 text-xs",
                                    currentVerified === "Yes" && "bg-success-soft text-success-soft-foreground",
                                    currentVerified === "No" && "text-muted-foreground",
                                  )}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {VERIFIED_OPTIONS.map((opt) => (
                                    <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell
                            key={c.key as string}
                            className={cn(
                              "text-sm",
                              c.align === "right" && "text-right tabular-nums",
                              (c.key === "CARC Remarks" || c.key === "RARC Remarks" || c.key === "Notes (classifier)") &&
                                "text-muted-foreground",
                            )}
                          >
                            {fmtCell(r[c.key])}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                {pagedRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length} className="text-center text-muted-foreground py-8">
                      No rows match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t p-3">
            <div className="text-xs text-muted-foreground">
              Page {safePage + 1} of {pageCount} · showing {pagedRows.length} of {sortedRows.length}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
              >
                Next <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <div className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>Show</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(v === "all" ? "all" : (Number(v) as PageSize));
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="h-8 w-[90px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((s) => (
                      <SelectItem key={String(s)} value={String(s)}>
                        {s === "all" ? "All" : s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={cn(
            "mt-1 text-2xl font-semibold",
            tone === "success" && "text-success-soft-foreground",
            tone === "warning" && "text-warning-soft-foreground",
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
