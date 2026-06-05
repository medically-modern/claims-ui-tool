/**
 * WhatsNeededCard — read-only "Ask the Doctor For" card showing
 * the consolidated MN request items and medical necessity status.
 * Shared across Send Request, Confirm Receipt, and Chase Clinicals.
 */
import type { Patient } from "@/lib/masheke/workflow";
import { AlertTriangle, Check, X } from "lucide-react";

function splitDropdownText(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function WhatsNeededCard({ patient }: { patient: Patient }) {
  const established = patient.medicalNecessity === "Established";
  const asks = splitDropdownText(patient.mnRequestConsolidated);
  const allClean = established && asks.length === 0;

  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Ask the doctor for
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">
            Rolled up from the Evaluate tab — what to actually request on the call.
          </p>
        </div>
        {established ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-full px-3 py-1">
            <Check className="h-3.5 w-3.5" />
            Medical Necessity: Established
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-300 rounded-full px-3 py-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Medical Necessity: Not Established
          </span>
        )}
      </div>

      {allClean ? (
        <p className="text-xs text-muted-foreground italic">
          No outstanding reasons — patient is ready.
        </p>
      ) : asks.length === 0 ? (
        <p className="text-xs text-amber-700 italic">
          MN is not established but no consolidated ask list yet — go back to the Evaluate tab and Send to Monday so the new column populates.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {asks.map((a) => (
            <li
              key={a}
              className="flex items-start gap-2 text-xs px-3 py-1.5 rounded-md border bg-rose-50 border-rose-200 text-rose-900"
            >
              <X className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="font-medium">{a}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
