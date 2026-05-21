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
  /** "PR Payor ID" column (text_mm1gcz3y) — the numeric payer
   *  identifier we sent the 837 to. Helps operators interpret Wrong
   *  Payer denials. */
  payorId?: string | null;
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
  /** Bank deposit reconciliation — populated when an 835 ERA arrives.
   *  All four come from the 835's BPR + TRN headers, written to dedicated
   *  Monday columns by populate_era_data_on_claims_item:
   *    bankDepositTotal        — numeric_mm3jm85z (whole-ERA total)
   *    bankPaymentMethod       — color_mm3jh0x2  (ACH / CHK / FWT / NON)
   *    bankPayerOriginatorId   — text_mm3jpw1b   (ORIG ID in bank entry)
   *    bankEftDate             — date_mm3je93r   (EED on ACH addenda)
   *  Surfaced as the Bank Info strip on ClaimDetail so operators can
   *  Ctrl-F the deposit in Chase / TD without going back to Stedi. */
  bankDepositTotal?: number | null;
  bankPaymentMethod?: string | null;
  bankPayerOriginatorId?: string | null;
  bankEftDate?: string | null;
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
  /** Threading. When this claim was spawned from a denied parent via the
   *  Submit Claim flow, parentClaimItemId is the Monday item id of the
   *  parent (text_mm3559h4). Null/undefined on original claims.
   *
   *  We treat a claim with any descendant (i.e. some other claim's
   *  parentClaimItemId equals this claim's mondayItemId) as "replaced" —
   *  it falls out of active buckets, but stays navigable via the thread
   *  breadcrumb. See `hasChildren` derivation in the claims query. */
  parentClaimItemId?: string | null;
  /** "Claim Type" status (color_mm2nvk1p) — Original / Corrected / Void.
   *  Original = first submission. Corrected = resubmission with payer-side
   *  replacement intent (837 emits CLM05-3 = 7 + REF*F8 with parent's ICN).
   *  New-claim resubmissions stay Original because they go out as fresh
   *  originals on the wire even though we still record the parent link. */
  claimType?: "Original" | "Corrected" | "Void" | null;
  /** True when any other claim in the current load has this item id as
   *  its parent. Derived at the query layer — not read from Monday. */
  hasChildren?: boolean;
  /** Place of Service — drives CMS-1500 Box 24B / 837 placeOfServiceCode.
   *  Status column color_mm3fk3qv with two labels:
   *    "Home"   → CMS code 12 (default; what DME shipped to the patient is)
   *    "Office" → CMS code 11 (clinical-setting visit)
   *  Null when the column is blank on Monday; the backend defaults to 12
   *  in that case so historical rows behave like before the column existed. */
  placeOfService?: "Home" | "Office" | null;
  /** Monday group id this item sits in (e.g. group_mm332zns for Medicaid
   *  Outstanding). Used by bucket filters that need to exclude or include
   *  rows based on group placement, not just Primary Status. */
  groupId?: string | null;
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
