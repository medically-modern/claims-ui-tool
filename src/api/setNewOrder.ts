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
