/**
 * medicalRecordsMock.ts
 *
 * Bridges the Subscription Board's SubscriptionPatient model into the
 * masheke `Patient` model that the command-center MR panels expect.
 * Real wiring (per-stage queries against Monday) will replace this
 * later; for now it's enough to render the panel UI with plausible
 * fields per patient.
 */

import type { Patient } from "@/lib/masheke/workflow";
import type { SubscriptionPatient } from "./mockData";

export type MashekePatientRow = SubscriptionPatient & {
  channel: "fax" | "parachute";
  attempts: number;
  doctorName: string;
  doctorFax?: string;
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

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Convert a SubscriptionPatient row into a masheke Patient object with
 * sensible mock defaults filled in for the fields the MR panels read.
 */
export function mockMashekePatient(row: MashekePatientRow): Patient {
  const h = hash(row.id);
  const clinic = CLINICS[h % CLINICS.length];
  const npi = String(1000000000 + (h % 999999999)).slice(0, 10);
  const memberId1 = `74${(10000000 + (h % 90000000))}`;
  const memberId2 = `FP${(10000 + (h % 90000))}T`;
  const dobYear = 1955 + (h % 35);
  const dobMonth = String((h % 12) + 1).padStart(2, "0");
  const dobDay = String((h % 28) + 1).padStart(2, "0");
  const dob = `${dobYear}-${dobMonth}-${dobDay}`;

  // OOW date: ~6 months ago for Pump scripts
  const oowDate = new Date();
  oowDate.setMonth(oowDate.getMonth() - 6 - (h % 4));

  // Last sent: ~9 days ago for the requestSentAt timeline
  const lastSent = new Date();
  lastSent.setDate(lastSent.getDate() - 9);
  lastSent.setHours(9, 34, 0, 0);

  return {
    id: row.id,
    name: row.name,
    gender: h % 2 === 0 ? "Male" : "Female",
    dob,
    phone: row.phone,
    address: `${629 + (h % 800)} Chatham Street, Rome, NY 13440`,
    memberId1,
    memberId2,
    primaryInsurance: row.primaryPayer,

    referralType: "Manufacturer",
    referralSource: ["Tandem", "Medtronic", "Insulet", "Dexcom"][h % 4],
    requestType: row.subscriptionType === "Sensors" ? "CGM" : "Insulin Pump",
    serving: row.subscriptionType === "Sensors" ? "CGM" : "Insulin Pump",
    pumpType: ["t:slim", "Omnipod 5", "MiniMed 780G"][h % 3],
    cgmType: ["Dexcom G7", "FreeStyle Libre 3", "Dexcom G6"][h % 3],

    // Coverage paths
    ipCoveragePath: row.primaryPayer.includes("Medicaid") ? "Medicaid Supplies" : "Commercial Pump",
    cgmCoveragePath: row.primaryPayer.includes("Medicare") ? "Medicare Part B CGM" : "Commercial CGM",

    // Doctor
    doctorName: row.doctorName,
    doctorPhone: `(${315 + (h % 4)}) ${String(700 + (h % 200))}-${String(1000 + (h * 11) % 9000).padStart(4, "0")}`,
    doctorNpi: npi,
    clinicalsMethod: row.channel === "parachute" ? "Parachute" : "Fax",
    doctorEmail: undefined,
    doctorFax: row.doctorFax,
    clinicName: clinic,

    // Pipeline tracking
    masterStage: "Medical Necessity",
    subStage: "Send Request",
    daysSinceIntake: String(20 + (h % 60)),
    daysSinceStageStart: String(h % 14),
    dateOfIntake: undefined,
    dateOfStageStart: undefined,

    // Clinical eval checklist — partially filled to look real
    diagnosis: "E11.65 — Type 2 diabetes with hyperglycemia",
    oowDate: fmtDate(oowDate),
    malfunction: h % 5 === 0 ? "Yes" : undefined,

    // MRs / Clinicals
    mrsClinicals: row.attempts >= 2 ? "Received" : "Pending",
    lastVisit: undefined,
    mrExpiryDate: undefined,
    medicalNecessity: row.attempts >= 3 ? "Established" : "Not Established",

    // MN invalid reasons (consolidated request)
    mnRequestConsolidated: row.subscriptionType === "Sensors"
      ? "CGM Script (must include diagnosis and BG monitoring frequency)"
      : "Insulin Pump Script (must include OOW date and malfunction note)",
    requestSentAt: lastSent.toISOString(),
    notes: "",
  };
}
