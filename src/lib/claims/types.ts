export type PrimaryStatus =
  | "Submit Claim"
  | "Submitted"
  | "Outstanding"
  | "Late"
  | "Review"
  | "Appeals"
  | "Paid"
  | "Denied (Or Partly)"
  | "Bad Debt"
  | "Request Rejected"
  | "Future Claim"
  | "Not Started Yet";

export type ClaimStatusCategory =
  | "Paid"
  | "Denied"
  | "Pending"
  | "In Process"
  | "Requests Info"
  | "No Match"
  | "Error"
  | null;

export type Status277 =
  | "Payer Accepted"
  | "Stedi Accepted"
  | "Payer Rejected"
  | "Stedi Rejected"
  | null;

export type LineStatus = "Paid" | "PR" | "Denied" | "Partial" | "Needs Review";

export type DenialAnalysis =
  | "No Auth"
  | "Units / Frequency"
  | "Wrong Modifiers"
  | "Invalid Diagnosis Code"
  | "Wrong Payer"
  | "Documentation Required"
  | "Pump / Monitor Not on File"
  | "Inpatient / SNF / Hospice"
  | "Inactive Coverage"
  | "Timely Filing"
  | "Duplicate Claim"
  | "Other / Needs Review"
  | null;

export type DenialAction =
  | "New claim"
  | "Corrected claim"
  | "Appeal"
  | "Investigate"
  | "Submit auth"
  | "Upload docs"
  | "Contact payer"
  | "Action Complete"
  | "No Action / Write Off"
  | "Bad Debt"
  | null;

export interface ServiceLine {
  id: string;
  product: string;
  hcpcs: string;
  modifiers: string[];
  units: number;
  charge: number;
  estPay: number;
  primaryPaid: number;
  allowed: number;
  deductible: number;
  coinsurance: number;
  copay: number;
  patientResponsibility: number;
  carc: string[];
  rarc: string[];
  adjustmentReasons: string[];
  remarkText: string[];
  denialAnalysis: DenialAnalysis;
  // raw amounts
  coAmount: number;
  prAmount: number;
  oaAmount: number;
  piAmount: number;
}

export type ClaimsClearance = "Clear" | "Hold" | "Manager Review" | null;

export type ClaimsHoldReason =
  | "Primary unresolved"
  | "Secondary outstanding"
  | "Patient balance"
  | "Denial / appeal pending"
  | "Late / no ERA"
  | "Request rejected"
  | "Missing linkage"
  | "Other"
  | null;

export type Transfer = "Not Started" | "Ready for Secondary" | "Done" | null;

export interface ActivityEntry {
  ts: string;
  actor: string;
  message: string;
}

export interface Claim {
  id: string;
  mondayItemId: string;
  patientName: string;
  dob: string; // ISO
  dos: string; // ISO
  primaryPayor: string;
  insuranceType: string;
  memberId: string;
  claimSentDate: string | null;
  /** "Claim Resent Date" (date_mm29scz). Stamped today when a denial is
   *  resolved back to Outstanding. Used as the effective last-action
   *  date for Late ERA aging. Null until the claim is resubmitted. */
  claimResentDate?: string | null;
  primaryStatus: PrimaryStatus;
  status277: Status277;
  rejected277Reason?: string | null;
  claimStatusCategory: ClaimStatusCategory;
  claimStatusDetail?: string | null;
  lastClaimStatusCheck?: string | null;
  /** "277 Paid Amount" column from the backend's last status check writeback. */
  claimStatusPaidAmount?: number | null;
  claimId: string;
  payerClaimNumber?: string | null;
  estPay: number;
  primaryPaid: number;
  prAmount: number;
  rawEraDate: string | null;
  rawEraClaimStatus?: string | null;
  primaryPaidDate?: string | null;
  secondaryPayer?: string | null;
  denialAction: DenialAction;
  actionContext?: string;
  nextActionDate?: string | null;
  notes?: string;
  transfer?: Transfer;
  subscriptionClearance?: ClaimsClearance;
  claimsHoldReason?: ClaimsHoldReason;
  sourceSubscriptionItemId?: string | null;
  sourceOrderItemId?: string | null;
  activity?: ActivityEntry[];
  lines: ServiceLine[];
}

export type SuggestedOutcome =
  | "Likely Paid / Resolved"
  | "Likely Partial Denial"
  | "Status Check Needed"
  | "Waiting"
  | "Needs Investigation"
  | "No ERA Yet";
