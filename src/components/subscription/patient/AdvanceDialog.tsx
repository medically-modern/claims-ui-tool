/**
 * AdvanceDialog — the operator's other decision (the first being Pause):
 * "I've looked at this patient; move them on to Ready to Order."
 *
 * What it writes, for THIS order only (lib/subscription/orderStamps.ts):
 *   - Correspondence Reviewed — always: the messages for this order are read,
 *     so the badge drops and stops holding the row in Order Prep.
 *   - Confirm Override — when the Confirm circle is not green: turns it into a
 *     light green with the reason on the hover. A reason is required.
 *   - Ordering Cycle = Ready to Order — when, after that, all five circles are
 *     green. If another circle is still red or amber the row stays in Order
 *     Prep and the dialog says which one; nothing here overrides those.
 *
 * Opened from the patient header (next to Pause) and from the Confirm circle
 * on the Order Prep board (Brandon, 2026-09-20).
 */
import { useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { saveSubscriptionPatient, writeOrderStamps } from "@/api/setSubscriptionPatient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { makeStamp } from "@/lib/subscription/orderStamps";
import { cn } from "@/lib/utils";
import { mrOf, type Checkpoint, type CheckpointKind, type SubscriptionPatient } from "../mockData";
import { operatorInitials } from "./PatientRail";

const NAMES: Record<CheckpointKind, string> = {
  confirmation: "Confirm", benefits: "Eligibility", auth: "Authorization", lastPaid: "Last Claim Paid", mr: "Medical Records",
};

function checksOf(p: SubscriptionPatient): Array<[CheckpointKind, Checkpoint]> {
  return [["confirmation", p.confirmation], ["benefits", p.benefits], ["auth", p.auth], ["lastPaid", p.lastPaid], ["mr", mrOf(p)]];
}

export function AdvanceDialog({ patient, open, onClose }: {
  patient: SubscriptionPatient | null;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { invalidate } = useInvalidateSubscription();

  const p = patient;
  const view = useMemo(() => {
    if (!p) return null;
    const checks = checksOf(p);
    const confirmOk = p.confirmation.tone === "ok";
    const others = checks.filter(([k, c]) => k !== "confirmation" && c.tone !== "ok");
    const lines = p.confirmation.needsReadLines ?? (p.confirmation.needsRead ? [p.confirmation.needsRead] : []);
    return { checks, confirmOk, others, lines, needsRead: !!p.confirmation.needsRead };
  }, [p]);
  if (!p || !view) return null;

  const willOverride = !view.confirmOk;
  const canAdvance = view.others.length === 0;
  const needReason = willOverride && reason.trim().length < 3;
  const primaryLabel = canAdvance
    ? (willOverride ? "Override Confirm & advance to Ready to Order" : view.needsRead ? "Mark reviewed & advance to Ready to Order" : "Advance to Ready to Order")
    : (willOverride ? "Override Confirm (stays in Order Prep)" : "Mark messages reviewed");

  const go = async () => {
    if (needReason || saving) return;
    setSaving(true);
    try {
      const initials = operatorInitials();
      const stamps: { correspondenceReviewed?: string; confirmOverride?: string } = {
        correspondenceReviewed: makeStamp({ initials, nextOrderDate: p.nextOrderDate }),
      };
      if (willOverride) stamps.confirmOverride = makeStamp({ initials, nextOrderDate: p.nextOrderDate, reason: reason.trim() });
      await writeOrderStamps(p.mondayItemId, stamps);
      if (canAdvance) {
        const r = await saveSubscriptionPatient(p.mondayItemId, { orderingCycle: "Ready to Order" });
        if (r.failed.length) throw new Error(r.failed[0].error);
        toast.success(`${p.name} is Ready to Order`);
      } else {
        toast.success(willOverride ? `Confirm overridden for ${p.name}` : `Messages marked reviewed for ${p.name}`, {
          description: `Still in Order Prep: ${view.others.map(([k, c]) => `${NAMES[k]} — ${c.label}`).join(" · ")}`,
        });
      }
      setReason("");
      void invalidate();
      onClose();
    } catch (e) {
      toast.error("Couldn't advance", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[16px]">Advance {p.name} to Ready to Order</DialogTitle>
          <DialogDescription className="text-[12px]">
            For the order due {p.nextOrderDate || "—"}. This decision is per order; it clears when the order goes out.
          </DialogDescription>
        </DialogHeader>

        {view.lines.length > 0 && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900"><MessageSquare className="h-3.5 w-3.5" /> Read before ordering</div>
            <ul className="space-y-1 text-[12px] text-sky-950">{view.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div className="mt-1.5 text-[11px] text-sky-800">Advancing marks these as reviewed for this order. A newer message raises the badge again.</div>
          </div>
        )}

        <div className="space-y-1">
          {view.checks.map(([k, c]) => {
            const ok = c.tone === "ok";
            return (
              <div key={k} className="flex items-center gap-2 text-[12px]">
                <span className={cn("grid h-4 w-4 place-items-center rounded-full", ok ? "bg-emerald-600 text-white" : c.tone === "bad" ? "bg-rose-600 text-white" : "bg-amber-400 text-white")}>
                  {ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : c.tone === "bad" ? <X className="h-2.5 w-2.5" strokeWidth={3} /> : <span className="text-[9px] font-bold">!</span>}
                </span>
                <span className="w-32 font-medium">{NAMES[k]}</span>
                <span className="text-muted-foreground">{c.label}{c.why ? ` — ${c.why}` : c.detail ? ` — ${c.detail}` : ""}</span>
              </div>
            );
          })}
        </div>

        {willOverride && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-[12px] font-semibold text-amber-900">Confirm is not green — say why it's OK to order</div>
            <div className="text-[11px] text-amber-800">Goes on the circle's hover as "Overridden by {operatorInitials()} — your reason", for this order only.</div>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. confirmed by phone today, same address; or OOP is $0 on their plan" className="mt-2 min-h-[64px] bg-white text-[12px]" />
          </div>
        )}

        {!canAdvance && (
          <div className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
            The row stays in Order Prep: {view.others.map(([k, c]) => `${NAMES[k]} is ${c.label}`).join("; ")}. Those are not overridden here.
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={() => void go()} disabled={saving || needReason} title={needReason ? "A reason is required to override Confirm" : undefined}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
