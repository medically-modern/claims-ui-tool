import { useState } from "react";
import type { Patient } from "@/lib/samantha/workflow";
import { PRIMARY_INSURANCE_OPTIONS, SECONDARY_INSURANCE_OPTIONS_SAMANTHA } from "@/lib/samantha/hcpcRules";
import type { PrimaryInsurance } from "@/lib/samantha/hcpcRules";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays,
  IdCard,
  User,
  Stethoscope,
  ShieldCheck,
  Activity,
  UserRound,
  ChevronDown,
  ChevronRight,
  Phone,
  Mail,
  Hash,
  Building2,
  Send,
  MapPin,
  Cpu,
  FileText,
  Pencil,
  X,
} from "lucide-react";

interface Props {
  patient: Patient;
  onUpdate?: (patch: Partial<Patient>) => void;
}

/* ── Read-only field ─────────────────────────────────────────────── */

function Field({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className ?? ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <p className="text-sm font-medium truncate" title={value || "—"}>
          {value || "—"}
        </p>

      </div>
    </div>
  );
}

/* ── Editable field ──────────────────────────────────────────────── */

function EditableField({
  icon,
  label,
  value,
  onChange,
  className,
  placeholder,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className ?? ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? label}
          className="h-7 text-sm mt-0.5"
        />
      </div>
    </div>
  );
}

/* ── Phone formatter ─────────────────────────────────────────────── */

function formatPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw; // fallback — return as-is
}

/* ── Main component ──────────────────────────────────────────────── */

export function PatientProfileCard({ patient, onUpdate }: Props) {
  const hasMember2 = !!patient.memberId2 && patient.memberId2.trim().length > 0;
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mnNotesOpen, setMnNotesOpen] = useState(false);

  const canEdit = !!onUpdate;
  const hasPumpOrSupplies = !!(
    patient.serving &&
    (patient.serving.includes("Pump") || patient.serving.includes("Supplies"))
  );

  const toggleEdit = () => {
    if (editing) {
      // closing edit mode — force doctor section open stays as-is
    }
    setEditing((e) => !e);
    // When entering edit mode, expand doctor info so all fields are visible
    if (!editing) setDoctorOpen(true);
  };

  const patch = (p: Partial<Patient>) => onUpdate?.(p);

  return (
    <div className="rounded-xl bg-card border shadow-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Patient Profile
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNotesOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-lg transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Profile Intake Notes
          </button>
          <button
            onClick={() => setMnNotesOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            MN Workflow Notes
          </button>
        {canEdit && (
          <button
            onClick={toggleEdit}
            className={`p-1.5 rounded-md transition-colors ${
              editing
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            title={editing ? "Stop editing" : "Edit profile"}
          >
            {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </button>
        )}
        </div>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {editing ? (
          <EditableField
            icon={<User className="h-4 w-4" />}
            label="Name"
            value={patient.name}
            onChange={(v) => patch({ name: v })}
          />
        ) : (
          <Field icon={<User className="h-4 w-4" />} label="Name" value={patient.name} />
        )}

        {editing ? (
          <EditableField
            icon={<CalendarDays className="h-4 w-4" />}
            label="Date of Birth"
            value={patient.dob}
            onChange={(v) => patch({ dob: v })}
          />
        ) : (
          <Field icon={<CalendarDays className="h-4 w-4" />} label="Date of Birth" value={patient.dob} />
        )}

        {/* Serving — always read-only */}
        <Field
          icon={<Stethoscope className="h-4 w-4" />}
          label="Serving"
          value={patient.serving ?? ""}
        />
      </div>

      {/* Row 1b — Patient Phone, Address, Pump Brand */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {editing ? (
          <EditableField
            icon={<Phone className="h-4 w-4" />}
            label="Patient Phone"
            value={patient.patientPhone ?? ""}
            onChange={(v) => patch({ patientPhone: v })}
            placeholder="(xxx) xxx-xxxx"
          />
        ) : (
          <Field
            icon={<Phone className="h-4 w-4" />}
            label="Patient Phone"
            value={formatPhone(patient.patientPhone ?? "")}
          />
        )}
        {editing ? (
          <EditableField
            icon={<MapPin className="h-4 w-4" />}
            label="Patient Address"
            value={patient.patientAddress ?? ""}
            onChange={(v) => patch({ patientAddress: v })}
            className="sm:col-span-2"
          />
        ) : (
          <Field
            icon={<MapPin className="h-4 w-4" />}
            label="Patient Address"
            value={patient.patientAddress ?? ""}
            className="sm:col-span-2"
          />
        )}
      </div>

      {/* Row 1c — Pump Type (visible when serving includes Pump or Supplies) */}
      {hasPumpOrSupplies && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field
            icon={<Cpu className="h-4 w-4" />}
            label="Pump Type"
            value={patient.pumpBrand ?? ""}
          />
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Primary Insurance — editable via pencil toggle */}
        {editing ? (
          <div className="flex items-start gap-2 min-w-0">
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Primary Insurance
              </p>
              <Select
                value={patient.primaryInsurance ?? ""}
                onValueChange={(v) => patch({ primaryInsurance: v as PrimaryInsurance })}
              >
                <SelectTrigger className="h-7 text-sm mt-0.5">
                  <SelectValue placeholder="Select insurance" />
                </SelectTrigger>
                <SelectContent>
                  {PRIMARY_INSURANCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <Field icon={<ShieldCheck className="h-4 w-4" />} label="Primary Insurance" value={patient.primaryInsurance ?? ""} />
        )}

        {editing ? (
          <EditableField
            icon={<IdCard className="h-4 w-4" />}
            label="Member ID"
            value={patient.memberId1 ?? ""}
            onChange={(v) => patch({ memberId1: v })}
          />
        ) : (
          <Field icon={<IdCard className="h-4 w-4" />} label="Member ID" value={patient.memberId1 ?? ""} />
        )}

        {editing ? (
          <EditableField
            icon={<Activity className="h-4 w-4" />}
            label="Diagnosis"
            value={patient.diagnosis ?? ""}
            onChange={(v) => patch({ diagnosis: v })}
          />
        ) : (
          <Field icon={<Activity className="h-4 w-4" />} label="Diagnosis" value={patient.diagnosis ?? ""} />
        )}

        {/* Secondary Insurance — always editable dropdown */}
        <div className="flex items-start gap-2 min-w-0">
          <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-1">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Secondary Insurance
            </p>
            <Select
              value={patient.secondaryInsurance ?? ""}
              onValueChange={(v) => patch({ secondaryInsurance: v })}
            >
              <SelectTrigger className="h-7 text-sm mt-0.5">
                <SelectValue placeholder="Select insurance" />
              </SelectTrigger>
              <SelectContent>
                {SECONDARY_INSURANCE_OPTIONS_SAMANTHA.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Member ID 2 — always editable */}
        <EditableField
          icon={<IdCard className="h-4 w-4" />}
          label="Member ID 2"
          value={patient.memberId2 ?? ""}
          onChange={(v) => patch({ memberId2: v })}
        />

        <Field
          icon={<Stethoscope className="h-4 w-4" />}
          label="Referral Source"
          value={patient.referralSource ?? ""}
        />

        {patient.referralSource === "CareCentrix" && (() => {
          const isEmpty = !patient.carecentrixIntakeId;
          return (
            <div className={`flex items-start gap-2 min-w-0 rounded-lg p-1.5 -m-1.5 transition-colors ${isEmpty ? "bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800/40" : ""}`}>
              <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 mt-1 ${isEmpty ? "bg-red-100 dark:bg-red-900/30 text-red-500" : "bg-muted text-muted-foreground"}`}>
                <IdCard className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Carecentrix Intake I.D.
                </p>
                <Input
                  value={patient.carecentrixIntakeId ?? ""}
                  onChange={(e) => patch({ carecentrixIntakeId: e.target.value })}
                  placeholder="Enter Carecentrix Intake I.D."
                  className={`h-7 text-sm mt-0.5 ${isEmpty ? "border-red-300 dark:border-red-700" : ""}`}
                />
              </div>
            </div>
          );
        })()}
      </div>

      {/* Doctor info — collapsible */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setDoctorOpen((o) => !o)}
            className="flex-1 flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors gap-3"
          >
            <span className="flex items-center gap-2">
              {doctorOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Doctor Info
            </span>
            {!doctorOpen && (
              <span className="flex items-center gap-3 text-[11px] normal-case text-foreground/70 truncate">
                <span className="inline-flex items-center gap-1 truncate">
                  <UserRound className="h-3 w-3 shrink-0" />
                  <span className="truncate">{patient.doctorName || "—"}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Send className="h-3 w-3 shrink-0" />
                  <span>{patient.clinicalsMethod || "—"}</span>
                </span>
              </span>
            )}
          </button>
        </div>

        {doctorOpen && !editing && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field icon={<UserRound className="h-4 w-4" />} label="Doctor Name" value={patient.doctorName ?? ""} />
            <Field icon={<Send className="h-4 w-4" />} label="Clinicals Method" value={patient.clinicalsMethod ?? ""} />
            <Field icon={<Hash className="h-4 w-4" />} label="NPI" value={patient.doctorNpi ?? ""} />
            <Field icon={<Phone className="h-4 w-4" />} label="Phone" value={patient.doctorPhone ?? ""} />
            <Field icon={<Mail className="h-4 w-4" />} label="Fax" value={patient.doctorFax ?? ""} />
            <Field icon={<Mail className="h-4 w-4" />} label="Email" value={patient.doctorEmail ?? ""} />
            <Field
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName ?? ""}
              className="sm:col-span-2"
            />
          </div>
        )}

        {doctorOpen && editing && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <EditableField
              icon={<UserRound className="h-4 w-4" />}
              label="Doctor Name"
              value={patient.doctorName ?? ""}
              onChange={(v) => patch({ doctorName: v })}
            />
            <EditableField
              icon={<Send className="h-4 w-4" />}
              label="Clinicals Method"
              value={patient.clinicalsMethod ?? ""}
              onChange={(v) => patch({ clinicalsMethod: v })}
            />
            <EditableField
              icon={<Hash className="h-4 w-4" />}
              label="NPI"
              value={patient.doctorNpi ?? ""}
              onChange={(v) => patch({ doctorNpi: v })}
            />
            <EditableField
              icon={<Phone className="h-4 w-4" />}
              label="Phone"
              value={patient.doctorPhone ?? ""}
              onChange={(v) => patch({ doctorPhone: v })}
            />
            <EditableField
              icon={<Mail className="h-4 w-4" />}
              label="Fax"
              value={patient.doctorFax ?? ""}
              onChange={(v) => patch({ doctorFax: v })}
            />
            <EditableField
              icon={<Mail className="h-4 w-4" />}
              label="Email"
              value={patient.doctorEmail ?? ""}
              onChange={(v) => patch({ doctorEmail: v })}
            />
            <EditableField
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName ?? ""}
              onChange={(v) => patch({ clinicName: v })}
              className="sm:col-span-2"
            />
          </div>
        )}
      </div>

      {/* Profile Intake Notes Modal */}
      {notesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNotesOpen(false)} />
          <div className="relative bg-card border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-sm">Profile Intake Notes</h3>
              <button
                onClick={() => setNotesOpen(false)}
                className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {patient.profileSendOffNotes ? (
                <p className="text-sm whitespace-pre-wrap">{patient.profileSendOffNotes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No intake notes recorded.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MN Workflow Notes Modal */}
      {mnNotesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMnNotesOpen(false)} />
          <div className="relative bg-card border rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-sm text-amber-700">MN Workflow Notes</h3>
              <button
                onClick={() => setMnNotesOpen(false)}
                className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {patient.mnWorkflowNotes ? (
                <p className="text-sm whitespace-pre-wrap">{patient.mnWorkflowNotes}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No MN workflow notes recorded.</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
