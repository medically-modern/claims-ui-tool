import { useMemo, useState } from "react";
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
import { AlertTriangle, Clock, Loader2, RefreshCw, Undo2, User, AlertCircle, ArrowDownAZ, Search, X} from "lucide-react";
import type { Patient } from "@/lib/samantha/workflow";
import type { SidebarGroup as SidebarGroupType } from "@/hooks/samantha/useMondayPatients";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { clearStatusColumn, COL } from "@/lib/samantha/mondayApi";

const AUTH_TABS: { key: SidebarGroupType; label: string }[] = [
  { key: "submitAuth", label: "Submit Auth" },
  { key: "authOutstanding", label: "Auth Outstanding" },
];

const GROUP_LABELS: Record<SidebarGroupType, string> = {
  benefits: "Benefits",
  submitAuth: "Submit Auth",
  authOutstanding: "Auth Outstanding",
};

/** Convert YYYY-MM-DD → MM/DD/YYYY */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
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
        clearStatusColumn(patientId, COL.followUpDate),
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
      title={`Remove follow up for ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Remove
    </button>
  );
}

/** Group patients by their primaryInsurance, sorted alphabetically by insurer name. */
function groupByInsurance(patients: Patient[]): { label: string; patients: Patient[] }[] {
  const map = new Map<string, Patient[]>();
  for (const p of patients) {
    const key = p.primaryInsurance || "Unknown";
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, pts]) => ({ label, patients: pts }));
}

interface Props {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  activeGroup: SidebarGroupType;
  onGroupChange?: (group: SidebarGroupType) => void;
  showGroupTabs?: boolean;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, activeGroup, onGroupChange, showGroupTabs = false }: Props) {
  const { state } = useSidebar();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBySearch = searchQuery.trim()
    ? patients.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : patients;

  const collapsed = state === "collapsed";
  const [groupByIns, setGroupByIns] = useState(false);

  const activeLabel = GROUP_LABELS[activeGroup];

  // Split patients into active vs follow-up vs escalated
  const escalatedPatients = filteredBySearch.filter((p) => p.escalated && p.followUp !== "Follow Up");
  const activePatients = filteredBySearch.filter((p) => !p.escalated && p.followUp !== "Follow Up");
  const followUpPatients = filteredBySearch.filter((p) => p.followUp === "Follow Up" && !p.escalated);

  const grouped = useMemo(() => groupByInsurance(activePatients), [activePatients]);

  // For Auth Outstanding, sort patients by daysSinceStageIndex descending
  // (longest in system first). Other groups keep Monday order.
  const sortedPatients = useMemo(() => {
    if (activeGroup !== "authOutstanding") return activePatients;
    return [...activePatients].sort((a, b) => (b.daysSinceStageIndex ?? -1) - (a.daysSinceStageIndex ?? -1));
  }, [activePatients, activeGroup]);

  const isAuthOutstanding = activeGroup === "authOutstanding";

  const renderPatient = (p: Patient) => (
    <SidebarMenuItem key={p.id}>
      <SidebarMenuButton
        isActive={selectedId === p.id}
        onClick={() => onSelect(p.id)}
        className={cn(
          "flex items-start gap-2 py-2 h-auto",
          selectedId === p.id && "bg-sidebar-accent",
        )}
      >
        <User className="h-4 w-4 mt-0.5 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 text-left">
            <p className="text-sm font-medium truncate">{p.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {p.primaryInsurance || "—"} · {p.serving || "—"}
            </p>
            {isAuthOutstanding && p.daysSinceStage && (
              <p className={cn(
                "text-[10px] font-medium truncate mt-0.5",
                (p.daysSinceStageIndex ?? 0) >= 3 ? "text-destructive" :
                (p.daysSinceStageIndex ?? 0) >= 2 ? "text-amber-400" :
                "text-muted-foreground",
              )}>
                {p.daysSinceStage}
              </p>
            )}
          </div>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

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
            {!collapsed && (
              <Button
                variant={groupByIns ? "default" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setGroupByIns((v) => !v)}
                title="Group by insurance"
              >
                <ArrowDownAZ className="h-4 w-4" />
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

        {!collapsed && showGroupTabs && (
          <div className="flex gap-1 mt-2">
            {AUTH_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => onGroupChange(tab.key)}
                className={cn(
                  "flex-1 text-[10px] font-medium py-1 px-1 rounded transition-colors truncate",
                  activeGroup === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      
        {!collapsed && (
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

        {groupByIns && !collapsed ? (
          // Grouped by insurance
          grouped.map((g) => (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">
                {g.label} ({g.patients.length})
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{g.patients.map(renderPatient)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        ) : (
          // Flat list
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {sortedPatients.map(renderPatient)}
                {!loading && activePatients.length === 0 && !error && !collapsed && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">No patients in {activeLabel} group.</p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Follow Up section (all views) ── */}
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
                            Until {p.followUpDate ? fmtDate(p.followUpDate) : "—"}
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

        {/* ── Escalated section (all views) ── */}
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
                    <SidebarMenuButton
                      isActive={selectedId === p.id}
                      onClick={() => onSelect(p.id)}
                      className={cn(
                        "flex items-start gap-2 py-2 h-auto opacity-60",
                        selectedId === p.id && "bg-sidebar-accent opacity-100",
                      )}
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
                      {!collapsed && (
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-red-400 truncate">
                            Escalation Required
                          </p>
                        </div>
                      )}
                    </SidebarMenuButton>
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
