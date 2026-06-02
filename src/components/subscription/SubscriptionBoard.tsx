/**
 * SubscriptionBoard.tsx — Subscription Board tab in the Claims Command Center.
 *
 * Aligned to:
 *   - SUBSCRIPTION_WORKFLOW_OVERVIEW.html — hard vs soft constraints,
 *     operator override, Medicaid DVS, MR is intentionally NOT a check
 *   - SUBSCRIPTION_UI_TOOL_PRD.md — 2 sub-tabs, KPI grid, table density,
 *     per-checkpoint drawer pattern with distinct content per cell type
 *
 * Mock data only; backend wiring lands separately.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, Clock, ExternalLink, Lock, RefreshCw,
  Search, Send, ShieldOff, Unlock, X,
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
  CHECKPOINT_GATE, CHECKPOINT_STATE_OPTIONS, Checkpoint, CheckpointKind,
  ORDER_PREP_PATIENTS, PAYER_OPTIONS, SUBMIT_ORDER_PATIENTS,
  SubscriptionPatient,
} from "./mockData";

type SubTab = "prep" | "submit";

const SUB_TYPE_PILL =
  "inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700";

// ─── Checkpoint cell ─────────────────────────────────────────────────────────
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

// ─── Run Check column pill (Subscription Board state) ───────────────────────
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

// ─── Header label with hard/soft gate badge ─────────────────────────────────
function GateHeader({ label, kind }: { label: string; kind: CheckpointKind }) {
  const gate = CHECKPOINT_GATE[kind];
  return (
    <div className="flex items-center gap-1.5">
      <span>{label}</span>
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
    </div>
  );
}

function nextActionLabel(p: SubscriptionPatient): { label: string; primary: boolean; kind: CheckpointKind | null } {
  if (p.confirmation.tone !== "ok") return { label: "Review Confirmation", primary: false, kind: "confirmation" };
  if (p.benefits.tone !== "ok")     return { label: "Run Eligibility",     primary: false, kind: "benefits" };
  if (p.auth.tone !== "ok")         return { label: "Work Auth",            primary: false, kind: "auth" };
  if (p.lastPaid.tone !== "ok")     return { label: "Open Last Claim",     primary: false, kind: "lastPaid" };
  return { label: "Submit Order", primary: true, kind: null };
}

/** Per PRD §8: red bar when ANY cell is bad; amber only when ANY cell is warn (pending stays no-accent). */
function rowAccent(p: SubscriptionPatient): "red" | "amber" | "none" {
  const cells = [p.confirmation, p.benefits, p.auth, p.lastPaid];
  if (cells.some((c) => c.tone === "bad")) return "red";
  if (cells.some((c) => c.tone === "warn")) return "amber";
  return "none";
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function daysFromToday(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// ─── KPI tile ────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sublines, tone,
}: {
  label: string;
  value: string | number;
  sublines?: Array<{ label: string; value: string | number }>;
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
}) {
  const dotPalette = {
    info:    "bg-sky-100 text-sky-600",
    warning: "bg-amber-100 text-amber-600",
    danger:  "bg-rose-100 text-rose-600",
    success: "bg-emerald-100 text-emerald-600",
    neutral: "bg-slate-100 text-slate-600",
  }[tone ?? "neutral"];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg", dotPalette)}>
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

// ─── Checkpoint drawer — different content per checkpoint kind ──────────────
function CheckpointDrawer({
  patient, kind, onClose,
}: {
  patient: SubscriptionPatient | null;
  kind: CheckpointKind | "patient" | null;
  onClose: () => void;
}) {
  const open = !!patient && !!kind;
  if (!patient || !kind) {
    return (
      <Sheet open={false} onOpenChange={(o) => !o && onClose()}>
        <SheetContent />
      </Sheet>
    );
  }

  const isPatientView = kind === "patient";
  const checkpoint: Checkpoint | null =
    kind === "confirmation" ? patient.confirmation :
    kind === "benefits"     ? patient.benefits :
    kind === "auth"         ? patient.auth :
    kind === "lastPaid"     ? patient.lastPaid : null;

  const checkpointTitle = ({
    confirmation: "Patient Confirmation",
    benefits:     "Benefits & Eligibility",
    auth:         "Authorization",
    lastPaid:     "Last Order — Claim Status",
    patient:      "Patient overview",
  } as const)[kind];

  const checkpointKindForGate: CheckpointKind | null =
    kind === "patient" ? null : kind;
  const gate = checkpointKindForGate ? CHECKPOINT_GATE[checkpointKindForGate] : null;
  const isSoft = gate === "soft";
  const isFailing = checkpoint && checkpoint.tone !== "ok";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className={cn(isPatientView ? "w-[640px] sm:max-w-[640px]" : "w-[480px] sm:max-w-[480px]")}>
        <SheetHeader>
          <SheetTitle>{checkpointTitle}</SheetTitle>
          <SheetDescription>
            {patient.name} · {patient.subscriptionType} · {patient.primaryPayer} · order {fmtDate(patient.nextOrderDate)}
          </SheetDescription>
        </SheetHeader>

        {/* Patient overview drawer */}
        {isPatientView && (
          <div className="mt-6 space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Readiness checks</div>
              <div className="space-y-2">
                {([
                  ["1. Confirmation",     "confirmation"],
                  ["2. Benefits active",  "benefits"],
                  ["3. Auth valid",       "auth"],
                  ["4. Last order paid",  "lastPaid"],
                ] as const).map(([name, k]) => {
                  const c = k === "confirmation" ? patient.confirmation
                          : k === "benefits"     ? patient.benefits
                          : k === "auth"         ? patient.auth
                          : patient.lastPaid;
                  return (
                    <Card key={name} className="p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[13px] font-semibold">{name}</div>
                        {c.detail && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">{c.detail}</div>
                        )}
                        {c.overrideReason && (
                          <div className="mt-1 text-[11px] text-slate-600 italic">
                            override: {c.overrideReason}
                          </div>
                        )}
                      </div>
                      <CheckpointCell check={c} />
                    </Card>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Patient info</div>
              <Card className="p-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{patient.phone}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Monday ID</span><span className="font-mono text-[11px]">{patient.mondayItemId}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Subscription</span><span>{patient.subscriptionType}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Primary payer</span><span>{patient.primaryPayer}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Next order</span><span>{fmtDate(patient.nextOrderDate)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Run Check</span><RunCheckPill value={patient.runCheck} /></div>
              </Card>
            </div>
          </div>
        )}

        {/* Per-checkpoint drawer */}
        {!isPatientView && checkpoint && (
          <div className="mt-6 space-y-4">
            {/* Status header */}
            <Card className="p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Current status</div>
                <CheckpointCell check={checkpoint} />
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                    gate === "hard" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500",
                  )}
                  title={gate === "hard"
                    ? "Hard constraint — claim denial risk if overridden"
                    : "Soft constraint — operator can override with logged reason"}
                >
                  {gate === "hard" ? <Lock className="h-2.5 w-2.5" /> : <ShieldOff className="h-2.5 w-2.5" />}
                  {gate}
                </span>
              </div>
            </Card>

            {/* Checkpoint-specific content */}
            {kind === "confirmation" && (
              <Card className="p-4 space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Reorder form submission</div>
                <div className="text-[13px]">
                  {patient.confirmation.tone === "ok"
                    ? "Patient confirmed the order. Read the change summary below."
                    : patient.confirmation.tone === "pending"
                    ? "Awaiting patient response. Use the Resend button or move to next reminder day."
                    : "Patient flagged changes / hasn't responded. Operator review required."}
                </div>
                {patient.confirmation.detail && (
                  <div className="text-[12px] text-muted-foreground">{patient.confirmation.detail}</div>
                )}
              </Card>
            )}
            {kind === "benefits" && (
              <Card className="p-4 space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Latest eligibility (Stedi 271)</div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="text-muted-foreground">Active</div><div className="tabular-nums">{patient.benefits.label}</div>
                  <div className="text-muted-foreground">Payer</div><div>{patient.primaryPayer}</div>
                  <div className="text-muted-foreground">Detail</div><div>{patient.benefits.detail ?? "—"}</div>
                </div>
              </Card>
            )}
            {kind === "auth" && (
              <Card className="p-4 space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Authorization detail</div>
                <div className="text-[13px]">{patient.auth.label}</div>
                {patient.auth.detail && (
                  <div className="text-[12px] text-muted-foreground">{patient.auth.detail}</div>
                )}
                {patient.auth.label === "DVS at order" && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
                    <strong className="block mb-0.5">Medicaid Supplies — DVS exception</strong>
                    Check 3 fires a DVS submission to ePACES when the order is created.
                    The DVS response is the auth verdict — no pre-existing auth needed.
                  </div>
                )}
              </Card>
            )}
            {kind === "lastPaid" && (
              <Card className="p-4 space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Prior claim status</div>
                <div className="text-[13px]">{patient.lastPaid.label}</div>
                {patient.lastPaid.detail && (
                  <div className="text-[12px] text-muted-foreground">{patient.lastPaid.detail}</div>
                )}
              </Card>
            )}

            {/* Override path for soft constraints */}
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
                    <Textarea
                      placeholder="Reason for overriding this check (required, will be logged on the patient row)…"
                      className="min-h-[72px] text-[13px]"
                    />
                    <Button size="sm" variant="default" className="w-full">
                      <Unlock className="mr-2 h-3.5 w-3.5" /> Approve override + log reason
                    </Button>
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
                    The claim will be denied if shipped in this state. Resolve via the workflow below before the order can advance.
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        <SheetFooter className="mt-6">
          {/* Primary action — depends on checkpoint */}
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
              <a
                href={`https://medicallymodern-force.monday.com/boards/18407459988/pulses/${patient.mondayItemId}`}
                target="_blank" rel="noreferrer"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open in Monday
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
  const [subTab, setSubTab] = useState<SubTab>("prep");
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>("All payers");
  const [stateFilter, setStateFilter] = useState<string>("All states");
  const [activePatient, setActivePatient] = useState<SubscriptionPatient | null>(null);
  const [activeKind, setActiveKind] = useState<CheckpointKind | "patient" | null>(null);

  const prep = ORDER_PREP_PATIENTS;
  const submit = SUBMIT_ORDER_PATIENTS;

  const openCell = (p: SubscriptionPatient, kind: CheckpointKind) => {
    setActivePatient(p); setActiveKind(kind);
  };
  const openPatient = (p: SubscriptionPatient) => {
    setActivePatient(p); setActiveKind("patient");
  };
  const closeDrawer = () => { setActivePatient(null); setActiveKind(null); };

  const kpis = useMemo(() => {
    const awaiting = prep.filter((p) => p.confirmation.tone === "pending" && p.confirmation.label !== "Not sent").length;
    const changes  = prep.filter((p) => p.confirmation.label === "Review changes").length;
    const noResp   = prep.filter((p) => p.confirmation.label === "No response").length;
    const blocked  = prep.filter((p) => rowAccent(p) === "red").length;
    const ready    = submit.length;
    const allOpen  = prep.length + submit.length;
    return { total: prep.length, awaiting, changes, noResp, blocked, ready, allOpen };
  }, [prep, submit]);

  const filteredPrep = useMemo(() => {
    return prep.filter((p) => {
      if (search) {
        const q = search.trim().toLowerCase();
        const digits = q.replace(/\D/g, "");
        const nameMatch = p.name.toLowerCase().includes(q);
        const idMatch = p.mondayItemId.includes(q);
        // Only match phone if query contains digits — fixes the empty-digit
        // match bug where alphabetic queries silently matched every row.
        const phoneMatch = digits.length > 0 && p.phone.replace(/\D/g, "").includes(digits);
        if (!nameMatch && !idMatch && !phoneMatch) return false;
      }
      if (payer !== "All payers" && p.primaryPayer !== payer) return false;
      if (stateFilter !== "All states") {
        if (stateFilter === "Awaiting Response" && p.confirmation.tone !== "pending") return false;
        if (stateFilter === "Review Changes" && p.confirmation.label !== "Review changes") return false;
        if (stateFilter === "No Response" && p.confirmation.label !== "No response") return false;
        if (stateFilter === "Delayed" && p.confirmation.label !== "Delayed") return false;
        if (stateFilter === "Confirmed" && p.confirmation.tone !== "ok") return false;
        if (stateFilter === "Benefits Inactive" && p.benefits.label !== "Inactive") return false;
        if (stateFilter === "Benefits Stale" && p.benefits.label !== "Stale") return false;
        if (stateFilter === "Auth Expiring" && !p.auth.label.startsWith("Renew")) return false;
        if (stateFilter === "Auth Expired" && p.auth.label !== "Expired") return false;
        if (stateFilter === "Auth Missing" && p.auth.label !== "Missing") return false;
        if (stateFilter === "DVS at order (Medicaid)" && p.auth.label !== "DVS at order") return false;
        if (stateFilter === "Last Claim Unpaid" && p.lastPaid.tone !== "bad") return false;
      }
      return true;
    });
  }, [prep, search, payer, stateFilter]);

  return (
    <div className="space-y-4">
      {/* Sub-tabs + bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={subTab} onValueChange={(v) => setSubTab(v as SubTab)}>
          <TabsList className="bg-card border">
            <TabsTrigger value="prep">Order Preparation</TabsTrigger>
            <TabsTrigger value="submit">Submit Order</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Send className="mr-2 h-4 w-4" /> Send Reorder Text
          </Button>
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Run Eligibility Batch
          </Button>
        </div>
      </div>

      {subTab === "prep" ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile tone="info"    label="Awaiting Response" value={kpis.awaiting} />
            <KpiTile tone="warning" label="Changes to Review" value={kpis.changes} />
            <KpiTile tone="danger"  label="Action Needed"     value={kpis.blocked}
              sublines={[
                { label: "auth",        value: prep.filter(p => p.auth.tone === "bad").length },
                { label: "benefits",    value: prep.filter(p => p.benefits.tone === "bad").length },
                { label: "prior claim", value: prep.filter(p => p.lastPaid.tone === "bad").length },
              ]} />
            <KpiTile tone="neutral" label="Patients in Prep"  value={kpis.total} />
            <KpiTile tone="success" label="Ready to Submit"   value={kpis.ready} />
            <KpiTile tone="neutral" label="All Open"          value={kpis.allOpen} />
          </div>

          {/* Search + filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patient, phone, Monday ID"
                className="pl-9"
              />
            </div>
            <Select value={payer} onValueChange={setPayer}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYER_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-[230px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHECKPOINT_STATE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Order Preparation table */}
          <Card className="overflow-hidden">
            <div className="text-[13px]">
              <div className="grid grid-cols-[210px_120px_140px_180px_64px_140px_140px_140px_140px_150px] gap-3 border-b bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground items-end">
                <div>Patient</div>
                <div>Order Date</div>
                <div>Subscription</div>
                <div>Primary Payer</div>
                <div title="Subscription Board Run Check column">Run Check</div>
                <div><GateHeader label="Confirmation" kind="confirmation" /></div>
                <div><GateHeader label="Benefits" kind="benefits" /></div>
                <div><GateHeader label="Auth" kind="auth" /></div>
                <div><GateHeader label="Last Paid" kind="lastPaid" /></div>
                <div>Action</div>
              </div>
              {filteredPrep.map((p) => {
                const accent = rowAccent(p);
                const action = nextActionLabel(p);
                const days = daysFromToday(p.nextOrderDate);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "relative grid grid-cols-[210px_120px_140px_180px_64px_140px_140px_140px_140px_150px] gap-3 border-b px-4 py-3 hover:bg-muted/20 items-start",
                      accent !== "none" && "pl-[20px]",
                    )}
                  >
                    {accent !== "none" && (
                      <span className={cn(
                        "absolute left-0 top-0 h-full w-[3px]",
                        accent === "red" ? "bg-rose-500" : "bg-amber-400",
                      )} />
                    )}
                    <button type="button" onClick={() => openPatient(p)} className="text-left">
                      <div className="text-[13px] font-semibold text-foreground">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone} · {p.mondayItemId}</div>
                    </button>
                    <div>
                      <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {days > 0 ? `in ${days}d` : days === 0 ? "today" : `${-days}d ago`}
                      </div>
                    </div>
                    <div><span className={SUB_TYPE_PILL}>{p.subscriptionType}</span></div>
                    <div>
                      <div className="text-[13px]">{p.primaryPayer}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.benefits.tone === "ok" ? "Active" : p.benefits.label}
                      </div>
                    </div>
                    <div className="pt-0.5"><RunCheckPill value={p.runCheck} /></div>
                    <CheckpointCell check={p.confirmation} onClick={() => openCell(p, "confirmation")} />
                    <CheckpointCell check={p.benefits}     onClick={() => openCell(p, "benefits")} />
                    <CheckpointCell check={p.auth}          onClick={() => openCell(p, "auth")} />
                    <CheckpointCell check={p.lastPaid}      onClick={() => openCell(p, "lastPaid")} />
                    <div className="flex items-start">
                      <Button
                        size="sm"
                        variant={action.primary ? "default" : "outline"}
                        className="h-7 text-[11px]"
                        onClick={() => action.kind ? openCell(p, action.kind) : openPatient(p)}
                      >
                        {action.label}
                        <ArrowRight className="ml-1.5 h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {filteredPrep.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No patients match the current filters.
                </div>
              )}
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile tone="success" label="Ready to Submit"    value={submit.length} />
            <KpiTile tone="success" label="Submitted today"    value={0} />
            <KpiTile tone="neutral" label="Submitted this week" value={0} />
            <KpiTile tone="neutral" label="Avg time in queue"  value="< 1d" />
            <KpiTile tone="neutral" label="Total OOP"          value="$2,890" />
            <KpiTile tone="neutral" label="Oldest waiting"     value="2d" />
          </div>

          <Card className="overflow-hidden">
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
                {submit.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="text-[13px] font-semibold">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">in {daysFromToday(p.nextOrderDate)}d</div>
                    </TableCell>
                    <TableCell><span className={SUB_TYPE_PILL}>{p.subscriptionType}</span></TableCell>
                    <TableCell>{p.primaryPayer}</TableCell>
                    <TableCell className="tabular-nums">$0.00</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm">
                        <Send className="mr-1.5 h-3 w-3" /> Submit Order
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      <CheckpointDrawer patient={activePatient} kind={activeKind} onClose={closeDrawer} />
    </div>
  );
}
