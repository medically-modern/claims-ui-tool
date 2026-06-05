// Direct (non-debounced) batch writes to Monday for a single patient.
// All edits are kept local until the user clicks "Send to Monday".
//
// Each column write retries up to 2 times on failure. Any columns that
// still fail after retries are logged to the "Josh Debug" column so
// nothing is silently lost.

import { writeStatusIndex, writeLongText, writeDropdownIds, writeText, writeDate, writeNumber, writeItemName, writePhone, writeEmail, writeSimpleValue, writeLocation, readColumnTexts, COL } from "./mondayApi";
import { executeWritesWithVerification } from "../shared/verifiedWrite";
import { resolveHcpcs, isAutoFilledMedicaidSupply, PRIMARY_INSURANCE_INDEX, SECONDARY_INSURANCE_INDEX } from "./hcpcRules";
import type { PrimaryInsurance } from "./hcpcRules";
import {
  AUTH_RESULT_INDEX,
  AUTH_METHOD_OPTION_ID,
  ESCALATION_INDEX,
  NOT_CLEAR_PRODUCT_ID,
  PRODUCT_CODE_TO_PRODUCT_ID,
  TRIGGER_DVS_INDEX,
  SKIP_SOS_PRODUCT_ID,
  STAGE_INDEX,
  UNIVERSAL_INDEX,
} from "./mondayMapping";
import type { Patient, ProductCodeId, ProductCodeState } from "./workflow";
import { EMPTY_INSURANCE, deriveInsuranceOutcome, computeNextOrderDates } from "./workflow";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  /** Expected text value after the write. Used for read-back verification
   *  before the stage advancer is written. */
  expectedText?: string;
}

/**
 * Execute a single write with retries.
 * Returns null on success, or an error message string on final failure.
 */
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

/**
 * Push every relevant column for a patient to Monday in one batch.
 * Each column is written independently with retries. Columns that fail
 * after all retries are logged to the Josh Debug column.
 *
 * Throws if any columns failed (after logging), so the UI shows an error.
 */
export async function sendPatientToMonday(p: Patient, context: "benefits" | "submitAuth" | "authOutstanding" = "benefits"): Promise<void> {
  const ins = p.insurance ?? EMPTY_INSURANCE;
  const tasks: WriteTask[] = [];

  // ----- Guard: require Serving + Primary Insurance -----
  const resolved = resolveHcpcs(p.primaryInsurance || null, p.serving || null, p.secondaryInsurance ?? null);
  if (!p.serving || !p.primaryInsurance || resolved.length === 0) {
    throw new Error(
      "Cannot send: Serving and Primary Insurance must both be selected before writing to Monday.",
    );
  }

  // ----- Universal: Active / In-Network -----
  const inNet = ins.universal["in-network"];
  const active = ins.universal["active"];
  if (inNet === "confirmed" && active === "confirmed") {
    tasks.push({
      label: "Active/Network",
      columnId: COL.activeNetwork,
      fn: () => writeStatusIndex(p.id, COL.activeNetwork, UNIVERSAL_INDEX.activeNetwork.pass),
    });
  } else if (inNet === "not-confirmed" || active === "not-confirmed") {
    tasks.push({
      label: "Active/Network",
      columnId: COL.activeNetwork,
      fn: () => writeStatusIndex(p.id, COL.activeNetwork, UNIVERSAL_INDEX.activeNetwork.fail),
    });
  }

  // ----- Universal: DME Benefits -----
  const dme = ins.universal["dme-benefits"];
  if (dme === "confirmed") {
    tasks.push({
      label: "DME Benefits",
      columnId: COL.dmeBenefits,
      fn: () => writeStatusIndex(p.id, COL.dmeBenefits, UNIVERSAL_INDEX.dmeBenefits.pass),
    });
  } else if (dme === "not-confirmed") {
    tasks.push({
      label: "DME Benefits",
      columnId: COL.dmeBenefits,
      fn: () => writeStatusIndex(p.id, COL.dmeBenefits, UNIVERSAL_INDEX.dmeBenefits.fail),
    });
  }

  // ----- Per-product auth-result columns -----
  // Build entries from resolved products. For Medicaid-billed supplies
  // (hidden in the UI) the user never sets state, so we auto-fill
  // Auth=Required, SoS=Clear here — matching the UI preview's behavior.
  // We also tag the entry with isMedicaidSupply so the Submit Auth write
  // path can leave these supplies at "Required" (the Monday DVS-trigger
  // automation expects them to flip from blank → Required at Benefits
  // send and stay Required until IP Auth Result becomes Auth Valid /
  // Not Serving).
  const entries = resolved
    .map((r) => {
      const cid = Object.entries(PRODUCT_CODE_TO_PRODUCT_ID).find(([, v]) => v === r.product)?.[0] as
        | ProductCodeId
        | undefined;
      if (!cid) return null;
      const userState = ins.codes[cid];
      const isMedicaidSupply = isAutoFilledMedicaidSupply(r);
      const state: ProductCodeState | undefined = isMedicaidSupply
        ? { ...(userState ?? { status: "pending" }), auth: "required", sos: "clear" }
        : userState;
      return { cid, state, isMedicaidSupply };
    })
    .filter(
      (e): e is { cid: ProductCodeId; state: ProductCodeState | undefined; isMedicaidSupply: boolean } =>
        !!e,
    );

  // Effective insurance state with auto-filled codes — used by
  // deriveInsuranceOutcome below so blocker/auth-required/all-clear logic
  // sees the same picture as the UI preview.
  const effectiveCodes: typeof ins.codes = { ...ins.codes };
  for (const e of entries) {
    if (e.state) effectiveCodes[e.cid] = e.state;
  }
  const effectiveIns = { ...ins, codes: effectiveCodes };

  // Write auth result for served products (skip for authOutstanding — handled separately below)
  const servedProductKeys = new Set(entries.map((e) => PRODUCT_CODE_TO_PRODUCT_ID[e.cid]));
  if (context !== "authOutstanding") {
  for (const { cid, state, isMedicaidSupply } of entries) {
    if (!state?.auth) continue;
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
    const authColumnId = COL.authResult[productId];
    if (state.auth === "required") {
      // When sending from Submit Auth tab, flip auth result to "Submitted"
      // — but skip Medicaid-routed supplies. They stay at "Required" so
      // the Monday automation can trigger DVS later, when IP Auth Result
      // changes to Auth Valid (or Not Serving for Supplies-Only patients).
      if (context === "submitAuth") {
        if (isMedicaidSupply) {
          console.log(`[mondayWrite] submitAuth: skipping Medicaid-routed supply ${productId} (staying at Required)`);
          continue;
        }
        console.log(`[mondayWrite] submitAuth: writing ${productId} → Submitted`);
        tasks.push({
          label: `Auth result: ${productId}`,
          columnId: authColumnId,
          fn: () => writeStatusIndex(p.id, authColumnId, AUTH_RESULT_INDEX.submitted),
        });
      } else {
        tasks.push({
          label: `Auth result: ${productId}`,
          columnId: authColumnId,
          fn: () => writeStatusIndex(p.id, authColumnId, AUTH_RESULT_INDEX.required),
        });
      }
    } else if (state.auth === "not-required" && context !== "submitAuth" && (context as string) !== "authOutstanding") {
      // Skip when in submit-auth flow — leave non-auth-required results untouched
      tasks.push({
        label: `Auth result: ${productId}`,
        columnId: authColumnId,
        fn: () => writeStatusIndex(p.id, authColumnId, AUTH_RESULT_INDEX.noAuthNeeded),
      });
    }
  }
  }

  // Write "Not Serving" for products NOT in this patient's serving type
  // Skip when in submit-auth flow — leave other auth results untouched
  if (context !== "submitAuth" && (context as string) !== "authOutstanding") {
    const allProductIds = Object.keys(COL.authResult) as Array<keyof typeof COL.authResult>;
    for (const prodKey of allProductIds) {
      if (!servedProductKeys.has(prodKey)) {
        tasks.push({
          label: `Auth result: ${prodKey} (not serving)`,
          columnId: COL.authResult[prodKey],
          fn: () => writeStatusIndex(p.id, COL.authResult[prodKey], AUTH_RESULT_INDEX.notServing),
        });
      }
    }
  }

  // ----- Not Clear Products + Skip SoS Products dropdowns -----
  // Effective SoS per product = recheck if set, else the Benefits-page sos.
  // This way an Auth Outstanding recheck of Clear / Not Clear properly
  // moves a product between the two dropdowns and out of skip.
  const effectiveSos = (e: typeof entries[number]): "" | "clear" | "not-clear" | "skip" => {
    const recheck = e.state?.sosRecheck;
    if (recheck === "clear" || recheck === "not-clear") return recheck;
    return (e.state?.sos as "" | "clear" | "not-clear" | "skip" | undefined) ?? "";
  };

  const notClearIds = entries
    .filter((e) => effectiveSos(e) === "not-clear")
    .map((e) => NOT_CLEAR_PRODUCT_ID[e.cid])
    .filter((n): n is number => typeof n === "number");
  tasks.push({
    label: "Not Clear Products",
    columnId: COL.notClearProducts,
    fn: () => writeDropdownIds(p.id, COL.notClearProducts, notClearIds),
  });

  const skipIds = entries
    .filter((e) => effectiveSos(e) === "skip")
    .map((e) => SKIP_SOS_PRODUCT_ID[e.cid])
    .filter((n): n is number => typeof n === "number");
  tasks.push({
    label: "Skip SoS Products",
    columnId: COL.skipSosProducts,
    fn: () => writeDropdownIds(p.id, COL.skipSosProducts, skipIds),
  });

  // ----- Per-product Last Bill Date (date — when SoS = Not Clear OR Auth = No Auth Needed) -----
  for (const { cid, state } of entries) {
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
    const lastBillDateCol = COL.lastBillDate[productId];
    const eSos = effectiveSos({ cid, state, isMedicaidSupply: false });
    const noAuthNeeded = state?.authOutstandingResult === "no-auth-needed";
    if ((eSos === "not-clear" || noAuthNeeded) && state?.lastBillDate) {
      tasks.push({
        label: `Last Bill Date: ${productId}`,
        columnId: lastBillDateCol,
        fn: () => writeDate(p.id, lastBillDateCol, state.lastBillDate!),
      });
    } else {
      // Clear last bill date when neither condition applies
      tasks.push({
        label: `Last Bill Date (clear): ${productId}`,
        columnId: lastBillDateCol,
        fn: () => writeDate(p.id, lastBillDateCol, ""),
      });
    }
  }

  // ----- Calculated Next Order Dates (3 columns) -----
  {
    const nod = computeNextOrderDates(effectiveIns, p.primaryInsurance ?? "", p.secondaryInsurance ?? "");
    // IP Next Order Date
    tasks.push({
      label: "IP Next Order Date",
      columnId: COL.nextOrderDate.insulin_pump,
      fn: () => writeDate(p.id, COL.nextOrderDate.insulin_pump, nod.ipNextOrderDate),
    });
    // Sensors Next Order Date
    tasks.push({
      label: "Sensors Next Order Date",
      columnId: COL.nextOrderDate.sensors,
      fn: () => writeDate(p.id, COL.nextOrderDate.sensors, nod.sensorsNextOrderDate),
    });
    // Supplies Next Order Date
    tasks.push({
      label: "Supplies Next Order Date",
      columnId: COL.nextOrderDate.supplies,
      fn: () => writeDate(p.id, COL.nextOrderDate.supplies, nod.suppliesNextOrderDate),
    });
  }

  // ----- Aggregate SoS + Auth -----
  // SoS is now always required for every product (no auth-required skip
  // carve-out). A patient is "all filled" only when every served product
  // has both Auth and SoS picked.
  const states = entries.map((e) => e.state);
  const allFilled =
    states.length > 0 &&
    entries.every((e) => !!e.state?.auth && !!effectiveSos(e));
  if (allFilled) {
    const anyAuth = states.some((s) => s?.auth === "required");
    const anyNotClear = entries.some((e) => effectiveSos(e) === "not-clear");
    const anySkip = entries.some((e) => effectiveSos(e) === "skip");

    tasks.push({
      label: "Auth aggregate",
      columnId: COL.auth,
      fn: () =>
        writeStatusIndex(p.id, COL.auth, anyAuth ? UNIVERSAL_INDEX.auth.required : UNIVERSAL_INDEX.auth.noAuth),
    });

    // SoS aggregate priority:
    //   not-clear > skip > clear
    const sosIndex = anyNotClear
      ? UNIVERSAL_INDEX.sos.fail
      : anySkip
        ? UNIVERSAL_INDEX.sos.skip
        : UNIVERSAL_INDEX.sos.pass;
    tasks.push({
      label: "SoS aggregate",
      columnId: COL.sos,
      fn: () => writeStatusIndex(p.id, COL.sos, sosIndex),
    });
  }

  // ----- Debug: trace deriveInsuranceOutcome -----
  {
    const _outcome = deriveInsuranceOutcome(effectiveIns, entries.map(e => e.cid));
    const _codeStates = Object.values(effectiveIns.codes).filter(Boolean);
    console.log('[mondayWrite] context:', context);
    console.log('[mondayWrite] universal:', JSON.stringify(effectiveIns.universal));
    console.log('[mondayWrite] codeStates:', JSON.stringify(_codeStates.map((c: any) => ({ auth: c.auth, sos: c.sos }))));
    console.log('[mondayWrite] entries:', JSON.stringify(entries.map(e => ({ cid: e.cid, auth: e.state?.auth, sos: e.state?.sos }))));
    console.log('[mondayWrite] deriveInsuranceOutcome =>', _outcome);
  }

  // ----- Escalation + Stage Advancer -----
  // One write each per send. Per-context rules decide the Stage Advancer
  // index, and Escalation is computed as: manual toggle (p.escalated) is
  // the floor — true means "Required" no matter what auto rules say.
  // Auto rules can also force Required (denial / blocker). When neither
  // manual nor auto demands escalation, we write "Done" so the toggle
  // round-trips through Monday cleanly.
  const manualEscalate = p.escalated === true;
  let stageWriteIndex: number | null = null;
  type EscalationDecision = "required" | "done";
  let escalationDecision: EscalationDecision = manualEscalate ? "required" : "done";

  if (context === "submitAuth") {
    stageWriteIndex = STAGE_INDEX.authOutstanding;
    // submitAuth doesn't auto-touch escalation; manual toggle decides.
  } else if (context === "authOutstanding") {
    // Auth Outstanding outcome rules (priority order):
    //   1. ANY product denied                → Stage = Auth Denied + Escalation Required
    //   2. ALL served products fully resolved → Stage = Complete
    //      (auth-valid or no-auth-needed count as resolved regardless
    //       of SoS status — SoS Not Clear does NOT block completion)
    //   3. Otherwise (partial — some product
    //      missing a result)                 → leave Stage Advancer alone
    const anyDenied = entries.some(
      (e) => e.state?.authOutstandingResult === "denied",
    );
    const isProductResolved = (e: typeof entries[number]) => {
      // Products that were auth=not-required on Benefits never appear on
      // the Auth Outstanding UI, so they have no authOutstandingResult to
      // fill in. They're already resolved — no auth work needed.
      if (e.state?.auth === "not-required") return true;
      const r = e.state?.authOutstandingResult;
      if (r === "auth-valid") return true;
      if (r === "no-auth-needed") return true;
      return false;
    };
    const allResolved =
      entries.length > 0 && entries.every(isProductResolved);

    // Diagnostic — verify the rule sees the right per-product results.
    console.log("[mondayWrite] authOutstanding rule:", {
      anyDenied,
      allResolved,
      manualEscalate,
      results: entries.map((e) => ({
        cid: e.cid,
        authOutstandingResult: e.state?.authOutstandingResult ?? "(unset)",
        sos: e.state?.sos ?? "(unset)",
        sosRecheck: e.state?.sosRecheck ?? "(unset)",
      })),
    });

    if (anyDenied) {
      stageWriteIndex = STAGE_INDEX.authDenied;
      escalationDecision = "required"; // forced by denial regardless of toggle
    } else if (allResolved) {
      stageWriteIndex = STAGE_INDEX.complete;
      // escalation follows manualEscalate (already set above)
    }
    // else: partial → no Stage Advancer write; escalation still follows toggle
  } else {
    // benefits page — use insurance outcome to drive Stage Advancer.
    const outcome = deriveInsuranceOutcome(effectiveIns, entries.map(e => e.cid));
    if (outcome === "all-clear") stageWriteIndex = STAGE_INDEX.complete;
    else if (outcome === "auth-required") stageWriteIndex = STAGE_INDEX.authorization;
    else stageWriteIndex = STAGE_INDEX.benefitsSos;
    // Blocker condition force-elevates escalation.
    if (outcome === "blocker") escalationDecision = "required";
  }

  if (stageWriteIndex !== null) {
    const finalStageIndex = stageWriteIndex;
    tasks.push({
      label: "Stage Advancer",
      columnId: COL.stageAdvancer,
      fn: () => writeStatusIndex(p.id, COL.stageAdvancer, finalStageIndex),
    });
  }
  // Always write the Escalation column so the toggle round-trips: an
  // agent toggling OFF + sending will clear a previously-required flag.
  tasks.push({
    label: "Escalation",
    columnId: COL.escalation,
    fn: () =>
      writeStatusIndex(
        p.id,
        COL.escalation,
        escalationDecision === "required"
          ? ESCALATION_INDEX.required
          : ESCALATION_INDEX.done,
      ),
  });
  console.log(`[mondayWrite] Stage = ${stageWriteIndex ?? "(no change)"}, Escalation = ${escalationDecision}`);

  // ----- Never Billed attestations (Medicare A&B) -----
  if (ins.neverBilledIsCar) {
    tasks.push({
      label: "Never billed IS/Car",
      columnId: COL.neverBilledIsCar,
      fn: () => writeStatusIndex(p.id, COL.neverBilledIsCar, 0),
    });
  }
  if (ins.neverBilledCgm) {
    tasks.push({
      label: "Never billed CGM",
      columnId: COL.neverBilledCgm,
      fn: () => writeStatusIndex(p.id, COL.neverBilledCgm, 0),
    });
  }

  // ----- Trigger DVS (Medicaid + supplies) -----
  // Only write when the agent toggled the button on the Benefits page.
  if (p.triggerDvs) {
    tasks.push({
      label: "Trigger DVS",
      columnId: COL.triggerDvs,
      fn: () => writeStatusIndex(p.id, COL.triggerDvs, TRIGGER_DVS_INDEX.triggerDvs),
    });
  }

  // ----- Per-product auth submission fields (Authorizations tab) -----
  for (const { cid, state } of entries) {
    if (!state) continue;
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];

    // Auth Submission Method (dropdown)
    if (state.authSubmissionMethod) {
      const optId = AUTH_METHOD_OPTION_ID[state.authSubmissionMethod];
      if (optId !== undefined) {
        tasks.push({
          label: `Auth method: ${productId}`,
          columnId: COL.authMethod[productId],
          fn: () => writeDropdownIds(p.id, COL.authMethod[productId], [optId]),
        });
      }
    }

    // Auth Submission Date (text column)
    if (state.authSubmissionDate) {
      tasks.push({
        label: `Auth submit date: ${productId}`,
        columnId: COL.authSubmissionDate[productId],
        fn: () => writeText(p.id, COL.authSubmissionDate[productId], state.authSubmissionDate!),
      });
    }

    // Auth ID (text column)
    if (state.authId) {
      tasks.push({
        label: `Auth ID: ${productId}`,
        columnId: COL.authId[productId],
        fn: () => writeText(p.id, COL.authId[productId], state.authId!),
      });
    }

    // Auth Start (date column)
    if (state.authStart) {
      tasks.push({
        label: `Auth start: ${productId}`,
        columnId: COL.authStart[productId],
        fn: () => writeDate(p.id, COL.authStart[productId], state.authStart!),
      });
    }

    // Auth End (date column)
    if (state.authEnd) {
      tasks.push({
        label: `Auth end: ${productId}`,
        columnId: COL.authEnd[productId],
        fn: () => writeDate(p.id, COL.authEnd[productId], state.authEnd!),
      });
    }

    // Auth Units (numeric column)
    if (state.authUnits) {
      tasks.push({
        label: `Auth units: ${productId}`,
        columnId: COL.authUnits[productId],
        fn: () => writeNumber(p.id, COL.authUnits[productId], state.authUnits!),
      });
    }
  }

  // ----- Call/Fax Number (single shared column) -----
  // The Monday board has one Call/Fax Number column for the whole patient.
  // If any served product was submitted via Call or Fax, write the first
  // non-empty callFaxNumber we find to that column.
  {
    const cf = entries.find(
      (e) =>
        (e.state?.authSubmissionMethod === "Call" ||
          e.state?.authSubmissionMethod === "Fax") &&
        !!e.state?.callFaxNumber,
    );
    if (cf?.state?.callFaxNumber) {
      const num = cf.state.callFaxNumber;
      tasks.push({
        label: "Call/Fax Number",
        columnId: COL.callFaxNumber,
        fn: () => writeText(p.id, COL.callFaxNumber, num),
      });
    }
  }

  // ----- Auth Outstanding: per-product auth result (Auth Valid / Denied / No Auth Needed) -----
  if (context === "authOutstanding") {
    console.log('[mondayWrite] authOutstanding entries:', entries.map(e => ({
      cid: e.cid,
      product: PRODUCT_CODE_TO_PRODUCT_ID[e.cid],
      authOutstandingResult: e.state?.authOutstandingResult,
      authColumnId: COL.authResult[PRODUCT_CODE_TO_PRODUCT_ID[e.cid]],
    })));
    for (const { cid, state } of entries) {
      if (!state?.authOutstandingResult) {
        console.log(`[mondayWrite] SKIPPED ${cid}: no authOutstandingResult`, state);
        continue;
      }
      const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
      const authColumnId = COL.authResult[productId];
      const resultIndex =
        state.authOutstandingResult === "auth-valid"
          ? AUTH_RESULT_INDEX.authValid
          : state.authOutstandingResult === "no-auth-needed"
            ? AUTH_RESULT_INDEX.noAuthNeeded
            : AUTH_RESULT_INDEX.denied;
      console.log(`[mondayWrite] WRITING auth result: ${productId} → index ${resultIndex} (col: ${authColumnId})`);
      tasks.push({
        label: `Auth result: ${productId}`,
        columnId: authColumnId,
        fn: () => writeStatusIndex(p.id, authColumnId, resultIndex),
      });

      // No Auth Needed → also blank out the per-product auth detail
      // columns (Auth ID / Start / End / Units) so they don't keep
      // stale values from a prior pass.
      if (state.authOutstandingResult === "no-auth-needed") {
        tasks.push({
          label: `Auth ID (clear): ${productId}`,
          columnId: COL.authId[productId],
          fn: () => writeText(p.id, COL.authId[productId], ""),
        });
        tasks.push({
          label: `Auth Start (clear): ${productId}`,
          columnId: COL.authStart[productId],
          fn: () => writeDate(p.id, COL.authStart[productId], ""),
        });
        tasks.push({
          label: `Auth End (clear): ${productId}`,
          columnId: COL.authEnd[productId],
          fn: () => writeDate(p.id, COL.authEnd[productId], ""),
        });
        tasks.push({
          label: `Auth Units (clear): ${productId}`,
          columnId: COL.authUnits[productId],
          fn: () => writeNumber(p.id, COL.authUnits[productId], ""),
        });
      }
    }
  }

  // ----- Carecentrix Intake ID (single shared text column) -----
  // Top-level patient field (entered from profile card)
  if (p.carecentrixIntakeId) {
    tasks.push({
      label: "Carecentrix Intake ID (profile)",
      columnId: COL.carecentrixIntakeId,
      fn: () => writeText(p.id, COL.carecentrixIntakeId, p.carecentrixIntakeId!),
    });
  }
  // Per-product code fallback (from checklist steps)
  const allCodeStates = Object.values(ins.codes).filter(Boolean) as ProductCodeState[];
  const intakeId = allCodeStates.map((s) => s.intakeId).find((v) => !!v);
  if (intakeId && !p.carecentrixIntakeId) {
    tasks.push({
      label: "Carecentrix Intake ID",
      columnId: COL.carecentrixIntakeId,
      fn: () => writeText(p.id, COL.carecentrixIntakeId, intakeId),
    });
  }


  // ----- Per-product auth submission fields (Authorizations tab) -----
  for (const { cid, state } of entries) {
    if (!state) continue;
    const productId = PRODUCT_CODE_TO_PRODUCT_ID[cid];
    const productLabel = cid;

    // Auth Submission Method (dropdown)
    if (state.authSubmissionMethod) {
      const optId = AUTH_METHOD_OPTION_ID[state.authSubmissionMethod];
      if (optId !== undefined) {
        const colId = COL.authMethod[productId];
        tasks.push({
          label: `Auth Method (${productLabel})`,
          columnId: colId,
          fn: () => writeDropdownIds(p.id, colId, [optId]),
        });
      }
    }

    // Auth Submission Date (text column)
    if (state.authSubmissionDate) {
      const colId = COL.authSubmissionDate[productId];
      const v = state.authSubmissionDate;
      tasks.push({
        label: `Auth Submission Date (${productLabel})`,
        columnId: colId,
        fn: () => writeText(p.id, colId, v),
      });
    }

    // Auth ID (text column)
    if (state.authId) {
      const colId = COL.authId[productId];
      const v = state.authId;
      tasks.push({
        label: `Auth ID (${productLabel})`,
        columnId: colId,
        fn: () => writeText(p.id, colId, v),
      });
    }

    // Auth Start (date column)
    if (state.authStart) {
      const colId = COL.authStart[productId];
      const v = state.authStart;
      tasks.push({
        label: `Auth Start (${productLabel})`,
        columnId: colId,
        fn: () => writeDate(p.id, colId, v),
      });
    }

    // Auth End (date column)
    if (state.authEnd) {
      const colId = COL.authEnd[productId];
      const v = state.authEnd;
      tasks.push({
        label: `Auth End (${productLabel})`,
        columnId: colId,
        fn: () => writeDate(p.id, colId, v),
      });
    }

    // Auth Units (numeric column)
    if (state.authUnits) {
      const colId = COL.authUnits[productId];
      const v = state.authUnits;
      tasks.push({
        label: `Auth Units (${productLabel})`,
        columnId: colId,
        fn: () => writeNumber(p.id, colId, v),
      });
    }
  }

  // ----- Profile fields (editable from PatientProfileCard) -----
  // Item name
  if (p.name) {
    tasks.push({
      label: 'Patient Name',
      columnId: 'name',
      fn: () => writeItemName(p.id, p.name),
    });
  }
  // DOB (text column)
  if (p.dob) {
    tasks.push({
      label: 'DOB',
      columnId: COL.dob,
      fn: () => writeText(p.id, COL.dob, p.dob),
    });
  }
  // Primary Insurance (status column)
  if (p.primaryInsurance) {
    const idx = PRIMARY_INSURANCE_INDEX[p.primaryInsurance as PrimaryInsurance];
    if (idx !== undefined) {
      tasks.push({
        label: 'Primary Insurance',
        columnId: COL.primaryInsurance,
        fn: () => writeStatusIndex(p.id, COL.primaryInsurance, idx),
      });
    }
  }
  // Member IDs (text columns)
  if (p.memberId1 !== undefined) {
    tasks.push({
      label: 'Member ID 1',
      columnId: COL.memberId1,
      fn: () => writeText(p.id, COL.memberId1, p.memberId1 ?? ''),
    });
  }
  if (p.memberId2 !== undefined) {
    tasks.push({
      label: 'Member ID 2',
      columnId: COL.memberId2,
      fn: () => writeText(p.id, COL.memberId2, p.memberId2 ?? ''),
    });
  }
  // Secondary Insurance (status column)
  if (p.secondaryInsurance !== undefined) {
    const secIdx = SECONDARY_INSURANCE_INDEX[p.secondaryInsurance ?? ""];
    if (secIdx !== undefined) {
      tasks.push({
        label: 'Secondary Insurance',
        columnId: COL.secondaryInsurance,
        fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, secIdx),
      });
    }
  }
  // Diagnosis (status column — write by label)
  if (p.diagnosis) {
    tasks.push({
      label: 'Diagnosis',
      columnId: COL.diagnosis,
      fn: () => writeSimpleValue(p.id, COL.diagnosis, p.diagnosis!),
    });
  }
  // Doctor fields
  if (p.doctorName !== undefined) {
    tasks.push({
      label: 'Doctor Name',
      columnId: COL.doctorName,
      fn: () => writeText(p.id, COL.doctorName, p.doctorName ?? ''),
    });
  }
  if (p.doctorPhone !== undefined) {
    tasks.push({
      label: 'Doctor Phone',
      columnId: COL.doctorPhone,
      fn: () => writePhone(p.id, COL.doctorPhone, p.doctorPhone ?? ''),
    });
  }
  if (p.doctorNpi !== undefined) {
    tasks.push({
      label: 'Doctor NPI',
      columnId: COL.doctorNpi,
      fn: () => writeText(p.id, COL.doctorNpi, p.doctorNpi ?? ''),
    });
  }
  if (p.doctorEmail !== undefined) {
    tasks.push({
      label: 'Doctor Email',
      columnId: COL.doctorEmail,
      fn: () => writeEmail(p.id, COL.doctorEmail, p.doctorEmail ?? ''),
    });
  }
  if (p.doctorFax !== undefined) {
    tasks.push({
      label: 'Doctor Fax',
      columnId: COL.doctorFax,
      fn: () => writeEmail(p.id, COL.doctorFax, p.doctorFax ?? ''),
    });
  }
  // Clinicals Method (status column — write by label)
  if (p.clinicalsMethod) {
    tasks.push({
      label: 'Clinicals Method',
      columnId: COL.clinicalsMethod,
      fn: () => writeSimpleValue(p.id, COL.clinicalsMethod, p.clinicalsMethod!),
    });
  }
  // Clinic Name (dropdown — write by label via simple value)
  if (p.clinicName) {
    tasks.push({
      label: 'Clinic Name',
      columnId: COL.clinicName,
      fn: () => writeSimpleValue(p.id, COL.clinicName, p.clinicName!),
    });
  }
  // Patient Phone (phone column)
  if (p.patientPhone !== undefined) {
    tasks.push({
      label: 'Patient Phone',
      columnId: COL.patientPhone,
      fn: () => writePhone(p.id, COL.patientPhone, p.patientPhone ?? ''),
    });
  }
  // Patient Address (location column)
  if (p.patientAddress) {
    tasks.push({
      label: 'Patient Address',
      columnId: COL.patientAddress,
      fn: () => writeLocation(p.id, COL.patientAddress, p.patientAddress ?? ''),
    });
  }

  // ----- Notes (long text) -----
  if (typeof p.notes === "string") {
    tasks.push({
      label: "Call Reference Notes",
      columnId: COL.callReferenceNotes,
      fn: () => writeLongText(p.id, COL.callReferenceNotes, p.notes),
    });
  }

  // ----- Execute writes with read-back verification -----
  // Monday automations trigger on Stage Advancer changes and copy the
  // item to other boards. All data columns must be fully indexed before
  // that trigger fires — otherwise the copy gets stale values.
  const failures = await executeWritesWithVerification({
    itemId: p.id,
    tasks,
    stageColumnId: COL.stageAdvancer,
    executeWithRetry,
    readColumns: readColumnTexts,
    writeDebug: (id, msg) => writeText(id, COL.joshDebug, msg),
  });

  if (failures.length > 0) {
    const succeeded = tasks.length - failures.length;
    throw new Error(
      `${failures.length} column(s) failed after retries (${succeeded} succeeded). Check "Josh Debug" column. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}

