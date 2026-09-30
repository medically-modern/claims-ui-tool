/**
 * SplitProfileDialog — split a "Sensors & Supplies" patient into two
 * subscriptions (Brandon, 2026-09-29). This profile becomes Sensors only and
 * keeps its claims and order history; a new profile is created for Supplies
 * only. Opens the new Supplies profile when done.
 */
import { useState } from "react";
import { Loader2, Split } from "lucide-react";
import { toast } from "sonner";
import { splitSubscription } from "@/api/splitSubscription";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { useOpenPatient } from "./openPatient";

export function SplitProfileDialog({ patient, open, onClose }: {
  patient: LiveSubscriptionPatient;
  open: boolean;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const { invalidate } = useInvalidateSubscription();
  const { open: openPatient } = useOpenPatient();
  const p = patient;

  const go = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await splitSubscription(p.mondayItemId, p.name);
      if (r.failed.length) {
        toast.warning(`Split ${p.name}, but ${r.failed.length} field${r.failed.length === 1 ? "" : "s"} didn't update`, {
          description: r.failed.slice(0, 3).map((f) => `${f.item} · ${f.col}: ${f.error}`).join("\n"),
          duration: 12_000,
        });
      } else {
        toast.success(`Split ${p.name} into Sensors and Supplies`, {
          description: "This profile is now Sensors only. Opening the new Supplies profile.",
        });
      }
      await invalidate();
      onClose();
      openPatient(r.suppliesItemId);
    } catch (e) {
      toast.error("Couldn't split the profile", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Split into Sensors and Supplies?</DialogTitle>
          <DialogDescription className="text-[12px]">
            This creates a new Supplies profile for {p.name}.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-[12px] text-muted-foreground">
          <li><b className="text-foreground">This profile → Sensors only.</b> Keeps its claims and order history. Supplies, infusion sets, cartridges and their auth IDs are cleared.</li>
          <li><b className="text-foreground">New profile → Supplies only.</b> Same patient, insurance, doctor, docs and next order date. Sensors, CGM qty and the sensors auth ID are cleared.</li>
          <li>Financials recalculate on both. Each profile gets its own reorder text.</li>
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700" onClick={() => void go()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Split className="h-3.5 w-3.5" />} Yes, split profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
