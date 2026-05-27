import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppHeader } from "@/components/claims/AppHeader";
import {
  BankPaymentMethodBadge,
  ClaimStatusBadge, LineStatusBadge, PrimaryStatusBadge, StatusBadge, Status277Badge,
} from "@/components/claims/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getClaim } from "@/lib/claims/mockData";
import { useAllClaims, ALL_CLAIMS_QUERY_KEY } from "@/hooks/useAllClaims";
import { useQueryClient } from "@tanstack/react-query";
import { addProcessing as addMarkPaidProcessing } from "@/lib/markPaidProcessing";
import { hasMondayToken } from "@/api/monday";
import {
  carcMeaning, claimAge, effectivePr, eraReceived, fmtDate, fmtMoney,
  lineStatus, suggestedOutcome, variance, variancePretty,
  isLateEraSnoozed as isLateEraSnoozedLocal,
} from "@/lib/claims/logic";
import type {
  Claim, DenialAction, DenialAnalysis, ServiceLine,
} from "@/lib/claims/types";
import {
  AlertCircle, CalendarIcon, CheckCircle2, ChevronDown,
  Clock, FileWarning, Ban, AlertTriangle, Send, FileUp,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  carcPlaybookText, rarcPlaybookText, lookupDenialAnalysis,
  type PlaybookRowLike,
} from "@/lib/claims/playbook";
import {
  verifyPlaybookCombo,
  isPlaybookApiConfigured,
} from "@/api/playbook";
import {
  snoozeDocsUploaded,
  isSnoozeDocsUploadedConfigured,
} from "@/api/snoozeDocsUploaded";
import {
  usePlaybookCombos,
  PLAYBOOK_COMBOS_QUERY_KEY,
} from "@/hooks/usePlaybookCombos";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  markPrimaryPaid as apiMarkPrimaryPaid,
  isMarkPaidConfigured,
  isForwardedByPrimary,
  MarkPaidError,
  secondaryItemUrl,
  summarizeSecondary,
} from "@/api/markPaid";
import { setPrimaryStatus } from "@/api/setPrimaryStatus";
import { setActionContext as apiSetActionContext } from "@/api/setActionContext";
import { setDenialAction as apiSetDenialAction } from "@/api/setDenialAction";
import { setClaimSubitemStatus, isMondaySubitemId } from "@/api/setClaimField";
import { setClaimResentDate } from "@/api/setClaimResentDate";
import {
  spawnResubmission as apiSpawnResubmission,
  isSpawnResubmissionConfigured,
  SpawnResubmissionError,
} from "@/api/spawnResubmission";
import { LineResubmitDialog, type LineResubmitConfirm } from "@/components/claims/LineResubmitDialog";
import { applyManualEra, isManualEraConfigured, ManualEraError } from "@/api/manualEra";
import { Input } from "@/components/ui/input";
import { Pencil, X as XIcon, Save } from "lucide-react";

type LineUserStatus = "Paid" | "Underpaid" | "Denied";

const DENIAL_ANALYSIS_OPTIONS: NonNullable<DenialAnalysis>[] = [
  "No Auth", "Units / Frequency", "Wrong Modifiers", "Invalid Diagnosis Code",
  "Wrong Payer", "Documentation Required", "Pump / Monitor Not on File",
  "Inpatient / SNF / Hospice", "Inactive Coverage", "Timely Filing",
  "Duplicate Claim", "Other / Needs Review",
];

// Mirrors the labels on Monday's Denial Action column (color_mm2998p):
// New claim, Action Complete, Corrected claim, Appeal, Investigate,
// Submit auth, Upload docs, Contact payer, Bad Debt. Keep in lockstep
// with Monday — any drift here breaks the autosave write side.
const DENIAL_ACTION_OPTIONS: NonNullable<DenialAction>[] = [
  "New claim", "Corrected claim", "Appeal", "Investigate", "Submit auth",
  "Upload docs", "Contact payer", "Action Complete", "Bad Debt",
];

const ClaimDetail = () => {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  // Shared React Query cache for the claims list. We invalidate this on
  // any successful write so the Claims page picks up the new state on
  // navigate-back instead of waiting for React Query's staleTime to
  // expire (5 min). Without this, the operator marks paid in the detail
  // view, navigates back to /claims, and the claim is still sitting in
  // ERA Review for five minutes.
  const queryClient = useQueryClient();

  // Live Denial Playbook combos from the backend. Must be called BEFORE
  // any early returns (loading / not-found below) so React sees the
  // same hook count on every render — otherwise the loading-state
  // render and the loaded-state render disagree on the hook list and
  // React white-screens with a "rendered fewer hooks than expected"
  // error. The hook is cheap and disabled when the API isn't
  // configured, so running it for non-denied claims is harmless.
  const { data: livePlaybook } = usePlaybookCombos();
  const playbookRows = livePlaybook?.rows;

  // Look up the claim from real Monday data first; fall back to mock when
  // no token is configured (local dev). Match by Claim ID column or by the
  // Monday item id, since some claims don't have a Claim ID set yet.
  const { data: mondayClaims, isLoading: claimsLoading } = useAllClaims();
  const initial = (() => {
    if (!claimId) return undefined;
    if (hasMondayToken()) {
      if (!mondayClaims) return undefined; // still loading
      return mondayClaims.find(
        (c) => c.id === claimId || c.mondayItemId === claimId,
      );
    }
    return getClaim(claimId);
  })();

  if (hasMondayToken() && claimsLoading && !initial) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Loading…" showBack />
        <main className="mx-auto max-w-[1920px] px-6 py-12">
          <p className="text-muted-foreground">Fetching claim {claimId} from Monday…</p>
        </main>
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Claim not found" showBack />
        <main className="mx-auto max-w-[1920px] px-6 py-12">
          <p className="text-muted-foreground">No claim with id {claimId}.</p>
          <Button asChild className="mt-4"><Link to="/claims">Back to queue</Link></Button>
        </main>
      </div>
    );
  }

  const [claim, setClaim] = useState<Claim>(initial);
  const [denialAction, setDenialAction] = useState<DenialAction>(claim.denialAction);
  const [actionContext, setActionContext] = useState(claim.actionContext ?? "");
  // Track the persisted version separately so we know when the textarea
  // is dirty vs. just sitting at the value Monday already has.
  const [actionContextSavedState, setActionContextSavedState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  /**
   * Persist the Action Context textarea to Monday. Called from the
   * Textarea's onBlur so the operator can drift away from the textarea
   * (mouse-over the resolve buttons, switch tabs) and the notes survive
   * without needing them to click a resolution.
   *
   * No-op when the trimmed value matches what's already on the claim —
   * we don't burn API calls just because focus left the textarea.
   */
  async function autosaveActionContext() {
    const trimmed = actionContext.trim();
    const current = (claim.actionContext ?? "").trim();
    if (trimmed === current) return;
    setActionContextSavedState("saving");
    try {
      await apiSetActionContext(claim.mondayItemId, trimmed);
      setClaim({ ...claim, actionContext: trimmed });
      setActionContextSavedState("saved");
      // Hide the indicator after a beat so the field doesn't stay
      // crowded with stale status text.
      setTimeout(() => setActionContextSavedState("idle"), 2500);
    } catch (e) {
      setActionContextSavedState("error");
      toast.error("Couldn't save Action Context", {
        description: (e as Error).message,
      });
    }
  }
  const [nextActionDate, setNextActionDate] = useState<Date | undefined>(
    claim.nextActionDate ? new Date(claim.nextActionDate) : undefined,
  );
  const defaultLineUserStatus = (l: ServiceLine): LineUserStatus => {
    // Operator override wins — when the operator previously stamped
    // "Underpaid" or "Denied" on Monday it should survive across
    // reloads. Without this, lines that the auto-classifier judges
    // "Paid" (e.g. CO-131 fee-schedule reductions where paid + CO =
    // charge but the operator believes the payer should have paid
    // more) silently reset every time the page mounts and the denial
    // workflow UI hides because linesWithIssues becomes empty.
    if (l.operatorLineStatus) return l.operatorLineStatus;
    const s = lineStatus(l);
    if (s === "Paid" || s === "PR") return "Paid";
    if (s === "Partial") return "Underpaid";
    return "Denied";
  };
  const [lineUserStatus, setLineUserStatus] = useState<Record<string, LineUserStatus>>(
    Object.fromEntries(claim.lines.map((l) => [l.id, defaultLineUserStatus(l)])),
  );
  const [lineAnalysis, setLineAnalysis] = useState<Record<string, DenialAnalysis>>(
    Object.fromEntries(claim.lines.map((l) => [l.id, l.denialAnalysis])),
  );
  const [overrideReason, setOverrideReason] = useState("");

  // ─── Per-line Playbook verify state ───────────────────────────────────────
  // For each denied line, the operator can verify the (CARC, RARC)
  // combo against the Denial Playbook sheet without leaving the page.
  // Three slices of state govern that flow:
  //   - playbookEditing[lineId] — which line's picker is currently open
  //   - playbookDraft[lineId]   — the bucket the operator is about to save
  //   - playbookOverride[lineId] — sheet write succeeded; show this row as
  //                                Verified with the new bucket immediately,
  //                                without waiting for a re-fetch or page
  //                                reload. Optimistic UI.
  //   - playbookSavingId        — which line's save is in flight (one at a
  //                                time keeps the UI honest about toasts).
  const [playbookEditing, setPlaybookEditing] = useState<Record<string, boolean>>({});
  const [playbookDraft, setPlaybookDraft] = useState<Record<string, string>>({});
  const [playbookOverride, setPlaybookOverride] = useState<
    Record<string, { reason: string; verified: true }>
  >({});
  const [playbookSavingId, setPlaybookSavingId] = useState<string | null>(null);

  function appendActivity(message: string) {
    return [
      ...(claim.activity ?? []),
      { ts: new Date().toISOString(), actor: "you", message },
    ];
  }

  const age = claimAge(claim);
  const era = eraReceived(claim);
  const v = variance(claim);
  const vPretty = variancePretty(claim);
  const outcome = suggestedOutcome(claim);

  const linesWithIssues = useMemo(
    () => claim.lines.filter((l) => lineUserStatus[l.id] !== "Paid"),
    [claim.lines, lineUserStatus],
  );

  function writeback(label: string, fields: Record<string, unknown>) {
    // Placeholder: real impl posts to Monday API
    console.log("[Monday writeback]", label, fields);
    toast.success("Claim updated successfully.", {
      description: `Saved: ${Object.keys(fields).join(", ")}`,
    });
  }

  // ─── Mark Paid wiring ─────────────────────────────────────────────────────
  // The button opens a confirmation dialog; on confirm we call the
  // POST /claims/mark-paid endpoint on the Stedi-Monday backend, which
  // (a) sets the primary's status to Paid on Monday, and (b) if PR > 0,
  // spawns a corresponding item on the Secondary Claims Board with all
  // patient + primary-snapshot data and a copy of each subitem. The
  // local UI state is updated optimistically so the page reflects the
  // change immediately; if the API call fails we surface the error and
  // revert.
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [markPaidBusy, setMarkPaidBusy] = useState(false);

  // ─── Denial workflow resolution ───────────────────────────────────────────
  // For claims already in "Denied (Or Partly)", the Final Decision section
  // renders three outcomes — but only the one matching the chosen Denial
  // Action is clickable. Each option flips Primary Status on Monday via
  // setPrimaryStatus and (for Outstanding) stamps Claim Resent Date so
  // the Late ERA aging clock restarts. Bad Debt and Submit Claim do NOT
  // stamp the resent date — Submit Claim because the actual resubmission
  // happens later in the submit flow; Bad Debt because the claim is
  // terminal.

  /** Which routes are valid for the currently-selected Denial Action. */
  function resolutionFor(
    action: DenialAction,
  ): "Submit Claim" | "Outstanding" | "Bad Debt" | null {
    switch (action) {
      case "New claim":
      case "Corrected claim":
        return "Submit Claim";
      case "Appeal":
      case "Investigate":
      case "Submit auth":
      case "Upload docs":
      case "Contact payer":
      // Action Complete — the operator did whatever needed doing
      // (often a generic catch-all when none of the specific actions
      // fit) and wants to park the row back in Outstanding so the
      // Late ERA clock restarts and the response is awaited there.
      // Routes to Outstanding for the same reason Contact payer does:
      // the resolution moves OUT of Denials but the claim is still
      // in flight, not terminal. New claim / Corrected claim stay on
      // Submit Claim since they require a fresh 837.
      case "Action Complete":
        return "Outstanding";
      case "Bad Debt":
      case "No Action / Write Off":
        return "Bad Debt";
      default:
        return null;
    }
  }

  // ─── Playbook verify handlers ─────────────────────────────────────────────
  /** Open the bucket picker for a line, seeded with the current label. */
  function startPlaybookEdit(lineId: string, currentBucket: string) {
    setPlaybookEditing((m) => ({ ...m, [lineId]: true }));
    setPlaybookDraft((m) => ({ ...m, [lineId]: currentBucket }));
  }

  /** Cancel without saving — closes the picker, discards the draft. */
  function cancelPlaybookEdit(lineId: string) {
    setPlaybookEditing((m) => ({ ...m, [lineId]: false }));
    setPlaybookDraft((m) => {
      const next = { ...m };
      delete next[lineId];
      return next;
    });
  }

  /**
   * Save the operator's pick to the Sheet via the backend's
   * /admin/playbook/verify-combo endpoint. On success, optimistically
   * mark the line as Verified locally so the pill flips green
   * immediately — we don't wait for a re-fetch. The backend force-
   * refreshes its lookup cache as part of the same request, so the
   * next ERA hitting this (CARC, RARC) combo auto-fills the right
   * bucket.
   */
  async function savePlaybookVerify(line: ServiceLine) {
    const bucket = (playbookDraft[line.id] || "").trim();
    if (!bucket) {
      toast.error("Pick a bucket first.");
      return;
    }
    if (!isPlaybookApiConfigured()) {
      toast.error(
        "Playbook API not configured (missing VITE_API_BASE_URL or VITE_ADMIN_API_KEY).",
      );
      return;
    }
    setPlaybookSavingId(line.id);
    try {
      // From the ClaimDetail per-line picker, "Save" means: this combo
      // belongs in bucket X AND I'm signing off on it for this claim.
      // Pass both — different semantic from the workbook table where
      // the operator manages bucket and verified flag independently.
      const result = await verifyPlaybookCombo({
        carc: line.carc.map(String).join(","),
        rarc: line.rarc.join(","),
        bucket,
        verified: true,
      });
      setPlaybookOverride((m) => ({
        ...m,
        [line.id]: { reason: result.bucket || bucket, verified: true },
      }));
      setPlaybookEditing((m) => ({ ...m, [line.id]: false }));
      // Bust the live-playbook cache so every other open surface
      // (DenialAnalysisTable, other ClaimDetail tabs with the same
      // CARC/RARC) re-fetches and sees the new verified bucket.
      void queryClient.invalidateQueries({ queryKey: PLAYBOOK_COMBOS_QUERY_KEY });
      toast.success(
        result.was_appended
          ? `New combo verified (row appended to sheet).`
          : `Combo verified.`,
        { description: `${bucket} — cache reloaded (${result.cache_combos_loaded} combos).` },
      );
    } catch (e) {
      toast.error("Couldn't save to the Playbook sheet.", {
        description: (e as Error).message,
      });
    } finally {
      setPlaybookSavingId(null);
    }
  }


  /**
   * Auto-persist the Denial Action to Monday whenever the operator
   * changes the Select — except for "Bad Debt", which is held in local
   * state only until the operator commits via the Bad Debt outcome
   * card. Writing "Bad Debt" to Monday fires a board automation that
   * moves the item to the write-off group, so we never want it to
   * happen by accident on a misclick. Every other action persists
   * immediately so half-complete denials sit in the Denials bucket
   * with the chosen action recorded.
   */
  async function handleDenialActionChange(action: DenialAction) {
    setDenialAction(action);
    if (!action) return;
    if (action === "Bad Debt") {
      // Defer the Monday write until the operator clicks the Bad Debt
      // outcome card — see resolveDenial("Bad Debt").
      return;
    }
    try {
      await apiSetDenialAction(claim.mondayItemId, action);
      setClaim({ ...claim, denialAction: action });
    } catch (e) {
      toast.error("Couldn't save Denial Action to Monday", {
        description: (e as Error).message,
      });
    }
  }

  const [denialResolveBusy, setDenialResolveBusy] = useState<
    "Submit Claim" | "Outstanding" | "Bad Debt" | null
  >(null);

  // Line-selector dialog for the Submit Claim path. Opens when the
  // operator picks New claim / Corrected claim and clicks Submit Claim —
  // they pick which lines to carry onto the resubmission and optionally
  // edit units / charge, then confirm. The backend spawns a fresh
  // Monday item linked to this one via Parent Claim ID.
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [resubmitBusy, setResubmitBusy] = useState(false);

  // Edit ERA — inline manual entry on the Service Lines table.
  // When eraEditing is true, the Paid / Ded / Coins / Copay cells turn
  // into Inputs. Save calls /claims/manual-era which writes the per-line
  // values + parent rollups, stamps Raw ERA Claim Status="Manual entry",
  // flips Primary Status=Review so the row joins the normal ERA Review
  // flow. Use case: payer paid but didn't send an 835, or we got the
  // breakdown by phone.
  const [eraEditing, setEraEditing] = useState(false);
  const [eraEditBusy, setEraEditBusy] = useState(false);
  const [eraEditDate, setEraEditDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  // Per-line editable fields. Initialized from claim.lines when edit
  // mode opens; PR derives from Ded + Coins + Copay on save.
  const [eraEdits, setEraEdits] = useState<Record<string, {
    primaryPaid: number; deductible: number; coinsurance: number; copay: number;
  }>>({});

  function startEraEdit() {
    setEraEdits(Object.fromEntries(
      claim.lines.map((l) => [l.id, {
        primaryPaid: l.primaryPaid || 0,
        deductible: l.deductible || 0,
        coinsurance: l.coinsurance || 0,
        copay: l.copay || 0,
      }]),
    ));
    setEraEditDate(new Date().toISOString().slice(0, 10));
    setEraEditing(true);
  }
  function cancelEraEdit() {
    setEraEditing(false);
    setEraEdits({});
  }
  function setEraField(
    lineId: string,
    field: "primaryPaid" | "deductible" | "coinsurance" | "copay",
    value: number,
  ) {
    setEraEdits((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], [field]: value },
    }));
  }
  async function saveEraEdit() {
    if (eraEditBusy) return;
    if (!isManualEraConfigured()) {
      toast.error("Manual ERA not configured", {
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }
    setEraEditBusy(true);
    try {
      const lines = claim.lines.map((l) => {
        const e = eraEdits[l.id] ?? {
          primaryPaid: 0, deductible: 0, coinsurance: 0, copay: 0,
        };
        return {
          subitemId: l.id,
          primaryPaid: e.primaryPaid,
          deductible: e.deductible,
          coinsurance: e.coinsurance,
          copay: e.copay,
          // PR auto-derived from D + C + Copay; backend uses this when
          // we don't override.
          pr: e.deductible + e.coinsurance + e.copay,
        };
      });
      const res = await applyManualEra({
        itemId: claim.mondayItemId,
        primaryPaidDate: eraEditDate,
        lines,
      });
      toast.success("ERA saved", {
        description:
          `Paid ${fmtMoney(res.primary_paid_total)} · PR ${fmtMoney(res.pr_total)} · ` +
          `${res.lines_updated} line(s). Row moved to ERA Review.`,
      });
      // Optimistic local update so the table reflects the new values
      // immediately. A real refetch will fire on next bucket render.
      const updatedLines = claim.lines.map((l) => {
        const e = eraEdits[l.id] ?? {
          primaryPaid: 0, deductible: 0, coinsurance: 0, copay: 0,
        };
        return {
          ...l,
          primaryPaid: e.primaryPaid,
          deductible: e.deductible,
          coinsurance: e.coinsurance,
          copay: e.copay,
          patientResponsibility: e.deductible + e.coinsurance + e.copay,
        };
      });
      setClaim({
        ...claim,
        primaryStatus: "Review",
        primaryPaid: res.primary_paid_total,
        prAmount: res.pr_total,
        primaryPaidDate: res.primary_paid_date,
        rawEraClaimStatus: "Manual entry",
        rawEraDate: res.primary_paid_date,
        lines: updatedLines,
      });
      setEraEditing(false);
      setEraEdits({});
    } catch (e) {
      const msg = e instanceof ManualEraError ? e.message : (e as Error).message;
      toast.error("Couldn't save ERA", { description: msg });
    } finally {
      setEraEditBusy(false);
    }
  }

  async function handleResubmitConfirm(req: LineResubmitConfirm) {
    if (resubmitBusy) return;
    if (!isSpawnResubmissionConfigured()) {
      toast.error("Resubmission spawn not configured", {
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }
    setResubmitBusy(true);
    try {
      // Persist the denial action selection in case the operator flipped
      // it inside the dialog. Best-effort — if it fails, the spawn still
      // proceeds with the right Claim Type because the backend trusts
      // the request body, not what's on Monday at the moment.
      try {
        if (req.denialAction !== denialAction) {
          await apiSetDenialAction(claim.mondayItemId, req.denialAction);
          setDenialAction(req.denialAction);
        }
      } catch (e) {
        console.warn("[resubmit] denial action sync failed:", e);
      }

      const result = await apiSpawnResubmission({
        parentItemId: claim.mondayItemId,
        lineSubitemIds: req.selectedSubitemIds,
        lineOverrides: req.overrides,
        denialAction: req.denialAction,
      });

      // Optimistically reflect what we just wrote so the user sees the
      // change without a full refetch.
      setClaim({ ...claim, hasChildren: true });

      toast.success(
        result.idempotent_hit
          ? "Existing resubmission reused"
          : "Resubmission spawned",
        {
          description:
            result.idempotent_hit
              ? `Returned previously-spawned child (id ${result.child_item_id}). ${result.lines_carried} line(s) carried.`
              : `New ${result.claim_type} claim created with ${result.lines_carried} line(s). Opening it now.`,
        },
      );
      setResubmitOpen(false);

      // Navigate to the new child item. Same route prefix as parent.
      navigate(`/claims/${result.child_item_id}`);
    } catch (e) {
      const msg =
        e instanceof SpawnResubmissionError
          ? e.message
          : (e as Error).message;
      toast.error("Resubmission failed", { description: msg });
    } finally {
      setResubmitBusy(false);
    }
  }

  async function resolveDenial(
    nextStatus: "Submit Claim" | "Outstanding" | "Bad Debt",
  ) {
    if (denialResolveBusy) return;
    if (!denialAction) {
      toast.error("Pick a Denial Action above first.");
      return;
    }
    setDenialResolveBusy(nextStatus);
    try {
      // 0. Bad Debt path: commit the Denial Action label to Monday now
      //    — we held it back in handleDenialActionChange to avoid
      //    accidentally firing the write-off automation on a misclick.
      if (nextStatus === "Bad Debt" && denialAction === "Bad Debt") {
        try {
          await apiSetDenialAction(claim.mondayItemId, "Bad Debt");
        } catch (e) {
          toast.error("Couldn't save Denial Action = Bad Debt", {
            description: (e as Error).message,
          });
          return;
        }
      }
      // 1. Primary Status — the load-bearing write.
      await setPrimaryStatus(claim.mondayItemId, nextStatus);

      // 2. Claim Resent Date — only when we're moving the claim back
      //    into active pursuit (Outstanding). Submit Claim doesn't write
      //    here because the resent date should reflect actual
      //    resubmission, which happens later in the submit flow. Bad
      //    Debt is terminal so the resent clock is irrelevant.
      let resentToday: string | null = null;
      if (nextStatus === "Outstanding") {
        const today = new Date().toISOString().slice(0, 10);
        try {
          await setClaimResentDate(claim.mondayItemId, today);
          resentToday = today;
        } catch (e) {
          console.warn("[denial-resolve] resent date write failed:", e);
          toast.warning("Status updated, but Resent Date didn't save", {
            description: (e as Error).message,
          });
        }
      }

      // 3. Action Context — persist any operator note.
      const ctxTrimmed = actionContext.trim();
      if (ctxTrimmed !== (claim.actionContext ?? "").trim()) {
        try {
          await apiSetActionContext(claim.mondayItemId, ctxTrimmed);
        } catch (e) {
          console.warn("[denial-resolve] action context write failed:", e);
          toast.warning("Status updated, but action context didn't save", {
            description: (e as Error).message,
          });
        }
      }

      setClaim({
        ...claim,
        primaryStatus: nextStatus as Claim["primaryStatus"],
        actionContext: ctxTrimmed,
        claimResentDate: resentToday ?? claim.claimResentDate,
        activity: appendActivity(
          nextStatus === "Submit Claim"
            ? `Denial resolved (${denialAction}) → moved to Submit Claim.`
            : nextStatus === "Outstanding"
              ? `Denial resolved (${denialAction}) → Outstanding. Resent Date ${resentToday ?? "(not saved)"}.`
              : `Denial resolved (${denialAction}) → written off as Bad Debt.`,
        ),
      });
      toast.success(`Primary status → ${nextStatus}`, {
        description:
          nextStatus === "Submit Claim"
            ? "Lands on New Claims / Resubmit board."
            : nextStatus === "Outstanding"
              ? `Back to Outstanding. ${
                  denialAction === "Appeal"
                    ? "Late ERA clock: 60 days."
                    : "Late ERA clock: 21 days."
                }`
              : "Written off — claim closed.",
      });
      navigate("/claims");
    } catch (e) {
      toast.error("Couldn't update Monday", {
        description: (e as Error).message,
      });
    } finally {
      setDenialResolveBusy(null);
    }
  }

  // ─── "Uploaded Docs" snooze ──────────────────────────────────────────────
  // Some payers ask for medical docs before paying/denying. Once the
  // operator uploads them, this button stamps Late Action Date =
  // today + 14d on Monday so the row drops out of Late ERA until the
  // payer has had a reasonable window to respond. Optimistic local
  // state update so the snooze pill (in Outstanding) appears on the
  // claim list immediately on navigate-back; nothing else on this
  // detail page renders the snooze.
  const [docsUploadedBusy, setDocsUploadedBusy] = useState(false);
  async function handleDocsUploaded() {
    if (docsUploadedBusy) return;
    if (!isSnoozeDocsUploadedConfigured()) {
      toast.error(
        "Uploaded Docs not wired — VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      );
      return;
    }
    setDocsUploadedBusy(true);
    try {
      const result = await snoozeDocsUploaded(claim.mondayItemId, 14);
      setClaim({ ...claim, lateActionDate: result.snoozed_until });
      // Bust the claims-list cache so the Outstanding row picks up the
      // new snooze date + the Late ERA bucket count drops by one when
      // the operator navigates back.
      void queryClient.invalidateQueries({ queryKey: ALL_CLAIMS_QUERY_KEY });
      toast.success("Docs uploaded — claim snoozed.", {
        description: `Won't return to Late ERA until ${result.snoozed_until}.`,
      });
    } catch (e) {
      toast.error("Couldn't snooze claim.", {
        description: (e as Error).message,
      });
    } finally {
      setDocsUploadedBusy(false);
    }
  }

  function openMarkPaid() {
    // Variance-override gate disabled for now. Operators can mark any claim
    // paid regardless of how much variance from est. pay; the variance is
    // visible elsewhere in the row + difference column.
    setMarkPaidOpen(true);
  }

  async function confirmMarkPaid() {
    if (markPaidBusy) return;
    const note = "Marked primary paid via Command Center.";

    // Optimistic local update so the UI feels instant
    const previous = claim;
    setClaim({
      ...claim, primaryStatus: "Paid", denialAction: "Action Complete",
      subscriptionClearance: claim.secondaryPayer || claim.prAmount > 0 ? "Manager Review" : "Clear",
      claimsHoldReason: claim.secondaryPayer ? "Secondary outstanding" : (claim.prAmount > 0 ? "Patient balance" : null),
      activity: appendActivity(note),
    });

    // No backend configured (local dev) — leave the optimistic update in place
    // and inform the user we didn't write back.
    if (!isMarkPaidConfigured()) {
      toast.warning(
        "Mark Paid not wired — VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
        { description: "Local state updated; Monday NOT touched." },
      );
      setMarkPaidOpen(false);
      return;
    }

    setMarkPaidBusy(true);
    try {
      const result = await apiMarkPrimaryPaid(claim.mondayItemId);
      setMarkPaidOpen(false);

      // Invalidate the shared claims-list cache so when the operator
      // navigates back to /claims the row drops out of ERA Review
      // immediately (instead of waiting up to 5 min for staleTime).
      // Schedule a few follow-up invalidations to catch the Monday
      // status propagation that lags behind the backend response.
      void queryClient.invalidateQueries({ queryKey: ALL_CLAIMS_QUERY_KEY });
      [3000, 6000, 9000].forEach((delay) => {
        window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ALL_CLAIMS_QUERY_KEY });
        }, delay);
      });

      // Persist a "this claim is mid-processing" marker so the Claims
      // page (when the operator navigates back) shows the same
      // "Marking paid…" pulsing chip the row-level Mark Paid uses.
      // Without this, returning to the list looked like the click in
      // the detail view never happened.
      addMarkPaidProcessing(claim.id);

      // Backend now returns in ~1-2s after the Primary Status flip; the
      // secondary spawn (if PR > 0) runs as a Railway background task,
      // so we no longer have the secondary item id at response time.
      if (result.spawn_status === "queued") {
        toast.success("Marked Paid.", {
          description: `Spawning Secondary item in background (PR $${result.pr_amount.toFixed(2)}). It'll appear on the Secondary Board in ~5s.`,
        });
      } else {
        toast.success("Marked Paid.", {
          description: "PR = 0 — no secondary needed.",
        });
      }
    } catch (e) {
      // Revert optimistic update so the UI doesn't lie
      setClaim(previous);
      const msg = e instanceof MarkPaidError ? e.message : (e as Error).message;
      toast.error("Mark Paid failed.", { description: msg });
    } finally {
      setMarkPaidBusy(false);
    }
  }

  /**
   * Move the claim into the Denials bucket — Primary Status flips to
   * Denied (Or Partly) on Monday. This is the entry point of the
   * denial workflow, NOT the resolution. The operator picks Denial
   * Action + writes Action Context + chooses the outcome (Submit
   * Claim / Outstanding / Bad Debt) later, on the Denial Action
   * Outcome card that appears once the claim is in Denied state.
   *
   * Previously this required denialAction + actionContext +
   * nextActionDate up front, but that conflated the "send to denial
   * bucket" action with "resolve the denial" — operators were getting
   * blocked here when they hadn't yet decided what to do.
   */
  async function saveDenial() {
    try {
      await setPrimaryStatus(claim.mondayItemId, "Denied (Or Partly)");
      setClaim({
        ...claim,
        primaryStatus: "Denied (Or Partly)",
        subscriptionClearance: "Hold",
        claimsHoldReason: "Denial / appeal pending",
        lines: claim.lines.map((l) => ({ ...l, denialAnalysis: lineAnalysis[l.id] })),
        activity: appendActivity(
          "Sent to Denials bucket. Pick a Denial Action below to work it.",
        ),
      });
      toast.success("Sent to Denials", {
        description:
          "Claim is in the Denials bucket. Pick a Denial Action and choose an outcome to resolve it.",
      });
    } catch (e) {
      toast.error("Couldn't update Monday", {
        description: (e as Error).message,
      });
    }
  }

  function markInvestigation() {
    if (!actionContext.trim() || !nextActionDate) {
      toast.error("Action context and next action date required."); return;
    }
    setClaim({
      ...claim,
      denialAction: "Investigate",
      actionContext,
      nextActionDate: nextActionDate.toISOString(),
      activity: appendActivity(`Marked for investigation: ${actionContext}`),
    });
    writeback("Marked for Investigation", {
      Primary: "Review", "Denial Action": "Investigate",
      "Action Context": actionContext,
      "Next Action Date": format(nextActionDate, "yyyy-MM-dd"),
    });
  }

  function runStatusCheck() {
    if (eraReceived(claim)) {
      toast.error("ERA already received — review the ERA instead of running a status check.");
      return;
    }
    setClaim({ ...claim, activity: appendActivity("Status check requested.") });
    writeback("Claim Status Check triggered", {
      "Claim Status Check": "Run",
      "Notes & Activity": "Status check requested via Command Center.",
    });
  }

  function moveToSecondary() {
    if (!claim.secondaryPayer) {
      toast.error("No secondary payer on file — cannot mark Ready for Secondary.");
      return;
    }
    setClaim({
      ...claim,
      primaryStatus: "Paid",
      transfer: "Ready for Secondary",
      subscriptionClearance: "Manager Review",
      claimsHoldReason: "Secondary outstanding",
      activity: appendActivity(`Handed off to secondary: ${claim.secondaryPayer}.`),
    });
    writeback("Ready for Secondary", {
      Primary: "Paid", Transfer: "Ready for Secondary",
    });
  }

  function writeOff() {
    if (!actionContext.trim()) {
      toast.error("Action context explaining why is required."); return;
    }
    setClaim({
      ...claim,
      primaryStatus: "Bad Debt",
      denialAction: "No Action / Write Off",
      actionContext,
      subscriptionClearance: "Manager Review",
      activity: appendActivity(`Wrote off: ${actionContext}`),
    });
    writeback("Write Off", {
      Primary: "Bad Debt",
      "Denial Action": "No Action / Write Off",
      "Action Context": actionContext,
    });
  }

  function escalate() {
    setClaim({
      ...claim,
      subscriptionClearance: "Manager Review",
      activity: appendActivity(`Escalated for manager review${actionContext ? `: ${actionContext}` : "."}`),
    });
    writeback("Escalated", {
      "Subscription Clearance": "Manager Review",
      "Notes & Activity": "Escalation requested via Command Center.",
    });
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <AppHeader
        title={claim.patientName}
        subtitle={`DOB ${fmtDate(claim.dob)} · DOS ${fmtDate(claim.dos)} · ${claim.primaryPayor} · Member ID ${claim.memberId}`}
        showBack
      />

      <main className="mx-auto max-w-[1920px] px-6 py-6 space-y-6">
        {/* Thread breadcrumb — surfaces when this claim is part of a
            resubmission lineage. Walks parent_claim_id up to the root and
            children down so the operator can see what this claim
            replaced and what (if anything) replaced it. Renders nothing
            for claims without lineage so the header stays clean. */}
        <ThreadBreadcrumb claim={claim} allClaims={mondayClaims ?? []} />

        {/* Status badges row */}
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryStatusBadge status={claim.primaryStatus} />
          <Status277Badge status={claim.status277} />
          <ClaimStatusBadge status={claim.claimStatusCategory} />
          <StatusBadge tone={era ? "info" : "neutral"}>
            ERA {era ? "Received" : "Not Received"}
          </StatusBadge>
          {age != null && (
            <StatusBadge tone={age >= 30 ? "danger" : age >= 15 ? "warning" : "neutral"}>
              {age}d old
            </StatusBadge>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            Claim {claim.claimId}{claim.payerClaimNumber ? ` · Payer #${claim.payerClaimNumber}` : ""}
          </div>
        </div>

        {/* Summary cards */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat label="Expected Pay" value={fmtMoney(claim.estPay)}
            sub="Based on service lines" />
          <SummaryStat label="Primary Paid" value={fmtMoney(claim.primaryPaid)}
            sub={claim.primaryPaidDate ? `Paid ${fmtDate(claim.primaryPaidDate)}` : "Not paid yet"} />
          <SummaryStat
            label="Patient Responsibility"
            // Uses effectivePr (sums per-line deductible + coinsurance +
            // copay) so the headline agrees with the line-item Difference
            // column. The parent prAmount field on Monday is stale on
            // many rows after an ERA writeback.
            value={fmtMoney(effectivePr(claim))}
            sub={`Deductible ${fmtMoney(claim.lines.reduce((s, l) => s + l.deductible, 0))} · Coins ${fmtMoney(claim.lines.reduce((s, l) => s + l.coinsurance, 0))}`}
            badge={
              isForwardedByPrimary(claim.rawEraClaimStatus) ? (
                <span
                  className="inline-flex h-5 items-center rounded-md bg-blue-100 px-1.5 text-[10px] font-medium uppercase tracking-wide text-blue-700"
                  title={claim.rawEraClaimStatus ?? undefined}
                >
                  Forwarded
                </span>
              ) : null
            }
          />
          <SummaryStat
            label="Difference"
            value={vPretty.tone === "balanced" ? "Balanced" : (v > 0 ? `${fmtMoney(v)} short` : `${fmtMoney(Math.abs(v))} over`)}
            sub="Est. Pay − Paid − PR"
            tone={vPretty.tone === "balanced" ? "success" : vPretty.tone === "short" ? "danger" : "info"}
          />
        </section>

        {/* Bank Info strip — only renders when an 835 has populated the
            BPR / TRN columns. Lets the operator Ctrl+F the ORIG ID or
            EFT trace in Chase/TD to confirm the deposit landed without
            jumping back to Stedi. All four fields share the same value
            across every claim that came in the same 835. */}
        {(claim.bankDepositTotal != null ||
          claim.bankPaymentMethod ||
          claim.bankPayerOriginatorId ||
          claim.bankEftDate) && (
          <Card>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bank Info
                </div>
                <span className="text-[10px] text-muted-foreground/80">
                  use these to search your bank for the deposit
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment Amount
                  </div>
                  <div className="mt-1 text-sm font-medium tabular-nums">
                    {claim.bankDepositTotal != null
                      ? fmtMoney(claim.bankDepositTotal)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    EFT Date
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {claim.bankEftDate ? fmtDate(claim.bankEftDate) : "—"}
                  </div>
                </div>
                <div>
                  {/* Identifier the operator Ctrl+Fs for in Chase / TD.
                      We surface the X12 TRN trace number (NOT BPR.ORIG ID)
                      because the trace always appears in the bank's ACH
                      addenda as `TRN*1*<trace>*<...>` — including
                      processor-mediated ACHs (PayPlus / Echo / Zelis)
                      where the bank's `ORIG ID:` is the processor, not
                      the payer. Mono font so it's easy to scan + copy. */}
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Trace # (TRN)
                  </div>
                  <div className="mt-1 font-mono text-sm">
                    {claim.bankTraceNumber || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment Method
                  </div>
                  {/* Raw BPR method code + an interpretive pill. ACH (and
                      anything else we don't recognize) shows the code on
                      its own; CHK/FWT/NON get a colored pill so the
                      operator instantly sees what action — if any — the
                      method implies. See BankPaymentMethodBadge. */}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>{claim.bankPaymentMethod || "—"}</span>
                    <BankPaymentMethodBadge method={claim.bankPaymentMethod} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Claim-level meta strip — sits directly above the Service Lines
            table so the operator can see who the claim was sent to when
            they're reading a denial (especially useful for Wrong Payer
            denials where the line-level codes alone don't tell the story). */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Claim Sent Date
                </div>
                <div className="mt-1 text-sm font-medium">
                  {claim.claimSentDate ? fmtDate(claim.claimSentDate) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Date of Service
                </div>
                <div className="mt-1 text-sm font-medium">
                  {claim.dos ? fmtDate(claim.dos) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Primary Payer
                </div>
                <div className="mt-1 text-sm font-medium">
                  {claim.primaryPayor || "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payer ID
                </div>
                <div className="mt-1 font-mono text-sm">
                  {claim.payorId || "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Place of Service
                </div>
                {/* Editor lives on PrimarySubmitBoard (between Dx and Type)
                    so it can be changed pre-submit. Detail page just
                    reads. */}
                <div className="mt-1 text-sm font-medium">
                  {claim.placeOfService ?? "Home"}{" "}
                  <span className="text-xs font-mono text-muted-foreground">
                    ({claim.placeOfService === "Office" ? "11" : "12"})
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ERA table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Service Lines</CardTitle>
              {/* Edit ERA — toggle the per-line Paid/Ded/Coins/Copay cells
                  into Inputs. Used when payer paid but no 835 came (or
                  we got the breakdown by phone). Save → /claims/manual-era,
                  row moves to ERA Review with the entered values. */}
              {eraEditing ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Primary Paid Date
                    </label>
                    <Input
                      type="date"
                      value={eraEditDate}
                      onChange={(e) => setEraEditDate(e.target.value)}
                      className="h-7 w-36"
                      disabled={eraEditBusy}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelEraEdit}
                    disabled={eraEditBusy}
                  >
                    <XIcon className="mr-1 h-4 w-4" /> Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void saveEraEdit()}
                    disabled={eraEditBusy}
                  >
                    <Save className="mr-1 h-4 w-4" />
                    {eraEditBusy ? "Saving…" : "Save ERA"}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={startEraEdit}>
                  <Pencil className="mr-1 h-4 w-4" /> Edit ERA
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Product</TableHead>
                    <TableHead>HCPCS</TableHead>
                    <TableHead>Mods</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Charge</TableHead>
                    <TableHead className="text-right">Est. Pay</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Ded.</TableHead>
                    <TableHead className="text-right">Coins/Copay</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead>CARC/RARC</TableHead>
                    <TableHead className="w-[140px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claim.lines.map((l) => (
                    <LineRow
                      key={l.id}
                      line={l}
                      status={lineUserStatus[l.id]}
                      onStatusChange={(s) => {
                        // Optimistic state update so the dropdown reflects
                        // the change immediately. Persist to Monday in the
                        // background — failure surfaces via toast but we
                        // don't revert the UI (operator can retry).
                        setLineUserStatus((p) => ({ ...p, [l.id]: s }));
                        if (isMondaySubitemId(l.id)) {
                          void setClaimSubitemStatus(l.id, "color_mm3r87yb", s)
                            .catch((e) => {
                              toast.error("Couldn't save line status", {
                                description: (e as Error).message,
                              });
                            });
                        }
                      }}
                      eraEditing={eraEditing}
                      eraEdit={eraEdits[l.id]}
                      onEraFieldChange={(field, value) => setEraField(l.id, field, value)}
                      playbookRows={playbookRows}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Denial analysis section — work denials only. Playbook-level
            controls (ERA Drive folder, Sheet, Sync Playbook) live on
            the Denial Analysis Playbook workbook page; this card is
            patient-specific and only surfaces the per-line picker.

            Visibility rule: as long as the parent's Primary Status is
            "Denied (Or Partly)" we show this block, regardless of the
            per-line auto-classifier. The operator already declared this
            row a denial by moving it here; that intent should not be
            overridden when every line happens to math-balance (e.g.
            CO-131 fee-schedule reductions where paid + CO = charge).
            Previously this block hid the Action Context + Denial Action
            picker entirely on lines like Patty Eshenbaugh's CGM
            monitor — operator saw notes vanish + no outcome picker. */}
        {claim.primaryStatus === "Denied (Or Partly)" && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Denial Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {linesWithIssues.map((l) => {
                const interpreted = lookupDenialAnalysis(l.carc, l.rarc, playbookRows);
                // Optimistic override: once the operator successfully
                // verifies this line's combo via the picker, we treat
                // it as Verified locally without waiting for a fetch
                // refresh. The override persists for the lifetime of
                // this page render — a navigation away + back will
                // re-derive from the bundled snapshot (which by then
                // should match, once the backend's force-refreshed
                // cache has been picked up on the next ERA).
                const ov = playbookOverride[l.id];
                const effectiveState = ov ? "verified" : interpreted.state;
                const effectiveReason = ov ? ov.reason : interpreted.reason;

                const playbookPill =
                  effectiveState === "verified"
                    ? { tone: "success" as const, label: "Verified" }
                    : effectiveState === "unverified"
                      ? { tone: "warning" as const, label: "Unverified" }
                      : { tone: "danger" as const, label: "New denial" };

                const editing = !!playbookEditing[l.id];
                const saving  = playbookSavingId === l.id;
                const draft   = playbookDraft[l.id] ?? effectiveReason ?? "";

                return (
                <div key={l.id} className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_minmax(260px,1fr)]">
                  <div>
                    <div className="font-medium text-sm">{l.product}</div>
                    <div className="text-xs text-muted-foreground">{l.hcpcs}{l.modifiers.length ? ` · ${l.modifiers.join(", ")}` : ""}</div>
                  </div>
                  <div className="text-sm">
                    <div className="font-mono text-xs">
                      {[...l.carc.map((c) => `CO-${c}`), ...l.rarc].join(" · ") || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {l.adjustmentReasons[0] ?? l.remarkText[0] ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Denial Reason (Playbook)</div>
                      <StatusBadge tone={playbookPill.tone}>{playbookPill.label}</StatusBadge>
                    </div>
                    {/* Two modes:
                        1) Read mode — current label + a "Verify" / "Change"
                           link that opens the picker. Hidden when the
                           Playbook API isn't configured.
                        2) Edit mode — dropdown seeded with current bucket
                           + Save / Cancel. Save writes the Verified
                           columns to the Playbook sheet via the backend
                           and force-refreshes the lookup cache so future
                           ERAs with the same (CARC, RARC) auto-fill. */}
                    {!editing && (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {effectiveReason ?? (
                            <span className="text-muted-foreground italic">
                              Not in playbook
                            </span>
                          )}
                        </div>
                        {isPlaybookApiConfigured() && (
                          <button
                            type="button"
                            onClick={() => startPlaybookEdit(l.id, effectiveReason ?? "")}
                            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                          >
                            {effectiveState === "verified" ? "Change" : "Verify"}
                          </button>
                        )}
                      </div>
                    )}
                    {editing && (
                      <div className="mt-2 space-y-2">
                        <Select
                          value={draft || undefined}
                          onValueChange={(v) =>
                            setPlaybookDraft((m) => ({ ...m, [l.id]: v }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Pick bucket…" />
                          </SelectTrigger>
                          <SelectContent>
                            {DENIAL_ANALYSIS_OPTIONS.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={saving}
                            onClick={() => cancelPlaybookEdit(l.id)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={saving || !draft}
                            onClick={() => void savePlaybookVerify(l)}
                          >
                            {saving ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}

              <div className="grid grid-cols-1 gap-4 pt-2">
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <label className="text-sm font-medium">Claim-level Denial Action</label>
                    <span className="text-xs text-muted-foreground">
                      {`Applies to: ${linesWithIssues.length} of ${claim.lines.length} unresolved items`}
                    </span>
                  </div>
                  <Select
                    value={denialAction ?? undefined}
                    onValueChange={(v) =>
                      void handleDenialActionChange(v as DenialAction)
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="Choose action" /></SelectTrigger>
                    <SelectContent>
                      {DENIAL_ACTION_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Saves to Monday on change. Pick the action even if you
                    haven't done the work yet — the claim stays in
                    Denials until you click a resolution below.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <label className="text-sm font-medium">Action Context</label>
                    {actionContextSavedState === "saving" && (
                      <span className="text-[11px] text-muted-foreground">
                        Saving…
                      </span>
                    )}
                    {actionContextSavedState === "saved" && (
                      <span className="text-[11px] text-success-soft-foreground">
                        ✓ Saved
                      </span>
                    )}
                    {actionContextSavedState === "error" && (
                      <span className="text-[11px] text-danger-soft-foreground">
                        Couldn't save
                      </span>
                    )}
                  </div>
                  <Textarea
                    placeholder="e.g. Reduce units to 30 and resubmit. Upload clinical notes to payer portal."
                    value={actionContext}
                    onChange={(e) => setActionContext(e.target.value)}
                    onBlur={() => void autosaveActionContext()}
                    rows={3}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Auto-saves to Monday when you click out of the box.
                    No need to resolve the denial yet — your notes are
                    safe.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Final decision panel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {claim.primaryStatus === "Denied (Or Partly)"
                ? "Denial Action Outcome"
                : "Final Decision"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {claim.primaryStatus === "Denied (Or Partly)"
                ? "Resolve this denial. Pick the outcome of the work you just did."
                : "Pick one outcome to close out this claim."}
            </p>
          </CardHeader>
          <CardContent>
            {claim.primaryStatus === "Denied (Or Partly)" ? (
              // Denial resolution flow — only the path matching the
              // currently-selected Denial Action is enabled. Other cards
              // render disabled so the operator can see all options but
              // not accidentally take the wrong route.
              (() => {
                const allowedRoute = resolutionFor(denialAction);
                const hint =
                  allowedRoute === null
                    ? "Pick a Denial Action above to enable a resolution."
                    : allowedRoute === "Submit Claim"
                      ? "Action requires a new 837. Click Submit Claim to move it to the submit queue."
                      : allowedRoute === "Outstanding"
                        ? "Once you've performed the action, click Outstanding. Resent Date is stamped today and the Late ERA clock restarts."
                        : "Denial is terminal. Bad Debt closes the claim.";
                return (
                  <>
                    <p className="mb-3 text-xs text-muted-foreground">
                      {hint}
                    </p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <DecisionCard
                        tone="info"
                        icon={<Send className="h-5 w-5" />}
                        title="Spawn resubmission"
                        desc="Opens a line picker so you can carry only the denied / partial lines (and tweak units, like A4230 45 → 35). Creates a new claim linked back to this one — original stays put with a thread breadcrumb on the new claim."
                        cta={
                          resubmitBusy
                            ? "Spawning…"
                            : "Pick lines & spawn"
                        }
                        onClick={() => setResubmitOpen(true)}
                        disabled={
                          allowedRoute !== "Submit Claim" ||
                          denialResolveBusy !== null ||
                          resubmitBusy
                        }
                      />
                      <DecisionCard
                        tone="warning"
                        icon={<Clock className="h-5 w-5" />}
                        title="Move back to Outstanding"
                        desc="Action performed (appeal filed, docs uploaded, payer contacted). Park it in Outstanding while the response is in flight. Late ERA clock restarts today."
                        cta={
                          denialResolveBusy === "Outstanding"
                            ? "Moving…"
                            : "Outstanding"
                        }
                        onClick={() => void resolveDenial("Outstanding")}
                        disabled={
                          allowedRoute !== "Outstanding" ||
                          denialResolveBusy !== null
                        }
                      />
                      <DecisionCard
                        tone="danger"
                        icon={<FileWarning className="h-5 w-5" />}
                        title="Write off as Bad Debt"
                        desc="Denial is final and uncollectable. Closes the claim and triggers the Monday write-off automation."
                        cta={
                          denialResolveBusy === "Bad Debt"
                            ? "Writing off…"
                            : "Bad Debt"
                        }
                        onClick={() => void resolveDenial("Bad Debt")}
                        disabled={
                          allowedRoute !== "Bad Debt" ||
                          denialResolveBusy !== null
                        }
                      />
                    </div>
                  </>
                );
              })()
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <DecisionCard
                  tone="success" icon={<CheckCircle2 className="h-5 w-5" />}
                  title="Paid"
                  desc="Primary paid correctly. Remainder is PR or going to secondary."
                  cta="Mark Paid" onClick={openMarkPaid}
                  disabled={linesWithIssues.length > 0}
                />
                <DecisionCard
                  tone="danger" icon={<FileWarning className="h-5 w-5" />}
                  title="Denied / Partial Denial"
                  desc="One or more lines were denied or underpaid. Send to the denial flow."
                  cta="Send to Denial" onClick={saveDenial}
                  disabled={linesWithIssues.length === 0}
                />
                {/* Uploaded Docs — for the "payer asked for medical docs
                    before paying or denying" case. Stamps Late Action
                    Date = today + 14d on Monday and the row drops out
                    of Late ERA until then. Re-clickable; pushes the
                    snooze forward another 14d each time (e.g. if the
                    payer asks for more docs). Operator should drop a
                    note in Action Context above describing what was
                    uploaded. */}
                <DecisionCard
                  tone="info" icon={<FileUp className="h-5 w-5" />}
                  title={
                    isLateEraSnoozedLocal(claim)
                      ? `Docs Sent — snoozed until ${claim.lateActionDate}`
                      : "Uploaded Docs to Payer"
                  }
                  desc={
                    isLateEraSnoozedLocal(claim)
                      ? "Already snoozed. Click again if the payer asked for additional docs — pushes the snooze another 14 days."
                      : "Payer asked for medical docs and we sent them. Snoozes this claim from Late ERA for 14 days."
                  }
                  cta={docsUploadedBusy ? "Saving…" : "Uploaded Docs"}
                  onClick={handleDocsUploaded}
                  disabled={docsUploadedBusy}
                />
              </div>
            )}
            <div className="mt-6 flex items-center justify-between">
              <Button variant="outline" onClick={escalate}>
                <AlertTriangle className="mr-2 h-4 w-4" /> Escalate for review
              </Button>
              <Button variant="ghost" onClick={() => navigate("/claims")}>Back to Queue</Button>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Mark Paid confirmation. Spawns a Secondary item if PR > 0; otherwise
          just flips Primary status to Paid. Idempotent on the backend. */}
      <AlertDialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark fully paid?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">{claim.patientName}</p>
                <p>
                  Secondary:{" "}
                  <span className="font-medium text-foreground">
                    {summarizeSecondary(
                      claim.prAmount,
                      claim.primaryPayor,
                      claim.secondaryPayer,
                      claim.rawEraClaimStatus,
                    )}
                  </span>
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markPaidBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={markPaidBusy}
              onClick={(e) => { e.preventDefault(); void confirmMarkPaid(); }}
            >
              {markPaidBusy ? "Marking…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LineResubmitDialog
        open={resubmitOpen}
        onOpenChange={setResubmitOpen}
        claim={claim}
        initialDenialAction={denialAction}
        busy={resubmitBusy}
        onConfirm={handleResubmitConfirm}
      />
    </div>
  );
};

function SummaryStat({
  label, value, sub, tone = "neutral", badge,
}: {
  label: string; value: string; sub?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  /** Optional pill rendered below the sub line — e.g. "Forwarded". */
  badge?: React.ReactNode;
}) {
  const toneText: Record<typeof tone, string> = {
    neutral: "text-foreground",
    success: "text-success-soft-foreground",
    warning: "text-warning-soft-foreground",
    danger: "text-danger-soft-foreground",
    info: "text-info-soft-foreground",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneText[tone])}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        {badge && <div className="mt-2">{badge}</div>}
      </CardContent>
    </Card>
  );
}

function CodeChip({ code, meaning }: { code: string; meaning: string | null }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] underline decoration-dotted underline-offset-2">
            {code}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="font-medium">{code}</div>
          <div className="text-xs text-muted-foreground">{meaning ?? "No description on file"}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LineRow({
  line, status, onStatusChange,
  eraEditing, eraEdit, onEraFieldChange,
  playbookRows,
}: {
  line: ServiceLine;
  status: LineUserStatus;
  onStatusChange: (s: LineUserStatus) => void;
  /** When true, Paid/Ded/Coins/Copay cells render as Inputs bound to
   *  eraEdit. Save lives on the parent (ClaimDetail), so this component
   *  just emits onEraFieldChange and the parent collects + dispatches. */
  eraEditing?: boolean;
  eraEdit?: {
    primaryPaid: number; deductible: number; coinsurance: number; copay: number;
  };
  onEraFieldChange?: (
    field: "primaryPaid" | "deductible" | "coinsurance" | "copay",
    value: number,
  ) => void;
  /** Live Denial Playbook rows from usePlaybookCombos in the parent.
   *  LineRow is a top-level component (not nested inside ClaimDetail),
   *  so it can't close over the parent's playbookRows variable — we
   *  pass it explicitly. When undefined, carcPlaybookText /
   *  rarcPlaybookText fall back to the bundled UNIQUE_COMBOS snapshot. */
  playbookRows?: readonly PlaybookRowLike[];
}) {
  const [open, setOpen] = useState(false);
  // When editing, use eraEdit values for the live diff so the operator
  // sees totals update as they type. Otherwise the persisted values.
  const editing = !!eraEditing && !!eraEdit;
  const livePaid = editing ? eraEdit.primaryPaid : line.primaryPaid;
  const liveCoinsCopay = editing
    ? eraEdit.coinsurance + eraEdit.copay
    : line.coinsurance + line.copay;
  const liveDed = editing ? eraEdit.deductible : line.deductible;
  const livePr = editing
    ? eraEdit.deductible + eraEdit.coinsurance + eraEdit.copay
    : line.patientResponsibility;
  const diff = line.estPay - livePaid - livePr;
  const diffTone =
    Math.abs(diff) <= 0.5 ? "text-muted-foreground" :
    diff > 0 ? "text-danger-soft-foreground" : "text-info-soft-foreground";

  return (
    <>
      <TableRow className="hover:bg-muted/30">
        <TableCell className="w-8">
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </TableCell>
        <TableCell className="font-medium">{line.product}</TableCell>
        <TableCell className="font-mono text-xs">{line.hcpcs}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {line.modifiers.map((m) => (
              <span key={m} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{m}</span>
            ))}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">{line.units}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtMoney(line.charge)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtMoney(line.estPay)}</TableCell>
        <TableCell className="text-right tabular-nums">
          {editing ? (
            <Input
              type="number" min={0} step={0.01}
              className="h-7 w-24 text-right ml-auto"
              value={eraEdit!.primaryPaid}
              onChange={(e) => onEraFieldChange?.("primaryPaid", Number(e.target.value) || 0)}
            />
          ) : (
            fmtMoney(line.primaryPaid)
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {editing ? (
            <Input
              type="number" min={0} step={0.01}
              className="h-7 w-24 text-right ml-auto"
              value={eraEdit!.deductible}
              onChange={(e) => onEraFieldChange?.("deductible", Number(e.target.value) || 0)}
            />
          ) : (
            fmtMoney(line.deductible)
          )}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {editing ? (
            // Coins/Copay column is normally one merged readonly number;
            // in edit mode we split it into two stacked Inputs so each
            // bucket can be set independently.
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">Co</span>
                <Input
                  type="number" min={0} step={0.01}
                  className="h-6 w-20 text-right"
                  value={eraEdit!.coinsurance}
                  onChange={(e) => onEraFieldChange?.("coinsurance", Number(e.target.value) || 0)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] uppercase text-muted-foreground">Cp</span>
                <Input
                  type="number" min={0} step={0.01}
                  className="h-6 w-20 text-right"
                  value={eraEdit!.copay}
                  onChange={(e) => onEraFieldChange?.("copay", Number(e.target.value) || 0)}
                />
              </div>
            </div>
          ) : (
            fmtMoney(liveCoinsCopay)
          )}
        </TableCell>
        <TableCell className={cn("text-right tabular-nums", diffTone)}>{fmtMoney(diff)}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {line.carc.length === 0 && line.rarc.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <>
                {line.carc.map((c) => {
                  const code = `CO-${c}`;
                  return (
                    <CodeChip
                      key={`c${c}`}
                      code={code}
                      meaning={carcPlaybookText(c, playbookRows) ?? carcMeaning(c)}
                    />
                  );
                })}
                {line.rarc.map((r) => (
                  <CodeChip key={`r${r}`} code={r} meaning={rarcPlaybookText(r, playbookRows)} />
                ))}
              </>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Select value={status} onValueChange={(v) => onStatusChange(v as LineUserStatus)}>
            <SelectTrigger
              className={cn(
                "h-8 w-[130px] font-medium",
                status === "Paid" && "bg-success-soft text-success-soft-foreground border-success-soft",
                status === "Underpaid" && "bg-warning-soft text-warning-soft-foreground border-warning-soft",
                status === "Denied" && "bg-danger-soft text-danger-soft-foreground border-danger-soft",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Underpaid">Underpaid</SelectItem>
              <SelectItem value="Denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30">
          <TableCell />
          <TableCell colSpan={12} className="py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
              <Detail label="Allowed" value={fmtMoney(line.allowed)} />
              <Detail label="CO Amount" value={fmtMoney(line.coAmount)} />
              <Detail label="PR Amount" value={fmtMoney(line.prAmount)} />
              <Detail label="OA Amount" value={fmtMoney(line.oaAmount)} />
              <Detail label="PI Amount" value={fmtMoney(line.piAmount)} />
              <Detail label="Copay" value={fmtMoney(line.copay)} />
              <Detail label="Coinsurance" value={fmtMoney(line.coinsurance)} />
              <Detail label="Patient Resp." value={fmtMoney(line.patientResponsibility)} />
            </div>
            {(line.adjustmentReasons.length || line.remarkText.length) > 0 && (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {line.adjustmentReasons.map((r, i) => <div key={`a${i}`}>• {r}</div>)}
                {line.remarkText.map((r, i) => <div key={`r${i}`}>• {r}</div>)}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function DecisionCard({
  tone, icon, title, desc, cta, onClick, disabled,
}: {
  tone: "success" | "danger" | "warning" | "info" | "neutral";
  icon: React.ReactNode; title: string; desc: string; cta: string;
  onClick: () => void; disabled?: boolean;
}) {
  const toneBg: Record<typeof tone, string> = {
    success: "bg-success-soft text-success-soft-foreground",
    danger: "bg-danger-soft text-danger-soft-foreground",
    warning: "bg-warning-soft text-warning-soft-foreground",
    info: "bg-info-soft text-info-soft-foreground",
    neutral: "bg-neutral-soft text-neutral-soft-foreground",
  };
  const cardTone: Record<typeof tone, string> = {
    success: "bg-success-soft/40 border-success-soft-foreground/30",
    danger: "bg-danger-soft/40 border-danger-soft-foreground/30",
    warning: "bg-warning-soft/40 border-warning-soft-foreground/30",
    info: "bg-info-soft/40 border-info-soft-foreground/30",
    neutral: "bg-background",
  };
  const ctaTone: Record<typeof tone, string> = {
    success: "bg-success-soft-foreground text-white hover:bg-success-soft-foreground/90",
    danger: "bg-danger-soft-foreground text-white hover:bg-danger-soft-foreground/90",
    warning: "",
    info: "",
    neutral: "",
  };
  return (
    <div className={cn("rounded-lg border p-4 flex flex-col gap-3", cardTone[tone], disabled && "opacity-50")}>
      <div className="flex items-center gap-2">
        <div className={cn("grid h-8 w-8 place-items-center rounded-md", toneBg[tone])}>{icon}</div>
        <div className="font-medium">{title}</div>
      </div>
      <p className="text-xs text-muted-foreground flex-1">{desc}</p>
      <Button
        size="sm"
        variant={tone === "neutral" ? "outline" : "default"}
        className={cn(ctaTone[tone])}
        onClick={onClick}
        disabled={disabled}
      >
        {cta}
      </Button>
    </div>
  );
}

/**
 * ThreadBreadcrumb — surfaces the resubmission lineage above ClaimDetail.
 *
 * Walks the parent chain up to the root via parentClaimItemId, then walks
 * children down via the reverse index. Renders nothing when the claim has
 * no parent AND no children (the common case — most claims are standalone
 * originals).
 *
 * The component is intentionally a flat horizontal list, not a tree.
 * Each resubmission is "one child per parent" by design (the operator
 * runs the dialog twice if they want two siblings), so the lineage is a
 * straight line: Original → Corrected #1 → Corrected #2 → ...
 *
 * Hooks into useAllClaims's full set (not the bucket-filtered MOCK_CLAIMS)
 * so it can resolve children sitting in Submit Claim status that the
 * Primary Board hides from active views.
 */
function ThreadBreadcrumb({
  claim,
  allClaims,
}: {
  claim: Claim;
  allClaims: Claim[];
}) {
  // No lineage to draw → render nothing.
  if (!claim.parentClaimItemId && !claim.hasChildren) return null;

  // Build the chain by walking up parents, then back down to the latest
  // descendant. Guards against cycles by tracking visited ids.
  const chain: Claim[] = [];
  const byId = new Map(allClaims.map((c) => [c.mondayItemId, c]));
  const seen = new Set<string>();

  // Walk up to root
  let cursor: Claim | undefined = claim;
  while (cursor && !seen.has(cursor.mondayItemId)) {
    chain.unshift(cursor);
    seen.add(cursor.mondayItemId);
    cursor = cursor.parentClaimItemId
      ? byId.get(cursor.parentClaimItemId)
      : undefined;
  }
  // Walk down to leaves
  let last = chain[chain.length - 1];
  while (last) {
    const child = allClaims.find(
      (c) => c.parentClaimItemId === last.mondayItemId && !seen.has(c.mondayItemId),
    );
    if (!child) break;
    chain.push(child);
    seen.add(child.mondayItemId);
    last = child;
  }

  if (chain.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <span className="mr-2 font-semibold uppercase tracking-wide text-muted-foreground">
        Thread
      </span>
      {chain.map((c, i) => {
        const isCurrent = c.mondayItemId === claim.mondayItemId;
        const isOriginal = !c.parentClaimItemId;
        const label = isOriginal
          ? "Original"
          : c.claimType === "Corrected"
            ? `Corrected #${i}`
            : `Resubmission #${i}`;
        return (
          <span key={c.mondayItemId} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            {isCurrent ? (
              <span className="rounded bg-foreground/10 px-2 py-0.5 font-medium">
                {label} · {fmtDate(c.dos)}
                {c.primaryStatus !== "Submit Claim" && (
                  <span className="ml-1 text-muted-foreground">
                    ({c.primaryStatus})
                  </span>
                )}
              </span>
            ) : (
              <Link
                to={`/claims/${c.mondayItemId}`}
                className="rounded px-2 py-0.5 hover:bg-foreground/10 hover:underline"
              >
                {label} · {fmtDate(c.dos)}
                <span className="ml-1 text-muted-foreground">
                  ({c.primaryStatus})
                </span>
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default ClaimDetail;
