// Pre-submit guard dialog for BCBS / Anthem claims.
//
// Renders the output of evaluateBcbsSubmit() (see lib/claims/bcbsSubmitGuard.ts)
// in one of four modes:
//
//   1. Hard stops only      → "Can't submit" panel with the list of
//                             errors + fixes; the only action is Close.
//   2. Overridable stops    → same panel, plus an "Override" disclosure
//      only (POS rules)       (checkbox + required reason) that unlocks
//                             a "Submit with override" action. See
//                             OVERRIDABLE_HARD_STOP_CODES.
//   3. Soft warnings only   → "Confirm submit" panel listing the
//                             warnings; the operator can Cancel or
//                             Submit anyway.
//   4. Both hard + soft     → Hard stops win. If every hard stop is
//                             overridable the override path is offered;
//                             otherwise submit stays locked.
//
// The caller decides whether to invoke this dialog at all — typically
// by running evaluateBcbsSubmit() inside the row's Submit click
// handler. When `applies===false` (claim isn't BCBS), skip the dialog
// entirely.

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import {
  canOverrideHardStops,
  type BcbsGuardResult,
} from "@/lib/claims/bcbsSubmitGuard";

/** Minimum characters of justification before the override unlocks.
 *  Low enough not to be annoying ("pt seen in office 8/4"), high enough
 *  that "x" doesn't count as a reason. */
const MIN_REASON_LENGTH = 8;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Patient name — shown in the dialog title for context. */
  patientName: string;
  /** Validator output. Re-evaluated by the caller on each Submit click;
   *  the dialog is a pure renderer. */
  result: BcbsGuardResult;
  /** Called when the operator confirms. `overrideReason` is set only on
   *  the POS-override path (mode 2) — the caller is responsible for
   *  writing it to the row's Action Context for the audit trail. */
  onConfirm: (overrideReason?: string) => void;
}

export function BcbsSubmitGuardDialog({
  open,
  onOpenChange,
  patientName,
  result,
  onConfirm,
}: Props) {
  const hasHardStops = result.hardStops.length > 0;
  const hasWarnings = result.warnings.length > 0;
  const showConfirm = !hasHardStops && hasWarnings;
  // POS-only blocks can be knowingly bypassed; anything else (wrong
  // payer ID, unresolvable patient state) stays locked.
  const overrideAvailable = canOverrideHardStops(result);

  const [overrideChecked, setOverrideChecked] = useState(false);
  const [reason, setReason] = useState("");

  // Reset the override affordance every time the dialog opens for a new
  // row, so a prior override can't leak into the next claim.
  useEffect(() => {
    if (open) {
      setOverrideChecked(false);
      setReason("");
    }
  }, [open, patientName]);

  const reasonOk = reason.trim().length >= MIN_REASON_LENGTH;
  const canSubmitOverride = overrideAvailable && overrideChecked && reasonOk;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasHardStops && overrideAvailable ? (
              // Blocked, but the operator has a legitimate way through —
              // don't say "can't submit" when they can.
              <>
                <ShieldAlert className="h-5 w-5 text-amber-600" />
                Check POS before submitting {patientName}
              </>
            ) : hasHardStops ? (
              <>
                <ShieldAlert className="h-5 w-5 text-rose-600" />
                Can't submit {patientName}
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Confirm submit for {patientName}
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            BCBS / Anthem pre-submit validator results.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          {hasHardStops && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                {overrideAvailable ? "Fix — or override below" : "Fix before submitting"}
              </div>
              <ul className="mt-2 space-y-2">
                {result.hardStops.map((hs) => (
                  <li
                    key={hs.code}
                    className="rounded-md border border-rose-200 bg-rose-50 p-3"
                  >
                    <div className="font-medium text-rose-900">{hs.message}</div>
                    <div className="mt-1 text-xs text-rose-800">{hs.fix}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasWarnings && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Before you submit
              </div>
              <ul className="mt-2 space-y-2">
                {result.warnings.map((w) => (
                  <li
                    key={w.code}
                    className="rounded-md border border-amber-200 bg-amber-50 p-3"
                  >
                    <div className="font-medium text-amber-900">{w.message}</div>
                    <div className="mt-1 text-xs text-amber-800">
                      {w.detail ??
                        "Confirm with the home plan that auth was obtained, then submit anyway if it's good."}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Override escape hatch — POS blocks only. Rare-but-real case:
              a NY/NJ patient genuinely billed at POS 11 (Office). Requires
              an explicit check + a typed reason, which the caller writes
              to Action Context on Monday. */}
          {overrideAvailable && (
            <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="bcbs-pos-override"
                  checked={overrideChecked}
                  onCheckedChange={(v) => setOverrideChecked(v === true)}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="bcbs-pos-override"
                    className="cursor-pointer text-sm font-medium text-slate-900"
                  >
                    Override — submit with POS as-is
                  </Label>
                  <p className="text-xs text-slate-600">
                    Only for claims that really should bill at the POS
                    currently on the row. The reason is saved to Action
                    Context on the Monday row.
                  </p>
                </div>
              </div>

              {overrideChecked && (
                <div className="mt-3 space-y-1">
                  <Label
                    htmlFor="bcbs-pos-override-reason"
                    className="text-xs font-medium text-slate-700"
                  >
                    Why is this POS correct?
                  </Label>
                  <Textarea
                    id="bcbs-pos-override-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    autoFocus
                    placeholder="e.g. Pt seen in the office 8/4 — confirmed w/ Empire rep, bill POS 11"
                    className="text-sm"
                  />
                  {!reasonOk && (
                    <p className="text-xs text-slate-500">
                      Add a short reason ({MIN_REASON_LENGTH}+ characters) to
                      unlock submit.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <AlertDialogFooter>
          {showConfirm ? (
            <>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onConfirm()}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                Submit anyway
              </AlertDialogAction>
            </>
          ) : overrideAvailable ? (
            <>
              <AlertDialogCancel>Close</AlertDialogCancel>
              <AlertDialogAction
                disabled={!canSubmitOverride}
                onClick={(e) => {
                  // Guard against Enter-key activation while locked.
                  if (!canSubmitOverride) {
                    e.preventDefault();
                    return;
                  }
                  onConfirm(reason.trim());
                }}
                className="bg-rose-600 text-white hover:bg-rose-700 disabled:pointer-events-none disabled:opacity-50"
              >
                Submit with override
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogCancel>Close</AlertDialogCancel>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
