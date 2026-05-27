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
import { useAllSecondaryClaims } from "@/api/queries/allSecondaryClaims";
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
  label: string;
  section: Section;
  navTo: { board: "primary" | "secondary" | "eft"; mode: "submit" | "review" };
}

const BUCKETS: Bucket[] = [
  { id: "p-new",       label: "New Claims",           section: "Primary",   navTo: { board: "primary",   mode: "submit" } },
  { id: "p-resubmit",  label: "Resubmit",             section: "Primary",   navTo: { board: "primary",   mode: "submit" } },
  { id: "p-rejected",  label: "Awaiting · Rejected",  section: "Primary",   navTo: { board: "primary",   mode: "submit" } },
  { id: "p-era",       label: "ERA Review",           section: "Primary",   navTo: { board: "primary",   mode: "review" } },
  { id: "p-late",      label: "Late ERAs · Check",    section: "Primary",   navTo: { board: "primary",   mode: "review" } },
  { id: "p-denied",    label: "Denials",              section: "Primary",   navTo: { board: "primary",   mode: "review" } },
  { id: "s-confirm",   label: "Confirm Payor",        section: "Secondary", navTo: { board: "secondary", mode: "submit" } },
  { id: "s-insurance", label: "Insurance",            section: "Secondary", navTo: { board: "secondary", mode: "submit" } },
  { id: "s-patient",   label: "Patient",              section: "Secondary", navTo: { board: "secondary", mode: "submit" } },
  { id: "s-rejected",  label: "Awaiting · Rejected",  section: "Secondary", navTo: { board: "secondary", mode: "submit" } },
  { id: "s-era",       label: "ERA Review",           section: "Secondary", navTo: { board: "secondary", mode: "review" } },
  { id: "eft-todo",    label: "EFT · Not Started",    section: "EFT",       navTo: { board: "eft",       mode: "submit" } },
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

function inEraReviewLocal(c: Claim): boolean {
  // Mirror of Claims.tsx's inEraReview — kept here so the inbox
  // doesn't depend on that page exporting the predicate. Diverging
  // is a risk; if Brandon tweaks the page predicate, mirror here.
  if (c.hasChildren) return false;
  if (c.primaryStatus === "Paid" || c.primaryStatus === "Bad Debt") return false;
  return eraReceived(c) && c.primaryStatus !== "Denied (Or Partly)";
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
  onNavigate: (target: { board: "primary" | "secondary" | "eft"; mode: "submit" | "review" }) => void;
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
      const lateList   = primaryClaims.filter(inLateEraLocal).filter((c) => !isLateEraSnoozed(c));
      const deniedList = primaryClaims.filter(inDeniedLocal);

      out["p-era"]    = { count: eraList.length,
        oldestIso: ageOldestFromDates(eraList.map((c) => c.claimSentDate ?? c.dos)) };
      out["p-late"]   = { count: lateList.length,
        oldestIso: ageOldestFromDates(lateList.map((c) => c.claimSentDate ?? c.dos)) };
      out["p-denied"] = { count: deniedList.length,
        oldestIso: ageOldestFromDates(deniedList.map((c) => c.claimSentDate ?? c.dos)) };
    }

    // ── Secondary ─────────────────────────────────────────────────
    // bucketOf isn't exported; replicate the status-based mapping
    // inline. Keep in sync with SecondaryBoard.bucketOf.
    if (secondaryClaims) {
      const confirm     = secondaryClaims.filter((c) => c.status === "Awaiting Payor Confirmation");
      const insurance   = secondaryClaims.filter((c) => c.status === "Primary Paid - Submit Secondary");
      const patient     = secondaryClaims.filter((c) => c.status === "Sent to Patient");
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

  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(counts).map((r) => r.count)),
    [counts],
  );

  // Bar height scales linearly with count, clamped between MIN_BAR_H
  // (so even count-1 buckets are visible) and MAX_BAR_H (so the
  // tallest bar doesn't blow out the header height).
  const MIN_BAR_H = 6;
  const MAX_BAR_H = 28;
  const barHeight = (count: number): number => {
    if (count === 0) return 2;  // sliver — bucket is cleared
    const scale = count / maxCount;
    return Math.round(MIN_BAR_H + scale * (MAX_BAR_H - MIN_BAR_H));
  };

  if (totalOpen === 0) {
    return (
      <div className={cn(
        "flex items-center gap-2 rounded-md border bg-success-soft/30 px-3 py-1.5 text-xs font-medium text-success-soft-foreground",
        className,
      )}>
        <span aria-hidden>✓</span>
        <span>All clear</span>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={120}>
      <div
        className={cn(
          "flex items-end gap-[3px] rounded-md border bg-card px-2 py-1.5",
          className,
        )}
        role="group"
        aria-label="Action items inbox"
      >
        {BUCKETS.map((b, idx) => {
          const prev = BUCKETS[idx - 1];
          const showDivider = prev && prev.section !== b.section;
          const cr = counts[b.id];
          const cleared = cr.count === 0;
          return (
            <div key={b.id} className="flex items-end gap-[3px]">
              {showDivider && (
                <div className="mx-1 h-6 w-px self-center bg-border" aria-hidden />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onNavigate(b.navTo)}
                    aria-label={`${b.section} ${b.label} ${cr.count} items`}
                    className={cn(
                      "group flex h-7 w-3 items-end justify-center rounded-sm transition-colors",
                      cleared
                        ? "bg-muted hover:bg-muted-foreground/30"
                        : "bg-warning hover:bg-warning/80",
                    )}
                  >
                    {/* The colored fill is the inner div so the outer
                        button always has a consistent click area —
                        even on a cleared (height=2px) bar you can
                        still hit it and read the "no items" tooltip. */}
                    <span
                      aria-hidden
                      style={{ height: `${barHeight(cr.count)}px` }}
                      className="block w-full rounded-sm"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="font-medium">{b.section} · {b.label}</div>
                  <div className="text-muted-foreground">
                    {cr.count === 1 ? "1 item" : `${cr.count} items`}
                    {cr.count > 0 && <> · {fmtOldest(cr.oldestIso)}</>}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        <div className="ml-2 flex items-center gap-1 text-xs font-medium tabular-nums text-foreground">
          <span aria-hidden>·</span>
          <span>{totalOpen}</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
