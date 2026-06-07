/**
 * setSubscriptionPatient.ts — writes for the Subscription Board.
 *
 * One column at a time via change_simple_column_value (text columns,
 * dates, dropdowns) or change_column_value (status columns, file
 * columns). saveSubscriptionPatient(itemId, patch) takes a partial
 * object of field changes, fans out the appropriate Monday writes in
 * parallel, returns success/failure summary.
 */

import { mondayQuery } from "./monday";
import { SUB_COL, SUBSCRIPTION_BOARD_ID } from "./queries/subscriptionPatients";

const SIMPLE_MUT = `
  mutation SetSimple($itemId: ID!, $boardId: ID!, $columnId: String!, $value: String!) {
    change_simple_column_value(
      item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value
    ) { id }
  }
`;
const STATUS_MUT = `
  mutation SetStatus($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(
      item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value
    ) { id }
  }
`;

async function writeSimple(itemId: string, columnId: string, value: string) {
  await mondayQuery(SIMPLE_MUT, {
    itemId, boardId: String(SUBSCRIPTION_BOARD_ID), columnId, value,
  });
}
async function writeStatus(itemId: string, columnId: string, label: string) {
  await mondayQuery(STATUS_MUT, {
    itemId, boardId: String(SUBSCRIPTION_BOARD_ID), columnId,
    value: JSON.stringify(label ? { label } : {}),
  });
}

/**
 * Field-to-column registry. Each entry knows what Monday column id
 * to write and whether to use simple (text/date/numeric) or status
 * (color/dropdown) mutation.
 */
type Field = {
  col: string;
  mut: "simple" | "status";
};
const FIELD_MAP: Record<string, Field> = {
  // Demographics
  name:                 { col: "name", mut: "simple" }, // name is special-cased below
  dob:                  { col: SUB_COL.dob, mut: "simple" },
  gender:               { col: SUB_COL.gender, mut: "status" },
  phone:                { col: SUB_COL.phone, mut: "simple" },
  email:                { col: SUB_COL.email, mut: "simple" },
  address:              { col: SUB_COL.patient_address, mut: "simple" },
  // Order / Subscription
  subscriptionType:     { col: SUB_COL.subscription, mut: "status" },
  nextOrderDate:        { col: SUB_COL.next_order, mut: "simple" },
  sensorsType:          { col: SUB_COL.sensors_type, mut: "status" },
  suppliesType:         { col: SUB_COL.supplies_type, mut: "status" },
  infusionSet1:         { col: SUB_COL.inf_set_1, mut: "status" },
  infusionSet1Qty:      { col: SUB_COL.inf_qty_1, mut: "simple" },
  infusionSet2:         { col: SUB_COL.inf_set_2, mut: "status" },
  infusionSet2Qty:      { col: SUB_COL.inf_qty_2, mut: "simple" },
  orderingCycle:        { col: SUB_COL.ordering_cycle, mut: "status" },
  // Insurance
  primaryInsurance:     { col: SUB_COL.primary_insurance, mut: "status" },
  memberId1:            { col: SUB_COL.member_id_1, mut: "simple" },
  secondaryInsurance:   { col: SUB_COL.secondary_insurance, mut: "status" },
  memberId2:            { col: SUB_COL.member_id_2, mut: "simple" },
  // Doctor
  doctorName:           { col: SUB_COL.doctor, mut: "simple" },
  doctorNpi:            { col: SUB_COL.npi, mut: "simple" },
  doctorAddress:        { col: SUB_COL.doctor_address, mut: "simple" },
  doctorPhone:          { col: SUB_COL.doctor_phone, mut: "simple" },
  doctorFax:            { col: SUB_COL.doctor_fax, mut: "simple" },
  clinicalsMethod:      { col: SUB_COL.fax_parachute, mut: "status" },
  // Status & flags
  status:               { col: SUB_COL.status, mut: "status" },
  pauseReason:          { col: SUB_COL.pause_reason, mut: "status" },
  deadReason:           { col: SUB_COL.dead_reason, mut: "status" },
  // Clinical
  diagnosis:            { col: SUB_COL.diagnosis, mut: "status" },
  mnExpiry:             { col: SUB_COL.mn_expiry, mut: "simple" },
  // Auth
  sensorsAuthStatus:    { col: SUB_COL.sensors_auth_status, mut: "status" },
  sensorsAuthId:        { col: SUB_COL.sensors_auth_id, mut: "simple" },
  sensorsAuthStart:     { col: SUB_COL.sensors_auth_start, mut: "simple" },
  sensorsAuthEnd:       { col: SUB_COL.sensors_auth_end, mut: "simple" },
  sensorsAuthUnits:     { col: SUB_COL.sensors_units, mut: "simple" },
  suppliesAuthStatus:   { col: SUB_COL.supplies_auth_status, mut: "status" },
  infusionAuthId:       { col: SUB_COL.inf_set_auth_id, mut: "simple" },
  cartridgeAuthId:      { col: SUB_COL.cartridge_auth_id, mut: "simple" },
  suppliesAuthStart:    { col: SUB_COL.supplies_auth_start, mut: "simple" },
  suppliesAuthEnd:      { col: SUB_COL.supplies_auth_end, mut: "simple" },
  suppliesAuthUnits:    { col: SUB_COL.supplies_units, mut: "simple" },
  priorAuthReq:         { col: SUB_COL.prior_auth_req, mut: "status" },
  triggerDvs:           { col: SUB_COL.trigger_dvs, mut: "status" },
};

const NAME_MUT = `
  mutation Rename($itemId: ID!, $boardId: ID!, $name: String!) {
    change_simple_column_value(
      item_id: $itemId, board_id: $boardId, column_id: "name", value: $name
    ) { id }
  }
`;

export interface SaveSummary {
  ok: string[];
  failed: Array<{ field: string; error: string }>;
}

/**
 * Save a partial Patient Profile patch. Returns summary so the UI
 * can show which fields landed and which didn't.
 */
export async function saveSubscriptionPatient(
  mondayItemId: string,
  patch: Record<string, string>,
): Promise<SaveSummary> {
  const ok: string[] = [];
  const failed: SaveSummary["failed"] = [];

  const tasks = Object.entries(patch).map(async ([field, value]) => {
    try {
      if (field === "name") {
        await mondayQuery(NAME_MUT, {
          itemId: mondayItemId, boardId: String(SUBSCRIPTION_BOARD_ID), name: value,
        });
      } else {
        const cfg = FIELD_MAP[field];
        if (!cfg) throw new Error(`No Monday column wired for field '${field}'`);
        if (cfg.mut === "status") await writeStatus(mondayItemId, cfg.col, value);
        else                       await writeSimple(mondayItemId, cfg.col, value);
      }
      ok.push(field);
    } catch (e) {
      failed.push({ field, error: (e as Error).message });
    }
  });

  await Promise.allSettled(tasks);
  return { ok, failed };
}

/**
 * Flip the Run Check column to "Run". Monday automation /
 * stedi-monday-integration webhook then fires the eligibility check.
 * Used by the Run Eligibility Check button on Patient Profile.
 */
export async function runEligibilityCheck(mondayItemId: string): Promise<void> {
  await writeStatus(mondayItemId, "color_mm2nnjam", "Run");
}

/**
 * Flip Ordering Cycle to "Order" — the operator's final action on a
 * subscription row. Triggers Brandon's downstream Monday automation
 * that spawns the actual order on the Order Board (Stedi claim
 * pipeline + Monday claim row). After this, the row should leave
 * both the Order Prep tab and the Order tab and reappear when the
 * next reorder cycle starts.
 */
export async function sendToOrder(mondayItemId: string): Promise<void> {
  await writeStatus(mondayItemId, "color_mkyjawhq", "Order");
}
