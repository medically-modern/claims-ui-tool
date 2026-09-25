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
    case "Order":               return "green";
    case "Ordered":             return "green";
    case "Paid Cash":           return "green";
    case "Stuck":               return "red";
    case "On Hold":             return "amber";
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
    case "Order":         return "border-l-[#0f5c47]";  // Medically Modern green
    case "Ordered":       return "border-l-emerald-400";
    case "Paid Cash":     return "border-l-emerald-400";
    case "Stuck":         return "border-l-rose-500";
    case "On Hold":       return "border-l-orange-500";
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
  /** "Pump" / "Monitor" are single-device orders (blank subscription). */
  category: "Sensors" | "Supplies" | "Pump" | "Monitor";
  /** Every line as type ×qty (monitor and pump are lines too, not chips). */
  items: OrderItem[];
  auths: OrderAuth[];
  /** A monitor-only order that should be merged into the patient's sensors
   *  order (set on the "Monitor" category only). */
  monitorOnly?: boolean;
}

function num(s: string): number { const n = Number(String(s).replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; }
/** A type names something real — not blank, "None", or "Not Serving". */
function serving(type: string): boolean {
  const t = (type || "").trim();
  return !!t && !/^(none|not serving)$/i.test(t);
}
/** A product line, gated on QUANTITY (the type columns are populated as
 *  reference even when nothing is ordered — Brandon, 2026-09-20). */
function line(type: string, qty: string, fallback: string, suffix = ""): OrderItem | null {
  if (num(qty) <= 0) return null;
  const base = serving(type) ? `${type}${suffix}` : fallback;
  return { name: base, qty: `×${num(qty)}` };
}

/**
 * Split a row into its category lines, driven by Subscription Type
 * (Brandon, 2026-09-20): Supplies → Supplies only; Sensors → Sensors only;
 * Sensors & Supplies → both. Blank means a single-device order — pump-only
 * (pumps are always their own order) or monitor-only (monitors often ride
 * with sensors and get merged in). Monitor and pump show as real lines
 * (e.g. "Monitor ×1", "t:slim ×1"), never a chip.
 */
export function orderCategories(row: NewOrderRow): OrderCategory[] {
  const sub = (row.subscriptionType || "").toLowerCase();
  const out: OrderCategory[] = [];

  const sensorQty = num(row.qtyCgmSensors);
  const monitorQty = num(row.qtyCgmMonitor);
  const sensorItems = [
    line(row.cgmType, row.qtyCgmSensors, "CGM sensors"),
    monitorQty > 0 ? { name: "Monitor", qty: `×${monitorQty}` } : null,
  ].filter(Boolean) as OrderItem[];
  const sensorAuths = ([
    { label: "Sensors", id: row.sensorsAuthId },
    { label: "Monitor", id: row.monitorAuthId },
  ] as OrderAuth[]).filter((a) => a.id.trim());

  // Supplies = cartridge + infusion sets; the pump is ALWAYS its own order and
  // reads "Pump", never "Supplies" (Brandon, 2026-09-20).
  const suppliesItems = [
    line(row.cartridgeType, row.qtyCartridge, "Cartridges", " Cartridges"),
    line(row.infusionSet1Type, row.qtyInfusionSet1, "Infusion set"),
    line(row.infusionSet2Type, row.qtyInfusionSet2, "Infusion set 2"),
  ].filter(Boolean) as OrderItem[];
  const suppliesAuths = ([
    { label: "Cartridges", id: row.cartridgesAuthId },
    { label: "Infusion set", id: row.infusionSetAuthId },
  ] as OrderAuth[]).filter((a) => a.id.trim());
  const pumpItem = line(row.pumpType, row.qtyPump, "Pump");
  const pumpAuths = ([{ label: "Pump", id: row.pumpAuthId }] as OrderAuth[]).filter((a) => a.id.trim());

  const pushSensors = () => { if (sensorItems.length) out.push({ category: "Sensors", items: sensorItems, auths: sensorAuths }); };
  const pushSupplies = () => {
    if (pumpItem) out.push({ category: "Pump", items: [pumpItem], auths: pumpAuths });
    if (suppliesItems.length) out.push({ category: "Supplies", items: suppliesItems, auths: suppliesAuths });
  };

  if (sub.includes("sensor")) pushSensors();
  if (sub.includes("suppl")) pushSupplies();
  if (!sub) {
    if (serving(row.pumpType) && suppliesItems.length === 0 && sensorQty === 0 && monitorQty === 0) {
      // Pump-only order — qty is often blank on the board, so default to ×1.
      out.push({ category: "Pump", items: [{ name: row.pumpType, qty: `×${num(row.qtyPump) || 1}` }], auths: pumpAuths });
    } else if (monitorQty > 0 && sensorQty === 0 && suppliesItems.length === 0 && !serving(row.pumpType)) {
      out.push({ category: "Monitor", items: [{ name: "Monitor", qty: `×${monitorQty}` }], auths: ([{ label: "Monitor", id: row.monitorAuthId }] as OrderAuth[]).filter((a) => a.id.trim()), monitorOnly: true });
    } else {
      pushSensors();
      pushSupplies();
    }
  }
  return out;
}

/** A product actually on the order: a stable filter value + a human label. */
export interface OrderProduct { value: string; label: string }

/**
 * The distinct products on an order — a type column that names something real
 * AND a quantity > 0 (the type columns are populated as reference even when
 * nothing is ordered, so quantity is the gate, same as orderCategories). Each
 * carries a category-qualified label ("Mobi Pump", "Dexcom G7 CGM") so the
 * product filter reads naturally and a pump "Mobi" never collides with a
 * cartridge "Mobi" (Brandon, 2026-09-25).
 */
export function orderProducts(row: NewOrderRow): OrderProduct[] {
  const out: OrderProduct[] = [];
  const add = (slot: string, type: string, qty: string, suffix: string) => {
    if (num(qty) <= 0 || !serving(type)) return;
    const t = type.trim();
    out.push({ value: `${slot}:${t.toLowerCase()}`, label: `${t} ${suffix}` });
  };
  add("pump", row.pumpType, row.qtyPump, "Pump");
  add("cgm", row.cgmType, row.qtyCgmSensors, "CGM");
  add("cart", row.cartridgeType, row.qtyCartridge, "Cartridges");
  add("inf", row.infusionSet1Type, row.qtyInfusionSet1, "Infusion set");
  add("inf", row.infusionSet2Type, row.qtyInfusionSet2, "Infusion set");
  if (num(row.qtyCgmMonitor) > 0) out.push({ value: "monitor", label: "Monitor" });
  // Dedupe (infusion set 1 & 2 can be the same type).
  const seen = new Set<string>();
  return out.filter((p) => (seen.has(p.value) ? false : (seen.add(p.value), true)));
}

function normName(s: string): string { return String(s || "").toLowerCase().replace(/[^a-z]/g, ""); }

/** Is this row a monitor-only order (the merge candidate)? */
export function isMonitorOnly(row: NewOrderRow): boolean {
  return orderCategories(row).some((c) => c.monitorOnly);
}

/**
 * The sensors order on the board this monitor-only row should merge into: the
 * same patient (name + DOB) with a sensors line, in the Order group. Null when
 * there is no match yet — the button stays disabled until the sensors order
 * lands (Brandon, 2026-09-20).
 */
export function monitorMergeTarget(monitor: NewOrderRow, all: NewOrderRow[]): NewOrderRow | null {
  if (!isMonitorOnly(monitor)) return null;
  const n = normName(monitor.name);
  const dob = monitor.dob.trim();
  return all.find((r) =>
    r.id !== monitor.id
    && r.groupId === monitor.groupId
    && normName(r.name) === n
    && (!dob || !r.dob.trim() || r.dob.trim() === dob)
    && orderCategories(r).some((c) => c.category === "Sensors"),
  ) ?? null;
}
