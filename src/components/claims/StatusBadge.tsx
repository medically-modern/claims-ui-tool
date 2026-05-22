import { cn } from "@/lib/utils";
import type { PrimaryStatus, ClaimStatusCategory, Status277, LineStatus } from "@/lib/claims/types";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClass: Record<Tone, string> = {
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  danger: "bg-danger-soft text-danger-soft-foreground",
  info: "bg-info-soft text-info-soft-foreground",
  neutral: "bg-neutral-soft text-neutral-soft-foreground",
};

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PrimaryStatusBadge({ status }: { status: PrimaryStatus }) {
  const map: Record<PrimaryStatus, Tone> = {
    Paid: "success",
    Review: "warning",
    "Denied (Or Partly)": "danger",
    Submitted: "info",
    Outstanding: "warning",
    "Bad Debt": "neutral",
    "Request Rejected": "danger",
    "Submit Claim": "info",
    Late: "danger",
    Appeals: "warning",
    "Future Claim": "neutral",
    "Not Started Yet": "neutral",
  };
  return <StatusBadge tone={map[status]}>{status}</StatusBadge>;
}

export function ClaimStatusBadge({ status }: { status: ClaimStatusCategory }) {
  if (!status) return <StatusBadge tone="neutral">—</StatusBadge>;
  const map: Record<NonNullable<ClaimStatusCategory>, Tone> = {
    Paid: "success",
    Denied: "danger",
    Pending: "warning",
    "In Process": "info",
    "Requests Info": "danger",
    "No Match": "danger",
    Error: "danger",
  };
  return <StatusBadge tone={map[status]}>{status}</StatusBadge>;
}

export function Status277Badge({ status }: { status: Status277 }) {
  if (!status) return <StatusBadge tone="neutral">—</StatusBadge>;
  const map: Record<NonNullable<Status277>, Tone> = {
    "Payer Accepted": "success",
    "Stedi Accepted": "info",
    "Payer Rejected": "danger",
    "Stedi Rejected": "danger",
  };
  return <StatusBadge tone={map[status]}>{status}</StatusBadge>;
}

export function LineStatusBadge({ status }: { status: LineStatus }) {
  const map: Record<LineStatus, Tone> = {
    Paid: "success",
    PR: "info",
    Denied: "danger",
    Partial: "warning",
    "Needs Review": "warning",
  };
  return <StatusBadge tone={map[status]}>{status}</StatusBadge>;
}

/**
 * Pill that surfaces what the BPR payment method code on the 835 means
 * for the operator. Renders next to the raw method code in the Bank Info
 * strip on both ClaimDetail and SecondaryBoard.
 *   - ACH                → no pill (money already landed by EFT)
 *   - CHK / FWT          → blue "Enroll in EFT" (paper check or wire — we
 *                          should chase EFT enrollment with that payer)
 *   - NON                → red "No Payment Received" (zero-pay remit —
 *                          typically a full denial / takeback, no money)
 *   - anything else      → no pill (unknown code, don't editorialize)
 * Case-insensitive on the input. Returns null when no pill applies so
 * callers can drop it inline without a wrapper.
 */
export function BankPaymentMethodBadge({
  method,
}: {
  method?: string | null;
}) {
  const pm = method?.trim().toUpperCase();
  if (pm === "CHK" || pm === "FWT") {
    return <StatusBadge tone="info">Enroll in EFT</StatusBadge>;
  }
  if (pm === "NON") {
    return <StatusBadge tone="danger">No Payment Received</StatusBadge>;
  }
  return null;
}
