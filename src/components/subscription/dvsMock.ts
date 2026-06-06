/**
 * dvsMock.ts — Medicaid DVS workflow mock.
 *
 * Brandon's 95%-case workflow: open the tab, default to "today or
 * earlier", select all, click Run DVS — most pass with Success +
 * Claim Paid; a handful land in retry/failed for triage.
 *
 * Mock distribution roughly mirrors that:
 *   - Empty / not yet triggered (default state)
 *   - Trigger DVS (queued — we wrote, bot hasn't picked up)
 *   - Running (DVS bot is on it)
 *   - Success + Claim Paid (most rows after a run)
 *   - DVS Failed (rare — needs triage)
 *   - Claim Denied (DVS succeeded but secondary claim rejected)
 */

import {
  ORDER_PREP_PATIENTS, type SubscriptionPatient,
} from "./mockData";

export type DvsStatus =
  | ""
  | "Trigger DVS"
  | "Running"
  | "Success"
  | "Failed";

export type ClaimStatus =
  | ""
  | "Claim Pending"
  | "Claim Paid"
  | "Claim Denied"
  | "Claim Partial";

export type DvsPatient = SubscriptionPatient & {
  // Main-table fields
  dvsStatus: DvsStatus;
  claimStatus: ClaimStatus;
  claimPaidAmount: string;   // text column on Monday
  claimPaidDate: string;     // YYYY-MM-DD

  // Drop-down (extra) fields
  firstDeniedDate: string;
  retryCount: number;
  lastAttempted: string;
  retryNextDate: string;
  denialReason: string;
  a4232Claim: string;
  a4230Claim: string;
  claimsError: string;
  claimsDenialReason: string;
};

function hash(s: string): number {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function offsetDate(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Decorate a SubscriptionPatient with DVS state, deterministic per id. */
function decorate(p: SubscriptionPatient): DvsPatient {
  const h = hash(p.id);
  // Use the hash mod 100 to control distribution
  const bucket = h % 100;

  let dvsStatus: DvsStatus = "";
  let claimStatus: ClaimStatus = "";
  let claimPaidAmount = "";
  let claimPaidDate = "";
  let firstDeniedDate = "";
  let retryCount = 0;
  let lastAttempted = "";
  let retryNextDate = "";
  let denialReason = "";
  let claimsError = "";
  let claimsDenialReason = "";

  if (bucket < 60) {
    // 60% — never triggered yet (the "ready to run today" cohort)
    dvsStatus = "";
    claimStatus = "";
  } else if (bucket < 75) {
    // 15% — recent Success + Claim Paid
    dvsStatus = "Success";
    claimStatus = "Claim Paid";
    const amt = 80 + (h % 600);
    claimPaidAmount = `$${amt.toFixed(2)}`;
    claimPaidDate = offsetDate(-((h % 14) + 1));
  } else if (bucket < 82) {
    // 7% — in flight (we just clicked Run DVS earlier today)
    dvsStatus = "Trigger DVS";
    claimStatus = "";
    lastAttempted = offsetDate(0);
  } else if (bucket < 87) {
    // 5% — DVS bot is currently running
    dvsStatus = "Running";
    claimStatus = "";
    lastAttempted = offsetDate(0);
  } else if (bucket < 94) {
    // 7% — DVS failed, in retry queue
    dvsStatus = "Failed";
    claimStatus = "";
    retryCount = (h % 3) + 1;
    firstDeniedDate = offsetDate(-((h % 21) + 1));
    lastAttempted = offsetDate(-((h % 3) + 1));
    retryNextDate = offsetDate(((h % 3) + 1));
    denialReason = ["ePACES timeout", "Member ID not found", "Invalid product code"][h % 3];
    claimsError = "DVS bot stuck on ePACES login (Playwright timeout)";
  } else {
    // 6% — DVS succeeded but secondary claim denied
    dvsStatus = "Success";
    claimStatus = "Claim Denied";
    firstDeniedDate = offsetDate(-((h % 10) + 1));
    retryCount = (h % 2) + 1;
    denialReason = "Service not covered for DOS";
    claimsDenialReason = "Recipient ineligible on date of service";
  }

  return {
    ...p,
    dvsStatus,
    claimStatus,
    claimPaidAmount,
    claimPaidDate,
    firstDeniedDate,
    retryCount,
    lastAttempted,
    retryNextDate,
    denialReason,
    a4232Claim: claimStatus === "Claim Paid" ? `CL${(h % 90000) + 10000}` : "",
    a4230Claim: claimStatus === "Claim Paid" ? `CL${(h % 80000) + 20000}` : "",
    claimsError,
    claimsDenialReason,
  };
}

/**
 * The Medicaid Supplies cohort eligible for DVS.
 * Filter: primary payer matches "Medicaid" AND subscription type
 * includes Supplies (Sensors-only patients aren't DVS-eligible).
 *
 * Re-uses the existing ORDER_PREP_PATIENTS mock so the patient names
 * and Monday IDs match across the rest of the UI.
 */
export function getDvsPatients(): DvsPatient[] {
  return ORDER_PREP_PATIENTS
    .filter((p) => p.primaryPayer.toLowerCase().includes("medicaid"))
    .filter((p) => p.subscriptionType !== "Sensors")
    .map(decorate);
}
