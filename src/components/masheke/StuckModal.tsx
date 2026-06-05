/**
 * StuckModal — modal for marking a patient as Stuck.
 * On confirm: writes STUCK status (index 2) to the Advancer 2C column on Monday.
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
import { AlertTriangle, Loader2 } from "lucide-react";
import { writeStatusIndex, COL } from "@/lib/masheke/mondayApi";
import { ADVANCER_2C_INDEX } from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  patientName: string;
  onSuccess: () => void;
}

export function StuckModal({ open, onOpenChange, patientId, patientName, onSuccess }: Props) {
  const [sending, setSending] = useState(false);

  const handleConfirm = async () => {
    setSending(true);
    try {
      await writeStatusIndex(patientId, COL.advancer2c, ADVANCER_2C_INDEX.stuck);
      toast.success(`${patientName} marked as Stuck`);
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[StuckModal] Failed to mark patient stuck:", msg);
      toast.error(`Failed to mark patient stuck: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Mark Patient Stuck
          </DialogTitle>
          <DialogDescription>
            Mark <strong>{patientName}</strong> as stuck. This patient will be moved to the Stuck section and removed from the active queue. You can unstick them at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={sending}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
            Confirm Stuck
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
