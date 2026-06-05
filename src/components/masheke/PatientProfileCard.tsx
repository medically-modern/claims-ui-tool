import { useState } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import {
  CalendarDays,
  IdCard,
  User,
  Stethoscope,
  ShieldCheck,
  UserRound,
  ChevronDown,
  ChevronRight,
  Phone,
  Mail,
  Hash,
  Building2,
  MapPin,
  Send,
  Pencil,
  Check,
  AlertTriangle,
  Clock,
  FileText,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  patient: Patient;
  /** When true, the Doctor Info panel is expanded by default. */
  defaultDoctorOpen?: boolean;
  /** When true, Doctor Info is always shown — no toggle, no collapse. */
  lockDoctorOpen?: boolean;
  /** Called when the user edits a doctor field via the pencil-edit UI.
   *  Updates local overlay only — Monday write happens on Send to Monday.
   *  Omit to hide the pencil icon entirely (read-only). */
  onDoctorEdit?: (patch: Partial<Patient>) => void;
}

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

function EditableField({
  icon,
  label,
  value,
  editing,
  onChange,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  editing: boolean;
  onChange?: (v: string) => void;
  className?: string;
}) {
  if (!editing) return <Field icon={icon} label={label} value={value} className={className} />;
  return (
    <div className={`flex items-start gap-2 min-w-0 ${className ?? ""}`}>
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
          {label}
        </p>
        <Input
          className="h-7 text-sm"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={`Enter ${label.toLowerCase()}`}
        />
      </div>
    </div>
  );
}

/** Format raw phone digits into (555)555-5555 or +1 (555)555-5555 */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)})${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw; // leave as-is if unexpected length
}

export function PatientProfileCard({
  patient,
  defaultDoctorOpen = false,
  lockDoctorOpen = false,
  onDoctorEdit,
}: Props) {
  const [doctorOpen, setDoctorOpen] = useState(defaultDoctorOpen || lockDoctorOpen);
  const [notesOpen, setNotesOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState(false);
  const canEdit = !!onDoctorEdit;

  const editButton = canEdit ? (
    <button
      onClick={() => setEditingDoctor((e) => !e)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
      title={editingDoctor ? "Done editing" : "Edit doctor info"}
    >
      {editingDoctor ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      <span>{editingDoctor ? "Done" : "Edit"}</span>
    </button>
  ) : null;

  return (
    <div className="rounded-xl bg-card border shadow-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Patient Profile</p>
        <button
          onClick={() => setNotesOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 px-3 py-1.5 rounded-lg transition-colors"
        >
          <FileText className="h-3.5 w-3.5" />
          Profile Intake Notes
        </button>
      </div>

      {/* Row 1: identity + insurance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Field icon={<User className="h-4 w-4" />} label="Name" value={patient.name} />
        <Field icon={<CalendarDays className="h-4 w-4" />} label="DOB" value={patient.dob} />
        <Field icon={<User className="h-4 w-4" />} label="Gender" value={patient.gender ?? ""} />
        <Field
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Primary Insurance"
          value={patient.primaryInsurance ?? ""}
        />
        <Field
          icon={<IdCard className="h-4 w-4" />}
          label="Member ID"
          value={patient.memberId1 ?? ""}
        />
        {patient.memberId2 && (
          <Field
            icon={<IdCard className="h-4 w-4" />}
            label="Member ID 2"
            value={patient.memberId2}
          />
        )}
        <Field
          icon={<Phone className="h-4 w-4" />}
          label="Phone"
          value={patient.phone ? formatPhone(patient.phone) : ""}
        />
        <Field
          icon={<MapPin className="h-4 w-4" />}
          label="Address"
          value={patient.address ?? ""}
          className="sm:col-span-2"
        />
      </div>

      <div className="h-px bg-border" />

      {/* Workflow context + equipment */}
      {(() => {
        const showCgmType =
          patient.serving === "CGM" ||
          patient.serving === "Insulin Pump + CGM" ||
          patient.serving === "Supplies + CGM";
        const showPumpType =
          patient.serving === "Insulin Pump" ||
          patient.serving === "Insulin Pump + CGM" ||
          patient.serving === "Supplies Only" ||
          patient.serving === "Supplies + CGM";
        const both = showCgmType && showPumpType;

        return (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field
                icon={<Stethoscope className="h-4 w-4" />}
                label="Referral Type"
                value={patient.referralType ?? ""}
              />
              <Field
                icon={<Stethoscope className="h-4 w-4" />}
                label="Referral Source"
                value={patient.referralSource ?? ""}
              />
              <Field
                icon={<Send className="h-4 w-4" />}
                label="Request Type"
                value={patient.requestType ?? ""}
              />
              <Field
                icon={<Stethoscope className="h-4 w-4" />}
                label="Serving"
                value={patient.serving ?? ""}
              />
              {!both && showCgmType && (
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="CGM Type"
                  value={patient.cgmType ?? ""}
                />
              )}
              {!both && showPumpType && (
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="Pump Type"
                  value={patient.pumpType ?? ""}
                />
              )}
            </div>
            {both && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="CGM Type"
                  value={patient.cgmType ?? ""}
                />
                <Field
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="Pump Type"
                  value={patient.pumpType ?? ""}
                />
              </div>
            )}
          </>
        );
      })()}

      {/* OOW Date + Malfunction — only show if either value exists */}
      {(patient.oowDate || patient.malfunction) && (
        <>
          <div className="h-px bg-border" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {patient.oowDate && (
              <Field
                icon={<Clock className="h-4 w-4" />}
                label="OOW Date"
                value={patient.oowDate}
              />
            )}
            {patient.malfunction && (
              <Field
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Malfunction Reason"
                value={patient.malfunction}
              />
            )}
          </div>
        </>
      )}

      {/* Doctor info — collapsible by default, locked open on Chase Clinicals.
         Pencil icon toggles inline editing (local overlay only).
         Actual Monday write happens on Send to Monday / Save Attempt. */}
      <div className="border-t pt-3">
        {lockDoctorOpen ? (
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Doctor Info
            </p>
            {editButton}
          </div>
        ) : (
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
                    <span className="truncate">{patient.doctorName ?? "—"}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Send className="h-3 w-3 shrink-0" />
                    <span>{patient.clinicalsMethod ?? "—"}</span>
                  </span>
                </span>
              )}
            </button>
            {doctorOpen && editButton}
          </div>
        )}

        {(doctorOpen || lockDoctorOpen) && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <EditableField
              icon={<UserRound className="h-4 w-4" />}
              label="Doctor Name"
              value={patient.doctorName ?? ""}
              editing={editingDoctor}
              onChange={(v) => onDoctorEdit?.({ doctorName: v })}
            />
            <Field
              icon={<Send className="h-4 w-4" />}
              label="Clinicals Method"
              value={patient.clinicalsMethod ?? ""}
            />
            <EditableField
              icon={<Hash className="h-4 w-4" />}
              label="NPI"
              value={patient.doctorNpi ?? ""}
              editing={editingDoctor}
              onChange={(v) => onDoctorEdit?.({ doctorNpi: v })}
            />
            <EditableField
              icon={<Phone className="h-4 w-4" />}
              label="Phone"
              value={patient.doctorPhone ?? ""}
              editing={editingDoctor}
              onChange={(v) => onDoctorEdit?.({ doctorPhone: v })}
            />
            <EditableField
              icon={<Mail className="h-4 w-4" />}
              label="Fax"
              value={patient.doctorFax ?? ""}
              editing={editingDoctor}
              onChange={(v) => onDoctorEdit?.({ doctorFax: v })}
            />
            <EditableField
              icon={<Mail className="h-4 w-4" />}
              label="Email"
              value={patient.doctorEmail ?? ""}
              editing={editingDoctor}
              onChange={(v) => onDoctorEdit?.({ doctorEmail: v })}
            />
            <EditableField
              icon={<Building2 className="h-4 w-4" />}
              label="Clinic"
              value={patient.clinicName ?? ""}
              editing={editingDoctor}
              onChange={(v) => onDoctorEdit?.({ clinicName: v })}
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

    </div>
  );
}
