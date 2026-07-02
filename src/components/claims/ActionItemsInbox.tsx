// ActionItemsInbox — compact 12-bar sparkline in the top app bar
// that surfaces only the buckets where the operator needs to take
// action. Hover any bar for a label + count + oldest-age tooltip;
// click navigates to the right board / mode.
//
// Why these 12 buckets specifically (and not all ~20 on the app):
// Brandon called out that the app has a lot of "informational"
// buckets (Paid, Outstanding, Snoozed Late ERA, EFT Submitted/
// Accepted/Rejected) that don't require active operator triage on
// any given day. This inbox shows ONLY the ones where there's work
// to clear. When every bar reads 0 → "All clear" green state.
//
// V1 scope: clicking a bar lands on the right top-level board+mode
// (e.g., Primary > Submit). The operator clicks the relevant tile
// inside to drill the final step. Deeper deep-linking into specific
// sub-tabs / sub-filters is a V2 if useful.
//
// Counts read from the same hooks the existing boards use, so the
// inbox stays automatically in sync — no separate data layer to
// keep aligned.

import { useMemo } from "react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAllClaims } from "@/hooks/useAllClaims";
import { useAllSecondaryClaims } from "@/hooks/useAllSecondaryClaims";
import { useThreadClaims } from "@/lib/claims/threadStore";
import { useEftEnrollmentRows } from "@/api/eftEnrollment";
import {
  claimAge, lateEraThresholdDays, eraReceived, isLateEraSnoozed,
} from "@/lib/claims/logic";
import type { Claim } from "@/lib/claims/types";

// ─── Bucket definitions ───────────────────────────────────────────────
//
// Order matches Brandon's stated preference: left-to-right through
// the app's primary -> secondary -> EFT layout.
//
// section: visual grouping ("Primary" / "Secondary" / "EFT") — adds
// subtle separators between groups in the rendered strip.
// navTo:   what to do when the bar is clicked. board + mode get pushed
//          to the page-level state in Claims.tsx; the operator picks
//          the specific tile from there.

type Section = "Primary" | "Secondary" | "EFT";

interface Bucket {
  id: string;
  label: string;       // concise chip label
  fullLabel: string;   // tooltip / section-context label
  section: Section;
  navTo: NavTo;
}

// `navTo` is the rich payload passed to the parent's onNavigate.
// Beyond board+mode, it carries the specific sub-tab so the parent
// can deep-link into the right tile rather than just the right board.
// See Claims.tsx for how each field is applied.
interface NavTo {
  board: "primary" | "secondary" | "eft";
  mode?: "submit" | "review";
  primaryCategory?: "era" | "late" | "denied";   // selects the Primary Review tile
  lateSubTab?: "check" | "snoozed";              // sub-tab inside Late ERAs
  primaryQueue?: "new" | "resubmit" | "awaiting"; // tile inside Primary Submit
  secondaryBucket?:
    | "confirm"
    | "insurance"
    | "patient"
    | "awaiting"
    | "patientQuestions"
    | "outstandingClaims"
    | "outstandingInvoices"
    | "eraReview"
    | "invoiceReview"
    | "paid";
  eftStatus?: "not-started";
}

const BUCKETS: Bucket[] = [
  { id: "p-new",       label: "Submit Primary",      fullLabel: "Submit Primary · New Claims",                section: "Primary",   navTo: { board: "primary",   mode: "submit", primaryQueue: "new" } },
  { id: "p-resubmit",  label: "Resubmit Primary",    fullLabel: "Resubmit Primary",                           section: "Primary",   navTo: { board: "primary",   mode: "submit", primaryQueue: "resubmit" } },
  { id: "p-rejected",  label: "Rejected Primary",    fullLabel: "Rejected Primary · Awaiting Acceptance",     section: "Primary",   navTo: { board: "primary",   mode: "submit", primaryQueue: "awaiting" } },
  { id: "p-era",       label: "Review Primary",      fullLabel: "Review Primary · ERA Review",                section: "Primary",   navTo: { board: "primary",   mode: "review", primaryCategory: "era" } },
  { id: "p-late",      label: "Late Primary",        fullLabel: "Late ERAs Primary · Check Status",           section: "Primary",   navTo: { board: "primary",   mode: "review", primaryCategory: "late", lateSubTab: "check" } },
  { id: "p-info-req",  label: "Info Requested",      fullLabel: "Payer Requests Info · send documentation",   section: "Primary",   navTo: { board: "primary",   mode: "review", primaryCategory: "late", lateSubTab: "check" } },
  { id: "p-denied",    label: "Denials",             fullLabel: "Denials",                                    section: "Primary",   navTo: { board: "primary",   mode: "review", primaryCategory: "denied" } },
  { id: "s-confirm",   label: "Confirm Secondary",   fullLabel: "Confirm Secondary Payor",                    section: "Secondary", navTo: { board: "secondary", mode: "submit", secondaryBucket: "confirm" } },
  { id: "s-insurance", label: "Submit Secondary",    fullLabel: "Submit Secondary · Insurance",               section: "Secondary", navTo: { board: "secondary", mode: "submit", secondaryBucket: "insurance" } },
  { id: "s-patient",   label: "Send Secondary",      fullLabel: "Send Secondary · Patient",                   section: "Secondary", navTo: { board: "secondary", mode: "submit", secondaryBucket: "patient" } },
  { id: "s-rejected",  label: "Rejected Secondary",  fullLabel: "Rejected Secondary · Awaiting Acceptance",   section: "Secondary", navTo: { board: "secondary", mode: "submit", secondaryBucket: "awaiting" } },
  { id: "s-questions", label: "Patient Questions",   fullLabel: "Review Secondary · Patient Questions",       section: "Secondary", navTo: { board: "secondary", mode: "review", secondaryBucket: "patientQuestions" } },
  { id: "s-era",       label: "Review Secondary",    fullLabel: "Review Secondary · ERA Review",              section: "Secondary", navTo: { board: "secondary", mode: "review", secondaryBucket: "eraReview" } },
  { id: "eft-todo",    label: "EFT Enrollment",      fullLabel: "EFT Enrollment · Not Started",               section: "EFT",       navTo: { board: "eft",       eftStatus: "not-started" } },
];

// ─── Bucket count derivation ───────────────────────────────────────────
// These mirror the same predicates the boards themselves use; if a
// classifier changes there (e.g. inLateEra), we want the inbox to
// pick up the change too. Re-implementing here would create a drift
// bug — instead we import the helpers and re-apply them.

interface CountResult {
  count: number;
  oldestIso: string | null;  // oldest claim sent / DOS in this bucket
}

function emptyResult(): CountResult { return { count: 0, oldestIso: null }; }

// Hardcoded literal of Claims.tsx's MEDICAID_OUTSTANDING_GROUP_ID —
// that const isn't exported, so we duplicate the value. If it drifts
// the inbox count diverges from the ERA Review tile; mirror updates
// here when it changes there.
const MEDICAID_OUTSTANDING_GROUP_ID = "group_mm332zns";

function inEraReviewLocal(c: Claim): boolean {
  // EXACT mirror of Claims.tsx's inEraReview. v1 of this function was
  // too loose (used "not Denied/Paid/Bad Debt" instead of "Review"
  // specifically) which counted 84 instead of the actual 2 — every
  // Outstanding, Submitted, and Submit Claim row falls into the
  // "ERA received but status isn't Review yet" gap and the loose
  // version pulled them all in. Keep both in lockstep.
  if (c.hasChildren) return false;
  if (c.groupId === MEDICAID_OUTSTANDING_GROUP_ID) return false;
  return eraReceived(c) && c.primaryStatus === "Review";
}

function inLateEraLocal(c: Claim): boolean {
  if (c.hasChildren) return false;
  const age = claimAge(c) ?? 0;
  const excluded = ["Paid", "Denied (Or Partly)", "Bad Debt", "Request Rejected"];
  return Boolean(c.claimSentDate) && !eraReceived(c)
      && age >= lateEraThresholdDays(c)
      && !excluded.includes(c.primaryStatus);
}

function inDeniedLocal(c: Claim): boolean {
  if (c.hasChildren) return false;
  return c.primaryStatus === "Denied (Or Partly)";
}

// Payer explicitly asked for information (status check came back
// "Requests Info" — R* category, or P3/P4 "Pending/Provider|Patient
// Requested Information" on the 277). These claims sit unpaid forever
// until someone sends the docs, so they're an action item regardless
// of how old the claim is — no age threshold like Late ERA. Rows drop
// out when the ERA lands, the claim reaches a terminal status, or the
// operator snoozes them after uploading the requested docs (same
// snooze the Late ERA flow uses).
function inInfoRequestedLocal(c: Claim): boolean {
  if (c.hasChildren) return false;
  if (c.claimStatusCategory !== "Requests Info") return false;
  if (eraReceived(c)) return false;
  const excluded = ["Paid", "Denied (Or Partly)", "Bad Debt", "Request Rejected"];
  return !excluded.includes(c.primaryStatus);
}

function ageOldestFromDates(dates: Array<string | null | undefined>): string | null {
  let oldest: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!oldest || new Date(d) < new Date(oldest)) oldest = d;
  }
  return oldest;
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function fmtOldest(iso: string | null): string {
  const d = daysAgo(iso);
  if (d == null) return "no items";
  if (d === 0) return "oldest today";
  if (d === 1) return "oldest 1d ago";
  return `oldest ${d}d ago`;
}

interface ActionItemsInboxProps {
  onNavigate: (target: NavTo) => void;
  className?: string;
}

export function ActionItemsInbox({ onNavigate, className }: ActionItemsInboxProps) {
  // ─── Data sources ───────────────────────────────────────────────
  // All four hooks are React-Query backed; mounting them here just
  // shares the same cache the boards already use. No extra requests.
  const { data: primaryClaims } = useAllClaims();
  const { data: secondaryClaims } = useAllSecondaryClaims();
  const { claims: threadClaims } = useThreadClaims();
  const { data: eftRows } = useEftEnrollmentRows();

  const counts = useMemo<Record<string, CountResult>>(() => {
    const out: Record<string, CountResult> = {};
    BUCKETS.forEach((b) => { out[b.id] = emptyResult(); });

    // ── Primary Submit ────────────────────────────────────────────
    if (threadClaims) {
      const awaitingSubmit = threadClaims.filter((c) => c.status === "Awaiting Submission");
      const awaitingAcceptance = threadClaims.filter(
        (c) => c.status === "Submitted" && c.status277 !== "Payer Accepted",
      );
      const newClaims = awaitingSubmit.filter((c) => !c.parent_claim_id);
      const resubmit  = awaitingSubmit.filter((c) => !!c.parent_claim_id);
      const rejected  = awaitingAcceptance.filter((c) => c.status277 === "Payer Rejected");

      out["p-new"]      = { count: newClaims.length,
        oldestIso: ageOldestFromDates(newClaims.map((c) => c.dos)) };
      out["p-resubmit"] = { count: resubmit.length,
        oldestIso: ageOldestFromDates(resubmit.map((c) => c.dos)) };
      out["p-rejected"] = { count: rejected.length,
        oldestIso: ageOldestFromDates(rejected.map((c) => c.claim_sent_date ?? c.dos)) };
    }

    // ── Primary Review ────────────────────────────────────────────
    if (primaryClaims) {
      const eraList    = primaryClaims.filter(inEraReviewLocal);
      const infoList   = primaryClaims.filter(inInfoRequestedLocal).filter((c) => !isLateEraSnoozed(c));
      // Info-requested rows get their own chip; keep them out of the
      // generic Late chip so one claim doesn't light up two bars.
      const lateList   = primaryClaims.filter(inLateEraLocal)
        .filter((c) => !isLateEraSnoozed(c))
        .filter((c) => !inInfoRequestedLocal(c));
      const deniedList = primaryClaims.filter(inDeniedLocal);

      out["p-era"]    = { count: eraList.length,
        oldestIso: ageOldestFromDates(eraList.map((c) => c.claimSentDate ?? c.dos)) };
      out["p-late"]   = { count: lateList.length,
        oldestIso: ageOldestFromDates(lateList.map((c) => c.claimSentDate ?? c.dos)) };
      out["p-info-req"] = { count: infoList.length,
        oldestIso: ageOldestFromDates(infoList.map((c) => c.claimSentDate ?? c.dos)) };
      out["p-denied"] = { count: deniedList.length,
        oldestIso: ageOldestFromDates(deniedList.map((c) => c.claimSentDate ?? c.dos)) };
    }

    // ── Secondary ─────────────────────────────────────────────────
    // bucketOf isn't exported; replicate the status-based mapping
    // inline. Keep in sync with SecondaryBoard.bucketOf.
    if (secondaryClaims) {
      const confirm     = secondaryClaims.filter((c) => c.status === "Awaiting Payor Confirmation");
      const insurance   = secondaryClaims.filter((c) => c.status === "Primary Paid - Submit Secondary");
      // Stage 1 only — invoice NOT yet sent. SecondaryBoard.bucketOf
      // splits "Sent to Patient" on sendInvoiceTriggered (the operator's
      // own Send Invoice click): triggered rows live in Outstanding
      // Invoices (awaiting payment — no action to take), untriggered
      // ones are the actual "Send Secondary" work. Counting both
      // inflated this chip (showed 15 when the board's Patient bucket
      // had far fewer).
      const patient     = secondaryClaims.filter(
        (c) => c.status === "Sent to Patient" && !c.sendInvoiceTriggered,
      );
      const awaiting    = secondaryClaims.filter(
        (c) => c.status === "Secondary Submitted" && c.status277 !== "Payer Accepted",
      );
      const rejected    = awaiting.filter((c) => c.status277 === "Payer Rejected");
      const era         = secondaryClaims.filter((c) => c.status === "Secondary ERA Received");

      out["s-confirm"]   = { count: confirm.length,
        oldestIso: ageOldestFromDates(confirm.map((c) => c.dos)) };
      out["s-insurance"] = { count: insurance.length,
        oldestIso: ageOldestFromDates(insurance.map((c) => c.dos)) };
      out["s-patient"]   = { count: patient.length,
        oldestIso: ageOldestFromDates(patient.map((c) => c.dos)) };
      out["s-rejected"]  = { count: rejected.length,
        oldestIso: ageOldestFromDates(rejected.map((c) => c.dos)) };
      out["s-era"]       = { count: era.length,
        oldestIso: ageOldestFromDates(era.map((c) => c.dos)) };

      // Patient Questions — additive bucket over the whole Secondary
      // panel: count any claim with a non-empty question that hasn't
      // been Marked Answered yet (mirror SecondaryBoard.visible).
      const questions = secondaryClaims.filter((c) =>
        !!(c.patientQuestion && c.patientQuestion.trim() && !c.patientQuestionAnswered),
      );
      out["s-questions"] = { count: questions.length,
        oldestIso: ageOldestFromDates(questions.map((c) => c.dos)) };
    }

    // ── EFT ───────────────────────────────────────────────────────
    if (eftRows) {
      const notStarted = eftRows.filter(
        (r) => (r.enrollmentStatus ?? "Not Started") === "Not Started",
      );
      out["eft-todo"] = { count: notStarted.length,
        oldestIso: ageOldestFromDates(notStarted.map((r) => r.paidDate)) };
    }

    return out;
  }, [primaryClaims, secondaryClaims, threadClaims, eftRows]);

  const totalOpen = useMemo(
    () => Object.values(counts).reduce((s, r) => s + r.count, 0),
    [counts],
  );

  if (totalOpen === 0) {
    return (
      <div className={cn(
        "flex items-center gap-2 text-xs font-medium text-success-soft-foreground",
        className,
      )}>
        <span aria-hidden>✓</span>
        <span>All clear</span>
      </div>
    );
  }

  // Render ALL 12 buckets in a fixed 6×2 grid even when some are at 0
  // — keeps the layout stable so operators learn the grid position of
  // each bucket and aren't constantly re-scanning. Zero-count cells go
  // muted (no jumping out, no fill), non-zero cells render the count
  // in normal foreground weight. No background color anywhere — the
  // bold number is the only visual signal of "this needs work."
  return (
    <TooltipProvider delayDuration={120}>
      <div
        className={cn(
          "grid grid-cols-6 gap-x-3 gap-y-0.5",
          className,
        )}
        role="group"
        aria-label="Action items inbox"
      >
        {BUCKETS.map((b) => {
          const cr = counts[b.id];
          const cleared = cr.count === 0;
          return (
            <Tooltip key={b.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onNavigate(b.navTo)}
                  aria-label={`${b.section} · ${b.fullLabel} · ${cr.count} items`}
                  className={cn(
                    "flex flex-col items-center rounded-md px-2 py-0.5 transition-colors",
                    "hover:bg-muted",
                    cleared && "opacity-40",
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-semibold leading-tight tabular-nums",
                      cleared && "text-muted-foreground",
                    )}
                  >
                    {cr.count}
                  </span>
                  <span className="text-[10px] leading-tight text-muted-foreground whitespace-nowrap">
                    {b.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div className="font-medium">{b.section} · {b.fullLabel}</div>
                <div className="text-muted-foreground">
                  {cr.count === 1 ? "1 item" : `${cr.count} items`}
                  {cr.count > 0 && <> · {fmtOldest(cr.oldestIso)}</>}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
