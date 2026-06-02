/**
 * SubscriptionBoard.tsx — Subscription Board tab in the Claims Command Center.
 *
 * The sub-tab nav matches the operator's actual workflow: they batch through
 * Confirmation, then Eligibility, then Auth, then Last Paid, then submit. Each
 * tab shows the patients currently STUCK in that phase (leftmost not-ok check),
 * with stuck-since, next check-in, and who's blocked-by (us / patient / payer
 * / system) so it's clear why someone hasn't moved and when to revisit.
 *
 * "Overview" shows the full 4-column readiness table for the whole cohort.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Building2, Check, Clock, ExternalLink,
  Heart, Lock, RefreshCw, Search, Send, Server, ShieldOff, UserCog, Users,
  Unlock, X,
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
  currentPhase, ORDER_PREP_PATIENTS, PAYER_OPTIONS, PHASE_LABELS,
  SubscriptionPatient,
} from "./mockData";

type PhaseTab = "overview" | CheckpointKind | "ready";

const SUB_TYPE_PILL =
  "inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function daysBetween(iso: string, base = new Date()) {
  const d = new Date(iso + "T00:00:00");
  const baseDay = new Date(base);
  baseDay.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - baseDay.getTime()) / 86_400_000);
}
function getCheckpoint(p: SubscriptionPatient, kind: CheckpointKind): Checkpoint {
  switch (kind) {
    case "confirmation": return p.confirmation;
    case "benefits":     return p.benefits;
    case "auth":         return p.auth;
    case "lastPaid":     return p.lastPaid;
  }
}

// ─── Atoms ───────────────────────────────────────────────────────────────────
function CheckpointCell({ check, onClick }: { check: Checkpoint; onClick?: () => void }) {
  const palette = {
    ok:      { ring: "ring-emerald-200 bg-emerald-50",  text: "text-emerald-700",  icon: <Check className="h-3.5 w-3.5" /> },
    warn:    { ring: "ring-amber-200 bg-amber-50",      text: "text-amber-700",    icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    bad:     { ring: "ring-rose-200 bg-rose-50",        text: "text-rose-700",     icon: <X className="h-3.5 w-3.5" /> },
    pending: { ring: "ring-sky-200 bg-sky-50",          text: "text-sky-700",      icon: <Clock className="h-3.5 w-3.5" /> },
  }[check.tone];

  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <div className={cn("flex items-center gap-1.5", palette.text)}>
        <span className={cn("inline-grid h-5 w-5 place-items-center rounded-full ring-1", palette.ring)}>
          {palette.icon}
        </span>
        <span className="text-[13px] font-semibold">{check.label}</span>
        {check.overrideReason && (
          <span title={check.overrideReason}>
            <Unlock className="h-3 w-3 text-slate-400" aria-label="Operator override applied" />
          </span>
        )}
      </div>
      {check.detail && (
        <div className="ml-6 mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
          {check.detail}
        </div>
      )}
    </button>
  );
}

function RunCheckPill({ value }: { value: SubscriptionPatient["runCheck"] }) {
  const palette = {
    Pass:   "bg-emerald-100 text-emerald-700",
    Failed: "bg-rose-100 text-rose-700",
    Run:    "bg-sky-100 text-sky-700",
    Batch:  "bg-violet-100 text-violet-700",
    "—":    "bg-slate-100 text-slate-500",
  }[value];
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", palette)}>
      {value}
    </span>
  );
}

function GateBadge({ kind }: { kind: CheckpointKind }) {
  const gate = CHECKPOINT_GATE[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8.5px] font-bold uppercase tracking-tight",
        gate === "hard" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500",
      )}
      title={gate === "hard"
        ? "Hard constraint — claim denial risk if overridden"
        : "Soft constraint — operator can override with logged reason"}
    >
      {gate === "hard" ? <Lock className="h-2.5 w-2.5" /> : <ShieldOff className="h-2.5 w-2.5" />}
      {gate}
    </span>
  );
}

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

function CheckInCell({ iso, stuckSince }: { iso?: string; stuckSince?: string }) {
  if (!iso) return <span className="text-[11px] text-muted-foreground">—</span>;
  const days = daysBetween(iso);
  const tone =
    days < 0 ? "text-rose-600 font-semibold" :
    days === 0 ? "text-amber-700 font-semibold" :
    days <= 2 ? "text-amber-700" :
    "text-foreground";
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

function KpiTile({ label, value, tone, sublines }: {
  label: string;
  value: string | number;
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  sublines?: Array<{ label: string; value: string | number }>;
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
          <Clock className="h-4 w-4" />
        </div>
        <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{label}</div>
      {sublines && sublines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-muted-foreground">
          {sublines.map((s) => (
            <li key={s.label}>
              <span className="mr-1.5 text-foreground/80">{s.label}:</span>
              <span className="tabular-nums">{s.value}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Drawer (per-checkpoint + patient view) ─────────────────────────────────
function CheckpointDrawer({
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
    patient:      "Patient overview",
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
                        {c.detail && <div className="text-[11px] text-muted-foreground mt-0.5">{c.detail}</div>}
                        {c.overrideReason && (
                          <div className="mt-1 text-[11px] text-slate-600 italic">override: {c.overrideReason}</div>
                        )}
                      </div>
                      <CheckpointCell check={c} />
                    </Card>
                  );
                })}
              </div>
            </div>
            {patient.stuckReason && (
              <Card className="p-3 border-amber-200 bg-amber-50">
                <div className="text-[11px] uppercase tracking-wide text-amber-700">Why stuck</div>
                <div className="text-[13px] text-slate-800 mt-1">{patient.stuckReason}</div>
                <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
                  {patient.blockedBy && <span>Blocked by: <BlockedByPill value={patient.blockedBy} /></span>}
                  {patient.nextCheckIn && <span>Next check-in: {fmtDate(patient.nextCheckIn)}</span>}
                </div>
              </Card>
            )}
            <Card className="p-3 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{patient.phone}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Monday ID</span><span className="font-mono text-[11px]">{patient.mondayItemId}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Run Check</span><RunCheckPill value={patient.runCheck} /></div>
            </Card>
          </div>
        ) : checkpoint && (
          <div className="mt-6 space-y-4">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current status</div>
                <CheckpointCell check={checkpoint} />
              </div>
              <GateBadge kind={kind as CheckpointKind} />
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
                  Check 3 fires a DVS submission to ePACES when the order is created. The DVS response is the auth verdict — no pre-existing auth needed.
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
                    <Textarea placeholder="Reason for overriding this check (required, logged on patient row)…" className="min-h-[72px] text-[13px]" />
                    <Button size="sm" className="w-full"><Unlock className="mr-2 h-3.5 w-3.5" />Approve override + log reason</Button>
                  </>
                )}
              </Card>
            )}
            {gate === "hard" && isFailing && (
              <Card className="p-4 bg-rose-50 border-rose-200">
                <div className="flex items-start gap-2 text-[12px] text-rose-700">
                  <Lock className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold mb-0.5">Hard constraint — cannot override</div>
                    Claim will be denied if shipped in this state. Resolve via the workflow before the order can advance.
                  </div>
                </div>
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
  const [activePatient, setActivePatient] = useState<SubscriptionPatient | null>(null);
  const [activeKind, setActiveKind] = useState<CheckpointKind | "patient" | null>(null);

  const all = ORDER_PREP_PATIENTS;

  const counts = useMemo(() => {
    const c = { overview: 0, confirmation: 0, benefits: 0, auth: 0, lastPaid: 0, ready: 0 };
    for (const p of all) {
      c.overview++;
      c[currentPhase(p)]++;
    }
    return c;
  }, [all]);

  const openCell = (p: SubscriptionPatient, kind: CheckpointKind) => { setActivePatient(p); setActiveKind(kind); };
  const openPatient = (p: SubscriptionPatient) => { setActivePatient(p); setActiveKind("patient"); };
  const closeDrawer = () => { setActivePatient(null); setActiveKind(null); };

  // Filter by search + payer + blockedBy
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
      if (blocked !== "Anyone") {
        const map = { Us: "us", Patient: "patient", Payer: "payer", System: "system" } as const;
        if (p.blockedBy !== map[blocked as keyof typeof map]) return false;
      }
      return true;
    });
  }, [all, search, payer, blocked]);

  // Phase-specific filter
  const rows = useMemo(() => {
    if (phase === "overview") return filteredAll;
    return filteredAll.filter((p) => currentPhase(p) === phase);
  }, [filteredAll, phase]);

  // Phase-specific KPIs
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
    // Per-phase: who's blocking?
    const blockedCount = (party: BlockedParty) =>
      filteredAll.filter((p) => currentPhase(p) === phase && p.blockedBy === party).length;
    return [
      { tone: "neutral" as const, label: `In ${PHASE_LABELS[phase]}`, value: rows.length },
      { tone: "warning" as const, label: "Blocked by patient",        value: blockedCount("patient") },
      { tone: "info"    as const, label: "Waiting on payer",          value: blockedCount("payer") },
      { tone: "danger"  as const, label: "Needs us to act",           value: blockedCount("us") },
      { tone: "neutral" as const, label: "System-paced",              value: blockedCount("system") },
      { tone: "success" as const, label: "Overrides applied",
        value: filteredAll.filter((p) => currentPhase(p) === phase && (p.confirmation.overrideReason || p.benefits.overrideReason || p.auth.overrideReason || p.lastPaid.overrideReason)).length },
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
        {phaseKpis.map((k) => (
          <KpiTile key={k.label} {...k} />
        ))}
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
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Blocked by" /></SelectTrigger>
          <SelectContent>{BLOCKED_BY_OPTIONS.map((b) => <SelectItem key={b} value={b}>{b === "Anyone" ? "Blocked by: anyone" : `Blocked by ${b}`}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Table — different column set per phase */}
      <Card className="overflow-hidden">
        {phase === "overview" ? (
          <OverviewTable rows={rows} onCellClick={openCell} onPatientClick={openPatient} />
        ) : phase === "ready" ? (
          <SubmitTable rows={rows} />
        ) : (
          <PhaseTable rows={rows} phase={phase} onCellClick={openCell} onPatientClick={openPatient} />
        )}
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {phase === "ready" ? "Nothing ready to submit yet." : "No patients in this phase right now."}
          </div>
        )}
      </Card>

      <CheckpointDrawer patient={activePatient} kind={activeKind} onClose={closeDrawer} />
    </div>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────
function OverviewTable({
  rows, onCellClick, onPatientClick,
}: {
  rows: SubscriptionPatient[];
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
}) {
  return (
    <div className="text-[13px]">
      <div className="grid grid-cols-[200px_100px_120px_160px_60px_130px_130px_130px_130px_120px] gap-3 border-b bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground items-end">
        <div>Patient</div>
        <div>Order</div>
        <div>Subscription</div>
        <div>Primary Payer</div>
        <div>Run</div>
        <div className="flex items-center gap-1.5">Confirm <GateBadge kind="confirmation" /></div>
        <div className="flex items-center gap-1.5">Benefits <GateBadge kind="benefits" /></div>
        <div className="flex items-center gap-1.5">Auth <GateBadge kind="auth" /></div>
        <div className="flex items-center gap-1.5">Last Paid <GateBadge kind="lastPaid" /></div>
        <div>Blocked By</div>
      </div>
      {rows.map((p) => {
        const accent = p.confirmation.tone === "bad" || p.benefits.tone === "bad" || p.auth.tone === "bad" || p.lastPaid.tone === "bad" ? "red"
          : p.confirmation.tone === "warn" || p.benefits.tone === "warn" || p.auth.tone === "warn" || p.lastPaid.tone === "warn" ? "amber"
          : "none";
        return (
          <div key={p.id} className={cn(
            "relative grid grid-cols-[200px_100px_120px_160px_60px_130px_130px_130px_130px_120px] gap-3 border-b px-4 py-3 hover:bg-muted/20 items-start",
            accent !== "none" && "pl-[20px]",
          )}>
            {accent !== "none" && (
              <span className={cn("absolute left-0 top-0 h-full w-[3px]", accent === "red" ? "bg-rose-500" : "bg-amber-400")} />
            )}
            <button type="button" onClick={() => onPatientClick(p)} className="text-left">
              <div className="text-[13px] font-semibold">{p.name}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
            </button>
            <div>
              <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">in {daysBetween(p.nextOrderDate)}d</div>
            </div>
            <div><span className={SUB_TYPE_PILL}>{p.subscriptionType}</span></div>
            <div className="text-[12px] truncate">{p.primaryPayer}</div>
            <div className="pt-0.5"><RunCheckPill value={p.runCheck} /></div>
            <CheckpointCell check={p.confirmation} onClick={() => onCellClick(p, "confirmation")} />
            <CheckpointCell check={p.benefits}     onClick={() => onCellClick(p, "benefits")} />
            <CheckpointCell check={p.auth}          onClick={() => onCellClick(p, "auth")} />
            <CheckpointCell check={p.lastPaid}      onClick={() => onCellClick(p, "lastPaid")} />
            <div className="pt-0.5"><BlockedByPill value={p.blockedBy} /></div>
          </div>
        );
      })}
    </div>
  );
}

function PhaseTable({
  rows, phase, onCellClick, onPatientClick,
}: {
  rows: SubscriptionPatient[];
  phase: CheckpointKind;
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[220px]">Patient</TableHead>
          <TableHead className="w-[100px]">Order</TableHead>
          <TableHead className="w-[120px]">Subscription</TableHead>
          <TableHead className="w-[170px]">Primary Payer</TableHead>
          <TableHead className="w-[180px]">{PHASE_LABELS[phase]} <GateBadge kind={phase} /></TableHead>
          <TableHead className="w-[120px]">Blocked By</TableHead>
          <TableHead className="w-[180px]">Next Check-In</TableHead>
          <TableHead>Why Stuck</TableHead>
          <TableHead className="w-[140px] text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const c = getCheckpoint(p, phase);
          const actionLabel = ({
            confirmation: "Review",
            benefits:     "Run Eligibility",
            auth:         "Work Auth",
            lastPaid:     "Open Claim",
          })[phase];
          return (
            <TableRow key={p.id} className="align-top">
              <TableCell>
                <button type="button" onClick={() => onPatientClick(p)} className="text-left">
                  <div className="text-[13px] font-semibold">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
                </button>
              </TableCell>
              <TableCell>
                <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">in {daysBetween(p.nextOrderDate)}d</div>
              </TableCell>
              <TableCell><span className={SUB_TYPE_PILL}>{p.subscriptionType}</span></TableCell>
              <TableCell className="text-[13px]">{p.primaryPayer}</TableCell>
              <TableCell><CheckpointCell check={c} onClick={() => onCellClick(p, phase)} /></TableCell>
              <TableCell><BlockedByPill value={p.blockedBy} /></TableCell>
              <TableCell><CheckInCell iso={p.nextCheckIn} stuckSince={p.stuckSince} /></TableCell>
              <TableCell className="text-[12px] text-muted-foreground max-w-[340px]">{p.stuckReason ?? "—"}</TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onCellClick(p, phase)}>
                  {actionLabel}<ArrowRight className="ml-1.5 h-3 w-3" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SubmitTable({ rows }: { rows: SubscriptionPatient[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead>Order Date</TableHead>
          <TableHead>Subscription</TableHead>
          <TableHead>Primary Payer</TableHead>
          <TableHead>OOP Est</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <div className="text-[13px] font-semibold">{p.name}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
            </TableCell>
            <TableCell>
              <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">in {daysBetween(p.nextOrderDate)}d</div>
            </TableCell>
            <TableCell><span className={SUB_TYPE_PILL}>{p.subscriptionType}</span></TableCell>
            <TableCell>{p.primaryPayer}</TableCell>
            <TableCell className="tabular-nums">$0.00</TableCell>
            <TableCell className="text-right">
              <Button size="sm"><Send className="mr-1.5 h-3 w-3" />Submit Order</Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Suppress unused-icon warnings if any future TabsTrigger doesn't use them
void Users;
