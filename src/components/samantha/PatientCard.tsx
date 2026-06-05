import { Patient, STAGE_LABELS, PATHWAYS } from "@/lib/samantha/workflow";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, CheckCircle2, FileQuestion, Stethoscope, ArrowRightCircle } from "lucide-react";

const stageIcon: Record<Patient["stage"], React.ElementType> = {
  intake: FileQuestion,
  evaluation: Stethoscope,
  "doctor-request": Activity,
  "re-evaluation": Activity,
  advanced: ArrowRightCircle,
  "insurance-cleared": CheckCircle2,
  "welcome-call": CheckCircle2,
  escalated: AlertTriangle,
};

const stageColor: Record<Patient["stage"], string> = {
  intake: "bg-muted text-muted-foreground",
  evaluation: "bg-primary/10 text-primary",
  "doctor-request": "bg-warning/15 text-warning-foreground",
  "re-evaluation": "bg-accent/15 text-accent",
  advanced: "bg-accent/15 text-accent",
  "insurance-cleared": "bg-success/15 text-success",
  "welcome-call": "bg-success/15 text-success",
  escalated: "bg-escalate/15 text-escalate",
};

interface Props {
  patient: Patient;
  active: boolean;
  onClick: () => void;
}

export function PatientCard({ patient, active, onClick }: Props) {
  const Icon = stageIcon[patient.stage];
  const pathway = PATHWAYS.find((p) => p.id === patient.pathwayId);
  const pillarsDone = Object.values(patient.pillars).filter(Boolean).length;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border bg-card p-4 transition-all hover:shadow-card hover:border-primary/30",
        active && "border-primary shadow-elevate ring-2 ring-primary/20",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground truncate">{patient.name}</h3>
          <p className="text-xs text-muted-foreground truncate">
            {patient.product} · {patient.payer}
          </p>
        </div>
        {patient.stage === "escalated" && (
          <Badge className="bg-escalate text-escalate-foreground hover:bg-escalate shrink-0">
            Escalated
          </Badge>
        )}
        {patient.stage === "advanced" && (
          <Badge className="bg-success text-success-foreground hover:bg-success shrink-0">
            Advanced
          </Badge>
        )}
      </div>

      <div className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium mb-2", stageColor[patient.stage])}>
        <Icon className="h-3 w-3" />
        {STAGE_LABELS[patient.stage]}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {pillarsDone}/3 pillars
        </span>
        {pathway && <span className="truncate">{pathway.code} · {pathway.name}</span>}
      </div>
    </button>
  );
}
