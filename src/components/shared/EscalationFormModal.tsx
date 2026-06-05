/**
 * EscalationFormModal — pops up when a rep clicks Escalate.
 * Collects: Rep Name, Issue Summary, What Have You Tried, Manager Ask, Urgency.
 * On submit: writes the escalation status column AND the escalation notes column
 * to Monday, then closes.
 *
 * Works across all role pages — caller passes the write functions.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type { EscalationFormData } from "@/lib/shared/escalation";
import { serializeEscalation } from "@/lib/shared/escalation";

const URGENCY_OPTIONS = ["Low", "Medium", "High", "Urgent"] as const;
const URGENCY_COLORS: Record<string, string> = {
  Low: "bg-gray-100 text-gray-700 border-gray-300",
  Medium: "bg-yellow-100 text-yellow-700 border-yellow-300",
  High: "bg-orange-100 text-orange-700 border-orange-300",
  Urgent: "bg-red-100 text-red-700 border-red-300",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  /** Write escalation status to Monday (sets the color column to "Escalation Required") */
  writeEscalationStatus: (patientId: string) => Promise<void>;
  /** Write escalation notes to Monday (sets the long_text column) */
  writeEscalationNotes: (patientId: string, text: string) => Promise<void>;
  /** Called after successful write */
  onSuccess: () => void;
}

export function EscalationFormModal({
  open,
  onOpenChange,
  patientId,
  patientName,
  writeEscalationStatus,
  writeEscalationNotes,
  onSuccess,
}: Props) {
  const [repName, setRepName] = useState("");
  const [issueSummary, setIssueSummary] = useState("");
  const [whatTried, setWhatTried] = useState("");
  const [managerAsk, setManagerAsk] = useState("");
  const [urgency, setUrgency] = useState<EscalationFormData["urgency"]>("Medium");
  const [sending, setSending] = useState(false);

  const canSubmit = repName.trim() && issueSummary.trim() && whatTried.trim() && managerAsk.trim();

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error("Please fill out all required fields.");
      return;
    }
    setSending(true);
    try {
      const formData: EscalationFormData = {
        repName: repName.trim(),
        issueSummary: issueSummary.trim(),
        whatTried: whatTried.trim(),
        managerAsk: managerAsk.trim(),
        urgency,
        submittedAt: new Date().toISOString(),
      };
      const serialized = serializeEscalation(formData);

      // Write both the escalation status and the notes in parallel
      await Promise.all([
        writeEscalationStatus(patientId),
        writeEscalationNotes(patientId, serialized),
      ]);

      toast.success(`Escalation submitted for ${patientName}`);
      onOpenChange(false);
      resetForm();
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[EscalationFormModal] Failed:", msg);
      toast.error(`Failed to submit escalation: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setRepName("");
    setIssueSummary("");
    setWhatTried("");
    setManagerAsk("");
    setUrgency("Medium");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Escalate Patient
          </DialogTitle>
          <DialogDescription>
            Submit an escalation for <strong>{patientName}</strong>. All fields are required so the manager has full context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Rep Name */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Rep Name <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-muted-foreground mb-1.5">Who is escalating this?</p>
            <input
              type="text"
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              placeholder="e.g. MS"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Issue Summary */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Issue Summary <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-muted-foreground mb-1.5">What is stuck, unclear, or causing the delay?</p>
            <textarea
              value={issueSummary}
              onChange={(e) => setIssueSummary(e.target.value)}
              rows={3}
              placeholder="e.g. Pump script does not meet medical necessity because the OOW date is missing."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* What Have You Tried */}
          <div>
            <label className="block text-sm font-medium mb-1">
              What Have You Tried? <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-muted-foreground mb-1.5">What steps have already been taken? Include dates if helpful.</p>
            <textarea
              value={whatTried}
              onChange={(e) => setWhatTried(e.target.value)}
              rows={3}
              placeholder="e.g. Patient was contacted for the OOW date on May 8. Script was regenerated and pushed to the facility on May 19."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Manager Ask */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Manager Ask <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-muted-foreground mb-1.5">What exact decision or help do you need from a manager?</p>
            <textarea
              value={managerAsk}
              onChange={(e) => setManagerAsk(e.target.value)}
              rows={2}
              placeholder="e.g. Please confirm whether we can proceed without the OOW date or if we need to wait."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Urgency */}
          <div>
            <label className="block text-sm font-medium mb-1">Urgency</label>
            <p className="text-xs text-muted-foreground mb-2">How time-sensitive is this?</p>
            <div className="flex gap-2">
              {URGENCY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setUrgency(opt)}
                  className={`flex-1 py-1.5 px-2 rounded-md border text-xs font-medium transition-all ${
                    urgency === opt
                      ? `${URGENCY_COLORS[opt]} ring-2 ring-offset-1 ring-current`
                      : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/60"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={sending || !canSubmit}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Escalation
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
