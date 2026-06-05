/**
 * authorizationsMock.ts
 *
 * Bridges Subscription Board patients into the samantha `Patient` model
 * that the command-center Auth panels expect (InsurancePanel,
 * AuthorizationsPanel, AuthOutstandingPanel).
 */

import { EMPTY_INSURANCE, type Patient } from "@/lib/samantha/workflow";
import type { SubscriptionPatient } from "./mockData";

export type SamanthaPatientRow = SubscriptionPatient & {
  doctorName: string;
  doctorClinic: string;
};

const CLINICS = [
  "SUNY Upstate Joslin Diabetes Center",
  "Mount Sinai Endocrinology",
  "NYU Langone Diabetes Care",
  "Northwell Health Diabetes Institute",
  "Joslin Diabetes Center Boston",
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Map Subscription type → samantha product label */
function productOf(t: SubscriptionPatient["subscriptionType"]): Patient["product"] {
  if (t === "Sensors") return "CGM";
  if (t === "Supplies") return "Supplies";
  return "CGM + Pump";
}

/** Decorate a Subscription row with a doctor + clinic for the auth UI */
export function decorateSamanthaRow(p: SubscriptionPatient, idx: number): SamanthaPatientRow {
  const doctors = ["Dr. Jason Sloane", "Dr. Rachel Goldstein", "Dr. Maria Hernandez", "Dr. Sam Patel", "Dr. Andrew Wu"];
  return {
    ...p,
    doctorName: doctors[idx % doctors.length],
    doctorClinic: CLINICS[idx % CLINICS.length],
  };
}

/**
 * Convert a SubscriptionPatient row → samantha Patient with sensible
 * mock defaults for the Auth panels. Empty insurance + product code state
 * so the operator UI starts from a fresh "needs verification" position.
 */
export function mockSamanthaPatient(row: SamanthaPatientRow, stage: "benefits" | "submit" | "outstanding" | "dvs"): Patient {
  const h = hash(row.id);
  const dobYear = 1955 + (h % 35);
  const dobMonth = String((h % 12) + 1).padStart(2, "0");
  const dobDay = String((h % 28) + 1).padStart(2, "0");
  const dob = `${dobYear}-${dobMonth}-${dobDay}`;

  const stageId: Patient["stage"] =
    stage === "benefits"    ? "advanced" :
    stage === "submit"      ? "advanced" :
    stage === "outstanding" ? "advanced" :
                              "advanced";

  return {
    id: row.id,
    name: row.name,
    dob,
    product: productOf(row.subscriptionType),
    payer: row.primaryPayer,
    doctorName: row.doctorName,
    doctorClinic: row.doctorClinic,
    contactMethod: "fax",
    stage: stageId,
    pillars: {},
    pathwayChecks: {},
    chaseStep: 0,
    faxPhase: 1,
    notes: "",
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * (h % 14 + 1)).toISOString(),
    lastUpdated: new Date().toISOString(),
    owner: "Samantha",
    insurance: EMPTY_INSURANCE,
    hasMedicaid: row.primaryPayer.toLowerCase().includes("medicaid"),
    serving: row.subscriptionType === "Sensors" ? "CGM" : "Insulin Pump",
    primaryInsurance: row.primaryPayer as Patient["primaryInsurance"],
    diagnosis: "E11.65 — Type 2 diabetes with hyperglycemia",
    memberId1: `74${(10000000 + (h % 90000000))}`,
    memberId2: `FP${(10000 + (h % 90000))}T`,
    patientPhone: row.phone,
    patientAddress: `${629 + (h % 800)} Chatham Street, Rome, NY 13440`,
    pumpBrand: ["Tandem t:slim", "Omnipod 5", "Medtronic 780G"][h % 3],
    dvsStatus: stage === "dvs" ? "Trigger DVS" : undefined,
    triggerDvs: stage === "dvs",
  };
}
