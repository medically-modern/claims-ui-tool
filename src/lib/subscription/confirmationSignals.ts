/**
 * confirmationSignals.ts — "did the patient answer, and did anyone read it?"
 *
 * Spec: REORDER_PROCESS.md step 2 + Brandon 2026-09-14. The backend triage
 * job (stedi-monday-integration/services/reorder_triage_service.py) decides
 * the same question server-side and writes the board; this module is the
 * browser's read of the same two columns, so the row can show the state
 * without waiting for the next cron tick.
 *
 * Three outcomes on a due patient who never completed the portal:
 *
 *   silence        -> the job sets Patient Order Response = No Response
 *   they answered  -> EVALUATE: a human reads the thread and decides
 *   never asked    -> not our problem yet; the reorder cron fires at 20 days
 *
 * ⚠️ EVALUATE SURVIVES THE FLIP. Once the job has written "No Response" the
 * response column no longer says "blank", but the fact that they texted is
 * unchanged — so Evaluate keys off the CONTACT, not off the response being
 * empty. The flip is the default; the icon is the exception to it, and
 * hiding the exception once the default lands is how the signal would get
 * lost exactly when it matters.
 *
 * ⚠️ The stamp is compared against WHEN WE ASKED, not against "recently".
 * Three of five patients with contact on 2026-09-14 had last written on
 * Aug 25 — the day their reorder text fired for a Sep 14 order. Anything
 * time-boxed to the last few days discards real replies.
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

export interface EvaluateSignal {
  /** A human needs to read this thread before we decide. */
  evaluate: boolean;
  /** The contact that triggered it, when there is one. */
  contact: ContactStamp | null;
  /** e.g. "texted 2d ago" — for the badge tooltip and the filter row. */
  summary: string;
}

export interface ConfirmationInputs {
  /** Patient Order Response cell text. */
  orderResponse: string | undefined | null;
  /** Reorder Text Sent cell text. */
  reorderTextSent: string | undefined | null;
  /** Last Patient Contact cell text. */
  lastPatientContact: string | undefined | null;
}

const ANSWERED = /^(confirmed|delay)/i;

/**
 * Does this row need a human to read the correspondence?
 *
 * True when we asked, the patient never completed the portal, and there is
 * INBOUND contact at or after the ask. A patient who already confirmed (or
 * delayed) has answered — nothing to evaluate. An outbound-only stamp is us
 * talking, not them.
 */
export function evaluateSignal(
  p: ConfirmationInputs,
  now: number = Date.now(),
): EvaluateSignal {
  const none: EvaluateSignal = { evaluate: false, contact: null, summary: "" };
  const resp = String(p.orderResponse ?? "").trim();
  if (ANSWERED.test(resp)) return none;

  const asked = parseReorderTextSent(p.reorderTextSent);
  if (asked == null) return none;   // never asked → not an unanswered reorder

  const contact = parseContactStamp(p.lastPatientContact);
  if (!contact || contact.direction !== "in") return none;
  // A stamp from before the ask belongs to the previous cycle.
  if (contact.at < asked) return { ...none, contact };

  const verb = contact.channel === "call" ? "called" : contact.channel === "email" ? "emailed" : "texted";
  return {
    evaluate: true,
    contact,
    summary: `${verb} ${agoLabel(contact.at, now)}`,
  };
}
