/**
 * orderStamps.ts — the two per-order decisions an operator can make from the
 * patient page, and how they are stored so they expire with the order.
 *
 *   Correspondence Reviewed  text_mm7czwqr   "I read the messages for this order"
 *   Confirm Override         text_mm7cmkec   "Advance this order although Confirm is not green"
 *
 * Both are text cells written by the tool in one shape:
 *
 *   <ISO local minute> <initials> for <Next Order yyyy-mm-dd>[ — <reason>]
 *   e.g. "2026-09-20T14:05 BE for 2026-09-19 — patient confirmed by phone"
 *
 * "for <date>" is what makes the stamp per-order without any automation:
 * when the order goes out and Next Order moves, the stamp no longer names
 * the current order and stops applying. Nothing has to clear it (Brandon,
 * 2026-09-20: overrides are per order only).
 *
 * Pure: no Monday, no React.
 */

export interface OrderStamp {
  /** epoch ms of the stamp (parsed as local time — the office clock). */
  at: number;
  iso: string;
  initials: string;
  /** The Next Order date the stamp was made for. */
  forOrder: string;
  reason: string;
}

const STAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\s+(\S+)\s+for\s+(\d{4}-\d{2}-\d{2})(?:\s+[—–-]\s+(.*))?$/s;

export function parseStamp(raw: string | null | undefined): OrderStamp | null {
  const m = STAMP_RE.exec(String(raw ?? "").trim());
  if (!m) return null;
  const at = new Date(m[1] + ":00").getTime();
  if (!Number.isFinite(at)) return null;
  return { at, iso: m[1], initials: m[2], forOrder: m[3], reason: (m[4] ?? "").trim() };
}

/** A stamp only counts for the order it names. */
export function stampFor(raw: string | null | undefined, nextOrderDate: string | null | undefined): OrderStamp | null {
  const s = parseStamp(raw);
  if (!s) return null;
  const cur = String(nextOrderDate ?? "").slice(0, 10);
  return cur && s.forOrder === cur ? s : null;
}

function localIsoMinute(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function makeStamp(opts: { initials: string; nextOrderDate: string; reason?: string; now?: Date }): string {
  const base = `${localIsoMinute(opts.now ?? new Date())} ${opts.initials || "MM"} for ${String(opts.nextOrderDate).slice(0, 10)}`;
  const reason = (opts.reason ?? "").replace(/\s+/g, " ").trim();
  return reason ? `${base} — ${reason}` : base;
}

/** "2026-09-20T14:05" → "9/20 2:05 PM" for a chip. */
export function fmtStamp(s: OrderStamp): string {
  const d = new Date(s.at);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
