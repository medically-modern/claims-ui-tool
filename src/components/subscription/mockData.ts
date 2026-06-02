// Mock data for the Subscription Board tab. Per Brandon's feedback (2026-06-02)
// patients can sit stuck in any phase for a while, so every row carries who's
// blocking, when we should check in, and a human-readable stuck reason. These
// fields drive the per-phase sub-tab views.

export type CheckpointTone = "ok" | "warn" | "bad" | "pending";
export type CheckpointGate = "hard" | "soft";
export type CheckpointKind = "confirmation" | "benefits" | "auth" | "lastPaid";
export type BlockedParty = "us" | "patient" | "payer" | "system";

export type Checkpoint = {
  tone: CheckpointTone;
  label: string;
  detail?: string;
  /** Set when operator already invoked the override flow on this cell. */
  overrideReason?: string;
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
  runCheck: "Pass" | "Failed" | "Run" | "Batch" | "—";
  confirmation: Checkpoint;
  benefits: Checkpoint;
  auth: Checkpoint;
  lastPaid: Checkpoint;
  /** Who needs to act to unblock the patient — `null` when nothing is blocked. */
  blockedBy?: BlockedParty;
  /** ISO date the patient entered the current stuck state. */
  stuckSince?: string;
  /** ISO date the operator should revisit / chase. */
  nextCheckIn?: string;
  /** Plain-language reason the patient hasn't moved. */
  stuckReason?: string;
};

export const CHECKPOINT_GATE: Record<CheckpointKind, CheckpointGate> = {
  confirmation: "soft",
  benefits:     "hard",
  auth:         "hard",
  lastPaid:     "soft",
};

/** What phase is this patient currently stuck in? Leftmost not-ok checkpoint wins. */
export function currentPhase(p: SubscriptionPatient): CheckpointKind | "ready" {
  if (p.confirmation.tone !== "ok") return "confirmation";
  if (p.benefits.tone !== "ok")     return "benefits";
  if (p.auth.tone !== "ok")         return "auth";
  if (p.lastPaid.tone !== "ok")     return "lastPaid";
  return "ready";
}

type RawPatient = Omit<SubscriptionPatient, "id" | "mondayItemId" | "phone">;

const PATIENTS_RAW: RawPatient[] = [
  // ─── Stuck in Confirmation ─────────────────────────────────────────────────
  { name: "Sharon Nelson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-18",
    subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 4d ago" },
    benefits: { tone: "ok", label: "Active", detail: "$0 ded" },
    auth: { tone: "ok", label: "DVS at order", detail: "Medicaid supplies" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "patient", stuckSince: "2026-05-29", nextCheckIn: "2026-06-03",
    stuckReason: "Patient received D-20 text but hasn't responded. Day-15 reminder due 6/3." },
  { name: "Andrew Moore", primaryPayer: "Tricare", nextOrderDate: "2026-06-18",
    subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "pending", label: "Awaiting", detail: "sent 4d ago" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "Sensors+Supplies, ends Aug 14" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "patient", stuckSince: "2026-05-29", nextCheckIn: "2026-06-03",
    stuckReason: "Patient received D-20 text but hasn't responded. Day-15 reminder due 6/3." },
  { name: "Robert Perez", primaryPayer: "Cigna", nextOrderDate: "2026-06-18",
    subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "warn", label: "Review changes", detail: "new pump type" },
    benefits: { tone: "ok", label: "Active", detail: "$840 ded" },
    auth: { tone: "warn", label: "Mismatch", detail: "product changed" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-06-01", nextCheckIn: "2026-06-03",
    stuckReason: "Patient switched pump type — operator needs to verify the new product is on the auth and update Subscription Type." },
  { name: "Maxine Devitt", primaryPayer: "Fidelis Commercial", nextOrderDate: "2026-06-21",
    subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "warn", label: "Review changes", detail: "address updated" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "Sensors+Supplies, ends Sep 02" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-06-01", nextCheckIn: "2026-06-03",
    stuckReason: "Patient updated shipping address on the form — verify ZIP serviceability before approving." },
  { name: "George Brown", primaryPayer: "Humana", nextOrderDate: "2026-06-18",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "bad", label: "No response", detail: "high-risk",
      overrideReason: "operator called patient 6/2; confirmed verbally" },
    benefits: { tone: "ok", label: "Active", detail: "$2,000 ded" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-05-27",
    stuckReason: "Override applied — operator confirmed verbally with patient on 6/2." },
  { name: "Sandra Baker", primaryPayer: "Aetna", nextOrderDate: "2026-06-23",
    subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "warn", label: "No response", detail: "low-risk proceed?" },
    benefits: { tone: "ok", label: "Active", detail: "$300 ded" },
    auth: { tone: "ok", label: "Valid", detail: "ends Aug 02" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-06-01", nextCheckIn: "2026-06-04",
    stuckReason: "Patient hasn't responded but is low-deductible — operator should decide whether to auto-proceed or call." },
  { name: "Linda Park", primaryPayer: "Humana", nextOrderDate: "2026-06-25",
    subscriptionType: "Supplies", runCheck: "—",
    confirmation: { tone: "pending", label: "Not sent", detail: "scheduled D-20" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "system", stuckSince: "2026-05-30", nextCheckIn: "2026-06-05",
    stuckReason: "Reorder text fires on D-20 (6/5)." },
  { name: "Diego Ortiz", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-07-05",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "warn", label: "Delayed", detail: "→ Jul 5 (was Jun 18)" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "patient", stuckSince: "2026-05-30", nextCheckIn: "2026-06-15",
    stuckReason: "Patient delayed order to 7/5. New confirmation cycle starts D-20 (6/15)." },
  // ─── Stuck in Eligibility ─────────────────────────────────────────────────
  { name: "Ruth Wilson", primaryPayer: "Tricare", nextOrderDate: "2026-06-07",
    subscriptionType: "Sensors & Supplies", runCheck: "Failed",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "bad", label: "Inactive", detail: "coverage ended 5/31" },
    auth: { tone: "bad", label: "Mismatch", detail: "old payer" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "patient", stuckSince: "2026-05-31", nextCheckIn: "2026-06-03",
    stuckReason: "Coverage terminated 5/31 — call patient to capture new insurance, then re-run eligibility." },
  { name: "Kevin Garcia", primaryPayer: "UnitedHealthcare", nextOrderDate: "2026-06-04",
    subscriptionType: "Sensors", runCheck: "—",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "pending", label: "Not run", detail: "no check this month" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-06-01", nextCheckIn: "2026-06-02",
    stuckReason: "Missed the 1st-of-month batch eligibility check. Run real-time or include in the next batch." },
  { name: "Annette Cole", primaryPayer: "Fidelis Commercial", nextOrderDate: "2026-06-30",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "warn", label: "Stale", detail: "ran Apr 18" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-06-01", nextCheckIn: "2026-06-02",
    stuckReason: "Last eligibility check was 6 weeks ago. Refresh before the order date." },
  { name: "Michelle Allen", primaryPayer: "Medicaid", nextOrderDate: "2026-06-06",
    subscriptionType: "Sensors", runCheck: "Batch",
    confirmation: { tone: "warn", label: "Review changes", detail: "new insurance" },
    benefits: { tone: "warn", label: "New insurance", detail: "Aetna → Cigna" },
    auth: { tone: "warn", label: "Re-eval", detail: "new payer" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-05-31", nextCheckIn: "2026-06-02",
    stuckReason: "Patient reported new Cigna coverage on reorder form. Run benefits against Cigna + re-evaluate auth." },
  // ─── Stuck in Authorization ────────────────────────────────────────────────
  { name: "Betty Johnson", primaryPayer: "Tricare", nextOrderDate: "2026-06-08",
    subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "bad", label: "Expired", detail: "ended May 12" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "payer", stuckSince: "2026-05-13", nextCheckIn: "2026-06-04",
    stuckReason: "Auth expired 5/12. Auth team submitted renewal 5/22 — awaiting payer approval." },
  { name: "Daniel Wilson", primaryPayer: "Aetna", nextOrderDate: "2026-06-05",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "warn", label: "Renew 7d", detail: "Sensors" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-05-29", nextCheckIn: "2026-06-02",
    stuckReason: "Sensors auth expires in 7 days — auth team needs to submit renewal this week." },
  { name: "Henry Park", primaryPayer: "Cigna", nextOrderDate: "2026-06-12",
    subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "bad", label: "Missing", detail: "Supplies required, absent" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-05-31", nextCheckIn: "2026-06-02",
    stuckReason: "Cigna requires auth for supplies — we don't have one on file. Auth team needs to submit." },
  { name: "Heidi Pratt", primaryPayer: "Humana", nextOrderDate: "2026-06-19",
    subscriptionType: "Sensors", runCheck: "—",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "pending", label: "Not checked", detail: "operator review" },
    lastPaid: { tone: "ok", label: "Paid" },
    blockedBy: "us", stuckSince: "2026-06-01", nextCheckIn: "2026-06-03",
    stuckReason: "Auth requirement hasn't been verified for Humana sensors — operator review needed." },
  // ─── Stuck in Last Order Paid ─────────────────────────────────────────────
  { name: "Jennifer Young", primaryPayer: "Medicaid", nextOrderDate: "2026-06-07",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" },
    lastPaid: { tone: "warn", label: "Pri pending", detail: "12d in review" },
    blockedBy: "payer", stuckSince: "2026-05-22", nextCheckIn: "2026-06-05",
    stuckReason: "Prior primary submitted 5/22, still in payer review. Operator can override if patient-responsibility piece is small." },
  { name: "Ruth Walker", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-09",
    subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "bad", label: "Pri unpaid", detail: "denied CO-22" },
    blockedBy: "us", stuckSince: "2026-05-25", nextCheckIn: "2026-06-02",
    stuckReason: "Prior primary denied (CO-22, COB issue). Billing team needs to resubmit with correct COB info." },
  { name: "Otis Whitman", primaryPayer: "Fidelis Commercial", nextOrderDate: "2026-06-16",
    subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "warn", label: "Sec pending", detail: "submitted 8d ago" },
    blockedBy: "payer", stuckSince: "2026-05-25", nextCheckIn: "2026-06-05",
    stuckReason: "Secondary submitted 5/25, still in payer review. Operator can override if balance is low." },
  { name: "Brent Fielding", primaryPayer: "UnitedHealthcare", nextOrderDate: "2026-06-20",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "bad", label: "Sec unpaid", detail: "denial — needs resubmit",
      overrideReason: "Sec balance $14.30 — not worth holding the next order" },
    blockedBy: "us", stuckSince: "2026-05-28",
    stuckReason: "Operator override applied — Sec balance is $14.30 and patient already paid copay, not worth holding." },
  // ─── Ready (will appear on Submit tab) ─────────────────────────────────────
  { name: "Patricia Lewis", primaryPayer: "Anthem BCBS Commercial", nextOrderDate: "2026-06-18",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed", detail: "no changes" },
    benefits: { tone: "ok", label: "Active", detail: "$1,250 ded" },
    auth: { tone: "ok", label: "Valid", detail: "ends Jul 30" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Wyllow Vance", primaryPayer: "Medicaid", nextOrderDate: "2026-06-15",
    subscriptionType: "Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "DVS at order", detail: "Medicaid supplies" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Carol Wilson", primaryPayer: "Medicaid", nextOrderDate: "2026-06-09",
    subscriptionType: "Sensors", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Not required" },
    lastPaid: { tone: "ok", label: "Paid" } },
  { name: "Mark Taylor", primaryPayer: "Tricare", nextOrderDate: "2026-06-11",
    subscriptionType: "Sensors & Supplies", runCheck: "Pass",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid", detail: "Sensors+Supplies, ends Aug 18" },
    lastPaid: { tone: "ok", label: "Paid" } },
];

function withIds(rows: RawPatient[], startMondayId = 1_180_000_000): SubscriptionPatient[] {
  return rows.map((row, i) => ({
    ...row,
    id: `sub-${i + 1}`,
    mondayItemId: String(startMondayId + i * 137),
    phone: `(347) 555-${(100 + i).toString().padStart(4, "0")}`,
  }));
}

export const ORDER_PREP_PATIENTS = withIds(PATIENTS_RAW);

export const PAYER_OPTIONS = [
  "All payers", "Anthem BCBS Commercial", "Aetna", "Cigna", "Fidelis Commercial",
  "Humana", "Medicaid", "Tricare", "UnitedHealthcare",
] as const;

export const BLOCKED_BY_OPTIONS = ["Anyone", "Us", "Patient", "Payer", "System"] as const;

export const PHASE_LABELS: Record<CheckpointKind | "ready", string> = {
  confirmation: "Confirmation",
  benefits:     "Eligibility",
  auth:         "Authorization",
  lastPaid:     "Last Order Paid",
  ready:        "Submit Order",
};
