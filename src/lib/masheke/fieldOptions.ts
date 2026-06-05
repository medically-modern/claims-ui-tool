// All status field options matching Monday board labels + indices.
// Used by UI dropdowns and mondayWrite for reverse lookup.

import type { StatusOption } from "@/components/masheke/StatusSelect";

// Most eval checklist items: Evaluate, Not Serving, Collect, Valid
export const STANDARD_EVAL: StatusOption[] = [
  { label: "Evaluate", index: 0 },
  { label: "Not Serving", index: 1 },
  { label: "Collect", index: 2 },
  { label: "Valid", index: 3 },
];

// Blood Sugar Issues has different index order
export const BLOOD_SUGAR_OPTS: StatusOption[] = [
  { label: "Evaluate", index: 0 },
  { label: "Valid", index: 1 },
  { label: "Not Serving", index: 2 },
  { label: "Collect", index: 3 },
];

// Hypo Language / Insulin Language
export const LANGUAGE_OPTS: StatusOption[] = [
  { label: "Evaluate", index: 0 },
  { label: "Valid", index: 1 },
  { label: "Collect", index: 2 },
  { label: "Not Needed", index: 3 },
];

// Diagnosis codes
export const DIAGNOSIS_OPTS: StatusOption[] = [
  { label: "Evaluate", index: 107 },
  { label: "Collect", index: 108 },
  { label: "E08.43", index: 0 },
  { label: "E10.10", index: 1 },
  { label: "E10.22", index: 2 },
  { label: "E10.29", index: 3 },
  { label: "E10.311", index: 152 },
  { label: "E10.3393", index: 109 },
  { label: "E10.3559", index: 4 },
  { label: "E10.42", index: 6 },
  { label: "E10.649", index: 7 },
  { label: "E10.65", index: 8 },
  { label: "E10.69", index: 9 },
  { label: "E10.8", index: 10 },
  { label: "E10.9", index: 11 },
  { label: "E11.21", index: 12 },
  { label: "E11.22", index: 13 },
  { label: "E11.29", index: 154 },
  { label: "E11.3292", index: 14 },
  { label: "E11.40", index: 15 },
  { label: "E11.42", index: 16 },
  { label: "E11.45", index: 17 },
  { label: "E11.59", index: 18 },
  { label: "E11.64", index: 151 },
  { label: "E11.649", index: 153 },
  { label: "E11.65", index: 19 },
  { label: "E11.69", index: 101 },
  { label: "E11.8", index: 102 },
  { label: "E11.9", index: 103 },
  { label: "E13.65", index: 104 },
  { label: "E13.9", index: 105 },
  { label: "E024.414", index: 110 },
  { label: "O24.111", index: 106 },
];

// MRs / Clinicals
export const MR_OPTS: StatusOption[] = [
  { label: "Evaluate", index: 0 },
  { label: "MR Received", index: 1 },
  { label: "Collect", index: 3 },
];

// Medical Necessity
export const MED_NEC_OPTS: StatusOption[] = [
  { label: "Not Established", index: 0 },
  { label: "Established", index: 1 },
];

// Generate Script
export const GEN_SCRIPT_OPTS: StatusOption[] = [
  { label: "Ready", index: 0 },
  { label: "Generate", index: 1 },
  { label: "Not Needed", index: 2 },
];

// Clinicals Method
export const CLINICALS_METHOD_OPTS: StatusOption[] = [
  { label: "Fax", index: 0 },
  { label: "Parachute", index: 1 },
  { label: "Email", index: 2 },
];

// MN Attempts
export const MN_ATTEMPTS_OPTS: StatusOption[] = [
  { label: "Attempt 1", index: 2 },
  { label: "Attempt 2", index: 3 },
  { label: "Attempt 3", index: 1 },
  { label: "Escalate", index: 0 },
];

// Helper: look up index by label
export function labelToIndex(options: StatusOption[], label: string): number | undefined {
  return options.find((o) => o.label === label)?.index;
}

// =====================================================================
// New simplified Evaluate-tab options (UI-only — never written to Monday)
// =====================================================================

export const VALID_INVALID_OPTS: StatusOption[] = [
  { label: "Valid", index: 0 },
  { label: "Invalid", index: 1 },
  { label: "Missing", index: 2 },
];

export const YES_NO_OPTS: StatusOption[] = [
  { label: "Yes", index: 0 },
  { label: "No", index: 1 },
];

export const CGM_COVERAGE_OPTS: StatusOption[] = [
  { label: "Insulin", index: 0 },
  { label: "Hypo", index: 1 },
  { label: "Hypo Invalid", index: 3 },
  { label: "Missing", index: 7 },
];

export const LMN_OPTS: StatusOption[] = [
  { label: "Yes & Valid", index: 0 },
  { label: "Yes, but Invalid", index: 1 },
  { label: "No", index: 2 },
];

// Labels match Monday's "Insulin Pump Coverage Path" status column exactly.
export const IP_PATH_OPTS: StatusOption[] = [
  { label: "Supplies Only", index: 0 },
  { label: "1st Pump >6M Diagnosed", index: 1 },
  { label: "1st Pump <6M Diagnosed", index: 2 },
  { label: "OOW Pump", index: 3 },
  { label: "Omnipod Switch", index: 4 },
  { label: "IW New Insurance", index: 5 },
];

// Most-used ICD-10 codes — pinned to the top of the diagnosis combobox
export const DIAGNOSIS_FAVORITES: string[] = ["E10.65", "E10.9", "E11.65", "E11.9"];

// All other ICD-10 codes, alphabetical (matches numerical order for these codes)
export const DIAGNOSIS_OTHER: string[] = DIAGNOSIS_OPTS
  .filter((o) => o.label !== "Evaluate" && o.label !== "Collect")
  .map((o) => o.label)
  .filter((code) => !DIAGNOSIS_FAVORITES.includes(code))
  .sort();

// Full diagnosis list (favorites first, then the rest)
export const DIAGNOSIS_LIST: string[] = [...DIAGNOSIS_FAVORITES, ...DIAGNOSIS_OTHER];
