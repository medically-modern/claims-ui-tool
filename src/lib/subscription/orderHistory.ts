/**
 * orderHistory.ts — a patient's orders off the New Order Board, read the way
 * the patient page shows them: the newest first, each one as a
 * confirmation-email style card (what was ordered, how it shipped, where it
 * is), and a one-line status for the history table.
 *
 * Ported from the Command Center redesign mockup (2026-09-18) and made real:
 *   - Orders match the patient by name, and by DOB when both sides have one.
 *     The New Order Board carries no Subscription Item ID, so this is the join
 *     until Josh adds one (the claim history already has that column).
 *   - Shipments come from Cardinal's `Line Item Detail` text when present —
 *     one `SHIP <carrier> <tracking> qty <n> on <date> from <warehouse>` line
 *     per shipment — and fall back to the flat tracking-number columns.
 *   - "Via DDP" = the order predates the Cardinal API; nothing to track.
 *
 * Pure: no Monday, no React.
 */
import type { NewOrderRow } from "@/api/queries/newOrders";

export interface OrderItem {
  kind: "sensors" | "infusion set" | "cartridges" | "pump" | "monitor";
  name: string;
  qty: string;
}

export interface Shipment {
  carrier: string;
  tracking: string;
  shippedOn: string;   // yyyy-mm-dd or ""
  delivered: string;   // yyyy-mm-dd or ""
  qty: string;
  from: string;
  /** SKUs Cardinal listed in this shipment, when the detail text says. */
  skus: string[];
}

export interface OrderLine {
  n: number;
  sku: string;
  qty: string;
  status: string;      // SHIPPED / BACKORDERED / …
}

export type OrderStage = "created" | "placed" | "accepted" | "shipped" | "delivered";

export interface OrderView {
  row: NewOrderRow;
  id: string;
  cah: string;
  placed: string;                 // order date
  items: OrderItem[];
  lines: OrderLine[];
  shipments: Shipment[];
  backordered: boolean;
  backorderedQty: string;
  ddp: boolean;
  hold: string;                   // hold / error text, "" when none
  status: OrderStatus;
  stage: OrderStage;
  complete: boolean;
}

export interface OrderStatus {
  label: string;
  tone: "good" | "light" | "blue" | "amber" | "red" | "grey";
}

// ─── Matching ───────────────────────────────────────────────────────────────

function normName(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}
function normDob(s: string): string {
  const v = String(s ?? "").trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return v.slice(0, 10);
}

/** The rows on the New Order Board that belong to this patient, newest first. */
export function ordersForPatient(
  rows: NewOrderRow[],
  patient: { name: string; dob?: string },
): OrderView[] {
  const name = normName(patient.name);
  if (!name) return [];
  const dob = normDob(patient.dob ?? "");
  return rows
    .filter((r) => {
      if (normName(r.name) !== name) return false;
      const rd = normDob(r.dob);
      // Two people can share a name; a DOB on both sides has to agree.
      return !(dob && rd) || dob === rd;
    })
    .map(orderView)
    .sort((a, b) => (b.placed || "").localeCompare(a.placed || "") || b.id.localeCompare(a.id));
}

// ─── One order ──────────────────────────────────────────────────────────────

function served(v: string): boolean {
  return !!v && !/^not serving$/i.test(v);
}
function qtyOf(v: string): string {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? String(n) : "";
}

export function orderItems(r: NewOrderRow): OrderItem[] {
  const out: OrderItem[] = [];
  if (served(r.cgmType) && qtyOf(r.qtyCgmSensors)) out.push({ kind: "sensors", name: `${r.cgmType} sensors`, qty: qtyOf(r.qtyCgmSensors) });
  if (qtyOf(r.qtyCgmMonitor)) out.push({ kind: "monitor", name: `${r.cgmType || "CGM"} reader`, qty: qtyOf(r.qtyCgmMonitor) });
  if (served(r.infusionSet1Type) && qtyOf(r.qtyInfusionSet1)) out.push({ kind: "infusion set", name: r.infusionSet1Type, qty: qtyOf(r.qtyInfusionSet1) });
  if (served(r.infusionSet2Type) && qtyOf(r.qtyInfusionSet2)) out.push({ kind: "infusion set", name: r.infusionSet2Type, qty: qtyOf(r.qtyInfusionSet2) });
  if (qtyOf(r.qtyCartridge)) out.push({ kind: "cartridges", name: `${served(r.cartridgeType) ? r.cartridgeType + " " : ""}cartridges`, qty: qtyOf(r.qtyCartridge) });
  if (served(r.pumpType) && qtyOf(r.qtyPump)) out.push({ kind: "pump", name: r.pumpType, qty: qtyOf(r.qtyPump) });
  return out;
}

/**
 * Cardinal's Line Item Detail, e.g.
 *   ORDER STATUS 9/19/2026, 20:02:06 ET
 *   L1 TW7876801I x6 EA @79.32 -> SHIPPED
 *      SHIP FedEx 541809550825 qty 6 on 2026-09-18 from TEXAS 4 WAREHOUSE
 *   L2 00MMWELCOME xnull EA @0 -> SHIPPED
 * The welcome-kit line (00MMWELCOME) is Cardinal's, not the patient's.
 */
export function parseLineDetail(text: string): { lines: OrderLine[]; shipments: Shipment[] } {
  const lines: OrderLine[] = [];
  const byTrack = new Map<string, Shipment>();
  let current: OrderLine | null = null;
  for (const raw of String(text ?? "").split("\n")) {
    const t = raw.trim();
    const L = /^L(\d+)\s+(\S+)\s+x(\S+)\s+\S+\s+@\S+\s*->\s*(.+)$/.exec(t);
    if (L) {
      current = { n: Number(L[1]), sku: L[2], qty: /^\d+$/.test(L[3]) ? L[3] : "", status: L[4].trim().toUpperCase() };
      if (!/^00MMWELCOME$/i.test(current.sku)) lines.push(current);
      continue;
    }
    const S = /^SHIP\s+(\S+)\s+(\S+)\s+qty\s+(\S+)\s+on\s+(\d{4}-\d{2}-\d{2})(?:\s+from\s+(.+))?$/i.exec(t);
    if (S) {
      const key = S[2];
      const s = byTrack.get(key) ?? { carrier: S[1], tracking: key, shippedOn: S[4], delivered: "", qty: "0", from: S[5]?.trim() ?? "", skus: [] };
      s.qty = String(Number(s.qty) + (Number(S[3]) || 0));
      if (current && !/^00MMWELCOME$/i.test(current.sku) && !s.skus.includes(current.sku)) s.skus.push(current.sku);
      byTrack.set(key, s);
    }
  }
  return { lines, shipments: [...byTrack.values()] };
}

export function orderView(r: NewOrderRow): OrderView {
  const items = orderItems(r);
  const parsed = parseLineDetail(r.lineItemDetail);
  const api = r.apiStatus || "";
  const ddp = /ddp/i.test(r.ddpOrder) || (!r.cahOrderNumber && !api && !r.trackingNumbers.length && !r.shipDate);

  let shipments = parsed.shipments;
  if (!shipments.length && (r.trackingNumbers.length || r.shipDate)) {
    shipments = (r.trackingNumbers.length ? r.trackingNumbers : [""]).map((tr) => ({
      carrier: r.carrier, tracking: tr, shippedOn: r.shipDate, delivered: "", qty: "", from: "", skus: [],
    }));
  }
  // Delivery Date is per order on the board; a delivered order marks its shipments.
  if (r.deliveryDate || /delivered/i.test(api)) {
    shipments = shipments.map((s) => ({ ...s, delivered: s.delivered || r.deliveryDate }));
  }

  const backorderedLines = parsed.lines.filter((l) => /backorder/i.test(l.status)).length > 0;
  const backordered = backorderedLines || !!r.backordered || !!qtyOf(r.backorderedQty) || /backorder|partially/i.test(api);
  const holdSources = [r.holdReason, api, r.apiMessage];
  const hold = /hold|error|cannot be processed/i.test(api) && !/released/i.test(api) && !r.shipDate && !r.deliveryDate
    ? (holdSources.find((t) => /hold reason:/i.test(t)) || r.holdReason || r.apiMessage || api)
    : "";

  const delivered = shipments.length > 0 && shipments.every((s) => s.delivered) && !backordered;
  const partDelivered = backordered && shipments.some((s) => s.delivered);
  const partShipped = backordered && shipments.length > 0 && !shipments.some((s) => s.delivered);
  const shipped = shipments.length > 0;

  let status: OrderStatus;
  let stage: OrderStage;
  if (ddp) { status = { label: "Ordered via DDP", tone: "grey" }; stage = "delivered"; }
  else if (delivered) { status = { label: `Delivered${r.deliveryDate ? " " + fmtUs(r.deliveryDate) : ""}`, tone: "good" }; stage = "delivered"; }
  else if (partDelivered) { status = { label: `Partially delivered · ${shipments.filter((s) => s.delivered).length} of ${shipments.length + 1}`, tone: "light" }; stage = "delivered"; }
  else if (partShipped) { status = { label: `Partially shipped · ${shipments.length} of ${shipments.length + 1}`, tone: "light" }; stage = "shipped"; }
  else if (hold) { status = { label: shortHold(hold), tone: "red" }; stage = "placed"; }
  else if (backordered && !shipped) { status = { label: "Backordered", tone: "red" }; stage = "accepted"; }
  else if (shipped) { status = { label: "In transit", tone: "blue" }; stage = "shipped"; }
  else if (/accepted|success|booked/i.test(api + " " + r.apiMessage)) { status = { label: "Accepted", tone: "amber" }; stage = "accepted"; }
  else if (r.cahOrderNumber) { status = { label: "Placed", tone: "amber" }; stage = "placed"; }
  else { status = { label: r.orderStatus || "Created", tone: "amber" }; stage = "created"; }

  const complete = ddp || delivered || /return complete|paid cash/i.test(r.orderStatus);
  return {
    row: r, id: r.id, cah: r.cahOrderNumber, placed: r.orderDate, items,
    lines: parsed.lines, shipments, backordered, backorderedQty: qtyOf(r.backorderedQty),
    ddp, hold, status, stage, complete,
  };
}

function shortHold(s: string): string {
  const m = /hold reason:\s*([^,;]+)/i.exec(s);
  if (m) return `On hold — ${m[1].trim()}`;
  if (/error|cannot be processed/i.test(s)) return "Booking error";
  return "On hold";
}

export function fmtUs(iso: string): string {
  const v = String(iso ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : v;
}

/** The five tracker steps for an order card, with the sub-label under each. */
export function trackerSteps(o: OrderView): Array<{ label: string; sub: string; done: boolean; current: boolean; partial: boolean; error: boolean }> {
  const order: OrderStage[] = ["created", "placed", "accepted", "shipped", "delivered"];
  const at = order.indexOf(o.stage);
  const nShip = o.shipments.length;
  const nDel = o.shipments.filter((s) => s.delivered).length;
  const labels: Record<OrderStage, [string, string]> = {
    created:   ["Created", fmtUs(o.placed)],
    placed:    ["Placed", o.cah ? `Cardinal #${o.cah}` : o.ddp ? "via DDP" : (o.row.orderStatus || "")],
    accepted:  ["Accepted", o.hold ? shortHold(o.hold) : at >= 2 ? "Accepted" : ""],
    shipped:   [o.backordered && nShip ? "Partially shipped" : "Shipped", nShip ? (o.backordered ? `${nShip} of ${nShip + 1} shipments` : fmtUs(o.shipments[0].shippedOn) || "Shipped") : "Not yet"],
    delivered: [o.backordered && nDel ? "Partially delivered" : "Delivered", nDel ? (o.backordered ? `${nDel} of ${nShip + 1}` : fmtUs(o.shipments[0].delivered)) : ""],
  };
  return order.map((k, i) => ({
    label: labels[k][0],
    sub: labels[k][1],
    done: i <= at,
    current: i === at,
    partial: (k === "shipped" && o.backordered && nShip > 0) || (k === "delivered" && o.backordered && nDel > 0),
    error: k === "accepted" && !!o.hold,
  }));
}
