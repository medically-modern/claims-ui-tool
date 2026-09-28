/**
 * InsuranceReviewBanner — the profile half of the "re-check after an insurance
 * change" review (Brandon, 2026-09-28).
 *
 * Shows when the board's Insurance Change? is Yes (with the backend's own
 * "what changed" diff), or when a Medicaid patient is still set to serve
 * Sensors (Medicaid is supplies-only). "Mark reconciled" calls the backend's
 * re-anchor endpoint, which snapshots the patient's current insurance as the
 * new baseline AND sets the flag to No — writing the column by hand wouldn't
 * stick, the next eligibility check re-diffs against the old baseline.
 */
import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { isReanchorConfigured, reanchorInsuranceBaseline } from "@/api/insuranceBaseline";
import { Button } from "@/components/ui/button";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import type { ProfileDraft } from "./draft";

/** The backend's diff is "Changed since last order (date):\nMember ID: a → b\n…" */
function changeLines(detail: string): { since: string; lines: string[] } {
  const rows = String(detail || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const head = /^changed since last order \(([^)]+)\)/i.exec(rows[0] ?? "");
  return { since: head?.[1] ?? "", lines: head ? rows.slice(1) : rows };
}

export function InsuranceReviewBanner({ p, draft }: { p: LiveSubscriptionPatient; draft: ProfileDraft }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { invalidate } = useInvalidateSubscription();

  const changed = /^yes$/i.test(p.insuranceChange || "") && !done;
  // Keyed off the draft so switching Subscription to Supplies clears it live.
  const medicaidSensors = /medicaid/i.test(draft.primaryInsurance || "") && /sensor/i.test(draft.subscriptionType || "");
  if (!changed && !medicaidSensors) return null;

  const { since, lines } = changeLines(p.insuranceChangeDetail);

  const reconcile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reanchorInsuranceBaseline(p.mondayItemId);
      setDone(true);
      toast.success("Insurance change reconciled", { description: "The current insurance is now the baseline; the flag is cleared." });
      void invalidate();
    } catch (e) {
      toast.error("Couldn't reconcile", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-amber-900">
            {changed ? "Insurance changed — re-check before ordering" : "Serving conflict — re-check"}
          </div>
          {changed && lines.length > 0 && (
            <div className="mt-1.5 rounded-md border border-amber-200 bg-white/70 px-2.5 py-1.5 text-[12px] text-amber-950">
              {since && <div className="mb-0.5 text-[11px] text-amber-700">What changed since {since}</div>}
              {lines.map((l, i) => <div key={i} className="break-words">{l}</div>)}
            </div>
          )}
          {medicaidSensors && (
            <div className="mt-1.5 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[12px] font-medium text-rose-800">
              Medicaid is supplies-only, but Subscription is “{draft.subscriptionType || p.subscriptionType}”. Switch it to Supplies below — sensors can’t be served on Medicaid.
            </div>
          )}
          <ul className="mt-2 space-y-0.5 text-[12px] text-amber-900">
            <li>• Re-verify the Sensors &amp; Supplies auth requirements (editable in Medical necessity &amp; auth).</li>
            <li>• Confirm serving is right for the new payer (Medicaid = supplies only).</li>
            <li>• Confirm Member ID matches the new payer.</li>
            <li>• Re-run eligibility for the new plan.</li>
          </ul>
          {changed && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy || !isReanchorConfigured()}
                className="h-8 border-amber-400 bg-white text-[12px] text-amber-900 hover:bg-amber-100"
                title={isReanchorConfigured() ? "Accept the current insurance as the new baseline and clear the flag" : "Not configured for this build"}
                onClick={() => void reconcile()}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Mark reconciled
              </Button>
              <span className="text-[11px] text-amber-700">saves right away — the current insurance becomes the baseline</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
