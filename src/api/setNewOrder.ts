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
import type { NewOrderRow } from "./queries/newOrders";
import { ORDER_PRODUCT_COL } from "@/lib/subscription/orderProductOptions";

const NEW_ORDER_BOARD_ID = "18405457690";
const ORDER_GROUP_ID = "group_mm18v6n3";
const COL_QTY_MONITOR = "numeric_mm1s431c";
const COL_MONITOR_AUTH = "text_mm1snsw3";

/** New Order Board column ids used when copying an order (verified 2026-09-20). */
const COL = {
  order_date:        "date_mm1ssf5g",
  pos:               "color_mm3rfpkt",
  ddp_order:         "color_mm5pn3k1",
  ship_method:       "color_mm3zsyhm",
  order_type:        "color_mm1s96z2",
  order_frequency:   "color_mm1s8tz0",
  subscription_type: "color_mm18h05q",
  primary_insurance: "color_mm18jhq5",
  member_id:         "text_mm18s3fe",
  dob:               "text_mm187t6a",
  patient_address:   "location_mm187v29",
  monitor_auth_id:   "text_mm1snsw3",
  sensors_auth_id:   "text_mm28c4xs",
  pump_auth_id:      "text_mm28nex8",
  infusion_set_auth_id: "text_mm281vjp",
  cartridges_auth_id:   "text_mm28kdfj",
} as const;

/** The DDP Order status label, verbatim from the board (it is "DDP Order"). */
const DDP_LABEL = "DDP Order";

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

/**
 * Place an order: flip Order Status → "Ordered", or → "Process Claim" for a
 * DDP order (it's submitted manually through DDP, not through Cardinal — so it
 * must not read "Ordered"). Brandon, 2026-09-20.
 */
export async function placeOrder(itemId: string, opts?: { ddp?: boolean }): Promise<void> {
  await mondayQuery(SET_STATUS, { board: NEW_ORDER_BOARD_ID, item: itemId, val: opts?.ddp ? "Process Claim" : "Ordered" });
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

/** Place of service — toggle Office ↔ Home on an order row. */
export async function setOrderPos(itemId: string, pos: "Office" | "Home"): Promise<void> {
  await mondayQuery(SET_SIMPLE, { board: NEW_ORDER_BOARD_ID, item: itemId, col: COL.pos, val: pos });
}

/** Mark / unmark an order as DDP (the label on the board is "DDP Order"). */
export async function setOrderDdp(itemId: string, on: boolean): Promise<void> {
  await mondayQuery(SET_SIMPLE, { board: NEW_ORDER_BOARD_ID, item: itemId, col: COL.ddp_order, val: on ? DDP_LABEL : "" });
}

/** The editable product fields shared by the order editor and Create Order. */
export interface OrderProducts {
  cgmType: string; qtyCgmSensors: string; qtyCgmMonitor: string;
  pumpType: string; qtyPump: string;
  cartridgeType: string; qtyCartridge: string;
  infusionSet1Type: string; qtyInfusionSet1: string;
  infusionSet2Type: string; qtyInfusionSet2: string;
}

const labelVal = (v: string) => (v.trim() ? { label: v.trim() } : undefined);
const numAny = (v: string) => { const s = String(v).trim(); if (!s) return undefined; const n = Number(s.replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : undefined; };
const numPos = (v: string) => { const n = numAny(v); return n !== undefined && n > 0 ? n : undefined; };
const textVal = (v: string) => (v.trim() ? v.trim() : undefined);

/** Build the product column_values (types as labels, qtys as numbers). When
 *  `includeZero` is false, 0/blank qtys and blank types are skipped. */
function productVals(p: OrderProducts, includeZero: boolean): Record<string, unknown> {
  const q = includeZero ? numAny : numPos;
  const v: Record<string, unknown> = {};
  const put = (col: string, val: unknown) => { if (val !== undefined) v[col] = val; };
  put(ORDER_PRODUCT_COL.cgmType, labelVal(p.cgmType));
  put(ORDER_PRODUCT_COL.qtyCgmSensors, q(p.qtyCgmSensors));
  put(ORDER_PRODUCT_COL.qtyCgmMonitor, q(p.qtyCgmMonitor));
  put(ORDER_PRODUCT_COL.pumpType, labelVal(p.pumpType));
  put(ORDER_PRODUCT_COL.qtyPump, q(p.qtyPump));
  put(ORDER_PRODUCT_COL.cartridgeType, labelVal(p.cartridgeType));
  put(ORDER_PRODUCT_COL.qtyCartridge, q(p.qtyCartridge));
  put(ORDER_PRODUCT_COL.infusionSet1Type, labelVal(p.infusionSet1Type));
  put(ORDER_PRODUCT_COL.qtyInfusionSet1, q(p.qtyInfusionSet1));
  put(ORDER_PRODUCT_COL.infusionSet2Type, labelVal(p.infusionSet2Type));
  put(ORDER_PRODUCT_COL.qtyInfusionSet2, q(p.qtyInfusionSet2));
  return v;
}

/** Edit the products/quantities on an existing order row (rare, but happens). */
export async function updateOrderProducts(itemId: string, p: OrderProducts): Promise<void> {
  const vals = productVals(p, true);
  await mondayQuery(SET_COLS, { board: NEW_ORDER_BOARD_ID, item: itemId, vals: JSON.stringify(vals) });
}

const CREATE_ITEM = `
  mutation CreateOrder($board: ID!, $group: String!, $name: String!, $vals: JSON!) {
    create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $vals) { id }
  }
`;

/**
 * Create a new order in the Order group by duplicating a patient's last order:
 * copy the patient / insurance / auth / order fields, take the products from
 * the dialog (default = the last order), set the order date + status = "Order",
 * and leave every Cardinal / fulfilment column blank so the fresh order runs
 * the pre-check clean (Brandon, 2026-09-20). Returns the new item id.
 */
export async function createOrderFromLast(source: NewOrderRow, products: OrderProducts, orderDateIso: string): Promise<string> {
  const vals: Record<string, unknown> = { ...productVals(products, false) };
  const put = (col: string, val: unknown) => { if (val !== undefined) vals[col] = val; };
  put("status", { label: "Order" });
  if (/^\d{4}-\d{2}-\d{2}$/.test(orderDateIso)) put(COL.order_date, { date: orderDateIso });
  put(COL.order_type, labelVal(source.orderType || "Reorder"));
  put(COL.order_frequency, labelVal(source.orderFrequency));
  put(COL.subscription_type, labelVal(source.subscriptionType));
  put(COL.pos, labelVal(source.pos));
  put(COL.ship_method, labelVal(source.shipMethod));
  put(COL.primary_insurance, labelVal(source.primaryInsurance));
  put(COL.member_id, textVal(source.memberId));
  put(COL.dob, textVal(source.dob));
  put(COL.monitor_auth_id, textVal(source.monitorAuthId));
  put(COL.sensors_auth_id, textVal(source.sensorsAuthId));
  put(COL.pump_auth_id, textVal(source.pumpAuthId));
  put(COL.infusion_set_auth_id, textVal(source.infusionSetAuthId));
  put(COL.cartridges_auth_id, textVal(source.cartridgesAuthId));

  const r = await mondayQuery<{ create_item: { id: string } }>(CREATE_ITEM, {
    board: NEW_ORDER_BOARD_ID, group: ORDER_GROUP_ID, name: source.name, vals: JSON.stringify(vals),
  });
  const newId = r.create_item.id;
  // Location column is written as a plain address string (same as the profile).
  if (source.patientAddress.trim()) {
    await mondayQuery(SET_SIMPLE, { board: NEW_ORDER_BOARD_ID, item: newId, col: COL.patient_address, val: source.patientAddress.trim() });
  }
  return newId;
}
