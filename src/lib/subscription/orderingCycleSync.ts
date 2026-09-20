/**
 * orderingCycleSync.ts — keep Monday's Ordering Cycle in step with the tool.
 *
 * Readiness is derived here (five circles + nothing unread; lanes.ts
 * isReady), and until 2026-09-20 nothing wrote it back: rows the rules had
 * moved to Ready to Order still said Order Prep on the board, and rows the
 * board called Ready to Order were being held by the tool. Josh's
 * automations read the board, so the board has to agree with the screen.
 *
 * The tool owns exactly two labels — Order Prep and Ready to Order — and
 * flips a row between them. It never touches Order / Next Order Awaiting /
 * Not Serving (those are the order-and-reset lifecycle, owned by the
 * backend), never touches a paused or Not Active row, and never writes a
 * value that is already there.
 *
 * Pure: `planSync` returns the writes; the hook performs them.
 */
import { isBlocked, isReady, type LanePatient } from "./lanes";

export const OWNED_LABELS = new Set(["Order Prep", "Ready to Order"]);

export interface SyncWrite { itemId: string; name: string; from: string; to: "Order Prep" | "Ready to Order" }

export function planSync(patients: LanePatient[]): SyncWrite[] {
  const out: SyncWrite[] = [];
  for (const p of patients) {
    const current = (p.orderingCycle ?? "").trim();
    if (!OWNED_LABELS.has(current)) continue;
    if ((p as { isNotActive?: boolean }).isNotActive) continue;
    if (p.patientStatus !== "Active" || isBlocked(p)) continue;
    const to = isReady(p) ? "Ready to Order" : "Order Prep";
    if (to === current) continue;
    out.push({ itemId: String(p.mondayItemId), name: p.name, from: current, to });
  }
  return out;
}

/** "3 → Ready to Order · 1 → Order Prep" */
export function describeSync(writes: SyncWrite[]): string {
  const up = writes.filter((w) => w.to === "Ready to Order").length;
  const down = writes.length - up;
  return [up ? `${up} → Ready to Order` : "", down ? `${down} → Order Prep` : ""].filter(Boolean).join(" · ");
}
