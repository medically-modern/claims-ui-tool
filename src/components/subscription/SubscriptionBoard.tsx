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
  AlertTriangle, ArrowRight, Bell, Building2, CalendarClock, Check, ClipboardCheck,
  Clock, DollarSign, ExternalLink, Heart, Loader2,
  MessageSquare, PauseCircle, Pencil, RefreshCw, RefreshCw as ReloadIcon, Search, Send,
  Server, Shield, UserCog, Unlock, UserCircle, UserX, X,
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

import { PatientProfile } from "./PatientProfile";
import { Authorizations } from "./Authorizations";
import { MedicalRecords } from "./MedicalRecords";
import { NewOrders } from "./NewOrders";
import { DvsQueue } from "./DvsQueue";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { markConfirmedByOperator, runEligibilityCheck, sendToOrder } from "@/api/setSubscriptionPatient";
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
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { invalidate } = useInvalidateSubscription();

  const confirmable = kind === "confirmation" && check.tone !== "ok";
  const runnable    = kind === "benefits" && check.tone !== "ok";

  const markConfirmed = async () => {
    setSaving(true); setErr(null);
    try {
      await markConfirmedByOperator(
        patient.mondayItemId,
        note.trim(),
        (patient as unknown as { subscriptionNotes?: string }).subscriptionNotes,
      );
      invalidate();
      setOpen(false); setNote("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const runElig = async () => {
    setSaving(true); setErr(null);
    try {
      await runEligibilityCheck(patient.mondayItemId);
      invalidate();
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-4">
        <div className="space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {PHASE_LABELS[kind]} — {patient.name}
            </div>
            <div className="text-[13px] font-semibold mt-0.5">
              {check.label}{check.detail ? ` — ${check.detail}` : ""}
            </div>
            {check.changes && check.changes.length > 0 && (
              <div className="mt-1 text-[11px] text-orange-700">
                Changes: {check.changes.join(" • ")}
              </div>
            )}
            {check.patientMessage && (
              <div className="mt-1 text-[11px] text-sky-700">
                Patient message: {check.patientMessage}
              </div>
            )}
          </div>

          {confirmable && (
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5">
              <div className="text-[11px] font-semibold text-emerald-800">
                Confirm on the patient's behalf — e.g. they confirmed by text/call,
                or you've decided it's safe to proceed.
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="How did they confirm / why is it OK? (logged to patient notes)"
                className="min-h-[54px] text-[12px] bg-white"
              />
              <Button
                size="sm"
                className="w-full bg-emerald-700 hover:bg-emerald-800"
                disabled={saving}
                onClick={() => void markConfirmed()}
              >
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Mark Confirmed — operator
              </Button>
            </div>
          )}

          {runnable && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={saving}
              onClick={() => void runElig()}
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Run Eligibility Now
            </Button>
          )}

          {onBlockRequest && (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-rose-700 border-rose-200 hover:bg-rose-50"
              onClick={() => { setOpen(false); onBlockRequest(patient); }}
            >
              <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
              Block order…
            </Button>
          )}

          {err && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">{err}</div>
          )}
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

function ReviewAndSubmit({ p, onReview, onSubmit, onBlock, sending, sent }: {
  p: SubscriptionPatient;
  onReview: () => void;
  onSubmit: () => void;
  onBlock?: () => void;
  sending?: boolean;
  sent?:    boolean;
}) {
  const ready = allChecksPass(p);
  return (
    // pl-6 pushes the buttons away from the Paid circle in the
    // OverviewTable grid layout; justify-end keeps them right-anchored
    // so the spacing scales with column width.
    <div className="flex items-center justify-end gap-1.5 pl-6">
      {onBlock && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px] font-semibold text-rose-700 border-rose-200 hover:bg-rose-50"
          onClick={onBlock}
          disabled={sending || sent}
          title="Can't order yet — set a block reason + watcher"
        >
          <PauseCircle className="h-3.5 w-3.5" />
        </Button>
      )}
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
function BlockDialog({
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
  const [err, setErr] = useState<string | null>(null);

  // Re-seed local state each time a new patient opens the dialog.
  const [seedId, setSeedId] = useState<string | null>(null);
  if (patient && patient.mondayItemId !== seedId) {
    setSeedId(patient.mondayItemId);
    setReasons(new Set(blockReasons(patient)));
    setNote("");
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
          <Button
            className="w-full bg-rose-700 hover:bg-rose-800"
            disabled={!canSave}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-2 h-4 w-4" />}
            Block order
          </Button>
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
function CheckInDialog({
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
  type PrimaryTab = "due" | "prep" | "blocked" | "neworder" | "overview";
  const [primary, setPrimary] = useState<PrimaryTab>("due");
  type PrepPhase = CheckpointKind | "all" | "readysub";
  const [prepPhase, setPrepPhase] = useState<PrepPhase>("all");
  type DuePhase = "ready" | "prepwork";
  const [duePhase, setDuePhase] = useState<DuePhase>("prepwork");
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
      confirmation: 0, benefits: 0, auth: 0, lastPaid: 0,
      paused: 0,
      due: 0, dueReady: 0, duePrep: 0,
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
    }
    return c;
  }, [all, todayStr]);

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
      base = filteredAll.filter((p) =>
        !(p as LanePatient & { isNotActive?: boolean }).isNotActive
        && getLane(p as LanePatient, todayStr) === "due"
        && (duePhase === "ready") === isReady(p as LanePatient));
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
  }, [filteredAll, filteredBase, phase, primary, prepPhase, duePhase, sortKey, sortDir, todayStr]);


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
            <TabsTrigger value="due" className="text-[15px] font-semibold gap-2 px-4">
              Due
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.due}</span>
            </TabsTrigger>
            <TabsTrigger value="prep" className="text-[15px] font-semibold gap-2 px-4"
              title="Order date in the future — the 4 checkpoint buckets prep the next 21 days">
              Scheduled
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.scheduled}</span>
            </TabsTrigger>
            <TabsTrigger value="blocked" className="text-[15px] font-semibold gap-2 px-4">
              <PauseCircle className="h-4 w-4 text-rose-600" />
              Blocked
              <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.paused}</span>
              {counts.possiblyResolved > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                  <Bell className="h-3 w-3" />{counts.possiblyResolved}
                </span>
              )}
            </TabsTrigger>
            <div aria-hidden className="mx-1.5 h-6 w-px self-center bg-border" />
            <TabsTrigger value="neworder" className="text-[15px] font-semibold gap-2 px-4">
              Order
            </TabsTrigger>
            <div aria-hidden className="mx-1.5 h-6 w-px self-center bg-border" />
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
            <TabsTrigger value="due" className="text-[15px] font-semibold gap-2 px-4"
              title="Order date arrived, nothing blocking — tonight's worklist">
              Due
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.due}</span>
            </TabsTrigger>
            <TabsTrigger value="prep" className="text-[15px] font-semibold gap-2 px-4"
              title="Order date in the future — the 4 checkpoint buckets prep the next 21 days">
              Scheduled
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.scheduled}</span>
            </TabsTrigger>
            <TabsTrigger value="blocked" className="text-[15px] font-semibold gap-2 px-4"
              title="Actively blocked with a reason — watchers flag when the blocker resolves">
              <PauseCircle className="h-4 w-4 text-rose-600" />
              Blocked
              <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-[11px] font-bold tabular-nums">{counts.paused}</span>
              {counts.possiblyResolved > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                  title={`${counts.possiblyResolved} block${counts.possiblyResolved === 1 ? " looks" : "s look"} resolved — review`}
                >
                  <Bell className="h-3 w-3" />{counts.possiblyResolved}
                </span>
              )}
            </TabsTrigger>
            <div aria-hidden className="mx-1.5 h-6 w-px self-center bg-border" />
            <TabsTrigger value="neworder" className="text-[15px] font-semibold gap-2 px-4">
              Order
            </TabsTrigger>
            <div aria-hidden className="mx-1.5 h-6 w-px self-center bg-border" />
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
                {counts.scheduled}
              </span>
            </TabsTrigger>
            {renderPhaseTab("confirmation", "Confirmation",     counts.confirmation)}
            {renderPhaseTab("benefits",     "Eligibility",      counts.benefits)}
            {renderPhaseTab("auth",         "Authorization",    counts.auth)}
            {renderPhaseTab("lastPaid",     "Last Order Paid",  counts.lastPaid)}
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
        <Tabs value={duePhase} onValueChange={(v) => setDuePhase(v as DuePhase)}>
          <TabsList className="bg-card border">
            <TabsTrigger value="prepwork" className="gap-1.5" title="Date arrived but not clear — evaluate: fix, or assign a block reason">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              Order Prep
              <span className="rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                {counts.duePrep}
              </span>
            </TabsTrigger>
            <TabsTrigger value="ready" className="gap-1.5" title="All checks clear — send these now">
              <Send className="h-3.5 w-3.5 text-emerald-600" />
              Ready to Order
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                {counts.dueReady}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
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

      {/* Table per phase */}
      <Card className="overflow-hidden">
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
             : primary === "blocked" ? "Nothing blocked. 🎉"
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
  if (!t) return <span className="text-[11px] text-muted-foreground">—</span>;
  const first = /first/i.test(t);
  return (
    <span className={cn(
      "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
      first ? "bg-orange-100 text-orange-700" : "bg-sky-100 text-sky-700",
    )}>
      {first ? "First Order" : "Reorder"}
    </span>
  );
}

const OVERVIEW_GRID = "grid grid-cols-[240px_120px_180px_200px_minmax(80px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_300px] gap-4";
// Ready-to-Order variant adds a Type (First Order / Reorder) column.
const OVERVIEW_GRID_TYPE = "grid grid-cols-[240px_120px_160px_110px_190px_minmax(80px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_minmax(80px,1fr)_300px] gap-4";

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
  rows, onCellClick, onPatientClick, onSubmit, onBlock, showOrderType, sortKey, sortDir, onSort,
  sendingIds, sentIds,
}: {
  rows: SubscriptionPatient[];
  onCellClick: (p: SubscriptionPatient, k: CheckpointKind) => void;
  onPatientClick: (p: SubscriptionPatient) => void;
  onSubmit: (p: SubscriptionPatient) => void;
  onBlock?: (p: SubscriptionPatient) => void;
  showOrderType?: boolean;
  sortKey: OverviewSortKey;
  sortDir: "asc" | "desc";
  onSort: (k: OverviewSortKey) => void;
  sendingIds: Set<string>;
  sentIds:    Set<string>;
}) {
  const grid = showOrderType ? OVERVIEW_GRID_TYPE : OVERVIEW_GRID;
  return (
    <div className="text-[13px]">
      <div className={cn(grid, "border-b bg-muted/60 px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground items-end")}>
        <div><SortableLabel label="Patient"        k="name"             sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div><SortableLabel label="Order"          k="nextOrderDate"    sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div><SortableLabel label="Subscription"   k="subscriptionType" sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        {showOrderType && <div>Type</div>}
        <div><SortableLabel label="Primary Payer"  k="primaryPayer"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} /></div>
        <div className="text-center"><SortableLabel label="Conf" k="confirmation" sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Elig" k="benefits"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Auth" k="auth"         sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-center"><SortableLabel label="Paid" k="lastPaid"     sortKey={sortKey} sortDir={sortDir} onClick={onSort} align="center" /></div>
        <div className="text-right pr-2">Actions</div>
      </div>
      {rows.map((p) => (
        <div key={p.id} className={cn(grid, "border-b px-6 py-4 hover:bg-muted/30 transition-colors items-center")}>
          <button type="button" onClick={() => onPatientClick(p)} className="text-left">
            <div className="text-[15px] font-semibold text-foreground flex items-center flex-wrap gap-y-0.5">{p.name}<PauseBadge patient={p} /><OopBadge patient={p} /><ShipCandidateBadge patient={p} /></div>
            <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">{p.phone}</div>
          </button>
          <div>
            <div className="text-[15px] font-semibold tabular-nums">{fmtDate(p.nextOrderDate)}</div>
            <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">in {daysBetween(p.nextOrderDate)}d</div>
          </div>
          <div><span className={SUB_TYPE_PILLS[p.subscriptionType]}>{p.subscriptionType}</span></div>
          {showOrderType && <div><OrderTypePill patient={p} /></div>}
          <div className="text-[14px] truncate">{p.primaryPayer}</div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.confirmation} kind="confirmation" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.confirmation} />
            </CircleEditPopover>
          </div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.benefits} kind="benefits" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.benefits} />
            </CircleEditPopover>
          </div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.auth} kind="auth" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.auth} />
            </CircleEditPopover>
            <MetaPill check={p.auth} />
          </div>
          <div className="flex items-center justify-center">
            <CircleEditPopover check={p.lastPaid} kind="lastPaid" patient={p} onBlockRequest={onBlock}>
              <CheckpointCircle check={p.lastPaid} />
            </CircleEditPopover>
          </div>
          <ReviewAndSubmit p={p} onReview={() => onPatientClick(p)} onSubmit={() => onSubmit(p)} onBlock={onBlock ? () => onBlock(p) : undefined} sending={sendingIds.has(p.mondayItemId)} sent={sentIds.has(p.mondayItemId)} />
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
      <div className={cn(BLOCKED_GRID, "border-b bg-muted/60 px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground items-end")}>
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
          {p.name}<OopBadge patient={p} />
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
  sendingIds, sentIds,
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
                  <div className="text-[13px] font-semibold flex items-center flex-wrap gap-y-0.5">{p.name}<PauseBadge patient={p} /><OopBadge patient={p} /></div>
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
                <CircleEditPopover check={c} kind={phase} patient={p} onBlockRequest={onBlock}>
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
    </div>
  );
}
