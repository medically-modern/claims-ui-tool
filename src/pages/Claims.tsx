import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "@/components/claims/AppHeader";
import {
  ClaimStatusBadge,
  PrimaryStatusBadge,
  StatusBadge,
  Status277Badge,
} from "@/components/claims/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MOCK_CLAIMS as MOCK_CLAIMS_FALLBACK } from "@/lib/claims/mockData";
import { useAllClaims, ALL_CLAIMS_QUERY_KEY } from "@/hooks/useAllClaims";
import { useQueryClient } from "@tanstack/react-query";
import {
  addProcessing as addMarkPaidProcessing,
  removeProcessing as removeMarkPaidProcessing,
  getAllProcessing as getAllMarkPaidProcessing,
} from "@/lib/markPaidProcessing";
import { useAllSecondaryClaims } from "@/hooks/useAllSecondaryClaims";
import { hasMondayToken } from "@/api/monday";
import { LoadingOverlay } from "@/components/claims/LoadingOverlay";
import { CashFlowSummary } from "@/components/claims/CashFlowSummary";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  markPrimaryPaid as apiMarkPrimaryPaid,
  isMarkPaidConfigured,
  isForwardedByPrimary,
  hasReversalInEra,
  MarkPaidError,
  secondaryItemUrl,
  summarizeSecondary,
} from "@/api/markPaid";
import {
  runClaimStatusCheck as apiRunClaimStatusCheck,
  isClaimStatusCheckConfigured,
  ClaimStatusError,
  type ClaimStatusWriteback,
} from "@/api/runClaimStatusCheck";
import {
  claimAge, eraReceived, fmtDate, fmtMoney, lateEraThresholdDays,
  isLateEraSnoozed,
  priorityOf, shortIssue, variance,
} from "@/lib/claims/logic";
import type { Claim } from "@/lib/claims/types";
import { sendToDenial, isSendToDenialConfigured, SendToDenialError } from "@/api/sendToDenial";
import { snoozeLateEra, isSnoozeLateEraConfigured, SnoozeLateEraError } from "@/api/snoozeLateEra";
import { ActionItemsInbox } from "@/components/claims/ActionItemsInbox";
import {
  AlertTriangle, ArrowRight, Check, Clock, FileJson, FileSearch, MoreHorizontal, RefreshCw, Search, Send, Wallet, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import type { ServiceLine } from "@/lib/claims/types";
import { DenialAnalysisTable } from "@/components/claims/DenialAnalysisTable";
import { EftEnrollmentTable } from "@/components/claims/EftEnrollmentTable";
import { SubscriptionBoard } from "@/components/subscription/SubscriptionBoard";
import { PrimarySubmitBoard } from "@/components/claims/PrimarySubmitBoard";
import { SecondaryBoard } from "@/components/claims/SecondaryBoard";
import { useThreadClaims } from "@/lib/claims/threadStore";
import { findThreadClaimForMockClaim, getChildClaims, getRootClaim } from "@/lib/claims/threads";
import { ThreadPanel } from "@/components/claims/ThreadPanel";

function lineDenialState(l: ServiceLine): "paid" | "partial" | "denied" {
  if (l.primaryPaid <= 0) return "denied";
  if (l.primaryPaid + 5 < l.estPay) return "partial";
  return "paid";
}

const PRODUCT_ABBR: Record<string, string> = {
  "Insulin Pump": "Pump",
  "Cartridge": "Cartridges",
  "Cartridges": "Cartridges",
  "Infusion Set": "Infusion sets",
  "Infusion Sets": "Infusion sets",
  "CGM Monitor": "Monitor",
  "CGM Sensors": "Sensors",
};
function productAbbr(name: string): string {
  return PRODUCT_ABBR[name] ?? name;
}

const HCPCS_BY_LABEL: Record<string, string> = {
  "Monitor": "E2103",
  "Pump": "E0784",
  "Sensors": "A4239",
  "Infusion sets": "A4230",
  "Cartridges": "A4232",
};
function hcpcsForProduct(name: string): string | undefined {
  return HCPCS_BY_LABEL[productAbbr(name)];
}

const PRODUCT_ROW: Record<string, 0 | 1> = {
  "Pump": 0,
  "Infusion sets": 0,
  "Cartridges": 0,
  "Monitor": 1,
  "Sensors": 1,
};
function groupProductRows<T extends { product: string }>(items: T[]): [T[], T[]] {
  const r0: T[] = [];
  const r1: T[] = [];
  for (const it of items) {
    const label = productAbbr(it.product);
    if (PRODUCT_ROW[label] === 1) r1.push(it);
    else r0.push(it);
  }
  return [r0, r1];
}

type BoardKey = "primary" | "secondary" | "cashflow" | "playbook" | "eft";
type ModeKey = "submit" | "review";
type CategoryKey = "era" | "late" | "denied" | "outstanding" | "paid" | "all";

// Medicaid Outstanding group (= "Paid but didn't hit bank yet"). Claims
// living here have been pre-filled with projected eMedNY values on 837
// submission (Primary Paid + Primary Paid Date) but have NO real ERA
// yet — the operator shouldn't review them until the actual 835 lands
// and overwrites the projection with real numbers.
const MEDICAID_OUTSTANDING_GROUP_ID = "group_mm332zns";

function inEraReview(c: Claim) {
  // Replaced parents drop out — the child carries any active review.
  if (c.hasChildren) return false;
  // Skip Medicaid pre-fills sitting in Medicaid Outstanding. They look
  // like ERA Review (status=Review + primaryPaid>0 + primaryPaidDate set)
  // because the pre-fill writes those projected values, but there's
  // nothing for the operator to review until the real ERA arrives.
  if (c.groupId === MEDICAID_OUTSTANDING_GROUP_ID) return false;
  return eraReceived(c) && c.primaryStatus === "Review";
}

type StatusCheckResult =
  | "Acknowledged" | "Pending" | "In Process" | "Paid"
  | "Denied" | "Requests Info" | "No Match" | "Error";

const STATUS_CHECK_OPTIONS: StatusCheckResult[] = [
  "Acknowledged", "Pending", "In Process", "Paid", "Denied", "Requests Info", "No Match", "Error",
];

type TriageRec = "keep" | "denial";
const STATUS_CHECK_META: Record<StatusCheckResult, { tone: string; recommend: TriageRec }> = {
  "Acknowledged":   { tone: "bg-muted text-foreground",                       recommend: "keep" },
  "Pending":        { tone: "bg-muted text-foreground",                       recommend: "keep" },
  "In Process":     { tone: "bg-info-soft text-info-soft-foreground",         recommend: "keep" },
  "Paid":           { tone: "bg-success-soft text-success-soft-foreground",   recommend: "keep" },
  "Denied":         { tone: "bg-danger-soft text-danger-soft-foreground",     recommend: "denial" },
  "Requests Info":  { tone: "bg-warning-soft text-warning-soft-foreground",   recommend: "denial" },
  "No Match":       { tone: "bg-warning-soft text-warning-soft-foreground",   recommend: "denial" },
  "Error":          { tone: "bg-danger-soft text-danger-soft-foreground",     recommend: "denial" },
};

interface StatusCheckRecord {
  status: StatusCheckResult;
  checkedAt: string;
  payerClaimNumber?: string;
  detail?: string;
  statusCode?: string;
  statusDescription?: string;
  categoryCode?: string;
  categoryDescription?: string;
  effectiveDate?: string;
  paidAmount?: number;
  checkNumber?: string;
  paidDate?: string;
  multipleMatch?: boolean;
  rawError?: string;
}

function generateStatusCheck(c: Claim, status: StatusCheckResult): StatusCheckRecord {
  const base: StatusCheckRecord = {
    status,
    checkedAt: new Date().toISOString(),
    payerClaimNumber: c.payerClaimNumber ?? `PCN-${c.claimId.slice(-6)}`,
    effectiveDate: new Date().toISOString(),
  };
  switch (status) {
    case "Paid":
      return { ...base, statusCode: "F1", statusDescription: "Finalized/Payment",
        categoryCode: "F1", categoryDescription: "Finalized - claim adjudicated and final payment forthcoming.",
        detail: "Payer reports payment issued; ERA not yet received.",
        paidAmount: c.estPay || 980, checkNumber: "EFT-" + Math.floor(100000 + Math.random()*900000), paidDate: new Date().toISOString() };
    case "Denied":
      return { ...base, statusCode: "F2", statusDescription: "Finalized/Denial",
        categoryCode: "F2", categoryDescription: "Finalized - no payment forthcoming.",
        detail: "Service not covered under member's plan." };
    case "Requests Info":
      return { ...base, statusCode: "P5", statusDescription: "Pending/Payer Review",
        categoryCode: "P", categoryDescription: "Pending", detail: "Additional documentation required to adjudicate." };
    case "In Process":
      return { ...base, statusCode: "A2", statusDescription: "Acknowledgement/Acceptance into adjudication",
        categoryCode: "A", categoryDescription: "Acknowledgement", detail: "Claim is being adjudicated." };
    case "Acknowledged":
      return { ...base, statusCode: "A1", statusDescription: "Acknowledgement/Receipt",
        categoryCode: "A", categoryDescription: "Acknowledgement", detail: "Claim received by payer." };
    case "Pending":
      return { ...base, statusCode: "P0", statusDescription: "Pending",
        categoryCode: "P", categoryDescription: "Pending", detail: "Claim pending payer processing." };
    case "No Match":
      return { ...base, statusCode: "E0", statusDescription: "Response not possible - data not found",
        categoryCode: "E", categoryDescription: "Response not possible",
        detail: "Payer could not locate the claim with submitted criteria.", multipleMatch: false, payerClaimNumber: undefined };
    case "Error":
      return { ...base, statusCode: "E1", statusDescription: "Request error",
        categoryCode: "E", categoryDescription: "Error",
        detail: "Status check request failed.", rawError: "AAA*Y*42*Unable to respond at current time" };
  }
}
/**
 * Build a StatusCheckRecord from the claim's persisted Monday columns
 * (Claim Status Category, Detail, Last Claim Status Check, Payer Claim
 * Number, 277 Paid Amount). Returns null when the claim has never been
 * status-checked.
 *
 * This is the persistence layer for the popover. The in-memory
 * statusChecks map is only used to flip the UI instantly after a run;
 * on page refresh the row reads through to Monday via this function.
 */
function statusCheckFromClaim(c: Claim): StatusCheckRecord | null {
  if (!c.claimStatusCategory && !c.lastClaimStatusCheck) return null;
  const cat = c.claimStatusCategory;
  const label: StatusCheckResult = (
    cat &&
    (STATUS_CHECK_OPTIONS as readonly string[]).includes(cat)
  )
    ? (cat as StatusCheckResult)
    : "Error";
  return {
    status: label,
    checkedAt: c.lastClaimStatusCheck ?? new Date().toISOString(),
    payerClaimNumber: c.payerClaimNumber ?? undefined,
    detail: c.claimStatusDetail ?? undefined,
    statusDescription: c.claimStatusDetail ?? undefined,
    paidAmount: c.claimStatusPaidAmount ?? undefined,
  };
}

/**
 * Convert the backend's claim-status writeback dict into the local
 * StatusCheckRecord shape the popover renders.
 */
function recordFromWriteback(
  c: Claim,
  wb: ClaimStatusWriteback,
): StatusCheckRecord {
  const labelRaw = wb["Claim Status Category"] || "";
  const label = (
    STATUS_CHECK_OPTIONS as readonly string[]
  ).includes(labelRaw)
    ? (labelRaw as StatusCheckResult)
    : "Error";

  const rec: StatusCheckRecord = {
    status: label,
    checkedAt: wb["Last Claim Status Check"] || new Date().toISOString(),
    payerClaimNumber:
      wb["277 ICN"] || c.payerClaimNumber || undefined,
    detail: wb["Claim Status Detail"] || undefined,
    statusCode: wb._status_code || undefined,
    statusDescription: wb["Claim Status Detail"] || undefined,
    categoryCode: wb._category_code || undefined,
    paidAmount: wb["277 Paid Amount"],
    checkNumber: wb._check_number || undefined,
    paidDate: wb._paid_date || undefined,
    rawError: wb._failure_reason || undefined,
  };
  return rec;
}

function inLateEra(c: Claim) {
  // "Late ERAs" = submitted long enough ago that we should be hearing
  // back, with no ERA yet. claimAge uses effective sent date (= max of
  // Claim Sent Date / Claim Resent Date) so freshly-resent claims reset
  // the clock. Threshold is per-claim: Appeals get 60 days (payers
  // commonly take 30-45 to respond to a clean appeal); everything else
  // uses 21 days to match Cash Flow's High Risk bucket.
  //
  // Parents with children fall out — the child is the active claim, the
  // parent is historical lineage only.
  //
  // Snoozed claims STAY in the bucket. The Late ERA view splits them
  // into a "Snoozed" sub-tab (see lateSubTab) so the operator can see
  // which rows they've already checked vs which need action now. The
  // snooze window is shared with the Uploaded Docs flow — both reasons
  // push Late Action Date forward and land the row in the Snoozed tab.
  if (c.hasChildren) return false;
  const age = claimAge(c) ?? 0;
  const excluded = ["Paid", "Denied (Or Partly)", "Bad Debt", "Request Rejected"];
  return Boolean(c.claimSentDate) && !eraReceived(c)
      && age >= lateEraThresholdDays(c)
      && !excluded.includes(c.primaryStatus);
}
function inDenied(c: Claim) {
  // Hide parents that have been replaced by a corrected/new claim — the
  // child is now where the active denial work happens.
  if (c.hasChildren) return false;
  return c.primaryStatus === "Denied (Or Partly)";
}
function inOutstanding(c: Claim) {
  // Open primary work that isn't already in ERA Review / Late ERAs / Denials
  if (c.hasChildren) return false;
  if (c.primaryStatus === "Paid" || c.primaryStatus === "Bad Debt") return false;
  // Medicaid Outstanding ("Paid but didn't hit bank yet") rows have
  // status=Review (auto pre-fill) but there's nothing for the operator
  // to act on — they're just waiting on the eMedNY EFT to land. Route
  // them to Paid instead so they don't pile up in Outstanding.
  if (c.groupId === MEDICAID_OUTSTANDING_GROUP_ID) return false;
  if (inEraReview(c) || inLateEra(c) || inDenied(c)) return false;
  return true;
}
function inPaid(c: Claim) {
  if (c.primaryStatus === "Paid") return true;
  // Medicaid pre-fill rows sit in group_mm332zns awaiting the EFT —
  // visually grouped under Paid since the primary's done its job. The
  // Cash Flow tile tracks the timing separately via primaryPaidDate.
  if (c.groupId === MEDICAID_OUTSTANDING_GROUP_ID) return true;
  return false;
}
function inAllOpen(c: Claim) {
  // Union of the four named bucket predicates so the All Open count
  // equals ERA Review + Late + Denials + Outstanding exactly. The
  // previous version was "anything that isn't Paid or Bad Debt" which
  // also caught hasChildren parents (replaced by Corrected/New child)
  // and the Medicaid Outstanding group (paid-but-not-EFT'd) — both
  // intentionally hidden from the four action tiles, both showing up
  // as a confusing 77-claim delta on the Primary Board summary.
  return inEraReview(c) || inLateEra(c) || inDenied(c) || inOutstanding(c);
}

const CATEGORY_FILTERS: Record<CategoryKey, (c: Claim) => boolean> = {
  era: inEraReview,
  late: inLateEra,
  denied: inDenied,
  outstanding: inOutstanding,
  paid: inPaid,
  
  all: inAllOpen,
};

function rowCta(c: Claim): string {
  if (inEraReview(c)) return "Review ERA";
  if (inDenied(c)) return "Work Denial";
  if (inLateEra(c)) return "Run Status Check";
  return "Open Claim";
}

type ColumnKey =
  | "patient" | "dos" | "products" | "payer" | "sent" | "age"
  | "primary" | "s277" | "claimStatus" | "claimStatusLate"
  | "estPay" | "paid" | "pr" | "difference"
  | "issue" | "nextAction" | "action";

const CATEGORY_COLUMNS: Record<CategoryKey, ColumnKey[]> = {
  era:        ["patient", "dos", "products", "payer", "estPay", "paid", "pr", "difference", "action"],
  late:       ["patient", "dos", "products", "payer", "sent", "age", "s277", "estPay", "paid", "pr", "claimStatusLate"],
  denied:     ["patient", "dos", "products", "payer", "sent", "age", "estPay", "paid", "pr", "difference", "action"],
  outstanding:["patient", "dos", "products", "payer", "sent", "age", "s277", "estPay", "paid", "pr", "action"],
  paid:       ["patient", "dos", "products", "payer", "sent", "estPay", "paid", "pr", "difference", "action"],
  
  all:        ["patient", "dos", "products", "payer", "sent", "age", "primary", "s277", "claimStatus", "estPay", "paid", "pr", "difference", "issue", "nextAction", "action"],
};

const COLUMN_LABELS: Record<ColumnKey, { label: string; align?: "right" }> = {
  patient: { label: "Patient" },
  dos: { label: "DOS" },
  products: { label: "Products" },
  payer: { label: "Primary Payor" },
  sent: { label: "Sent" },
  age: { label: "Age" },
  primary: { label: "Primary" },
  s277: { label: "277" },
  claimStatus: { label: "Claim Status" },
  claimStatusLate: { label: "Claim Status" },
  estPay: { label: "Est. Pay", align: "right" },
  paid: { label: "Paid", align: "right" },
  pr: { label: "PR", align: "right" },
  difference: { label: "Difference", align: "right" },
  issue: { label: "Issue" },
  nextAction: { label: "Next Action" },
  action: { label: "Action", align: "right" },
};

function diff(c: Claim) {
  return c.estPay - c.primaryPaid - c.prAmount;
}

// Columns that don't have a meaningful sort order (mixed content,
// action buttons, free-text reasoning). Header stays a static label.
const NON_SORTABLE_COLUMNS: ReadonlySet<ColumnKey> = new Set([
  "products",
  "issue",
  "nextAction",
  "action",
]);

// Extract a comparable value per column. Strings sort case-insensitively
// (the comparator below lowercases on the way in), numbers sort numerically,
// dates sort by parsed timestamp. Anything blank or null sinks to the
// bottom regardless of direction so empty cells don't clutter either end.
function sortValueFor(col: ColumnKey, c: Claim): number | string | null {
  switch (col) {
    case "patient":         return c.patientName || "";
    case "dos":             return c.dos || null;
    case "payer":           return c.primaryPayor || "";
    case "sent":            return c.claimSentDate || c.claimResentDate || null;
    case "age":             return claimAge(c) ?? null;
    case "primary":         return c.primaryStatus || "";
    case "s277":            return c.status277 || "";
    case "claimStatus":     return c.claimStatusCategory || "";
    case "claimStatusLate": return c.claimStatusCategory || "";
    case "estPay":          return c.estPay ?? 0;
    case "paid":            return c.primaryPaid ?? 0;
    case "pr":              return c.prAmount ?? 0;
    case "difference":      return diff(c);
    default:                return null;
  }
}

function compareRows(a: Claim, b: Claim, col: ColumnKey, dir: "asc" | "desc"): number {
  const va = sortValueFor(col, a);
  const vb = sortValueFor(col, b);
  // Nulls (missing values) always sink to the bottom — independent of dir
  // so flipping asc/desc never makes the blank cells jump to the top.
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  let cmp = 0;
  if (typeof va === "number" && typeof vb === "number") {
    cmp = va - vb;
  } else {
    cmp = String(va).toLowerCase().localeCompare(String(vb).toLowerCase());
  }
  return dir === "asc" ? cmp : -cmp;
}


const Claims = () => {
  const [topLevel, setTopLevel] = useState<"claims" | "subscription">("claims");
  const [board, setBoard] = useState<BoardKey>("primary");
  const [mode, setMode] = useState<ModeKey>("review");
  const [category, setCategory] = useState<CategoryKey>("era");
  // Action Items inbox deep-link target. Reset each chip click so the
  // child useEffect re-applies even on repeated clicks of the same chip
  // (useEffect deps watch the object reference, not the value).
  const [inboxNavTo, setInboxNavTo] = useState<{
    primaryQueue?: "new" | "resubmit" | "awaiting";
    secondaryBucket?:
      | "confirm"
      | "insurance"
      | "patient"
      | "awaiting"
      | "outstandingClaims"
      | "outstandingInvoices"
      | "eraReview"
      | "invoiceReview"
      | "paid";
    eftStatus?: "all" | "not-started" | "submitted" | "accepted" | "rejected";
  } | null>(null);
  // Sub-tab within the Late ERA bucket. "check" = needs an active claim
  // status check (lateActionDate null or in the past). "snoozed" = the
  // operator already checked it (or uploaded docs) and pushed the
  // next-check date forward; row sits here until that date elapses.
  // Snoozed rows return to "check" automatically once today >= the
  // snooze date — no Monday write required for the transition.
  const [lateSubTab, setLateSubTab] = useState<"check" | "snoozed">("check");
  const [search, setSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Column-header sort. null col = source order (default). Three-state
  // cycle: asc -> desc -> null on repeated clicks of the same header.
  // Cleared on category change so each bucket starts back at source order.
  const [sort, setSort] = useState<{ col: ColumnKey | null; dir: "asc" | "desc" }>(
    { col: null, dir: "asc" },
  );
  useEffect(() => {
    setSort({ col: null, dir: "asc" });
  }, [category]);
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const { claims: threadClaims } = useThreadClaims();
  // Direct cache access — needed for the poll-while-processing loop
  // below. invalidate + refetchQueries on the shared key forces a
  // fresh fetch and notifies every subscriber including this page.
  const queryClient = useQueryClient();

  // Real claims from Monday (the Primary Board's data source). Fall back to
  // mock data when no Monday token is configured so local dev still works.
  //
  // The hook returns ALL claims (including pre-submission statuses) so that
  // thread breadcrumbs in ClaimDetail can resolve freshly-spawned children
  // sitting in Submit Claim. Pre-submission rows are filtered out HERE for
  // the Primary Board's bucket views.
  const { data: mondayClaims, isFetching: claimsLoading, refetch: refetchClaims } =
    useAllClaims();
  const preSubmissionStatuses: Claim["primaryStatus"][] = [
    "Submit Claim", "Future Claim", "Not Started Yet",
  ];
  const MOCK_CLAIMS = hasMondayToken()
    ? (mondayClaims ?? []).filter(
        (c) => !preSubmissionStatuses.includes(c.primaryStatus),
      )
    : MOCK_CLAIMS_FALLBACK;

  // CashFlow needs the full set — "Future Claim" rows are filtered out
  // of MOCK_CLAIMS above (operational buckets like Outstanding / Denials
  // shouldn't show them), but the Future Medicare Pumps tile depends on
  // them being present. Pass the unfiltered list to the cash flow view.
  const ALL_CLAIMS_FOR_CASHFLOW = hasMondayToken()
    ? (mondayClaims ?? [])
    : MOCK_CLAIMS_FALLBACK;

  // Secondary claims — feed into the Cash Flow tile so Soon/Expected
  // include the secondary side. Empty array when token missing.
  const { data: secondaryClaims } = useAllSecondaryClaims();

  // ─── Run Status Check wiring ──────────────────────────────────────────────
  // Per-row in-flight flag so the button can show a spinner while the 276/277
  // round-trip runs through the backend.
  const [statusCheckBusy, setStatusCheckBusy] = useState<Record<string, boolean>>({});

  async function runStatusCheckForRow(c: Claim) {
    if (statusCheckBusy[c.id]) return;
    if (!isClaimStatusCheckConfigured()) {
      toast({
        title: "Status check not wired",
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }
    setStatusCheckBusy((p) => ({ ...p, [c.id]: true }));
    try {
      const wb = await apiRunClaimStatusCheck(c.mondayItemId);
      const rec = recordFromWriteback(c, wb);
      setStatusChecks((p) => ({ ...p, [c.id]: rec }));
      toast({
        title: `Status check: ${rec.status}`,
        description: c.patientName,
      });
      // Re-fetch claims so the Monday-written columns (Claim Status
      // Category, Last Claim Status Check, 277 ICN, 277 Paid Amount,
      // etc.) flow back into the table.
      void refetchClaims();
    } catch (e) {
      const msg = e instanceof ClaimStatusError ? e.message : (e as Error).message;
      toast({ title: "Status check failed", description: msg });
    } finally {
      setStatusCheckBusy((p) => ({ ...p, [c.id]: false }));
    }
  }

  // ─── Row-level Mark Paid wiring ──────────────────────────────────────────
  // The check-mark icon on each row in the table now actually calls the
  // backend (POST /claims/mark-paid) instead of just toasting. We track
  // which claim is being confirmed and whether the request is in flight.
  const [markPaidTarget, setMarkPaidTarget] = useState<Claim | null>(null);
  const [markPaidBusy, setMarkPaidBusy] = useState(false);

  // Per-row "marking paid" state. After confirm fires, the backend
  // returns in ~1-2s but the Monday status propagation + our React Query
  // refetch take another few seconds before the row actually drops out
  // of the ERA Review bucket. Operator needs continuous visual feedback
  // ("we're still working on this") until the row actually disappears.
  //
  // Loading state is keyed off claim id and persists until the claim is
  // no longer in the active list — useEffect below sweeps the dict each
  // render to drop ids that have already left the load. So the spinner
  // is gone exactly when the row is, never earlier.
  // Initial state seeds from sessionStorage so the chip shows up when
  // the operator navigates here from ClaimDetail after a detail-view
  // Mark Paid. Without seeding, the page would mount with an empty
  // processing dict and the row would look untouched.
  const [markPaidProcessing, setMarkPaidProcessing] = useState<Record<string, boolean>>(
    () => {
      const persisted = getAllMarkPaidProcessing();
      const out: Record<string, boolean> = {};
      for (const id of Object.keys(persisted)) out[id] = true;
      return out;
    },
  );

  function startMarkPaidProcessing(claimId: string) {
    setMarkPaidProcessing((p) => ({ ...p, [claimId]: true }));
    // Also persist so the chip survives navigation to/from ClaimDetail.
    addMarkPaidProcessing(claimId);
    // Safety net — 45s hard timeout. If Monday's response cache or
    // anything else upstream is holding stale "Review" status past
    // the normal propagation window, drop the spinner so the operator
    // can move on. The claim is almost certainly already Paid on
    // Monday by this point; refresh the page to confirm.
    window.setTimeout(() => {
      setMarkPaidProcessing((p) => {
        if (!p[claimId]) return p;
        const next = { ...p };
        delete next[claimId];
        return next;
      });
      removeMarkPaidProcessing(claimId);
    }, 45000);
  }

  // Drop processing ids once the claim's Primary Status is no longer
  // "Review" — i.e. Mark Paid actually took effect on Monday and our
  // refetch has noticed. We can't key off "claim disappeared from the
  // list" because fetchAllClaims returns every claim regardless of
  // status; only the bucket filter (inEraReview) hides it.
  //
  // Status set that ends Mark Paid processing: anything that's NOT
  // Review. Paid is the happy path; Denied / Bad Debt / Review-flipped-
  // back-by-the-operator all count as "done processing" too.
  const claimStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of mondayClaims ?? []) m.set(c.id, c.primaryStatus);
    return m;
  }, [mondayClaims]);
  useEffect(() => {
    setMarkPaidProcessing((p) => {
      let dirty = false;
      const next = { ...p };
      for (const id of Object.keys(next)) {
        const status = claimStatusById.get(id);
        // Status === undefined means the claim is fully gone from the
        // load (rare but possible — also clear). Otherwise clear when
        // Mark Paid landed and the row is no longer in Review.
        if (status === undefined || status !== "Review") {
          delete next[id];
          removeMarkPaidProcessing(id);
          dirty = true;
        }
      }
      return dirty ? next : p;
    });
  }, [claimStatusById]);

  // While anything is processing, re-fire the Monday refetch every 3s.
  // We use queryClient.invalidateQueries + refetchQueries instead of
  // refetchClaims() directly because:
  //   (a) invalidate marks the cache stale so any other subscriber
  //       (e.g. ClaimDetail mounted elsewhere) also re-fetches
  //   (b) refetchQueries bypasses React Query's structural-sharing
  //       optimization that can return the same object reference when
  //       it thinks data is unchanged — that was leaving claimStatusById
  //       pointing at the old status dict so the cleanup useEffect
  //       didn't re-run.
  const anyProcessing = Object.keys(markPaidProcessing).length > 0;
  useEffect(() => {
    if (!anyProcessing) return;
    const tick = () => {
      void queryClient.invalidateQueries({ queryKey: ALL_CLAIMS_QUERY_KEY });
      void queryClient.refetchQueries({ queryKey: ALL_CLAIMS_QUERY_KEY });
    };
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [anyProcessing, queryClient]);

  // Send to Denial — row-level button on the ERA Review bucket. Calls the
  // backend which flips Primary Status to "Denied (Or Partly)" AND writes
  // the Subscription Board's Primary Claim Paid? column to Denied (when
  // every line paid $0) or Partial (at least one line paid > 0).
  // Tracks the in-flight row so the icon can disable while writing.
  // Tracks per-row in-flight Keep Outstanding presses. Mirrors
  // sendDenialBusy below — same map shape, same disabled+opacity pattern
  // on the button. Cleared in the finally block whether the snooze
  // landed or threw.
  const [keepOutstandingBusy, setKeepOutstandingBusy] =
    useState<Record<string, boolean>>({});

  async function keepOutstandingForRow(c: Claim) {
    if (keepOutstandingBusy[c.id]) return;
    if (!isSnoozeLateEraConfigured()) {
      toast({
        title: "Keep Outstanding not configured",
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }
    setKeepOutstandingBusy((p) => ({ ...p, [c.id]: true }));
    try {
      const res = await snoozeLateEra(c.mondayItemId);
      toast({
        title: `Kept Outstanding: ${c.patientName}`,
        description:
          `Snoozed until ${res.snoozed_until} (10 days). ` +
          `Returns to Check Status automatically.`,
      });
      void refetchClaims();
    } catch (e) {
      const msg = e instanceof SnoozeLateEraError ? e.message : (e as Error).message;
      toast({ title: "Couldn't snooze row", description: msg });
    } finally {
      setKeepOutstandingBusy((p) => ({ ...p, [c.id]: false }));
    }
  }

  const [sendDenialBusy, setSendDenialBusy] = useState<Record<string, boolean>>({});
  async function sendToDenialForRow(c: Claim) {
    if (sendDenialBusy[c.id]) return;
    if (!isSendToDenialConfigured()) {
      toast({
        title: "Send to Denial not configured",
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      return;
    }
    setSendDenialBusy((p) => ({ ...p, [c.id]: true }));
    try {
      const res = await sendToDenial(c.mondayItemId);
      toast({
        title: `Sent to Denial: ${c.patientName}`,
        description:
          `Primary status flipped. Subscription marked ${res.denial_label}` +
          (res.subscription_synced ? "." : " (subscription sync warning — check Railway logs)."),
      });
      void refetchClaims();
    } catch (e) {
      const msg = e instanceof SendToDenialError ? e.message : (e as Error).message;
      toast({ title: "Couldn't send to denial", description: msg });
    } finally {
      setSendDenialBusy((p) => ({ ...p, [c.id]: false }));
    }
  }

  async function confirmMarkPaidFromRow() {
    const target = markPaidTarget;
    if (!target || markPaidBusy) return;

    if (!isMarkPaidConfigured()) {
      toast({
        title: "Mark Paid not wired",
        description: "VITE_API_BASE_URL / VITE_ADMIN_API_KEY missing.",
      });
      setMarkPaidTarget(null);
      return;
    }

    setMarkPaidBusy(true);
    try {
      const result = await apiMarkPrimaryPaid(target.mondayItemId);
      setMarkPaidTarget(null);

      // Flip the row into the inline "Marking paid…" loading state.
      // The dialog closes; the row stays visible but dimmed with a
      // spinner until it drops out of the bucket on the next refetch.
      // startMarkPaidProcessing also fires follow-up refetches at 3s,
      // 6s, 9s to catch slow Monday propagation.
      startMarkPaidProcessing(target.id);

      // Backend returns in ~1-2s after the Primary Status flip; the
      // secondary spawn + Subscription sync run as a Railway background
      // task. Toast surfaces what's queued; failures only land in
      // Railway logs (intentional — we don't want a slow spawn blocking
      // the UI confirmation).
      const description =
        result.spawn_status === "queued"
          ? `Spawning Secondary item in background (PR $${result.pr_amount.toFixed(2)}).`
          : "PR = 0 — no secondary needed.";
      toast({
        title: `Marked Paid: ${target.patientName}`,
        description,
      });
      void refetchClaims();
    } catch (e) {
      const msg = e instanceof MarkPaidError ? e.message : (e as Error).message;
      toast({ title: "Mark Paid failed", description: msg });
    } finally {
      setMarkPaidBusy(false);
    }
  }

  // Local in-row state for "Run Status Check" on Late ERAs
  const [statusChecks, setStatusChecks] = useState<Record<string, StatusCheckRecord>>(() => {
    const seed: Record<string, StatusCheckRecord> = {};
    const denied = MOCK_CLAIMS.find((c) => c.id === "C-10049");
    if (denied) {
      const rec = generateStatusCheck(denied, "Denied");
      // Backdate the check so it doesn't look like it just ran
      rec.checkedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      seed[denied.id] = rec;
    }
    return seed;
  });
  

  const counts = useMemo(() => ({
    era: MOCK_CLAIMS.filter(inEraReview).length,
    late: MOCK_CLAIMS.filter(inLateEra).length,
    denied: MOCK_CLAIMS.filter(inDenied).length,
    outstanding: MOCK_CLAIMS.filter(inOutstanding).length,
    paid: MOCK_CLAIMS.filter(inPaid).length,
    all: MOCK_CLAIMS.filter(inAllOpen).length,
  }), [MOCK_CLAIMS]);

  const eraStats = useMemo(() => {
    const list = MOCK_CLAIMS.filter(inEraReview);
    return {
      count: list.length,
      estPay: list.reduce((s, c) => s + c.estPay, 0),
      paid: list.reduce((s, c) => s + c.primaryPaid, 0),
      pr: list.reduce((s, c) => s + c.prAmount, 0),
      diff: list.reduce((s, c) => s + variance(c), 0),
      oldest: list.reduce<string | null>((acc, c) => {
        if (!c.dos) return acc;
        if (!acc) return c.dos;
        return new Date(c.dos) < new Date(acc) ? c.dos : acc;
      }, null),
    };
  }, [MOCK_CLAIMS]);

  const lateEraStats = useMemo(() => {
    const list = MOCK_CLAIMS.filter(inLateEra);
    // Sub-bucket counts — the Late ERA tile lines now surface these so
    // the operator can see at a glance how many of the bucket are
    // actively awaiting a status check vs how many are snoozed pending
    // a previously-confirmed wait.
    const snoozed = list.filter(isLateEraSnoozed);
    const check = list.filter((c) => !isLateEraSnoozed(c));
    return {
      count: list.length,
      checkCount: check.length,
      snoozedCount: snoozed.length,
      over30: list.filter((c) => (claimAge(c) ?? 0) >= 30).length,
      between20and30: list.filter((c) => {
        const a = claimAge(c) ?? 0;
        return a >= 20 && a < 30;
      }).length,
      estPay: list.reduce((s, c) => s + c.estPay, 0),
    };
  }, [MOCK_CLAIMS]);

  const denialStats = useMemo(() => {
    const list = MOCK_CLAIMS.filter(inDenied);
    return {
      count: list.length,
      estPay: list.reduce((s, c) => s + c.estPay, 0),
      paid: list.reduce((s, c) => s + c.primaryPaid, 0),
      pr: list.reduce((s, c) => s + c.prAmount, 0),
      diff: list.reduce((s, c) => s + variance(c), 0),
      oldest: list.reduce<string | null>((acc, c) => {
        if (!c.dos) return acc;
        if (!acc) return c.dos;
        return new Date(c.dos) < new Date(acc) ? c.dos : acc;
      }, null),
    };
  }, [MOCK_CLAIMS]);

  const outstandingStats = useMemo(() => {
    const list = MOCK_CLAIMS.filter(inOutstanding);
    const ages = list.map((c) => claimAge(c) ?? 0);
    const estPay = list.reduce((s, c) => s + c.estPay, 0);
    return {
      count: list.length,
      estPay,
      avgEstPay: list.length ? estPay / list.length : 0,
      avgDays: ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0,
    };
  }, [MOCK_CLAIMS]);

  const paidStats = useMemo(() => {
    const list = MOCK_CLAIMS.filter(inPaid);
    return {
      count: list.length,
      estPay: list.reduce((s, c) => s + c.estPay, 0),
      paid: list.reduce((s, c) => s + c.primaryPaid, 0),
    };
  }, [MOCK_CLAIMS]);

  const allStats = useMemo(() => {
    const list = MOCK_CLAIMS.filter(inAllOpen);
    const estPay = list.reduce((s, c) => s + c.estPay, 0);
    const paid = list.reduce((s, c) => s + c.primaryPaid, 0);
    return {
      count: list.length,
      estPay,
      paid,
      unpaid: estPay - paid,
    };
  }, [MOCK_CLAIMS]);

  const payers = useMemo(
    () => Array.from(new Set(MOCK_CLAIMS.map((c) => c.primaryPayor))).sort(),
    [MOCK_CLAIMS],
  );

  const rows = useMemo(() => {
    const filtered = MOCK_CLAIMS.filter(CATEGORY_FILTERS[category])
      // Late ERA sub-tab split. Snoozed = lateActionDate in the future
      // (an Uploaded Docs press OR a Keep Outstanding press pushed it).
      // Check Status = everything else in the bucket.
      .filter((c) => {
        if (category !== "late") return true;
        return lateSubTab === "snoozed"
          ? isLateEraSnoozed(c)
          : !isLateEraSnoozed(c);
      })
      .filter((c) => {
        if (payerFilter !== "all" && c.primaryPayor !== payerFilter) return false;
        if (statusFilter !== "all" && c.primaryStatus !== statusFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          return (
            c.patientName.toLowerCase().includes(q) ||
            c.memberId.toLowerCase().includes(q) ||
            c.claimId.toLowerCase().includes(q) ||
            (c.payerClaimNumber ?? "").toLowerCase().includes(q)
          );
        }
        return true;
      });
    // Column-header sort. Only sorts when a column is actively selected
    // (sort.col !== null); the filtered list otherwise preserves source
    // order from useAllClaims — keeps the default landing experience
    // stable across renders.
    if (sort.col) {
      const col = sort.col;
      return [...filtered].sort((a, b) => compareRows(a, b, col, sort.dir));
    }
    return filtered;
  }, [MOCK_CLAIMS, category, lateSubTab, search, payerFilter, statusFilter, sort]);

  const columns = CATEGORY_COLUMNS[category];

  // Initial-load overlay: only when we expect Monday data but it hasn't
  // arrived yet. Hidden once data lands; refetches (Refresh button) don't
  // re-trigger this — they show inline elsewhere.
  const showInitialLoading = hasMondayToken() && !mondayClaims && claimsLoading;

  return (
    <div className="min-h-screen bg-background">
      {showInitialLoading && <LoadingOverlay />}
      <AppHeader
        title="Claims Command Center"
        subtitle="Review ERAs, check unpaid claims, and resolve claim issues."
      />

      <main className="mx-auto max-w-[1920px] px-6 py-6 space-y-6">
        {/* Top-level: Claims Board (the original product) vs Subscription Board */}
        <Tabs value={topLevel} onValueChange={(v) => setTopLevel(v as "claims" | "subscription")}>
          <TabsList className="bg-card border h-10">
            <TabsTrigger value="claims" className="text-sm font-semibold">Claims Board</TabsTrigger>
            <TabsTrigger value="subscription" className="text-sm font-semibold">Subscription Board</TabsTrigger>
          </TabsList>
        </Tabs>

        {topLevel === "subscription" ? (
          <SubscriptionBoard />
        ) : (
        <>
        {/* Top app row: Board tabs (left) | Action Items inbox
            (center, persistent across views) | Replay ERA (right).
            The inbox is pinned visible on every board+mode so the
            operator can always see what needs clearing without
            navigating back to a dashboard. Clicks on inbox bars set
            board + mode at this level, then the user picks the
            specific tile inside. */}
        <div className="flex items-center justify-between gap-3">
          <Tabs value={board} onValueChange={(v) => setBoard(v as BoardKey)}>
            <TabsList className="bg-card border">
              <TabsTrigger value="primary">Primary Board</TabsTrigger>
              <TabsTrigger value="secondary">Secondary Board</TabsTrigger>
              <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
              <TabsTrigger value="playbook">Denial Analysis Playbook</TabsTrigger>
              <TabsTrigger value="eft">EFT Enrollment</TabsTrigger>
            </TabsList>
          </Tabs>
          <ActionItemsInbox
            className="mx-auto"
            onNavigate={(target) => {
              // Set top-level board + mode first so the right component
              // mounts. Then narrow into the specific sub-tab via:
              //   - category + lateSubTab (Primary Review — owned here)
              //   - inboxNavTo (Primary Submit / Secondary / EFT —
              //     one-shot deep-link target consumed by useEffects
              //     inside those child components; new object ref per
              //     click so re-clicks re-apply).
              setBoard(target.board);
              if (target.mode && (target.board === "primary" || target.board === "secondary")) {
                setMode(target.mode);
              }
              if (target.primaryCategory) {
                setCategory(target.primaryCategory);
              }
              if (target.lateSubTab) {
                setLateSubTab(target.lateSubTab as "check" | "snoozed");
              }
              // Anything child-component-internal gets parked in inboxNavTo.
              if (target.primaryQueue || target.secondaryBucket || target.eftStatus) {
                setInboxNavTo({
                  primaryQueue: target.primaryQueue,
                  secondaryBucket: target.secondaryBucket,
                  eftStatus: target.eftStatus,
                });
              }
            }}
          />
          {/* Replay ERA — admin/recovery tool. Lives right-aligned and
              styled differently so it visually reads as "tool" not "tab". */}
          <Button asChild variant="outline" size="sm">
            <Link to="/replay-era">
              <FileJson className="mr-1 h-4 w-4" /> Replay ERA
            </Link>
          </Button>
        </div>

        {/* Mode tabs: Submit vs Review (on Primary and Secondary) */}
        {(board === "primary" || board === "secondary") && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as ModeKey)}>
            <TabsList className="bg-card border">
              <TabsTrigger value="submit">
                <Send className="mr-2 h-4 w-4" /> Submit
              </TabsTrigger>
              <TabsTrigger value="review">
                <FileSearch className="mr-2 h-4 w-4" /> Review
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {board === "eft" ? (
          <EftEnrollmentTable navTo={inboxNavTo} />
        ) : board === "playbook" ? (
          <DenialAnalysisTable />
        ) : board === "cashflow" ? (
          <CashFlowSummary
            claims={ALL_CLAIMS_FOR_CASHFLOW}
            secondaryClaims={secondaryClaims ?? []}
          />
        ) : board === "secondary" ? (
          <SecondaryBoard mode={mode} navTo={inboxNavTo} />
        ) : mode === "submit" ? (
          <PrimarySubmitBoard navTo={inboxNavTo} />
        ) : (
          <>
            {/* Clickable summary tiles for all 6 categories */}
            <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <SummaryTile
                active={category === "era"}
                onClick={() => setCategory("era")}
                tone="info"
                icon={<FileSearch className="h-5 w-5" />}
                label="ERA Review"
                value={String(eraStats.count)}
                lines={[
                  { label: "Est. pay", value: fmtMoney0(eraStats.estPay) },
                  { label: "Paid", value: fmtMoney0(eraStats.paid) },
                  { label: "PR", value: fmtMoney0(eraStats.pr) },
                  { label: "Variance", value: fmtMoney0(eraStats.diff) },
                  { label: "Oldest DOS", value: eraStats.oldest ? fmtDate(eraStats.oldest) : "—" },
                ]}
              />
              <SummaryTile
                active={category === "late"}
                onClick={() => setCategory("late")}
                tone="warning"
                icon={<Clock className="h-5 w-5" />}
                label="Late ERAs"
                value={String(lateEraStats.count)}
                lines={[
                  { label: "Check Status", value: String(lateEraStats.checkCount) },
                  { label: "Snoozed", value: String(lateEraStats.snoozedCount) },
                  { label: "≥ 30 days", value: String(lateEraStats.over30) },
                  { label: "Est. pay", value: fmtMoney0(lateEraStats.estPay) },
                ]}
              />
              <SummaryTile
                active={category === "denied"}
                onClick={() => setCategory("denied")}
                tone="danger"
                icon={<AlertTriangle className="h-5 w-5" />}
                label="Denials"
                value={String(denialStats.count)}
                lines={[
                  { label: "Est. pay", value: fmtMoney0(denialStats.estPay) },
                  { label: "Paid", value: fmtMoney0(denialStats.paid) },
                  { label: "PR", value: fmtMoney0(denialStats.pr) },
                  { label: "Variance", value: fmtMoney0(denialStats.diff) },
                  { label: "Oldest DOS", value: denialStats.oldest ? fmtDate(denialStats.oldest) : "—" },
                ]}
              />
              <SummaryTile
                active={category === "outstanding"}
                onClick={() => setCategory("outstanding")}
                tone="warning"
                icon={<Wallet className="h-5 w-5" />}
                label="Outstanding"
                value={String(outstandingStats.count)}
                lines={[
                  { label: "Est. pay", value: fmtMoney0(outstandingStats.estPay) },
                  { label: "Avg est./claim", value: fmtMoney0(outstandingStats.avgEstPay) },
                  { label: "Avg age", value: `${outstandingStats.avgDays}d` },
                ]}
              />
              <SummaryTile
                active={category === "paid"}
                onClick={() => setCategory("paid")}
                tone="success"
                icon={<Check className="h-5 w-5" />}
                label="Paid"
                value={String(paidStats.count)}
                lines={[
                  { label: "Est. pay", value: fmtMoney0(paidStats.estPay) },
                  { label: "Paid", value: fmtMoney0(paidStats.paid) },
                ]}
              />
              <SummaryTile
                active={category === "all"}
                onClick={() => setCategory("all")}
                tone="info"
                icon={<FileSearch className="h-5 w-5" />}
                label="All Open"
                value={String(allStats.count)}
                lines={[
                  { label: "Est. pay", value: fmtMoney0(allStats.estPay) },
                  { label: "Paid", value: fmtMoney0(allStats.paid) },
                  { label: "Unpaid amount", value: fmtMoney0(allStats.unpaid) },
                ]}
              />
            </section>

            {/* Filters */}
            <Card>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search patient, member ID, claim ID, payer claim #"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={payerFilter} onValueChange={setPayerFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Payer" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All payers</SelectItem>
                    {payers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Primary status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["Submitted", "Outstanding", "Review", "Paid", "Denied (Or Partly)"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Late ERA sub-tabs — Check Status vs Snoozed. Only shown when
                viewing the Late ERA bucket. "Check Status" surfaces rows that
                need an active claim status check (or where the snooze window
                already elapsed). "Snoozed" surfaces rows where the operator
                already pressed Keep Outstanding (or Uploaded Docs) — those
                sit here until Late Action Date passes, then return to Check
                Status automatically. */}
            {category === "late" && (
              <div className="flex items-center gap-2">
                <Tabs value={lateSubTab} onValueChange={(v) => setLateSubTab(v as "check" | "snoozed")}>
                  <TabsList className="bg-card border">
                    <TabsTrigger value="check">
                      Check Status
                      <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning-soft-foreground">
                        {lateEraStats.checkCount}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="snoozed">
                      Snoozed
                      <span className="ml-2 rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info-soft-foreground">
                        {lateEraStats.snoozedCount}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <p className="text-xs text-muted-foreground">
                  {lateSubTab === "snoozed"
                    ? "Already checked — waiting for next check date."
                    : "Need an active claim status check."}
                </p>
              </div>
            )}

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {rows.length === 0 ? (
                  <EmptyState category={category} />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {columns.map((col) => {
                            const sortable = !NON_SORTABLE_COLUMNS.has(col);
                            const isActive = sortable && sort.col === col;
                            const onClick = sortable
                              ? () => {
                                  setSort((s) => {
                                    // 3-state cycle on the same column:
                                    // asc -> desc -> off (back to source order).
                                    if (s.col !== col) return { col, dir: "asc" };
                                    if (s.dir === "asc") return { col, dir: "desc" };
                                    return { col: null, dir: "asc" };
                                  });
                                }
                              : undefined;
                            return (
                              <TableHead
                                key={col}
                                onClick={onClick}
                                className={cn(
                                  COLUMN_LABELS[col].align === "right" && "text-right",
                                  sortable && "cursor-pointer select-none hover:text-foreground",
                                )}
                                aria-sort={
                                  isActive
                                    ? sort.dir === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : undefined
                                }
                              >
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1",
                                    COLUMN_LABELS[col].align === "right" && "justify-end w-full",
                                  )}
                                >
                                  {COLUMN_LABELS[col].label}
                                  {isActive && (
                                    <span className="text-[10px] leading-none">
                                      {sort.dir === "asc" ? "▲" : "▼"}
                                    </span>
                                  )}
                                </span>
                              </TableHead>
                            );
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody className="[&_tr>td]:align-top">
                        {rows.map((c) => {
                          const d = diff(c);
                          const eraIn = eraReceived(c);
                          let cls: string;
                          if (category === "era") {
                            cls =
                              eraIn && c.primaryPaid === 0 ? "row-priority-red" :
                              Math.abs(d) <= 0.5 ? "row-priority-green" :
                              "row-priority-yellow";
                          } else {
                            const p = priorityOf(c);
                            cls =
                              p === "red" ? "row-priority-red" :
                              p === "yellow" ? "row-priority-yellow" :
                              p === "green" ? "row-priority-green" : "row-priority-gray";
                          }
                          const age = claimAge(c);
                          const detail = statusChecks[c.id];
                          const isMarkingPaid = !!markPaidProcessing[c.id];
                          return (
                            <Fragment key={c.id}>
                            <TableRow
                              className={cn(
                                cls,
                                "hover:bg-muted/40",
                                // Dim + pulse the row while the mark-paid
                                // write propagates through Monday + refetch.
                                isMarkingPaid && "opacity-60 animate-pulse pointer-events-none",
                              )}
                              aria-busy={isMarkingPaid || undefined}
                            >
                              {columns.map((col) => {
                                switch (col) {
                                  case "patient": {
                                    const tc = findThreadClaimForMockClaim(
                                      {
                                        patientName: c.patientName,
                                        primaryPayor: c.primaryPayor,
                                        dos: c.dos,
                                        mondayItemId: c.mondayItemId,
                                      },
                                      threadClaims,
                                    );
                                    let chip: React.ReactNode = null;
                                    if (tc) {
                                      const root = getRootClaim(tc, threadClaims);
                                      const kids = getChildClaims(tc, threadClaims);
                                      const isFollowUp = !!tc.parent_claim_id;
                                      const label = isFollowUp
                                        ? `↳ Follow-up to original ${fmtDate(root.dos)}`
                                        : kids.length > 0
                                          ? `↑ Has ${kids.length} follow-up${kids.length === 1 ? "" : "s"}`
                                          : null;
                                      if (label) {
                                        const isOpen = expandedThread === c.id;
                                        chip = (
                                          <button
                                            type="button"
                                            onClick={() => setExpandedThread(isOpen ? null : c.id)}
                                            className={cn(
                                              "mt-1 inline-flex items-center gap-1 rounded border border-l-2 border-l-info bg-info-soft/30 px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-info-soft",
                                            )}
                                          >
                                            {label}
                                            <span className="text-muted-foreground">{isOpen ? "▲" : "▾"}</span>
                                          </button>
                                        );
                                      }
                                    }
                                    // Labels (DOB:/ID:) are bold but un-selectable so a click on
                                    // the value selects only the value. user-select:all on the
                                    // value makes a single click highlight the entire string
                                    // (incl. the slashes in the date) for clean copy-paste.
                                    return (
                                      <TableCell key={col} className="font-medium">
                                        <Link to={`/claims/${c.id}`} className="hover:underline">
                                          {c.patientName}
                                        </Link>
                                        <div className="text-xs text-muted-foreground leading-tight">
                                          <span className="font-bold select-none">DOB: </span>
                                          <span className="[user-select:all]">{fmtDate(c.dob)}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground leading-tight">
                                          <span className="font-bold select-none">ID: </span>
                                          <span className="[user-select:all]">{c.memberId}</span>
                                        </div>
                                        {/* Snooze pill — appears on Outstanding rows that were
                                            snoozed via the Uploaded Docs action in ClaimDetail.
                                            isLateEraSnoozed() reads claim.lateActionDate (Monday
                                            column date_mm153jp1) and is true while the snooze is
                                            still active. Stays in Outstanding for the snooze
                                            window, then drops back into Late ERA when the date
                                            elapses. */}
                                        {isLateEraSnoozed(c) && (
                                          <div className="mt-1">
                                            <StatusBadge tone="warning">
                                              Snoozed — next check on {fmtDate(c.lateActionDate ?? "")}
                                            </StatusBadge>
                                          </div>
                                        )}
                                        {chip}
                                      </TableCell>
                                    );
                                  }
                                  case "dos":
                                    return <TableCell key={col} className="text-sm">{fmtDate(c.dos)}</TableCell>;
                                  case "products": {
                                    const [row0, row1] = groupProductRows(c.lines);
                                    // Only the Denials tab colors pills by line state. Every
                                    // other tab (ERA Review, Late, Outstanding, Paid, All)
                                    // keeps all pills grey regardless of denial state.
                                    const colorByDenialState = category === "denied";
                                    const Chip = ({ line }: { line: ServiceLine }) => {
                                      const code = hcpcsForProduct(line.product);
                                      const state = lineDenialState(line);
                                      const isDenied =
                                        colorByDenialState && state !== "paid";
                                      const node = (
                                        <span
                                          className={cn(
                                            "inline-flex h-6 items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap cursor-default",
                                            isDenied
                                              ? "bg-danger-soft text-danger-soft-foreground"
                                              : "bg-muted text-foreground",
                                          )}
                                        >
                                          {productAbbr(line.product)}
                                        </span>
                                      );
                                      if (!code) return node;
                                      const tooltip = isDenied
                                        ? `${code} — ${state === "denied" ? "Denied" : "Partial"}`
                                        : code;
                                      return (
                                        <Tooltip>
                                          <TooltipTrigger asChild>{node}</TooltipTrigger>
                                          <TooltipContent>{tooltip}</TooltipContent>
                                        </Tooltip>
                                      );
                                    };
                                    return (
                                      <TableCell key={col} className="text-sm">
                                        <TooltipProvider delayDuration={150}>
                                          <div className="flex flex-col gap-1">
                                            {row0.length > 0 && (
                                              <div className="flex flex-nowrap gap-1">
                                                {row0.map((l) => <Chip key={l.id} line={l} />)}
                                              </div>
                                            )}
                                            {row1.length > 0 && (
                                              <div className="flex flex-nowrap gap-1">
                                                {row1.map((l) => <Chip key={l.id} line={l} />)}
                                              </div>
                                            )}
                                          </div>
                                        </TooltipProvider>
                                      </TableCell>
                                    );
                                  }
                                  case "payer":
                                    return <TableCell key={col} className="text-sm">{c.primaryPayor}</TableCell>;
                                  case "sent":
                                    return <TableCell key={col} className="text-sm">{fmtDate(c.claimSentDate)}</TableCell>;
                                  case "age": {
                                    if (age == null) return <TableCell key={col} className="text-sm">—</TableCell>;
                                    const tone =
                                      age >= 30 ? "bg-danger-soft text-danger-soft-foreground" :
                                      age >= 20 ? "bg-warning-soft text-warning-soft-foreground" :
                                      "bg-success-soft text-success-soft-foreground";
                                    return (
                                      <TableCell key={col} className="text-sm">
                                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", tone)}>
                                          {age}d
                                        </span>
                                      </TableCell>
                                    );
                                  }
                                  case "primary":
                                    return <TableCell key={col}><PrimaryStatusBadge status={c.primaryStatus} /></TableCell>;
                                  case "s277":
                                    return (
                                      <TableCell key={col} className="w-[88px] max-w-[88px]">
                                        <span className="[&_span]:!whitespace-normal [&_span]:!px-2 [&_span]:!leading-tight [&_span]:!text-[11px] inline-block">
                                          <Status277Badge status={c.status277} />
                                        </span>
                                      </TableCell>
                                    );
                                  case "claimStatus":
                                    return <TableCell key={col}><ClaimStatusBadge status={c.claimStatusCategory} /></TableCell>;
                                  case "claimStatusLate": {
                                    // Source of truth order:
                                    //   1) In-memory result (just ran, before
                                    //      Monday write completes / next fetch)
                                    //   2) Monday-persisted columns
                                    const result = statusChecks[c.id] ?? statusCheckFromClaim(c);
                                    return (
                                      <TableCell key={col} className="text-sm">
                                        {result ? (
                                          (() => {
                                            const meta = STATUS_CHECK_META[result.status];
                                            // Wired to snoozeLateEra. Pushes Late Action Date
                                            // to today + 10 calendar days so the row drops
                                            // into the Snoozed sub-tab. Idempotent — pressing
                                            // again while already snoozed resets the 10 days
                                            // from the new click. Busy spinner mirrors the
                                            // denialBtn pattern below.
                                            const keepBtn = (
                                              <Tooltip key="keep">
                                                <TooltipTrigger asChild>
                                                  <button
                                                    type="button"
                                                    aria-label="Keep Outstanding"
                                                    disabled={!!keepOutstandingBusy[c.id]}
                                                    onClick={() => void keepOutstandingForRow(c)}
                                                    className={cn(
                                                      "grid h-9 w-9 place-items-center rounded-md transition-colors shadow-sm",
                                                      keepOutstandingBusy[c.id] && "opacity-60 cursor-wait",
                                                      meta.recommend === "keep"
                                                        ? "bg-info-soft text-info-soft-foreground hover:bg-info hover:text-info-foreground"
                                                        : "bg-muted text-muted-foreground hover:bg-info-soft hover:text-info-soft-foreground",
                                                    )}
                                                  >
                                                    <Clock className="h-4 w-4" />
                                                  </button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                  Keep Outstanding{meta.recommend === "keep" ? " (recommended)" : ""}
                                                </TooltipContent>
                                              </Tooltip>
                                            );
                                            // Was a toast-only stub. Now fires the same backend
                                            // sendToDenialForRow handler the Outstanding row uses
                                            // (POST /claims/send-to-denial → flips Primary Status
                                            // to Denied (Or Partly) + syncs Subscription board).
                                            // Spinner state from sendDenialBusy[c.id] disables
                                            // the button while the write is in flight; refetch
                                            // happens on success so the row drops out of Late
                                            // ERA + appears in Denials within ~1-2s.
                                            const denialBtn = (
                                              <Tooltip key="denial">
                                                <TooltipTrigger asChild>
                                                  <button
                                                    type="button"
                                                    aria-label="Move to Denial"
                                                    disabled={!!sendDenialBusy[c.id]}
                                                    onClick={() => void sendToDenialForRow(c)}
                                                    className={cn(
                                                      "grid h-9 w-9 place-items-center rounded-md transition-colors shadow-sm",
                                                      sendDenialBusy[c.id] && "opacity-60 cursor-wait",
                                                      meta.recommend === "denial"
                                                        ? "bg-danger-soft text-danger-soft-foreground hover:bg-danger hover:text-danger-foreground"
                                                        : "bg-muted text-muted-foreground hover:bg-danger-soft hover:text-danger-soft-foreground",
                                                    )}
                                                  >
                                                    <XCircle className="h-4 w-4" />
                                                  </button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                  Move to Denial{meta.recommend === "denial" ? " (recommended)" : ""}
                                                </TooltipContent>
                                              </Tooltip>
                                            );
                                            const runCheck = () => void runStatusCheckForRow(c);
                                            // See-details button — gives the operator the same
                                            // ClaimDetail entry point that Outstanding/Denied
                                            // rows have. Without it, the only way to drill in
                                            // from Late ERA is the patient-name link in the
                                            // first column, which isn't obvious.
                                            const detailsBtn = (
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Link
                                                    to={`/claims/${c.id}`}
                                                    aria-label="See details"
                                                    className="grid h-7 w-7 place-items-center rounded-md bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors shadow-sm"
                                                  >
                                                    <ArrowRight className="h-3.5 w-3.5" />
                                                  </Link>
                                                </TooltipTrigger>
                                                <TooltipContent>See details</TooltipContent>
                                              </Tooltip>
                                            );
                                            return (
                                              <TooltipProvider delayDuration={150}>
                                                <div className="flex items-center gap-2">
                                                  <div className="space-y-0.5">
                                                    <span className={cn(
                                                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                                      meta.tone,
                                                    )}>
                                                      {result.status}
                                                    </span>
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                      <span>Checked {fmtDate(result.checkedAt)}</span>
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                          <button
                                                            type="button"
                                                            aria-label="Rerun status check"
                                                            onClick={runCheck}
                                                            className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                                          >
                                                            <RefreshCw className="h-3 w-3" />
                                                          </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Rerun status check</TooltipContent>
                                                      </Tooltip>
                                                    </div>
                                                  </div>
                                                  <div className="inline-flex items-center gap-1.5">
                                                    {keepBtn}{denialBtn}{detailsBtn}
                                                  </div>
                                                </div>
                                              </TooltipProvider>
                                            );
                                          })()
                                        ) : (
                                          // Two buttons: Run Status Check (the API action)
                                          // and See Details (drill into ClaimDetail). Side-
                                          // by-side keeps the row compact without losing the
                                          // ClaimDetail entry point.
                                          <TooltipProvider delayDuration={150}>
                                            <div className="inline-flex items-center gap-2">
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={!!statusCheckBusy[c.id]}
                                                onClick={() => void runStatusCheckForRow(c)}
                                              >
                                                {statusCheckBusy[c.id] ? (
                                                  <>
                                                    <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                                                    Running
                                                  </>
                                                ) : (
                                                  "Run Status Check"
                                                )}
                                              </Button>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Link
                                                    to={`/claims/${c.id}`}
                                                    aria-label="See details"
                                                    className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors shadow-sm"
                                                  >
                                                    <ArrowRight className="h-4 w-4" />
                                                  </Link>
                                                </TooltipTrigger>
                                                <TooltipContent>See details</TooltipContent>
                                              </Tooltip>
                                            </div>
                                          </TooltipProvider>
                                        )}
                                      </TableCell>
                                    );
                                  }
                                  case "estPay":
                                    return <TableCell key={col} className="text-right tabular-nums">{fmtMoney(c.estPay)}</TableCell>;
                                  case "paid":
                                    return (
                                      <TableCell
                                        key={col}
                                        className={cn(
                                          "text-right tabular-nums",
                                          eraIn && c.primaryPaid === 0 && "text-danger font-medium",
                                          !eraIn && "text-muted-foreground",
                                        )}
                                      >
                                        {eraIn ? fmtMoney(c.primaryPaid) : "—"}
                                      </TableCell>
                                    );
                                  case "pr": {
                                    const forwarded = isForwardedByPrimary(c.rawEraClaimStatus);
                                    const reversal = hasReversalInEra(c.rawEraClaimStatus);
                                    return (
                                      <TableCell
                                        key={col}
                                        className={cn(
                                          "text-right tabular-nums",
                                          !eraIn && "text-muted-foreground",
                                        )}
                                      >
                                        <div className="flex flex-col items-end gap-1">
                                          <span>{eraIn ? fmtMoney(c.prAmount) : "—"}</span>
                                          {forwarded && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className="inline-flex h-5 items-center rounded-md bg-blue-100 px-1.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 cursor-help">
                                                  Forwarded
                                                </span>
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                Primary forwarded to secondary
                                                ({c.rawEraClaimStatus})
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                          {reversal && (
                                            // Reversal pill — backend tagged this row's
                                            // raw_era_claim_status with "(Reversal in
                                            // ERA)" because the 835 carried a Reversal
                                            // CLP (status 22 or 17) paired with the
                                            // reissue for the same PCN. Operator should
                                            // investigate before treating as cleanly
                                            // paid; some cases net out as denials.
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className="inline-flex h-5 items-center rounded-md bg-amber-100 px-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 cursor-help">
                                                  Reversal
                                                </span>
                                              </TooltipTrigger>
                                              <TooltipContent className="max-w-xs">
                                                ERA contained a Reversal CLP. Payer flipped
                                                an earlier decision on this claim — verify
                                                the net cash effect before marking paid.
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                        </div>
                                      </TableCell>
                                    );
                                  }
                                  case "difference":
                                    // Difference = estPay - paid - PR. Negative means we got
                                    // paid MORE than projected → that's good, color green.
                                    // Positive means we got paid less than projected → red if
                                    // material, grey if small. Near-zero is balanced (green).
                                    return (
                                      <TableCell
                                        key={col}
                                        className={cn(
                                          "text-right tabular-nums",
                                          Math.abs(d) <= 0.5
                                            ? "text-success font-medium"
                                            : d < 0
                                              ? "text-success"
                                              : d > 5
                                                ? "text-danger"
                                                : "text-muted-foreground",
                                        )}
                                      >
                                        {fmtMoney(d)}
                                      </TableCell>
                                    );
                                  case "issue":
                                    return <TableCell key={col} className="text-sm text-muted-foreground">{shortIssue(c)}</TableCell>;
                                  case "nextAction":
                                    return <TableCell key={col} className="text-sm">{fmtDate(c.nextActionDate)}</TableCell>;
                                  case "action":
                                    if (category === "era") {
                                      // Inline "Marking paid…" status replaces the action
                                      // buttons while the backend write + Monday propagation
                                      // settle. Operator sees a clear processing signal
                                      // instead of staring at an unchanged row for 5-10s.
                                      if (isMarkingPaid) {
                                        return (
                                          <TableCell key={col} className="text-right">
                                            <span className="inline-flex items-center gap-1.5 rounded-md bg-success-soft px-3 py-1.5 text-xs font-medium text-success-soft-foreground">
                                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                              Marking paid…
                                            </span>
                                          </TableCell>
                                        );
                                      }
                                      return (
                                        <TableCell key={col} className="text-right">
                                          <TooltipProvider delayDuration={150}>
                                            <div className="inline-flex items-center justify-end gap-2">
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <button
                                                    type="button"
                                                    aria-label="Mark fully paid"
                                                    onClick={() => setMarkPaidTarget(c)}
                                                    className="grid h-9 w-9 place-items-center rounded-md bg-success-soft text-success-soft-foreground hover:bg-success hover:text-success-foreground transition-colors shadow-sm"
                                                  >
                                                    <Check className="h-4 w-4" />
                                                  </button>
                                                </TooltipTrigger>
                                                <TooltipContent>Mark fully paid</TooltipContent>
                                              </Tooltip>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <button
                                                    type="button"
                                                    aria-label="Send to Denial"
                                                    onClick={() => void sendToDenialForRow(c)}
                                                    disabled={!!sendDenialBusy[c.id]}
                                                    className={cn(
                                                      "grid h-9 w-9 place-items-center rounded-md bg-danger-soft text-danger-soft-foreground hover:bg-danger hover:text-danger-foreground transition-colors shadow-sm",
                                                      sendDenialBusy[c.id] && "opacity-60",
                                                    )}
                                                  >
                                                    {sendDenialBusy[c.id]
                                                      ? <RefreshCw className="h-4 w-4 animate-spin" />
                                                      : <XCircle className="h-4 w-4" />}
                                                  </button>
                                                </TooltipTrigger>
                                                <TooltipContent>Send to Denial</TooltipContent>
                                              </Tooltip>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <Link
                                                    to={`/claims/${c.id}`}
                                                    aria-label="See details"
                                                    className="grid h-9 w-9 place-items-center rounded-md bg-muted text-muted-foreground hover:bg-primary hover:text-primary-foreground transition-colors shadow-sm"
                                                  >
                                                    <ArrowRight className="h-4 w-4" />
                                                  </Link>
                                                </TooltipTrigger>
                                                <TooltipContent>See details</TooltipContent>
                                              </Tooltip>
                                            </div>
                                          </TooltipProvider>
                                        </TableCell>
                                      );
                                    }
                                    return (
                                      <TableCell key={col} className="text-right">
                                        <Button asChild size="sm" variant="outline">
                                          <Link to={`/claims/${c.id}`}>
                                            {rowCta(c)} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                          </Link>
                                        </Button>
                                      </TableCell>
                                    );
                                  default:
                                    return null;
                                }
                              })}
                            </TableRow>
                            {expandedThread === c.id && (() => {
                              const tc = findThreadClaimForMockClaim(
                                {
                                  patientName: c.patientName,
                                  primaryPayor: c.primaryPayor,
                                  dos: c.dos,
                                  mondayItemId: c.mondayItemId,
                                },
                                threadClaims,
                              );
                              if (!tc) return null;
                              return (
                                <TableRow className="bg-muted/10 hover:bg-muted/10">
                                  <TableCell colSpan={columns.length} className="p-0">
                                    <ThreadPanel
                                      currentClaimId={tc.id}
                                      onHide={() => setExpandedThread(null)}
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })()}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
        </>
        )}
      </main>

      {/* Row-level Mark Paid confirmation. Opens when the checkmark icon on
          any row is clicked; calls the same /claims/mark-paid backend
          endpoint as the in-detail flow. */}
      <AlertDialog
        open={!!markPaidTarget}
        onOpenChange={(o) => !o && setMarkPaidTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark fully paid?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">
                  {markPaidTarget?.patientName}
                </p>
                <p>
                  Secondary:{" "}
                  <span className="font-medium text-foreground">
                    {markPaidTarget
                      ? summarizeSecondary(
                          markPaidTarget.prAmount,
                          markPaidTarget.primaryPayor,
                          markPaidTarget.secondaryPayer,
                          markPaidTarget.rawEraClaimStatus,
                        )
                      : "None"}
                  </span>
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markPaidBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={markPaidBusy}
              onClick={(e) => { e.preventDefault(); void confirmMarkPaidFromRow(); }}
            >
              {markPaidBusy ? "Marking…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

function fmtMoney0(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

function SummaryTile({
  icon, tone, label, value, lines, active, onClick,
}: {
  icon: React.ReactNode;
  tone: "warning" | "danger" | "info" | "success";
  label: string;
  value: string;
  lines: { label: string; value: string }[];
  active: boolean;
  onClick: () => void;
}) {
  const toneBg: Record<typeof tone, string> = {
    warning: "bg-warning-soft text-warning-soft-foreground",
    danger: "bg-danger-soft text-danger-soft-foreground",
    info: "bg-info-soft text-info-soft-foreground",
    success: "bg-success-soft text-success-soft-foreground",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border bg-card p-5 text-left transition-colors hover:bg-accent",
        active && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn("grid h-10 w-10 place-items-center rounded-lg", toneBg[tone])}>
          {icon}
        </div>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
      </div>
      <div className="mt-4 text-sm font-medium">{label}</div>
      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {lines.map((l, i) => (
          <li key={i}>
            <span className="font-medium text-foreground">{l.label}:</span>{" "}
            <span className="tabular-nums">{l.value}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

function SummaryCard({
  icon, tone, label, value, lines, cta, onClick,
}: {
  icon: React.ReactNode;
  tone: "warning" | "danger" | "info" | "success";
  label: string;
  value: string;
  lines: { label: string; value: string }[];
  cta: string;
  onClick: () => void;
}) {
  const toneBg: Record<typeof tone, string> = {
    warning: "bg-warning-soft text-warning-soft-foreground",
    danger: "bg-danger-soft text-danger-soft-foreground",
    info: "bg-info-soft text-info-soft-foreground",
    success: "bg-success-soft text-success-soft-foreground",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={cn("grid h-10 w-10 place-items-center rounded-lg", toneBg[tone])}>
            {icon}
          </div>
          <div className="text-3xl font-semibold tabular-nums">{value}</div>
        </div>
        <div className="mt-4 text-sm font-medium">{label}</div>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {lines.map((l, i) => (
            <li key={i}>
              <span className="font-medium text-foreground">{l.label}:</span>{" "}
              <span className="tabular-nums">{l.value}</span>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="mt-3 -ml-3 h-8 text-primary hover:text-primary" onClick={onClick}>
          {cta} <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyState({ category }: { category: CategoryKey }) {
  const subtitles: Record<CategoryKey, string> = {
    era: "No new ERAs are waiting for review.",
    late: "No claims are currently old enough for status checks.",
    denied: "No denied or partially denied claims need action.",
    outstanding: "No outstanding primary claims to surface.",
    paid: "No paid claims to show yet.",
    
    all: "No open claims match your filters.",
  };
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-success-soft text-success-soft-foreground">
        <FileSearch className="h-6 w-6" />
      </div>
      <p className="text-base font-medium">No claims need review right now.</p>
      <p className="text-sm text-muted-foreground">{subtitles[category]}</p>
    </div>
  );
}

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent className="px-6 py-16 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Clock className="h-6 w-6" />
        </div>
        <p className="text-base font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default Claims;
