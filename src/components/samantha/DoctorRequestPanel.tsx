import { Patient, PARACHUTE_STEPS, FAX_PHASE1_STEPS, FAX_PHASE2_STEPS, ContactMethod } from "@/lib/samantha/workflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlertTriangle, ArrowUpRight, ChevronRight, Clock, Radio, Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  patient: Patient;
  onMethodChange: (m: ContactMethod) => void;
  onAdvanceStep: () => void;
  onResetStep: () => void;
  onPhaseChange: (phase: 1 | 2) => void;
  onLogAccountability: (rep: { representativeName: string; representativeTitle: string }) => void;
  onEscalate: () => void;
}

export function DoctorRequestPanel({
  patient,
  onMethodChange,
  onAdvanceStep,
  onResetStep,
  onPhaseChange,
  onLogAccountability,
  onEscalate,
}: Props) {
  const isParachute = patient.contactMethod === "parachute";
  const steps = isParachute
    ? PARACHUTE_STEPS
    : patient.faxPhase === 1
    ? FAX_PHASE1_STEPS
    : FAX_PHASE2_STEPS;

  const atEscalation = patient.chaseStep >= steps.length - 1;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold">Doctor Request Sub-Stage</h2>
          <p className="text-xs text-muted-foreground">
            {isParachute ? "Parachute guarantees delivery — no receipt call needed." : "Fax has no delivery guarantee — verbal confirmation required."}
          </p>
        </div>
        <ToggleGroup type="single" value={patient.contactMethod} onValueChange={(v) => v && onMethodChange(v as ContactMethod)}>
          <ToggleGroupItem value="parachute" className="text-xs gap-1.5">
            <Radio className="h-3.5 w-3.5" /> Parachute
          </ToggleGroupItem>
          <ToggleGroupItem value="fax" className="text-xs gap-1.5">
            <Send className="h-3.5 w-3.5" /> Fax
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {!isParachute && (
        <div className="flex gap-2 mb-4">
          <Button
            variant={patient.faxPhase === 1 ? "default" : "outline"}
            size="sm"
            onClick={() => onPhaseChange(1)}
          >
            Phase 1 · Confirm Receipt
          </Button>
          <Button
            variant={patient.faxPhase === 2 ? "default" : "outline"}
            size="sm"
            onClick={() => onPhaseChange(2)}
          >
            Phase 2 · Chase Clinicals (Janelle)
          </Button>
        </div>
      )}

      <ol className="space-y-2 mb-4">
        {steps.map((step, idx) => {
          const done = idx < patient.chaseStep;
          const current = idx === patient.chaseStep;
          const isEsc = (step as any).escalate;
          return (
            <li
              key={idx}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border",
                done && "bg-muted/40 border-muted",
                current && !isEsc && "bg-primary/5 border-primary/40",
                current && isEsc && "bg-escalate/10 border-escalate/40",
                !done && !current && "bg-background",
              )}
            >
              <div
                className={cn(
                  "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold",
                  done && "bg-success text-success-foreground",
                  current && !isEsc && "bg-primary text-primary-foreground",
                  current && isEsc && "bg-escalate text-escalate-foreground",
                  !done && !current && "bg-muted text-muted-foreground",
                )}
              >
                {isEsc ? <AlertTriangle className="h-3.5 w-3.5" /> : idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>
                  {step.label}
                </p>
                {step.snoozeHrs > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                    <Clock className="h-3 w-3" /> snooze {step.snoozeHrs}h
                  </span>
                )}
              </div>
              {current && !isEsc && (
                <Button size="sm" onClick={onAdvanceStep} className="shrink-0">
                  Mark done <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              )}
              {current && isEsc && (
                <Button size="sm" onClick={onEscalate} className="shrink-0 bg-escalate text-escalate-foreground hover:bg-escalate/90">
                  Escalate now <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              )}
            </li>
          );
        })}
      </ol>

      {patient.chaseStep > 0 && (
        <Button variant="ghost" size="sm" onClick={onResetStep} className="text-xs">
          Reset chase cycle
        </Button>
      )}

      {!isParachute && patient.faxPhase === 1 && (
        <AccountabilityForm
          existing={patient.accountability}
          onSubmit={onLogAccountability}
        />
      )}

      {atEscalation && (
        <div className="mt-4 p-3 rounded-lg bg-escalate/10 border border-escalate/30">
          <p className="text-xs font-semibold text-escalate flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Escalation threshold reached
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Janelle and CEO have visibility. Escalate to hand off ownership.
          </p>
        </div>
      )}
    </section>
  );
}

function AccountabilityForm({
  existing,
  onSubmit,
}: {
  existing?: Patient["accountability"];
  onSubmit: (rep: { representativeName: string; representativeTitle: string }) => void;
}) {
  return (
    <div className="mt-5 pt-5 border-t">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Accountability Log</h3>
        <span className="text-[10px] uppercase tracking-wider font-bold text-warning-foreground bg-warning/30 px-2 py-0.5 rounded">
          Required on receipt success
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Record exactly who confirmed receipt — protects credibility when chasing.
      </p>
      {existing && (
        <div className="mb-3 p-2.5 rounded-lg bg-success/10 border border-success/30 text-xs">
          <strong>{existing.representativeName}</strong> ({existing.representativeTitle}) confirmed{" "}
          {new Date(existing.confirmedAt).toLocaleString()}
        </div>
      )}
      <form
        className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const name = (f.elements.namedItem("name") as HTMLInputElement).value.trim();
          const title = (f.elements.namedItem("title") as HTMLInputElement).value.trim();
          if (!name || !title) return;
          onSubmit({ representativeName: name, representativeTitle: title });
          f.reset();
        }}
      >
        <div>
          <Label htmlFor="name" className="text-[10px] uppercase tracking-wider">Rep name</Label>
          <Input id="name" name="name" placeholder="Elaine Ortiz" />
        </div>
        <div>
          <Label htmlFor="title" className="text-[10px] uppercase tracking-wider">Title</Label>
          <Input id="title" name="title" placeholder="Lead RN" />
        </div>
        <Button type="submit" className="self-end">Log</Button>
      </form>
    </div>
  );
}
