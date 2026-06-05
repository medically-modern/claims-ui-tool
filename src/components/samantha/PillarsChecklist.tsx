import { PILLARS, Patient } from "@/lib/samantha/workflow";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2 } from "lucide-react";

interface Props {
  patient: Patient;
  onToggle: (id: string, checked: boolean) => void;
}

export function PillarsChecklist({ patient, onToggle }: Props) {
  const allDone = PILLARS.every((p) => patient.pillars[p.id]);
  return (
    <section className="rounded-xl border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold">3 Pillars · Medical Necessity</h2>
          <p className="text-xs text-muted-foreground">All three required before advancing.</p>
        </div>
        {allDone && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/15 text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Necessity established
          </span>
        )}
      </div>
      <div className="space-y-3">
        {PILLARS.map((pillar, i) => (
          <label
            key={pillar.id}
            className="flex gap-3 p-3 rounded-lg border bg-background hover:border-primary/30 cursor-pointer transition-colors"
          >
            <Checkbox
              checked={!!patient.pillars[pillar.id]}
              onCheckedChange={(c) => onToggle(pillar.id, !!c)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">PILLAR 0{i + 1}</span>
                <span className="font-medium text-sm">{pillar.label}</span>
              </div>
              {pillar.hint && <p className="text-xs text-muted-foreground mt-0.5">{pillar.hint}</p>}
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}
