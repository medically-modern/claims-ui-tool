/**
 * SubscriptionBoard.tsx — Subscription Board (top-level tab).
 *
 * Phase sub-tabs: Overview / Confirmation / Eligibility / Authorization /
 * Last Order Paid / Submit Order. Patients are assigned to the leftmost
 * not-OK checkpoint so the operator can batch through stuck work by phase.
 *
 * Row layout per Brandon (2026-06-02 simplification):
 *   Patient (name + phone) | Order date | Subscription pill (color per type)
 *   | Primary Payer | 4 simple checkpoint icons (✓ / blank / ✗) |
 *   Review Profile | Send to Order Board
 *
 * On phase tabs we keep the stuck-reasoning columns (Blocked By, Next
 * Check-In, Why Stuck) since that's the whole point of those views.
 */

import { useMemo, useState } from "react";
import {
  ArrowRight, Building2, Check, ExternalLink, Heart, RefreshCw, Search,
  Send, Server, UserCog, Unlock, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  BLOCKED_BY_OPTIONS, BlockedParty, CHECKPOINT_GATE, Checkpoint, CheckpointKind,
  currentPhase, ORDER_PREP_PATIENTS, PATIENT_STATUS_OPTIONS, PAUSE_REASON_OPTIONS,
  PAYER_OPTIONS, PHASE_LABELS, SubscriptionPatient, SubscriptionType,
} from "./mockData";

type PhaseTab = "overview" | CheckpointKind | "ready";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function daysBetween(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}
function getCheckpoint(p: SubscriptionPatient, kind: CheckpointKind): Checkpoint {
  return kind === "confirmation" ? p.confirmation
       : kind === "benefits"     ? p.benefits
       : kind === "auth"         ? p.auth
       : p.lastPaid;
}
function allChecksPass(p: SubscriptionPatient): boolean {
  return p.confirmation.tone === "ok" && p.benefits.tone === "ok"
    && p.auth.tone === "ok" && p.lastPaid.tone === "ok";
}

// ─── Atoms ───────────────────────────────────────────────────────────────────

/**
 * Checkpoint circle — four visual states per Brandon's spec:
 *   - Outline (no fill): hasn't entered the active window yet
 *     (e.g. order is more than 21 days out, eligibility not yet run)
 *   - Gray filled: in the window, awaiting response
 *   - Green with check: passed
 *   - Red with X: failed
 *
 * State is derived from `tone` + the "not yet started" labels list.
 */
const NOT_YET_LABELS = new Set([
  "Not sent", "Not run", "Not checked", "Not Serving", "Unknown",
]);

type CircleState = "outline" | "gray" | "green" | "red";

function circleStateFor(c: Checkpoint): CircleState {
  if (c.tone === "ok")  return "green";
  if (c.tone === "bad") return "red";
  if (NOT_YET_LABELS.has(c.label)) return "outline";
  return "gray";
}

function CheckpointCircle({
  check, size = 28, onClick, title,
}: {
  check: Checkpoint;
  size?: number;
  onClick?: () => void;
  title?: string;
}) {
  const state = circleStateFor(check);
  const sizeStyle = { width: size, height: size };
  const inner =
    state === "green" ? <Check className="h-4 w-4 text-white"  strokeWidth={3} /> :
    state === "red"   ? <X     className="h-4 w-4 text-white"  strokeWidth={3} /> :
    null;
  const cls =
    state === "green"   ? "bg-emerald-600 ring-emerald-600"
    : state === "red"   ? "bg-rose-600 ring-rose-600"
    : state === "gray"  ? "bg-slate-300 ring-slate-300"
    : "bg-transparent ring-slate-300";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `${check.label}${check.detail ? " — " + check.detail : ""}`}
      className="relative inline-flex items-center justify-center"
      style={sizeStyle}
    >
      <span
        className={cn("inline-flex items-center justify-center rounded-full ring-2", cls)}
        style={sizeStyle}
      >
        {inner}
      </span>
      {check.overrideReason && (
        <Unlock className="absolute -top-1 -right-1 h-3 w-3 text-slate-500 bg-white rounded-full" aria-label="override" />
      )}
    </button>
  );
}

/** Backwards-compatible alias used inside the drawer for compact display. */
function CheckpointIcon({ check, onClick, title }: { check: Checkpoint; onClick?: () => void; title?: string }) {
  return <CheckpointCircle check={check} size={24} onClick={onClick} title={title} />;
}

const SUB_TYPE_PILLS: Record<SubscriptionType, string> = {
  "Sensors":             "inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700",
  "Supplies":            "inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700",
  "Sensors & Supplies":  "inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700",
};

function BlockedByPill({ value }: { value?: BlockedParty }) {
  if (!value) return <span className="text-[11px] text-muted-foreground">—</span>;
  const cfg: Record<BlockedParty, { label: string; cls: string; icon: JSX.Element }> = {
    us:      { label: "Us",      cls: "bg-violet-100 text-violet-700",   icon: <UserCog  className="h-3 w-3" /> },
    patient: { label: "Patient", cls: "bg-amber-100 text-amber-700",     icon: <Heart    className="h-3 w-3" /> },
    payer:   { label: "Payer",   cls: "bg-sky-100 text-sky-700",         icon: <Building2 className="h-3 w-3" /> },
    system:  { label: "System",  cls: "bg-slate-100 text-slate-600",     icon: <Server   className="h-3 w-3" /> },
  };
  const c = cfg[value];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold", c.cls)}>
      {c.icon}{c.label}
    </span>
  );
}


function PauseBadge({ patient }: { patient: SubscriptionPatient }) {
  if (patient.patientStatus !== "Paused") return null;
  return (
    <span
      className="ml-1.5 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-tight text-amber-800"
      title={patient.pauseReason ? `Paused: ${patient.pauseReason}` : "Paused (no reason set)"}
    >
      Paused{patient.pauseReason ? ` · ${patient.pauseReason}` : ""}
    </span>
  );
}

function CheckInCell({ iso, stuckSince }: { iso?: string; stuckSince?: string }) {
  if (!iso) return <span className="text-[11px] text-muted-foreground">—</span>;
  const days = daysBetween(iso);
  const tone =
    days < 0  ? "text-rose-600 font-semibold" :
    days === 0 ? "text-amber-700 font-semibold" :
    days <= 2 ? "text-amber-700" : "text-foreground";
  return (
    <div className="leading-tight">
      <div className={cn("text-[12px] tabular-nums", tone)}>
        {fmtDate(iso)} <span className="text-muted-foreground">({days < 0 ? `${-days}d ago` : days === 0 ? "today" : `in ${days}d`})</span>
      </div>
      {stuckSince && (
        <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
          stuck since {fmtDate(stuckSince)} ({-daysBetween(stuckSince)}d)
        </div>
      )}
    </div>
  );
}

function ReviewAndSubmit({ p, onReview, onSubmit }: {
  p: SubscriptionPatient;
  onReview: () => void;
  onSubmit: () => void;
}) {
  const ready = allChecksPass(p);
  return (
    <div className="flex items-center justify-end gap-2">
      <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onReview}>
        Review Profile<ArrowRight className="ml-1 h-3 w-3" />
      </Button>
      <Button
        size="sm"
        onClick={onSubmit}
        className={cn(
          "h-7 text-[11px] text-white",
          ready
            ? "bg-emerald-700 hover:bg-emerald-800"
            : "bg-slate-400 hover:bg-slate-500",
        )}
        title={ready
          ? "All 4 checks passed — send order"
          : "Not all 4 checks pass — confirm before submitting"}
      >
        <Send className="mr-1 h-3 w-3" />Send to Order Board
      </Button>
    </div>
  );
}

function KpiTile({ label, value, tone }: {
  label: string; value: string | number;
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
}) {
  const dot = {
    info:    "bg-sky-100 text-sky-600",
    warning: "bg-amber-100 text-amber-600",
    danger:  "bg-rose-100 text-rose-600",
    success: "bg-emerald-100 text-emerald-600",
    neutral: "bg-slate-100 text-slate-600",
  }[tone ?? "neutral"];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg", dot)}>
          <Check className="h-4 w-4" />
        </div>
        <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{label}</div>
    </Card>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────
function PatientDrawer({
  patient, kind, onClose,
}: {
  patient: SubscriptionPatient | null;
  kind: CheckpointKind | "patient" | null;
  onClose: () => void;
}) {
  const open = !!patient && !!kind;
  if (!open || !patient || !kind) {
    return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>;
  }
  const isPatientView = kind === "patient";
  const checkpoint: Checkpoint | null = isPatientView ? null : getCheckpoint(patient, kind);
  const gate = !isPatientView ? CHECKPOINT_GATE[kind as CheckpointKind] : null;
  const isSoft = gate === "soft";
  const isFailing = checkpoint && checkpoint.tone !== "ok";
  const title = ({
    confirmation: "Patient Confirmation",
    benefits:     "Benefits & Eligibility",
    auth:         "Authorization",
    lastPaid:     "Last Order — Claim Status",
    patient:      "Review profile",
  } as const)[kind];
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className={cn(isPatientView ? "w-[640px] sm:max-w-[640px]" : "w-[480px] sm:max-w-[480px]", "overflow-y-auto")}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {patient.name} · {patient.subscriptionType} · {patient.primaryPayer} · order {fmtDate(patient.nextOrderDate)}
          </SheetDescription>
        </SheetHeader>

        {isPatientView ? (
          <div className="mt-6 space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Readiness checks</div>
              <div className="space-y-2">
                {(["confirmation","benefits","auth","lastPaid"] as const).map((k, idx) => {
                  const c = getCheckpoint(patient, k);
                  return (
                    <Card key={k} className="p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[13px] font-semibold">{`${idx + 1}. ${PHASE_LABELS[k]}`}</div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">{c.label}{c.detail ? ` — ${c.detail}` : ""}</div>
                        {c.overrideReason && (
                          <div className="mt-1 text-[11px] text-slate-600 italic">override: {c.overrideReason}</div>
                        )}
                      </div>
                      <CheckpointIcon check={c} />
                    </Card>
                  );
                })}
              </div>
            </div>
            {patient.stuckReason && (
              <Card className="p-3 border-amber-200 bg-amber-50">
                <div className="text-[11px] uppercase tracking-wide text-amber-700">Why stuck</div>
                <div className="text-[13px] text-slate-800 mt-1">{patient.stuckReason}</div>
                <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground items-center">
                  {patient.blockedBy && <span className="flex items-center gap-1">Blocked by: <BlockedByPill value={patient.blockedBy} /></span>}
                  {patient.nextCheckIn && <span>Next check-in: {fmtDate(patient.nextCheckIn)}</span>}
                </div>
              </Card>
            )}
            <Card className="p-3 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{patient.phone}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Monday ID</span><span className="font-mono text-[11px]">{patient.mondayItemId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Run Check</span><span className="text-[11px]">{patient.runCheck}</span></div>
            </Card>
          </div>
        ) : checkpoint && (
          <div className="mt-6 space-y-4">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current status</div>
                <div className="text-[13px] mt-1">{checkpoint.label}{checkpoint.detail ? ` — ${checkpoint.detail}` : ""}</div>
              </div>
              <CheckpointIcon check={checkpoint} />
            </Card>
            {patient.stuckReason && (
              <Card className="p-3 border-amber-200 bg-amber-50">
                <div className="text-[11px] uppercase tracking-wide text-amber-700">Why stuck</div>
                <div className="text-[13px] text-slate-800 mt-1">{patient.stuckReason}</div>
                <div className="flex gap-4 mt-2 text-[11px] text-muted-foreground items-center">
                  {patient.blockedBy && <span className="flex items-center gap-1">Blocked by: <BlockedByPill value={patient.blockedBy} /></span>}
                  {patient.nextCheckIn && <span>Check in: {fmtDate(patient.nextCheckIn)}</span>}
                </div>
              </Card>
            )}
            {kind === "auth" && patient.auth.label === "DVS at order" && (
              <Card className="p-3 border-amber-200 bg-amber-50">
                <div className="text-[11px] uppercase tracking-wide text-amber-700">Medicaid Supplies — DVS exception</div>
                <div className="text-[12px] text-slate-700 mt-1">
                  Check 3 fires a DVS submission to ePACES when the order is created. The DVS response is the auth verdict.
                </div>
              </Card>
            )}
            {isSoft && isFailing && (
              <Card className="p-4 space-y-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Unlock className="h-3 w-3" /> Operator override
                </div>
                {checkpoint.overrideReason ? (
                  <div className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-700">
                    <div className="font-semibold mb-1">Override applied</div>
                    {checkpoint.overrideReason}
                  </div>
                ) : (
                  <>
                    <Textarea placeholder="Reason for overriding this check (logged on patient row)…" className="min-h-[72px] text-[13px]" />
                    <Button size="sm" className="w-full"><Unlock className="mr-2 h-3.5 w-3.5" />Approve override + log reason</Button>
                  </>
                )}
              </Card>
            )}
          </div>
        )}
        <SheetFooter className="mt-6">
          {!isPatientView && kind === "confirmation" && (
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1"><Send className="mr-2 h-4 w-4" />Resend Reorder Text</Button>
              <Button className="flex-1"><Check className="mr-2 h-4 w-4" />Mark Changes Reviewed</Button>
            </div>
          )}
          {!isPatientView && kind === "benefits" && (
            <Button className="w-full"><RefreshCw className="mr-2 h-4 w-4" />Run Eligibility Now</Button>
          )}
          {!isPatientView && kind === "auth" && (
            <Button className="w-full"><ExternalLink className="mr-2 h-4 w-4" />Open Auth Workflow</Button>
          )}
          {!isPatientView && kind === "lastPaid" && (
            <Button variant="outline" className="w-full"><ExternalLink className="mr-2 h-4 w-4" />Open in Claims UI</Button>
          )}
          {isPatientView && (
            <Button variant="outline" className="w-full" asChild>
              <a href={`https://medicallymodern-force.monday.com/boards/18407459988/pulses/${patient.mondayItemId}`} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />Open in Monday
              </a>
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export function SubscriptionBoard() {
  const [phase, setPhase] = useState<PhaseTab>("overview");
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>("All payers");
  const [blocked, setBlocked] = useState<string>("Anyone");
  const [statusFilter, setStatusFilter] = useState<string>("Active");
  const [pauseReason, setPauseReason] = useState<string>("Any pause reason");
  const [activePatient, setActivePatient] = useState<SubscriptionPatient | null>(null);
  const [activeKind, setActiveKind] = useState<CheckpointKind | "patient" | null>(null);

  const all = ORDER_PREP_PATIENTS;

  const counts = useMemo(() => {
    const c = { overview: 0, confirmation: 0, benefits: 0, auth: 0, lastPaid: 0, ready: 0 };
    for (const p of all) { c.overview++; c[currentPhase(p)]++; }
    return c;
  }, [all]);

  const openCell = (p: SubscriptionPatient, kind: CheckpointKind) => { setActivePatient(p); setActiveKind(kind); };
  const openPatient = (p: SubscriptionPatient) => { setActivePatient(p); setActiveKind("patient"); };
  const closeDrawer = () => { setActivePatient(null); setActiveKind(null); };
  const sendToOrderBoard = (_p: SubscriptionPatient) => {
    // TODO: wire to backend /order/webhook when available.
  };

  const filteredAll = useMemo(() => {
    return all.filter((p) => {
      if (search) {
        const q = search.trim().toLowerCase();
        const digits = q.replace(/\D/g, "");
        const nameMatch = p.name.toLowerCase().includes(q);
        const idMatch = p.mondayItemId.includes(q);
        const phoneMatch = digits.length > 0 && p.phone.replace(/\D/g, "").includes(digits);
        if (!nameMatch && !idMatch && !phoneMatch) return false;
      }
      if (payer !== "All payers" && p.primaryPayer !== payer) return false;
      if (statusFilter !== "All" && p.patientStatus !== statusFilter) return false;
      if (pauseReason !== "Any pause reason" && p.pauseReason !== pauseReason) return false;
      if (blocked !== "Anyone") {
        const map = { Us: "us", Patient: "patient", Payer: "payer", System: "system" } as const;
        if (p.blockedBy !== map[blocked as keyof typeof map]) return false;
      }
      return true;
    });
  }, [all, search, payer, blocked, statusFilter, pauseReason]);

  const rows = useMemo(() => {
    if (phase === "overview") return filteredAll;
    return filteredAll.filter((p) => currentPhase(p) === phase);
  }, [filteredAll, phase]);

  const phaseKpis = useMemo(() => {
    if (phase === "overview") {
      return [
        { tone: "info"    as const, label: "Confirmation",     value: counts.confirmation },
        { tone: "warning" as const, label: "Eligibility",      value: counts.benefits },
        { tone: "danger"  as const, label: "Authorization",    value: counts.auth },
        { tone: "warning" as const, label: "Last Order Paid",  value: counts.lastPaid },
        { tone: "success" as const, label: "Ready to Submit",  value: counts.ready },
        { tone: "neutral" as const, label: "All Open",         value: counts.overview },
      ];
    }
    const blockedCount = (party: BlockedParty) =>
      filteredAll.filter((p) => currentPhase(p) === phase && p.blockedBy === party).length;
    return [
      { tone: "neutral" as const, label: `In ${PHASE_LABELS[phase]}`, value: rows.length },
      { tone: "warning" as const, label: "Blocked by patient",        value: blockedCount("patient") },
      { tone: "info"    as const, label: "Waiting on payer",          value: blockedCount("payer") },
      { tone: "danger"  as const, label: "Needs us to act",           value: blockedCount("us") },
      { tone: "neutral" as const, label: "System-paced",              value: blockedCount("system") },
      { tone: "success" as const, label: "Overrides applied",
        value: filteredAll.filter((p) => currentPhase(p) === phase
          && (p.confirmation.overrideReason || p.benefits.overrideReason
              || p.auth.overrideReason || p.lastPaid.overrideReason)).length },
    ];
  }, [phase, filteredAll, rows, counts]);

  const renderPhaseTab = (k: PhaseTab, label: string, count: number) => (
    <TabsTrigger value={k} className="gap-1.5">
      {label}
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{count}</span>
    </TabsTrigger>
  );

  return (
    <div className="space-y-4">
      {/* Phase tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={phase} onValueChange={(v) => setPhase(v as PhaseTab)}>
          <TabsList className="bg-card border flex-wrap">
            {renderPhaseTab("overview",     "Overview",         counts.overview)}
            {renderPhaseTab("confirmation", "Confirmation",     counts.confirmation)}
            {renderPhaseTab("benefits",     "Eligibility",      counts.benefits)}
            {renderPhaseTab("auth",         "Authorization",    counts.auth)}
            {renderPhaseTab("lastPaid",     "Last Order Paid",  counts.lastPaid)}
            {renderPhaseTab("ready",        "Submit Order",     counts.ready)}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {phase === "confirmation" && (
            <Button variant="outline" size="sm"><Send className="mr-2 h-4 w-4" />Send Reorder Text</Button>
          )}
          {phase === "benefits" && (
            <Button variant="outline" size="sm"><RefreshCw className="mr-2 h-4 w-4" />Run Eligibility Batch</Button>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {phaseKpis.map((k) => (<KpiTile key={k.label} {...k} />))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, phone, Monday ID" className="pl-9" />
        </div>
        <Select value={payer} onValueChange={setPayer}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>{PAYER_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={blocked} onValueChange={setBlocked}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Blocked by" /></SelectTrigger>
          <SelectContent>{BLOCKED_BY_OPTIONS.map((b) => <SelectItem key={b} value={b}>{b === "Anyone" ? "Blocked by: anyone" : `Blocked by ${b}`}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>{PATIENT_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s === "All" ? "All statuses" : s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={pauseReason} onValueChange={setPauseReason}>
          <SelectTrigger className="w-[240px]"><SelectValue placeholder="Pause reason" /></SelectTrigger>
          <SelectContent className="max-h-[360px]">{PAUSE_REASON_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Table per phase */}
      <Card className="overflow-hidden">
        {phase === "overview" ? (
          <OverviewTable
            rows={rows}
            onCellClick={openCell}
            onPatientClick={openPatient}
            onSubmit={sendToOrderBoard}
          />
        ) : phase === "ready" ? (
          <SubmitTable rows={rows} onPatientClick={openPatient} onSubmit={sendToOrderBoard} />
        ) : (
          <PhaseTable
            rows={rows}
            phase={phase}
            onCellClick={openCell}
            onPatientClick={openPatient}
            onSubmit={sendToOrderBoard}
          />
        )}
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {phase === "ready" ? "Nothing ready to submit yet." : "No patients in this phase right now."}
          </div>
        )}
      </Card>

      <PatientDrawer patient={activePatient} kind={activeKind} onClose={closeDrawer} />
    </div>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────

const OVERVIEW_GRID = "grid grid-cols-[200px_90px_130px_170px_minmax(64px,1fr)_minmax(64px,1fr)_minmax(64px,1fr)_minmax(64px,1fr)_240px] gap-3";

function OverviewTable({
  rows, onCellClick, onPatientClick, onSubmit,
}: {
  rows: SubscriptionPatient[];
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
}) {
  return (
    <div className="text-[13px]">
      <div className={cn(OVERVIEW_GRID, "border-b bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground items-end")}>
        <div>Patient</div>
        <div>Order</div>
        <div>Subscription</div>
        <div>Primary Payer</div>
        <div className="text-center">Conf</div>
        <div className="text-center">Elig</div>
        <div className="text-center">Auth</div>
        <div className="text-center">Paid</div>
        <div className="text-right pr-2">Actions</div>
      </div>
      {rows.map((p) => (
        <div key={p.id} className={cn(OVERVIEW_GRID, "border-b px-4 py-3 hover:bg-muted/20 items-center")}>
          <button type="button" onClick={() => onPatientClick(p)} className="text-left">
            <div className="text-[13px] font-semibold flex items-center">{p.name}<PauseBadge patient={p} /></div>
            <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
          </button>
          <div>
            <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">in {daysBetween(p.nextOrderDate)}d</div>
          </div>
          <div><span className={SUB_TYPE_PILLS[p.subscriptionType]}>{p.subscriptionType}</span></div>
          <div className="text-[13px] truncate">{p.primaryPayer}</div>
          <div className="flex justify-center"><CheckpointCircle check={p.confirmation} onClick={() => onCellClick(p, "confirmation")} /></div>
          <div className="flex justify-center"><CheckpointCircle check={p.benefits}     onClick={() => onCellClick(p, "benefits")} /></div>
          <div className="flex justify-center"><CheckpointCircle check={p.auth}          onClick={() => onCellClick(p, "auth")} /></div>
          <div className="flex justify-center"><CheckpointCircle check={p.lastPaid}      onClick={() => onCellClick(p, "lastPaid")} /></div>
          <ReviewAndSubmit p={p} onReview={() => onPatientClick(p)} onSubmit={() => onSubmit(p)} />
        </div>
      ))}
    </div>
  );
}

function PhaseTable({
  rows, phase, onCellClick, onPatientClick, onSubmit,
}: {
  rows: SubscriptionPatient[];
  phase: CheckpointKind;
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[220px]">Patient</TableHead>
          <TableHead className="w-[100px]">Order</TableHead>
          <TableHead className="w-[140px]">Subscription</TableHead>
          <TableHead className="w-[170px]">Primary Payer</TableHead>
          <TableHead className="w-[60px] text-center">{PHASE_LABELS[phase]}</TableHead>
          <TableHead className="w-[120px]">Blocked By</TableHead>
          <TableHead className="w-[170px]">Next Check-In</TableHead>
          <TableHead>Why Stuck</TableHead>
          <TableHead className="w-[260px] text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const c = getCheckpoint(p, phase);
          return (
            <TableRow key={p.id} className="align-top">
              <TableCell>
                <button type="button" onClick={() => onPatientClick(p)} className="text-left">
                  <div className="text-[13px] font-semibold flex items-center">{p.name}<PauseBadge patient={p} /></div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
                </button>
              </TableCell>
              <TableCell>
                <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">in {daysBetween(p.nextOrderDate)}d</div>
              </TableCell>
              <TableCell><span className={SUB_TYPE_PILLS[p.subscriptionType]}>{p.subscriptionType}</span></TableCell>
              <TableCell className="text-[13px]">{p.primaryPayer}</TableCell>
              <TableCell><div className="flex justify-center"><CheckpointCircle check={c} onClick={() => onCellClick(p, phase)} /></div></TableCell>
              <TableCell><BlockedByPill value={p.blockedBy} /></TableCell>
              <TableCell><CheckInCell iso={p.nextCheckIn} stuckSince={p.stuckSince} /></TableCell>
              <TableCell className="text-[12px] text-muted-foreground max-w-[340px]">{p.stuckReason ?? "—"}</TableCell>
              <TableCell><ReviewAndSubmit p={p} onReview={() => onPatientClick(p)} onSubmit={() => onSubmit(p)} /></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SubmitTable({
  rows, onPatientClick, onSubmit,
}: {
  rows: SubscriptionPatient[];
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead>Order Date</TableHead>
          <TableHead>Subscription</TableHead>
          <TableHead>Primary Payer</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <div className="text-[13px] font-semibold flex items-center">{p.name}<PauseBadge patient={p} /></div>
              <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
            </TableCell>
            <TableCell>
              <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">in {daysBetween(p.nextOrderDate)}d</div>
            </TableCell>
            <TableCell><span className={SUB_TYPE_PILLS[p.subscriptionType]}>{p.subscriptionType}</span></TableCell>
            <TableCell>{p.primaryPayer}</TableCell>
            <TableCell><ReviewAndSubmit p={p} onReview={() => onPatientClick(p)} onSubmit={() => onSubmit(p)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
