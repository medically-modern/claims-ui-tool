/**
 * src/api/queries/newOrders.ts — fetch live items from the New Order Board.
 *
 * Powers the new "Order" tab on the Subscription Board UI. The board
 * (18405457690) is where Brandon's downstream automation lands a row
 * after "Send Order" is clicked on a Subscription patient; this fetcher
 * pulls a focused projection of order details so the operator can see
 * what was actually ordered, in what quantity, and on what date.
 */
import { hasMondayToken, mondayQuery } from "@/api/monday";

const NEW_ORDER_BOARD_ID = "18405457690";
/** The "Order" group — the daily ordering flow. Returns / shipped / cancelled
 *  are other groups (verified 2026-09-20). */
export const ORDER_GROUP_ID = "group_mm18v6n3";
export const RETURNS_GROUP_ID = "group_mm60y5j7";
// Overview groups (verified 2026-09-20): the two post-send states an order
// moves through once Cardinal has it.
export const ACCEPTED_PARTIAL_GROUP_ID = "group_mm52gfr5";
export const SHIPPED_DELIVERED_GROUP_ID = "group_mm20m7gz";
export const CANCELLED_GROUP_ID = "group_mm77bjja";

// Verified 2026-06-07 via Monday API.
const COL = {
  order_date:           "date_mm1ssf5g",
  order_status:         "status",
  pre_check:            "color_mm5bh2az",
  pre_check_detail:     "long_text_mm5byhdp",
  pos:                  "color_mm3rfpkt",
  ship_method:          "color_mm3zsyhm",
  pump_type:            "color_mm1s45wm",
  cartridge_type:       "color_mm1szdck",
  infusion_set_1_type:  "color_mm1saxyg",
  infusion_set_2_type:  "color_mm1sp64",
  cgm_type:             "color_mm1sjy4y",
  qty_pump:             "numeric_mm1smjyx",
  qty_infusion_set_1:   "numeric_mm1shc1v",
  qty_infusion_set_2:   "numeric_mm1svn8d",
  qty_cartridge:        "numeric_mm1s9qxd",
  qty_cgm_sensors:      "numeric_mm1s49bj",
  qty_cgm_monitor:      "numeric_mm1s431c",
  primary_insurance:    "color_mm18jhq5",
  member_id:            "text_mm18s3fe",
  subscription_type:    "color_mm18h05q",
  monitor_auth_id:      "text_mm1snsw3",
  sensors_auth_id:      "text_mm28c4xs",
  pump_auth_id:         "text_mm28nex8",
  infusion_set_auth_id: "text_mm281vjp",
  cartridges_auth_id:   "text_mm28kdfj",
  // ─── The patient page's order history (2026-09-20). Verified against the
  // board's column list the same day. ───────────────────────────────────────
  order_type:           "color_mm1s96z2",   // First Order / Reorder
  order_frequency:      "color_mm1s8tz0",
  dob:                  "text_mm187t6a",
  patient_address:      "location_mm187v29",
  ddp_order:            "color_mm5pn3k1",   // placed through DDP — Cardinal never saw it
  api_status:           "color_mm3zm9hm",
  api_message:          "text_mm3zcde7",
  hold_reason:          "text_mm486hh7",
  backordered:          "dropdown_mm4wdmdd",
  backordered_qty:      "numeric_mm3zyqz4",
  substitute_set:       "color_mm727jnp",
  substitution_status:  "color_mm727p5m",
  substitution_cah:     "text_mm5xc3zg",
  cah_order_number:     "text_mm3z47x2",
  po_number:            "text_mm3zf5ev",
  carrier:              "text_mm3za3mt",
  est_ship_date:        "date_mm3zyb66",
  ship_date:            "date_mm3zvmqq",
  delivery_date:        "date_mm3z9258",
  signed_by:            "text_mm3zpppq",
  tracking_1:           "text_mm3z39yt",
  tracking_2:           "text_mm4cd2zq",
  tracking_3:           "text_mm4cxcsc",
  tracking_4:           "text_mm5rwpdb",
  tracking_5:           "text_mm5r8yv8",
  confirmed_address:    "text_mm4cm2d6",
  last_cardinal_sync:   "text_mm481jys",
  line_item_detail:     "long_text_mm489t0z",
} as const;

const COL_IDS = Object.values(COL);

export interface NewOrderRow {
  id: string;
  name: string;
  orderDate: string;
  orderStatus: string;
  preCheck: string;
  preCheckDetail: string;
  pos: string;
  shipMethod: string;
  groupId: string;
  monitorAuthId: string;
  sensorsAuthId: string;
  pumpAuthId: string;
  infusionSetAuthId: string;
  cartridgesAuthId: string;
  pumpType: string;
  cartridgeType: string;
  infusionSet1Type: string;
  infusionSet2Type: string;
  cgmType: string;
  qtyPump: string;
  qtyInfusionSet1: string;
  qtyInfusionSet2: string;
  qtyCartridge: string;
  qtyCgmSensors: string;
  qtyCgmMonitor: string;
  primaryInsurance: string;
  memberId: string;
  subscriptionType: string;
  // Cardinal / fulfilment side, for the patient page's order history.
  orderType: string;
  orderFrequency: string;
  dob: string;
  patientAddress: string;
  ddpOrder: string;
  apiStatus: string;
  apiMessage: string;
  holdReason: string;
  backordered: string;
  backorderedQty: string;
  substituteSet: string;
  substitutionStatus: string;
  substitutionCah: string;
  cahOrderNumber: string;
  poNumber: string;
  carrier: string;
  estShipDate: string;
  shipDate: string;
  deliveryDate: string;
  signedBy: string;
  trackingNumbers: string[];
  confirmedAddress: string;
  lastCardinalSync: string;
  lineItemDetail: string;
}

interface CV { id: string; text: string }
interface MondayItem {
  id: string; name: string;
  group?: { id: string } | null;
  column_values: CV[];
}
// Two-step read (2026-09-20), same shape as subscriptionPatients: the id list
// is cheap, and items(ids:) takes 100 per call with no cursor, so the row
// reads run in parallel instead of paging ~80 columns sequentially.
// ⚠️ items(ids:) silently caps at 25 without an explicit limit.
const IDS_FIRST = `query NoIdsFirst($boardId: ID!) { boards(ids: [$boardId]) { items_page(limit: 500) { cursor items { id } } } }`;
const IDS_NEXT = `query NoIdsNext($cursor: String!) { next_items_page(cursor: $cursor, limit: 500) { cursor items { id } } }`;
const ITEMS_QUERY = `query NoItems($ids: [ID!], $cols: [String!]!) { items(ids: $ids, limit: 100) { id name group { id } column_values(ids: $cols) { id text } } }`;
const ITEMS_CHUNK = 100;
const ITEMS_CONCURRENCY = 8;

function get(item: MondayItem, colId: string): string {
  return (item.column_values.find((c) => c.id === colId)?.text ?? "").trim();
}

function mapItem(item: MondayItem): NewOrderRow {
  return {
    id: item.id,
    name: item.name,
    orderDate:           get(item, COL.order_date),
    orderStatus:         get(item, COL.order_status),
    preCheck:            get(item, COL.pre_check),
    preCheckDetail:      get(item, COL.pre_check_detail),
    pos:                 get(item, COL.pos),
    shipMethod:          get(item, COL.ship_method),
    groupId:             item.group?.id ?? "",
    monitorAuthId:       get(item, COL.monitor_auth_id),
    sensorsAuthId:       get(item, COL.sensors_auth_id),
    pumpAuthId:          get(item, COL.pump_auth_id),
    infusionSetAuthId:   get(item, COL.infusion_set_auth_id),
    cartridgesAuthId:    get(item, COL.cartridges_auth_id),
    pumpType:            get(item, COL.pump_type),
    cartridgeType:       get(item, COL.cartridge_type),
    infusionSet1Type:    get(item, COL.infusion_set_1_type),
    infusionSet2Type:    get(item, COL.infusion_set_2_type),
    cgmType:             get(item, COL.cgm_type),
    qtyPump:             get(item, COL.qty_pump),
    qtyInfusionSet1:     get(item, COL.qty_infusion_set_1),
    qtyInfusionSet2:     get(item, COL.qty_infusion_set_2),
    qtyCartridge:        get(item, COL.qty_cartridge),
    qtyCgmSensors:       get(item, COL.qty_cgm_sensors),
    qtyCgmMonitor:       get(item, COL.qty_cgm_monitor),
    primaryInsurance:    get(item, COL.primary_insurance),
    memberId:            get(item, COL.member_id),
    subscriptionType:    get(item, COL.subscription_type),
    orderType:           get(item, COL.order_type),
    orderFrequency:      get(item, COL.order_frequency),
    dob:                 get(item, COL.dob),
    patientAddress:      get(item, COL.patient_address),
    ddpOrder:            get(item, COL.ddp_order),
    apiStatus:           get(item, COL.api_status),
    apiMessage:          get(item, COL.api_message),
    holdReason:          get(item, COL.hold_reason),
    backordered:         get(item, COL.backordered),
    backorderedQty:      get(item, COL.backordered_qty),
    substituteSet:       get(item, COL.substitute_set),
    substitutionStatus:  get(item, COL.substitution_status),
    substitutionCah:     get(item, COL.substitution_cah),
    cahOrderNumber:      get(item, COL.cah_order_number),
    poNumber:            get(item, COL.po_number),
    carrier:             get(item, COL.carrier),
    estShipDate:         get(item, COL.est_ship_date),
    shipDate:            get(item, COL.ship_date),
    deliveryDate:        get(item, COL.delivery_date),
    signedBy:            get(item, COL.signed_by),
    trackingNumbers:     [get(item, COL.tracking_1), get(item, COL.tracking_2), get(item, COL.tracking_3), get(item, COL.tracking_4), get(item, COL.tracking_5)].filter(Boolean),
    confirmedAddress:    get(item, COL.confirmed_address),
    lastCardinalSync:    get(item, COL.last_cardinal_sync),
    lineItemDetail:      get(item, COL.line_item_detail),
  };
}

export async function fetchNewOrders(): Promise<NewOrderRow[]> {
  if (!hasMondayToken()) return [];
  const ids: string[] = [];
  const first = await mondayQuery<{ boards: Array<{ items_page: { cursor: string | null; items: Array<{ id: string }> } }> }>(IDS_FIRST, { boardId: NEW_ORDER_BOARD_ID });
  let page = first?.boards?.[0]?.items_page ?? null;
  while (page) {
    for (const it of page.items ?? []) ids.push(it.id);
    const cursor: string | null = page.cursor;
    if (!cursor) break;
    const next = await mondayQuery<{ next_items_page: { cursor: string | null; items: Array<{ id: string }> } }>(IDS_NEXT, { cursor });
    page = next?.next_items_page ?? null;
  }
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ITEMS_CHUNK) chunks.push(ids.slice(i, i + ITEMS_CHUNK));
  const out: NewOrderRow[] = new Array(chunks.length ? 0 : 0);
  const pages: NewOrderRow[][] = new Array(chunks.length);
  let nextChunk = 0;
  const worker = async () => {
    while (nextChunk < chunks.length) {
      const idx = nextChunk++;
      const r = await mondayQuery<{ items: MondayItem[] }>(ITEMS_QUERY, { ids: chunks[idx], cols: COL_IDS });
      pages[idx] = (r.items ?? []).map(mapItem);
    }
  };
  await Promise.all(Array.from({ length: Math.min(ITEMS_CONCURRENCY, chunks.length) }, worker));
  for (const pg of pages) if (pg) out.push(...pg);
  return out;
}
