/**
 * BlockedModal — modal for marking a patient as Blocked.
 * Shows a date picker for the unblock (expiry) date and a confirm button.
 * On confirm: writes BLOCKED status (index 0) and BLOCKED DATE to Monday.
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
import { Ban, Loader2 } from "lucide-react";
import { writeStatusIndex, writeDate, COL } from "@/lib/masheke/mondayApi";
import { BLOCKED_INDEX } from "@/lib/masheke/mondayMapping";
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
  onSuccess: () => void; // called after successful write to trigger refetch
}

export function BlockedModal({ open, onOpenChange, patientId, patientName, onSuccess }: Props) {
  const [blockedDate, setBlockedDate] = useState("");
  const [sending, setSending] = useState(false);

  const handleConfirm = async () => {
    if (!blockedDate) {
      toast.error("Please select an unblock date.");
      return;
    }
    setSending(true);
    try {
      // Write both columns in parallel
      await Promise.all([
        writeStatusIndex(patientId, COL.blocked, BLOCKED_INDEX.blocked),
        writeDate(patientId, COL.blockedDate, blockedDate),
      ]);
      toast.success(`${patientName} marked as Blocked until ${fmtDate(blockedDate)}`);
      onOpenChange(false);
      setBlockedDate("");
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BlockedModal] Failed to block patient:", msg);
      toast.error(`Failed to block patient: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-red-500" />
            Block Patient
          </DialogTitle>
          <DialogDescription>
            Mark <strong>{patientName}</strong> as blocked. Choose the date when the block should automatically expire and the patient returns to the active queue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium mb-1.5">Unblock Date</label>
            <input
              type="date"
              value={blockedDate}
              onChange={(e) => setBlockedDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The patient will be automatically unblocked on this date.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={sending || !blockedDate}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Confirm Block
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
