import {
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { NotesPanel } from "@/components/masheke/NotesPanel";
import { WhatsNeededCard } from "@/components/masheke/WhatsNeededCard";
import { EscalateButton } from "@/components/masheke/EscalateButton";
import { etNow } from "@/lib/masheke/etDate";
import { Button } from "@/components/ui/button";
import { useMondayFiles } from "@/hooks/masheke/useMondayFiles";
import {
  COL,
  buildDoctorWriteTasks,
  clearStatusColumn,
  deleteFileFromColumn,
  deleteSingleFileFromColumn,
  hasToken,
  uploadFileToColumn,
  writeDate,
  writeLongText,
  writeDateTime,
  writeStatusIndex,
  writeStatusLabel,
  type MondayFileEntry,
} from "@/lib/masheke/mondayApi";
import { GEN_SCRIPT_STATUS } from "@/lib/masheke/mondayMapping";
import {
  loadEvalState,
  saveEvalState,
  type EvalState,
} from "@/lib/masheke/evalState";
import { generateMnRequestPdf } from "@/lib/masheke/mnRequestPdf";
import { ESCALATION_INDEX } from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";
import {
  Check,
  X,
  Loader2,
  FileText,
  ExternalLink,
  Send,
  Mail,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";

interface Props {
  onUpdate: (patch: Partial<Patient>) => void;
  patient: Patient;
  /** Bumped by parent on Reset — forces local state reload. */
  resetVersion?: number;
  onOpenForm?: () => void;
}

// =====================================================================
// Main panel
// =====================================================================

export function SendRequestPanel({ patient, resetVersion = 0, onUpdate, onOpenForm }: Props) {
  const [state, setState] = useState<EvalState>(() => loadEvalState(patient.id));

  useEffect(() => {
    setState(loadEvalState(patient.id));
  }, [patient.id, resetVersion]);

  useEffect(() => {
    saveEvalState(patient.id, state);
  }, [patient.id, state]);

  const update = useCallback(<K extends keyof EvalState>(key: K, value: EvalState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  const cgmIsGeneratingLocal = state.generateCgmScript === "Generate";
  const ipIsGeneratingLocal = state.generateIpScript === "Generate";

  const mondayFiles = useMondayFiles(patient.id, {
    pollingIntervalMs: cgmIsGeneratingLocal || ipIsGeneratingLocal ? 2000 : 0,
  });

  // ---- Generate triggers (write to Monday's Generate column) ----
  const triggerGenerate = useCallback(
    async (
      stateKey: "generateCgmScript" | "generateIpScript",
      columnId: string,
      v: string | undefined,
    ) => {
      update(stateKey, v);
      if (!hasToken()) return;
      try {
        if (v === "Generate") {
          await clearStatusColumn(patient.id, columnId);
          await new Promise((r) => setTimeout(r, 250));
          await writeStatusIndex(patient.id, columnId, GEN_SCRIPT_STATUS.generate);
        } else {
          await clearStatusColumn(patient.id, columnId);
        }
      } catch (e) {
        toast.error("Generate request failed", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [patient.id, update],
  );

  const handleGenerateCgm = useCallback(
    (v: string | undefined) => triggerGenerate("generateCgmScript", COL.generateCgmScript, v),
    [triggerGenerate],
  );
  const handleGenerateIp = useCallback(
    (v: string | undefined) => triggerGenerate("generateIpScript", COL.generateIpScript, v),
    [triggerGenerate],
  );

  // ---- Delete a single file from a Monday file column.
  //      Looks up the list of current files in the column, computes the
  //      "keep" set by asset id, then asks the API to do download +
  //      clear + re-upload. If the deleted file is the only one, the
  //      keep list is empty and we just clear the column. ----
  const deleteOne = useCallback(
    async (columnId: string, allFiles: MondayFileEntry[], assetId: string, label: string) => {
      if (!hasToken()) {
        toast.error("Monday token not configured");
        return;
      }
      const keep = allFiles
        .filter((f) => f.assetId !== assetId)
        .map((f) => ({ name: f.name, url: f.public_url || f.url }))
        .filter((f) => !!f.url);
      try {
        if (keep.length === 0) {
          await deleteFileFromColumn(patient.id, columnId);
        } else {
          await deleteSingleFileFromColumn(patient.id, columnId, keep);
        }
        await mondayFiles.refetch();
        toast.success(`${label} deleted`);
      } catch (e) {
        toast.error(`Failed to delete ${label}`, {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [patient.id, mondayFiles],
  );

  const handleDeleteCgmFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.cgmTemplate, mondayFiles.cgmTemplate, assetId, "CGM script template"),
    [deleteOne, mondayFiles.cgmTemplate],
  );
  const handleDeleteIpFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.ipTemplate, mondayFiles.ipTemplate, assetId, "Insulin Pump script template"),
    [deleteOne, mondayFiles.ipTemplate],
  );
  const handleDeleteMnRequestLetterFile = useCallback(
    (assetId: string) =>
      deleteOne(COL.mnRequestLetter, mondayFiles.mnRequestLetter, assetId, "MN Request Letter"),
    [deleteOne, mondayFiles.mnRequestLetter],
  );

  // ---- Generate MN Request Letter: build PDF + upload to Monday column.
  //      Behaves like the script templates — file lives on Monday and the
  //      Send action attaches everything that's there.
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const handleGenerateMnRequestLetter = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setGeneratingLetter(true);
    try {
      const bytes = await generateMnRequestPdf(patient);
      const safeName = patient.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "patient";
      await uploadFileToColumn(
        patient.id,
        COL.mnRequestLetter,
        bytes,
        `MN_Request_${safeName}.pdf`,
      );
      await mondayFiles.refetch();
      toast.success("MN Request Letter generated");
    } catch (e) {
      toast.error("MN Request Letter generation failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setGeneratingLetter(false);
    }
  }, [patient, mondayFiles]);

  // ---- Auto-clear local Generate state when Monday flips column away from Generate ----
  const prevCgmStatusRef = useRef<string | undefined>(undefined);
  const prevIpStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevCgmStatusRef.current;
    const curr = mondayFiles.generateCgmStatus;
    if (prev === "Generate" && curr && curr !== "Generate") {
      update("generateCgmScript", undefined);
    }
    prevCgmStatusRef.current = curr;
  }, [mondayFiles.generateCgmStatus, update]);
  useEffect(() => {
    const prev = prevIpStatusRef.current;
    const curr = mondayFiles.generateIpStatus;
    if (prev === "Generate" && curr && curr !== "Generate") {
      update("generateIpScript", undefined);
    }
    prevIpStatusRef.current = curr;
  }, [mondayFiles.generateIpStatus, update]);

  // ---- Send: trigger Monday status only. Monday already has the
  //      MN Request Letter + script templates + clinical files in their
  //      respective file columns; the automation attaches them to the
  //      outbound fax/email. We just flip the trigger column and stamp
  //      the Request Sent At column.
  const [sending, setSending] = useState(false);
  const handleSend = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    const method = patient.clinicalsMethod ?? "Fax";
    setSending(true);
    try {
      try {
        await writeStatusLabel(patient.id, COL.sendRequestTrigger, "Send");
      } catch (e) {
        throw new Error(`[1/2 trigger Send Request] ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await writeDateTime(patient.id, COL.requestSentAt);
      } catch (e) {
        throw new Error(`[2/2 Request Sent At] ${e instanceof Error ? e.message : String(e)}`);
      }
      toast.success(
        method === "Email"
          ? "Request sent — email dispatched via Supermail"
          : "Request sent — fax dispatched via Supermail",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Send] failed", msg);
      toast.error("Send failed", { description: msg });
    } finally {
      setSending(false);
    }
  }, [patient]);

  // ---- Mark as Complete: advance stage. ----
  const [completing, setCompleting] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const escalatedRef = useRef(false);
  const handleMarkComplete = useCallback(async () => {
    if (!hasToken()) {
      toast.error("Monday token not configured");
      return;
    }
    setCompleting(true);
    const isParachute = patient.clinicalsMethod === "Parachute";
    // Parachute skips Confirm Receipt (rep handles receipt-confirmation in the
    // Parachute portal directly), so we route straight to Chase Clinicals.
    const nextStage = isParachute ? "Chase Clinicals" : "Confirm Receipt";
    const tasks: { label: string; run: () => Promise<unknown> }[] = [
      {
        label: "Request Sent At",
        run: () => writeDateTime(patient.id, COL.requestSentAt),
      },
      {
        label: `Stage Advancer → ${nextStage}`,
        run: () => writeStatusLabel(patient.id, COL.subStage, nextStage),
      },
    ];
    if (isParachute) {
      const nextAction = toIsoDate(addBusinessDays(etNow(), 2));
      tasks.push({
        label: `Next Action Date → ${nextAction}`,
        run: () => writeDate(patient.id, COL.nextActionDate, nextAction),
      });
    }
    if (escalatedRef.current) {
      tasks.push({
        label: "Escalation → Required",
        run: () => writeStatusIndex(patient.id, COL.escalation, ESCALATION_INDEX.required),
      });
    }
    // Persist any doctor-field edits made on the profile card
    tasks.push(...buildDoctorWriteTasks(patient));
    const results = await Promise.allSettled(tasks.map((t) => t.run()));
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        failures.push(
          `${tasks[i].label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        );
      }
    });
    setCompleting(false);
    if (failures.length === 0) {
      toast.success(`Marked complete — moved to ${nextStage}`);
      setEscalated(false); escalatedRef.current = false;
    } else {
      toast.error(`${failures.length} write(s) failed`, {
        description: failures.slice(0, 3).join("\n"),
      });
    }
  }, [patient]);

  const cgmIsGenerating = cgmIsGeneratingLocal || mondayFiles.generateCgmStatus === "Generate";
  const ipIsGenerating = ipIsGeneratingLocal || mondayFiles.generateIpStatus === "Generate";

  const showCgmGenerate = patient.serving === "CGM" || patient.serving === "Insulin Pump + CGM" || patient.serving === "Supplies + CGM";
  const showIpGenerate = patient.serving !== "CGM";

  // Required fields before triggering DocExport.
  function missingForScript(kind: "cgm" | "ip"): string[] {
    const out: string[] = [];
    if (!patient.name) out.push("Name");
    if (!patient.dob) out.push("DOB");
    if (kind === "cgm" && !patient.cgmType) out.push("CGM Type");
    if (kind === "ip" && !patient.pumpType) out.push("Pump Type");
    if (!patient.doctorName) out.push("Doctor Name");
    if (!patient.doctorNpi) out.push("Doctor NPI");
    return out;
  }
  const cgmMissing = missingForScript("cgm");
  const ipMissing = missingForScript("ip");

  const isParachute = patient.clinicalsMethod === "Parachute";
  const [showAdvanced, setShowAdvanced] = useState(!isParachute);

  // Reset reveal state when method changes
  useEffect(() => {
    setShowAdvanced(!isParachute);
  }, [isParachute]);

  return (
    <div className="space-y-4">
      <MethodBanner patient={patient} />

      <WhatsNeededCard patient={patient} />

      <ClinicalFilesCard
        files={mondayFiles.clinicalFiles}
        loading={mondayFiles.loading}
      />

      {/* Parachute: the GenerateScripts / RequestLetter / OptionalFax cards
         live behind a chevron. Mark every card in the group with a left
         indigo accent so it's obvious which boxes are part of the
         drop-down vs the always-visible cards above and below.
         Fax / Email: cards are always visible, no group accent. */}
      {isParachute && (
        <CollapsibleHeader
          title="Generate Scripts & MN Request Letter"
          open={showAdvanced}
          onToggle={() => setShowAdvanced((o) => !o)}
          hint="Not needed for Parachute requests. Open to view if sending request by fax as well."
          grouped
        />
      )}
      {(!isParachute || showAdvanced) && (
        <>
          <GenerateScriptsCard
            showCgm={showCgmGenerate}
            showIp={showIpGenerate}
            cgmIsGenerating={cgmIsGenerating}
            ipIsGenerating={ipIsGenerating}
            cgmFiles={mondayFiles.cgmTemplate}
            ipFiles={mondayFiles.ipTemplate}
            loading={mondayFiles.loading}
            cgmMissing={cgmMissing}
            ipMissing={ipMissing}
            onGenerateCgm={() => handleGenerateCgm("Generate")}
            onCancelCgm={() => handleGenerateCgm(undefined)}
            onGenerateIp={() => handleGenerateIp("Generate")}
            onCancelIp={() => handleGenerateIp(undefined)}
            onDeleteCgm={handleDeleteCgmFile}
            onDeleteIp={handleDeleteIpFile}
            grouped={isParachute}
          />

          <RequestLetterCard
            files={mondayFiles.mnRequestLetter}
            loading={mondayFiles.loading}
            generating={generatingLetter}
            onGenerate={handleGenerateMnRequestLetter}
            onDelete={handleDeleteMnRequestLetterFile}
            grouped={isParachute}
          />

          {isParachute && (
            <OptionalFaxCard
              patient={patient}
              sending={sending}
              onSend={handleSend}
              mnRequestLetterCount={mondayFiles.mnRequestLetter.length}
            />
          )}
        </>
      )}

      <NotesPanel
        notes={patient.mnEvalNotes ?? ""}
        onNotesChange={(v) => onUpdate({ mnEvalNotes: v })}
        onSaveToMonday={(v) => writeLongText(patient.id, COL.mnEvalNotes, v)}
      />

      <SendActionCard
        patient={patient}
        sending={sending}
        completing={completing}
        onSend={handleSend}
        onMarkComplete={handleMarkComplete}
        escalated={escalated}
        onToggleEscalate={() => setEscalated((v) => { const nv = !v; escalatedRef.current = nv; return nv; })}
        onOpenForm={onOpenForm}
        attachments={[
          { label: "MN Request Letter", count: mondayFiles.mnRequestLetter.length, required: true },
          // Script template rows only show when this patient is being
          // served that product — otherwise the row is meaningless.
          ...(showCgmGenerate
            ? [{ label: "CGM Script Template", count: mondayFiles.cgmTemplate.length }]
            : []),
          ...(showIpGenerate
            ? [{ label: "Insulin Pump Script Template", count: mondayFiles.ipTemplate.length }]
            : []),
          { label: "Clinical Files", count: mondayFiles.clinicalFiles.length },
        ]}
      />
    </div>
  );
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

function ClinicalFilesCard({
  files,
  loading,
}: {
  files: MondayFileEntry[];
  loading: boolean;
}) {
  return (
    <section className="rounded-xl bg-card border shadow-card p-5 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Clinical Files
        </p>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5">
          Read from Monday — these will be attached automatically when you send the request.
        </p>
      </div>

      {loading && files.length === 0 ? (
        <div className="flex items-center gap-2 px-3 h-9 rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No clinical files attached on Monday.
        </p>
      ) : (
        <div className="space-y-1">
          {files.map((f) => (
            <div
              key={f.assetId}
              className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border bg-emerald-50 border-emerald-200"
            >
              <span className="flex items-center gap-2 truncate text-xs text-emerald-900">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate font-medium">{f.name}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!f.public_url && !f.url}
                onClick={() => {
                  const u = f.public_url || f.url;
                  if (u) openInGoogleViewer(u);
                }}
                className="h-7 px-2 text-[11px] gap-1 shrink-0"
              >
                <ExternalLink className="h-3 w-3" /> View
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OptionalFaxCard({
  patient,
  sending,
  onSend,
  mnRequestLetterCount,
}: {
  patient: Patient;
  sending: boolean;
  onSend: () => void;
  mnRequestLetterCount: number;
}) {
  const hasLetter = mnRequestLetterCount > 0;
  const disabled = sending || !patient.doctorFax || !hasLetter;
  return (
    <section className="rounded-xl border border-dashed bg-muted/20 border-l-4 border-l-indigo-300 p-4 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Optional — Also send by Fax
        </p>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5">
          Triggers Monday to dispatch the files above via Supermail, in addition to Parachute.
        </p>
        {patient.doctorFax ? (
          <p className="text-xs font-mono text-foreground/80 mt-1">
            → {patient.doctorFax}
          </p>
        ) : (
          <p className="text-xs text-amber-700 mt-1">
            (no doctor fax on file)
          </p>
        )}
        {!hasLetter && patient.doctorFax && (
          <p className="text-xs text-rose-700 mt-1">
            Generate the MN Request Letter above first.
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onSend}
        disabled={disabled}
        className="gap-2"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Mail className="h-4 w-4" />
            Send via Fax
          </>
        )}
      </Button>
    </section>
  );
}

function CollapsibleHeader({
  title,
  open,
  onToggle,
  hint,
  grouped,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  hint?: string;
  grouped?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full rounded-xl bg-card border shadow-card px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors text-left ${
        grouped ? "border-l-4 border-l-indigo-300" : ""
      }`}
    >
      <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </span>
      {hint && !open && (
        <span className="text-[11px] text-muted-foreground/70 normal-case truncate">
          {hint}
        </span>
      )}
    </button>
  );
}

function ReasonRow({ label, reasons }: { label: string; reasons: string[] }) {
  const labelClass =
    "text-[11px] uppercase tracking-wider text-muted-foreground w-[110px] shrink-0 whitespace-nowrap";
  if (reasons.length === 0) {
    return (
      <div className="flex items-center gap-3 min-h-[24px]">
        <span className={labelClass}>{label}</span>
        <span className="text-[11px] text-muted-foreground/60 italic">none</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 flex-wrap min-h-[24px]">
      <span className={labelClass}>{label}</span>
      <div className="flex flex-wrap gap-1">
        {reasons.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"
          >
            <X className="h-3 w-3" /> {r}
          </span>
        ))}
      </div>
    </div>
  );
}

interface GenerateScriptsCardProps {
  showCgm: boolean;
  showIp: boolean;
  cgmIsGenerating: boolean;
  ipIsGenerating: boolean;
  cgmFiles: MondayFileEntry[];
  ipFiles: MondayFileEntry[];
  loading: boolean;
  cgmMissing: string[];
  ipMissing: string[];
  onGenerateCgm: () => void;
  onCancelCgm: () => void;
  onGenerateIp: () => void;
  onCancelIp: () => void;
  onDeleteCgm: (assetId: string) => void | Promise<void>;
  onDeleteIp: (assetId: string) => void | Promise<void>;
  /** When true, render with a left accent line marking it as part of
   *  the Parachute drop-down group. */
  grouped?: boolean;
}

function GenerateScriptsCard(props: GenerateScriptsCardProps) {
  if (!props.showCgm && !props.showIp) return null;
  return (
    <section
      className={`rounded-xl bg-card border shadow-card p-5 space-y-3 ${
        props.grouped ? "border-l-4 border-l-indigo-300" : ""
      }`}
    >
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Generate Scripts
        </p>
        <p className="text-[11px] text-muted-foreground/80 mt-0.5">
          Trigger Monday&apos;s DocExport to produce a prescription script the doctor can sign.
        </p>
      </div>
      <div className="space-y-2">
        {props.showCgm && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 items-center">
            <ToggleRow
              label="Generate CGM Script"
              isGenerating={props.cgmIsGenerating}
              missing={props.cgmMissing}
              onGenerate={props.onGenerateCgm}
              onCancel={props.onCancelCgm}
            />
            <ScriptViewer
              label="CGM script template"
              files={props.cgmFiles}
              loading={props.loading}
              onDelete={props.onDeleteCgm}
            />
          </div>
        )}
        {props.showIp && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 items-center">
            <ToggleRow
              label="Generate Insulin Pump Script"
              isGenerating={props.ipIsGenerating}
              missing={props.ipMissing}
              onGenerate={props.onGenerateIp}
              onCancel={props.onCancelIp}
            />
            <ScriptViewer
              label="Insulin Pump script template"
              files={props.ipFiles}
              loading={props.loading}
              onDelete={props.onDeleteIp}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function ToggleRow({
  label,
  isGenerating,
  missing,
  onGenerate,
  onCancel,
}: {
  label: string;
  isGenerating: boolean;
  missing: string[];
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const disabled = missing.length > 0;
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50">
      <span className="text-sm text-muted-foreground whitespace-nowrap pt-1.5">
        {label}
      </span>
      {isGenerating ? (
        <div className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium rounded-md border border-amber-300 bg-amber-50 text-amber-900">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating…
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="h-8 px-2 text-xs"
            title="Cancel"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={disabled}
            className="h-8 px-3 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white disabled:bg-muted disabled:text-muted-foreground"
          >
            <FileText className="h-3 w-3" />
            Generate
          </Button>
          {disabled && (
            <span className="inline-flex items-center gap-1 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 max-w-[260px] text-right">
              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
              Missing: {missing.join(", ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ScriptViewer({
  label,
  files,
  loading,
  onDelete,
}: {
  label: string;
  files: MondayFileEntry[];
  loading: boolean;
  /** Delete the specific file by asset id. */
  onDelete?: (assetId: string) => void | Promise<void>;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (file: MondayFileEntry) => {
    if (!onDelete) return;
    if (!window.confirm(`Delete "${file.name}" from Monday? This can't be undone.`)) {
      return;
    }
    setDeletingId(file.assetId);
    try {
      await onDelete(file.assetId);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading && files.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </span>
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border border-dashed bg-muted/20 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <FileText className="h-3 w-3" />
          No {label} found
        </span>
        <Button variant="ghost" size="sm" disabled className="h-7 px-2 text-[11px]">
          View
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {files.map((f) => (
        <div
          key={f.assetId}
          className="flex items-center justify-between gap-2 px-3 h-9 rounded-md border bg-emerald-50 border-emerald-200"
        >
          <span className="flex items-center gap-2 truncate text-xs text-emerald-900">
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate font-medium">{f.name}</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="sm"
              disabled={!f.public_url && !f.url}
              onClick={() => {
                const u = f.public_url || f.url;
                if (u) openInGoogleViewer(u);
              }}
              className="h-7 px-2 text-[11px] gap-1"
            >
              <ExternalLink className="h-3 w-3" /> View
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(f)}
                disabled={deletingId !== null}
                title={`Delete "${f.name}" from Monday`}
                className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                {deletingId === f.assetId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RequestLetterCard({
  files,
  loading,
  generating,
  onGenerate,
  onDelete,
  grouped,
}: {
  files: MondayFileEntry[];
  loading: boolean;
  generating: boolean;
  onGenerate: () => void | Promise<void>;
  onDelete: (assetId: string) => void | Promise<void>;
  grouped?: boolean;
}) {
  const hasLetter = files.length > 0;
  return (
    <section
      className={`rounded-xl bg-card border shadow-card p-5 space-y-3 ${
        grouped ? "border-l-4 border-l-indigo-300" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            MN Request Letter
          </p>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5">
            Generated from the data above — patient name, situation, and check marks
            are filled in automatically. Uploads to Monday so it&apos;s attached when
            you send the request.
          </p>
        </div>
        {/* Fixed min-width so the button doesn't jump from "Generate" to
           "Generating…" when its label changes. */}
        <Button
          size="sm"
          disabled
          title="Coming soon"
          className="h-8 gap-1 text-xs bg-gray-400 text-white min-w-[120px] justify-center cursor-not-allowed opacity-60"
        >
          {generating ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <FileText className="h-3 w-3" />
              {hasLetter ? "Regenerate" : "Generate"}
            </>
          )}
        </Button>
      </div>

      <ScriptViewer
        label="MN Request Letter"
        files={files}
        loading={loading}
        onDelete={onDelete}
      />
    </section>
  );
}


function formatDate(iso?: string): string | null {
  if (!iso) return null;
  // Monday's text for a date+time column comes back like "2026-05-01 14:30:00 UTC"
  // — strip a trailing " UTC" so Date can parse the ISO-ish string.
  const cleaned = iso.replace(/\s+UTC$/, "Z").replace(" ", "T");
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return iso;
  // Always render in Eastern Time and tag the suffix so the rep sees the tz.
  const formatted = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatted} ET`;
}

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

const PARACHUTE_URL = "https://dme.parachutehealth.com/u/r/BGP3-YIEG1-Z8-SL/dashboard";

interface Attachment {
  label: string;
  count: number;
  /** When true, the file MUST be present before Send is enabled. */
  required?: boolean;
}

function SendActionCard({
  patient,
  sending,
  completing,
  onSend,
  onMarkComplete,
  attachments,
  escalated,
  onToggleEscalate,
  onOpenForm,
}: {
  patient: Patient;
  sending: boolean;
  completing: boolean;
  onSend: () => void;
  onMarkComplete: () => void;
  attachments: Attachment[];
  escalated: boolean;
  onToggleEscalate: () => void;
  onOpenForm?: () => void;
}) {
  const method = patient.clinicalsMethod ?? "Fax";
  const alreadySent = !!patient.requestSentAt;
  const sentDate = formatDate(patient.requestSentAt);
  const sentDays = daysSince(patient.requestSentAt);
  const isParachute = method === "Parachute";
  const isFaxOrEmail = method === "Fax" || method === "Email";

  const recipient =
    method === "Fax" && patient.doctorFax
      ? patient.doctorFax
      : method === "Email" && patient.doctorEmail
        ? patient.doctorEmail
        : null;

  // Send is gated on every required attachment being present (today
  // that's just the MN Request Letter). Optional attachments may be 0.
  const allRequiredPresent = attachments.every(
    (a) => !a.required || a.count > 0,
  );
  const mnRequestLetterPresent = allRequiredPresent;

  return (
    <section className="rounded-xl bg-card border shadow-card overflow-hidden">
      {/* Header — title + sent status grouped together */}
      <div className="flex items-center justify-between gap-4 flex-wrap px-6 py-4 border-b bg-muted/30">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">Send Request</h3>
          {sentDate ? (
            <p className="text-xs text-muted-foreground mt-1">
              Last sent <span className="font-medium text-foreground">{sentDate}</span>
              {sentDays !== null && sentDays >= 0 && (
                <span className="text-muted-foreground/70">
                  {" · "}
                  {sentDays === 0 ? "today" : `${sentDays} day${sentDays === 1 ? "" : "s"} ago`}
                </span>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1">
              Two-step flow — send the request, then advance the stage.
            </p>
          )}
        </div>
        {alreadySent ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-full px-3 py-1 shrink-0">
            <Check className="h-3.5 w-3.5" />
            Request Sent
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-background border rounded-full px-3 py-1 shrink-0">
            Not sent yet
          </span>
        )}
      </div>

      {/* Two numbered step subsections — same visual pattern as the
         Insurance Panel Step 1/2/3 layout, so the eye reads top→bottom. */}
      <div className="px-6 py-5 space-y-4">
        {isFaxOrEmail && <AttachmentSummary attachments={attachments} />}

        <StepBlock
          number={1}
          title="Send the request"
          subtitle={
            isParachute
              ? "Open the Parachute portal in a new tab and submit the request there."
              : recipient
                ? `Dispatches the files above to ${recipient} via Supermail.`
                : method === "Fax"
                  ? "(no doctor fax on file)"
                  : method === "Email"
                    ? "(no doctor email on file)"
                    : ""
          }
        >
          {isFaxOrEmail ? (
            <Button
              onClick={onSend}
              disabled={sending || !mnRequestLetterPresent}
              className="gap-2 bg-teal-600 hover:bg-teal-700 text-white"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Send via {method}
                </>
              )}
            </Button>
          ) : isParachute ? (
            <a
              href={PARACHUTE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Open Parachute Portal
            </a>
          ) : null}
        </StepBlock>

        <StepBlock
          number={2}
          title="Advance the stage"
          subtitle="Click after the request has been sent — moves the patient to the next stage on Monday."
        >
          <div className="flex items-center gap-3">
            <EscalateButton
              escalated={escalated}
              onToggle={onToggleEscalate}
              onOpenForm={onOpenForm}
              disabled={completing}
            />
            <Button
              size="lg"
              onClick={onMarkComplete}
              disabled={completing}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-elevate"
            >
              {completing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Marking…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Mark as Complete
                </>
              )}
            </Button>
          </div>
        </StepBlock>
      </div>
    </section>
  );
}

function StepBlock({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background/60 px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-border bg-background flex items-center justify-center text-sm font-bold shrink-0">
          {number}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold leading-snug">{title}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                {subtitle}
              </p>
            )}
          </div>
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

function AttachmentSummary({ attachments }: { attachments: Attachment[] }) {
  // Tells Samantha exactly what Monday's automation will attach when she
  // hits Send — pulled live from the file columns shown above. Required
  // rows missing a file render in red so the gating reason is obvious.
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Will attach when sent
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {attachments.map((a) => {
          const blocked = a.required && a.count === 0;
          return (
            <li
              key={a.label}
              className={`flex items-center gap-2 text-xs ${
                blocked ? "text-rose-700" : "text-foreground"
              }`}
            >
              {blocked ? (
                <AlertTriangle className="h-3 w-3 shrink-0" />
              ) : a.count > 0 ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-600" />
              ) : (
                <span className="h-3 w-3 shrink-0 rounded-full border border-muted-foreground/40" />
              )}
              <span className="font-medium">{a.label}</span>
              <span className="text-muted-foreground">
                {a.count > 0
                  ? `· ${a.count} file${a.count === 1 ? "" : "s"}`
                  : a.required
                    ? "· required, missing"
                    : "· none"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// =====================================================================
// Helpers
// =====================================================================

/** Add N business days (Mon–Fri) to a date. */
function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/** Format a Date as YYYY-MM-DD for Monday's date column. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Open a Monday file URL in Google Docs Viewer (no download). */
function openInGoogleViewer(url: string) {
  const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
  window.open(viewerUrl, "_blank");
}


