// Mock data for the Subscription Board tab — first-pass content so the UI can
// be reviewed before backend wiring lands. Shapes mirror the PRD: one row per
// patient with four checkpoint cells (Confirmation / Benefits / Auth / Last Paid)
// plus core metadata. Real values will come from the Subscription Monday board
// once we wire it up.

export type CheckpointTone = "ok" | "warn" | "bad" | "pending";

export type Checkpoint = {
  tone: CheckpointTone;
  label: string;
  detail?: string;
};

export type SubscriptionType = "Sensors" | "Supplies" | "Sensors & Supplies";

export type SubscriptionPatient = {
  id: string;
  mondayItemId: string;
  name: string;
  phone: string;
  primaryPayer: string;
  nextOrderDate: string;
  subscriptionType: SubscriptionType;
  overrideNote?: string;
  confirmation: Checkpoint;
  benefits: Checkpoint;
  auth: Checkpoint;
  lastPaid: Checkpoint;
};

const PATIENTS_RAW: Array<Omit<SubscriptionPatient, "id" | "mondayItemId" | "phone">> = [
  { name: "Sharon Nelson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-18", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 4d ago" },
    benefits: { tone: "ok", label: "Active", detail: "$0 ded" },
    auth: { tone: "warn", label: "Renew 12d", detail: "Supplies" },
    lastPaid: { tone: "warn", label: "Pri pending", detail: "Sec N/A" } },
  { name: "Andrew Moore", primaryPayer: "Tricare", nextOrderDate: "2026-06-18", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 4d ago" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "ends Aug 14" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Patricia Lewis", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-18", subscriptionType: "Sensors",
    confirmation: { tone: "ok", label: "Confirmed", detail: "no changes" },
    benefits: { tone: "ok", label: "Active", detail: "$1,250 ded" },
    auth: { tone: "ok", label: "Valid", detail: "ends Jul 30" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Robert Perez", primaryPayer: "Cigna", nextOrderDate: "2026-06-18", subscriptionType: "Supplies",
    confirmation: { tone: "warn", label: "Review changes", detail: "new pump type" },
    benefits: { tone: "ok", label: "Active", detail: "$840 ded" },
    auth: { tone: "warn", label: "Mismatch", detail: "product changed" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Maxine Devitt", primaryPayer: "Fidelis Commercial", nextOrderDate: "2026-06-21", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "warn", label: "Review changes", detail: "address updated" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "ends Sep 02" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "George Brown", primaryPayer: "Humana", nextOrderDate: "2026-06-18", subscriptionType: "Sensors",
    confirmation: { tone: "bad", label: "No response", detail: "high-risk pause" },
    benefits: { tone: "ok", label: "Active", detail: "$2,000 ded" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Sandra Baker", primaryPayer: "Aetna", nextOrderDate: "2026-06-23", subscriptionType: "Supplies",
    confirmation: { tone: "warn", label: "No response", detail: "low-risk proceed?" },
    benefits: { tone: "ok", label: "Active", detail: "$300 ded" },
    auth: { tone: "ok", label: "Valid", detail: "ends Aug 02" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Ruth Wilson", primaryPayer: "Tricare", nextOrderDate: "2026-06-07", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "bad", label: "Inactive", detail: "coverage ended" },
    auth: { tone: "bad", label: "Mismatch", detail: "old payer" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Kevin Garcia", primaryPayer: "UnitedHealthcare", nextOrderDate: "2026-06-04", subscriptionType: "Sensors",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "bad", label: "Not run", detail: "no check this month" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Betty Johnson", primaryPayer: "Tricare", nextOrderDate: "2026-06-08", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "bad", label: "Expired", detail: "ended May 12" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Daniel Wilson", primaryPayer: "Aetna", nextOrderDate: "2026-06-05", subscriptionType: "Sensors",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "warn", label: "Renew 7d", detail: "Sensors" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Michelle Allen", primaryPayer: "Medicaid", nextOrderDate: "2026-06-06", subscriptionType: "Sensors",
    confirmation: { tone: "warn", label: "Review changes", detail: "new insurance" },
    benefits: { tone: "warn", label: "New insurance", detail: "Aetna -> Cigna" },
    auth: { tone: "warn", label: "Re-eval", detail: "new payer" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Jennifer Young", primaryPayer: "Medicaid", nextOrderDate: "2026-06-07", subscriptionType: "Sensors",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" },
    lastPaid: { tone: "warn", label: "Pri pending", detail: "12d in review" } },
  { name: "Ruth Walker", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-09", subscriptionType: "Supplies",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "bad", label: "Pri unpaid", detail: "denied CO-22" } },
  { name: "Carol Wilson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-09", subscriptionType: "Sensors",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Mark Taylor", primaryPayer: "Tricare", nextOrderDate: "2026-06-11", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "ends Aug 18" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Margaret Thompson", primaryPayer: "Tricare", nextOrderDate: "2026-06-13", subscriptionType: "Sensors",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 5d ago" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Mark Brown", primaryPayer: "UnitedHealthcare", nextOrderDate: "2026-06-10", subscriptionType: "Supplies",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 12d ago" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Sharon Thompson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-15", subscriptionType: "Sensors",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 17d ago" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" },
    lastPaid: { tone: "ok", label: "Paid" } },
];

const SUBMIT_RAW: Array<Omit<SubscriptionPatient, "id" | "mondayItemId" | "phone">> = [
  { name: "Andrew Moore", primaryPayer: "Tricare", nextOrderDate: "2026-06-18", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" }, lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Patricia Lewis", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-18", subscriptionType: "Sensors",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" }, lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Carol Wilson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-09", subscriptionType: "Sensors",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" }, lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Mark Taylor", primaryPayer: "Tricare", nextOrderDate: "2026-06-11", subscriptionType: "Sensors & Supplies",
    confirmation: { tone: "ok", label: "Confirmed" }, benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" }, lastPaid: { tone: "ok", label: "Paid" } },
];

function withIds(
  rows: Array<Omit<SubscriptionPatient, "id" | "mondayItemId" | "phone">>,
  startMondayId = 11_800_000_000,
): SubscriptionPatient[] {
  return rows.map((row, i) => ({
    ...row,
    id: `sub-${i + 1}`,
    mondayItemId: String(startMondayId + i * 137),
    phone: `(347) 555-${(100 + i).toString().padStart(4, "0")}`,
  }));
}

export const ORDER_PREP_PATIENTS = withIds(PATIENTS_RAW);
export const SUBMIT_ORDER_PATIENTS = withIds(SUBMIT_RAW, 11_900_000_000);

export const PAYER_OPTIONS = [
  "All payers", "Anthem BCBS Commercial", "Aetna", "Cigna", "Fidelis Commercial",
  "Humana", "Medicaid", "Tricare", "UnitedHealthcare",
] as const;

export const CHECKPOINT_STATE_OPTIONS = [
  "All states", "Awaiting Response", "Review Changes", "No Response", "Confirmed",
  "Benefits Inactive", "Auth Expiring", "Auth Expired", "Last Claim Unpaid",
] as const;
