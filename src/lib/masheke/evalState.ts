// EvalState — local-only state for the Medical Necessity Evaluate tab.
// Lives in localStorage, keyed by patient ID. Never written to Monday.
// On Send (when reconnected), we'll derive Monday-bound values from this.

import type { IpPath } from "./ipPaths";
import { IP_PATH_FIELDS } from "./ipPaths";
import type { Patient } from "./workflow";

export type ValidInvalid = "Valid" | "Invalid" | "Missing";
export type YesNo = "Yes" | "No";
export type CgmCoveragePath = "Insulin" | "Hypo" | "Hypo Invalid" | "Missing";
export type LmnStatus = "Yes & Valid" | "Yes, but Invalid" | "No";

export interface LocalFile {
  name: string;
  size: number;
  addedAt: string; // ISO
}

export interface EvalState {
  // CGM block
  cgmScriptValid?: ValidInvalid;
  cgmCoveragePath?: CgmCoveragePath;
  generateCgmScript?: string; // "Generate" (or blank)

  // IP block
  ipCoveragePath?: IpPath;
  ipScriptValid?: ValidInvalid;
  generateIpScript?: string; // "Generate" (or blank)
  diabetesEducation?: YesNo;
  threeInjections?: YesNo;
  cgmUse?: YesNo;
  bloodSugarIssues?: YesNo;
  lmn?: LmnStatus;
  oowDate?: string; // ISO date YYYY-MM-DD
  /** Whether the OOW date is already written on the IP script. Only relevant
   *  when path = "OOW Pump" and oowDate is set. If "No", the doctor ask becomes
   *  "Add OOW date of {date} to the script". */
  oowDateOnScript?: YesNo;
  malfunction?: YesNo;

  // Diagnosis & Clinicals
  diagnosis?: string;
  lastVisitDate?: string; // ISO date
  clinicalFiles?: LocalFile[];
  finalClinicalFiles?: LocalFile[];
  mrReceived?: YesNo;

  // Notes
  notes?: string;
}

const STORAGE_PREFIX = "mn-eval:";

export function loadEvalState(patientId: string): EvalState {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + patientId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EvalState;
    // Strip any stale "Generate" trigger values that may have been persisted
    // before we made these fields ephemeral.
    delete parsed.generateCgmScript;
    delete parsed.generateIpScript;
    return parsed;
  } catch {
    return {};
  }
}

export function saveEvalState(patientId: string, state: EvalState): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Strip transient "Generate" trigger fields — they are tied to a single
    // in-flight DocExport run and should not survive a reload. Otherwise the
    // toggle stays stuck on "Generating…" forever.
    const {
      generateCgmScript: _gcgm,
      generateIpScript: _gip,
      ...persistable
    } = state;
    void _gcgm;
    void _gip;
    localStorage.setItem(STORAGE_PREFIX + patientId, JSON.stringify(persistable));
  } catch {
    // Storage may be full or disabled — fail silently.
  }
}

export function clearEvalState(patientId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_PREFIX + patientId);
}

/**
 * Build an EvalState from the patient's current Monday columns. Used as the
 * initial form state when nothing is in localStorage, and after Reset.
 */
export function seedEvalStateFromPatient(patient: Patient): EvalState {
  const seed: EvalState = {};
  // IP / CGM Coverage Path — only seed if Monday has a non-"Not Serving" value
  // since "Not Serving" is auto-derived from Serving on send and isn't a path
  // the rep can pick from the dropdown.
  if (patient.ipCoveragePath && patient.ipCoveragePath !== "Not Serving") {
    seed.ipCoveragePath = patient.ipCoveragePath as EvalState["ipCoveragePath"];
  }
  if (patient.cgmCoveragePath && patient.cgmCoveragePath !== "Not Serving") {
    if (
      patient.cgmCoveragePath === "Insulin" ||
      patient.cgmCoveragePath === "Hypo" ||
      patient.cgmCoveragePath === "Hypo Invalid" ||
      patient.cgmCoveragePath === "Missing"
    ) {
      seed.cgmCoveragePath = patient.cgmCoveragePath;
    }
  }
  if (patient.diagnosis && patient.diagnosis !== "Evaluate") {
    seed.diagnosis = patient.diagnosis;
  }
  // MRs / Clinicals → Yes/No
  if (patient.mrsClinicals === "MR Received") seed.mrReceived = "Yes";
  else if (patient.mrsClinicals === "Collect") seed.mrReceived = "No";
  if (patient.lastVisit) seed.lastVisitDate = patient.lastVisit;
  if (patient.mnEvalNotes) seed.notes = patient.mnEvalNotes;
  return seed;
}

// ---- OOW Date validity ----

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * OOW Date marks when the pump goes out of warranty.
 *   • valid = true  → today is AFTER the OOW date (pump IS out of warranty)
 *   • valid = false → today is BEFORE the OOW date (pump still under warranty)
 *
 * `diffDays` is positive when past OOW, negative when still under warranty.
 */
export function isOowDateValid(
  oowDate: string | undefined,
  _primaryInsurance?: string | undefined,
): { valid: boolean; diffDays: number; ageDays: number; thresholdDays: number } | null {
  if (!oowDate) return null;
  const d = new Date(oowDate);
  if (Number.isNaN(d.getTime())) return null;
  const diffDays = (Date.now() - d.getTime()) / MS_PER_DAY;
  // valid when today is past the OOW date
  return { valid: diffDays > 0, diffDays, ageDays: diffDays, thresholdDays: 0 };
}

/** Human-readable relative time from a day count. */
export function formatOowDiff(diffDays: number): string {
  const abs = Math.abs(diffDays);
  if (abs < 1) return "today";
  if (abs < 7) return `${Math.round(abs)}d`;
  if (abs < 30) return `${Math.floor(abs / 7)}w ${Math.round(abs % 7)}d`;
  if (abs < 365.25) {
    const months = Math.floor(abs / 30.44);
    const days = Math.round(abs % 30.44);
    return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
  }
  const years = Math.floor(abs / 365.25);
  const months = Math.round((abs % 365.25) / 30.44);
  return months > 0 ? `${years}y ${months}mo` : `${years}y`;
}

// ---- Validity rollup ----

export interface ValidityResult {
  established: boolean;
  reasons: string[]; // combined human-readable list (all reasons)
  cgmReasons: string[]; // CGM-block-specific only
  ipReasons: string[]; // IP-block-specific only
  generalReasons: string[]; // shared (diagnosis, MR received, last visit, expiry)
  sections: {
    cgm: { shown: boolean; valid: boolean };
    ip: { shown: boolean; valid: boolean };
    diagnosis: { valid: boolean };
    mr: { valid: boolean }; // mr received + last visit set + not expired
  };
}

/** Compute MR Expiry Date (Last Visit + 6 months) and whether it's still valid (after today). */
export function getMrExpiry(lastVisit?: string): { expiry: Date | null; expired: boolean } {
  if (!lastVisit) return { expiry: null, expired: false };
  const d = new Date(lastVisit);
  if (Number.isNaN(d.getTime())) return { expiry: null, expired: false };
  const expiry = new Date(d);
  expiry.setMonth(expiry.getMonth() + 6);
  return { expiry, expired: expiry.getTime() <= Date.now() };
}

export function deriveValidity(
  state: EvalState,
  patient: Patient,
  showCgm: boolean,
  showIp: boolean,
): ValidityResult {
  const cgmReasons: string[] = [];
  const ipReasons: string[] = [];
  const generalReasons: string[] = [];

  // ---- CGM section ----
  let cgmValid = true;
  if (showCgm) {
    if (state.cgmScriptValid !== "Valid") {
      cgmValid = false;
      // "Missing" stays its own bucket; everything else (Invalid + unset) → invalid.
      if (state.cgmScriptValid === "Missing") cgmReasons.push("CGM Script missing");
      else cgmReasons.push("CGM Script invalid");
    }
    if (!state.cgmCoveragePath || state.cgmCoveragePath === "Missing") {
      cgmValid = false;
      cgmReasons.push("CGM Coverage Path missing");
    } else if (state.cgmCoveragePath === "Hypo Invalid") {
      cgmValid = false;
      cgmReasons.push("CGM Coverage Path invalid");
    }
  }

  // ---- IP section ----
  let ipValid = true;
  if (showIp) {
    if (!state.ipCoveragePath) {
      ipValid = false;
      ipReasons.push("Insulin Pump Coverage Path missing");
    } else {
      const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
      if (state.ipScriptValid !== "Valid") {
        ipValid = false;
        if (state.ipScriptValid === "Missing") ipReasons.push("Insulin Pump Script missing");
        else ipReasons.push("Insulin Pump Script invalid");
      }
      if (cfg.showEducation && state.diabetesEducation !== "Yes") {
        ipValid = false;
        ipReasons.push("Diabetes Education invalid");
      }
      if (cfg.show3Injections && state.threeInjections !== "Yes") {
        ipValid = false;
        ipReasons.push("3+ Injections invalid");
      }
      if (cfg.showCgmUse && state.cgmUse !== "Yes") {
        ipValid = false;
        ipReasons.push("CGM Use invalid");
      }
      if (cfg.showBsIssues && state.bloodSugarIssues !== "Yes") {
        ipValid = false;
        ipReasons.push("Blood Sugar Issues invalid");
      }
      if (cfg.showLmn) {
        if (state.lmn === "No" || state.lmn === undefined) {
          ipValid = false;
          ipReasons.push("Letter of MN missing");
        } else if (state.lmn === "Yes, but Invalid") {
          ipValid = false;
          ipReasons.push("Letter of MN invalid");
        }
      }
      if (cfg.showOow) {
        const oow = isOowDateValid(state.oowDate, patient.primaryInsurance);
        if (!oow) {
          ipValid = false;
          ipReasons.push("OOW Date missing");
        } else if (!oow.valid) {
          ipValid = false;
          ipReasons.push("Pump still under warranty");
        } else if (cfg.showOowOnScript && state.oowDateOnScript !== "Yes") {
          // Date is known and old enough — but not yet on the script.
          ipValid = false;
          ipReasons.push("OOW Date not on script");
        }
      }
      if (cfg.showMalfunction && state.malfunction !== "Yes") {
        ipValid = false;
        ipReasons.push("Malfunction missing");
      }
    }
  }

  // ---- Diagnosis ----
  const diagnosisValid = !!state.diagnosis && state.diagnosis !== "Evaluate";
  if (!diagnosisValid) generalReasons.push("Diagnosis missing");

  // ---- MR Received + Last Visit + Expiry ----
  const mrReceived = state.mrReceived === "Yes";
  const lastVisitSet = !!state.lastVisitDate;
  const { expired } = getMrExpiry(state.lastVisitDate);
  const mrValid = mrReceived && lastVisitSet && !expired;
  if (!mrReceived) generalReasons.push("MR Missing");
  if (mrReceived && !lastVisitSet) generalReasons.push("Last Visit Date missing");
  if (mrReceived && lastVisitSet && expired) generalReasons.push("MR Expired (>6 months)");

  const established = cgmValid && ipValid && diagnosisValid && mrValid;

  return {
    established,
    reasons: [...cgmReasons, ...ipReasons, ...generalReasons],
    cgmReasons,
    ipReasons,
    generalReasons,
    sections: {
      cgm: { shown: showCgm, valid: cgmValid },
      ip: { shown: showIp, valid: ipValid },
      diagnosis: { valid: diagnosisValid },
      mr: { valid: mrValid },
    },
  };
}

// ---- Doctor-facing ask list ----
//
// One entry per missing item. No bundled "Updated MR — must include …" or
// "Updated IP Script — must include …" rows; each gap is its own line so
// the MN Request PDF / dropdown / Send Request UI can render one row each
// with its own sample language.
//
// Things the helper deliberately does NOT surface (agent classification,
// not something the doctor can act on):
//   - "Diagnosis missing"
//   - "IP Coverage Path missing" / unset
//   - "Last Visit Date empty" while MR Received = Yes (the agent should
//     fill this in from the records)
//
// Note: CGM Coverage Path "Hypo Invalid", "Missing", or unset all surface
// the same "Hypoglycemia language" ask — the records don't have either
// insulin or hypo language and the doctor needs to add one. Only Insulin
// and Hypo paths are considered satisfied.

export function computeDoctorAskList(
  state: EvalState,
  patient: Patient,
  showCgm: boolean,
  showIp: boolean,
): string[] {
  const asks: string[] = [];

  // ---- Medical Records (whole document) ----
  // When MR is missing or expired, suppress the granular gap rows below —
  // a fresh MR resolves them and listing them would clutter the request.
  const mrReceived = state.mrReceived === "Yes";
  const { expired } = getMrExpiry(state.lastVisitDate);

  if (!mrReceived) {
    asks.push("Medical Records");
  } else if (expired) {
    asks.push("Updated Medical Records");
  } else {
    // MR is on file and current — surface specific record-level gaps as
    // their own rows.

    // CGM coverage path:
    //   - Insulin or Hypo → records have the right language → no ask
    //   - Hypo Invalid, Missing, or unset → ask for hypoglycemia language
    if (
      showCgm &&
      state.cgmCoveragePath !== "Insulin" &&
      state.cgmCoveragePath !== "Hypo"
    ) {
      asks.push("Hypoglycemia language");
    }

    // IP-path-driven record requirements
    if (showIp && state.ipCoveragePath) {
      const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
      if (cfg.showEducation && state.diabetesEducation !== "Yes") {
        asks.push("Diabetes education completed");
      }
      if (cfg.show3Injections && state.threeInjections !== "Yes") {
        asks.push("3+ insulin injections / day for > 6 months");
      }
      if (cfg.showCgmUse && state.cgmUse !== "Yes") {
        asks.push("Current CGM use");
      }
      if (cfg.showBsIssues && state.bloodSugarIssues !== "Yes") {
        asks.push("Difficulty managing blood sugar despite treatment");
      }
    }
  }

  // ---- CGM Script ----
  // No "Updated CGM Script" variant — script is either there or it isn't,
  // and an invalid script just means we need a fresh one.
  if (showCgm && (state.cgmScriptValid === "Missing" || state.cgmScriptValid === "Invalid")) {
    asks.push("CGM Script");
  }

  // ---- Insulin Pump Script ----
  if (showIp && state.ipCoveragePath) {
    if (state.ipScriptValid === "Missing") {
      // Path-aware base ask — bake in OOW requirements so the doctor
      // doesn't send back a script we'd just have to ask to update.
      let title = "Insulin Pump Script";
      if (state.ipCoveragePath === "OOW Pump") {
        title = "Insulin Pump Script (must include OOW date and malfunction note)";
      }
      asks.push(title);
    } else if (state.ipScriptValid === "Invalid") {
      asks.push("Updated Insulin Pump Script");
    }
    // If script is Valid, OOW / malfunction gaps are surfaced as their
    // own rows below — no bundled "Updated IP Script — must include …".
  }

  // ---- OOW Date (only when path = OOW Pump and IP Script exists) ----
  // We only surface OOW asks when the IP script is on file (Valid). When
  // the script is missing/invalid, the IP Script ask above already covers
  // OOW for OOW Pump path via the "must include" sub-clause.
  if (showIp && state.ipCoveragePath) {
    const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
    if (cfg.showOow && state.ipScriptValid === "Valid") {
      const oow = isOowDateValid(state.oowDate, patient.primaryInsurance);
      if (!oow) {
        asks.push("OOW date");
      } else if (!oow.valid) {
        asks.push("OOW date — pump still under warranty");
      } else if (cfg.showOowOnScript && state.oowDateOnScript !== "Yes") {
        // Date is known and old enough — just not yet on the script.
        asks.push(`Add OOW date of ${formatOowDate(state.oowDate)} to the script`);
      }
    }
    if (cfg.showMalfunction && state.malfunction !== "Yes" && state.ipScriptValid === "Valid") {
      // Phrasing differs by path so the consolidated list lines up with the
      // PDF row templates (Omnipod Switch has its own "Omnipod insufficient"
      // row instead of the generic "Non-repairable malfunction reason").
      asks.push(
        state.ipCoveragePath === "Omnipod Switch"
          ? "Omnipod insufficient"
          : "Non-repairable malfunction reason",
      );
    }
  }

  // ---- Letter of Medical Necessity ----
  if (showIp && state.ipCoveragePath) {
    const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
    if (cfg.showLmn) {
      if (state.lmn === "No" || state.lmn === undefined) {
        asks.push("Letter of Medical Necessity");
      } else if (state.lmn === "Yes, but Invalid") {
        asks.push("Updated Letter of Medical Necessity");
      }
    }
  }

  return asks;
}

/** Format an ISO date (YYYY-MM-DD) as MM/DD/YYYY for the doctor-facing
 *  ask string. Returns the input unchanged if it doesn't parse. */
function formatOowDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

// ---- Preview payload (what would be written to Monday) ----

export interface MondayPreview {
  ipCoveragePath?: string;
  cgmCoveragePath?: string;
  diagnosis?: string;
  mrsClinicals: "MR Received" | "Collect";
  lastVisitDate?: string;
  mrExpiryDate?: string;
  medicalNecessity: "Established" | "Not Established";
  generalMnInvalidReasons: string[];
  cgmMnInvalidReasons: string[];
  ipMnInvalidReasons: string[];
  /** Consolidated, doctor-facing ask list — what the agent reads on the call.
   *  Drives the MN Request Consolidated dropdown column on Monday and the
   *  MN Request Letter PDF body. */
  mnRequestConsolidated: string[];
  generateCgmScript?: string;
  generateIpScript?: string;
}

export function buildMondayPreview(
  state: EvalState,
  validity: ValidityResult,
  patient: Patient,
): MondayPreview {
  const { expiry } = getMrExpiry(state.lastVisitDate);
  const consolidated = computeDoctorAskList(
    state,
    patient,
    validity.sections.cgm.shown,
    validity.sections.ip.shown,
  );
  return {
    // When a patient isn't being served that product, the preview reflects
    // what'll be written to Monday: "Not Serving".
    ipCoveragePath: validity.sections.ip.shown
      ? state.ipCoveragePath
      : "Not Serving",
    cgmCoveragePath: validity.sections.cgm.shown
      ? state.cgmCoveragePath
      : "Not Serving",
    diagnosis: state.diagnosis,
    mrsClinicals: state.mrReceived === "Yes" ? "MR Received" : "Collect",
    lastVisitDate: state.lastVisitDate,
    mrExpiryDate: expiry ? expiry.toISOString().slice(0, 10) : undefined,
    medicalNecessity: validity.established ? "Established" : "Not Established",
    generalMnInvalidReasons: validity.generalReasons,
    cgmMnInvalidReasons: validity.sections.cgm.shown ? validity.cgmReasons : [],
    ipMnInvalidReasons: validity.sections.ip.shown ? validity.ipReasons : [],
    mnRequestConsolidated: consolidated,
    generateCgmScript: state.generateCgmScript,
    generateIpScript: state.generateIpScript,
  };
}
