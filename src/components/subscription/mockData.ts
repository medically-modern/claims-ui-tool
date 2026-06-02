// Mock data for the Subscription Board tab — covers every operationally important
// checkpoint state from the workflow doc so the UI exercises real edge cases:
// Not Sent / Awaiting / Review Changes / Delayed / No Response / Confirmed for
// Confirmation; Not Run / Stale / Inactive / New Insurance / Active for Benefits;
// Not Checked / Missing / Expired / Expiring / Mismatch / DVS / Not Required /
// Valid for Auth; First Order / Pri Pending / Pri Unpaid / Sec Pending / Sec
// Unpaid / Paid for Last Order. Real values will come from Monday once wired up.

export type CheckpointTone = "ok" | "warn" | "bad" | "pending";

/** Soft constraints can be overridden by the operator; hard cannot. */
export type CheckpointGate = "hard" | "soft";

export type CheckpointKind = "confirmation" | "benefits" | "auth" | "lastPaid";

export type Checkpoint = {
  tone: CheckpointTone;
  label: string;
  detail?: string;
  /** Set on red cells where operator already invoked the override flow. */
  overrideReason?: string;
};

export type SubscriptionType = "Sensors" | "Supplies" | "Sensors & Supplies";

export type SubscriptionPatient = {
  id: string;
  mondayItemId: string;
  name: string;
  phone: string;
  primaryPayer: string;
  /** YYYY-MM-DD */
  nextOrderDate: string;
  subscriptionType: SubscriptionType;
  /** Subscription Board Run Check column state. */
  runCheck: "Pass" | "Failed" | "Run" | "Batch" | "—";
  confirmation: Checkpoint;
  benefits: Checkpoint;
  auth: Checkpoint;
  lastPaid: Checkpoint;
};

export const CHECKPOINT_GATE: Record<CheckpointKind, CheckpointGate> = {
  confirmation: "soft",
  benefits:     "hard",
  auth:         "hard",
  lastPaid:     "soft",
};

const PATIENTS_RAW: Array<Omit<SubscriptionPatient, "id" | "mondayItemId" | "phone">> = [
  // Confirmation cohort — covers Not Sent, Awaiting, Review Changes, No Response, Confirmed, Delayed
  { name: "Sharon Nelson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-18", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 4d ago" },
    benefits: { tone: "ok", label: "Active", detail: "$0 ded" },
    auth: { tone: "ok", label: "DVS at order", detail: "Medicaid supplies" },
    lastPaid: { tone: "warn", label: "Pri pending", detail: "Sec N/A" } },
  { name: "Andrew Moore", primaryPayer: "Tricare", nextOrderDate: "2026-06-18", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 4d ago" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "Sensors+Supplies, ends Aug 14" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Patricia Lewis", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-18", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed", detail: "no changes" },
    benefits: { tone: "ok", label: "Active", detail: "$1,250 ded" },
    auth: { tone: "ok", label: "Valid", detail: "ends Jul 30" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Robert Perez", primaryPayer: "Cigna", nextOrderDate: "2026-06-18", subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "warn", label: "Review changes", detail: "new pump type" },
    benefits: { tone: "ok", label: "Active", detail: "$840 ded" },
    auth: { tone: "warn", label: "Mismatch", detail: "product changed" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Maxine Devitt", primaryPayer: "Fidelis Commercial", nextOrderDate: "2026-06-21", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "warn", label: "Review changes", detail: "address updated" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "Sensors+Supplies, ends Sep 02" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "George Brown", primaryPayer: "Humana", nextOrderDate: "2026-06-18", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "bad", label: "No response", detail: "high-risk", overrideReason: "operator called patient; confirmed verbally 6/2" },
    benefits: { tone: "ok", label: "Active", detail: "$2,000 ded" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Sandra Baker", primaryPayer: "Aetna", nextOrderDate: "2026-06-23", subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "warn", label: "No response", detail: "low-risk proceed?" },
    benefits: { tone: "ok", label: "Active", detail: "$300 ded" },
    auth: { tone: "ok", label: "Valid", detail: "ends Aug 02" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Linda Park", primaryPayer: "Humana", nextOrderDate: "2026-06-25", subscriptionType: "Supplies", runCheck: "—",
    confirmation: { tone: "pending", label: "Not sent", detail: "scheduled D-20" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Diego Ortiz", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-07-05", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "warn", label: "Delayed", detail: "→ Jul 5 (was Jun 18)" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  // Benefits cohort — Not Run / Stale / Inactive / New Insurance
  { name: "Ruth Wilson", primaryPayer: "Tricare", nextOrderDate: "2026-06-07", subscriptionType: "Sensors & Supplies", runCheck: "Failed",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "bad", label: "Inactive", detail: "coverage ended 5/31" },
    auth: { tone: "bad", label: "Mismatch", detail: "old payer" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Kevin Garcia", primaryPayer: "UnitedHealthcare", nextOrderDate: "2026-06-04", subscriptionType: "Sensors", runCheck: "—",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "pending", label: "Not run", detail: "no check this month" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Annette Cole", primaryPayer: "Fidelis Commercial", nextOrderDate: "2026-06-30", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "warn", label: "Stale", detail: "ran Apr 18" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Michelle Allen", primaryPayer: "Medicaid", nextOrderDate: "2026-06-06", subscriptionType: "Sensors", runCheck: "Batch",
    confirmation: { tone: "warn", label: "Review changes", detail: "new insurance" },
    benefits: { tone: "warn", label: "New insurance", detail: "Aetna → Cigna" },
    auth: { tone: "warn", label: "Re-eval", detail: "new payer" },
    lastPaid: { tone: "ok", label: "Paid" } },
  // Auth cohort — Not Checked / Missing / Expired / Expiring / Mismatch / DVS / Not Required / Valid
  { name: "Betty Johnson", primaryPayer: "Tricare", nextOrderDate: "2026-06-08", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "bad", label: "Expired", detail: "ended May 12" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Daniel Wilson", primaryPayer: "Aetna", nextOrderDate: "2026-06-05", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "warn", label: "Renew 7d", detail: "Sensors" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Henry Park", primaryPayer: "Cigna", nextOrderDate: "2026-06-12", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "bad", label: "Missing", detail: "Supplies required, absent" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Wyllow Vance", primaryPayer: "Medicaid", nextOrderDate: "2026-06-15", subscriptionType: "Supplies", runCheck: "—",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "DVS at order", detail: "Medicaid supplies" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Heidi Pratt", primaryPayer: "Humana", nextOrderDate: "2026-06-19", subscriptionType: "Sensors", runCheck: "—",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "pending", label: "Not checked", detail: "operator review" },
    lastPaid: { tone: "ok", label: "Paid" } },
  // Last paid cohort — First Order / Pri Pending / Pri Unpaid / Sec Pending / Sec Unpaid
  { name: "Jennifer Young", primaryPayer: "Medicaid", nextOrderDate: "2026-06-07", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" },
    lastPaid: { tone: "warn", label: "Pri pending", detail: "12d in review" } },
  { name: "Ruth Walker", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-09", subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "bad", label: "Pri unpaid", detail: "denied CO-22" } },
  { name: "Camila Velez", primaryPayer: "Aetna", nextOrderDate: "2026-06-14", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "First order" } },
  { name: "Otis Whitman", primaryPayer: "Fidelis Commercial", nextOrderDate: "2026-06-16", subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "warn", label: "Sec pending", detail: "submitted 8d ago" } },
  { name: "Brent Fielding", primaryPayer: "UnitedHealthcare", nextOrderDate: "2026-06-20", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "bad", label: "Sec unpaid", detail: "denial — needs resubmit",
      overrideReason: "Sec balance $14.30, not worth holding the next order" } },
  // Confirmed ready to roll (mostly appears on Submit tab)
  { name: "Carol Wilson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-09", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Mark Taylor", primaryPayer: "Tricare", nextOrderDate: "2026-06-11", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "Sensors+Supplies, ends Aug 18" },
    lastPaid: { tone: "ok", label: "Paid" } },
];

const SUBMIT_RAW: Array<Omit<SubscriptionPatient, "id" | "mondayItemId" | "phone">> = [
  { name: "Andrew Moore", primaryPayer: "Tricare", nextOrderDate: "2026-06-18", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" }, lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Patricia Lewis", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-18", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" }, lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Carol Wilson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-09", subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" }, lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Mark Taylor", primaryPayer: "Tricare", nextOrderDate: "2026-06-11", subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" }, lastPaid: { tone: "ok", label: "Paid" } },
];

function withIds(
  rows: Array<Omit<SubscriptionPatient, "id" | "mondayItemId" | "phone">>,
  startMondayId = 1_180_000_000,
): SubscriptionPatient[] {
  return rows.map((row, i) => ({
    ...row,
    id: `sub-${i + 1}`,
    mondayItemId: String(startMondayId + i * 137),
    phone: `(347) 555-${(100 + i).toString().padStart(4, "0")}`,
  }));
}

export const ORDER_PREP_PATIENTS = withIds(PATIENTS_RAW);
export const SUBMIT_ORDER_PATIENTS = withIds(SUBMIT_RAW, 1_190_000_000);

export const PAYER_OPTIONS = [
  "All payers", "Anthem BCBS Commercial", "Aetna", "Cigna", "Fidelis Commercial",
  "Humana", "Medicaid", "Tricare", "UnitedHealthcare",
] as const;

export const CHECKPOINT_STATE_OPTIONS = [
  "All states", "Awaiting Response", "Review Changes", "No Response", "Delayed", "Confirmed",
  "Benefits Inactive", "Benefits Stale", "Auth Expiring", "Auth Expired", "Auth Missing",
  "DVS at order (Medicaid)", "Last Claim Unpaid",
] as const;
