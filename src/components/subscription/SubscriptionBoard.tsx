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
  ArrowRight, Building2, Check, ClipboardCheck, Clock, ExternalLink, Heart, Loader2,
  MessageSquare, PauseCircle, Pencil, RefreshCw, RefreshCw as ReloadIcon, Search, Send,
  Server, Shield, UserCog, Unlock, UserCircle, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
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

import { Financials } from "./Financials";
import { PatientProfile } from "./PatientProfile";
import { Authorizations } from "./Authorizations";
import { MedicalRecords } from "./MedicalRecords";
import { NewOrders } from "./NewOrders";
import { DvsQueue } from "./DvsQueue";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { runEligibilityCheck, sendToOrder } from "@/api/setSubscriptionPatient";
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

/**
 * Order Prep horizon: how far out we let patients show up in any of the
 * Order Prep sub-tabs (All / Confirmation / Eligibility / Authorization /
 * Last Paid). Anything further than this is "not yet our problem" and
 * just clutters the view. Past-due (negative daysBetween) always shows.
 */
const ORDER_PREP_WINDOW_DAYS = 21;
function withinOrderPrepWindow(p: SubscriptionPatient): boolean {
  if (!p.nextOrderDate) return false;
  return daysBetween(p.nextOrderDate) <= ORDER_PREP_WINDOW_DAYS;
}

// ─── Atoms ───────────────────────────────────────────────────────────────────


/**
 * "Changes" pill — shows next to the circle when the patient flagged
 * something different on their reorder form (new infusion set, address,
 * date, or insurance). Hover shows the list of changes.
 */
// ChangesPill is replaced by the Pencil overlay on CheckpointCircle so
// the circles stay centre-aligned across rows. Kept as a no-op for any
// stale callers — safe to delete once the codebase has migrated.
function ChangesPill(_props: { check: Checkpoint }) { return null; }

/** Soft metadata pill (e.g. auth expiry date). Sits to the right of the circle. */
function MetaPill({ check }: { check: Checkpoint }) {
  if (!check.pill) return null;
  return (
    <span
      className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 tabular-nums whitespace-nowrap"
      title={check.pill}
    >
      {check.pill}
    </span>
  );
}

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

type CircleState = "outline" | "gray" | "green" | "yellow" | "red";

function circleStateFor(c: Checkpoint): CircleState {
  if (c.tone === "ok")   return "green";
  if (c.tone === "bad")  return "red";
  if (c.tone === "warn") return "yellow";
  if (NOT_YET_LABELS.has(c.label)) return "outline";
  return "gray";
}

function CheckpointCircle({
  check, size = 30, onClick, title,
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
    state === "yellow" ? <span className="text-white font-bold text-[14px] leading-none">!</span> :
    null;
  const cls =
    state === "green"  ? "bg-emerald-600 ring-emerald-600"
    : state === "red"  ? "bg-rose-600 ring-rose-600"
    : state === "yellow" ? "bg-amber-400 ring-amber-400"
    : state === "gray" ? "bg-slate-300 ring-slate-300"
    : "bg-transparent ring-slate-300";
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        title ?? [
          `${check.label}${check.detail ? " — " + check.detail : ""}`,
          check.changes?.length ? `Changes: ${check.changes.join(" • ")}` : null,
          check.patientMessage ? `Patient message: ${check.patientMessage}` : null,
        ].filter(Boolean).join("\n")
      }
      className="relative inline-flex items-center justify-center"
      style={sizeStyle}
    >
      <span
        className={cn("inline-flex items-center justify-center rounded-full ring-2", cls)}
        style={sizeStyle}
      >
        {inner}
      </span>
      {check.overrideReason && check.tone === "ok" && (
        <Unlock
          className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-emerald-700 bg-white rounded-full p-[1px] ring-1 ring-emerald-300"
          aria-label="override"
        />
      )}
      {check.changes && check.changes.length > 0 && (
        <Pencil
          className="absolute -bottom-1 -right-1 h-3 w-3 text-orange-600 bg-white rounded-full p-[1px] ring-1 ring-orange-200"
          aria-label="changes"
        />
      )}
      {check.medicaidDvs && (
        <span
          className="absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold leading-none text-sky-700 ring-1 ring-sky-300"
          aria-label="Medicaid DVS"
          title="Medicaid DVS — re-issued day of service only. Nothing to do until ship day."
        >M</span>
      )}
      {check.delayed && (
        <Clock
          className="absolute -bottom-1 -left-1 h-3 w-3 text-amber-600 bg-white rounded-full p-[1px] ring-1 ring-amber-200"
          aria-label="delayed"
        />
      )}
      {check.patientMessage && (
        <MessageSquare
          className="absolute -top-1 -left-1 h-3 w-3 text-sky-600 bg-white rounded-full p-[1px] ring-1 ring-sky-200"
          aria-label="patient message"
        />
      )}
    </button>
  );
}



// ─── Lightweight popover for changing a circle's state ──────────────────────

type EditableState = "outline" | "gray" | "green" | "yellow" | "red";

const STATE_OPTIONS: Record<EditableState, { label: string; cls: string; icon: JSX.Element }> = {
  outline: { label: "Not started",  cls: "bg-transparent ring-slate-300",
             icon: <span className="block h-2 w-2 rounded-full" /> },
  gray:    { label: "Awaiting",     cls: "bg-slate-300 ring-slate-300",
             icon: <span /> },
  green:   { label: "Pass",         cls: "bg-emerald-600 ring-emerald-600",
             icon: <Check className="h-4 w-4 text-white" strokeWidth={3} /> },
  yellow:  { label: "Tentative",    cls: "bg-amber-400 ring-amber-400",
             icon: <span className="text-white font-bold text-[14px] leading-none">!</span> },
  red:     { label: "Fail",         cls: "bg-rose-600 ring-rose-600",
             icon: <X className="h-4 w-4 text-white" strokeWidth={3} /> },
};

const CONFIRM_PAUSE_REASONS = [
  "Collect new insurance",
  "Need new auth",
  "Has enough supplies",
  "Still owes last invoice",
  "Other supplier has auth",
  "Last claim denied",
  "Not using currently",
  "Hasn't received pump yet",
  "OOP too expensive",
  "Hospital/SNF",
];

const CONFIRM_CANCEL_REASONS = [
  "Stopped using",
  "Out-of-network insurance",
  "Switched supplier",
  "Patient declined",
];

function CircleEditPopover({
  check, kind, patient, onSave, children,
}: {
  check: Checkpoint;
  kind: CheckpointKind;
  patient: SubscriptionPatient;
  onSave?: (next: Partial<Checkpoint>, kind: CheckpointKind) => void;
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<EditableState | null>(null);
  const [note, setNote] = useState("");
  // Confirmation-red flow: pause vs cancel + reason
  const [pauseOrCancel, setPauseOrCancel] = useState<"pause" | "cancel" | null>(null);
  const [reason, setReason] = useState<string>("");
  const [customReason, setCustomReason] = useState("");
  const reasons = pauseOrCancel === "cancel" ? CONFIRM_CANCEL_REASONS : CONFIRM_PAUSE_REASONS;

  const currentState = circleStateFor(check);

  const handleSave = () => {
    const next: Partial<Checkpoint> = {};
    // Stub — in a real backend wire this writes to Monday.
    if (target === "green") next.tone = "ok";
    if (target === "red")   next.tone = "bad";
    if (target === "yellow") next.tone = "warn";
    if (target === "outline" || target === "gray") next.tone = "pending";
    const reasonStr = customReason.trim() || reason;
    if (reasonStr || note) {
      next.overrideReason = [pauseOrCancel ? `${pauseOrCancel}: ${reasonStr}` : reasonStr, note].filter(Boolean).join(" — ");
    }
    onSave?.(next, kind);
    setTarget(null); setNote(""); setPauseOrCancel(null); setReason(""); setCustomReason("");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-4">
        <div className="space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {PHASE_LABELS[kind]} — {patient.name}
            </div>
            <div className="text-[13px] font-semibold mt-0.5">
              Current: {check.label}{check.detail ? ` — ${check.detail}` : ""}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Change to</div>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.entries(STATE_OPTIONS) as Array<[EditableState, typeof STATE_OPTIONS[EditableState]]>).map(([key, opt]) => {
                const selected = target === key;
                const isCurrent = currentState === key && !target;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setTarget(key)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded p-1.5 transition-colors",
                      selected ? "bg-sky-100 ring-2 ring-sky-500" :
                      isCurrent ? "bg-muted" : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full ring-2", opt.cls)}
                    >
                      {opt.icon}
                    </span>
                    <span className="text-[10px] font-medium text-center leading-tight">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Confirmation red flow: pause or cancel */}
          {kind === "confirmation" && target === "red" && (
            <div className="space-y-2 rounded-md bg-rose-50 p-3 border border-rose-200">
              <div className="text-[12px] font-semibold text-rose-700">Pausing or cancelling this order?</div>
              <div className="flex gap-2">
                {(["pause", "cancel"] as const).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    size="sm"
                    variant={pauseOrCancel === kind ? "default" : "outline"}
                    className="flex-1 capitalize"
                    onClick={() => setPauseOrCancel(kind)}
                  >
                    {kind}
                  </Button>
                ))}
              </div>
              {pauseOrCancel && (
                <>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger className="text-[12px] h-8"><SelectValue placeholder="Pick a reason…" /></SelectTrigger>
                    <SelectContent>{reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    placeholder="Or type a reason of your own…"
                    className="text-[12px] h-8"
                  />
                </>
              )}
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Note (optional)</div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth logging on the patient row…"
              className="min-h-[60px] text-[12px]"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!target && !note}
              className="bg-emerald-700 hover:bg-emerald-800"
            >
              Save change
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Backwards-compatible alias used inside the drawer for compact display. */
function CheckpointIcon({ check, onClick, title }: { check: Checkpoint; onClick?: () => void; title?: string }) {
  return <CheckpointCircle check={check} size={24} onClick={onClick} title={title} />;
}

const SUB_TYPE_PILLS: Record<SubscriptionType, string> = {
  "Sensors":             "inline-flex items-center whitespace-nowrap rounded-full bg-sky-100 px-3 py-1 text-[12px] font-semibold text-sky-700",
  "Supplies":            "inline-flex items-center whitespace-nowrap rounded-full bg-violet-100 px-3 py-1 text-[12px] font-semibold text-violet-700",
  "Sensors & Supplies":  "inline-flex items-center whitespace-nowrap rounded-full bg-orange-100 px-3 py-1 text-[12px] font-semibold text-orange-700",
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
      className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-tight text-rose-700"
      title={patient.pauseReason ? `Paused: ${patient.pauseReason}` : "Paused (no reason set)"}
    >
      <PauseCircle className="h-3 w-3" />
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

function ReviewAndSubmit({ p, onReview, onSubmit, sending, sent }: {
  p: SubscriptionPatient;
  onReview: () => void;
  onSubmit: () => void;
  sending?: boolean;
  sent?:    boolean;
}) {
  const ready = allChecksPass(p);
  return (
    // pl-6 pushes the buttons away from the Paid circle in the
    // OverviewTable grid layout; justify-end keeps them right-anchored
    // so the spacing scales with column width.
    <div className="flex items-center justify-end gap-1.5 pl-6">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2.5 text-[11px] font-semibold"
        onClick={onReview}
        disabled={sending || sent}
      >
        Review<ArrowRight className="ml-1 h-3 w-3" />
      </Button>
      <Button
        size="sm"
        onClick={onSubmit}
        disabled={sending || sent}
        className={cn(
          "h-7 px-2.5 text-[11px] font-semibold text-white shadow-sm transition-colors",
          sending ? "bg-blue-600"
          : sent  ? "bg-emerald-600"
          : ready ? "bg-emerald-700 hover:bg-emerald-800"
                  : "bg-slate-400 hover:bg-slate-500",
        )}
        title={
          sending ? "Writing Ordering Cycle = Order on Monday…"
          : sent   ? "Sent — Monday automation now spawns the order"
          : ready  ? "All 4 checks passed — send order"
                   : "Not all 4 checks pass — confirm before submitting"
        }
      >
        {sending ? (<><Loader2 className="mr-1 h-3 w-3 animate-spin" />Sending…</>)
        : sent    ? (<><Check    className="mr-1 h-3 w-3" />Sent</>)
        :           (<><Send     className="mr-1 h-3 w-3" />Send Order</>)}
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
function OrderCycleWorkflow() {
  type PrimaryTab = "prep" | "paused" | "order" | "neworder" | "overview";
  const [primary, setPrimary] = useState<PrimaryTab>("prep");
  type PrepPhase = CheckpointKind | "all";
  const [prepPhase, setPrepPhase] = useState<PrepPhase>("all");
  // `phase` is the derived view selection used by the rest of the component.
  // When prepPhase = "all", we render the overview-style table filtered to
  // every non-ready patient so the operator sees the whole Order Prep cohort.
  const phase: PhaseTab =
    primary === "overview" ? "overview"
    : primary === "paused" ? "overview"
    : primary === "order"  ? "ready"
    : prepPhase === "all"  ? "overview"
    : prepPhase;
  const setPhase = (next: PhaseTab) => {
    if (next === "overview") setPrimary("overview");
    else if (next === "ready") setPrimary("order");
    else { setPrimary("prep"); setPrepPhase(next); }
  };
  void setPhase; // currently unused — keeps the helper for future deep-link routing
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>("All payers");
  const [blocked, setBlocked] = useState<string>("Anyone");
  const [statusFilter, setStatusFilter] = useState<string>("Active");
  const [pauseReason, setPauseReason] = useState<string>("Any pause reason");
  const [activePatient, setActivePatient] = useState<SubscriptionPatient | null>(null);
  const [activeKind, setActiveKind] = useState<CheckpointKind | "patient" | null>(null);

  // ── Sort state ──
  // Default sort: nextOrderDate ascending (soonest order first). Operators
  // want to see what's coming due first; that's the whole point of Order
  // Prep. Column headers in both OverviewTable and PhaseTable are
  // clickable to re-sort.
  type SortKey =
    | "name" | "nextOrderDate" | "subscriptionType" | "primaryPayer"
    | "confirmation" | "benefits" | "auth" | "lastPaid";
  const [sortKey, setSortKey] = useState<SortKey>("nextOrderDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  // ── Live Monday data wiring (Phase 2 of Option A) ──
  // OrderCycle now reads from the same React-Query-backed Subscription
  // Board fetch as PatientProfile. The hook's stale-while-revalidate +
  // 30s background poll means the operator sees Monday-side edits
  // automatically. Mock data still renders when no Monday token is
  // configured (local dev / preview deploys) — usingMock surfaces that.
  const {
    data: liveAll, loading, isFetching, error, usingMock, refetch, dataUpdatedAt,
  } = useSubscriptionPatients();
  const all: SubscriptionPatient[] = liveAll ?? [];

  const counts = useMemo(() => {
    // Tab membership is driven by the Monday Ordering Cycle column —
    // NOT a client-side derivation. Backend cron + webhook own the
    // promotion from 'Order Prep' to 'Ready to Order' once all 4
    // gates pass + eligibility is current for the order's month.
    //
    //   Order Prep tab  = ordering_cycle == 'Order Prep'
    //   Order tab       = ordering_cycle == 'Ready to Order'
    //   Overview tab    = whole cohort (any status)
    //
    // The 4 phase sub-tabs under Order Prep still use independent-
    // bucket semantics: within the Order Prep cohort, count + show
    // patients whose THAT specific checkpoint is non-OK. prepUnique
    // is the deduped count of Order-Prep rows with at least one
    // non-OK check (so we don't double-count multi-blocked rows).
    const c = {
      overview: 0,
      confirmation: 0, benefits: 0, auth: 0, lastPaid: 0,
      ready: 0,
      prepUnique: 0,
      paused: 0,
    };
    for (const p of all) {
      c.overview++;
      // Paused patients get pulled out of Order Prep so they don't
      // clutter the happy-path queue. Counted in their own bucket so
      // ops can find them when they need to.
      if (p.patientStatus === "Paused") { c.paused++; continue; }
      const status = p.orderingCycle || "";
      if (status === "Ready to Order") { c.ready++; continue; }
      if (status !== "Order Prep") continue;
      let anyFailing = false;
      if (p.confirmation.tone !== "ok") { c.confirmation++; anyFailing = true; }
      if (p.benefits.tone     !== "ok") { c.benefits++;     anyFailing = true; }
      if (p.auth.tone         !== "ok") { c.auth++;         anyFailing = true; }
      if (p.lastPaid.tone     !== "ok") { c.lastPaid++;     anyFailing = true; }
      // A patient in Order Prep with all 4 checks passing but not yet
      // promoted to Ready (cron hasn't fired yet, or some other gate
      // we don't render — last_eligibility_check currency) still
      // belongs in the prep cohort count.
      if (!anyFailing) anyFailing = true; // count them in prepUnique too
      if (anyFailing) c.prepUnique++;
    }
    return c;
  }, [all]);

  const openCell = (p: SubscriptionPatient, kind: CheckpointKind) => { setActivePatient(p); setActiveKind(kind); };
  const openPatient = (p: SubscriptionPatient) => { setActivePatient(p); setActiveKind("patient"); };
  const closeDrawer = () => { setActivePatient(null); setActiveKind(null); };
  // Flips Ordering Cycle -> 'Order' on the Subscription Board row.
  // Brandon's existing Monday automation listens on that column-value
  // change and spawns the actual order on the Order Board; we just
  // own the trigger. Optimistic UX: surface the in-flight state via
  // batchMsg so the operator gets feedback, then invalidate the
  // cache so the row leaves Order Prep / Order tabs on the next fetch.
  const sendToOrderBoard = async (p: SubscriptionPatient) => {
    const id = p.mondayItemId;
    setSendingIds((prev) => new Set(prev).add(id));
    setBatchMsg(`Sending ${p.name} to Order…`);
    try {
      await sendToOrder(id);
      setSendingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setSentIds   ((prev) => new Set(prev).add(id));
      setBatchMsg(`${p.name} sent to Order ✓`);
      invalidateSubscription();
      // Hold the green "Sent ✓" on the button for ~2s before the
      // refetch removes the row from the tab so the operator sees
      // clear confirmation.
      setTimeout(() => {
        setSentIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }, 2000);
    } catch (e) {
      setSendingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setBatchMsg(
        `Failed to send ${p.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setTimeout(() => setBatchMsg(null), 4000);
    }
  };

  // ── Batch action state ──
  const { invalidate: invalidateSubscription } = useInvalidateSubscription();
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  // Per-row Send Order feedback: the header batchMsg pill is invisible
  // when the operator's eyes are at the bottom of a long table. sendingId
  // is the mondayItemId of the row currently being written; sentId is
  // the row that just completed (held ~2s for visible confirmation
  // before the refetch removes the row from the tab).
  // Multi-row Send Order: operator can fire off Send on N rows in
  // quick succession; each in-flight + freshly-sent row is tracked
  // independently so only that ROW's button locks, not the entire
  // table.
  const [sendingIds, setSendingIds] = useState<Set<string>>(() => new Set());
  const [sentIds, setSentIds]       = useState<Set<string>>(() => new Set());
  // Order Prep > Authorization sub-view toggle. When true, the
  // Authorization tab swaps the default PhaseTable for the existing
  // DvsQueue component — auto-filtered to Medicaid + non-Sensors-only
  // patients, rendered in the DVS-shaped table with bulk Run DVS +
  // per-row Run DVS actions. Brandon's mental model is "in Auth, I
  // want to flip into DVS mode for Medicaid patients I can act on
  // today, without leaving the order cycle."
  const [dvsView, setDvsView] = useState(false);

  /**
   * Run Eligibility Batch — flips `Run Check` to "Run" for every patient
   * currently in the Eligibility phase of the visible cohort, in parallel.
   * Backend stedi-monday-integration webhook picks them up and runs 270s.
   * Per memory: Monday batch writes are atomic per-item, so a single bad
   * row only fails its own check — the rest still run.
   */
  const runEligibilityBatch = async () => {
    const cohort = filteredAll.filter((p) => currentPhase(p) === "benefits");
    if (cohort.length === 0) {
      setBatchMsg("No patients in Eligibility phase to run.");
      setTimeout(() => setBatchMsg(null), 4000);
      return;
    }
    setBatchRunning(true);
    setBatchMsg(`Triggering eligibility for ${cohort.length} patient${cohort.length === 1 ? "" : "s"}…`);
    const results = await Promise.allSettled(
      cohort.map((p) => runEligibilityCheck(p.mondayItemId)),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    setBatchMsg(failed === 0
      ? `Triggered ${ok} eligibility check${ok === 1 ? "" : "s"} ✓`
      : `Triggered ${ok}, ${failed} failed`);
    setBatchRunning(false);
    invalidateSubscription();
    setTimeout(() => setBatchMsg(null), 6000);
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
    let base: SubscriptionPatient[];
    // Tab membership is sourced from the Monday Ordering Cycle column
    // (color_mkyjawhq). Backend cron + webhook own the promotion to
    // 'Ready to Order' once all 4 gates pass + eligibility is current.
    // Client-side filters now mirror that single source of truth.
    if (primary === "paused") {
      // Paused tab: every paused patient regardless of ordering cycle
      // status. Lives outside the Order Prep happy path so the operator
      // can still find them when they need to act on a pause reason.
      base = filteredAll.filter((p) => p.patientStatus === "Paused");
    } else if (phase === "overview") {
      if (primary === "prep" && prepPhase === "all") {
        // Order Prep > All: every row in 'Order Prep' EXCLUDING paused.
        base = filteredAll.filter((p) =>
          (p.orderingCycle || "") === "Order Prep" &&
          p.patientStatus !== "Paused",
        );
      } else {
        // Pure Overview tab: whole cohort regardless of status.
        base = filteredAll;
      }
    } else if (phase === "ready") {
      // Order tab: rows the backend has promoted to 'Ready to Order'.
      base = filteredAll.filter((p) => (p.orderingCycle || "") === "Ready to Order");
    } else {
      // Phase sub-tabs (Confirmation / Eligibility / Auth / Last Paid):
      // patients in Order Prep AND with this specific checkpoint non-OK,
      // also excluding paused so they don't clog the buckets.
      base = filteredAll.filter((p) =>
        (p.orderingCycle || "") === "Order Prep" &&
        p.patientStatus !== "Paused" &&
        getCheckpoint(p, phase).tone !== "ok",
      );
    }
    // Apply sort. nextOrderDate uses lexical ISO compare which is
    // chronologically correct ("2026-06-15" < "2026-06-20"). Empty
    // dates sort to the bottom regardless of direction so they don't
    // hide what's coming due.
    // Checkpoint columns (Conf / Elig / Auth / Paid) sort by display
    // state. Order (asc, top→bottom) per Brandon's spec:
    //   1. green  (ok)             — already resolved
    //   2. yellow (warn)           — failed check / fixable on our end
    //   3. red    (bad)            — real denial / blocker
    //   4. gray   (pending, sent)  — awaiting patient response
    //   5. blank  (pending, not yet) — Not sent / Not run, not our turn
    // Reflects the "what should I action next" mental model: greens
    // confirm work done, yellows are operator-fixable, reds need
    // outside input, grays are time-based waiting, blanks are pre-work.
    const CIRCLE_RANK: Record<string, number> = {
      green: 0, yellow: 1, red: 2, gray: 3, outline: 4,
    };
    // Mirror SubscriptionBoard's circleStateFor() — kept inline so the
    // sort stays in one place. Update both if circle-state rules change.
    const NOT_YET = new Set(["Not sent", "Not run", "Not checked", "Not Serving", "Unknown"]);
    function rankCheckpoint(c: { tone: string; label: string } | undefined): number {
      if (!c) return 99;
      if (c.tone === "ok") return CIRCLE_RANK.green;
      if (c.tone === "bad") return CIRCLE_RANK.red;
      if (c.tone === "warn") return CIRCLE_RANK.yellow;
      if (NOT_YET.has(c.label)) return CIRCLE_RANK.outline;
      return CIRCLE_RANK.gray;
    }
    const CHECKPOINT_KEYS = new Set(["confirmation", "benefits", "auth", "lastPaid"]);
    const sorted = [...base].sort((a, b) => {
      if (CHECKPOINT_KEYS.has(sortKey)) {
        const ac = (a as unknown as Record<string, { tone: string; label: string }>)[sortKey];
        const bc = (b as unknown as Record<string, { tone: string; label: string }>)[sortKey];
        const diff = rankCheckpoint(ac) - rankCheckpoint(bc);
        return sortDir === "asc" ? diff : -diff;
      }
      const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? "");
      const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? "");
      if (sortKey === "nextOrderDate") {
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
      }
      return sortDir === "asc"
        ? av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" })
        : bv.localeCompare(av, undefined, { numeric: true, sensitivity: "base" });
    });
    return sorted;
  }, [filteredAll, phase, primary, prepPhase, sortKey, sortDir]);

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
    // Independent-bucket KPIs: "in this phase" = checkpoint for this
    // phase is non-OK, regardless of other phases' status.
    const inPhase = (p: SubscriptionPatient) => getCheckpoint(p, phase as CheckpointKind).tone !== "ok";
    const blockedCount = (party: BlockedParty) =>
      filteredAll.filter((p) => inPhase(p) && p.blockedBy === party).length;
    return [
      { tone: "neutral" as const, label: `In ${PHASE_LABELS[phase]}`, value: rows.length },
      { tone: "warning" as const, label: "Blocked by patient",        value: blockedCount("patient") },
      { tone: "info"    as const, label: "Waiting on payer",          value: blockedCount("payer") },
      { tone: "danger"  as const, label: "Needs us to act",           value: blockedCount("us") },
      { tone: "neutral" as const, label: "System-paced",              value: blockedCount("system") },
      { tone: "success" as const, label: "Overrides applied",
        value: filteredAll.filter((p) => inPhase(p)
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

  // New 'Order' tab — independent view rendered from the New Order
  // Board (18405457690). Skip all of the Order Prep / Ready-to-Order
  // shared scaffolding for this tab; NewOrders renders its own header.
  if (primary === "neworder") {
    return (
      <div className="space-y-4">
        <Tabs value={primary} onValueChange={(v) => setPrimary(v as PrimaryTab)}>
          <TabsList className="bg-card border h-11 p-1">
            <TabsTrigger value="prep" className="text-[15px] font-semibold gap-2 px-4">
              Order Prep
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.prepUnique}</span>
            </TabsTrigger>
            <TabsTrigger value="paused" className="text-[15px] font-semibold gap-2 px-4">
              <PauseCircle className="h-4 w-4 text-rose-600" />
              Paused
              <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.paused}</span>
            </TabsTrigger>
            <TabsTrigger value="paused" className="text-[15px] font-semibold gap-2 px-4">
              <PauseCircle className="h-4 w-4 text-rose-600" />
              Paused
              <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.paused}</span>
            </TabsTrigger>
            <TabsTrigger value="order" className="text-[15px] font-semibold gap-2 px-4">
              Ready to Order
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.ready}</span>
            </TabsTrigger>
            <TabsTrigger value="neworder" className="text-[15px] font-semibold gap-2 px-4">
              Order
            </TabsTrigger>
            <TabsTrigger value="overview" className="text-[15px] font-semibold gap-2 px-4">
              Overview
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.overview}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <NewOrders />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live data freshness + mock-data banner */}
      <div className="flex flex-wrap items-center gap-2">
        <OrderCycleFreshness
          isFetching={isFetching}
          dataUpdatedAt={dataUpdatedAt}
          onRefresh={() => void refetch()}
        />
        {loading && all.length === 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading patients from Monday…
          </span>
        )}
        {usingMock && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
            Showing mock data (Monday token not configured)
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700"
                title={error}>
            Failed to load — using last cached data
          </span>
        )}
        {batchMsg && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
            {batchRunning && <Loader2 className="h-3 w-3 animate-spin" />}
            {batchMsg}
          </span>
        )}
      </div>

      {/* Primary nav: Order Prep | Order | Overview */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={primary} onValueChange={(v) => setPrimary(v as PrimaryTab)}>
          <TabsList className="bg-card border h-11 p-1">
            <TabsTrigger value="prep" className="text-[15px] font-semibold gap-2 px-4">
              Order Prep
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.prepUnique}</span>
            </TabsTrigger>
            <TabsTrigger value="order" className="text-[15px] font-semibold gap-2 px-4">
              Ready to Order
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.ready}</span>
            </TabsTrigger>
            <TabsTrigger value="neworder" className="text-[15px] font-semibold gap-2 px-4">
              Order
            </TabsTrigger>
            <TabsTrigger value="overview" className="text-[15px] font-semibold gap-2 px-4">
              Overview
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.overview}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          {/* Send Reorder Text is auto-fired by Josh's backend automation
              when status hits 20-days and reorder link is empty — no
              manual button needed. */}
          {phase === "benefits" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runEligibilityBatch()}
              disabled={batchRunning}
            >
              {batchRunning
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Run Eligibility Batch
            </Button>
          )}
          {phase === "auth" && (
            <Button
              variant={dvsView ? "default" : "outline"}
              size="sm"
              onClick={() => setDvsView((v) => !v)}
              className={cn(
                dvsView && "bg-sky-700 hover:bg-sky-800 text-white",
              )}
              title={dvsView
                ? "Switch back to the standard Auth view"
                : "Show only Medicaid patients with the DVS workstation table"}
            >
              <Shield className="mr-2 h-4 w-4" />
              {dvsView ? "Exit Medicaid DVS view" : "Medicaid DVS view"}
            </Button>
          )}
        </div>
      </div>

      {/* Sub-nav under Order Prep — the 4 readiness phases */}
      {primary === "prep" && (
        <Tabs value={prepPhase} onValueChange={(v) => {
          setPrepPhase(v as PrepPhase);
          // Reset the DVS sub-view toggle when navigating away from
          // Authorization so a stale toggle doesn't show up on the
          // next entry.
          if (v !== "auth") setDvsView(false);
        }}>
          <TabsList className="bg-card border">
            <TabsTrigger value="all" className="gap-1.5">
              All
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                {counts.prepUnique}
              </span>
            </TabsTrigger>
            {renderPhaseTab("confirmation", "Confirmation",     counts.confirmation)}
            {renderPhaseTab("benefits",     "Eligibility",      counts.benefits)}
            {renderPhaseTab("auth",         "Authorization",    counts.auth)}
            {renderPhaseTab("lastPaid",     "Last Order Paid",  counts.lastPaid)}
          </TabsList>
        </Tabs>
      )}

      <>
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
        {phase === "auth" && dvsView ? (
          // DvsQueue ships with its own header / loading / refresh —
          // mount inside the same Card so column alignment with the
          // rest of the Order Prep workflow stays consistent.
          <div className="p-4">
            <DvsQueue />
          </div>
        ) : phase === "overview" ? (
          <OverviewTable
            rows={rows}
            onCellClick={openCell}
            onPatientClick={openPatient}
            onSubmit={sendToOrderBoard}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            sendingIds={sendingIds}
            sentIds={sentIds}
          />
        ) : phase === "ready" ? (
          <SubmitTable rows={rows} onPatientClick={openPatient} onSubmit={sendToOrderBoard} sendingIds={sendingIds} sentIds={sentIds} />
        ) : (
          <PhaseTable
            rows={rows}
            phase={phase}
            onCellClick={openCell}
            onPatientClick={openPatient}
            onSubmit={sendToOrderBoard}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            sendingIds={sendingIds}
            sentIds={sentIds}
          />
        )}
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {phase === "ready" ? "Nothing ready to submit yet." : "No patients in this phase right now."}
          </div>
        )}
      </Card>

        </>
      <PatientDrawer patient={activePatient} kind={activeKind} onClose={closeDrawer} />
    </div>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────

const OVERVIEW_GRID = "grid grid-cols-[240px_120px_180px_200px_minmax(80px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_300px] gap-4";

type OverviewSortKey =
  | "name" | "nextOrderDate" | "subscriptionType" | "primaryPayer"
  | "confirmation" | "benefits" | "auth" | "lastPaid";

function SortableLabel({
  label, k, sortKey, sortDir, onClick, align,
}: {
  label: string;
  k: OverviewSortKey;
  sortKey: OverviewSortKey;
  sortDir: "asc" | "desc";
  onClick: (k: OverviewSortKey) => void;
  align?: "left" | "right" | "center";
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground transition-colors",
        active && "text-foreground",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      {label}{arrow}
    </button>
  );
}

function OverviewTable({
  rows, onCellClick, onPatientClick, onSubmit, sortKey, sortDir, onSort,
  sendingIds, sentIds,
}: {
  rows: SubscriptionPatient[];
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
  sortKey: OverviewSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: OverviewSortKey) => void;
  sendingIds: Set<string>;
  sentIds:    Set<string>;
}) {
  return (
    <div className="text-[13px]">
      <div className={cn(OVERVIEW_GRID, "border-b bg-muted/60 px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground items-end")}>
        <div><SortableLabel label="Patient"        k="name"             sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div><SortableLabel label="Order"          k="nextOrderDate"    sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div><SortableLabel label="Subscription"   k="subscriptionType" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div><SortableLabel label="Primary Payer"  k="primaryPayer"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div className="text-center"><SortableLabel label="Conf" k="confirmation" sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Elig" k="benefits"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Auth" k="auth"         sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Paid" k="lastPaid"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-right pr-2">Actions</div>
      </div>
      {rows.map((p) => (
        <div key={p.id} className={cn(OVERVIEW_GRID, "border-b px-6 py-4 hover:bg-muted/30 transition-colors items-center")}>
          <button type="button" onClick={() => onPatientClick(p)} className="text-left">
            <div className="text-[15px] font-semibold text-foreground flex items-center">{p.name}<PauseBadge patient={p} /></div>
            <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">{p.phone}</div>
          </button>
          <div>
            <div className="text-[15px] font-semibold tabular-nums">{fmtDate(p.nextOrderDate)}</div>
            <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">in {daysBetween(p.nextOrderDate)}d</div>
          </div>
          <div><span className={SUB_TYPE_PILLS[p.subscriptionType]}>{p.subscriptionType}</span></div>
          <div className="text-[14px] truncate">{p.primaryPayer}</div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.confirmation} kind="confirmation" patient={p}>
              <CheckpointCircle check={p.confirmation} />
            </CircleEditPopover>
          </div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.benefits} kind="benefits" patient={p}>
              <CheckpointCircle check={p.benefits} />
            </CircleEditPopover>
          </div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.auth} kind="auth" patient={p}>
              <CheckpointCircle check={p.auth} />
            </CircleEditPopover>
            <MetaPill check={p.auth} />
          </div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.lastPaid} kind="lastPaid" patient={p}>
              <CheckpointCircle check={p.lastPaid} />
            </CircleEditPopover>
          </div>
          <ReviewAndSubmit p={p} onReview={() => onPatientClick(p)} onSubmit={() => onSubmit(p)} sending={sendingIds.has(p.mondayItemId)} sent={sentIds.has(p.mondayItemId)} />
        </div>
      ))}
    </div>
  );
}

function PhaseTable({
  rows, phase, onCellClick, onPatientClick, onSubmit, sortKey, sortDir, onSort,
  sendingIds, sentIds,
}: {
  rows: SubscriptionPatient[];
  phase: CheckpointKind;
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
  sortKey: OverviewSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: OverviewSortKey) => void;
  sendingIds: Set<string>;
  sentIds:    Set<string>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[220px]"><SortableLabel label="Patient"       k="name"             sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
          <TableHead className="w-[100px]"><SortableLabel label="Order"         k="nextOrderDate"    sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
          <TableHead className="w-[140px]"><SortableLabel label="Subscription"  k="subscriptionType" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
          <TableHead className="w-[170px]"><SortableLabel label="Primary Payer" k="primaryPayer"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
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
              <TableCell><div className="flex items-center justify-center">
                <CircleEditPopover check={c} kind={phase} patient={p}>
                  <CheckpointCircle check={c} />
                </CircleEditPopover>
                {phase === "auth" && <MetaPill check={c} />}
              </div></TableCell>
              <TableCell><BlockedByPill value={p.blockedBy} /></TableCell>
              <TableCell><CheckInCell iso={p.nextCheckIn} stuckSince={p.stuckSince} /></TableCell>
              <TableCell className="text-[12px] text-muted-foreground max-w-[340px]">{p.stuckReason ?? "—"}</TableCell>
              <TableCell><ReviewAndSubmit p={p} onReview={() => onPatientClick(p)} onSubmit={() => onSubmit(p)} sending={sendingIds.has(p.mondayItemId)} sent={sentIds.has(p.mondayItemId)} /></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function SubmitTable({
  rows, onPatientClick, onSubmit, sendingIds, sentIds,
}: {
  rows: SubscriptionPatient[];
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
  sendingIds: Set<string>;
  sentIds:    Set<string>;
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
            <TableCell><ReviewAndSubmit p={p} onReview={() => onPatientClick(p)} onSubmit={() => onSubmit(p)} sending={sendingIds.has(p.mondayItemId)} sent={sentIds.has(p.mondayItemId)} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Top-level SubscriptionBoard: 5 workflow tabs ────────────────────────────
type WorkflowTab = "order-cycle" | "patient-profile" | "authorizations" | "medical-records" | "financials";

/**
 * OrderCycleFreshness — inline pill mirroring PatientProfile's
 * FreshnessPill. Greys when cache is fresh, pulses while refetching,
 * surfaces "Updated Xm ago" when stale, click to force refresh.
 */
function OrderCycleFreshness({ isFetching, dataUpdatedAt, onRefresh }: {
  isFetching: boolean; dataUpdatedAt: number; onRefresh: () => void;
}) {
  const ageMs = Date.now() - dataUpdatedAt;
  const ageS  = Math.round(ageMs / 1000);
  const ageM  = Math.round(ageMs / 60_000);
  const label = isFetching ? "Refreshing…"
              : ageS < 30   ? "Updated just now"
              : ageS < 60   ? `Updated ${ageS}s ago`
              : ageM < 60   ? `Updated ${ageM}m ago`
              :               `Updated ${Math.round(ageM / 60)}h ago`;
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isFetching}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition
        ${isFetching ? "bg-blue-50 text-blue-700 border-blue-200"
                     : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"}`}
      title="Click to refresh now"
    >
      {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <ReloadIcon className="h-3 w-3" />}
      {label}
    </button>
  );
}

const WORKFLOW_TABS: { id: WorkflowTab; label: string; icon: typeof RefreshCw }[] = [
  { id: "order-cycle",     label: "Order Cycle",     icon: RefreshCw },
  { id: "patient-profile", label: "Patient Profile", icon: UserCircle },
  { id: "authorizations",  label: "Authorizations",  icon: Shield },
  { id: "medical-records", label: "Medical Records", icon: ClipboardCheck },
  { id: "financials",      label: "Financials",      icon: Building2 },
];

export function SubscriptionBoard() {
  const [workflow, setWorkflow] = useState<WorkflowTab>("order-cycle");

  return (
    <div className="space-y-4">
      {/* Workflow tab nav — sits above the Order Cycle\'s own Overview/Prep/Order nav */}
      <Tabs value={workflow} onValueChange={(v) => setWorkflow(v as WorkflowTab)}>
        <TabsList className="bg-card border h-12 p-1">
          {WORKFLOW_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger key={t.id} value={t.id} className="text-[15px] font-semibold gap-2 px-4">
                <Icon className="h-4 w-4" />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {workflow === "order-cycle"     && <OrderCycleWorkflow />}
      {workflow === "patient-profile" && <PatientProfile />}
      {workflow === "authorizations"  && <Authorizations />}
      {workflow === "medical-records" && <MedicalRecords />}
      {workflow === "financials"      && <Financials />}
    </div>
  );
}
