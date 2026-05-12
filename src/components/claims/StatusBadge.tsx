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
