// Pre-submit guard dialog for BCBS / Anthem claims.
//
// Renders the output of evaluateBcbsSubmit() (see lib/claims/bcbsSubmitGuard.ts)
// in one of three modes:
//
//   1. Hard stops only      → "Can't submit" panel with the list of
//                             errors + fixes; the only action is Close.
//   2. Soft warnings only   → "Confirm submit" panel listing the
//                             warnings; the operator can Cancel or
//                             Submit anyway.
//   3. Both hard + soft     → Hard stops win; Submit anyway is hidden
//                             until the operator clears the blocking
//                             errors.
//
// The caller decides whether to invoke this dialog at all — typically
// by running evaluateBcbsSubmit() inside the row's Submit click
// handler. When `applies===false` (claim isn't BCBS), skip the dialog
// entirely.

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
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { BcbsGuardResult } from "@/lib/claims/bcbsSubmitGuard";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Patient name — shown in the dialog title for context. */
  patientName: string;
  /** Validator output. Re-evaluated by the caller on each Submit click;
   *  the dialog is a pure renderer. */
  result: BcbsGuardResult;
  /** Called when the operator clicks "Submit anyway" in soft-warning
   *  mode. Not called when hard stops are present. */
  onConfirm: () => void;
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

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasHardStops ? (
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
                Fix before submitting
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
        </div>

        <AlertDialogFooter>
          {showConfirm ? (
            <>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                Submit anyway
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
