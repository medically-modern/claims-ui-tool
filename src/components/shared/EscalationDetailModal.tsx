/**
 * EscalationDetailModal — read-only view of the escalation form data.
 * Used in System Management to review escalation details submitted by reps.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, User, FileText, Wrench, HelpCircle, Clock } from "lucide-react";
import type { EscalationFormData } from "@/lib/shared/escalation";

const URGENCY_BADGE: Record<string, string> = {
  Low: "bg-gray-100 text-gray-700",
  Medium: "bg-yellow-100 text-yellow-700",
  High: "bg-orange-100 text-orange-700",
  Urgent: "bg-red-100 text-red-700 animate-pulse",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientName: string;
  data: EscalationFormData | null;
}

export function EscalationDetailModal({ open, onOpenChange, patientName, data }: Props) {
  if (!data) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Escalation Details
            </DialogTitle>
          </DialogHeader>
          <div className="py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No escalation form data found for <strong>{patientName}</strong>.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This escalation may have been submitted before the form was introduced.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Escalation — {patientName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Header row: rep + urgency + date */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{data.repName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${URGENCY_BADGE[data.urgency] ?? URGENCY_BADGE.Medium}`}>
                {data.urgency}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(data.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </div>

          {/* Issue Summary */}
          <div className="rounded-lg border bg-red-50/50 dark:bg-red-950/20 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">
              <FileText className="h-3 w-3" />
              Issue Summary
            </div>
            <p className="text-sm whitespace-pre-wrap">{data.issueSummary}</p>
          </div>

          {/* What Have You Tried */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Wrench className="h-3 w-3" />
              What Have You Tried
            </div>
            <p className="text-sm whitespace-pre-wrap">{data.whatTried}</p>
          </div>

          {/* Manager Ask */}
          <div className="rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
              <HelpCircle className="h-3 w-3" />
              Manager Ask
            </div>
            <p className="text-sm whitespace-pre-wrap">{data.managerAsk}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
