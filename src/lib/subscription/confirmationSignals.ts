/**
 * confirmationSignals.ts — "is there something to read before we order?"
 *
 * Spec: REORDER_PROCESS.md step 2 + Brandon 2026-09-14. The backend triage
 * job (stedi-monday-integration/services/reorder_triage_service.py) decides
 * the same question server-side and writes the board; this module is the
 * browser's read of the same two columns, so the row can show the state
 * without waiting for the next cron tick.
 *
 * The row answers ONE question at a glance: can I order for this patient?
 * Everything else — what they edited, whether they delayed, who overrode a
 * check — is nuance that belongs in the profile, not on the row (Brandon,
 * 2026-09-19). The single exception is correspondence: if somebody said
 * something, you have to read it before you order, and that cannot wait for
 * a click.
 *
 * So the row carries exactly one badge, and this module decides it. Three
 * sources feed it, because from the operator's side they are the same fact —
 * "there is something here to read":
 *
 *   Patient Help Message      long_text_mm3xnb6k   the patient typed it in the portal
 *   Subscription Notes        text_mm6vp1z3        our team wrote it down
 *   an inbound text or call   text_mm5frhe9        stamped by the triage job
 *
 * Patient Portal Notes (long_text_mm3evvzj) is deliberately NOT here and is
 * not read anywhere in this tool — Brandon, 2026-09-19. Two note columns, one
 * ours and one the patient's, is the whole surface.
 *
 * ⚠️ SCOPED TO THIS ORDER, NOT TO ALL TIME. The window opens 30 days before
 * the order date. Without that, a note from six months ago badges the row
 * forever — the failure that made the old Pencil badge worthless (measured
 * 2026-09-19: of the pencils on unanswered rows, 11 were from a previous
 * cycle against 1 from the current one, and 33 of the change lines said
 * "Cartridge quantity changed from 3 to 3").
 *
 * ⚠️ The note columns carry no timestamp of their own; `notesUpdatedAt` comes
 * from Monday's activity log (api/queries/noteActivity.ts). No timestamp means
 * no badge — an unknown age must not be treated as recent.
 */

/** Monday's Reorder Text Sent stamp: "Jul 12, 2026, 2:00 PM ET". */
const SENT_RE =
  /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AaPp])[Mm]/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parse the Reorder Text Sent cell to epoch ms, or null.
 *
 * The cell says "ET" and there is no zone-safe way to read that in the
 * browser without a date library, so it is parsed as local time. Every
 * operator is on the office clock, and the comparison it feeds ("did the
 * reply come after the ask?") has ~20 days of slack — an hour of zone skew
 * cannot change the answer.
 */
export function parseReorderTextSent(raw: string | undefined | null): number | null {
  const m = SENT_RE.exec(String(raw ?? ""));
  if (!m) return null;
  const [, mon, day, year, hour, minute, ampm] = m;
  const month = MONTHS.indexOf(mon.toLowerCase());
  if (month < 0) return null;
  const h = (Number(hour) % 12) + (ampm.toLowerCase() === "p" ? 12 : 0);
  const t = new Date(Number(year), month, Number(day), h, Number(minute)).getTime();
  return Number.isFinite(t) ? t : null;
}

export interface ContactStamp {
  /** epoch ms of the contact */
  at: number;
  direction: "in" | "out";
  channel: string;
  iso: string;
}

/**
 * Parse the Last Patient Contact cell — `"2026-09-08T20:08 in sms"`.
 * Written by the triage job; the same shape lanes.ts reads for the
 * Waiting-on-Patient watcher.
 */
export function parseContactStamp(raw: string | undefined | null): ContactStamp | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const [iso, dir, channel] = s.split(/\s+/);
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  return {
    at,
    direction: (dir || "").toLowerCase() === "out" ? "out" : "in",
    channel: (channel || "").toLowerCase() || "contact",
    iso,
  };
}

/** "2d ago" / "today" / "3w ago" — recency, not a timestamp. */
export function agoLabel(at: number, now: number = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export interface ReadSignal {
  /** Something was said that a human should read before ordering. */
  needsRead: boolean;
  /** Short reason for the tooltip and the "Needs a read" filter. */
  summary: string;
  /** Which sources fired, for the hover. */
  sources: string[];
  /** The hover itself: one line per thing to read, the message text included,
   *  e.g. "Subscription note: called back, wants 90 days" (Brandon,
   *  2026-09-19 — "when I hover over a confirm with a message icon, it should
   *  say what the message is"). Truncated; the profile has it in full. */
  lines: string[];
}

export interface ReadInputs {
  /** long_text_mm3xnb6k — the patient wrote this in the portal. */
  helpMessage?: string | null;
  /** text_mm6vp1z3 — our team wrote this. */
  coordinatorNotes?: string | null;
  /** Epoch ms of the most recent write to either note column, from the
   *  Monday activity log. Null/undefined = unknown age = does not count. */
  notesUpdatedAt?: number | null;
  /** text_mm5frhe9, "<ISO ts> in|out sms|call|email" */
  lastPatientContact?: string | null;
  /** yyyy-mm-dd — the window ends here and opens 30 days earlier. */
  orderDate?: string | null;
  /** Epoch ms when an operator marked this order's correspondence reviewed
   *  (Correspondence Reviewed, valid for this order only). Anything said
   *  before it has been read; anything after it re-raises the badge. */
  reviewedAt?: number | null;
}

/** How far before the order date a note or a text still counts. */
export const READ_WINDOW_DAYS = 30;

/** Start of the window: 30 days before the order date, or before today when
 *  the row has no order date (a patient with no date can still be talked to). */
export function readWindowStart(orderDate: string | null | undefined, now: number): number {
  const d = String(orderDate ?? "").slice(0, 10);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T00:00:00").getTime() : now;
  return anchor - READ_WINDOW_DAYS * 86_400_000;
}

/**
 * Is there anything to read on this patient before ordering?
 *
 * Note that a note written AFTER the order date still counts — the window has
 * a floor, not a ceiling. A coordinator writing something today about an order
 * that came due last Thursday is the most urgent case there is.
 */
export function readSignal(p: ReadInputs, now: number = Date.now()): ReadSignal {
  // The window floor, raised to the review stamp when there is one: read
  // messages do not badge; a newer one does.
  const reviewed = typeof p.reviewedAt === "number" ? p.reviewedAt : null;
  const since = Math.max(readWindowStart(p.orderDate, now), reviewed ?? 0);
  const sources: string[] = [];
  const lines: string[] = [];

  const noteAt = typeof p.notesUpdatedAt === "number" ? p.notesUpdatedAt : null;
  const noteFresh = noteAt != null && noteAt >= since;

  /** The two note columns, in the order the operator should read them:
   *  ours first (it is likelier to say what to do), the patient's second. */
  const notes: Array<[string, string | null | undefined]> = [
    ["Subscription note", p.coordinatorNotes],
    ["Patient portal", p.helpMessage],
  ];
  const written = notes.filter(([, v]) => String(v ?? "").trim().length > 0);
  if (noteFresh && written.length > 0) {
    sources.push(`note ${agoLabel(noteAt as number, now)}`);
    for (const [label, v] of written) lines.push(`${label}: ${excerpt(v)}`);
  }

  const contact = parseContactStamp(p.lastPatientContact);
  const contactCounts = !!contact && contact.direction === "in" && contact.at >= since;
  if (contactCounts && contact) {
    const verb = contact.channel === "call" ? "called"
      : contact.channel === "email" ? "emailed" : "texted";
    const ago = agoLabel(contact.at, now);
    sources.push(`${verb} ${ago}`);
    lines.push(`Patient ${verb} ${ago} — open Comms to read it`);
  }

  return {
    needsRead: sources.length > 0,
    summary: sources.join(" · "),
    sources,
    lines,
  };
}

/** How much of a note fits in a tooltip. Long enough to tell a "wants 90 days"
 *  from a "moving to Florida", short enough not to cover the row. */
export const EXCERPT_CHARS = 140;

/** One line of a note, whitespace collapsed, cut at a word where it can be. */
export function excerpt(raw: string | null | undefined, max = EXCERPT_CHARS): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}
