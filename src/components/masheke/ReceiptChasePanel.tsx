import type { Patient } from "@/lib/masheke/workflow";
import { StatusSelect } from "./StatusSelect";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MR_OPTS, MN_ATTEMPTS_OPTS } from "@/lib/masheke/fieldOptions";

interface Props {
  patient: Patient;
  mode: "confirmReceipt" | "chase";
  onUpdate: (patch: Partial<Patient>) => void;
}

export function ReceiptChasePanel({ patient, mode, onUpdate }: Props) {
  const isChase = mode === "chase";
  const title = isChase ? "Chase Clinicals" : "Confirm Receipt";

  return (
    <div className="space-y-4">
      {/* Status selectors */}
      <div className="rounded-xl bg-card border shadow-card p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{title}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <StatusSelect label="MRs / Clinicals" value={patient.mrsClinicals} options={MR_OPTS} onChange={(v) => onUpdate({ mrsClinicals: v })} />
          <StatusSelect label="MN Attempts" value={patient.mnAttempts} options={MN_ATTEMPTS_OPTS} onChange={(v) => onUpdate({ mnAttempts: v })} />
        </div>
      </div>

      {/* Form fields */}
      <div className="rounded-xl bg-card border shadow-card p-5 space-y-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Details</p>

        {!isChase && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Receipt Confirmed Date</Label>
              <Input
                type="date"
                value={patient.receiptConfirmedDate ?? ""}
                onChange={(e) => onUpdate({ receiptConfirmedDate: e.target.value })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Receipt Confirmed Name / Title</Label>
              <Input
                value={patient.receiptConfirmedName ?? ""}
                onChange={(e) => onUpdate({ receiptConfirmedName: e.target.value })}
                placeholder="Name and title..."
                className="text-sm"
              />
            </div>
          </div>
        )}

        {isChase && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Next Action Date</Label>
              <Input
                type="date"
                value={patient.nextActionDate ?? ""}
                onChange={(e) => onUpdate({ nextActionDate: e.target.value })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Chase Recipient Name</Label>
              <Input
                value={patient.chaseRecipientName ?? ""}
                onChange={(e) => onUpdate({ chaseRecipientName: e.target.value })}
                placeholder="Recipient name..."
                className="text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Notes - unified label */}
      <div className="rounded-xl bg-card border shadow-card p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Confirming & Chasing Clinicals Notes
        </p>
        <Textarea
          value={patient.confirmChaseNotes ?? ""}
          onChange={(e) => onUpdate({ confirmChaseNotes: e.target.value })}
          placeholder="Add notes..."
          className="min-h-[100px] text-sm"
        />
      </div>
    </div>
  );
}
