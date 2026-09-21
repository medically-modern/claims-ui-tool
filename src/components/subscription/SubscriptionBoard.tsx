/**
 * SubscriptionBoard.tsx — Subscription Board (top-level tab).
 *
 * Phase sub-tabs: Overview / Confirmation / Eligibility / Authorization /
 * Last Order Paid / Medical Records / Submit Order. Patients are assigned to
 * the leftmost not-OK checkpoint so the operator can batch through stuck
 * work by phase.
 *
 * Row layout per Brandon (2026-06-02 simplification):
 *   Patient (name + phone) | Order date | Subscription pill (color per type)
 *   | Primary Payer | 5 simple checkpoint icons (✓ / blank / ✗; MR added
 *   2026-09-14 — light green = records not valid but OK to order) |
 *   Comms (RingCentral texts + calls) | Review Profile | Send to Order Board
 *
 * On phase tabs we keep the stuck-reasoning columns (Blocked By, Next
 * Check-In, Why Stuck) since that's the whole point of those views.
 */

import { Fragment, forwardRef, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Bell, Building2, CalendarClock, Check, ClipboardCheck,
  Clock, DollarSign, ExternalLink, Heart, Loader2,
  MessageSquare, PauseCircle, Pencil, Phone, RefreshCw, RefreshCw as ReloadIcon, Search, Send,
  Server, Shield, Stethoscope, UserCog, Unlock, UserX, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

import { CommsSheet } from "@/components/comms/CommsSheet";
import { useOpenPatient } from "./patient/openPatient";
import { lastOrderDay } from "@/lib/comms/sinceOrder";
import { AdvanceDialog } from "./patient/AdvanceDialog";
import { NewOrders } from "./NewOrders";
import { PayerRulesTab } from "./PayerRulesTab";
import { describeCircle } from "@/lib/subscription/circleDetail";
import { fmtStamp, makeStamp } from "@/lib/subscription/orderStamps";
import { operatorInitials } from "./patient/PatientRail";
import { InactiveDialog } from "./patient/InactiveDialog";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { setDvsTrigger } from "@/api/setDvsTrigger";
import { DvsQueue } from "./DvsQueue";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import { useNewOrders } from "@/hooks/subscription/useNewOrders";
import { ORDER_GROUP_ID } from "@/api/queries/newOrders";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { useOrderingCycleSync } from "@/hooks/subscription/useOrderingCycleSync";
import { useOrderGate } from "@/hooks/subscription/useOrderGate";
import { isFirstOrder } from "@/lib/subscription/payerRules";
import { describeSync } from "@/lib/subscription/orderingCycleSync";
import { runEligibilityCheck, saveSubscriptionPatient, sendToOrder, writeOrderStamps } from "@/api/setSubscriptionPatient";
import { bulkTriggerDvs } from "@/api/setDvsTrigger";
import { canRunDvs } from "@/lib/subscription/dvs";
import {
  blockPatient, unblockPatient, recordCheckIn, churnPatient,
} from "@/api/blockPatient";
import {
  BLOCK_REASON_GROUPS, BLOCK_REASONS, DEAD_REASONS, DEFAULT_CHECK_IN_DAYS,
  FORCED_DECISION_MISSES, LanePatient, ReasonFamily, addDaysIso, blockReasons,
  checkInDue, checkInRequiredFor, getLane, isBlocked, isReady, needsReason,
  possiblyResolved, reasonFamily, reasonResolved, shipCandidate, todayIso,
} from "@/lib/subscription/lanes";
import {
  BLOCKED_BY_OPTIONS, BlockedParty, CHECKPOINT_GATE, Checkpoint, CheckpointKind,
  currentPhase, mrOf, ORDER_PREP_PATIENTS, PATIENT_STATUS_OPTIONS, PAUSE_REASON_OPTIONS,
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
       : kind === "mr"           ? mrOf(p)
       : p.lastPaid;
}
/** The circle kinds in row order — the 5th (MR) was added 2026-09-14. */
const CHECKPOINT_KINDS = ["confirmation", "benefits", "auth", "lastPaid", "mr"] as const;
function allChecksPass(p: SubscriptionPatient): boolean {
  return p.confirmation.tone === "ok" && p.benefits.tone === "ok"
    && p.auth.tone === "ok" && p.lastPaid.tone === "ok"
    && mrOf(p).tone === "ok";
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

type CircleState = "green" | "red" | "yellow" | "gray" | "outline" | "waiting";

function circleStateFor(c: Checkpoint): CircleState {
  // A check with no data behind it is a blank, whatever its tone says
  // about readiness — see Checkpoint.unknown.
  if (c.unknown)         return "outline";
  // Something is already working on this one. "…" is not a verdict, it is the
  // absence of one with a promise attached: a check or an X is coming, so the
  // operator should wait rather than act. See Checkpoint.awaiting.
  if (c.awaiting)        return "waiting";
  if (c.tone === "ok")   return "green";
  if (c.tone === "bad")  return "red";
  if (c.tone === "warn") return "yellow";
  if (NOT_YET_LABELS.has(c.label)) return "outline";
  return "gray";
}

type CheckpointCircleProps = {
  check: Checkpoint;
  size?: number;
  title?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * forwardRef + prop spread are REQUIRED: Radix PopoverTrigger asChild
 * injects ref/onClick/aria props into this element — without forwarding
 * them the popover never opens (the original stub popover had this bug).
 */
const CheckpointCircle = forwardRef<HTMLButtonElement, CheckpointCircleProps>(
  function CheckpointCircle({ check, size = 30, title, className, style, ...rest }, ref) {
  const state = circleStateFor(check);
  // LIGHT = a rule decided this mark, not the column (see payerRules.ts).
  // Hollow in the tone's colour: light green is "the column did not say yes;
  // a rule says order anyway", light red is "the column looks fine; a rule
  // says no". Dark means the column decided by itself. Same tone, same
  // readiness — the look is the audit trail.
  const light = !!check.light && (state === "green" || state === "red");
  const sizeStyle = { width: size, height: size };
  const inner =
    state === "green" ? <Check className={cn("h-4 w-4", light ? "text-emerald-600" : "text-white")} strokeWidth={3} /> :
    state === "red"   ? <X     className={cn("h-4 w-4", light ? "text-rose-600" : "text-white")}  strokeWidth={3} /> :
    state === "yellow" ? <span className="text-white font-bold text-[14px] leading-none">!</span> :
    // Three dots that breathe, staggered, so a glance down the column tells
    // you something is in flight without reading a single label.
    state === "waiting" ? (
      <span className="flex items-end gap-[3px]" aria-hidden>
        <span className="h-[3px] w-[3px] rounded-full bg-white animate-pulse [animation-delay:0ms]" />
        <span className="h-[3px] w-[3px] rounded-full bg-white animate-pulse [animation-delay:200ms]" />
        <span className="h-[3px] w-[3px] rounded-full bg-white animate-pulse [animation-delay:400ms]" />
      </span>
    ) :
    null;
  const cls =
    state === "green"  ? (light ? "bg-emerald-50 ring-emerald-600" : "bg-emerald-600 ring-emerald-600")
    : state === "red"  ? (light ? "bg-rose-50 ring-rose-600" : "bg-rose-600 ring-rose-600")
    : state === "yellow" ? "bg-amber-400 ring-amber-400"
    : state === "waiting" ? "bg-slate-400 ring-slate-400"
    : state === "gray" ? "bg-slate-300 ring-slate-300"
    : "bg-transparent ring-slate-300";
  return (
    <button
      type="button"
      ref={ref}
      {...rest}
      // No hover text: the click-in popover is the explanation (Brandon,
      // 2026-09-20 — "the click-ins are way better than the hovers").
      title={title}
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ ...sizeStyle, ...style }}
    >
      <span
        className={cn("inline-flex items-center justify-center rounded-full ring-2", cls)}
        style={sizeStyle}
      >
        {inner}
      </span>
      {/* The row carries ONE badge. Edits, delay, overrides and the rest are
          real but they are nuance — they live in the profile, a click away.
          What cannot wait for a click is somebody having said something:
          a note, a portal message, or an inbound text/call inside the 30 days
          before the order date. See lib/subscription/confirmationSignals.ts. */}
      {/* One badge, two states (Brandon's mockup, 2026-09-20): a message is
          waiting = white disc, gray outline, gray bubble; it has been read
          and judged = pale green disc, green outline, green bubble with a
          check inside. Same spot, same size, so the eye compares colour. */}
      {check.needsRead && (
        <span
          className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-white text-slate-500 ring-[1.5px] ring-slate-400 shadow-sm"
          aria-label={`read before ordering — ${check.needsRead}`}
        >
          <MessageSquare className="h-3 w-3" strokeWidth={2.5} />
        </span>
      )}
      {!check.needsRead && check.reviewed && (
        <span
          className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-[1.5px] ring-emerald-500 shadow-sm"
          aria-label={check.reviewed}
        >
          {/* Same bubble as the unread badge, pixel for pixel; the check is
              laid over its body rather than drawn into a different icon. */}
          <span className="relative grid h-3 w-3 place-items-center">
            <MessageSquare className="h-3 w-3" strokeWidth={2.5} />
            <Check className="absolute left-[2.5px] top-[1.5px] h-[7px] w-[7px]" strokeWidth={3.5} />
          </span>
        </span>
      )}
    </button>
  );
});


// ─── Checkpoint circle popover — REAL actions only (no stub toggles) ────────
/**
 * Click a checkpoint circle to act on it:
 *  - Confirmation (not green): "Mark Confirmed — operator" writes Patient
 *    Order Response = Confirmed on Monday + logs a note. Use when the
 *    patient confirmed by text/call instead of the form, or Brandon
 *    decides it's safe to proceed. Once all 4 checks are green the row
 *    auto-promotes to Ready to Order.
 *  - Eligibility (not green): "Run Eligibility Now" fires the real check.
 *  - Any: "Block order…" opens the Block dialog.
 */
/** Set when a popover closes from an outside click; the row under the
 *  pointer ignores the click that follows so it can't open a profile. */
let swallowRowClicksUntil = 0;

function CircleEditPopover({
  check, kind, patient, onBlockRequest, children,
}: {
  check: Checkpoint;
  kind: CheckpointKind;
  patient: SubscriptionPatient;
  onBlockRequest?: (p: SubscriptionPatient) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { invalidate, markDvsRequested, markEligibilityRequested, markReviewed } = useInvalidateSubscription();

  // What the popover says is derived per circle from the live fields
  // (lib/subscription/circleDetail.ts). The button follows the verdict:
  // green → Pause (the default is already "advance"); not green → the one
  // action that moves it (Brandon, 2026-09-20).
  const live = patient as SubscriptionPatient & Partial<LiveSubscriptionPatient>;
  const d = describeCircle(kind, check, live, todayIso(), lastOrderDay({ nextOrderDate: live.nextOrderDate, orderFrequency: live.orderFrequency }).day);

  const run = async (fn: () => Promise<unknown>) => {
    setSaving(true); setErr(null);
    try {
      await fn();
      invalidate();
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const verdictCls = d.verdict?.kind === "advanced" ? "text-emerald-800 bg-emerald-50 border-emerald-200"
    : d.verdict?.kind === "held" ? "text-rose-800 bg-rose-50 border-rose-200"
    : d.verdict?.kind === "overridden" ? "text-amber-900 bg-amber-50 border-amber-200"
    : "text-slate-700 bg-slate-50 border-slate-200";
  const verdictWord = d.verdict?.kind === "advanced" ? "Advanced by rules" : d.verdict?.kind === "held" ? "Held by rules" : d.verdict?.kind === "overridden" ? "Overridden" : "Waiting";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-4"
        // Clicking outside closes the popover — and must NOT also land on the
        // row underneath and open somebody's profile (Brandon, 2026-09-20).
        onPointerDownOutside={() => { swallowRowClicksUntil = Date.now() + 400; }}>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close"
          className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="space-y-3">
          <div className="pr-6">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {PHASE_LABELS[kind]} — {patient.name}
            </div>
            <div className="mt-0.5 text-[14px] font-semibold">{d.headline}</div>
          </div>

          {d.facts.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              {d.facts.map((f) => (
                <Fragment key={f.label}>
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className={cn("flex min-w-0 items-start gap-1.5 break-words font-medium",
                    f.tone === "ok" ? "text-emerald-700" : f.tone === "bad" ? "text-rose-700" : f.tone === "muted" ? "text-muted-foreground font-normal" : "")}>
                    {f.mark === "ok" && <span className="mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>}
                    {f.mark === "bad" && <span className="mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-rose-600 text-white"><X className="h-2.5 w-2.5" strokeWidth={3} /></span>}
                    <span>{f.value}</span>
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}

          {d.verdict && (
            <div className={cn("rounded-md border px-2.5 py-1.5 text-[12px]", verdictCls)}>
              <span className="font-semibold">{verdictWord}</span> — {d.verdict.text}
            </div>
          )}

          {/* The patient's words first; what changed on the form second. */}
          {check.needsRead && (
            <div className="rounded-md border border-sky-200 bg-sky-50/70 px-2 py-1.5 text-[11px] text-sky-950">
              <div className="mb-0.5 font-semibold text-sky-900">Read before ordering</div>
              {(check.needsReadLines?.length ? check.needsReadLines : [check.needsRead]).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
          {!check.needsRead && check.patientMessage && (
            <div className="rounded-md border border-sky-200 bg-sky-50/70 px-2 py-1.5 text-[11px] text-sky-950">
              <div className="mb-0.5 font-semibold text-sky-900">Patient message</div>
              {check.patientMessage}
            </div>
          )}
          {check.changes && check.changes.length > 0 && (
            <div className="text-[11px] text-orange-700">Changes: {check.changes.join(" • ")}</div>
          )}

          {check.reviewed && !check.needsRead && (
            <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800">
              <MessageSquare className="h-3 w-3" /> {check.reviewed}
            </div>
          )}

          {/* Decisions, in the order they are made: read it (Mark reviewed,
              only when a message is holding a green Confirm), then hold the
              patient (Pause, amber) or take them out of the cycle (Inactive,
              red) — Brandon, 2026-09-20. */}
          {d.action === "pause" && (
            <div className="space-y-2">
              {kind === "confirmation" && check.needsRead && (
                <Button size="sm" variant="outline" className="w-full border-emerald-300 bg-emerald-50 font-semibold text-emerald-800 hover:bg-emerald-700 hover:text-white" disabled={saving}
                  onClick={() => void run(async () => {
                    const initials = operatorInitials();
                    await writeOrderStamps(patient.mondayItemId, { correspondenceReviewed: makeStamp({ initials, nextOrderDate: patient.nextOrderDate }) });
                    markReviewed(patient.mondayItemId, `Reviewed by ${initials} ${fmtStamp({ at: Date.now(), iso: "", initials, forOrder: patient.nextOrderDate, reason: "" })}`);
                  })}
                  title="I read the texts, calls and notes since the last order">
                  {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Mark reviewed
                </Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                  onClick={() => { setOpen(false); onBlockRequest?.(patient); }} disabled={!onBlockRequest}
                  title="Pause this patient — a reason and a check-in date">
                  <PauseCircle className="mr-1.5 h-3.5 w-3.5" /> Pause
                </Button>
                <Button size="sm" variant="outline" className="border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100"
                  onClick={() => { setOpen(false); setInactiveOpen(true); }}
                  title="Move this patient to Not Active — out of the Order Cycle until reactivated">
                  <UserX className="mr-1.5 h-3.5 w-3.5" /> Inactive
                </Button>
              </div>
            </div>
          )}
          {d.action === "advance" && (
            <Button size="sm" className="w-full bg-emerald-700 hover:bg-emerald-800" onClick={() => { setOpen(false); setAdvanceOpen(true); }}
              title="Override this circle for this order, with a reason">
              <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Order anyway
            </Button>
          )}
          {d.action === "run-eligibility" && (
            <Button size="sm" variant="outline" className="w-full" disabled={saving}
              onClick={() => void run(async () => { await runEligibilityCheck(patient.mondayItemId); markEligibilityRequested([patient.mondayItemId]); })}
              title="Sets Run Check to Run on the board; Stedi answers within a minute and writes the verdict back">
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Run eligibility check
            </Button>
          )}
          {d.action === "run-dvs" && (
            <Button size="sm" className="w-full bg-sky-700 hover:bg-sky-800" disabled={saving}
              onClick={() => void run(async () => { await setDvsTrigger(patient.mondayItemId); markDvsRequested([patient.mondayItemId]); })}
              title="Writes Trigger DVS on the board; the ePACES bot picks it up and writes the result back">
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Shield className="mr-1.5 h-3.5 w-3.5" />}
              Run DVS
            </Button>
          )}

          {err && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">{err}</div>
          )}
        </div>
      </PopoverContent>
      {kind === "confirmation" && <AdvanceDialog patient={advanceOpen ? patient : null} open={advanceOpen} onClose={() => setAdvanceOpen(false)} />}
      <InactiveDialog patient={inactiveOpen ? (patient as LiveSubscriptionPatient) : null} open={inactiveOpen} onClose={() => setInactiveOpen(false)} />
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


/**
 * Out-of-pocket pill — surfaces when the patient still owes meaningful
 * money this cycle (deductible remaining + coinsurance gap).
 *
 * Heuristic:
 *   totalOop = max(dedRemaining, 0) — first dollars the patient owes
 *               before insurance kicks in fully. We don't have order
 *               cost on this row so we can't include the coinsurance
 *               contribution precisely; the hover surfaces coinsurance
 *               % and OOP Max Remaining so the operator can do the
 *               math when needed.
 *
 * Render gates:
 *   - Pill shown only when totalOop >= 100 (per Brandon 2026-06-07).
 *   - Colour scales with size: 100–499 amber, 500+ red.
 *   - Hover shows the breakdown.
 *
 * Pulls extra fields via a cast — they exist on LiveSubscriptionPatient
 * but not the mock SubscriptionPatient type.
 */
function parseMoney(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function fmtMoneyAmt(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
/**
 * Money figures that should exist and don't — OOP Estimate blank inside 20
 * days of the order, Total GP blank. Not a verdict (the Confirm circle carries
 * that); a "go fix the data for this patient" note, next to the name where it
 * can't be missed (Brandon, 2026-09-20). See payerRules.confirmPolicy.
 */
function FlagBadges({ patient }: { patient: SubscriptionPatient }) {
  const flags = patient.flags ?? [];
  if (!flags.length) return null;
  return (
    <>
      {flags.map((f) => (
        <span
          key={f.id}
          title={f.detail}
          className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700"
        >
          <AlertTriangle className="h-3 w-3" />{f.label}
        </span>
      ))}
    </>
  );
}

/**
 * What the circles mean, in one line. Dark = the Monday column decided on its
 * own; light (hollow) = a payer rule changed the answer, hover for why. Sits in
 * the header because the light marks are exactly the decisions the rules are
 * making for you tonight (Brandon, 2026-09-20).
 */
function MarkLegend({ onRules }: { onRules?: () => void }) {
  const dot = (cls: string, inner?: React.ReactNode) => (
    <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full ring-2", cls)}>{inner}</span>
  );
  return (
    <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        {dot("bg-emerald-600 ring-emerald-600", <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />)}
        {dot("bg-rose-600 ring-rose-600", <X className="h-2.5 w-2.5 text-white" strokeWidth={3} />)}
        <span><span className="font-semibold text-foreground">Dark</span> — the board decided</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        {dot("bg-emerald-50 ring-emerald-600", <Check className="h-2.5 w-2.5 text-emerald-600" strokeWidth={3} />)}
        {dot("bg-rose-50 ring-rose-600", <X className="h-2.5 w-2.5 text-rose-600" strokeWidth={3} />)}
        <span><span className="font-semibold text-foreground">Light</span> — a payer rule decided, click for why</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        {dot("bg-amber-400 ring-amber-400", <span className="text-[9px] font-bold leading-none text-white">!</span>)}
        <span>Something to do</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        {dot("bg-slate-400 ring-slate-400", <span className="text-[8px] leading-none text-white">…</span>)}
        <span>Answer on its way</span>
      </span>
      {onRules && (
        <button type="button" onClick={onRules} className="underline decoration-dotted underline-offset-2 hover:text-foreground">
          All rules
        </button>
      )}
    </div>
  );
}

function OopBadge({ patient }: { patient: SubscriptionPatient }) {
  const live = patient as unknown as {
    oopEstimate?: string; dedRemaining?: string; coinsurancePct?: string;
    oopMaxRemaining?: string; deductibleAmt?: string; oopMax?: string;
  };
  const ded   = parseMoney(live.dedRemaining);
  const coins = parseMoney(live.coinsurancePct);
  const oopR  = parseMoney(live.oopMaxRemaining);
  // Headline: prefer the OOP Estimate column (text_mm404p7d), which
  // Brandon's separate automation precomputes from deductible +
  // coinsurance + order cost. Fall back to deductible remaining when
  // the estimate column is empty (older rows that haven't been
  // re-evaluated yet).
  const estimate = parseMoney(live.oopEstimate);
  const totalOop = estimate ?? ded ?? 0;
  if (totalOop < 100) return null;

  const tone = totalOop >= 500
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-amber-200 bg-amber-50 text-amber-800";

  const lines = [
    `Total OOP: ${fmtMoneyAmt(totalOop)}${estimate == null ? " (deductible only — order cost unknown)" : ""}`,
    ded   != null ? `Deductible remaining: ${fmtMoneyAmt(ded)}`            : null,
    coins != null ? `Coinsurance: ${coins}%`                                : null,
    oopR  != null ? `OOP Max remaining: ${fmtMoneyAmt(oopR)}`               : null,
  ].filter(Boolean).join("\n");

  return (
    <span
      title={lines}
      className={cn(
        "ml-1.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
        tone,
      )}
    >
      {fmtMoneyAmt(totalOop)} OOP
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

/** The one action on a row, named for where the row goes next. */
export type RowActionMode = "prep" | "ready";

const CHECK_NAMES: Record<CheckpointKind, string> = {
  confirmation: "Confirm", benefits: "Eligibility", auth: "Authorization", lastPaid: "Last Claim Paid", mr: "Medical Records",
};

function blockingChecks(p: SubscriptionPatient): string[] {
  return CHECKPOINT_KINDS
    .map((k) => [k, getCheckpoint(p, k)] as const)
    .filter(([, c]) => c.tone !== "ok")
    .map(([k, c]) => `${CHECK_NAMES[k]}: ${c.label}`);
}

/**
 * The row's single action (Brandon, 2026-09-20: the pause and comms buttons
 * are gone from the row — pausing, texting and calling happen from the
 * patient's page, after looking at what is going on).
 *
 *   Order Prep tab → "Ready to Order": writes Ordering Cycle = Ready to Order.
 *     Only enabled once the five circles are green; until then the hover
 *     lists what is still holding the row.
 *   Ready to Order tab → "Send to Order": writes Ordering Cycle = Order, the
 *     trigger for the Monday automation that spawns the order.
 */
function ReviewAndSubmit({ p, mode, onSubmit, onPromote, sending, sent }: {
  p: SubscriptionPatient;
  mode: RowActionMode;
  onSubmit: () => void;
  onPromote?: () => void;
  sending?: boolean;
  sent?:    boolean;
}) {
  const ready = allChecksPass(p);
  const blockers = ready ? [] : blockingChecks(p);
  // A first order that fails the arrival audit can't be sent to Order until the
  // profile is fixed — hard block, with the reason on the button (Brandon,
  // 2026-09-21). Only gates the send; the Order Prep "Ready to Order" promote is
  // unaffected.
  const prep = mode === "prep";
  const first = isFirstOrder(p.orderType);
  const gate = useOrderGate(p.mondayItemId, first);
  const gateBlocked = !prep && !!gate && !gate.orderable;
  const gateReason = gate?.blocking_reason
    || gate?.findings.filter((f) => f.blocks_order).map((f) => `${f.label}: ${f.message}`).join("\n")
    || "The first-order profile audit is blocking this order";
  // Sending with non-green circles takes a second, explicit click — the
  // first arms the button ("Send anyway?") for 4s. Ready tab only.
  const [armed, setArmed] = useState(false);
  const handle = () => {
    if (gateBlocked) return;
    if (mode === "prep") { if (ready) onPromote?.(); return; }
    if (ready || armed) { setArmed(false); onSubmit(); return; }
    setArmed(true);
    setTimeout(() => setArmed(false), 4000);
  };
  return (
    <div className="flex items-center justify-end pl-4" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        onClick={handle}
        disabled={sending || sent || (prep && !ready) || gateBlocked}
        className={cn(
          "h-7 whitespace-nowrap px-2.5 text-[11px] font-semibold text-white shadow-sm transition-colors disabled:opacity-100",
          sending ? "bg-blue-600"
          : sent  ? "bg-emerald-600"
          : gateBlocked ? "bg-rose-300 text-rose-900"
          : armed ? "bg-rose-600 hover:bg-rose-700"
          : ready ? "bg-emerald-700 hover:bg-emerald-800"
          : prep  ? "bg-slate-300 text-slate-600"
                  : "bg-slate-400 hover:bg-slate-500",
        )}
        title={
          gateBlocked ? `Can't send — first-order profile isn't ready:\n  ${gateReason}`
          : sending ? (prep ? "Writing Ordering Cycle = Ready to Order on Monday…" : "Writing Ordering Cycle = Order on Monday…")
          : sent   ? (prep ? "Moved to Ready to Order" : "Sent — Monday automation now spawns the order")
          : armed  ? "Not all five checks are green — click again to send anyway"
          : ready  ? (prep ? "All five checks green — move to Ready to Order" : "All five checks green — send to Order")
          : prep   ? `Still holding this row:\n  ${blockers.join("\n  ")}`
                   : `Not all five checks pass — you'll be asked to confirm\n  ${blockers.join("\n  ")}`
        }
      >
        {sending ? (<><Loader2 className="mr-1 h-3 w-3 animate-spin" />{prep ? "Moving…" : "Sending…"}</>)
        : sent    ? (<><Check    className="mr-1 h-3 w-3" />{prep ? "Ready" : "Sent"}</>)
        : armed   ? (<><AlertTriangle className="mr-1 h-3 w-3" />Send anyway?</>)
        : prep    ? (<><Check    className="mr-1 h-3 w-3" />Ready to Order</>)
        :           (<><Send     className="mr-1 h-3 w-3" />Send to Order</>)}
      </Button>
    </div>
  );
}


// ─── Drawer ──────────────────────────────────────────────────────────────────
/**
 * The comms block inside the profile drawer. It opens the existing CommsSheet
 * rather than inlining the tabs, because the drawer is itself a Radix Sheet
 * and nesting two scroll-locked overlays is how you get a page that cannot be
 * dismissed. One click, the thread opens over the top, closing returns here.
 */
/**
 * The per-circle drawer: one check, its status, and the actions on it. The
 * whole-patient view it used to carry (readiness list, comms, claim history)
 * moved to the full-page PatientPage on 2026-09-20 — a row click opens that.
 */
function PatientDrawer({
  patient, kind, onClose,
}: {
  patient: SubscriptionPatient | null;
  kind: CheckpointKind | null;
  onClose: () => void;
}) {
  const open = !!patient && !!kind;
  if (!open || !patient || !kind) {
    return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>;
  }
  const checkpoint: Checkpoint = getCheckpoint(patient, kind);
  const gate = CHECKPOINT_GATE[kind];
  const isSoft = gate === "soft";
  const isFailing = checkpoint.tone !== "ok";
  const title = ({
    confirmation: "Patient Confirmation",
    benefits:     "Benefits & Eligibility",
    auth:         "Authorization",
    lastPaid:     "Last Order — Claim Status",
    mr:           "Medical Records",
  } as const)[kind];
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className={cn("w-[480px] sm:max-w-[480px]", "overflow-y-auto")}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {patient.name} · {patient.subscriptionType} · {patient.primaryPayer} · order {fmtDate(patient.nextOrderDate)}
          </SheetDescription>
        </SheetHeader>

        {(
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
          {kind === "confirmation" && (
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1"><Send className="mr-2 h-4 w-4" />Resend Reorder Text</Button>
              <Button className="flex-1"><Check className="mr-2 h-4 w-4" />Mark Changes Reviewed</Button>
            </div>
          )}
          {kind === "benefits" && (
            <Button className="w-full"><RefreshCw className="mr-2 h-4 w-4" />Run Eligibility Now</Button>
          )}
          {kind === "auth" && (
            <Button className="w-full"><ExternalLink className="mr-2 h-4 w-4" />Open Auth Workflow</Button>
          )}
          {kind === "lastPaid" && (
            <Button variant="outline" className="w-full"><ExternalLink className="mr-2 h-4 w-4" />Open in Claims UI</Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Order Cycle v2: lane badges, block dialogs, blocked table ───────────────

/**
 * Ship-candidate badge (doc §4) — SUGGESTION ONLY, a human always ships.
 * Green-outline chip on rows where the economics guarantee profit even
 * without a patient confirmation: text sent + no reply + other 3 checks
 * green + no unreviewed changes + OOP < $100 + GP > $100.
 */
function ShipCandidateBadge({ patient }: { patient: SubscriptionPatient }) {
  const sc = shipCandidate(patient as LanePatient);
  if (!sc.ok) return null;
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"
      title={`No reply yet, but economics are safe to ship:\nOOP estimate ${fmtMoneyAmt(sc.oop ?? 0)} (< $100) · Est. profit ${fmtMoneyAmt(sc.gp ?? 0)} (> $100)\nEligibility, auth and last-order-paid are all green.\nShipping without confirmation is ALWAYS your call — this is only a suggestion.`}
    >
      <Send className="h-3 w-3" />
      Ship candidate
    </span>
  );
}

/** Watching / Looks-resolved pill for the Blocked table (client-side watcher). */
function ResolutionPill({ patient }: { patient: LanePatient }) {
  if (needsReason(patient)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
        <AlertTriangle className="h-3 w-3" /> No reason set
      </span>
    );
  }
  if (possiblyResolved(patient)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
        <Bell className="h-3 w-3" /> Looks resolved
      </span>
    );
  }
  const signals = [...new Set(
    blockReasons(patient)
      .filter((r) => !reasonResolved(patient, r))
      .map((r) => FAMILY_SIGNAL[reasonFamily(r)]),
  )];
  return (
    <div className="space-y-0.5">
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
        <Clock className="h-3 w-3" /> Watching
      </span>
      {signals.length > 0 && (
        <div className="text-[10px] text-muted-foreground leading-tight">{signals.join(" · ")}</div>
      )}
    </div>
  );
}

/** Family display metadata — the explicit "which bucket" indicator. */
const FAMILY_NAME: Record<ReasonFamily, string> = {
  insurance: "Insurance",
  auth:      "Auth",
  money:     "Money",
  patient:   "Patient",
  other:     "Manual",
};
const FAMILY_SIGNAL: Record<ReasonFamily, string> = {
  insurance: "elig active?",
  auth:      "auth valid?",
  money:     "claims paid?",
  patient:   "contact / check-in",
  other:     "manual only",
};
function FamilyIcon({ fam, className }: { fam: ReasonFamily; className?: string }) {
  const cls = className ?? "h-3 w-3";
  return fam === "insurance" ? <Building2 className={cls} />
       : fam === "auth"      ? <Shield className={cls} />
       : fam === "money"     ? <DollarSign className={cls} />
       : fam === "patient"   ? <Heart className={cls} />
       : <Pencil className={cls} />;
}

/** Reason chips inside the Blocked table — specific label, tinted by family. */
const FAMILY_CHIP: Record<ReasonFamily, string> = {
  insurance: "bg-sky-50 border-sky-200 text-sky-800",
  auth:      "bg-violet-50 border-violet-200 text-violet-800",
  money:     "bg-rose-50 border-rose-200 text-rose-800",
  patient:   "bg-amber-50 border-amber-200 text-amber-800",
  other:     "bg-slate-50 border-slate-200 text-slate-700",
};
const FAMILY_TITLE: Record<ReasonFamily, string> = {
  insurance: "Insurance family — resolves when eligibility comes back Active",
  auth:      "Auth/clinical family — resolves when a valid auth is on file",
  money:     "Money family — resolves when the last order's claims are settled",
  patient:   "Waiting-on-patient family — resolves on inbound contact or check-in",
  other:     "Manual — never auto-resolves",
};
function ReasonChips({ patient }: { patient: LanePatient }) {
  const reasons = blockReasons(patient);
  if (reasons.length === 0) return <span className="text-[11px] text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((r) => {
        const fam = reasonFamily(r);
        return (
          <span
            key={r}
            title={FAMILY_TITLE[fam]}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
              FAMILY_CHIP[fam],
            )}
          >
            <FamilyIcon fam={fam} />
            <span className="opacity-60">{FAMILY_NAME[fam]} ·</span> {r}
          </span>
        );
      })}
    </div>
  );
}

/**
 * BlockDialog — the one dialog for "we can't order for this patient yet".
 * Reason(s) required; check-in date required for Waiting on Patient
 * (suggested for everything else); note becomes the head of the
 * append-only Block Note log.
 */
export function BlockDialog({
  patient, open, onClose, onDone,
}: {
  patient: LanePatient | null;
  open: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [reasons, setReasons] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [checkIn, setCheckIn] = useState<string>(addDaysIso(DEFAULT_CHECK_IN_DAYS));
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed local state each time a new patient opens the dialog.
  const [seedId, setSeedId] = useState<string | null>(null);
  if (patient && patient.mondayItemId !== seedId) {
    setSeedId(patient.mondayItemId);
    setReasons(new Set(blockReasons(patient)));
    setNote("");
    setConfirming(false);
    setCheckIn(patient.checkInDate || addDaysIso(DEFAULT_CHECK_IN_DAYS));
    setErr(null);
  }
  if (!patient) return null;

  const needsCheckIn = checkInRequiredFor([...reasons]);
  const canSave = reasons.size > 0 && !saving
    && (!needsCheckIn || !!checkIn)
    && (!reasons.has("Other") || note.trim().length > 0);

  const toggle = (r: string) => setReasons((prev) => {
    const n = new Set(prev);
    if (n.has(r)) n.delete(r); else n.add(r);
    return n;
  });

  const save = async () => {
    setSaving(true); setErr(null);
    const res = await blockPatient(patient.mondayItemId, {
      reasons: [...reasons],
      note: note.trim(),
      checkInDate: checkIn || undefined,
      existingNote: patient.blockNote,
    });
    setSaving(false);
    if (res.failed.length > 0) {
      setErr(`Some writes failed: ${res.failed.map((f) => f.step).join(", ")} — check Monday and retry.`);
      return;
    }
    onDone(`${patient.name} blocked — ${[...reasons].join(", ")}`);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <PauseCircle className="h-5 w-5 text-rose-600" /> Block order
          </SheetTitle>
          <SheetDescription>
            {patient.name} · order {patient.nextOrderDate ? fmtDate(patient.nextOrderDate) : "—"} · {patient.primaryPayer}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Why can't we order? <span className="text-rose-600">*</span>
            </div>
            <div className="space-y-2.5">
              {BLOCK_REASON_GROUPS.map((g) => (
                <div key={g.family}>
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                    <FamilyIcon fam={g.family} className="h-3 w-3" />{g.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.reasons.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggle(r)}
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-[12px] font-semibold text-left transition-colors",
                          reasons.has(r)
                            ? "border-rose-400 bg-rose-50 text-rose-800"
                            : "border-border bg-card hover:bg-muted text-foreground",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Pick the specific situation — its family arms the right resolution watcher automatically.
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Check-in date {needsCheckIn
                ? <span className="text-rose-600">* required for Waiting on Patient</span>
                : <span className="normal-case tracking-normal">(suggested)</span>}
            </div>
            <Input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="h-9 text-[13px]"
            />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Note{reasons.has("Other") ? <span className="text-rose-600"> * required for Other</span> : " (context — logged)"}
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What's the situation? e.g. 'In rehab facility until ~Aug 15 per daughter'"
              className="min-h-[80px] text-[13px]"
            />
          </div>

          {err && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">{err}</div>
          )}
        </div>

        <SheetFooter className="mt-6">
          {/* Two clicks to pause (Brandon, 2026-09-20): the first shows what
              is about to happen, the second does it. */}
          {confirming ? (
            <div className="w-full space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="text-[13px] font-semibold text-amber-900">Pause {patient?.name}?</div>
              <div className="text-[12px] text-amber-900">
                {[...reasons].join(", ")}{checkIn ? ` · check in ${fmtDate(checkIn)}` : ""}. Leaves tonight's list until unpaused.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
                <Button size="sm" className="bg-amber-500 text-amber-950 hover:bg-amber-600" disabled={!canSave} onClick={() => void save()}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-2 h-4 w-4" />}
                  Yes, pause
                </Button>
              </div>
            </div>
          ) : (
            <Button className="w-full bg-amber-500 text-amber-950 hover:bg-amber-600" disabled={!canSave} onClick={() => setConfirming(true)}>
              <PauseCircle className="mr-2 h-4 w-4" /> Pause patient…
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * CheckInDialog — record a check-in on a blocked patient.
 * Contact → counter resets. No contact → counter +1; at
 * FORCED_DECISION_MISSES the dialog forces the fork: renew with a
 * reason, or move to Not Active (doc §3.3). Unblock lives here too.
 */
export function CheckInDialog({
  patient, open, onClose, onDone,
}: {
  patient: LanePatient | null;
  open: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [outcome, setOutcome] = useState<"contact" | "nocontact" | null>(null);
  const [note, setNote] = useState("");
  const [nextDate, setNextDate] = useState<string>(addDaysIso(DEFAULT_CHECK_IN_DAYS));
  const [deadReason, setDeadReason] = useState<string>("");
  const [churnMode, setChurnMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [seedId, setSeedId] = useState<string | null>(null);
  if (patient && patient.mondayItemId !== seedId) {
    setSeedId(patient.mondayItemId);
    setOutcome(null); setNote(""); setChurnMode(false); setDeadReason("");
    setNextDate(addDaysIso(DEFAULT_CHECK_IN_DAYS));
    setErr(null);
  }
  if (!patient) return null;

  const missed = patient.missedCheckIns ?? 0;
  const wouldBeMiss = missed + 1;
  const forced = outcome === "nocontact" && wouldBeMiss >= FORCED_DECISION_MISSES;

  const finish = (msg: string) => { onDone(msg); onClose(); };
  const fail = (res: { failed: Array<{ step: string }> }) =>
    setErr(`Some writes failed: ${res.failed.map((f) => f.step).join(", ")} — check Monday and retry.`);

  const saveCheckIn = async () => {
    setSaving(true); setErr(null);
    const res = await recordCheckIn(patient.mondayItemId, {
      contact: outcome === "contact",
      note: note.trim(),
      nextDate: nextDate || undefined,
      currentMissed: missed,
      existingNote: patient.blockNote,
    });
    setSaving(false);
    if (res.failed.length > 0) return fail(res);
    finish(`Check-in logged for ${patient.name}`);
  };

  const saveUnblock = async () => {
    setSaving(true); setErr(null);
    const res = await unblockPatient(patient.mondayItemId, {
      note: note.trim() || undefined,
      existingNote: patient.blockNote,
    });
    setSaving(false);
    if (res.failed.length > 0) return fail(res);
    finish(`${patient.name} unblocked — back to Active`);
  };

  const saveChurn = async () => {
    setSaving(true); setErr(null);
    const res = await churnPatient(patient.mondayItemId, {
      deadReason,
      note: note.trim() || undefined,
      existingNote: patient.blockNote,
    });
    setSaving(false);
    if (res.failed.length > 0) return fail(res);
    finish(`${patient.name} moved to Not Active (${deadReason})`);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-sky-700" /> Check-in — {patient.name}
          </SheetTitle>
          <SheetDescription>
            Blocked{patient.blockedDate ? ` since ${fmtDate(patient.blockedDate)}` : ""} · {blockReasons(patient).join(", ") || "no reason set"}
            {missed > 0 && ` · ${missed} missed check-in${missed === 1 ? "" : "s"}`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {patient.blockNote && (
            <div className="rounded-md bg-muted/50 border p-3 max-h-[140px] overflow-y-auto">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Block log</div>
              <pre className="whitespace-pre-wrap text-[11px] text-slate-700 font-sans">{patient.blockNote}</pre>
            </div>
          )}

          {!churnMode && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Outcome</div>
              <div className="flex gap-2">
                <Button
                  type="button" size="sm" variant={outcome === "contact" ? "default" : "outline"}
                  className={cn("flex-1", outcome === "contact" && "bg-emerald-700 hover:bg-emerald-800")}
                  onClick={() => setOutcome("contact")}
                >
                  <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Patient contact / new info
                </Button>
                <Button
                  type="button" size="sm" variant={outcome === "nocontact" ? "default" : "outline"}
                  className={cn("flex-1", outcome === "nocontact" && "bg-amber-600 hover:bg-amber-700")}
                  onClick={() => setOutcome("nocontact")}
                >
                  <Clock className="mr-1.5 h-3.5 w-3.5" /> No contact
                </Button>
              </div>
            </div>
          )}

          {forced && !churnMode && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 space-y-2">
              <div className="text-[12px] font-bold text-rose-700 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> This would be miss #{wouldBeMiss} in a row
              </div>
              <div className="text-[12px] text-rose-800">
                Two consecutive check-ins with no contact — decide: renew the block
                with a reason and a new date, or move the patient to Not Active.
                (They can always be reactivated if they resurface.)
              </div>
              <Button
                type="button" size="sm" variant="outline"
                className="w-full border-rose-300 text-rose-700 hover:bg-rose-100"
                onClick={() => setChurnMode(true)}
              >
                <UserX className="mr-1.5 h-3.5 w-3.5" /> Move to Not Active instead…
              </Button>
            </div>
          )}

          {churnMode && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 space-y-2">
              <div className="text-[12px] font-bold text-rose-700">Move to Not Active</div>
              <Select value={deadReason} onValueChange={setDeadReason}>
                <SelectTrigger className="h-9 text-[13px] bg-white"><SelectValue placeholder="Pick a churn reason…" /></SelectTrigger>
                <SelectContent>
                  {DEAD_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="ghost" className="w-full" onClick={() => setChurnMode(false)}>
                ← Back to check-in
              </Button>
            </div>
          )}

          {!churnMode && outcome && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Next check-in {outcome === "nocontact" && !forced ? <span className="text-rose-600">*</span> : "(optional)"}
              </div>
              <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className="h-9 text-[13px]" />
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Note {forced && !churnMode ? <span className="text-rose-600">* required to renew</span> : ""}
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={churnMode ? "Anything worth logging before parking this patient…" : "What happened? e.g. 'LVM, will try again Friday' / 'Texted back — ready to reorder'"}
              className="min-h-[70px] text-[13px]"
            />
          </div>

          {err && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-700">{err}</div>
          )}
        </div>

        <SheetFooter className="mt-6 flex-col gap-2 sm:flex-col sm:space-x-0">
          {churnMode ? (
            <Button
              className="w-full bg-rose-700 hover:bg-rose-800"
              disabled={!deadReason || saving}
              onClick={() => void saveChurn()}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserX className="mr-2 h-4 w-4" />}
              Move to Not Active
            </Button>
          ) : (
            <Button
              className="w-full"
              disabled={saving || !outcome
                || (outcome === "nocontact" && !forced && !nextDate)
                || (forced && (!note.trim() || !nextDate))}
              onClick={() => void saveCheckIn()}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {forced ? "Renew block (logged)" : "Save check-in"}
            </Button>
          )}
          <Button
            variant="outline"
            className="w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            disabled={saving}
            onClick={() => void saveUnblock()}
            title="Clears the block entirely — patient returns to Active and re-enters Due if their order date has arrived"
          >
            <Unlock className="mr-2 h-4 w-4" /> Unblock — resolved
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
function OrderCycleWorkflow() {
  // Order Cycle v2 hierarchy (Brandon 2026-07-21):
  //   Lanes (when + blocked flag): Scheduled | Due | Blocked
  //   Readiness (within Scheduled & Due): Order Prep | Ready to Order
  // Ready = ships the moment the order date arrives — reachable BEFORE
  // the date (automations finish early) and derived (all 4 checks green,
  // or backend already promoted Ordering Cycle). Blocked is never ready;
  // unblocking returns the patient to whichever lane their date says.
  // Ready to Order is a readiness sub-split now, not a top-level tab.
  type PrimaryTab = "due" | "prep" | "blocked" | "neworder" | "overview" | "rules";
  const [primary, setPrimary] = useState<PrimaryTab>("due");
  type PrepPhase = CheckpointKind | "all" | "readysub";
  const [prepPhase, setPrepPhase] = useState<PrepPhase>("all");
  type DuePhase = "ready" | "prepwork";
  const [duePhase, setDuePhase] = useState<DuePhase>("prepwork");
  // Needs Review is a filter INSIDE Order Prep, not a third bucket: every
  // row with an unread message is also in Order Prep, so showing it as a
  // sibling tab made 2 + 1 + 14 look like it should equal 16 (Brandon,
  // 2026-09-20).
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  // `phase` is the derived view selection used by the rest of the component.
  const phase: PhaseTab =
    primary === "overview" ? "overview"
    : primary === "due"     ? "overview"
    : primary === "blocked" ? "overview"
    : prepPhase === "all" || prepPhase === "readysub" ? "overview"
    : prepPhase;
  // Stable "today" for lane math — refreshed per render pass is fine,
  // lanes only care about the calendar date.
  const todayStr = todayIso();
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>("All payers");
  const [blocked, setBlocked] = useState<string>("Anyone");
  const [statusFilter, setStatusFilter] = useState<string>("Active");
  const [pauseReason, setPauseReason] = useState<string>("Any pause reason");
  const [activePatient, setActivePatient] = useState<SubscriptionPatient | null>(null);
  const [activeKind, setActiveKind] = useState<CheckpointKind | null>(null);
  // A row click opens the patient full-page, app-wide (see patient/openPatient).
  const { open: openPatientPage } = useOpenPatient();

  // ── Sort state ──
  // Default sort: nextOrderDate ascending (soonest order first). Operators
  // want to see what's coming due first; that's the whole point of Order
  // Prep. Column headers in both OverviewTable and PhaseTable are
  // clickable to re-sort.
  type SortKey =
    | "name" | "nextOrderDate" | "subscriptionType" | "primaryPayer"
    | "confirmation" | "benefits" | "auth" | "lastPaid" | "mr";
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
  // Order-group count for the top-level "Order" tab pill — same shared
  // React-Query cache the Order tab reads, so no extra fetch (Brandon,
  // 2026-09-20: "a pill on Order tab to show how many i have in there").
  const { data: newOrderData } = useNewOrders();
  // Count only orders due up through today — a future-dated order isn't work
  // to act on yet, so it shouldn't inflate the pill (Brandon, 2026-09-20).
  const orderCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return newOrderData.filter((r) => r.groupId === ORDER_GROUP_ID && (!r.orderDate || r.orderDate.slice(0, 10) <= today)).length;
  }, [newOrderData]);
  // Monday's Ordering Cycle follows the tool's readiness (Order Prep ↔ Ready
  // to Order) after every fresh read — see hooks/subscription/useOrderingCycleSync.
  const sync = useOrderingCycleSync();

  const counts = useMemo(() => {
    // Tab membership is driven by the Monday Ordering Cycle column —
    // NOT a client-side derivation. Backend cron + webhook own the
    // promotion from 'Order Prep' to 'Ready to Order' once all 4
    // gates pass + eligibility is current for the order's month.
    //
    // Order Cycle v2: the three lanes are pure derivations —
    //   Due       = order date arrived, no block reason
    //   Scheduled = order date in future (or blank), no block reason
    //   Blocked   = block reason set (or Paused with none — triage)
    //   Ready/Order tabs stay driven by the Monday Ordering Cycle column.
    //
    // The 4 phase sub-tabs under Scheduled use independent-bucket
    // semantics within the 21-day prep window: count + show patients
    // whose THAT specific checkpoint is non-OK.
    const c = {
      overview: 0,
      confirmation: 0, benefits: 0, auth: 0, lastPaid: 0, mr: 0,
      paused: 0,
      due: 0, dueReady: 0, duePrep: 0, dueNeedsRead: 0,
      scheduled: 0, schedReady: 0,
      possiblyResolved: 0,
      checkInsDue: 0,
      noReason: 0,
    };
    for (const p of all) {
      const lp = p as LanePatient;
      // Not Active group is parked — excluded from every lane count.
      if ((lp as { isNotActive?: boolean }).isNotActive) continue;
      c.overview++;
      // Blocked patients get pulled out of Scheduled / Due so they
      // don't clutter the happy-path queues. Lane counts + watcher
      // queues computed here in one pass.
      if (isBlocked(lp)) {
        c.paused++;
        if (possiblyResolved(lp)) c.possiblyResolved++;
        if (checkInDue(lp, todayStr)) c.checkInsDue++;
        if (needsReason(lp)) c.noReason++;
        continue;
      }
      // Readiness is the second axis: within Due and Scheduled every
      // patient is either Ready to Order (ships as soon as the date
      // arrives) or Order Prep (something still to clear).
      const ready = isReady(lp);
      if (getLane(lp, todayStr) === "due") {
        c.due++;
        if (ready) c.dueReady++; else c.duePrep++;
        if (p.confirmation.needsRead) c.dueNeedsRead++;
        continue;
      }
      c.scheduled++;
      if (ready) { c.schedReady++; continue; }
      // Checkpoint buckets: actionable prep work = scheduled orders
      // inside the 21-day window with that checkpoint non-OK.
      if (!withinOrderPrepWindow(p)) continue;
      if (p.confirmation.tone !== "ok") c.confirmation++;
      if (p.benefits.tone     !== "ok") c.benefits++;
      if (p.auth.tone         !== "ok") c.auth++;
      if (p.lastPaid.tone     !== "ok") c.lastPaid++;
      if (mrOf(p).tone        !== "ok") c.mr++;
    }
    return c;
  }, [all, todayStr]);

  // Order Prep's action: Ordering Cycle = Ready to Order on Monday. The tool's
  // own readiness is still the five circles (the button only enables when
  // they are green); the write keeps the board's stage in step.
  const promoteToReady = async (p: SubscriptionPatient) => {
    const id = p.mondayItemId;
    setSendingIds((prev) => new Set(prev).add(id));
    setBatchMsg(`Moving ${p.name} to Ready to Order…`);
    try {
      const r = await saveSubscriptionPatient(id, { orderingCycle: "Ready to Order" });
      if (r.failed.length) throw new Error(r.failed[0].error);
      setSendingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setSentIds((prev) => new Set(prev).add(id));
      setBatchMsg(`${p.name} is Ready to Order ✓`);
      invalidateSubscription();
      setTimeout(() => setSentIds((prev) => { const n = new Set(prev); n.delete(id); return n; }), 2000);
    } catch (e) {
      setSendingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setBatchMsg(`Couldn't move ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const openCell = (p: SubscriptionPatient, kind: CheckpointKind) => { setActivePatient(p); setActiveKind(kind); };
  const openPatient = (p: SubscriptionPatient) => { openPatientPage(p.mondayItemId); };
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

  // ── Send all to Order (Ready to Order tab) ──
  const [sendAllRunning, setSendAllRunning] = useState(false);
  const [sendAllArmed, setSendAllArmed] = useState(false);
  const sendAllToOrder = async (readyRows: SubscriptionPatient[]) => {
    if (sendAllRunning || readyRows.length === 0) return;
    setSendAllRunning(true);
    setBatchRunning(true);
    let done = 0, failed = 0;
    // 4 at a time — same width as the DVS fan-out.
    const queue = [...readyRows];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift()!;
        setSendingIds((prev) => new Set(prev).add(p.mondayItemId));
        try {
          await sendToOrder(p.mondayItemId);
          setSentIds((prev) => new Set(prev).add(p.mondayItemId));
        } catch { failed++; }
        finally {
          setSendingIds((prev) => { const n = new Set(prev); n.delete(p.mondayItemId); return n; });
          setBatchMsg(`Sending to Order… ${++done}/${readyRows.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, readyRows.length) }, worker));
    setBatchMsg(failed ? `Sent ${readyRows.length - failed} to Order — ${failed} failed, try again` : `Sent ${readyRows.length} to Order ✓`);
    setSendAllRunning(false);
    setBatchRunning(false);
    setSendAllArmed(false);
    invalidateSubscription();
    setTimeout(() => { setSentIds(new Set()); setBatchMsg(null); }, 4000);
  };

  // ── Batch action state ──
  const { invalidate: invalidateSubscription, markDvsRequested, markEligibilityRequested } = useInvalidateSubscription();
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
  // ── Run DVS multi-select ──
  // Medicaid re-verifies eligibility per order, so a Medicaid row with an
  // order due needs a DVS run before it can be ordered — an open circle with
  // an M in the Authorization column. Those rows get a checkbox, and one
  // button fires Trigger DVS on every selected row at once (Brandon,
  // 2026-09-19). Held as Monday item ids so the set survives a refetch that
  // replaces the row objects.
  const [dvsSelected, setDvsSelected] = useState<Set<string>>(() => new Set());
  const [dvsRunning, setDvsRunning] = useState(false);
  const toggleDvsSelected = (id: string) =>
    setDvsSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  // Order Prep > Authorization sub-view toggle. When true, the
  // Authorization tab swaps the default PhaseTable for the existing
  // DvsQueue component — auto-filtered to Medicaid + non-Sensors-only
  // patients, rendered in the DVS-shaped table with bulk Run DVS +
  // per-row Run DVS actions. Brandon's mental model is "in Auth, I
  // want to flip into DVS mode for Medicaid patients I can act on
  // today, without leaving the order cycle."
  const [dvsView, setDvsView] = useState(false);

  // ── Order Cycle v2 dialogs (block / check-in) ──
  const [blockTarget, setBlockTarget]     = useState<LanePatient | null>(null);
  const [checkInTarget, setCheckInTarget] = useState<LanePatient | null>(null);
  const onBlockDone = (msg: string) => {
    setBatchMsg(msg);
    invalidateSubscription();
    setTimeout(() => setBatchMsg(null), 5000);
  };

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
    // Flip the circles to "…" for the ones that landed; the refetch confirms.
    const okIds = cohort.filter((_, i) => results[i].status === "fulfilled").map((p) => p.mondayItemId);
    markEligibilityRequested(okIds);
    setBatchMsg(failed === 0
      ? `Triggered ${ok} eligibility check${ok === 1 ? "" : "s"} ✓`
      : `Triggered ${ok}, ${failed} failed`);
    setBatchRunning(false);
    invalidateSubscription();
    setTimeout(() => setBatchMsg(null), 6000);
  };


  // filteredBase: search/payer/reason filters WITHOUT the status filter —
  // the Blocked tab must see Paused rows even while the default status
  // filter is "Active". filteredAll layers the status filter on top for
  // every other tab.
  const filteredBase = useMemo(() => {
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
      // Multi-select cell ("Waiting on Patient, Last Order Unpaid") —
      // match if the selected reason is among the row's labels.
      if (pauseReason !== "Any pause reason"
          && !blockReasons(p as LanePatient).includes(pauseReason)) return false;
      if (blocked !== "Anyone") {
        const map = { Us: "us", Patient: "patient", Payer: "payer", System: "system" } as const;
        if (p.blockedBy !== map[blocked as keyof typeof map]) return false;
      }
      return true;
    });
  }, [all, search, payer, blocked, pauseReason]);

  const filteredAll = useMemo(() => {
    return filteredBase.filter((p) =>
      statusFilter === "All" || p.patientStatus === statusFilter);
  }, [filteredBase, statusFilter]);

  const rows = useMemo(() => {
    let base: SubscriptionPatient[];
    // Tab membership is sourced from the Monday Ordering Cycle column
    // (color_mkyjawhq). Backend cron + webhook own the promotion to
    // 'Ready to Order' once all 4 gates pass + eligibility is current.
    // Client-side filters now mirror that single source of truth.
    if (primary === "blocked") {
      // Blocked lane: reason actively set (or Paused with none — the
      // triage cases). Bypasses the status filter via filteredBase.
      base = filteredBase.filter((p) =>
        !(p as LanePatient & { isNotActive?: boolean }).isNotActive
        && isBlocked(p as LanePatient));
    } else if (primary === "due") {
      // Due lane: order date arrived/past, no block. duePhase splits by
      // readiness — Ready to Order (send now) vs Order Prep (decide:
      // fix, promote, or block). Sorted oldest order first below.
      const dueRows = filteredAll.filter((p) =>
        !(p as LanePatient & { isNotActive?: boolean }).isNotActive
        && getLane(p as LanePatient, todayStr) === "due");
      // "Needs a read" cuts across readiness: it is the set where the
      // patient said something and nobody has decided what it means yet.
      base = dueRows.filter((p) => (duePhase === "ready") === isReady(p as LanePatient));
      if (duePhase === "prepwork" && needsReviewOnly) base = base.filter((p) => !!p.confirmation.needsRead);
    } else if (phase === "overview") {
      if (primary === "prep" && prepPhase === "all") {
        // Scheduled > All: every future-dated, unblocked order
        // (soonest first via the default sort).
        base = filteredAll.filter((p) =>
          !(p as LanePatient & { isNotActive?: boolean }).isNotActive
          && getLane(p as LanePatient, todayStr) === "scheduled",
        );
      } else if (primary === "prep" && prepPhase === "readysub") {
        // Scheduled > Ready to Order: future-dated and already clear —
        // will ship the moment the date arrives; nothing to do.
        base = filteredAll.filter((p) =>
          !(p as LanePatient & { isNotActive?: boolean }).isNotActive
          && getLane(p as LanePatient, todayStr) === "scheduled"
          && isReady(p as LanePatient),
        );
      } else {
        // Pure Overview tab: whole cohort regardless of status.
        base = filteredAll;
      }
    } else {
      // Phase sub-tabs (Confirmation / Eligibility / Auth / Last Paid):
      // scheduled orders inside the 21-day prep window with this
      // specific checkpoint non-OK; blocked rows never clog the buckets.
      base = filteredAll.filter((p) =>
        !(p as LanePatient & { isNotActive?: boolean }).isNotActive
        && getLane(p as LanePatient, todayStr) === "scheduled"
        && withinOrderPrepWindow(p)
        && getCheckpoint(p, phase).tone !== "ok",
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
    const CHECKPOINT_KEYS = new Set(["confirmation", "benefits", "auth", "lastPaid", "mr"]);
    const sorted = [...base].sort((a, b) => {
      if (CHECKPOINT_KEYS.has(sortKey)) {
        const ac = sortKey === "mr" ? mrOf(a) : (a as unknown as Record<string, { tone: string; label: string }>)[sortKey];
        const bc = sortKey === "mr" ? mrOf(b) : (b as unknown as Record<string, { tone: string; label: string }>)[sortKey];
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
  }, [filteredAll, filteredBase, phase, primary, prepPhase, duePhase, needsReviewOnly, sortKey, sortDir, todayStr]);

  // ── Run DVS: the rows in view that need one, and the ones we'll fire for ──
  // Scoped to the visible rows on purpose. The operator selects what they can
  // see; a hidden row cannot be silently included in a bulk write.
  // The tick only exists where a table draws it: the Overview grid, and the
  // Authorization phase table in its default (non-DvsQueue) view. Anywhere
  // else the bar would offer a "Select all" with nothing to select.
  const dvsSelectable =
    primary !== "blocked" && (phase === "overview" || (phase === "auth" && !dvsView));
  const dvsCandidates = useMemo(
    () => (dvsSelectable ? rows.filter((p) => !!p.auth.dvsNeeded && !isFirstOrder(p.orderType)) : []),
    [rows, dvsSelectable],
  );
  const dvsEligible   = useMemo(() => dvsCandidates.filter(canRunDvs), [dvsCandidates]);
  const dvsEligibleIds = useMemo(
    () => new Set(dvsEligible.map((p) => p.mondayItemId)),
    [dvsEligible],
  );
  // Only ever act on ids that are still both visible and eligible — a row that
  // scrolled out of the filter, or whose Confirm went red since it was ticked,
  // drops out of the run rather than riding along in a stale set.
  const dvsToRun = useMemo(
    () => [...dvsSelected].filter((id) => dvsEligibleIds.has(id)),
    [dvsSelected, dvsEligibleIds],
  );

  const runDvsForSelected = async () => {
    const ids = dvsToRun;
    if (!ids.length || dvsRunning) return;
    setDvsRunning(true);
    setBatchRunning(true);
    setBatchMsg(`Triggering DVS for ${ids.length} patient${ids.length === 1 ? "" : "s"}…`);
    try {
      const res = await bulkTriggerDvs(ids, (done, total) =>
        setBatchMsg(`Triggering DVS… ${done}/${total}`),
      );
      // Flip the circles to "…" now; the refetch confirms it in a few seconds.
      markDvsRequested(res.successIds);
      setDvsSelected((prev) => {
        // Keep whatever failed selected so a retry is one click, not a re-tick.
        const failed = new Set(res.failures.map((f) => f.id));
        return new Set([...prev].filter((id) => failed.has(id)));
      });
      setBatchMsg(
        res.failures.length
          ? `DVS triggered for ${res.successIds.length}, ${res.failures.length} failed — still selected, try again`
          : `DVS triggered for ${res.successIds.length} patient${res.successIds.length === 1 ? "" : "s"} ✓`,
      );
      invalidateSubscription();
    } catch (e) {
      setBatchMsg(`Run DVS failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDvsRunning(false);
      setBatchRunning(false);
      setTimeout(() => setBatchMsg(null), 6000);
    }
  };

  const renderPhaseTab = (k: PhaseTab, label: string, count: number) => (
    <TabsTrigger value={k} className="gap-1.5">
      {label}
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{count}</span>
    </TabsTrigger>
  );

  // The primary nav, once. Rendered by the main board and by the two
  // stand-alone tabs (Order, Rules) so the row is identical wherever the
  // operator is. Due and Order are the work; Paused is the parked set,
  // behind a divider. Overview and Rules are reference, not work — they sit
  // to the right, out of the flow (Brandon, 2026-09-20).
  const primaryNav = (
    <Tabs value={primary} onValueChange={(v) => setPrimary(v as PrimaryTab)}>
      <TabsList className="bg-card border h-11 p-1">
        <TabsTrigger value="due" className="text-[15px] font-semibold gap-2 px-4"
          title="Order date arrived, nothing pausing it — tonight's worklist">
          Due
          <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.due}</span>
        </TabsTrigger>
        <TabsTrigger value="neworder" className="text-[15px] font-semibold gap-2 px-4"
          title="Orders on the Order Board — placed, shipping, delivered">
          Order
          {orderCount > 0 && (
            <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-bold tabular-nums">{orderCount}</span>
          )}
        </TabsTrigger>
        <div aria-hidden className="mx-1.5 h-6 w-px self-center bg-border" />
        <TabsTrigger value="blocked" className="text-[15px] font-semibold gap-2 px-4"
          title="Paused with a reason — watchers flag when the reason resolves">
          <PauseCircle className="h-4 w-4 text-rose-600" />
          Paused
          <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.paused}</span>
          {counts.possiblyResolved > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
              title={`${counts.possiblyResolved} pause${counts.possiblyResolved === 1 ? " looks" : "s look"} resolved — review`}
            >
              <Bell className="h-3 w-3" />{counts.possiblyResolved}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  // Reference views, to the right of the work nav. A pressed look when open;
  // pressing again returns to Due.
  const referenceNav = (
    <div className="inline-flex items-center rounded-lg border bg-card p-0.5 text-[12px] font-semibold">
      {([
        ["overview", "Overview", counts.overview, "Every active patient with all five circles"],
        ["rules", "Rules", null, "The payer rules behind the light marks — rendered from the same table the circles use"],
      ] as const).map(([v, label, n, title]) => {
        const on = primary === v;
        return (
          <button key={v} type="button" title={title} aria-pressed={on}
            onClick={() => setPrimary(on ? "due" : v)}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors",
              on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {label}
            {n != null && <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", on ? "bg-background/20" : "bg-muted")}>{n}</span>}
          </button>
        );
      })}
    </div>
  );

  // The same two rows on every primary tab — freshness + legend, then the
  // nav — so switching Due → Order → Paused never moves the tabs; only what
  // is below them changes (Brandon, 2026-09-20).
  const topRows = (
    <>
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
        {sync.syncing && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
            <Loader2 className="h-3 w-3 animate-spin" /> Updating Ordering Cycle on Monday…
          </span>
        )}
        {!sync.syncing && sync.last && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800"
            title={sync.last.writes.map((w) => `${w.name}: ${w.from} → ${w.to}`).join("\n")}>
            <Check className="h-3 w-3" /> Monday updated · {describeSync(sync.last.writes)}{sync.last.failed ? ` · ${sync.last.failed} failed` : ""}
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

      {/* Primary nav: Due · Order | Paused. Overview / Rules moved down to the
          Due sub-tab row — they only apply to Due (Brandon, 2026-09-20). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {primaryNav}
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

    </>
  );

  // New 'Order' tab — independent view rendered from the New Order
  // Board (18405457690). Skip all of the Order Prep / Ready-to-Order
  // shared scaffolding for this tab; NewOrders renders its own header.
  if (primary === "neworder") {
    return (
      <div className="space-y-4">
        {topRows}
        <NewOrders />
      </div>
    );
  }

  // 'Rules' tab — the payer rules behind the light marks, with tonight's
  // counts. Rendered from lib/subscription/payerRules.ts, never typed by hand.
  if (primary === "rules") {
    return (
      <div className="space-y-4">
        {topRows}
        <PayerRulesTab patients={all} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {topRows}

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
                {counts.scheduled}
              </span>
            </TabsTrigger>
            {renderPhaseTab("confirmation", "Confirm",          counts.confirmation)}
            {renderPhaseTab("benefits",     "Eligibility",      counts.benefits)}
            {renderPhaseTab("auth",         "Authorization",    counts.auth)}
            {renderPhaseTab("lastPaid",     "Last Claim Paid",  counts.lastPaid)}
            {renderPhaseTab("mr",           "Medical Records",  counts.mr)}
            <TabsTrigger value="readysub" className="gap-1.5" title="Already clear — ships the moment the order date arrives">
              <Check className="h-3.5 w-3.5 text-emerald-600" />
              Ready to Order
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                {counts.schedReady}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Sub-nav under Due — the readiness split. Ready = send now;
          Order Prep = automations didn't clear it, decide manually:
          fix + it auto-promotes, or set a block reason. */}
      {primary === "due" && (
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={duePhase} onValueChange={(v) => setDuePhase(v as DuePhase)}>
            <TabsList className="bg-card border">
              <TabsTrigger value="prepwork" className="gap-1.5" title="Date arrived but not clear — evaluate: fix, or assign a block reason">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                Order Prep
                <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                  {counts.duePrep}
                </span>
              </TabsTrigger>
              <TabsTrigger value="ready" className="gap-1.5" title="All five checks clear — send these now">
                <Send className="h-3.5 w-3.5 text-emerald-600" />
                Ready to Order
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                  {counts.dueReady}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {/* A filter on Order Prep: rows where somebody said something since
              the last order. They are counted in Order Prep too — this
              narrows, it doesn't add. */}
          {duePhase === "prepwork" && (
            <button type="button" aria-pressed={needsReviewOnly} onClick={() => setNeedsReviewOnly((v) => !v)}
              title="Only Order Prep rows with an unread message since the last order — read it, then pause or mark reviewed"
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                needsReviewOnly ? "border-sky-700 bg-sky-700 text-white" : "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100")}>
              <MessageSquare className="h-3.5 w-3.5" />
              Needs Review
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums", needsReviewOnly ? "bg-white/20" : "bg-sky-100 text-sky-800")}>{counts.dueNeedsRead}</span>
            </button>
          )}
          {/* Overview / Rules + the circle legend apply to Due only, so they
              live on this row rather than the header (Brandon, 2026-09-20). */}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {referenceNav}
            <MarkLegend onRules={() => setPrimary("rules")} />
          </div>
        </div>
      )}

      <>
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

      {/* Run DVS bar — only when there is something to run. Medicaid rows with
          an order due and no DVS yet show an open circle with an M in the
          Authorization column; tick them and fire them all at once. */}
      {dvsCandidates.length > 0 && !(primary === "due" && duePhase === "ready") && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-2.5">
          <Stethoscope className="h-4 w-4 shrink-0 text-sky-700" />
          <div className="text-[13px] text-sky-900">
            <span className="font-semibold">{dvsCandidates.length}</span>
            {" "}Medicaid {dvsCandidates.length === 1 ? "order" : "orders"} due need a DVS
            {dvsCandidates.length !== dvsEligible.length && (
              <span className="text-sky-800/80">
                {" "}· {dvsCandidates.length - dvsEligible.length} blocked by a red Confirm
                {" "}(override in the profile first)
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-[12px] text-sky-800 hover:bg-sky-100"
              disabled={dvsRunning || dvsEligible.length === 0}
              onClick={() =>
                setDvsSelected(
                  dvsToRun.length === dvsEligible.length ? new Set() : new Set(dvsEligibleIds),
                )
              }
            >
              {dvsToRun.length === dvsEligible.length && dvsEligible.length > 0
                ? "Clear selection"
                : `Select all ${dvsEligible.length}`}
            </Button>
            <Button
              size="sm"
              className="h-8 bg-sky-700 text-[12px] font-semibold hover:bg-sky-800"
              disabled={dvsRunning || dvsToRun.length === 0}
              onClick={runDvsForSelected}
            >
              {dvsRunning
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Running…</>
                : <>Run DVS{dvsToRun.length ? ` (${dvsToRun.length})` : ""}</>}
            </Button>
          </div>
        </div>
      )}

      {/* Send all to Order bar — Ready to Order tab only. Every row here is
          five-green and unheld, so the whole tab can go in one action, the
          same shape as the Run DVS bar. Two clicks: it spawns real orders. */}
      {primary === "due" && duePhase === "ready" && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-2.5">
          <Send className="h-4 w-4 shrink-0 text-emerald-700" />
          <div className="text-[13px] text-emerald-900">
            <span className="font-semibold">{rows.length}</span>{" "}
            {rows.length === 1 ? "order is" : "orders are"} ready — all five checks clear
          </div>
          <div className="ml-auto flex items-center gap-2">
            {sendAllArmed && !sendAllRunning && (
              <span className="text-[12px] font-medium text-emerald-900">Send all {rows.length} to Order?</span>
            )}
            {sendAllArmed && !sendAllRunning && (
              <Button variant="ghost" size="sm" className="h-8 text-[12px] text-emerald-800 hover:bg-emerald-100" onClick={() => setSendAllArmed(false)}>Cancel</Button>
            )}
            <Button
              size="sm"
              className="h-8 bg-emerald-700 text-[12px] font-semibold hover:bg-emerald-800"
              disabled={sendAllRunning}
              onClick={() => { if (!sendAllArmed) { setSendAllArmed(true); return; } void sendAllToOrder(rows); }}
            >
              {sendAllRunning
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Sending…</>
                : sendAllArmed ? <>Yes, send all {rows.length}</> : <>Send all to Order</>}
            </Button>
          </div>
        </div>
      )}

      {/* Table per phase */}
      {/* No overflow-hidden here: it would break position:sticky on the
          table header rows (a clipping ancestor becomes the sticky
          containing block, and the Card itself never scrolls). Header
          rows carry rounded-t-lg to hug the Card's corners instead. */}
      <Card>
        {phase === "auth" && dvsView ? (
          // DvsQueue ships with its own header / loading / refresh —
          // mount inside the same Card so column alignment with the
          // rest of the Order Prep workflow stays consistent.
          <div className="p-4">
            <DvsQueue />
          </div>
        ) : primary === "blocked" ? (
          <BlockedTable
            rows={rows as LanePatient[]}
            todayStr={todayStr}
            onPatientClick={openPatient}
            onCheckIn={(p) => setCheckInTarget(p)}
            onEditBlock={(p) => setBlockTarget(p)}
          />
        ) : phase === "overview" ? (
          <OverviewTable
            rows={rows}
            onCellClick={openCell}
            onPatientClick={openPatient}
            onSubmit={sendToOrderBoard}
            onPromote={promoteToReady}
            actionMode={(primary === "due" && duePhase === "ready") || (primary === "prep" && prepPhase === "readysub") ? "ready" : "prep"}
            dvsSelected={dvsSelected}
            onToggleDvs={toggleDvsSelected}
            dvsRunning={dvsRunning}
            onBlock={(p) => setBlockTarget(p as LanePatient)}
            showOrderType={(primary === "due" && duePhase === "ready")
              || (primary === "prep" && prepPhase === "readysub")}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            sendingIds={sendingIds}
            sentIds={sentIds}
          />
        ) : (
          <PhaseTable
            rows={rows}
            phase={phase}
            onCellClick={openCell}
            onPatientClick={openPatient}
            onSubmit={sendToOrderBoard}
            dvsSelected={dvsSelected}
            onToggleDvs={toggleDvsSelected}
            dvsRunning={dvsRunning}
            onBlock={(p) => setBlockTarget(p as LanePatient)}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            sendingIds={sendingIds}
            sentIds={sentIds}
          />
        )}
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {phase === "ready" ? "Nothing ready to submit yet."
             : primary === "due" ? "Nothing due — every arrived order is either handled or blocked."
             : primary === "blocked" ? "Nothing paused. 🎉"
             : "No patients in this phase right now."}
          </div>
        )}
      </Card>

        </>
      <PatientDrawer patient={activePatient} kind={activeKind} onClose={closeDrawer} />
      <BlockDialog
        patient={blockTarget}
        open={!!blockTarget}
        onClose={() => setBlockTarget(null)}
        onDone={onBlockDone}
      />
      <CheckInDialog
        patient={checkInTarget}
        open={!!checkInTarget}
        onClose={() => setCheckInTarget(null)}
        onDone={onBlockDone}
      />
    </div>
  );
}

// ─── Tables ──────────────────────────────────────────────────────────────────

function OrderTypePill({ patient }: { patient: SubscriptionPatient }) {
  const t = (patient.orderType ?? "").trim();
  const first = isFirstOrder(t);
  // First orders are audited on arrival (deterministic profile check). The pill
  // is normally dark blue; it turns red when the audit says the row isn't safe
  // to order against, amber for advisory-only findings (Brandon, 2026-09-21).
  const gate = useOrderGate(patient.mondayItemId, first);
  if (!t) return <span className="text-[11px] text-muted-foreground">—</span>;
  if (!first) {
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-200 px-3 py-1 text-[12px] font-semibold text-slate-700">
        Reorder
      </span>
    );
  }
  const tone = gate && !gate.orderable ? "red" : gate && gate.pill === "amber" ? "amber" : "blue";
  const cls =
    tone === "red"   ? "bg-rose-600 text-white"
    : tone === "amber" ? "bg-amber-100 text-amber-800"
    :                    "bg-blue-700 text-white";
  const title = gate && gate.findings.length
    ? gate.findings
        .map((f) => `${f.severity === "ERROR" ? "⛔" : f.severity === "WARN" ? "⚠️" : "•"} ${f.label}: ${f.message}`)
        .join("\n")
    : undefined;
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold", cls)}>
      First Order
    </span>
  );
}

// The five checkpoint columns are deliberately IDENTICAL (one shared track
// size) so the circles sit on an even rhythm rather than drifting with their
// label lengths — the headings differ by a factor of two in length, the
// spacing must not. 84px is the floor; they are 1fr above it, so on a wide
// screen the five share the surplus equally and stay evenly distributed.
//
// Checked in a browser at 1440 and 1728 (2026-09-14): CONFIRM / ELIGIBILITY /
// AUTHORIZATION sit on one line, LAST CLAIM PAID and MEDICAL RECORDS break
// into two and bottom-align with the rest (the header row is items-end).
// AUTHORIZATION is ~100px of ink in an 84px track at the floor, so it bleeds
// a few px into the 16px gutter rather than colliding — which is why the
// floor is not tighter.
//
// Actions is 170px: one button now ("Ready to Order" / "Send to Order", ~130px)
// — the pause and comms buttons left the row on 2026-09-20; those live on the
// patient's page. 170 keeps the button inside the row with air on both sides.
//
// ⚠️ Written out in full, never interpolated. Tailwind generates arbitrary
// values by scanning the source for COMPLETE class strings; a template
// literal built from parts produces a class that is never emitted, and the
// grid silently collapses to a single column.
// Laptop-sized (Brandon, 2026-09-20 — 13"/14" screens): the fixed tracks add
// up to ~1,210px with gaps, so the table fits a 1,280 viewport without
// clipping the button; above that the five circle tracks share the surplus.
const OVERVIEW_GRID = "grid grid-cols-[180px_84px_160px_minmax(170px,1fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)_minmax(110px,0.8fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)_140px] gap-2";
// Order Prep has no action button: the only way to Ready to Order is five
// green circles, reached through the popovers and the profile (Brandon,
// 2026-09-20). So no Actions column there either.
const OVERVIEW_GRID_NOACTION = "grid grid-cols-[180px_84px_160px_minmax(170px,1fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)_minmax(110px,0.8fr)_minmax(100px,0.8fr)_minmax(100px,0.8fr)] gap-2";
// Ready-to-Order variant adds a Type (First Order / Reorder) column.
const OVERVIEW_GRID_TYPE = "grid grid-cols-[170px_80px_150px_104px_minmax(130px,1fr)_minmax(88px,0.8fr)_minmax(88px,0.8fr)_minmax(104px,0.8fr)_minmax(88px,0.8fr)_minmax(88px,0.8fr)_132px] gap-2";

type OverviewSortKey =
  | "name" | "nextOrderDate" | "subscriptionType" | "primaryPayer"
  | "confirmation" | "benefits" | "auth" | "lastPaid" | "mr";

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
        // Centred headings are the checkpoint columns, where the label can be
        // two words longer than the track. Wrap and tighten rather than
        // overflow into the neighbour; the header row is items-end, so a
        // two-line label still sits on the same baseline as a one-line one.
        align === "center" && "w-full justify-center text-center whitespace-normal break-words leading-tight tracking-normal",
      )}
    >
      {label}{arrow}
    </button>
  );
}

/**
 * The Run DVS tick, sat beside the Authorization circle on Medicaid rows whose
 * order is due and whose DVS hasn't been run. It lives in this cell rather
 * than in a select column of its own because the thing being selected IS this
 * circle — the open M next to it is the reason the box is there.
 *
 * A red Confirm renders it disabled instead of hiding it: "you can't run this
 * one, and here's why" beats a silently missing checkbox on the row the
 * operator was looking for (see canRunDvs in lib/subscription/dvs.ts).
 */
function DvsSelectBox({
  p, selected, onToggle, disabled,
}: {
  p: SubscriptionPatient;
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  // First orders arrive with the DVS and paid claim already done, so they never
  // need a DVS run — no tick (Brandon, 2026-09-21).
  if (!p.auth.dvsNeeded || isFirstOrder(p.orderType)) return null;
  const blocked = !canRunDvs(p);
  return (
    <Checkbox
      checked={selected.has(p.mondayItemId)}
      disabled={blocked || disabled}
      onCheckedChange={() => onToggle(p.mondayItemId)}
      onClick={(e) => e.stopPropagation()}
      // Absolutely placed so the circle stays on the column's centre line
      // whether or not this row has a tick. left-1/2 puts the box's left edge
      // at centre; -translate-x-[35px] walks it back past the 30px circle with
      // a few px of air. A checkbox in the flow (mr-2) shifted every ticked
      // row's circle right and broke the column — Brandon caught it on screen.
      className="absolute left-1/2 top-1/2 z-10 -translate-x-[35px] -translate-y-1/2 shrink-0 data-[state=checked]:border-sky-700 data-[state=checked]:bg-sky-700"
      aria-label={blocked
        ? `Cannot run DVS for ${p.name} — the patient said no. Override the Confirm in their profile first.`
        : `Select ${p.name} for Run DVS`}
      title={blocked
        ? "Confirm is a red X — override it in the patient's profile before running DVS"
        : "Select for Run DVS"}
    />
  );
}

function OverviewTable({
  rows, onCellClick, onPatientClick, onSubmit, onPromote, actionMode, onBlock, showOrderType, sortKey, sortDir, onSort,
  sendingIds, sentIds, dvsSelected, onToggleDvs, dvsRunning,
}: {
  rows: SubscriptionPatient[];
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
  onPromote: (p: SubscriptionPatient) => void;
  actionMode: RowActionMode;
  onBlock?: (p: SubscriptionPatient) => void;
  showOrderType?: boolean;
  sortKey: OverviewSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: OverviewSortKey) => void;
  sendingIds: Set<string>;
  sentIds:    Set<string>;
  dvsSelected: Set<string>;
  onToggleDvs: (id: string) => void;
  dvsRunning: boolean;
}) {
  const showActions = actionMode === "ready";
  const grid = showOrderType ? OVERVIEW_GRID_TYPE : showActions ? OVERVIEW_GRID : OVERVIEW_GRID_NOACTION;
  return (
    <div className="text-[13px] overflow-x-auto">
      {/* sticky: keep the five check headings visible while scrolling.
          Opaque bg (not bg-muted/60) so rows don't ghost through when stuck. */}
      <div className={cn(grid, "sticky top-0 z-20 rounded-t-lg border-b bg-slate-100 px-4 py-3 text-[15px] font-bold tracking-normal text-slate-700 items-end")}>
        <div><SortableLabel label="Patient"        k="name"             sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div><SortableLabel label="Order"          k="nextOrderDate"    sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div><SortableLabel label="Subscription"   k="subscriptionType" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        {/* Buttons reset text-transform, so the sortable headings render in
            Title case; match them here rather than shouting TYPE / ACTIONS. */}
        {showOrderType && <div className="normal-case">Type</div>}
        <div><SortableLabel label="Primary Payer"  k="primaryPayer"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        {/* The five checks, named in full. The abbreviations (Conf / Elig /
            Auth / Paid / MR) saved a few pixels and cost every new reader a
            guess — "MR" in particular reads as nothing at all. */}
        <div className="text-center"><SortableLabel label="Confirm"         k="confirmation" sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Eligibility"     k="benefits"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Authorization"   k="auth"         sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Last Claim Paid" k="lastPaid"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Medical Records" k="mr"           sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        {showActions && <div className="text-right pr-2 normal-case">Actions</div>}
      </div>
      {/* The whole row opens the profile — there is no Review button any
          more, because a button that does what clicking the row does is a
          button in the way. Cells that are themselves interactive (the five
          circles, the action cluster) stop the click so they keep working. */}
      {rows.map((p) => (
        <div
          key={p.id}
          role="button"
          tabIndex={0}
          onClick={() => { if (Date.now() < swallowRowClicksUntil) return; onPatientClick(p); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPatientClick(p); }
          }}
          className={cn(grid, "border-b px-4 py-3.5 hover:bg-muted/30 transition-colors items-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset")}
        >
          <button type="button" onClick={() => onPatientClick(p)} className="text-left">
            <div className="text-[15px] font-semibold text-foreground flex items-center flex-wrap gap-y-0.5">{p.name}<PauseBadge patient={p} /><OopBadge patient={p} /><FlagBadges patient={p} /><ShipCandidateBadge patient={p} /></div>
            <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">{p.phone}</div>
          </button>
          <div>
            <div className="text-[15px] font-semibold tabular-nums">{fmtDate(p.nextOrderDate)}</div>
            <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">in {daysBetween(p.nextOrderDate)}d</div>
          </div>
          <div><span className={SUB_TYPE_PILLS[p.subscriptionType]}>{p.subscriptionType}</span></div>
          {showOrderType && <div><OrderTypePill patient={p} /></div>}
          <div className="text-[14px] truncate">{p.primaryPayer}</div>
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <CircleEditPopover check={p.confirmation} kind="confirmation" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.confirmation} />
            </CircleEditPopover>
          </div>
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <CircleEditPopover check={p.benefits} kind="benefits" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.benefits} />
            </CircleEditPopover>
          </div>
          <div className="relative flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <DvsSelectBox p={p} selected={dvsSelected} onToggle={onToggleDvs} disabled={dvsRunning} />
            <CircleEditPopover check={p.auth} kind="auth" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.auth} />
            </CircleEditPopover>
            <MetaPill check={p.auth} />
          </div>
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <CircleEditPopover check={p.lastPaid} kind="lastPaid" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.lastPaid} />
            </CircleEditPopover>
          </div>
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <CircleEditPopover check={mrOf(p)} kind="mr" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={mrOf(p)} />
            </CircleEditPopover>
          </div>
          {showActions && (
            <ReviewAndSubmit p={p} mode={actionMode} onSubmit={() => onSubmit(p)} onPromote={() => onPromote(p)} sending={sendingIds.has(p.mondayItemId)} sent={sentIds.has(p.mondayItemId)} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Blocked lane table (Order Cycle v2) ─────────────────────────────────────
/**
 * Three pinned sections above the rest:
 *   🔔 Looks resolved — every reason's watcher signal has fired; review + unblock
 *   📅 Check-ins due  — the check-in date arrived; contact the patient
 *   ⚠ No reason set  — Paused with no reason (data hygiene / triage)
 * Remainder sorted by check-in date (soonest first), then order date.
 */
function BlockedTable({
  rows, todayStr, onPatientClick, onCheckIn, onEditBlock,
}: {
  rows: LanePatient[];
  todayStr: string;
  onPatientClick: (p: SubscriptionPatient) => void;
  onCheckIn: (p: LanePatient) => void;
  onEditBlock: (p: LanePatient) => void;
}) {
  const resolved = rows.filter((p) => possiblyResolved(p));
  const resolvedIds = new Set(resolved.map((p) => p.mondayItemId));
  const dueCheck = rows.filter((p) => !resolvedIds.has(p.mondayItemId) && checkInDue(p, todayStr));
  const dueIds = new Set(dueCheck.map((p) => p.mondayItemId));
  const noReason = rows.filter((p) =>
    !resolvedIds.has(p.mondayItemId) && !dueIds.has(p.mondayItemId) && needsReason(p));
  const noReasonIds = new Set(noReason.map((p) => p.mondayItemId));
  const rest = rows
    .filter((p) => !resolvedIds.has(p.mondayItemId) && !dueIds.has(p.mondayItemId) && !noReasonIds.has(p.mondayItemId))
    .sort((a, b) => (a.checkInDate || "9999").localeCompare(b.checkInDate || "9999")
      || (a.nextOrderDate || "9999").localeCompare(b.nextOrderDate || "9999"));

  const Section = ({ title, icon, tone, list }: {
    title: string; icon: JSX.Element; tone: string; list: LanePatient[];
  }) => list.length === 0 ? null : (
    <>
      <div className={cn("flex items-center gap-2 px-6 py-2 text-[11px] font-bold uppercase tracking-wider border-b", tone)}>
        {icon}{title}<span className="tabular-nums">({list.length})</span>
      </div>
      {list.map((p) => <BlockedRow key={p.mondayItemId} p={p} onPatientClick={onPatientClick} onCheckIn={onCheckIn} onEditBlock={onEditBlock} />)}
    </>
  );

  return (
    <div className="text-[13px]">
      <div className={cn(BLOCKED_GRID, "sticky top-0 z-20 rounded-t-lg border-b bg-slate-100 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground items-end")}>
        <div>Patient</div>
        <div>Order</div>
        <div>Reason</div>
        <div>Latest note</div>
        <div>Check-in</div>
        <div>Watcher</div>
        <div className="text-right pr-2">Actions</div>
      </div>
      <Section
        title="Looks resolved — review + unblock"
        icon={<Bell className="h-3.5 w-3.5" />}
        tone="bg-emerald-50 text-emerald-800 border-emerald-100"
        list={resolved}
      />
      <Section
        title="Check-ins due"
        icon={<CalendarClock className="h-3.5 w-3.5" />}
        tone="bg-amber-50 text-amber-800 border-amber-100"
        list={dueCheck}
      />
      <Section
        title="No reason set — triage"
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        tone="bg-rose-50 text-rose-700 border-rose-100"
        list={noReason}
      />
      {rest.length > 0 && (resolved.length + dueCheck.length + noReason.length > 0) && (
        <div className="flex items-center gap-2 px-6 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
          <Clock className="h-3.5 w-3.5" />Watching<span className="tabular-nums">({rest.length})</span>
        </div>
      )}
      {rest.map((p) => <BlockedRow key={p.mondayItemId} p={p} onPatientClick={onPatientClick} onCheckIn={onCheckIn} onEditBlock={onEditBlock} />)}
    </div>
  );
}

const BLOCKED_GRID = "grid grid-cols-[220px_110px_210px_minmax(160px,1fr)_150px_130px_210px] gap-4";

function BlockedRow({
  p, onPatientClick, onCheckIn, onEditBlock,
}: {
  p: LanePatient;
  onPatientClick: (p: SubscriptionPatient) => void;
  onCheckIn: (p: LanePatient) => void;
  onEditBlock: (p: LanePatient) => void;
}) {
  // First line of the block note = the newest entry (append-prepends).
  const latestNote = (p.blockNote ?? "").split("\n")[0] || "—";
  const missed = p.missedCheckIns ?? 0;
  return (
    <div className={cn(BLOCKED_GRID, "border-b px-6 py-3.5 hover:bg-muted/30 transition-colors items-center")}>
      <button type="button" onClick={() => onPatientClick(p)} className="text-left">
        <div className="text-[14px] font-semibold text-foreground flex items-center flex-wrap gap-y-0.5">
          {p.name}<OopBadge patient={p} /><FlagBadges patient={p} />
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
          {p.phone}{p.blockedDate ? ` · blocked ${fmtDate(p.blockedDate)}` : ""}
          {missed > 0 && <span className="ml-1 text-rose-600 font-semibold">· {missed} missed</span>}
        </div>
      </button>
      <div>
        {p.nextOrderDate ? (
          <>
            <div className="text-[13px] font-semibold tabular-nums">{fmtDate(p.nextOrderDate)}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {daysBetween(p.nextOrderDate) < 0 ? `${-daysBetween(p.nextOrderDate)}d ago` : `in ${daysBetween(p.nextOrderDate)}d`}
            </div>
          </>
        ) : <span className="text-[11px] text-muted-foreground">—</span>}
      </div>
      <div><ReasonChips patient={p} /></div>
      <div className="text-[11px] text-muted-foreground truncate" title={p.blockNote || undefined}>{latestNote}</div>
      <div><CheckInCell iso={p.checkInDate || undefined} /></div>
      <div><ResolutionPill patient={p} /></div>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="outline" size="sm"
          className="h-7 px-2.5 text-[11px] font-semibold"
          onClick={() => onCheckIn(p)}
          title="Record a check-in, unblock, or move to Not Active"
        >
          <CalendarClock className="mr-1 h-3 w-3" />Check-in
        </Button>
        <Button
          variant="outline" size="sm"
          className="h-7 px-2.5 text-[11px] font-semibold"
          onClick={() => onEditBlock(p)}
          title="Edit the block reason / note / check-in date"
        >
          <Pencil className="mr-1 h-3 w-3" />Edit
        </Button>
      </div>
    </div>
  );
}

function PhaseTable({
  rows, phase, onCellClick, onPatientClick, onSubmit, onBlock, sortKey, sortDir, onSort,
  sendingIds, sentIds, dvsSelected, onToggleDvs, dvsRunning,
}: {
  rows: SubscriptionPatient[];
  phase: CheckpointKind;
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
  onBlock?: (p: SubscriptionPatient) => void;
  sortKey: OverviewSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: OverviewSortKey) => void;
  sendingIds: Set<string>;
  sentIds:    Set<string>;
  dvsSelected: Set<string>;
  onToggleDvs: (id: string) => void;
  dvsRunning: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[220px]"><SortableLabel label="Patient"       k="name"             sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
          <TableHead className="w-[100px]"><SortableLabel label="Order"         k="nextOrderDate"    sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
          <TableHead className="w-[140px]"><SortableLabel label="Subscription"  k="subscriptionType" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
          <TableHead className="w-[170px]"><SortableLabel label="Primary Payer" k="primaryPayer"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></TableHead>
          <TableHead className="w-[120px] text-center">{PHASE_LABELS[phase]}</TableHead>
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
                  <div className="text-[13px] font-semibold flex items-center flex-wrap gap-y-0.5">{p.name}<PauseBadge patient={p} /><OopBadge patient={p} /><FlagBadges patient={p} /></div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">{p.phone}</div>
                </button>
              </TableCell>
              <TableCell>
                <div className="text-[13px] font-medium tabular-nums">{fmtDate(p.nextOrderDate)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">in {daysBetween(p.nextOrderDate)}d</div>
              </TableCell>
              <TableCell><span className={SUB_TYPE_PILLS[p.subscriptionType]}>{p.subscriptionType}</span></TableCell>
              <TableCell className="text-[13px]">{p.primaryPayer}</TableCell>
              <TableCell><div className="relative flex items-center justify-center">
                {phase === "auth" && (
                  <DvsSelectBox p={p} selected={dvsSelected} onToggle={onToggleDvs} disabled={dvsRunning} />
                )}
                <CircleEditPopover check={c} kind={phase} patient={p} onBlockRequest={onBlock}>
                  <CheckpointCircle check={c} />
                </CircleEditPopover>
                {phase === "auth" && <MetaPill check={c} />}
              </div></TableCell>
              <TableCell><BlockedByPill value={p.blockedBy} /></TableCell>
              <TableCell><CheckInCell iso={p.nextCheckIn} stuckSince={p.stuckSince} /></TableCell>
              <TableCell className="text-[12px] text-muted-foreground max-w-[340px]">{p.stuckReason ?? "—"}</TableCell>
              <TableCell><ReviewAndSubmit p={p} mode="ready" onSubmit={() => onSubmit(p)} sending={sendingIds.has(p.mondayItemId)} sent={sentIds.has(p.mondayItemId)} /></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}


// ─── Top-level SubscriptionBoard: 5 workflow tabs ────────────────────────────

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

/**
 * The Ordering tool. Only the Order Cycle is in use right now — the Patient
 * Profile list, Authorizations and Medical Records workflows stay in the
 * codebase but are off the nav (Brandon, 2026-09-20: "the only one we're
 * using right now is for order cycle"). The profile opens from a row click.
 */
export function SubscriptionBoard() {
  return <OrderCycleWorkflow />;
}
