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

// Verified 2026-06-07 via Monday API.
const COL = {
  order_date:           "date_mm1ssf5g",
  order_status:         "status",
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
} as const;

const COL_IDS = Object.values(COL);

export interface NewOrderRow {
  id: string;
  name: string;
  orderDate: string;
  orderStatus: string;
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
}

interface CV { id: string; text: string }
interface MondayItem {
  id: string; name: string;
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
        items { id name column_values(ids: $cols) { id text } }
      }
    }
  }
`;
const NEXT_QUERY = `
  query NewOrderNext($cursor: String!, $cols: [String!]!) {
    next_items_page(cursor: $cursor, limit: 500) {
      cursor
      items { id name column_values(ids: $cols) { id text } }
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
