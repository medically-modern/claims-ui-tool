// Claim threads — model + helpers for original/follow-up linkage.

export type ItemStatus =
  | "Pending"
  | "Denied"
  | "Partial"
  | "Pending Follow-up"
  | "Paid/Done";

export type ThreadClaimType = "Original" | "Corrected";

export type ThreadClaimStatus =
  | "Awaiting Submission"
  | "Submitted"
  | "Partially Paid"
  | "Closed";

export interface ThreadItem {
  id: string;
  hcpc: string;
  modifiers: string[];
  qty: number;
  charge: number;
  est_pay: number;
  status: ItemStatus;
  /** Subitem Auth ID (column text_mm1z8nks on the Claims Subitems board).
   *  Each service line can carry its own prior-auth ID. When this changes
   *  on a subitem, the parent's Authorization text column (text_mkwrb2t9)
   *  is rewritten with the comma-joined union of all non-empty subitem
   *  Auth IDs so the 837 builder picks up the latest. */
  auth_id?: string;
  paid_amount?: number;
  carc_codes?: string;
  rarc_codes?: string;
  denial_bucket?: string;
  notes?: string;
  linked_to_original_item_id?: string;
  resolved_via_item_id?: string;
}

export interface ThreadClaim {
  id: string;
  /** Monday item id — distinct from `id` (which may be the Claim ID
   *  column value when set). Needed for any write-back to Monday since
   *  setStatus / setPlaceOfService / etc. all key by item id, not the
   *  human Claim ID. Optional for mock/in-memory rows that don't have
   *  a Monday backing. */
  monday_item_id?: string;
  type: ThreadClaimType;
  status: ThreadClaimStatus;
  patient: { name: string; dob: string; member_id: string };
  /** PR Payor ID — Stedi trading partner ID stamped into the 837.
   *  Read from Monday column text_mm1gcz3y. Editable on the Resubmit
   *  bucket of PrimarySubmitBoard so the operator can correct it
   *  before submission. Null/empty means the backend will auto-resolve
   *  from PAYER_ID_MAP via the Primary Payor label. */
  payor_id?: string;
  payer: string;
  diagnosis?: string;
  dos: string; // ISO yyyy-mm-dd
  icn?: string;
  parent_claim_id?: string;
  /** Place of Service label as stored on Monday (status column
   *  color_mm3fk3qv). "Home" -> CMS POS 12, "Office" -> CMS POS 11.
   *  Defaults to Home in the UI when undefined. */
  place_of_service?: "Home" | "Office";
  /** 277 claim-status acknowledgment from Stedi / payer (column
   *  color_mm1z1pb2). Lives on Submitted claims and tells the
   *  operator whether the payer has accepted the 837 yet:
   *    - "Stedi Accepted"  → Stedi forwarded successfully, awaiting payer
   *    - "Payer Accepted"  → payer received it cleanly, awaiting ERA
   *    - "Stedi Rejected" / "Payer Rejected" → bounced, needs attention
   *    - undefined         → no 277 received yet
   *  Used by the "Awaiting Acceptance" tab on PrimarySubmitBoard. */
  status277?:
    | "Payer Accepted"
    | "Stedi Accepted"
    | "Payer Rejected"
    | "Stedi Rejected";
  /** True when the Primary Status (color_mkxmywtb) was set to
   *  "Request rejected" — the 837 never made it to the payer (for
   *  example, future DOS, structural validation failure). Shown
   *  alongside the 277 statuses in the Awaiting Acceptance tab so
   *  these stuck claims surface for operator attention. */
  request_rejected?: boolean;
  /** Rejection reason text (column text_mm1zsp2x — originally
   *  "277 Rejected Reason", reused by the backend for Request
   *  Rejected reasons too). Powers the tooltip on the
   *  Move-to-Submit button so the operator can see why a row
   *  bounced without having to open the Monday Updates tab. */
  rejection_reason?: string;
  /** Claim Sent Date (date_mm14rk8d) — when we sent the original 837.
   *  ISO YYYY-MM-DD. Used together with claimResentDate to compute
   *  staleness of Stedi-Accepted claims: max(sent, resent) is the
   *  effective "last on the wire" timestamp. */
  claimSentDate?: string;
  /** Claim Resent Date (date_mm29scz) — when we last resubmitted
   *  (corrected / void / retry). ISO YYYY-MM-DD. Trumps claimSentDate
   *  for staleness when set; without it, claimSentDate is the proxy. */
  claimResentDate?: string;
  items: ThreadItem[];
  notes?: string;
  createdAt: number;
}

// ---------- helpers ----------

export function getRootClaim(claim: ThreadClaim, all: ThreadClaim[]): ThreadClaim {
  let cur = claim;
  const seen = new Set<string>();
  while (cur.parent_claim_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = all.find((c) => c.id === cur.parent_claim_id);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

export function getThread(claim: ThreadClaim, all: ThreadClaim[]): ThreadClaim[] {
  const root = getRootClaim(claim, all);
  const out: ThreadClaim[] = [root];
  const queue = [root];
  while (queue.length) {
    const node = queue.shift()!;
    const kids = all
      .filter((c) => c.parent_claim_id === node.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const k of kids) {
      out.push(k);
      queue.push(k);
    }
  }
  return out;
}

export function countResolvedItems(root: ThreadClaim) {
  const total = root.items.length;
  const resolved = root.items.filter((i) => i.status === "Paid/Done").length;
  return { resolved, total };
}

export function findResolvingItem(
  originalItemId: string,
  all: ThreadClaim[],
): { item: ThreadItem; claim: ThreadClaim } | null {
  for (const c of all) {
    const it = c.items.find((i) => i.linked_to_original_item_id === originalItemId);
    if (it) return { item: it, claim: c };
  }
  return null;
}

export function submissionIndexInThread(claim: ThreadClaim, thread: ThreadClaim[]) {
  return thread.findIndex((c) => c.id === claim.id) + 1; // 1-indexed
}

export function isUnresolved(s: ItemStatus) {
  return s !== "Paid/Done";
}

export function getChildClaims(claim: ThreadClaim, all: ThreadClaim[]): ThreadClaim[] {
  return all.filter((c) => c.parent_claim_id === claim.id);
}

const HCPC_TO_PRODUCT: Record<string, string> = {
  A4230: "Infusion Sets",
  A4232: "Cartridges",
  A4239: "CGM Sensors",
  E0784: "Insulin Pump",
  E2103: "CGM Monitor",
};
export function productLabelForHcpc(hcpc: string): string {
  return HCPC_TO_PRODUCT[hcpc] ?? hcpc;
}

// Map a Claim row (from useAllClaims) to its ThreadClaim equivalent.
//
// Match priority:
//   1. Monday item id when both sides have one — this is unique by
//      construction, the only correct match for real data.
//   2. Patient name + payer + DOS — legacy fallback for mock claims
//      that don't carry a Monday item id (purely local data).
//
// Why this matters: a patient can have MULTIPLE distinct claims on the
// same DOS (separate products billed to the same payer that day, or
// the same products billed to different payers, etc.). Karen Oliver's
// 2026-05-22 case was the canonical example — pump claim with no
// parent_claim_id was getting threaded into the unrelated infusion-set
// claim's history just because the (name, payer, DOS) tuple matched.
// Matching by mondayItemId removes that collision.
export function findThreadClaimForMockClaim(
  mock: {
    patientName: string;
    primaryPayor: string;
    dos: string;
    mondayItemId?: string;
  },
  threadClaims: ThreadClaim[],
): ThreadClaim | null {
  // Priority 1: Monday item id. Unique, unambiguous, the right answer
  // for any claim sourced from Monday.
  if (mock.mondayItemId) {
    const byId = threadClaims.find((t) => t.monday_item_id === mock.mondayItemId);
    if (byId) return byId;
  }
  // Priority 2: name + payer + DOS. Kept for mock/dev data without a
  // Monday id. Real-data callers that pass mondayItemId never hit this
  // path so the Karen Oliver collision is gone.
  const dos = mock.dos?.slice(0, 10);
  return (
    threadClaims.find(
      (t) =>
        t.patient.name === mock.patientName &&
        t.payer === mock.primaryPayor &&
        t.dos === dos,
    ) ?? null
  );
}

// Pure factory for follow-up creation.
export function createFollowUp(
  parent: ThreadClaim,
  opts: { type: ThreadClaimType; idSeed?: string },
): { updatedParent: ThreadClaim; newClaim: ThreadClaim } {
  const seed = opts.idSeed ?? `c_${Date.now()}`;
  const unresolved = parent.items.filter((i) => isUnresolved(i.status));
  const newItems: ThreadItem[] = unresolved.map((i, idx) => ({
    id: `${seed}_i${idx}`,
    hcpc: i.hcpc,
    modifiers: [...i.modifiers],
    qty: i.qty,
    charge: i.charge,
    est_pay: i.est_pay,
    status: "Pending",
    linked_to_original_item_id: i.id,
  }));
  const newClaim: ThreadClaim = {
    id: seed,
    type: opts.type,
    status: "Awaiting Submission",
    patient: { ...parent.patient },
    payer: parent.payer,
    diagnosis: parent.diagnosis,
    dos: parent.dos,
    parent_claim_id: parent.id,
    items: newItems,
    createdAt: Date.now(),
  };
  const updatedParent: ThreadClaim = {
    ...parent,
    items: parent.items.map((i) =>
      isUnresolved(i.status) ? { ...i, status: "Pending Follow-up" as ItemStatus } : i,
    ),
  };
  return { updatedParent, newClaim };
}

// ---------- seed ----------

export const SAMPLE_THREAD_CLAIMS: ThreadClaim[] = [
  {
    id: "claim_001",
    type: "Original",
    status: "Partially Paid",
    patient: { name: "Maria Gonzalez (TEST)", dob: "1985-04-12", member_id: "UHC55443" },
    payer: "United Healthcare",
    diagnosis: "E11.9",
    dos: "2026-03-15",
    icn: "ABC123",
    createdAt: Date.now() - 1_000_000,
    items: [
      { id: "item_001a", hcpc: "E0784", modifiers: ["NU"], qty: 1, charge: 4500, est_pay: 850, status: "Paid/Done", paid_amount: 850 },
      { id: "item_001b", hcpc: "A4232", modifiers: [], qty: 30, charge: 80, est_pay: 30, status: "Paid/Done", paid_amount: 30 },
      { id: "item_001c", hcpc: "A4230", modifiers: [], qty: 30, charge: 200, est_pay: 100, status: "Paid/Done", paid_amount: 100 },
      { id: "item_001d", hcpc: "A4239", modifiers: [], qty: 3, charge: 200, est_pay: 100, status: "Pending Follow-up", paid_amount: 0, carc_codes: "CO-197", rarc_codes: "N575", denial_bucket: "No Auth" },
      { id: "item_001e", hcpc: "E2103", modifiers: [], qty: 1, charge: 300, est_pay: 150, status: "Pending Follow-up", paid_amount: 150, carc_codes: "CO-45", rarc_codes: "", denial_bucket: "Underpaid" },
    ],
  },
  {
    id: "claim_002",
    type: "Corrected",
    status: "Submitted",
    patient: { name: "Maria Gonzalez (TEST)", dob: "1985-04-12", member_id: "UHC55443" },
    payer: "United Healthcare",
    diagnosis: "E11.9",
    dos: "2026-03-28",
    icn: "UHC-2026-0421-77B",
    parent_claim_id: "claim_001",
    createdAt: Date.now() - 500_000,
    items: [
      { id: "item_002a", hcpc: "A4239", modifiers: ["KX"], qty: 3, charge: 200, est_pay: 100, status: "Paid/Done", paid_amount: 100, linked_to_original_item_id: "item_001d" },
      { id: "item_002b", hcpc: "E2103", modifiers: ["KX"], qty: 1, charge: 300, est_pay: 150, status: "Pending Follow-up", paid_amount: 200, carc_codes: "CO-45", denial_bucket: "Underpaid", linked_to_original_item_id: "item_001e" },
    ],
  },
  {
    id: "claim_002b",
    type: "Corrected",
    status: "Awaiting Submission",
    patient: { name: "Maria Gonzalez (TEST)", dob: "1985-04-12", member_id: "UHC55443" },
    payer: "United Healthcare",
    diagnosis: "E11.9",
    dos: "2026-04-10",
    parent_claim_id: "claim_002",
    createdAt: Date.now() - 100_000,
    items: [
      { id: "item_002b1", hcpc: "E2103", modifiers: ["KX", "NU"], qty: 1, charge: 300, est_pay: 100, status: "Pending", linked_to_original_item_id: "item_002b" },
    ],
  },
  {
    id: "claim_003",
    type: "Original",
    status: "Awaiting Submission",
    patient: { name: "John Smith (TEST)", dob: "1972-09-03", member_id: "AET99887" },
    payer: "Aetna",
    diagnosis: "E10.9",
    dos: "2026-04-01",
    createdAt: Date.now() - 200_000,
    items: [
      { id: "item_003a", hcpc: "E0784", modifiers: ["NU"], qty: 1, charge: 4500, est_pay: 1000, status: "Pending" },
    ],
  },
  {
    id: "claim_004",
    type: "Original",
    status: "Awaiting Submission",
    patient: { name: "Priya Patel (TEST)", dob: "1990-01-22", member_id: "ANTHM7766" },
    payer: "Anthem BCBS Co.",
    diagnosis: "E10.65",
    dos: "2026-04-05",
    createdAt: Date.now() - 100_000,
    items: [
      { id: "item_004a", hcpc: "A4239", modifiers: ["KX"], qty: 3, charge: 312, est_pay: 248, status: "Pending" },
      { id: "item_004b", hcpc: "A4232", modifiers: ["KX", "NU"], qty: 10, charge: 95, est_pay: 72, status: "Pending" },
    ],
  },
  // ---- David Chen: deep thread (Original -> Corrected #1 -> Corrected #2 -> Corrected #3 awaiting) ----
  {
    id: "claim_005",
    type: "Original",
    status: "Partially Paid",
    patient: { name: "David Chen (TEST)", dob: "1968-11-30", member_id: "CIG44221" },
    payer: "Cigna",
    diagnosis: "E11.65",
    dos: "2026-02-01",
    icn: "CIG-2026-0202-11A",
    createdAt: Date.now() - 4_000_000,
    items: [
      { id: "item_005a", hcpc: "E0784", modifiers: ["NU"], qty: 1, charge: 4500, est_pay: 900, status: "Paid/Done", paid_amount: 900 },
      { id: "item_005b", hcpc: "A4230", modifiers: [], qty: 30, charge: 200, est_pay: 100, status: "Paid/Done", paid_amount: 100 },
      { id: "item_005c", hcpc: "A4232", modifiers: [], qty: 30, charge: 80, est_pay: 30, status: "Pending Follow-up", paid_amount: 0, carc_codes: "CO-16", rarc_codes: "M76", denial_bucket: "Missing Info" },
      { id: "item_005d", hcpc: "A4239", modifiers: [], qty: 3, charge: 312, est_pay: 248, status: "Pending Follow-up", paid_amount: 0, carc_codes: "CO-197", rarc_codes: "N575", denial_bucket: "No Auth" },
      { id: "item_005e", hcpc: "E2103", modifiers: [], qty: 1, charge: 300, est_pay: 150, status: "Pending Follow-up", paid_amount: 50, carc_codes: "CO-45", denial_bucket: "Underpaid" },
    ],
  },
  {
    id: "claim_006",
    type: "Corrected",
    status: "Partially Paid",
    patient: { name: "David Chen (TEST)", dob: "1968-11-30", member_id: "CIG44221" },
    payer: "Cigna",
    diagnosis: "E11.65",
    dos: "2026-02-20",
    icn: "CIG-2026-0301-22B",
    parent_claim_id: "claim_005",
    createdAt: Date.now() - 3_000_000,
    items: [
      { id: "item_006a", hcpc: "A4232", modifiers: ["KX"], qty: 30, charge: 80, est_pay: 30, status: "Paid/Done", paid_amount: 30, linked_to_original_item_id: "item_005c" },
      { id: "item_006b", hcpc: "A4239", modifiers: ["KX"], qty: 3, charge: 312, est_pay: 248, status: "Pending Follow-up", paid_amount: 0, carc_codes: "CO-197", rarc_codes: "N575", denial_bucket: "No Auth", linked_to_original_item_id: "item_005d" },
      { id: "item_006c", hcpc: "E2103", modifiers: ["KX"], qty: 1, charge: 300, est_pay: 150, status: "Pending Follow-up", paid_amount: 100, carc_codes: "CO-45", denial_bucket: "Underpaid", linked_to_original_item_id: "item_005e" },
    ],
  },
  {
    id: "claim_007",
    type: "Corrected",
    status: "Partially Paid",
    patient: { name: "David Chen (TEST)", dob: "1968-11-30", member_id: "CIG44221" },
    payer: "Cigna",
    diagnosis: "E11.65",
    dos: "2026-03-12",
    icn: "CIG-2026-0320-33C",
    parent_claim_id: "claim_006",
    createdAt: Date.now() - 2_000_000,
    items: [
      { id: "item_007a", hcpc: "A4239", modifiers: ["KX", "NU"], qty: 3, charge: 312, est_pay: 248, status: "Paid/Done", paid_amount: 248, linked_to_original_item_id: "item_006b" },
      { id: "item_007b", hcpc: "E2103", modifiers: ["KX", "NU"], qty: 1, charge: 300, est_pay: 150, status: "Pending Follow-up", paid_amount: 130, carc_codes: "CO-45", denial_bucket: "Underpaid", linked_to_original_item_id: "item_006c" },
    ],
  },
  {
    id: "claim_008",
    type: "Corrected",
    status: "Awaiting Submission",
    patient: { name: "David Chen (TEST)", dob: "1968-11-30", member_id: "CIG44221" },
    payer: "Cigna",
    diagnosis: "E11.65",
    dos: "2026-04-08",
    parent_claim_id: "claim_007",
    createdAt: Date.now() - 50_000,
    items: [
      { id: "item_008a", hcpc: "E2103", modifiers: ["KX", "NU"], qty: 1, charge: 300, est_pay: 20, status: "Pending", linked_to_original_item_id: "item_007b" },
    ],
  },
];
