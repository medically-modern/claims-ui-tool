/**
 * sinceOrder.ts — what was said since the patient's last order, counted the
 * way the rail's tabs show it (Brandon, 2026-09-20): texts and calls since the
 * newest Order Board row, leaving out the automated texts — the reorder link
 * the cron sends, and the order summary it sends back when the patient
 * confirms. Those are ours and they are noise; the count is about
 * conversation.
 *
 * Pure: no gateway, no React.
 */
import type { ConversationMessage } from "./messagingApi";
import type { PatientCall } from "./callHistory";

const REORDER_LINK = /reorder\.medicallymodern\.com/i;
const ORDER_SUMMARY = /here'?s a summary of what we'?ll be sending you/i;
const SHIP_NOTICE = /your (order|package) (has )?shipped|tracking number|out for delivery|was delivered/i;

/** The texts our automations send from the same line as the team. */
export function isAutomatedText(m: ConversationMessage): boolean {
  if (m.direction !== "Outbound" || m.sentBy) return false;
  const t = m.text || "";
  return REORDER_LINK.test(t) || ORDER_SUMMARY.test(t) || SHIP_NOTICE.test(t);
}

/** ISO instant → is it on or after the yyyy-mm-dd day (local)? No day = everything counts. */
function onOrAfterDay(iso: string, day: string): boolean {
  if (!day) return true;
  const t = new Date(iso).getTime();
  const d = new Date(day.slice(0, 10) + "T00:00:00").getTime();
  return Number.isFinite(t) && Number.isFinite(d) ? t >= d : true;
}

/**
 * The day the last order went out, as the rail's "since" point.
 *   - the newest Order Board row for the patient, when there is one;
 *   - otherwise Next Order minus the order frequency ("30-Days" → 30), which
 *     is when the previous cycle's order would have gone out — the Order
 *     Board only goes back so far, and older patients have no row on it;
 *   - "" (everything counts) when neither is known, e.g. a first order.
 */
export interface SincePoint { day: string; estimated: boolean }

export function lastOrderDay(opts: { orderPlaced?: string | null; nextOrderDate?: string | null; orderFrequency?: string | null }): SincePoint {
  const placed = String(opts.orderPlaced ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(placed)) return { day: placed, estimated: false };
  const next = String(opts.nextOrderDate ?? "").slice(0, 10);
  const freq = Number((/(\d+)/.exec(opts.orderFrequency ?? "") ?? [])[1]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || !Number.isFinite(freq) || freq <= 0) return { day: "", estimated: false };
  const d = new Date(next + "T00:00:00");
  d.setDate(d.getDate() - freq);
  const p = (n: number) => String(n).padStart(2, "0");
  return { day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, estimated: true };
}

export function textsSince(messages: ConversationMessage[], sinceDay: string): ConversationMessage[] {
  return messages.filter((m) => !isAutomatedText(m) && onOrAfterDay(m.time, sinceDay));
}

export function callsSince(calls: PatientCall[], sinceDay: string): PatientCall[] {
  return calls.filter((c) => onOrAfterDay(c.startTime, sinceDay));
}
