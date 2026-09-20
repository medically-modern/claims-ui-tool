/**
 * setNewOrder.ts — writes to the New Order Board (18405457690).
 *
 * mergeMonitorIntoSensors: a monitor sometimes lands as its own order when it
 * should ride with the patient's sensors order. This moves the monitor qty and
 * auth ID onto the sensors row and deletes the monitor row — the manual
 * "move it in Monday and delete the extra" step, one click (Brandon,
 * 2026-09-20).
 */
import { mondayQuery } from "./monday";

const NEW_ORDER_BOARD_ID = "18405457690";
const COL_QTY_MONITOR = "numeric_mm1s431c";
const COL_MONITOR_AUTH = "text_mm1snsw3";

const SET_COLS = `
  mutation SetNewOrder($board: ID!, $item: ID!, $vals: JSON!) {
    change_multiple_column_values(board_id: $board, item_id: $item, column_values: $vals) { id }
  }
`;
const DELETE_ITEM = `mutation DeleteItem($item: ID!) { delete_item(item_id: $item) { id } }`;

export async function mergeMonitorIntoSensors(opts: {
  monitorItemId: string;
  sensorsItemId: string;
  monitorQty: string;
  monitorAuthId: string;
}): Promise<void> {
  const vals: Record<string, unknown> = {};
  const qty = Number(String(opts.monitorQty).replace(/[^\d.-]/g, ""));
  if (Number.isFinite(qty) && qty > 0) vals[COL_QTY_MONITOR] = qty;
  if (opts.monitorAuthId.trim()) vals[COL_MONITOR_AUTH] = opts.monitorAuthId.trim();
  // 1) copy monitor qty + auth onto the sensors order
  await mondayQuery(SET_COLS, { board: NEW_ORDER_BOARD_ID, item: opts.sensorsItemId, vals: JSON.stringify(vals) });
  // 2) delete the now-redundant monitor-only order
  await mondayQuery(DELETE_ITEM, { item: opts.monitorItemId });
}

const SET_STATUS = `
  mutation SetOrderStatus($board: ID!, $item: ID!, $val: String!) {
    change_simple_column_value(board_id: $board, item_id: $item, column_id: "status", value: $val) { id }
  }
`;

/** Flip a New Order Board row's Order Status → "Ordered". */
export async function markOrdered(itemId: string): Promise<void> {
  await mondayQuery(SET_STATUS, { board: NEW_ORDER_BOARD_ID, item: itemId, val: "Ordered" });
}

const COL_PATIENT_ADDRESS = "location_mm187v29";
const SET_SIMPLE = `
  mutation SetSimpleCol($board: ID!, $item: ID!, $col: String!, $val: String!) {
    change_simple_column_value(board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
  }
`;

/**
 * After an address is fixed on the patient profile (Subscription Board): copy
 * the corrected address onto the patient's open Order-group row, then blank the
 * status and set it back to "Order" so the Monday pre-check automation re-runs
 * (Brandon, 2026-09-20).
 */
export async function fixOrderAddressAndRecheck(itemId: string, address: string): Promise<void> {
  await mondayQuery(SET_SIMPLE, { board: NEW_ORDER_BOARD_ID, item: itemId, col: COL_PATIENT_ADDRESS, val: address });
  // Blank → Order forces a change event even if the status was already "Order".
  await mondayQuery(SET_STATUS, { board: NEW_ORDER_BOARD_ID, item: itemId, val: "" });
  await mondayQuery(SET_STATUS, { board: NEW_ORDER_BOARD_ID, item: itemId, val: "Order" });
}
