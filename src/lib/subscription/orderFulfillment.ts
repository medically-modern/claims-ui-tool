/**
 * orderFulfillment.ts — parse the New Order Board's "Line Item Detail" into a
 * clear "what shipped / what didn't" picture (Brandon, 2026-09-20).
 *
 * The group (Accepted/Partial vs Shipped/Delivered), the API Status, and the
 * Backordered chip are three separate, sometimes-stale signals; the Line Item
 * Detail is the only reliable source. Cardinal writes it per line, e.g.:
 *
 *   ORDER STATUS 9/11/2026, 16:01:21 ET
 *   L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)
 *   L1 TN1013310I x3 BX @30.95 -> SHIPPED
 *      SHIP FedEx 537924437056 qty 3 on 2026-09-08 from NEW JERSEY WAREHOUSE
 *   L2 TN1002817I xnull BX @71.94 -> Deleted
 *   SUBSTITUTED (dropped by Cardinal): TN1002817I
 *   SUBSTITUTION ORDER 1121071396
 *   L1 TN1001680I x3 BX @71.94 -> SHIPPED
 *      SHIP FedEx 537926241582 qty 3 on 2026-09-10 from NEW JERSEY WAREHOUSE
 *
 * Pure: no React, no Monday.
 */

import { skuInfo } from "./cardinalSku";

export type LineState = "shipped" | "backordered" | "accepted" | "deleted" | "other";

export interface ShipInfo { carrier: string; tracking: string; qty: string; date: string; warehouse: string }
export interface FulfillLine { sku: string; qty: string; state: LineState; substitution: boolean; ship?: ShipInfo }

export interface Fulfillment {
  hasDetail: boolean;
  lines: FulfillLine[];
  substitutedSkus: string[];
}

export type ShipStatus = "shipped" | "partial" | "backordered" | "pending" | "unknown";
export interface FulfillSummary {
  status: ShipStatus;
  shipments: ShipInfo[];      // unique, by tracking number
  backorderedSkus: string[];  // unresolved
}

const isWelcome = (sku: string) => /welcome/i.test(sku);

function stateOf(target: string): LineState {
  if (/shipped/i.test(target)) return "shipped";
  if (/backorder/i.test(target)) return "backordered";
  if (/deleted/i.test(target)) return "deleted";
  if (/accepted/i.test(target)) return "accepted";
  return "other";
}

/** Parse the raw Line Item Detail text into structured lines. */
export function parseFulfillment(detail: string): Fulfillment {
  const text = String(detail || "");
  if (!text.trim()) return { hasDetail: false, lines: [], substitutedSkus: [] };
  const lines: FulfillLine[] = [];
  const substitutedSkus: string[] = [];
  let inSub = false;

  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (/^SUBSTITUTION ORDER/i.test(l)) { inSub = true; continue; }
    const sub = /^SUBSTITUTED[^:]*:\s*(\S+)/i.exec(l);
    if (sub) { substitutedSkus.push(sub[1]); continue; }
    const m = /^L\d+\s+(\S+)\s+x(\S+)\s+\S+\s+@[\d.]+\s*->\s*(.+)$/i.exec(l);
    if (m) {
      lines.push({ sku: m[1], qty: m[2] === "null" ? "" : m[2], state: stateOf(m[3]), substitution: inSub });
      continue;
    }
    const s = /^SHIP\s+(\S+)\s+(\S+)\s+qty\s+(\S+)\s+on\s+(\d{4}-\d{2}-\d{2})(?:\s+from\s+(.+))?/i.exec(l);
    if (s && lines.length) {
      const last = lines[lines.length - 1];
      last.ship = { carrier: s[1], tracking: s[2], qty: s[3], date: s[4], warehouse: (s[5] || "").trim() };
      if (last.state !== "shipped") last.state = "shipped";
    }
  }
  return { hasDetail: true, lines, substitutedSkus };
}

/** Roll the parsed lines up into "what shipped / what didn't". */
export function summarize(f: Fulfillment): FulfillSummary {
  const shipments: ShipInfo[] = [];
  const seen = new Set<string>();
  for (const ln of f.lines) {
    if (ln.ship && !seen.has(ln.ship.tracking)) { seen.add(ln.ship.tracking); shipments.push(ln.ship); }
  }
  // Final state per SKU: shipped beats accepted beats backordered beats deleted.
  const order: Record<LineState, number> = { shipped: 4, accepted: 3, backordered: 2, deleted: 1, other: 0 };
  const finalBySku = new Map<string, LineState>();
  for (const ln of f.lines) {
    if (isWelcome(ln.sku)) continue;
    const cur = finalBySku.get(ln.sku);
    if (cur == null || order[ln.state] > order[cur]) finalBySku.set(ln.sku, ln.state);
  }
  const subbed = new Set(f.substitutedSkus);
  // A SKU Cardinal dropped-and-substituted is resolved by its replacement line.
  const active = [...finalBySku.entries()].filter(([sku, st]) => st !== "deleted" && !subbed.has(sku));
  const backorderedSkus = active.filter(([, st]) => st === "backordered").map(([sku]) => sku);

  let status: ShipStatus;
  if (!f.hasDetail) status = "unknown";
  else if (!active.length) status = shipments.length ? "shipped" : "unknown";
  else {
    const anyShipped = active.some(([, st]) => st === "shipped") || shipments.length > 0;
    const allShipped = active.every(([, st]) => st === "shipped");
    if (allShipped) status = "shipped";
    else if (anyShipped) status = "partial";
    else if (backorderedSkus.length) status = "backordered";
    else status = "pending";
  }
  return { status, shipments, backorderedSkus };
}

export function fulfillmentOf(detail: string): FulfillSummary {
  return summarize(parseFulfillment(detail));
}

/** A per-product row for the Overview: the real product (SKU→name), its state,
 *  and — for shipped lines — the shipment that carried it. Cardinal's dropped
 *  originals are folded into their substitution replacement. */
export type ProductState = "shipped" | "backordered" | "pending";
export interface ProductLine { sku: string; name: string; cat: string; qty: string; state: ProductState; ship?: ShipInfo; substitution: boolean }

export function orderProductLines(detail: string): ProductLine[] {
  const f = parseFulfillment(detail);
  const subbed = new Set(f.substitutedSkus);
  const rank: Record<LineState, number> = { shipped: 4, accepted: 3, backordered: 2, deleted: 1, other: 0 };
  const bySku = new Map<string, { qty: string; state: LineState; ship?: ShipInfo; substitution: boolean }>();
  for (const ln of f.lines) {
    if (isWelcome(ln.sku) || subbed.has(ln.sku)) continue; // freebie / dropped original
    const cur = bySku.get(ln.sku);
    if (!cur) { bySku.set(ln.sku, { qty: ln.qty, state: ln.state, ship: ln.ship, substitution: ln.substitution }); continue; }
    if (rank[ln.state] > rank[cur.state]) cur.state = ln.state;
    if (ln.ship && !cur.ship) cur.ship = ln.ship;
    if (ln.qty && !cur.qty) cur.qty = ln.qty;
    cur.substitution = cur.substitution || ln.substitution;
  }
  const toState = (s: LineState): ProductState => (s === "shipped" ? "shipped" : s === "backordered" ? "backordered" : "pending");
  return [...bySku.entries()]
    .filter(([, v]) => v.state !== "deleted")
    .map(([sku, v]) => { const info = skuInfo(sku); return { sku, name: info?.name ?? sku, cat: info?.cat ?? "", qty: v.qty, state: toState(v.state), ship: v.ship, substitution: v.substitution }; });
}

export const SHIP_STATUS_LABEL: Record<ShipStatus, string> = {
  shipped: "Fully shipped",
  partial: "Partially shipped",
  backordered: "Backordered",
  pending: "Pending",
  unknown: "No detail yet",
};

/**
 * The one-glance lifecycle stage that answers: was there a booking error / is it
 * on Cardinal's side; did it ship (full/partial, backorder?); did it deliver;
 * still on backorder or substituted-and-shipped (Brandon, 2026-09-20).
 *
 * Reads the current API Status column for the booking stage (the row's hold
 * MESSAGE is often stale — Hermy still says "Credit Check Failure" though it
 * delivered — so a shipment/delivery always overrides an error), then the
 * derived shipment status for the rest.
 */
export type OrderStage = "error" | "accepted" | "backordered" | "partial" | "shipped" | "delivered" | "sent";
export interface OrderProgress { stage: OrderStage; label: string; detail?: string; substituted: boolean }

export function orderProgress(detail: string, apiStatus: string, deliveryDate: string): OrderProgress {
  const parsed = parseFulfillment(detail);
  const f = summarize(parsed);
  const substituted = parsed.substitutedSkus.length > 0;
  const api = apiStatus.trim().toLowerCase();
  const anyShipped = f.shipments.length > 0;
  const delivered = !!deliveryDate.trim();
  const looksError = /error|cannot|deleted|fail|reject|denied|put on hold/.test(api);

  // A booking error only stands while nothing has shipped — once a box is out,
  // any lingering hold text is history.
  if (!anyShipped && looksError) return { stage: "error", label: "Error sending to Cardinal", detail: apiStatus.trim() || undefined, substituted };

  if (f.status === "shipped") {
    return delivered
      ? { stage: "delivered", label: "Delivered", substituted }
      : { stage: "shipped", label: "Shipped — in transit", substituted };
  }
  if (f.status === "partial") {
    return { stage: "partial", label: "Partially shipped", detail: f.backorderedSkus.length ? "rest backordered" : "rest pending", substituted };
  }
  if (f.status === "backordered") return { stage: "backordered", label: "Backordered — nothing shipped", substituted };
  // Nothing shipped, no error: Cardinal has accepted it and it's awaiting ship.
  if (/accept|working|success|book/.test(api) || f.status === "pending") {
    return { stage: "accepted", label: "Accepted — awaiting ship", substituted };
  }
  return { stage: "sent", label: apiStatus.trim() || "Sent to Cardinal", substituted };
}
