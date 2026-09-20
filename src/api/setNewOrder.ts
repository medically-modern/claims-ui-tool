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
  doctor_address:    "location_mm18qfed",
  note:              "long_text_mm60y0ap",
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

const SET_SIMPLE = `
  mutation SetSimpleCol($board: ID!, $item: ID!, $col: String!, $val: String!) {
    change_simple_column_value(board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
  }
`;
const SET_JSON = `
  mutation SetJsonCol($board: ID!, $item: ID!, $col: String!, $val: JSON!) {
    change_column_value(board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
  }
`;
const READ_ITEM_COL = `query ReadNoCol($itemId: [ID!], $colId: [String!]) { items(ids: $itemId) { column_values(ids: $colId) { id value } } }`;

/** Existing lat/lng on a location column, so an address reformat keeps the place. */
async function readCoords(itemId: string, colId: string): Promise<{ lat?: string; lng?: string }> {
  try {
    const r = await mondayQuery<{ items: Array<{ column_values: Array<{ id: string; value: string | null }> }> }>(
      READ_ITEM_COL, { itemId: [itemId], colId: [colId] });
    const raw = r?.items?.[0]?.column_values?.[0]?.value;
    if (raw) { const v = JSON.parse(raw); if (v?.lat != null && v?.lng != null) return { lat: String(v.lat), lng: String(v.lng) }; }
  } catch { /* no coords available */ }
  return {};
}
/** A Monday location value ({lat,lng,address}); coords omitted if unknown. */
function locationValue(address: string, coords: { lat?: string; lng?: string }): Record<string, unknown> {
  const v: Record<string, unknown> = { address };
  if (coords.lat && coords.lng) { v.lat = coords.lat; v.lng = coords.lng; }
  return v;
}

async function writeLocation(itemId: string, colId: string, address: string): Promise<void> {
  // Keep the row's existing coordinates (same place, cleaner text); a location
  // column rejects a bare string.
  const coords = await readCoords(itemId, colId);
  await mondayQuery(SET_JSON, { board: NEW_ORDER_BOARD_ID, item: itemId, col: colId, val: JSON.stringify(locationValue(address, coords)) });
}

/**
 * After an address is fixed on the patient profile (Subscription Board): copy
 * whichever address(es) changed onto the patient's open Order-group row, then
 * blank the status and set it back to "Order" so the Monday pre-check re-runs
 * (Brandon, 2026-09-20). Patient and/or doctor.
 */
export async function syncOrderAddresses(itemId: string, addr: { patient?: string; doctor?: string }): Promise<void> {
  if (addr.patient != null) await writeLocation(itemId, COL.patient_address, addr.patient);
  if (addr.doctor != null) await writeLocation(itemId, COL.doctor_address, addr.doctor);
  // Blank → Order forces a change event even if the status was already "Order".
  await mondayQuery(SET_STATUS, { board: NEW_ORDER_BOARD_ID, item: itemId, val: "" });
  await mondayQuery(SET_STATUS, { board: NEW_ORDER_BOARD_ID, item: itemId, val: "Order" });
}

/** Place of service — set Office / Home on an order row. */
export async function setOrderPos(itemId: string, pos: "Office" | "Home"): Promise<void> {
  await mondayQuery(SET_SIMPLE, { board: NEW_ORDER_BOARD_ID, item: itemId, col: COL.pos, val: pos });
}

/** Ship Method — one of the board's Ship Method status labels. */
export async function setOrderShipMethod(itemId: string, label: string): Promise<void> {
  await mondayQuery(SET_SIMPLE, { board: NEW_ORDER_BOARD_ID, item: itemId, col: COL.ship_method, val: label });
}

/** Order Status — set any status label (e.g. On Hold → Order). */
export async function setOrderStatusLabel(itemId: string, label: string): Promise<void> {
  await mondayQuery(SET_STATUS, { board: NEW_ORDER_BOARD_ID, item: itemId, val: label });
}

/** Order Date — a plain YYYY-MM-DD written to the date column. */
export async function setOrderDate(itemId: string, iso: string): Promise<void> {
  await mondayQuery(SET_SIMPLE, { board: NEW_ORDER_BOARD_ID, item: itemId, col: COL.order_date, val: iso });
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

const READ_ALL_COLS = `query ReadAll($itemId: [ID!]) { items(ids: $itemId) { column_values { id type value } } }`;

// Column types we never copy (read-only / computed / structural).
const NONWRITABLE_TYPES = new Set(["name", "subtasks", "item_id", "file", "formula", "mirror", "auto_number", "creation_log", "last_updated", "button", "doc", "dependency", "progress", "integration"]);

// The Cardinal / fulfilment "right side" + pre-check + fields we override —
// left blank on a fresh order so the pre-check runs clean (verified 2026-09-20).
const CLONE_EXCLUDE = new Set<string>([
  "status", COL.order_date, COL.note, COL.subscription_type, COL.ddp_order,
  // products (set from the dialog)
  ...Object.values(ORDER_PRODUCT_COL),
  // pre-check
  "color_mm5bh2az", "long_text_mm5byhdp",
  // Cardinal / fulfilment / invoices / tracking / substitution
  "color_mm3zm9hm", "text_mm3zcde7", "dropdown_mm4wdmdd", "numeric_mm3zyqz4",
  "color_mm727jnp", "color_mm727p5m", "text_mm5xc3zg", "dropdown_mm4waxqn",
  "color_mm3zw2eh", "date_mm3zhxq0", "numeric_mm3zh1wx", "text_mm3z3vc1",
  "text_mm3zaepp", "text_mm3za3mt", "date_mm3zyb66", "date_mm3zvmqq",
  "long_text_mm4c86p0", "text_mm3z39yt", "text_mm4cd2zq", "text_mm4cxcsc",
  "text_mm5rwpdb", "text_mm5r8yv8", "date_mm3z9258", "text_mm3zpppq",
  "text_mm486hh7", "text_mm4ds1hw", "text_mm3z47x2", "text_mm3zf5ev",
  "long_text_mm489t0z", "long_text_mm483yt2", "text_mm481jys", "long_text_mm48ww67",
  "color_mm4ct49j", "text_mm4cm2d6", "date_mm4czm9y", "numeric_mm4cx7e",
  "numeric_mm4cew2k", "numeric_mm4c3afm", "text_mm4cp772", "numeric_mm4c9wez",
  "text_mm4cym7", "text_mm4cyzd3", "text_mm4czd9g", "text_mm5b2pf7",
  "text_mm5jedj2", "text_mm72pa1b",
]);

/** Reduce a read column value to the shape create_item accepts, or skip it. */
function cloneVal(type: string, raw: string | null): unknown {
  if (raw == null) return undefined;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return undefined; }
  if (v == null || v === "") return undefined;
  const o = v as Record<string, unknown>;
  switch (type) {
    case "text": return typeof v === "string" ? v : undefined;
    case "long_text": return { text: typeof v === "string" ? v : String(o.text ?? "") };
    case "numbers": return (typeof v === "string" || typeof v === "number") ? String(v) : undefined;
    case "status": return o.index != null ? { index: o.index } : (o.label ? { label: o.label } : undefined);
    case "dropdown": return Array.isArray(o.ids) && o.ids.length ? { ids: o.ids } : undefined;
    case "date": return o.date ? { date: o.date } : undefined;
    case "location": return o.address ? { lat: o.lat != null ? String(o.lat) : undefined, lng: o.lng != null ? String(o.lng) : undefined, address: o.address } : undefined;
    case "phone": return o.phone ? { phone: o.phone, countryShortName: o.countryShortName || "US" } : undefined;
    case "email": return o.email ? { email: o.email, text: o.text || o.email } : undefined;
    default: return undefined;
  }
}

/**
 * Create a new order by DUPLICATING a patient's last order: read every column
 * on the source, copy all the patient/clinical/order-config columns verbatim,
 * skip the Cardinal / fulfilment columns and the pre-check (so the fresh order
 * re-runs clean), and override products, order date, subscription type, status
 * and the note. This is the manual "duplicate the row, clear the right side,
 * adjust" step, one call (Brandon, 2026-09-20). Returns the new item id.
 */
export async function createDuplicateOrder(source: NewOrderRow, opts: {
  products: OrderProducts; orderDateIso: string; subscriptionType?: string; note?: string;
}): Promise<string> {
  const vals: Record<string, unknown> = {};
  // 1) copy everything writable that we're not overriding
  try {
    const r = await mondayQuery<{ items: Array<{ column_values: Array<{ id: string; type: string; value: string | null }> }> }>(
      READ_ALL_COLS, { itemId: [source.id] });
    for (const cv of r?.items?.[0]?.column_values ?? []) {
      if (NONWRITABLE_TYPES.has(cv.type) || CLONE_EXCLUDE.has(cv.id)) continue;
      const val = cloneVal(cv.type, cv.value);
      if (val !== undefined) vals[cv.id] = val;
    }
  } catch { /* fall through — worst case a thinner copy, pre-check will flag */ }
  // 2) overrides
  Object.assign(vals, productVals(opts.products, false));
  vals["status"] = { label: "Order" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(opts.orderDateIso)) vals[COL.order_date] = { date: opts.orderDateIso };
  if (opts.subscriptionType?.trim()) vals[COL.subscription_type] = { label: opts.subscriptionType.trim() };
  vals[COL.note] = { text: opts.note?.trim() || "One-off order creation" };

  const r = await mondayQuery<{ create_item: { id: string } }>(CREATE_ITEM, {
    board: NEW_ORDER_BOARD_ID, group: ORDER_GROUP_ID, name: source.name, vals: JSON.stringify(vals),
  });
  return r.create_item.id;
}
