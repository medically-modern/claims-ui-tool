import { PATHWAYS, Patient, PathwayId } from "@/lib/samantha/workflow";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  patient: Patient;
  onPathwayChange: (id: PathwayId) => void;
  onItemToggle: (itemId: string, checked: boolean) => void;
}

export function PathwayPanel({ patient, onPathwayChange, onItemToggle }: Props) {
  const pathway = PATHWAYS.find((p) => p.id === patient.pathwayId);

  return (
    <section className="rounded-xl border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h2 className="text-base font-semibold">Coverage Pathway</h2>
          <p className="text-xs text-muted-foreground">Select the qualifying pathway for this product.</p>
        </div>
        <Select value={patient.pathwayId ?? ""} onValueChange={(v) => onPathwayChange(v as PathwayId)}>
          <SelectTrigger className="w-[280px]">
            <SelectValue placeholder="Choose pathway…" />
          </SelectTrigger>
          <SelectContent>
            {(["CGM", "Pump", "Supplies"] as const).map((group) => (
              <div key={group}>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
                {PATHWAYS.filter((p) => p.group === group).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="font-mono text-xs mr-2">{p.code}</span>
                    {p.name}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pathway ? (
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded text-[10px] font-semibold tracking-wider bg-primary/10 text-primary mb-3">
            {pathway.tag}
          </div>
          <div className="space-y-2 mb-4">
            {pathway.items.map((item) => (
              <label
                key={item.id}
                className="flex gap-3 p-2.5 rounded-lg border bg-background hover:border-primary/30 cursor-pointer"
              >
                <Checkbox
                  checked={!!patient.pathwayChecks[item.id]}
                  onCheckedChange={(c) => onItemToggle(item.id, !!c)}
                  className="mt-0.5"
                />
                <span className="text-sm">{item.label}</span>
              </label>
            ))}
          </div>
          {pathway.language && (
            <div className="rounded-lg bg-muted/50 border-l-4 border-accent p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-accent mb-1">Language to confirm</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{pathway.language}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">Select a pathway to load its checklist.</p>
      )}
    </section>
  );
}
