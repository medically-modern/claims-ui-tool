import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Ban, CalendarCheck, Clock, Loader2, RefreshCw, User, AlertCircle, Search, X, Undo2 } from "lucide-react";
import type { Patient } from "@/lib/masheke/workflow";
import type { TabKey } from "@/hooks/masheke/useMondayPatients";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { writeStatusIndex, clearStatusColumn, clearDateColumn, COL } from "@/lib/masheke/mondayApi";
import { SUB_STAGE_INDEX, ADVANCER_2C_INDEX } from "@/lib/masheke/mondayMapping";

/** Convert YYYY-MM-DD → MM/DD/YYYY */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

const TAB_LABELS: Record<TabKey, string> = {
  evaluate: "Evaluate MN",
  sendRequest: "Send Request",
  confirmReceipt: "Confirm Receipt",
  chase: "Chase",
};

// Order of stage groups inside the Evaluate tab sidebar
const EVALUATE_GROUP_ORDER = [
  "Evaluate MN",
  "Send Request",
  "Confirm Receipt",
  "Chase Clinicals",
] as const;

function PatientRow({
  patient,
  isActive,
  collapsed,
  onSelect,
  showSendBack,
  onSendBack,
}: {
  patient: Patient;
  isActive: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  showSendBack?: boolean;
  onSendBack?: (id: string) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => onSelect(patient.id)}
        className={cn(
          "flex items-start gap-2 py-2 h-auto",
          isActive && "bg-sidebar-accent",
        )}
      >
        <User className="h-4 w-4 mt-0.5 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 text-left">
            <p className="text-sm font-medium truncate">{patient.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {patient.serving || "—"} · {patient.daysSinceStageStart || "—"}
            </p>
          </div>
        )}
      </SidebarMenuButton>
      {showSendBack && !collapsed && onSendBack && (
        <button
          onClick={(e) => { e.stopPropagation(); onSendBack(patient.id); }}
          className="mx-2 mb-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 transition-colors"
          title="Move this patient back to the Evaluate stage"
        >
          <Undo2 className="h-3 w-3" />
          Send back to Evaluate
        </button>
      )}
    </SidebarMenuItem>
  );
}

interface Props {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  activeTab: TabKey;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, activeTab }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const [todayOnly, setTodayOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sendingBack, setSendingBack] = useState<string | null>(null);

  // Split patients into active vs blocked vs follow-up vs escalated vs stuck
  const stuckPatients = patients.filter((p) => p.advancer2c === "Stuck" && p.blocked !== "Blocked");
  const escalatedPatients = patients.filter((p) => p.escalation === "Escalation Required" && p.blocked !== "Blocked" && p.followUp !== "Follow up" && p.advancer2c !== "Stuck");
  const activePatients = patients.filter((p) => p.escalation !== "Escalation Required" && p.blocked !== "Blocked" && p.followUp !== "Follow up" && p.advancer2c !== "Stuck");
  const blockedPatients = patients.filter((p) => p.blocked === "Blocked");
  const followUpPatients = patients.filter((p) => p.followUp === "Follow up" && p.blocked !== "Blocked" && p.escalation !== "Escalation Required" && p.advancer2c !== "Stuck");

  // Always use Eastern Time so all users see the same "today" regardless of their local timezone
  const etParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const todayStr = etParts; // "YYYY-MM-DD" in ET

  // For chase tab: split into "action today" vs rest
  const todayPatients = activeTab === "chase" && todayOnly
    ? activePatients.filter((p) => p.nextActionDate?.slice(0, 10) === todayStr)
    : activePatients;

  const activeLabel = TAB_LABELS[activeTab];

  // Search filtering (only on Evaluate tab)
  const isSearching = activeTab === "evaluate" && searchQuery.trim().length > 0;
  const searchResults = isSearching
    ? patients.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : [];

  const handleSendBackToEvaluate = async (patientId: string) => {
    setSendingBack(patientId);
    try {
      await writeStatusIndex(patientId, COL.subStage, SUB_STAGE_INDEX.evaluate);
      // Refresh data after writing
      onRefresh();
      setSearchQuery("");
    } catch (err) {
      console.error("[PatientsSidebar] Failed to send back to Evaluate:", err);
    } finally {
      setSendingBack(null);
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Monday · {activeLabel}</p>
              <p className="text-sm font-semibold truncate">Patients ({patients.length})</p>
            </div>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {activeTab === "chase" && !collapsed && (
              <Button
                variant={todayOnly ? "default" : "ghost"}
                size="icon"
                className={cn("h-7 w-7", todayOnly && "bg-emerald-600 hover:bg-emerald-700 text-white")}
                onClick={() => setTodayOnly((v) => !v)}
                title={todayOnly ? "Showing today's actions — click to show all" : "Filter to today's action dates"}
              >
                <CalendarCheck className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh from Monday"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Search bar — only on Evaluate tab */}
        {activeTab === "evaluate" && !collapsed && (
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patients…"
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border bg-white text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {error && !collapsed && (
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {activeTab === "evaluate" ? (
          isSearching ? (
            /* ── Search results (flat list) ── */
            <SidebarGroup>
              {!collapsed && (
                <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Search Results ({searchResults.length})
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {searchResults.map((p) => (
                    <PatientRow
                      key={p.id}
                      patient={p}
                      isActive={selectedId === p.id}
                      collapsed={collapsed}
                      onSelect={onSelect}
                      showSendBack={p.subStage !== "Evaluate MN" && sendingBack !== p.id}
                      onSendBack={handleSendBackToEvaluate}
                    />
                  ))}
                  {searchResults.length === 0 && !collapsed && (
                    <p className="px-3 py-4 text-xs text-muted-foreground">No patients matching "{searchQuery}"</p>
                  )}
                  {sendingBack && !collapsed && (
                    <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Sending back to Evaluate…
                    </div>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : (
            /* ── Normal grouped view ── */
            <>
              {EVALUATE_GROUP_ORDER.map((stage) => {
                const inStage = activePatients.filter((p) => (p.subStage ?? "") === stage);
                if (inStage.length === 0) return null;
                return (
                  <SidebarGroup key={stage}>
                    {!collapsed && (
                      <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        {stage} ({inStage.length})
                      </SidebarGroupLabel>
                    )}
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {inStage.map((p) => (
                          <PatientRow
                            key={p.id}
                            patient={p}
                            isActive={selectedId === p.id}
                            collapsed={collapsed}
                            onSelect={onSelect}
                          />
                        ))}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                );
              })}
              {!loading && activePatients.length === 0 && !error && !collapsed && (
                <p className="px-3 py-4 text-xs text-muted-foreground">No patients in any MN stage.</p>
              )}
            </>
          )
        ) : (
          <SidebarGroup>
            {activeTab === "chase" && todayOnly && !collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">
                Action Today ({todayPatients.length})
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {todayPatients.map((p) => (
                  <PatientRow
                    key={p.id}
                    patient={p}
                    isActive={selectedId === p.id}
                    collapsed={collapsed}
                    onSelect={onSelect}
                  />
                ))}
                {!loading && todayPatients.length === 0 && !error && !collapsed && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    {todayOnly ? "No patients with action date today." : `No patients in ${activeLabel}.`}
                  </p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Blocked section (all tabs) ── */}
        {blockedPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-red-500 font-semibold flex items-center gap-1.5">
              <Ban className="h-3 w-3" />
              Blocked ({blockedPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {blockedPatients.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <div className="flex items-center gap-1 w-full">
                      <SidebarMenuButton
                        isActive={selectedId === p.id}
                        onClick={() => onSelect(p.id)}
                        className={cn(
                          "flex-1 flex items-start gap-2 py-2 h-auto opacity-60",
                          selectedId === p.id && "bg-sidebar-accent opacity-100",
                        )}
                      >
                        <Ban className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-red-400 truncate">
                            Until {p.blockedDate ? fmtDate(p.blockedDate) : "—"}
                          </p>
                        </div>
                      </SidebarMenuButton>
                      <UnblockButton patientId={p.id} patientName={p.name} onSuccess={onRefresh} />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Stuck section (all tabs) ── */}
        {stuckPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-amber-500 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Stuck ({stuckPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {stuckPatients.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <div className="flex items-center gap-1 w-full">
                      <SidebarMenuButton
                        isActive={selectedId === p.id}
                        onClick={() => onSelect(p.id)}
                        className={cn(
                          "flex-1 flex items-start gap-2 py-2 h-auto opacity-60",
                          selectedId === p.id && "bg-sidebar-accent opacity-100",
                        )}
                      >
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-amber-400 truncate">
                            {p.serving || "—"}
                          </p>
                        </div>
                      </SidebarMenuButton>
                      <UnstuckButton patientId={p.id} patientName={p.name} onSuccess={onRefresh} />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Escalated section (all tabs) ── */}
        {escalatedPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-red-500 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Escalated ({escalatedPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {escalatedPatients.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <div className="flex items-center gap-1 w-full">
                      <SidebarMenuButton
                        isActive={selectedId === p.id}
                        onClick={() => onSelect(p.id)}
                        className={cn(
                          "flex-1 flex items-start gap-2 py-2 h-auto opacity-60",
                          selectedId === p.id && "bg-sidebar-accent opacity-100",
                        )}
                      >
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-red-400 truncate">
                            Escalation Required
                          </p>
                        </div>
                      </SidebarMenuButton>
                      <ClearEscalationButton patientId={p.id} patientName={p.name} onSuccess={onRefresh} />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Follow Up section (all tabs) ── */}
        {followUpPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-blue-500 font-semibold flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Follow Up ({followUpPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {followUpPatients.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <div className="flex items-center gap-1 w-full">
                      <SidebarMenuButton
                        isActive={selectedId === p.id}
                        onClick={() => onSelect(p.id)}
                        className={cn(
                          "flex-1 flex items-start gap-2 py-2 h-auto opacity-60",
                          selectedId === p.id && "bg-sidebar-accent opacity-100",
                        )}
                      >
                        <Clock className="h-4 w-4 mt-0.5 shrink-0 text-blue-400" />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-blue-400 truncate">
                            Until {p.followUpDate ? fmtDate(p.followUpDate) : "\u2014"}
                          </p>
                        </div>
                      </SidebarMenuButton>
                      <ClearFollowUpButton patientId={p.id} patientName={p.name} onSuccess={onRefresh} />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

    </Sidebar>
  );
}


/** Small button to clear Blocked status + date on Monday */
function UnblockButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleUnblock = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await Promise.all([
        clearStatusColumn(patientId, COL.blocked),
        clearStatusColumn(patientId, COL.blockedDate),
      ]);
      toast.success(`${patientName} unblocked`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to unblock: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleUnblock}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
      title={`Unblock ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Un-Block
    </button>
  );
}


/** Small button to clear Stuck status (Advancer 2C) on Monday */
function UnstuckButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleUnstuck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await clearStatusColumn(patientId, COL.advancer2c);
      toast.success(`${patientName} returned to active`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to unstick: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleUnstuck}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-50"
      title={`Unstick ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Unstick
    </button>
  );
}


/** Small button to clear Follow Up status + date on Monday */
function ClearFollowUpButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await Promise.all([
        clearStatusColumn(patientId, COL.followUp),
        clearDateColumn(patientId, COL.followUpDate),
      ]);
      toast.success(`${patientName} returned to active`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to clear follow up: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClear}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
      title={`Clear follow up for ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Active
    </button>
  );
}


/** Small button to clear Escalation status on Monday */
function ClearEscalationButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await clearStatusColumn(patientId, COL.escalation);
      toast.success(`${patientName} returned to active`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to clear escalation: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClear}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
      title={`Clear escalation for ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Active
    </button>
  );
}
