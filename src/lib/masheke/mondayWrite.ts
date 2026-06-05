// Batch writer for Medical Necessity "Send to Monday"

import { writeStatusIndex, writeText, writeLongText, writeDate, readColumnTexts, COL } from "./mondayApi";
import { executeWritesWithVerification } from "../shared/verifiedWrite";
import { etNow } from "./etDate";
import {
  SUB_STAGE_INDEX,
  ADVANCER_2A_INDEX,
  ADVANCER_2B_INDEX,
  ADVANCER_2C_INDEX,
  ADVANCER_2D_INDEX,
} from "./mondayMapping";
import {
  labelToIndex,
  STANDARD_EVAL,
  LANGUAGE_OPTS,
  BLOOD_SUGAR_OPTS,
  DIAGNOSIS_OPTS,
  MR_OPTS,
  MED_NEC_OPTS,
  GEN_SCRIPT_OPTS,
  CLINICALS_METHOD_OPTS,
  MN_ATTEMPTS_OPTS,
} from "./fieldOptions";
import type { Patient } from "./workflow";
import type { StatusOption } from "@/components/masheke/StatusSelect";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  expectedText?: string;
}

async function executeWithRetry(task: WriteTask): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await task.fn();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mondayWrite] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      } else {
        return `${task.label} (${task.columnId}): ${msg}`;
      }
    }
  }
  return null;
}

/** Push a status field if it has a value and we can resolve the index. */
function pushStatus(
  tasks: WriteTask[],
  itemId: string,
  label: string,
  columnId: string,
  value: string | undefined,
  options: StatusOption[],
) {
  if (!value) return;
  const idx = labelToIndex(options, value);
  if (idx === undefined) return;
  tasks.push({
    label,
    columnId,
    fn: () => writeStatusIndex(itemId, columnId, idx),
  });
}

export type TabContext = "evaluate" | "sendRequest" | "confirmReceipt" | "chase";

export async function sendPatientToMonday(
  p: Patient,
  context: TabContext,
): Promise<void> {
  const tasks: WriteTask[] = [];

  // ---- Evaluate tab ----
  if (context === "evaluate") {
    // Clinical eval checklist statuses
    pushStatus(tasks, p.id, "CGM Script", COL.cgmScript, p.cgmScript, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Hypo Language", COL.hypoLanguage, p.hypoLanguage, LANGUAGE_OPTS);
    pushStatus(tasks, p.id, "Insulin Language", COL.insulinLanguage, p.insulinLanguage, LANGUAGE_OPTS);
    pushStatus(tasks, p.id, "IP Script", COL.ipScript, p.ipScript, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Diabetes Education", COL.diabetesEducation, p.diabetesEducation, STANDARD_EVAL);
    pushStatus(tasks, p.id, "3+ Injections", COL.threeInjections, p.threeInjections, STANDARD_EVAL);
    pushStatus(tasks, p.id, "CGM Use", COL.cgmUse, p.cgmUse, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Blood Sugar Issues", COL.bloodSugarIssues, p.bloodSugarIssues, BLOOD_SUGAR_OPTS);
    pushStatus(tasks, p.id, "LMN", COL.lmn, p.lmn, STANDARD_EVAL);
    pushStatus(tasks, p.id, "OOW Date", COL.oowDate, p.oowDate, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Malfunction", COL.malfunction, p.malfunction, STANDARD_EVAL);
    pushStatus(tasks, p.id, "Diagnosis", COL.diagnosis, p.diagnosis, DIAGNOSIS_OPTS);
    // MR + MedNec
    pushStatus(tasks, p.id, "MRs / Clinicals", COL.mrsClinicals, p.mrsClinicals, MR_OPTS);
    pushStatus(tasks, p.id, "Medical Necessity", COL.medicalNecessity, p.medicalNecessity, MED_NEC_OPTS);
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2A → Complete + Sub-Stage → 2B
    tasks.push({
      label: "Advancer 2A",
      columnId: COL.advancer2a,
      fn: () => writeStatusIndex(p.id, COL.advancer2a, ADVANCER_2A_INDEX.complete),
    });
    tasks.push({
      label: "Sub-Stage → Send Request",
      columnId: COL.subStage,
      fn: () => writeStatusIndex(p.id, COL.subStage, SUB_STAGE_INDEX.sendRequest),
    });
  }

  // ---- Send Request tab ----
  if (context === "sendRequest") {
    pushStatus(tasks, p.id, "Generate CGM Script", COL.generateCgmScript, p.generateCgmScript, GEN_SCRIPT_OPTS);
    pushStatus(tasks, p.id, "Generate IP Script", COL.generateIpScript, p.generateIpScript, GEN_SCRIPT_OPTS);
    pushStatus(tasks, p.id, "Clinicals Method", COL.clinicalsMethod, p.clinicalsMethod, CLINICALS_METHOD_OPTS);
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2B → Complete + Sub-Stage → 2C
    tasks.push({
      label: "Advancer 2B",
      columnId: COL.advancer2b,
      fn: () => writeStatusIndex(p.id, COL.advancer2b, ADVANCER_2B_INDEX.complete),
    });
    tasks.push({
      label: "Sub-Stage → Confirm Receipt",
      columnId: COL.subStage,
      fn: () => writeStatusIndex(p.id, COL.subStage, SUB_STAGE_INDEX.confirmReceipt),
    });
  }

  // ---- Confirm Receipt tab ----
  if (context === "confirmReceipt") {
    pushStatus(tasks, p.id, "MRs / Clinicals", COL.mrsClinicals, p.mrsClinicals, MR_OPTS);
    pushStatus(tasks, p.id, "MN Attempts", COL.mnAttempts, p.mnAttempts, MN_ATTEMPTS_OPTS);
    if (p.receiptConfirmedDate) {
      tasks.push({
        label: "Receipt Confirmed Date",
        columnId: COL.receiptConfirmedDate,
        fn: () => writeDate(p.id, COL.receiptConfirmedDate, p.receiptConfirmedDate!),
      });
    }
    if (p.receiptConfirmedName) {
      tasks.push({
        label: "Receipt Confirmed Name",
        columnId: COL.receiptConfirmedName,
        fn: () => writeText(p.id, COL.receiptConfirmedName, p.receiptConfirmedName!),
      });
    }
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2C → Complete + Sub-Stage → 2D
    tasks.push({
      label: "Advancer 2C",
      columnId: COL.advancer2c,
      fn: () => writeStatusIndex(p.id, COL.advancer2c, ADVANCER_2C_INDEX.complete),
    });
    tasks.push({
      label: "Sub-Stage → Chase",
      columnId: COL.subStage,
      fn: () => writeStatusIndex(p.id, COL.subStage, SUB_STAGE_INDEX.chase),
    });
  }

  // ---- Chase tab ----
  if (context === "chase") {
    pushStatus(tasks, p.id, "MRs / Clinicals", COL.mrsClinicals, p.mrsClinicals, MR_OPTS);
    pushStatus(tasks, p.id, "MN Attempts", COL.mnAttempts, p.mnAttempts, MN_ATTEMPTS_OPTS);
    if (p.nextActionDate) {
      tasks.push({
        label: "Next Action Date",
        columnId: COL.nextActionDate,
        fn: () => writeDate(p.id, COL.nextActionDate, p.nextActionDate!),
      });
    }
    if (p.chaseRecipientName) {
      tasks.push({
        label: "Chase Recipient Name",
        columnId: COL.chaseRecipientName,
        fn: () => writeText(p.id, COL.chaseRecipientName, p.chaseRecipientName!),
      });
    }
    if (p.mnEvalNotes) {
      tasks.push({
        label: "MN Workflow Notes",
        columnId: COL.mnEvalNotes,
        fn: () => writeLongText(p.id, COL.mnEvalNotes, p.mnEvalNotes!),
      });
    }
    // Advancer 2D → Complete
    tasks.push({
      label: "Advancer 2D",
      columnId: COL.advancer2d,
      fn: () => writeStatusIndex(p.id, COL.advancer2d, ADVANCER_2D_INDEX.complete),
    });
  }

  // ---- Execute with read-back verification before advancing stage ----
  // Both the advancer columns and subStage trigger Monday automations,
  // so they must be written after all data columns are verified.
  const stageColumnIds = [
    COL.advancer2a, COL.advancer2b, COL.advancer2c, COL.advancer2d,
    COL.subStage,
  ];

  const failures = await executeWritesWithVerification({
    itemId: p.id,
    tasks,
    stageColumnId: stageColumnIds,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
  });

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} column(s) failed after retries. Check debug column.`,
    );
  }
}
