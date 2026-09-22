/**
 * AdvanceDialog — "Advance <circle>": the rules won't pass a circle on their
 * own and the operator advances just that one circle, with a reason. Every
 * circle works the same way now (Brandon, 2026-09-22): the override is SCOPED —
 * it flips only its own circle to a light-green check and never promotes the row
 * or touches another circle. When all five circles are green the row becomes
 * Ready to Order on its own (readiness is derived from the circles), and the
 * operator sends it from the Ready tab.
 *
 * What each circle writes, for THIS order only (lib/subscription/orderStamps.ts):
 *   Confirm          Confirm Override (+ Correspondence Reviewed — overriding
 *                    Confirm implies its messages were read)
 *   Eligibility      Eligibility Override
 *   Authorization    Auth Override
 *   Last Claim Paid  Last Claim Paid Override
 *   Medical Records  Medical Records Override
 * A reason is always required; it lands on the circle's hover.
 */
import { useMemo, useState } from "react";
import { ArrowRight, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { writeOrderStamps } from "@/api/setSubscriptionPatient";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { makeStamp } from "@/lib/subscription/orderStamps";
import { parseCodeResult } from "@/lib/subscription/circleDetail";
import { fmtUsd } from "@/lib/subscription/payerRules";
import { type CheckpointKind, type SubscriptionPatient } from "../mockData";
import { operatorInitials } from "./PatientRail";

const NAMES: Record<CheckpointKind, string> = {
  confirmation: "Confirm", benefits: "Eligibility", auth: "Authorization", lastPaid: "Last Claim Paid", mr: "Medical Records",
};

const REASON_PLACEHOLDER: Record<CheckpointKind, string> = {
  confirmation: "e.g. confirmed by phone today, same address; or OOP is $0 on their plan",
  benefits: "e.g. verified active in the payer portal; the board check is just stale",
  auth: "e.g. payer paid the fee-schedule rate; short by design, ship it",
  lastPaid: "e.g. claim posted in the PM but not on the board yet; confirmed paid",
  mr: "e.g. valid MR on file in the chart; the expiry on the board is wrong",
};

export function AdvanceDialog({ patient, open, onClose, kind = "confirmation" }: {
  patient: SubscriptionPatient | null;
  open: boolean;
  onClose: () => void;
  /** Which circle is being advanced. Every kind is a scoped override that flips
   *  only its own circle and writes its own per-order stamp. */
  kind?: CheckpointKind;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { invalidate } = useInvalidateSubscription();

  const p = patient;
  const view = useMemo(() => {
    if (!p) return null;
    // Read-before-ordering lines only belong to the Confirm override.
    const lines = kind === "confirmation"
      ? (p.confirmation.needsReadLines ?? (p.confirmation.needsRead ? [p.confirmation.needsRead] : []))
      : [];
    const live = p as SubscriptionPatient & Partial<LiveSubscriptionPatient>;
    // Per-code Medicaid payments, for the Auth override.
    const codes = kind === "auth"
      ? [parseCodeResult("A4230", live.a4230Claim, live.infusionSet1Qty), parseCodeResult("A4232", live.a4232Claim, live.cartridgeQty)].filter(Boolean)
      : [];
    // Claim states, for the Last Claim Paid override.
    const claims = kind === "lastPaid"
      ? [
          ["Primary claim", live.primaryClaimPaid || "not recorded"],
          ["Secondary claim", live.secondaryClaimPaid || "None"],
        ] as Array<[string, string]>
      : [];
    return { lines, codes, claims };
  }, [p, kind]);
  if (!p || !view) return null;

  const needReason = reason.trim().length < 3;

  const go = async () => {
    if (needReason || saving) return;
    setSaving(true);
    try {
      const initials = operatorInitials();
      const stamp = makeStamp({ initials, nextOrderDate: p.nextOrderDate, reason: reason.trim() });
      // Each circle writes only its own per-order override column. Confirm also
      // marks its correspondence reviewed (overriding Confirm implies you read
      // its messages). No promotion — readiness recomputes from the circles.
      const stamps: Parameters<typeof writeOrderStamps>[1] =
        kind === "confirmation" ? { confirmOverride: stamp, correspondenceReviewed: makeStamp({ initials, nextOrderDate: p.nextOrderDate }) }
        : kind === "benefits"   ? { benefitsOverride: stamp }
        : kind === "auth"       ? { authOverride: stamp }
        : kind === "lastPaid"   ? { lastPaidOverride: stamp }
        :                         { mrOverride: stamp };
      await writeOrderStamps(p.mondayItemId, stamps);
      toast.success(`${NAMES[kind]} advanced for ${p.name}`);
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
          <DialogTitle className="text-[16px]">Advance {NAMES[kind]} — {p.name}</DialogTitle>
          <DialogDescription className="text-[12px]">
            Flips just the {NAMES[kind]} circle to a check for the order due {p.nextOrderDate || "—"}, with your reason on it. It doesn't change any other circle or send the order. Per order; it clears when the order goes out.
          </DialogDescription>
        </DialogHeader>

        {view.lines.length > 0 && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900"><MessageSquare className="h-3.5 w-3.5" /> Read before ordering</div>
            <ul className="space-y-1 text-[12px] text-sky-950">{view.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div className="mt-1.5 text-[11px] text-sky-800">Advancing marks these as reviewed for this order. A newer message raises the badge again.</div>
          </div>
        )}

        {view.codes.length > 0 && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-900">Medicaid paid</div>
            <div className="space-y-1 text-[12px] text-rose-950">
              {view.codes.map((r) => (
                <div key={r!.code} className="flex items-center justify-between gap-2">
                  <span>{r!.item} <span className="text-rose-700/70">({r!.code})</span></span>
                  <span className="font-medium tabular-nums">
                    {r!.paid != null
                      ? `${fmtUsd(r!.paid)}${r!.expected != null ? (r!.full ? " · full" : ` · expected ${fmtUsd(r!.expected)}`) : ""}`
                      : `Denied — ${r!.denied}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {view.claims.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">Claim status</div>
            <div className="space-y-1 text-[12px] text-slate-800">
              {view.claims.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span>{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="text-[12px] font-semibold text-amber-900">Why is it OK to advance?</div>
          <div className="text-[11px] text-amber-800">Goes on the circle's hover as "Overridden by {operatorInitials()} — your reason", for this order only.</div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={REASON_PLACEHOLDER[kind]} className="mt-2 min-h-[64px] bg-white text-[12px]" />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={() => void go()} disabled={saving || needReason} title={needReason ? "A reason is required" : undefined}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Advance {NAMES[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
