/**
 * subscriptionPatients.ts — live read of the Subscription Board
 * (18407459988) for all Subscription tabs (Order Cycle, Patient
 * Profile, Authorizations, Medical Records, Financials).
 *
 * Pulls every column referenced anywhere in the Subscription Board UI
 * in a single paged query. Maps Monday cells to a SubscriptionPatient
 * shape compatible with the existing mock-data shape so tab consumers
 * can swap in live data without changing render code.
 *
 * Checkpoint derivation (Order Cycle) lives in lib/subscription/checks.ts,
 * which reads the payer-rule table in lib/subscription/payerRules.ts. This
 * file only maps Monday cells into CheckInputs. Columns read for the checks:
 *   Confirm       -> color_mm3kjykc 'Patient Order Response' + text_mm404p7d
 *                    'OOP Estimate' + numeric_mm2xvjc1 'Total GP'
 *   Eligibility   -> color_mm2nzm33 'Active?' + dropdown_mm3gkcmc facility
 *                    flags + date_mm43n083 'Last Eligibility Check' +
 *                    color_mm6vpy5a 'COB Check' + dropdown_mm5yx3sm
 *                    'Suggested Primary'
 *   Auth          -> color_mm25t997 / color_mm27snkq + Trigger DVS + Claims
 *                    Status (Medicaid ladder) + color_mm2p8v3m 'Insurance
 *                    Change?' (Fidelis plan-change rule)
 *   Last Paid     -> color_mm33spks + color_mm3aa9bx
 *   MR (5th)      -> date_mkp09gra 'MN Expiry' + color_mm6thrwv 'Referral Source'
 *   Order Type    -> color_mm2w6kd — a First Order has no blockers
 */

import { mondayQuery } from "../monday";
import type {
  SubscriptionPatient, SubscriptionType, PatientStatus, PatientFinancials,
} from "@/components/subscription/mockData";
import { deriveChecks } from "@/lib/subscription/checks";
import { todayIso } from "@/lib/subscription/lanes";
import { fetchNoteActivity } from "./noteActivity";

export const SUBSCRIPTION_BOARD_ID = 18407459988;

// ─── Column id map ──────────────────────────────────────────────────────────
export const SUB_COL = {
  // Identity / contact
  dob:               "text_mkvdefh1",
  gender:            "color_mm1zgyy2",
  patient_uid:       "text_mm3af3zt",
  phone:             "phone_mkp0q3cw",
  email:             "email_mkp01rrw",
  patient_address:   "location_mkp0rs0v",
  // Subscription
  subscription:      "color_mm273mv8",
  order_type:        "color_mm2w6kd",   // First Order / Reorder
  ordering_cycle:    "color_mkyjawhq",
  next_order:        "date_mkp0nvf1",
  sensors_type:      "color_mkxmdscr",
  supplies_type:     "color_mkxmnheg",
  inf_set_1:         "color_mkxm50f9",
  inf_qty_1:         "numeric_mkw839ks",
  inf_set_2:         "color_mkxmx5wk",
  inf_qty_2:         "numeric_mkwac234",
  patient_notes:     "long_text_mm3rj7k7",
  // What our team wrote down after a call or text (runbook step 2). Brandon
  // 2026-09-14: surfacing this in the tool is the other half of the
  // RingCentral read — a coordinator's note can be the only record that a
  // patient asked for overnight shipping or a different name on the box.
  // The patient's own words come from patient_help_message; Patient Portal
  // Notes (long_text_mm3evvzj) is deliberately absent (Brandon, 2026-09-19).
  subscription_notes: "text_mm6vp1z3",
  // Order Frequency (30/60/90-Days) — the profile's Order details block.
  order_frequency:    "color_mm48kv1c",
  cgm_qty:            "numeric_mm3sr332",
  cartridge_qty:      "numeric_mm3sfe56",
  // Contacts block on the profile (columns added 2026-08).
  can_text:           "color_mm72jg9e",
  primary_contact:    "color_mm72vm7p",
  alternate_contact:  "color_mm723hfk",
  alternate_phone:    "phone_mm72r19q",
  caregiver_name:     "text_mm72mdzk",
  caregiver_authorized: "boolean_mm72nt75",
  // The reorder form: the link we texted and when the patient answered.
  reorder_link:       "text_mm3khve4",
  patient_response_at: "text_mm3kt9bs",
  // Board's own MR status label (MR Valid / MR Expired / …), shown as-is.
  mr_status:          "color_mktyr8xg",
  // Per-order operator decisions, written by the tool (lib/subscription/
  // orderStamps.ts): "<ISO minute> <initials> for <Next Order>[ — reason]".
  correspondence_reviewed: "text_mm7czwqr",
  confirm_override:        "text_mm7cmkec",
  auth_override:           "text_mm7dj1kf",
  last_paid_override:      "text_mm7djd06",
  // Insurance
  primary_insurance:   "color_mm254qxj",
  member_id_1:         "text_mkvp6zfg",
  secondary_insurance: "color_mm25cr82",
  member_id_2:         "text_mm25cpx6",
  insurance_card:      "file_mm3knk5q",
  active:              "color_mm2nzm33",
  // Eligibility conditions the payer rules read (lib/subscription/payerRules.ts):
  //   Last Eligibility Check — Medicare's 7-day / same-month freshness rule
  //   COB Check              — "Other Primary Reported" blocks (not Medicaid)
  //   Suggested Primary      — must match Primary Insurance (not Medicaid)
  //   Insurance Change?      — Fidelis Low-Cost re-checks the sensor auth
  last_eligibility_check: "date_mm43n083",
  cob_check:              "color_mm6vpy5a",
  suggested_primary:      "dropdown_mm5yx3sm",
  insurance_change:       "color_mm2p8v3m",
  patient_insurance_response: "color_mm3k4z79",
  patient_order_response:     "color_mm3kjykc",
  patient_help_message:       "long_text_mm3xnb6k",
  // Auto-generated by Josh's reorder-patient-form backend: a timestamped
  // changelog of every patient submission. Each entry is one block,
  // entries separated by blank lines. Format:
  //   [6/7/26, 2:02 PM ET] Patient CONFIRM:
  //   Address changed from <X> to <Y>.
  //   CGM type changed from <A> to <B>.
  patient_change_summary:     "long_text_mm3k5y3n",
  // Reorder text status: populated by Josh's reorder-patient-form cron
  // with the SMS body / token URL when the text fires. Empty = text
  // hasn't gone out yet → Confirmation circle should render as an
  // open outline (not gray pending) so it's clear we haven't even
  // asked the patient yet.
  reorder_text_sent:          "text_mm3rzqks",
  // Stedi check trigger + outcome. Populated by Josh's automation +
  // Brandon's manual flips: 'Run' / 'Batch' / 'Pass' / 'Failed' / '' .
  run_check:                  "color_mm2nnjam",
  // Long-text. Populated by services/subscription_eligibility_monday_service
  // on the Failed path with the Stedi AAA / validation reason.
  // Cleared on success. Surfaced via Eligibility circle hover.
  last_eligibility_error:     "long_text_mm438m3a",
  // Doctor
  doctor:           "text_mkxn3wza",
  npi:              "text_mkxnkgzg",
  doctor_address:   "location_mkxnbt7y",
  doctor_phone:     "phone_mkxnv7e5",
  doctor_fax:       "email_mkxn9af2",
  fax_parachute:    "color_mm25t5q",
  // Status / flags
  status:           "color_mm2t7tdy",
  // Referral Source (status). Read for the MR check: "District Endochrine"
  // referrals can't be reordered without valid medical records.
  referral_source:  "color_mm6thrwv",
  pause_reason:     "dropdown_mm2v3gfy",
  dead_reason:      "dropdown_mm27mdkh",
  // ─── Order Cycle v2 block tracking (columns created 2026-07-21) ───────────
  // See ORDER_CYCLE_V2_DESIGN.md §8.2 + src/lib/subscription/lanes.ts.
  check_in_date:        "date_mm5fdn4h",
  missed_checkins:      "numeric_mm5fcsvt",
  block_resolution:     "color_mm5f3v2n",
  block_note:           "long_text_mm5ffcqk",
  blocked_date:         "date_mm5f7des",
  last_patient_contact: "text_mm5frhe9",
  // Clinical
  mn_expiry:        "date_mkp09gra",
  diagnosis:        "color_mkxrxv9w",
  mn_docs:          "file_mkp0vm0a",
  // Auth
  sensors_auth_status:  "color_mm25t997",
  sensors_auth_id:      "text_mkwbkq9d",
  sensors_auth_start:   "date_mkwb4q5e",
  sensors_auth_end:     "date_mkwbvr6t",
  sensors_units:        "numeric_mkwbzsg2",
  sensors_id_2:         "text_mm273kgs",
  supplies_auth_status: "color_mm27snkq",
  inf_set_auth_id:      "text_mm28v64f",
  cartridge_auth_id:    "text_mm255y04",
  supplies_auth_start:  "date_mm25csyr",
  supplies_auth_end:    "date_mm255cs4",
  supplies_units:       "numeric_mm25mf8k",
  prior_auth_req:       "color_mm2pj23n",
  trigger_dvs:          "color_mm2narpj",
  // Eligibility outputs
  stedi_payer_name:     "dropdown_mm2nz3wd",
  stedi_plan_name:      "dropdown_mm2n7ps1",
  stedi_member_id:      "text_mm2phve4",
  date_plan_begin:      "text_mm3grb6t",
  deductible:           "text_mm3gbped",
  ded_remaining:        "text_mm3g32ja",
  coinsurance:          "text_mm3gphed",
  oop_max:              "text_mm3gh0q3",
  oop_max_remaining:    "text_mm3gs345",
  // "OOP Estimate" (text) — separate automation precomputes total OOP
  // for the upcoming order; OopBadge headline prefers this over a
  // deductible-only calc when populated.
  oop_estimate:         "text_mm404p7d",
  // "SNF/Hospice/Hospital/Deceased" (dropdown) — populated by the Stedi
  // eligibility parser when the 271 reports an open Hospice election
  // (STC 45) or Hospital/SNF admission (STC 48/AH), or a subscriber
  // date of death (DTP*442). "Deceased" also settable by ops and sticky
  // across re-checks (backend carries it forward; consolidated
  // 2026-07-27, replacing the standalone Deceased? column). Read by
  // deriveEligibility (lib/subscription/checks.ts): Deceased and
  // Hospital/SNF are dark red for everyone; Hospice is a payer rule —
  // light green on Medicare A&B (GW modifier), light red elsewhere.
  facility_flags:       "dropdown_mm3gkcmc",
  qmb:                  "text_mm3gr7rh",
  // Claims
  primary_claim_paid:   "color_mm33spks",
  secondary_claim_paid: "color_mm3aa9bx",
  // "Secondary Amount" (numbers) — dollar amount still outstanding on
  // the secondary claim. Surfaced in the Last Paid hover so the
  // operator sees the size of the gap, not just that there is one.
  secondary_amount:     "numeric_mm3hvtec",
  // ─── Financials: per-order economics, recomputed by "Calculate Financials" ──
  // These are the dollar figures the forecast is built from. Verified column
  // ids 2026-06-13. All numeric columns; parsed via getNum (0 when blank).
  calculate_financials: "color_mm2w74y8",  // status: triggers/flags the calc
  sensors_revenue:      "numeric_mkxj6a3d",
  sensors_cost:         "numeric_mkxjxmga",
  sensors_gp:           "numeric_mkxjyw32",
  supplies_revenue:     "numeric_mm27rypj",
  supplies_cost:        "numeric_mm27hem2",
  supplies_gp:          "numeric_mm2785ag",
  total_revenue:        "numeric_mm2xsjm5",
  total_cost:           "numeric_mm2xgvxx",
  total_gp:             "numeric_mm2xvjc1",
  shipping_cost:        "numeric_mm2xxmp4",
  arr_value:            "numeric_mm2xsqyd",
  arp_value:            "numeric_mm2xdsvh",
  // ─── Claims actuals (subscription-side rollup) — for the forecast blend ─────
  // NOTE 2026-06-13: claims_paid_amount is currently a uniform placeholder
  // ("$564.30") on every paid row, so the forecast uses Total Revenue for the
  // settled *amount* and only trusts claims_paid_date for settled *timing*.
  claims_status_col:    "color_mm2n5rkg",
  // Comms counts since the patient's last order, written by the backend's
  // hourly RingCentral pass (stedi-monday-integration). The row shows them on
  // the phone / speech-bubble icons. These columns do not exist on the board
  // yet — `get` returns "" and the icons render without a number until the
  // backend ships them. Fill the real IDs in when the columns are created.
  calls_since_order:    "numeric_calls_since_order__TODO",
  texts_since_order:    "numeric_texts_since_order__TODO",
  // Per-code results the DVS bot writes: "Paid: $456.00" / "Denied: <reason>".
  // A4230 = infusion sets, A4232 = cartridges.
  a4230_claim:          "text_mm2nfyyw",
  a4232_claim:          "text_mm2nmrjt",
  claims_paid_date:     "date_mm2nr2vz",
  claims_paid_amount:   "text_mm2nxwze",
  partial_approval_date:"date_mm2na60z",
} as const;

// Placeholder ids (…__TODO) are not sent to Monday.
const READ_IDS = Object.values(SUB_COL).filter((id) => !id.includes("__TODO"));

// ─── Type extensions ───────────────────────────────────────────────────────
/**
 * Extended SubscriptionPatient with the extra columns the Patient
 * Profile + tabs need. Compatible with the mock's SubscriptionPatient
 * (all those fields are present); adds Monday-only data so consumers
 * can edit a wide form against a single object.
 */
export interface LiveSubscriptionPatient extends SubscriptionPatient {
  dob: string; gender: string; patientUid: string; email: string; address: string;
  sensorsType: string; suppliesType: string;
  infusionSet1: string; infusionSet1Qty: string;
  infusionSet2: string; infusionSet2Qty: string;
  subscriptionNotes: string;
  /** What our team wrote down (text_mm6vp1z3) — read at confirmation time,
   *  runbook step 2. The patient's side is patientHelpMessage. */
  coordinatorNotes: string;
  memberId1: string; secondaryInsurance: string; memberId2: string;
  insuranceCardName: string;
  patientInsuranceResponse: string;
  patientOrderResponse: string;
  patientHelpMessage: string;
  doctorName: string; doctorNpi: string; doctorAddress: string;
  doctorPhone: string; doctorFax: string; clinicalsMethod: string;
  diagnosis: string; mnExpiry: string; mnDocsName: string;
  // Auth (per-product)
  sensorsAuthStatus: string; sensorsAuthId: string;
  sensorsAuthStart: string; sensorsAuthEnd: string; sensorsAuthUnits: string;
  sensorsId2: string;
  suppliesAuthStatus: string;
  infusionAuthId: string; cartridgeAuthId: string;
  suppliesAuthStart: string; suppliesAuthEnd: string; suppliesAuthUnits: string;
  priorAuthReq: string;
  triggerDvs: string;
  /** Strict board Status label ("Active"/"Paused"/"Not Active"/"") — use
   *  for KPIs; patientStatus is ops-normalized and folds blanks to Active. */
  rawPatientStatus: string;
  // Eligibility
  active: string;
  stediMemberId: string; stediPayerName: string; stediPlanName: string;
  datePlanBegin: string; deductibleAmt: string; dedRemaining: string;
  coinsurancePct: string; oopMax: string; oopMaxRemaining: string;
  oopEstimate: string;
  facilityFlags: string;
  // Claims
  primaryClaimPaid: string; secondaryClaimPaid: string;
  secondaryAmount: string;
  // Financials (per-order economics) + claims actuals for the forecast
  financials: PatientFinancials;
  calculateFinancials: string;
  claimsStatusCol: string;
  a4230Claim: string; a4232Claim: string;
  claimsPaidDate: string;
  claimsPaidAmount: string;
  partialApprovalDate: string;
  // Group membership (used to filter Not Active patients out by default)
  groupId: string;
  isNotActive: boolean;
  orderType: string;  // "First Order" / "Reorder" / ""
  // Order Cycle v2 block tracking (lanes.ts BlockFields)
  checkInDate: string;
  missedCheckIns: number;
  blockResolution: string;
  blockNote: string;
  blockedDate: string;
  lastPatientContact: string;
  // Profile page (2026-09-20 redesign)
  orderFrequency: string;
  cgmQty: string;
  cartridgeQty: string;
  canText: string;
  primaryContact: string;
  alternateContact: string;
  alternatePhone: string;
  caregiverName: string;
  caregiverAuthorized: string;
  reorderLink: string;
  reorderTextSent: string;
  patientResponseAt: string;
  patientChangeSummary: string;
  mrStatus: string;
  lastEligibilityCheck: string;
  lastEligibilityError: string;
  cobCheck: string;
  suggestedPrimary: string;
  insuranceChange: string;
  correspondenceReviewed: string;
  confirmOverride: string;
  authOverride: string;
  lastPaidOverride: string;
}

// ─── Monday types ───────────────────────────────────────────────────────────
interface ColumnValue { id: string; text: string }
interface MondayGroup { id: string; title: string }
interface MondayItem  {
  id: string; name: string;
  group?: MondayGroup | null;
  column_values: ColumnValue[];
}

// Subscription Board group IDs (verified 2026-06-06 via Monday API).
// "Subscriptions" is the live cohort; everything in the "Not Active
// Patients" group is hidden by default in the Patient Profile.
const NOT_ACTIVE_GROUP_ID = "group_mkp19fyp";

// ─── Queries ────────────────────────────────────────────────────────────────
// Two-step read (2026-09-20). Paging 500 rows × ~115 columns through one
// cursor took 26 s cold on the live board (16 s + 10 s, sequential by
// construction — each page's cursor comes back with the previous page).
// Reading the id list alone is cheap, and `items(ids:)` takes up to 100 ids
// per call with no cursor, so the row reads can run side by side: measured
// 5.5 s for the ids + 4.6 s for nine parallel chunks ≈ 10 s for the same
// data, at similar Monday complexity (9 × 13.3k vs 66k + 49k).
// The id pages are pipelined too: chunks for page 1 start while page 2 loads.
const IDS_FIRST_QUERY = `
  query SubIdsFirst($boardId: ID!) {
    boards(ids: [$boardId]) { items_page(limit: 500) { cursor items { id } } }
  }
`;
const IDS_NEXT_QUERY = `
  query SubIdsNext($cursor: String!) {
    next_items_page(cursor: $cursor, limit: 500) { cursor items { id } }
  }
`;
/** Monday's ceiling for `items(ids:)`; also the `limit` in ITEMS_QUERY. */
const ITEMS_CHUNK = 100;
/** Parallel row reads in flight. Nine chunks at 8-wide finished in 4.6 s,
 *  comfortably under Monday's per-token concurrency. */
const ITEMS_CONCURRENCY = 8;
// ⚠️ `items(ids:)` returns at most 25 rows unless `limit` is passed, however
// many ids you send — and it does so silently. Shipped without it on
// 2026-09-20 (PR #29): 225 of 868 patients loaded and the board looked
// plausible. `limit` must match ITEMS_CHUNK, and fetchRows checks the count.
const ITEMS_QUERY = `
  query SubItems($ids: [ID!], $cols: [String!]!) {
    items(ids: $ids, limit: ${ITEMS_CHUNK}) {
      id name
      group { id title }
      column_values(ids: $cols) { id text }
    }
  }
`;

// ─── Cell helpers ───────────────────────────────────────────────────────────
function get(item: MondayItem, col: string): string {
  return (item.column_values.find((c) => c.id === col)?.text ?? "").trim();
}

/** Parse a numeric/text cell to a number. Strips $ and commas. Returns 0 for
 *  blank / non-numeric so financial sums never produce NaN. */
function getNum(item: MondayItem, col: string): number {
  const raw = get(item, col).replace(/[^0-9.\-]/g, "");
  if (raw === "" || raw === "-" || raw === ".") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** A Monday numeric cell as a count. Blank stays undefined — "we have not
 *  counted" and "we counted zero" are different facts and the row shows them
 *  differently. */
function countOrUndef(raw: string): number | undefined {
  const t = String(raw ?? "").trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeSubscriptionType(raw: string): SubscriptionType {
  if (raw === "Sensors" || raw === "Supplies" || raw === "Sensors & Supplies") return raw;
  // Map any other label sensibly — default to Sensors & Supplies (most permissive)
  if (raw.toLowerCase().includes("sensor") && raw.toLowerCase().includes("supplies")) return "Sensors & Supplies";
  if (raw.toLowerCase().includes("sensor"))  return "Sensors";
  if (raw.toLowerCase().includes("supplies")) return "Supplies";
  return "Sensors & Supplies";
}

function normalizeStatus(raw: string): PatientStatus {
  if (raw === "Paused" || raw === "Dead") return raw;
  return "Active";
}
// NOTE: normalizeStatus is an OPS-board convenience (blank/"Not Active"
// fold into "Active" so items keep flowing through lanes). KPI surfaces
// must use rawPatientStatus below — the strict board value — or they
// overcount actives (FinancialsHub hero bug, 2026-08-02).

// ─── Map one item ───────────────────────────────────────────────────────────
function mapItem(
  item: MondayItem,
  notesUpdatedAt: number | null = null,
  today: string = todayIso(),
): LiveSubscriptionPatient {
  const subType = normalizeSubscriptionType(get(item, SUB_COL.subscription));
  const referralSource = get(item, SUB_COL.referral_source);
  const mnExpiry       = get(item, SUB_COL.mn_expiry);
  // The five checks + row flags, from board values alone. Pure, tested in
  // lib/subscription/checks.test.ts; rules in lib/subscription/payerRules.ts.
  const checks = deriveChecks({
    today,
    primaryInsurance:         get(item, SUB_COL.primary_insurance),
    orderDate:                get(item, SUB_COL.next_order),
    orderType:                get(item, SUB_COL.order_type),
    subscriptionType:         subType,
    patientOrderResponse:     get(item, SUB_COL.patient_order_response),
    patientInsuranceResponse: get(item, SUB_COL.patient_insurance_response),
    patientHelpMessage:       get(item, SUB_COL.patient_help_message),
    patientChangeSummary:     get(item, SUB_COL.patient_change_summary),
    reorderTextSent:          get(item, SUB_COL.reorder_text_sent),
    coordinatorNotes:         get(item, SUB_COL.subscription_notes),
    notesUpdatedAt,
    lastPatientContact:       get(item, SUB_COL.last_patient_contact),
    oopEstimate:              get(item, SUB_COL.oop_estimate),
    totalGp:                  get(item, SUB_COL.total_gp),
    correspondenceReviewed:   get(item, SUB_COL.correspondence_reviewed),
    orderFrequency:           get(item, SUB_COL.order_frequency),
    confirmOverride:          get(item, SUB_COL.confirm_override),
    authOverride:             get(item, SUB_COL.auth_override),
    lastPaidOverride:         get(item, SUB_COL.last_paid_override),
    active:                   get(item, SUB_COL.active),
    runCheck:                 get(item, SUB_COL.run_check),
    lastEligibilityError:     get(item, SUB_COL.last_eligibility_error),
    facilityFlags:            get(item, SUB_COL.facility_flags),
    lastEligibilityCheck:     get(item, SUB_COL.last_eligibility_check),
    cobCheck:                 get(item, SUB_COL.cob_check),
    suggestedPrimary:         get(item, SUB_COL.suggested_primary),
    sensorsAuthStatus:        get(item, SUB_COL.sensors_auth_status),
    suppliesAuthStatus:       get(item, SUB_COL.supplies_auth_status),
    triggerDvs:               get(item, SUB_COL.trigger_dvs),
    claimsStatus:             get(item, SUB_COL.claims_status_col),
    insuranceChange:          get(item, SUB_COL.insurance_change),
    primaryClaimPaid:         get(item, SUB_COL.primary_claim_paid),
    secondaryClaimPaid:       get(item, SUB_COL.secondary_claim_paid),
    secondaryAmount:          get(item, SUB_COL.secondary_amount),
    mnExpiry,
    referralSource,
  });
  const { confirmation, benefits, auth, lastPaid, mr } = checks;

  return {
    // Base SubscriptionPatient
    id: item.id,
    mondayItemId: item.id,
    name: item.name,
    phone: get(item, SUB_COL.phone),
    primaryPayer: get(item, SUB_COL.primary_insurance) || "—",
    nextOrderDate: get(item, SUB_COL.next_order),
    callsSinceOrder: countOrUndef(get(item, SUB_COL.calls_since_order)),
    textsSinceOrder: countOrUndef(get(item, SUB_COL.texts_since_order)),
    subscriptionType: subType,
    runCheck: "—",
    patientStatus: normalizeStatus(get(item, SUB_COL.status)),
    rawPatientStatus: get(item, SUB_COL.status),
    pauseReason: get(item, SUB_COL.pause_reason) || undefined,
    deadReason:  get(item, SUB_COL.dead_reason)  || undefined,
    orderingCycle: get(item, SUB_COL.ordering_cycle) || undefined,
    confirmation,
    benefits,
    auth,
    lastPaid,
    mr,
    referralSource,
    firstOrder:  checks.firstOrder,
    payerGroup:  checks.payerGroup,
    flags:       checks.flags,

    // Extended fields
    dob:                 get(item, SUB_COL.dob),
    gender:              get(item, SUB_COL.gender),
    patientUid:          get(item, SUB_COL.patient_uid),
    email:               get(item, SUB_COL.email),
    address:             get(item, SUB_COL.patient_address),
    sensorsType:         get(item, SUB_COL.sensors_type),
    suppliesType:        get(item, SUB_COL.supplies_type),
    infusionSet1:        get(item, SUB_COL.inf_set_1),
    infusionSet1Qty:     get(item, SUB_COL.inf_qty_1),
    infusionSet2:        get(item, SUB_COL.inf_set_2),
    infusionSet2Qty:     get(item, SUB_COL.inf_qty_2),
    subscriptionNotes:   get(item, SUB_COL.patient_notes),
    coordinatorNotes:    get(item, SUB_COL.subscription_notes),
    memberId1:           get(item, SUB_COL.member_id_1),
    secondaryInsurance:  get(item, SUB_COL.secondary_insurance),
    memberId2:           get(item, SUB_COL.member_id_2),
    insuranceCardName:   get(item, SUB_COL.insurance_card),
    patientInsuranceResponse: get(item, SUB_COL.patient_insurance_response),
    patientOrderResponse:     get(item, SUB_COL.patient_order_response),
    patientHelpMessage:       get(item, SUB_COL.patient_help_message),
    doctorName:          get(item, SUB_COL.doctor),
    doctorNpi:           get(item, SUB_COL.npi),
    doctorAddress:       get(item, SUB_COL.doctor_address),
    doctorPhone:         get(item, SUB_COL.doctor_phone),
    doctorFax:           get(item, SUB_COL.doctor_fax),
    clinicalsMethod:     get(item, SUB_COL.fax_parachute),
    diagnosis:           get(item, SUB_COL.diagnosis),
    mnExpiry,
    mnDocsName:          get(item, SUB_COL.mn_docs),
    sensorsAuthStatus:   get(item, SUB_COL.sensors_auth_status),
    sensorsAuthId:       get(item, SUB_COL.sensors_auth_id),
    sensorsAuthStart:    get(item, SUB_COL.sensors_auth_start),
    sensorsAuthEnd:      get(item, SUB_COL.sensors_auth_end),
    sensorsAuthUnits:    get(item, SUB_COL.sensors_units),
    sensorsId2:          get(item, SUB_COL.sensors_id_2),
    suppliesAuthStatus:  get(item, SUB_COL.supplies_auth_status),
    infusionAuthId:      get(item, SUB_COL.inf_set_auth_id),
    cartridgeAuthId:     get(item, SUB_COL.cartridge_auth_id),
    suppliesAuthStart:   get(item, SUB_COL.supplies_auth_start),
    suppliesAuthEnd:     get(item, SUB_COL.supplies_auth_end),
    suppliesAuthUnits:   get(item, SUB_COL.supplies_units),
    priorAuthReq:        get(item, SUB_COL.prior_auth_req),
    triggerDvs:          get(item, SUB_COL.trigger_dvs),
    active:              get(item, SUB_COL.active),
    stediMemberId:       get(item, SUB_COL.stedi_member_id),
    stediPayerName:      get(item, SUB_COL.stedi_payer_name),
    stediPlanName:       get(item, SUB_COL.stedi_plan_name),
    datePlanBegin:       get(item, SUB_COL.date_plan_begin),
    deductibleAmt:       get(item, SUB_COL.deductible),
    dedRemaining:        get(item, SUB_COL.ded_remaining),
    coinsurancePct:      get(item, SUB_COL.coinsurance),
    oopMax:              get(item, SUB_COL.oop_max),
    oopMaxRemaining:     get(item, SUB_COL.oop_max_remaining),
    oopEstimate:         get(item, SUB_COL.oop_estimate),
    facilityFlags:       get(item, SUB_COL.facility_flags),
    primaryClaimPaid:    get(item, SUB_COL.primary_claim_paid),
    secondaryClaimPaid:  get(item, SUB_COL.secondary_claim_paid),
    secondaryAmount:     get(item, SUB_COL.secondary_amount),
    financials: {
      sensorsRevenue:  getNum(item, SUB_COL.sensors_revenue),
      sensorsCost:     getNum(item, SUB_COL.sensors_cost),
      sensorsGP:       getNum(item, SUB_COL.sensors_gp),
      suppliesRevenue: getNum(item, SUB_COL.supplies_revenue),
      suppliesCost:    getNum(item, SUB_COL.supplies_cost),
      suppliesGP:      getNum(item, SUB_COL.supplies_gp),
      shippingCost:    getNum(item, SUB_COL.shipping_cost),
      totalRevenue:    getNum(item, SUB_COL.total_revenue),
      totalCost:       getNum(item, SUB_COL.total_cost),
      totalGP:         getNum(item, SUB_COL.total_gp),
      arr:             getNum(item, SUB_COL.arr_value),
      arp:             getNum(item, SUB_COL.arp_value),
    },
    calculateFinancials: get(item, SUB_COL.calculate_financials),
    claimsStatusCol:     get(item, SUB_COL.claims_status_col),
    a4230Claim:          get(item, SUB_COL.a4230_claim),
    a4232Claim:          get(item, SUB_COL.a4232_claim),
    claimsPaidDate:      get(item, SUB_COL.claims_paid_date),
    claimsPaidAmount:    get(item, SUB_COL.claims_paid_amount),
    partialApprovalDate: get(item, SUB_COL.partial_approval_date),
    groupId:             item.group?.id ?? "",
    isNotActive:         item.group?.id === NOT_ACTIVE_GROUP_ID,
    // Order Cycle v2 block tracking. nextCheckIn / stuckSince / stuckReason
    // are the pre-existing display fields (CheckInCell etc.) — feed them
    // from the new live columns so old render paths light up too.
    orderType:           get(item, SUB_COL.order_type),
    checkInDate:         get(item, SUB_COL.check_in_date),
    missedCheckIns:      getNum(item, SUB_COL.missed_checkins),
    blockResolution:     get(item, SUB_COL.block_resolution),
    blockNote:           get(item, SUB_COL.block_note),
    blockedDate:         get(item, SUB_COL.blocked_date),
    lastPatientContact:  get(item, SUB_COL.last_patient_contact),
    orderFrequency:      get(item, SUB_COL.order_frequency),
    cgmQty:              get(item, SUB_COL.cgm_qty),
    cartridgeQty:        get(item, SUB_COL.cartridge_qty),
    canText:             get(item, SUB_COL.can_text),
    primaryContact:      get(item, SUB_COL.primary_contact),
    alternateContact:    get(item, SUB_COL.alternate_contact),
    alternatePhone:      get(item, SUB_COL.alternate_phone),
    caregiverName:       get(item, SUB_COL.caregiver_name),
    caregiverAuthorized: get(item, SUB_COL.caregiver_authorized),
    reorderLink:         get(item, SUB_COL.reorder_link),
    reorderTextSent:     get(item, SUB_COL.reorder_text_sent),
    patientResponseAt:   get(item, SUB_COL.patient_response_at),
    patientChangeSummary: get(item, SUB_COL.patient_change_summary),
    mrStatus:            get(item, SUB_COL.mr_status),
    lastEligibilityCheck: get(item, SUB_COL.last_eligibility_check),
    lastEligibilityError: get(item, SUB_COL.last_eligibility_error),
    cobCheck:            get(item, SUB_COL.cob_check),
    suggestedPrimary:    get(item, SUB_COL.suggested_primary),
    insuranceChange:     get(item, SUB_COL.insurance_change),
    correspondenceReviewed: get(item, SUB_COL.correspondence_reviewed),
    confirmOverride:     get(item, SUB_COL.confirm_override),
    authOverride:        get(item, SUB_COL.auth_override),
    lastPaidOverride:    get(item, SUB_COL.last_paid_override),
    nextCheckIn:         get(item, SUB_COL.check_in_date) || undefined,
    stuckSince:          get(item, SUB_COL.blocked_date) || undefined,
    stuckReason:         (get(item, SUB_COL.block_note).split("\n")[0] || undefined),
  };
}

// ─── Fetcher ────────────────────────────────────────────────────────────────
interface IdPage { cursor: string | null; items: Array<{ id: string }> }
interface IdsFirstResponse { boards: Array<{ items_page: IdPage }> }
interface IdsNextResponse { next_items_page: IdPage }
interface ItemsResponse { items: MondayItem[] }

/** Run `fn` over `chunks`, at most `width` at a time, preserving order. */
async function mapLimited<T, R>(chunks: T[], width: number, fn: (c: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      out[i] = await fn(chunks[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, chunks.length) }, worker));
  return out;
}

/**
 * Fetch the full rows for a page of ids, `ITEMS_CHUNK` at a time in parallel.
 * Every id came from items_page a moment ago, so every id must come back;
 * a short chunk is retried once and then treated as a failed load — a board
 * missing rows is worse than a board that says it couldn't load.
 */
async function fetchRows(ids: string[]): Promise<MondayItem[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ITEMS_CHUNK) chunks.push(ids.slice(i, i + ITEMS_CHUNK));
  const pages = await mapLimited(chunks, ITEMS_CONCURRENCY, async (chunk) => {
    const read = async () => (await mondayQuery<ItemsResponse>(ITEMS_QUERY, { ids: chunk, cols: READ_IDS })).items ?? [];
    let items = await read();
    if (items.length < chunk.length) items = await read();
    if (items.length < chunk.length) {
      throw new Error(`Monday returned ${items.length} of ${chunk.length} Subscription rows asked for — not showing a partial board.`);
    }
    return items;
  });
  return pages.flat();
}

/** The two note columns whose last-written time decides the row's badge. */
const NOTE_ACTIVITY_COLS = [
  SUB_COL.patient_help_message,
  SUB_COL.subscription_notes,
];

export async function fetchSubscriptionPatients(): Promise<LiveSubscriptionPatient[]> {
  const out: LiveSubscriptionPatient[] = [];

  // When each patient's notes were last touched. Started first and awaited
  // once, so the extra call overlaps the row paging instead of adding to it;
  // it resolves to an empty map on failure, which simply means no note badges.
  const notesP = fetchNoteActivity(SUBSCRIPTION_BOARD_ID, NOTE_ACTIVITY_COLS);

  // Step 1: the id list, 500 per page. Step 2 starts for each page as soon as
  // that page's ids arrive, so the row reads overlap the next id page.
  const rowReads: Array<Promise<MondayItem[]>> = [];
  const first = await mondayQuery<IdsFirstResponse>(IDS_FIRST_QUERY, { boardId: String(SUBSCRIPTION_BOARD_ID) });
  let page: IdPage | null = first.boards[0]?.items_page ?? null;
  while (page) {
    const ids = page.items.map((i) => String(i.id));
    if (ids.length) rowReads.push(fetchRows(ids));
    const cursor: string | null = page.cursor;
    if (!cursor) break;
    const next = await mondayQuery<IdsNextResponse>(IDS_NEXT_QUERY, { cursor });
    page = next.next_items_page ?? null;
  }

  const raw = (await Promise.all(rowReads)).flat();
  const notes = await notesP;
  for (const it of raw) out.push(mapItem(it, notes.get(String(it.id)) ?? null));
  return out;
}
