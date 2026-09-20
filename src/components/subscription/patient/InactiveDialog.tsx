/**
 * InactiveDialog — move a patient to Not Active from the profile header
 * (Brandon, 2026-09-20: "an inactive button next to pause"). Uses the same
 * churn write the Paused lane's check-in dialog uses: Dead Reason, Status =
 * Not Active, block fields cleared, item moved to the Not Active group.
 * Reactivation is always possible — Not Active is a parking lot.
 */
import { useState } from "react";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { churnPatient } from "@/api/blockPatient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { DEAD_REASONS } from "@/lib/subscription/lanes";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";

export function InactiveDialog({ patient, open, onClose }: { patient: LiveSubscriptionPatient | null; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { invalidate } = useInvalidateSubscription();
  const p = patient;
  if (!p) return null;

  const go = async () => {
    if (!reason || saving) return;
    setSaving(true);
    try {
      const res = await churnPatient(p.mondayItemId, { deadReason: reason, note: note.trim() || undefined, existingNote: p.blockNote });
      if (res.failed.length) throw new Error(res.failed[0].error);
      toast.success(`${p.name} moved to Not Active (${reason})`);
      setReason(""); setNote("");
      void invalidate();
      onClose();
    } catch (e) {
      toast.error("Couldn't move to Not Active", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Move {p.name} to Not Active?</DialogTitle>
          <DialogDescription className="text-[12px]">
            Leaves every lane and the Order Cycle. The row moves to the Not Active group on Monday; it can be reactivated later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reason</div>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-9 text-[13px]"><SelectValue placeholder="Pick a reason" /></SelectTrigger>
            <SelectContent>{DEAD_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — logged on the item" className="min-h-[60px] text-[12px]" />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" className="gap-1.5 bg-rose-700 hover:bg-rose-800" onClick={() => void go()} disabled={!reason || saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />} Yes, move to Not Active
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
