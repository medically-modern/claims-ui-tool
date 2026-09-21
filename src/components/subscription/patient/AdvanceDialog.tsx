/**
 * AdvanceDialog — "Order anyway" for a circle the rules won't pass on their
 * own, with a reason. Used by two circles:
 *
 *   Confirm  — no reply with an OOP over $5, a negative-GP fill, a declined
 *              response… Writes Confirm Override (light green) and, because
 *              overriding implies the messages were read, Correspondence
 *              Reviewed.
 *   Auth     — a Medicaid DVS claim that came back "Payment Incorrect": it
 *              paid, just not the amount billed. The operator reads the
 *              per-code payments and ships anyway. Writes Auth Override
 *              (Brandon, 2026-09-21).
 *
 * What it writes, for THIS order only (lib/subscription/orderStamps.ts):
 *   - The circle's override stamp — turns that circle light green with the
 *     reason on it. A reason is always required.
 *   - Ordering Cycle = Ready to Order — only when, after that, all five
 *     circles are green; otherwise the row stays in Order Prep and the dialog
 *     says which circle is still holding it. Overrides are one circle at a
 *     time, each with its own reason (Brandon, 2026-09-20).
 */
import { useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { saveSubscriptionPatient, writeOrderStamps } from "@/api/setSubscriptionPatient";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { makeStamp } from "@/lib/subscription/orderStamps";
import { parseCodeResult } from "@/lib/subscription/circleDetail";
import { fmtUsd } from "@/lib/subscription/payerRules";
import { cn } from "@/lib/utils";
import { mrOf, type Checkpoint, type CheckpointKind, type SubscriptionPatient } from "../mockData";
import { operatorInitials } from "./PatientRail";

const NAMES: Record<CheckpointKind, string> = {
  confirmation: "Confirm", benefits: "Eligibility", auth: "Authorization", lastPaid: "Last Claim Paid", mr: "Medical Records",
};

/** Circles that advance in a scoped way — clear only their own circle, with a
 *  per-order stamp in their own column, never promoting the row (Brandon,
 *  2026-09-21). Each maps to the writeOrderStamps field it writes. */
const SCOPED_OVERRIDE: Partial<Record<CheckpointKind, "authOverride" | "lastPaidOverride">> = {
  auth: "authOverride",
  lastPaid: "lastPaidOverride",
};

function checksOf(p: SubscriptionPatient): Array<[CheckpointKind, Checkpoint]> {
  return [["confirmation", p.confirmation], ["benefits", p.benefits], ["auth", p.auth], ["lastPaid", p.lastPaid], ["mr", mrOf(p)]];
}

export function AdvanceDialog({ patient, open, onClose, kind = "confirmation" }: {
  patient: SubscriptionPatient | null;
  open: boolean;
  onClose: () => void;
  /** Which circle is being overridden. Confirm keeps the "Order anyway →
   *  Ready to Order" flow; Auth and Last Claim Paid are scoped "Advance <name>"
   *  overrides that flip only their own circle. Each writes a per-order stamp
   *  for its own column. */
  kind?: CheckpointKind;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { invalidate } = useInvalidateSubscription();

  const p = patient;
  const view = useMemo(() => {
    if (!p) return null;
    const checks = checksOf(p);
    const others = checks.filter(([k, c]) => k !== kind && c.tone !== "ok");
    // Read-before-ordering lines only belong to the Confirm override.
    const lines = kind === "confirmation"
      ? (p.confirmation.needsReadLines ?? (p.confirmation.needsRead ? [p.confirmation.needsRead] : []))
      : [];
    // Per-code Medicaid payments, for the Auth override — the numbers the
    // operator is deciding on.
    const live = p as SubscriptionPatient & Partial<LiveSubscriptionPatient>;
    const codes = kind === "auth"
      ? [parseCodeResult("A4230", live.a4230Claim, live.infusionSet1Qty), parseCodeResult("A4232", live.a4232Claim, live.cartridgeQty)].filter(Boolean)
      : [];
    // Claim states, for the Last Claim Paid override — the context the operator
    // is advancing past.
    const claims = kind === "lastPaid"
      ? [
          ["Primary claim", live.primaryClaimPaid || "not recorded"],
          ["Secondary claim", live.secondaryClaimPaid || "None"],
        ] as Array<[string, string]>
      : [];
    return { checks, others, lines, codes, claims };
  }, [p, kind]);
  if (!p || !view) return null;

  // Auth and Last Claim Paid are scoped: advancing one clears ONLY its own
  // circle, writes its own per-order stamp, and never promotes the row or
  // touches another circle (Brandon, 2026-09-21). Confirm keeps its "and if
  // everything else is green, go Ready to Order" behaviour.
  const scopedField = SCOPED_OVERRIDE[kind];
  const isScoped = !!scopedField;
  const canAdvance = view.others.length === 0;
  const needReason = reason.trim().length < 3;
  const primaryLabel = isScoped
    ? `Advance ${NAMES[kind]}`
    : canAdvance ? "Order anyway — Ready to Order" : "Order anyway (stays in Order Prep)";

  const go = async () => {
    if (needReason || saving) return;
    setSaving(true);
    try {
      const initials = operatorInitials();
      const stamp = makeStamp({ initials, nextOrderDate: p.nextOrderDate, reason: reason.trim() });
      if (scopedField) {
        // Just flip this one circle to a check. No promotion, nothing else
        // touched — the row's readiness recomputes on its own.
        await writeOrderStamps(p.mondayItemId, { [scopedField]: stamp });
        toast.success(`${NAMES[kind]} advanced for ${p.name}`);
      } else {
        // Confirm implies "I read the messages".
        await writeOrderStamps(p.mondayItemId, {
          correspondenceReviewed: makeStamp({ initials, nextOrderDate: p.nextOrderDate }),
          confirmOverride: stamp,
        });
        if (canAdvance) {
          const r = await saveSubscriptionPatient(p.mondayItemId, { orderingCycle: "Ready to Order" });
          if (r.failed.length) throw new Error(r.failed[0].error);
          toast.success(`${p.name} is Ready to Order`);
        } else {
          toast.success(`${NAMES[kind]} overridden for ${p.name}`, {
            description: `Still in Order Prep: ${view.others.map(([k, c]) => `${NAMES[k]} — ${c.label}`).join(" · ")}`,
          });
        }
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
          <DialogTitle className="text-[16px]">{isScoped ? `Advance ${NAMES[kind]}` : "Order anyway"} — {isScoped ? p.name : `${NAMES[kind]} for ${p.name}`}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {isScoped
              ? `Flips just the ${NAMES[kind]} circle to a check for the order due ${p.nextOrderDate || "—"}, with your reason on it. It doesn't change any other circle or send the order. Per order; it clears when the order goes out.`
              : `Overrides the ${NAMES[kind]} circle for the order due ${p.nextOrderDate || "—"}, with your reason on it. Per order; it clears when the order goes out.`}
          </DialogDescription>
        </DialogHeader>

        {view.lines.length > 0 && (
          <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900"><MessageSquare className="h-3.5 w-3.5" /> Read before ordering</div>
            <ul className="space-y-1 text-[12px] text-sky-950">{view.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div className="mt-1.5 text-[11px] text-sky-800">Ordering anyway marks these as reviewed for this order. A newer message raises the badge again.</div>
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

        {/* The whole-order check list belongs to the Confirm override, which
            decides whether the row is ready to send. Auth is scoped to its own
            circle, so it doesn't show (or act on) the other four. */}
        {!isScoped && (
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
        )}

        {(
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="text-[12px] font-semibold text-amber-900">{isScoped ? "Why is it OK to advance?" : "Why is it OK to order?"}</div>
            <div className="text-[11px] text-amber-800">Goes on the circle's hover as "Overridden by {operatorInitials()} — your reason", for this order only.</div>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "auth" ? "e.g. payer paid the fee-schedule rate; short by design, ship it" : kind === "lastPaid" ? "e.g. claim posted in the PM but not on the board yet; confirmed paid" : "e.g. confirmed by phone today, same address; or OOP is $0 on their plan"} className="mt-2 min-h-[64px] bg-white text-[12px]" />
          </div>
        )}

        {!isScoped && !canAdvance && (
          <div className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
            The row stays in Order Prep: {view.others.map(([k, c]) => `${NAMES[k]} is ${c.label}`).join("; ")}. Each of those is its own decision, from its own circle.
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" className="gap-1.5" onClick={() => void go()} disabled={saving || needReason} title={needReason ? "A reason is required" : undefined}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
