/**
 * FollowUpModal — modal for marking a patient as Follow Up.
 * Shows a date picker for the follow-up date and a confirm button.
 * On confirm: writes FOLLOW UP status (index 1) and FOLLOW UP DATE to Monday.
 * Mirrors BlockedModal on the Evaluate board with friendly white/blue styling.
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
import { Clock, Loader2 } from "lucide-react";
import { writeStatusIndex, writeDate, COL } from "@/lib/samantha/mondayApi";
import { FOLLOW_UP_INDEX } from "@/lib/samantha/mondayMapping";
import { toast } from "sonner";

/** Convert YYYY-MM-DD → MM/DD/YYYY */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  onSuccess: () => void;
}

export function FollowUpModal({ open, onOpenChange, patientId, patientName, onSuccess }: Props) {
  const [followUpDate, setFollowUpDate] = useState("");
  const [sending, setSending] = useState(false);

  const handleConfirm = async () => {
    if (!followUpDate) {
      toast.error("Please select a follow-up date.");
      return;
    }
    setSending(true);
    try {
      // Write both columns in parallel
      await Promise.all([
        writeStatusIndex(patientId, COL.followUp, FOLLOW_UP_INDEX.followUp),
        writeDate(patientId, COL.followUpDate, followUpDate),
      ]);
      toast.success(`${patientName} marked for Follow Up on ${fmtDate(followUpDate)}`);
      onOpenChange(false);
      setFollowUpDate("");
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[FollowUpModal] Failed to set follow up:", msg);
      toast.error(`Failed to set follow up: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-blue-500" />
            Follow Up
          </DialogTitle>
          <DialogDescription>
            Mark <strong>{patientName}</strong> for follow up. Choose the date when this patient should return to the active queue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium mb-1.5">Follow-Up Date</label>
            <input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The patient will return to the active queue on this date.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={sending || !followUpDate}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              Confirm Follow Up
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
