import { useEffect, useMemo, useState , useRef } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { NotesPanel } from "@/components/masheke/NotesPanel";
import { WhatsNeededCard } from "@/components/masheke/WhatsNeededCard";
import { EscalateButton } from "@/components/masheke/EscalateButton";
import { etNow } from "@/lib/masheke/etDate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMondayFiles } from "@/hooks/masheke/useMondayFiles";
import {
  COL,
  buildDoctorWriteTasks,
  hasToken,
  writeDate,
  writeLongText,
  writeStatusIndex,
  writeText,
  type MondayFileEntry,
} from "@/lib/masheke/mondayApi";
import {
  ESCALATION_INDEX,
  MN_ATTEMPTS_INDEX,
  SUB_STAGE_INDEX,
} from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  PhoneCall,
  Send,
  XCircle,
} from "lucide-react";

interface Props {
  patient: Patient;
  onUpdate: (patch: Partial<Patient>) => void;
  onOpenForm?: () => void;
}

// =====================================================================
// Main panel
// =====================================================================

export function ConfirmReceiptPanel({ patient, onUpdate, onOpenForm }: Props) {
  const mondayFiles = useMondayFiles(patient.id);
  const [saving, setSaving] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);

  // Active-attempt form state — name + yes/no + (if no) next action date
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState<"yes" | "no" | null>(null);
  const [nextAction, setNextAction] = useState<string>("");

  // Reset form when patient changes
  useEffect(() => {
    setName("");
    setConfirmed(null);
    setNextAction("");
  }, [patient.id]);

  // Default Next Action Date based on the picked outcome:
  //   No  → next weekday (fast follow-up after a confirmed-receipt no)
  //   Yes / nothing → 2 weekdays
  // Re-applies on patient change and on every confirmed change.
  useEffect(() => {
    const days = confirmed === "no" ? 1 : 2;
    setNextAction(formatDateInput(addBusinessDays(etNow(), days)));
  }, [patient.id, confirmed]);

  // Determine current attempt slot (1, 2, or 3) from MN Attempts column.
  // No value yet → Attempt 1.
  const currentAttempt = useMemo(() => {
    const v = (patient.mnAttempts || "").trim();
    if (v === "Attempt 2") return 2;
    if (v === "Attempt 3") return 3;
    if (v === "Escalate") return null; // already escalated, no more attempts
    return 1;
  }, [patient.mnAttempts]);

  const isEscalated = currentAttempt === null;

  // Build history from the 3 per-attempt text columns. Only attempts
  // that have been saved (column has a value) appear here.
  const history = useMemo<AttemptChip[]>(() => {
    const out: AttemptChip[] = [];
    if (patient.confirmAttempt1) out.push(parseAttemptValue(1, patient.confirmAttempt1));
    if (patient.confirmAttempt2) out.push(parseAttemptValue(2, patient.confirmAttempt2));
    if (patient.confirmAttempt3) out.push(parseAttemptValue(3, patient.confirmAttempt3));
    return out;
  }, [patient.confirmAttempt1, patient.confirmAttempt2, patient.confirmAttempt3]);

  // Name field is never required — agents sometimes don't catch a
  // name. Save only needs a selected outcome.
  const canSave = !!confirmed && !saving && !isEscalated;

  async function handleSave() {
    if (!canSave) return;
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setSaving(true);
    try {
      if (confirmed === "yes") {
        await saveYes(patient, name.trim());
        toast.success("Receipt confirmed — moved to Chase Clinicals");
        onUpdate({
          receiptConfirmedName: name.trim(),
          receiptConfirmedDate: formatDateInput(etNow()),
          subStage: "Chase Clinicals",
        });
      } else {
        const attempt = currentAttempt ?? 1;
        const value = formatAttemptValue(name.trim(), etNow());
        const nextSlot = nextMnAttempt(attempt);
        await saveNo({
          patient,
          attempt,
          value,
          nextSlot,
          nextActionDateInput: nextAction,
        });
        // Optimistic local update so the chip + next slot show before refetch
        const fieldKey =
          attempt === 1 ? "confirmAttempt1" : attempt === 2 ? "confirmAttempt2" : "confirmAttempt3";
        onUpdate({
          [fieldKey]: value,
          mnAttempts: nextSlot,
          nextActionDate: nextAction,
          escalation: nextSlot === "Escalate" ? "Escalation Required" : patient.escalation,
        });
        toast.success(
          nextSlot === "Escalate"
            ? `Attempt ${attempt} saved — escalated for human review`
            : `Attempt ${attempt} saved`,
        );
      }
      // Persist any doctor-field edits made on the profile card
      const docTasks = buildDoctorWriteTasks(patient);
      if (docTasks.length) await Promise.all(docTasks.map((t) => t.run()));
      // Write escalation if toggled
      if (escalatedRef.current) {
        await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
        setEscalated(false); escalatedRef.current = false;
      }
      // Reset form for next attempt (or clear if patient is leaving the tab)
      setName("");
      setConfirmed(null);
      setNextAction("");
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <MethodBanner patient={patient} />
      <RequestSentBanner patient={patient} />
      <WhatsNeededCard patient={patient} />
      <FilesPanel files={mondayFiles} />
      {history.length > 0 && <HistoryCard history={history} />}
      {isEscalated ? (
        <EscalatedCard />
      ) : (
        <ActiveAttemptCard
          attemptNumber={currentAttempt ?? 1}
          totalAttempts={3}
          name={name}
          onNameChange={setName}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
          nextAction={nextAction}
          onNextActionChange={setNextAction}
        />
      )}
      <NotesPanel
        notes={patient.mnEvalNotes ?? ""}
        onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
        onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
      />
      {!isEscalated && (
        <SaveBar
          attemptNumber={currentAttempt ?? 1}
          confirmed={confirmed}
          canSave={canSave}
          saving={saving}
          onSave={handleSave}
          escalated={escalated}
          onToggleEscalate={() => setEscalated((v) => { const nv = !v; escalatedRef.current = nv; return nv; })}
          onOpenForm={onOpenForm}
        />
      )}
    </div>
  );
}

// =====================================================================
// Save handlers
// =====================================================================

async function saveYes(patient: Patient, name: string) {
  // Yes path: stamp success columns + advance stage. Also reset
  // MN Attempts back to "Attempt 1" so the Chase Clinicals tab starts
  // fresh (the column is shared across stages).
  const today = formatDateInput(etNow());
  await writeText(patient.id, COL.receiptConfirmedName, name);
  await writeDate(patient.id, COL.receiptConfirmedDate, today);
  await writeStatusIndex(patient.id, COL.mnAttempts, MN_ATTEMPTS_INDEX.attempt1);
  await writeStatusIndex(patient.id, COL.subStage, SUB_STAGE_INDEX.chase);
  // Next action date — 2 business days from now.
  const nextAction = formatDateInput(addBusinessDays(etNow(), 2));
  await writeDate(patient.id, COL.nextActionDate, nextAction);
}

async function saveNo({
  patient,
  attempt,
  value,
  nextSlot,
  nextActionDateInput,
}: {
  patient: Patient;
  attempt: number;
  value: string;
  nextSlot: "Attempt 2" | "Attempt 3" | "Escalate";
  nextActionDateInput: string;
}) {
  // 1) Write the attempt's "Name — date" string into the matching column.
  const columnId =
    attempt === 1
      ? COL.confirmAttempt1
      : attempt === 2
        ? COL.confirmAttempt2
        : COL.confirmAttempt3;
  await writeText(patient.id, columnId, value);
  // 2) Bump MN Attempts.
  const mnIdx =
    nextSlot === "Attempt 2"
      ? MN_ATTEMPTS_INDEX.attempt2
      : nextSlot === "Attempt 3"
        ? MN_ATTEMPTS_INDEX.attempt3
        : MN_ATTEMPTS_INDEX.escalate;
  await writeStatusIndex(patient.id, COL.mnAttempts, mnIdx);
  // 3) Either set escalation flag (if 3rd failure) or write next action date.
  if (nextSlot === "Escalate") {
    await writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required);
  } else if (nextActionDateInput) {
    await writeDate(patient.id, COL.nextActionDate, nextActionDateInput);
  }
}

// =====================================================================
// Sub-cards
// =====================================================================

function MethodBanner({ patient }: { patient: Patient }) {
  const method = patient.clinicalsMethod ?? "—";
  let className = "bg-muted text-muted-foreground border-muted";
  let hint = "";
  if (method === "Fax") {
    className = "bg-sky-100 text-sky-900 border-sky-300";
    hint = patient.doctorFax ? `→ ${patient.doctorFax}` : "(no doctor fax on file)";
  } else if (method === "Parachute") {
    className = "bg-indigo-100 text-indigo-900 border-indigo-300";
  } else if (method === "Email") {
    className = "bg-teal-100 text-teal-900 border-teal-300";
    hint = patient.doctorEmail ? `→ ${patient.doctorEmail}` : "(no doctor email on file)";
  }
  return (
    <section
      className={`rounded-xl border-2 shadow-card px-5 py-4 flex items-center gap-3 flex-wrap ${className}`}
    >
      <Send className="h-5 w-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider opacity-70">Clinicals Method</p>
        <p className="text-lg font-semibold leading-tight">{method}</p>
      </div>
      {hint && <span className="text-xs opacity-80 ml-auto truncate">{hint}</span>}
    </section>
  );
}


function RequestSentBanner({ patient }: { patient: Patient }) {
  const sent = patient.requestSentAt;
  if (!sent) {
    return (
      <section className="rounded-xl border bg-amber-50 border-amber-200 px-5 py-3 flex items-center gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-900">No Request Sent date on file</p>
          <p className="text-[11px] text-amber-800">
            Confirm the request actually went out before calling — the column is blank on Monday.
          </p>
        </div>
      </section>
    );
  }
  const formatted = formatSent(sent);
  return (
    <section className="rounded-xl border bg-emerald-50 border-emerald-200 px-5 py-3 flex items-center gap-3">
      <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-emerald-900">Request sent</p>
        <p className="text-[11px] text-emerald-800">
          {formatted} — confirm with the doctor's office that they received the fax / email below.
        </p>
      </div>
    </section>
  );
}

function FilesPanel({ files }: { files: ReturnType<typeof useMondayFiles> }) {
  // The agent should be able to see exactly which files were sent so they
  // can describe them on the call.
  const groups: { label: string; entries: MondayFileEntry[] }[] = [
    { label: "MN Request Letter", entries: files.mnRequestLetter },
    { label: "CGM Script Template", entries: files.cgmTemplate },
    { label: "Insulin Pump Script Template", entries: files.ipTemplate },
    { label: "Clinical Files", entries: files.clinicalFiles },
  ];
  const flat = groups.flatMap((g) =>
    g.entries.map((f) => ({ group: g.label, file: f })),
  );

  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Files attached to this request
        </p>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5">
          Open any of these in a new tab to confirm what the doctor's office should have on file.
        </p>
      </div>

      {files.loading && flat.length === 0 ? (
        <div className="flex items-center gap-2 px-3 h-9 rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : flat.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No files found on the patient's row in Monday.
        </p>
      ) : (
        <div className="space-y-1">
          {flat.map(({ group, file }) => {
            const url = file.public_url || file.url;
            return (
              <div
                key={file.assetId}
                className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border bg-emerald-50 border-emerald-200"
              >
                <span className="flex items-center gap-2 truncate text-xs text-emerald-900">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider text-emerald-700/70 mr-1">
                    {group}
                  </span>
                  <span className="truncate font-medium">{file.name}</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!url}
                  onClick={() => url && window.open(url, "_blank")}
                  className="h-7 px-2 text-[11px] gap-1 shrink-0"
                >
                  <ExternalLink className="h-3 w-3" /> View
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HistoryCard({ history }: { history: AttemptChip[] }) {
  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-2">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        Previous attempts
      </p>
      <ul className="space-y-1">
        {history.map((h) => (
          <li
            key={h.raw}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border bg-muted/30"
          >
            <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
            <span className="font-semibold">Attempt {h.attempt}:</span>
            <span>{h.name}</span>
            <span className="text-muted-foreground ml-auto">{h.date}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActiveAttemptCard({
  attemptNumber,
  totalAttempts,
  name,
  onNameChange,
  confirmed,
  onConfirmedChange,
  nextAction,
  onNextActionChange,
}: {
  attemptNumber: number;
  totalAttempts: number;
  name: string;
  onNameChange: (v: string) => void;
  confirmed: "yes" | "no" | null;
  onConfirmedChange: (v: "yes" | "no" | null) => void;
  nextAction: string;
  onNextActionChange: (v: string) => void;
}) {
  const isLastAttempt = attemptNumber === totalAttempts;
  // Click-again-to-deselect, same as the Chase panel.
  const toggle = (v: "yes" | "no") => {
    onConfirmedChange(confirmed === v ? null : v);
  };
  return (
    <section className="rounded-xl bg-card border shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b bg-muted/30 flex items-center gap-3 flex-wrap">
        <PhoneCall className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">
            Attempt {attemptNumber} of {totalAttempts}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {isLastAttempt
              ? "Final attempt — if not confirmed, the patient will be flagged for escalation."
              : "Call the doctor's office to confirm receipt."}
          </p>
        </div>
        {isLastAttempt && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
            <AlertTriangle className="h-3 w-3" /> Last attempt
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Name */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Who answered the call?
          </label>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Name and title (e.g. Donna, Records)"
            className="mt-1 h-9 bg-background"
          />
        </div>

        {/* Yes / No */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Did they confirm receipt?
          </label>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => toggle("yes")}
              className={`rounded-lg border-2 px-4 py-3 flex items-center gap-2 text-sm font-semibold transition-colors text-left ${
                confirmed === "yes"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                  : "border-border bg-background hover:bg-emerald-50/50 hover:border-emerald-300"
              }`}
            >
              <Check className="h-4 w-4 text-emerald-600" />
              <span>Yes — confirmed</span>
            </button>
            <button
              type="button"
              onClick={() => toggle("no")}
              className={`rounded-lg border-2 px-4 py-3 flex items-center gap-2 text-sm font-semibold transition-colors text-left ${
                confirmed === "no"
                  ? "border-rose-500 bg-rose-50 text-rose-900"
                  : "border-border bg-background hover:bg-rose-50/50 hover:border-rose-300"
              }`}
            >
              <XCircle className="h-4 w-4 text-rose-600" />
              <span>No — not yet</span>
            </button>
          </div>
        </div>

        {/* Next action date — always visible. Pre-populated to today
            + 2 weekdays. Only written to Monday on a No save. */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Next action date
          </label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Defaults to the next weekday. Adjust if the office asked for a different callback.
          </p>
          <Input
            type="date"
            value={nextAction}
            onChange={(e) => onNextActionChange(e.target.value)}
            className="mt-1 h-9 bg-background w-full sm:w-56"
          />
        </div>
      </div>
    </section>
  );
}

function EscalatedCard() {
  return (
    <section className="rounded-xl border-2 border-rose-300 bg-rose-50 p-5 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
      <div>
        <h3 className="text-sm font-semibold text-rose-900">
          Escalated — awaiting human review
        </h3>
        <p className="text-[11px] text-rose-800 mt-0.5">
          All 3 confirm-receipt attempts came back unsuccessful. Notes are still editable below.
        </p>
      </div>
    </section>
  );
}


function SaveBar({
  attemptNumber,
  confirmed,
  canSave,
  saving,
  onSave,
  escalated,
  onToggleEscalate,
  onOpenForm,
}: {
  attemptNumber: number;
  confirmed: "yes" | "no" | null;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  escalated: boolean;
  onToggleEscalate: () => void;
  onOpenForm?: () => void;
}) {
  let hint = "Pick Yes or No to enable save.";
  if (confirmed === "yes") hint = "Saves the confirmation, advances to Chase Clinicals.";
  else if (confirmed === "no" && attemptNumber < 3) hint = `Logs Attempt ${attemptNumber} as unsuccessful and schedules the next callback.`;
  else if (confirmed === "no" && attemptNumber === 3) hint = "Logs Attempt 3 as unsuccessful and flags Escalation Required.";
  return (
    <div className="flex flex-col items-center gap-2 pt-1">
      <div className="flex items-center gap-3">
        <EscalateButton
          escalated={escalated}
          onToggle={onToggleEscalate}
          onOpenForm={onOpenForm}
          disabled={saving}
        />
        <Button
          size="lg"
          onClick={onSave}
          disabled={!canSave}
          className="gap-2 bg-teal-600 hover:bg-teal-700 text-white shadow-elevate min-w-[200px] justify-center"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Mail className="h-4 w-4" />
              Save Attempt
            </>
          )}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

// =====================================================================
// Helpers
// =====================================================================

interface AttemptChip {
  attempt: number;
  name: string;
  date: string;
  raw: string;
}

// Format used for the per-attempt text columns: "Donna — 5/1/26".
const VALUE_REGEX = /^(.+?)\s+—\s+(.+)$/;

function parseAttemptValue(attempt: number, raw: string): AttemptChip {
  const m = raw.match(VALUE_REGEX);
  if (!m) return { attempt, name: raw, date: "", raw };
  return { attempt, name: m[1], date: m[2], raw };
}

function formatAttemptValue(name: string, date: Date): string {
  const datePart = formatDateShort(date);
  return name ? `${name} — ${datePart}` : datePart;
}

function nextMnAttempt(currentAttempt: number): "Attempt 2" | "Attempt 3" | "Escalate" {
  if (currentAttempt === 1) return "Attempt 2";
  if (currentAttempt === 2) return "Attempt 3";
  return "Escalate";
}

function addBusinessDays(date: Date, days: number): Date {
  const out = new Date(date);
  let added = 0;
  while (added < days) {
    out.setDate(out.getDate() + 1);
    const day = out.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return out;
}

function formatDateInput(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

function formatSent(iso: string): string {
  // Monday's date+time text comes back as "2026-04-30 20:00:00 UTC" or
  // "2026-04-30 20:00:00" — normalize and render in ET.
  const cleaned = iso.replace(/\s+UTC$/, "Z").replace(" ", "T");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
}
