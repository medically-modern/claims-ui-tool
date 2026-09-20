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

// Verified 2026-06-07 via Monday API.
const COL = {
  order_date:           "date_mm1ssf5g",
  order_status:         "status",
  pre_check:            "color_mm5bh2az",
  pre_check_detail:     "long_text_mm5byhdp",
  pos:                  "color_mm3rfpkt",
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
interface PageResp {
  boards: Array<{ items_page: { cursor: string | null; items: MondayItem[] } }>;
}
interface NextResp {
  next_items_page: { cursor: string | null; items: MondayItem[] };
}

const PAGE_QUERY = `
  query NewOrderPage($boardId: ID!, $cols: [String!]!) {
    boards(ids: [$boardId]) {
      items_page(limit: 500) {
        cursor
        items { id name group { id } column_values(ids: $cols) { id text } }
      }
    }
  }
`;
const NEXT_QUERY = `
  query NewOrderNext($cursor: String!, $cols: [String!]!) {
    next_items_page(cursor: $cursor, limit: 500) {
      cursor
      items { id name group { id } column_values(ids: $cols) { id text } }
    }
  }
`;

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
    trackingNumbers:     [get(item, COL.tracking_1), get(item, COL.tracking_2), get(item, COL.tracking_3)].filter(Boolean),
    confirmedAddress:    get(item, COL.confirmed_address),
    lastCardinalSync:    get(item, COL.last_cardinal_sync),
    lineItemDetail:      get(item, COL.line_item_detail),
  };
}

export async function fetchNewOrders(): Promise<NewOrderRow[]> {
  if (!hasMondayToken()) return [];
  const out: NewOrderRow[] = [];
  const first = await mondayQuery<PageResp>(PAGE_QUERY, {
    boardId: NEW_ORDER_BOARD_ID, cols: COL_IDS,
  });
  const firstPage = first?.boards?.[0]?.items_page;
  let cursor = firstPage?.cursor ?? null;
  for (const it of firstPage?.items ?? []) out.push(mapItem(it));
  while (cursor) {
    const next = await mondayQuery<NextResp>(NEXT_QUERY, {
      cursor, cols: COL_IDS,
    });
    cursor = next?.next_items_page?.cursor ?? null;
    for (const it of next?.next_items_page?.items ?? []) out.push(mapItem(it));
  }
  return out;
}
