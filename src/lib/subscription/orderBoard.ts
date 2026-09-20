/**
 * orderBoard.ts — the pure shaping behind the Order tab (New Order Board).
 *
 * The board carries a wide flat row; the operator reads it as two things —
 * "what are we sending" and "under which auths" — split by category, Sensors
 * vs Supplies. Monitor rides with Sensors, pump/cartridge/infusion ride with
 * Supplies (Brandon, 2026-09-20). This module turns one flat row into up to
 * two category lines so the UI reads the same whether an order is sensors
 * only, supplies only, or both.
 *
 * Pure: no React, no Monday.
 */
import type { NewOrderRow } from "@/api/queries/newOrders";

/** Complete Tailwind class string for a status/pre-check pill. */
const PILL = {
  amber:  "bg-amber-100 text-amber-800 ring-amber-200",
  green:  "bg-emerald-100 text-emerald-800 ring-emerald-200",
  red:    "bg-rose-100 text-rose-800 ring-rose-200",
  blue:   "bg-sky-100 text-sky-800 ring-sky-200",
  purple: "bg-violet-100 text-violet-800 ring-violet-200",
  slate:  "bg-slate-100 text-slate-700 ring-slate-200",
} as const;
export type PillTone = keyof typeof PILL;
export function pillClass(tone: PillTone): string { return PILL[tone]; }

/** Order Status → tone (labels + colours verified on the board 2026-09-20). */
export function orderStatusTone(label: string): PillTone {
  switch (label.trim()) {
    case "Order":               return "amber";
    case "Ordered":             return "green";
    case "Paid Cash":           return "green";
    case "Stuck":               return "red";
    case "On Hold":             return "blue";
    case "Process Claim":       return "purple";
    case "Return in Progress":  return "blue";
    case "Return Complete":     return "slate";
    default:                    return "slate";
  }
}

/** Order Status → a left-border colour. It's almost always "Order"; when it
 *  flips to Ordered the row leaves the view anyway, so this is quiet context,
 *  not a headline (Brandon, 2026-09-20). */
export function orderStatusBorder(label: string): string {
  switch (label.trim()) {
    case "Order":         return "border-l-amber-400";
    case "Ordered":       return "border-l-emerald-500";
    case "Paid Cash":     return "border-l-emerald-500";
    case "Stuck":         return "border-l-rose-500";
    case "On Hold":       return "border-l-sky-500";
    case "Process Claim": return "border-l-violet-500";
    default:              return "border-l-slate-300";
  }
}

/** Pre-Check → tone. Anything with "Good to Go" is clear; the rest need a look. */
export function preCheckTone(label: string): PillTone {
  const l = label.trim().toLowerCase();
  if (!l) return "slate";
  if (l.startsWith("good to go")) return "green";
  if (l === "mismatch") return "amber";
  return "red"; // Address Flag, Data Issue, Mismatch + Address
}

/** POS shows a pill only when the place of service is Office (Brandon: home
 *  or blank shows nothing). */
export function posLabel(pos: string): string | null {
  return /^office$/i.test(pos.trim()) ? "Office" : null;
}

export interface OrderItem { name: string; qty: string }
export interface OrderAuth { label: string; id: string }
export interface OrderCategory {
  category: "Sensors" | "Supplies";
  items: OrderItem[];
  auths: OrderAuth[];
}

function num(s: string): number { const n = Number(String(s).replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
function has(type: string, qty: string): boolean { return !!type.trim() && !/^none$/i.test(type.trim()) || num(qty) > 0; }
function item(name: string, qty: string): OrderItem { return { name, qty: num(qty) > 0 ? `×${num(qty)}` : "" }; }

/**
 * Split a row into its Sensors / Supplies lines. A category appears when it
 * has any product on the order (a type set, or a positive quantity), OR when
 * the Subscription Type names it (so an empty-but-expected line still shows).
 */
export function orderCategories(row: NewOrderRow): OrderCategory[] {
  const sub = (row.subscriptionType || "").toLowerCase();
  const out: OrderCategory[] = [];

  const sensorItems: OrderItem[] = [];
  if (has(row.cgmType, row.qtyCgmSensors)) sensorItems.push(item(row.cgmType || "CGM sensors", row.qtyCgmSensors));
  if (num(row.qtyCgmMonitor) > 0) sensorItems.push(item("Monitor", row.qtyCgmMonitor));
  const sensorAuths = [
    { label: "Sensors", id: row.sensorsAuthId },
    { label: "Monitor", id: row.monitorAuthId },
  ].filter((a) => a.id.trim());
  if (sensorItems.length || sensorAuths.length || sub.includes("sensor")) {
    out.push({ category: "Sensors", items: sensorItems, auths: sensorAuths });
  }

  const supplyItems: OrderItem[] = [];
  if (has(row.pumpType, row.qtyPump)) supplyItems.push(item(row.pumpType || "Pump", row.qtyPump));
  if (has(row.cartridgeType, row.qtyCartridge)) supplyItems.push(item(row.cartridgeType || "Cartridges", row.qtyCartridge));
  if (has(row.infusionSet1Type, row.qtyInfusionSet1)) supplyItems.push(item(row.infusionSet1Type || "Infusion set", row.qtyInfusionSet1));
  if (has(row.infusionSet2Type, row.qtyInfusionSet2)) supplyItems.push(item(row.infusionSet2Type || "Infusion set 2", row.qtyInfusionSet2));
  const supplyAuths = [
    { label: "Pump", id: row.pumpAuthId },
    { label: "Cartridges", id: row.cartridgesAuthId },
    { label: "Infusion set", id: row.infusionSetAuthId },
  ].filter((a) => a.id.trim());
  if (supplyItems.length || supplyAuths.length || sub.includes("suppl")) {
    out.push({ category: "Supplies", items: supplyItems, auths: supplyAuths });
  }

  return out;
}
