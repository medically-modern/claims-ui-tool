import { Check, Clock, Hourglass, X, AlertTriangle } from "lucide-react";
import type { ItemStatus } from "@/lib/claims/threads";
import { cn } from "@/lib/utils";

const STYLES: Record<ItemStatus, { cls: string; icon: React.ReactNode; label: string }> = {
  "Pending":           { cls: "bg-muted text-muted-foreground",                icon: <Clock className="h-3 w-3" />,         label: "Pending" },
  "Denied":            { cls: "bg-danger-soft text-danger-soft-foreground",    icon: <X className="h-3 w-3" />,             label: "Denied" },
  "Partial":           { cls: "bg-warning-soft text-warning-soft-foreground",  icon: <AlertTriangle className="h-3 w-3" />, label: "Partial" },
  "Pending Follow-up": { cls: "bg-info-soft text-info-soft-foreground",        icon: <Hourglass className="h-3 w-3" />,     label: "Pending Follow-up" },
  "Paid/Done":         { cls: "bg-success-soft text-success-soft-foreground",  icon: <Check className="h-3 w-3" />,         label: "Paid/Done" },
};

export function ItemStatusPill({ status, className }: { status: ItemStatus; className?: string }) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        s.cls,
        className,
      )}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

export function StatusGlyph({ status }: { status: ItemStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full",
        s.cls,
      )}
      title={s.label}
    >
      {s.icon}
    </span>
  );
}
