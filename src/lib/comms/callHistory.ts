/**
 * Patient call history — normalising RingCentral's call-log into something a
 * rep can read at a glance.
 *
 * Ported verbatim from command-center `src/lib/callHistory/callHistory.ts`.
 * Pure: no fetching, no React. The RingCentral REST calls live in
 * `lib/comms/gateway.ts`; everything that decides *what a record means* is
 * here so it can be tested without a network.
 *
 * ⚠️ The whole reason this file exists is that `result` cannot be read
 * literally. See `callConnected` — a call a rep actually TOOK can arrive with a
 * terminal-looking top-level result, because claiming an inbound call forwards
 * it and tears down the original leg (the same trap that once flashed "Missed" at
 * the person who had just answered).
 */

/** One call with this patient, normalised from a RingCentral call-log record. */
export interface PatientCall {
  id: string;
  /** Ours vs theirs. Inbound = the patient called the MM line. */
  direction: "Inbound" | "Outbound";
  /** ISO start time, straight from RingCentral (UTC). */
  startTime: string;
  /** Talk time in seconds. 0 for a call that never connected. */
  durationSec: number;
  /** RingCentral's raw `result`, kept for the tooltip — never parsed by eye. */
  result: string;
  /** Somebody talked. See `callConnected` for why this isn't `result` alone. */
  connected: boolean;
  /** Went to voicemail — a missed call that left something to listen to. */
  voicemail: boolean;
  /** The other party's number (the patient), E.164 where RingCentral gave one. */
  otherNumber: string;
  /** Recording, when the account records calls AND the app may read them.
   *  Absent is the normal case, not an error — see `fetchPatientCallHistory`. */
  recording?: { id: string; contentUri: string };
  /** A voicemail is not a call recording: RingCentral files it in the message
   *  store and the call-log record only points at it. `uri` is the message
   *  resource; its AudioRecording attachment is the audio. */
  voicemailMessage?: { id: string; uri: string };
}

/**
 * RingCentral `result` values that mean the two parties were actually
 * connected. Matched EXACTLY (lower-cased), never by substring: "Answered Not
 * Accepted" is a missed call and contains "answered", so a substring test would
 * silently count rung-but-abandoned calls as conversations.
 */
const CONNECTED_RESULTS = new Set(["accepted", "call connected", "connected", "answered", "ok"]);

/** Results that mean the caller left (or reached) voicemail. */
const VOICEMAIL_RESULTS = new Set(["voicemail", "message left"]);

/**
 * Results that explicitly mean nobody was reached.
 *
 * ⚠️ This set exists to OUTRANK the duration fallback below. RingCentral
 * reports ring time in `duration` on some missed calls, so "duration > 0 means
 * somebody talked" — true for an unlabelled call — turns an 18-second ring into
 * an 18-second conversation. When RingCentral has named the outcome, its label
 * wins; the duration heuristic is only for results we don't recognise.
 */
const MISSED_RESULTS = new Set([
  "missed",
  "no answer",
  "busy",
  "rejected",
  "declined",
  "hang up",
  "abandoned",
  "stopped",
  "blocked",
  "call failed",
  "answered not accepted",
  "unknown caller",
]);

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/**
 * Did anyone actually talk?
 *
 * ⚠️ Reads the LEGS, not just the top-level result. When a rep claims an
 * inbound call from the Command Center, RingCentral forwards the party — which
 * terminates the original inbound leg and can stamp the parent record with a
 * result that reads as missed. The forwarded leg is the one that connected, so
 * "any leg connected ⇒ the call connected" is the only reading that doesn't
 * report a taken call as missed.
 *
 * A non-zero talk time counts too: a call with duration can't have been missed,
 * whatever label RingCentral put on it.
 */
export function callConnected(record: {
  result?: string;
  duration?: number;
  legs?: Array<{ result?: string; duration?: number }>;
}): boolean {
  if (CONNECTED_RESULTS.has(norm(record.result))) return true;
  if ((record.legs ?? []).some((l) => CONNECTED_RESULTS.has(norm(l.result)))) return true;
  // Voicemail has a duration (the message) but nobody talked to the patient.
  if (isVoicemail(record)) return false;
  // An outcome RingCentral named beats a duration we're inferring from.
  if (MISSED_RESULTS.has(norm(record.result))) return false;
  return Number(record.duration ?? 0) > 0;
}

/** Did it reach voicemail? Checked on the legs too, for the same reason. */
export function isVoicemail(record: {
  result?: string;
  legs?: Array<{ result?: string }>;
}): boolean {
  if (VOICEMAIL_RESULTS.has(norm(record.result))) return true;
  return (record.legs ?? []).some((l) => VOICEMAIL_RESULTS.has(norm(l.result)));
}

/** Raw RingCentral call-log record (only the fields we read). */
export interface RcCallLogRecord {
  id?: string | number;
  sessionId?: string;
  startTime?: string;
  duration?: number;
  direction?: string;
  result?: string;
  /** RingCentral's own name for the party — a contact where it has one, else
   *  the carrier CNAM. */
  from?: { phoneNumber?: string; name?: string };
  to?: { phoneNumber?: string; name?: string };
  recording?: { id?: string | number; contentUri?: string };
  message?: { id?: string | number; uri?: string; type?: string };
  legs?: Array<{ result?: string; duration?: number; recording?: { id?: string | number; contentUri?: string }; message?: { id?: string | number; uri?: string; type?: string } }>;
}

/** Last 10 digits — the only substring present in every rendering of a US
 *  number, so it's what matching keys off (same rule as gateway.ts). */
const last10 = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);

/**
 * The `phoneNumber` value RingCentral's CALL-LOG filter accepts. **Digits
 * only — NOT E.164.**
 *
 * ⚠️ The call-log filter returns ZERO records for a leading "+": HTTP 200, an
 * empty list, no error, no warning. The message-store filter (SMS + fax) is
 * the exact opposite — it wants the "+" and works fine with it, which is why
 * texting and the fax inbox have always been correct. Two filters on the same
 * API with opposite expectations, and the call-log's way of disagreeing is to
 * look precisely like a patient nobody has ever called.
 *
 * Verified against the live account, same patient, same window:
 *   "+17174242514" → 0 records      "17174242514" → 13
 *   "(717) 424-2514" → 0 records    "7174242514"  → 13
 *
 * So formatting is not cosmetic here — do not "tidy" this back to toE164(),
 * and do not reuse `toE164` output for a call-log query. The E.164 form is
 * still what the local re-match and the display use; only the QUERY differs.
 */
export function callLogPhoneParam(phone: string): string {
  return String(phone ?? "").replace(/\D/g, "");
}

/**
 * Normalise one RingCentral record. Returns null for a record we can't place in
 * time, because a call with no timestamp can't be sorted or shown honestly.
 */
export function toPatientCall(record: RcCallLogRecord): PatientCall | null {
  const startTime = String(record.startTime ?? "");
  if (!startTime) return null;
  const direction = norm(record.direction) === "outbound" ? "Outbound" : "Inbound";
  const connected = callConnected(record);
  // A recording can hang off the parent or off the leg that actually carried
  // the audio; a forwarded (claimed) call records on the leg.
  const rec =
    (record.recording?.contentUri ? record.recording : undefined) ??
    (record.legs ?? []).map((l) => l.recording).find((r) => r?.contentUri);
  const vm =
    (record.message?.uri && /voice/i.test(String(record.message.type ?? "VoiceMail")) ? record.message : undefined) ??
    (record.legs ?? []).map((l) => l.message).find((m) => m?.uri && /voice/i.test(String(m.type ?? "VoiceMail")));
  return {
    id: String(record.id ?? record.sessionId ?? startTime),
    direction,
    startTime,
    // A call that never connected has no talk time, whatever RingCentral says.
    durationSec: connected ? Math.max(0, Number(record.duration ?? 0)) : 0,
    result: String(record.result ?? ""),
    connected,
    voicemail: isVoicemail(record),
    otherNumber:
      (direction === "Inbound" ? record.from?.phoneNumber : record.to?.phoneNumber) ?? "",
    ...(rec?.contentUri
      ? { recording: { id: String(rec.id ?? ""), contentUri: String(rec.contentUri) } }
      : {}),
    ...(vm?.uri ? { voicemailMessage: { id: String(vm.id ?? ""), uri: String(vm.uri) } } : {}),
  };
}

/**
 * Normalise a page of records for one patient: keep only calls with that
 * number, newest first.
 *
 * The `phone` filter is belt-and-braces — RingCentral is asked for one number —
 * but the shared MM line means a stray record here would show one patient's
 * call on another's profile, so it is re-checked locally.
 */
export function toPatientCalls(records: RcCallLogRecord[], phone: string): PatientCall[] {
  const want = last10(phone);
  return records
    .map(toPatientCall)
    .filter((c): c is PatientCall => c !== null)
    .filter((c) => !want || last10(c.otherNumber) === want)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

/** Talk time as `m:ss` (or `h:mm:ss`). A call that never connected has no
 *  duration to show, so it reads as an em dash rather than "0:00". */
export function formatCallDuration(seconds: number): string {
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s) || s <= 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Short label for the outcome, e.g. "Missed" / "Voicemail" / "3:07". */
export function callOutcomeLabel(call: PatientCall): string {
  if (call.voicemail) return "Voicemail";
  if (!call.connected) return call.direction === "Inbound" ? "Missed" : "No answer";
  return formatCallDuration(call.durationSec);
}

export interface CallHistorySummary {
  total: number;
  /** Inbound calls nobody took — the number worth badging. */
  missedInbound: number;
  /** Any call that connected, either direction. */
  connected: number;
  /** Calls with audio we could offer to play. */
  recorded: number;
  /** Newest call's ISO time, or "" when there are none. */
  lastCallAt: string;
}

/** Roll a history up for the header badge. */
export function summarizeCalls(calls: PatientCall[]): CallHistorySummary {
  return {
    total: calls.length,
    missedInbound: calls.filter((c) => c.direction === "Inbound" && !c.connected).length,
    connected: calls.filter((c) => c.connected).length,
    recorded: calls.filter((c) => !!c.recording).length,
    lastCallAt: calls.reduce(
      (newest, c) => (!newest || new Date(c.startTime) > new Date(newest) ? c.startTime : newest),
      "",
    ),
  };
}
