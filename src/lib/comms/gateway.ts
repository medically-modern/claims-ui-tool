/**
 * The Comms panel's client for Josh's `monday-gateway` (Railway) — the one
 * service that holds the RingCentral credentials. The browser never talks to
 * RingCentral directly.
 *
 * Ported from command-center `src/lib/fax/ringcentralApi.ts` (the pieces this
 * app needs: the `/rc` proxy fetch, E.164 normalisation, the call-log read and
 * media downloads). Two gateway surfaces are used:
 *
 *   `${GATEWAY}/rc/<restapi path>`   — allow-listed RingCentral proxy
 *                                       (call-log, message-store content).
 *                                       CORS-locked; no sign-in required.
 *   `${GATEWAY}/messaging/*`         — the text thread with staff attribution
 *                                       (see messagingApi.ts). Sign-in required.
 *
 * ⚠️ Every request here spends the account's SHARED RingCentral budget (the
 * gateway's `rcGuard`, ~90 calls per window across the Command Center and this
 * app). Fetch on a click, never on render, and cache per session (cache.ts).
 */
import { getIdToken } from "./auth";
import { callLogPhoneParam, toPatientCalls, type PatientCall, type RcCallLogRecord } from "./callHistory";

const GATEWAY =
  (import.meta.env.VITE_COMMS_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

/** The gateway URL is configured for this build. */
export function commsConfigured(): boolean {
  return !!GATEWAY;
}
export function gatewayUrl(): string {
  return GATEWAY;
}

/** Thrown when the gateway answers 401 — the route needs a signed-in
 *  @medicallymodern.com account. The sheet reacts by showing the sign-in gate. */
export class SignInRequiredError extends Error {
  constructor(msg = "Sign in required") {
    super(msg);
    this.name = "SignInRequiredError";
  }
}

/** Headers for any gateway call: JSON + the Google ID token when we have one. */
export function gatewayHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getIdToken();
  if (token) headers["X-MM-Auth"] = token;
  return headers;
}

/**
 * Normalise to E.164 or return "" — never invent a number. A short Monday value
 * used to become "+310213829", which RingCentral parsed as a Netherlands number
 * and which matched no conversation, so the thread looked empty. A number we
 * cannot normalise must be reported as MISSING.
 */
export function toE164(raw: string): string {
  const t = String(raw ?? "").trim();
  const d = t.replace(/[^0-9]/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  if (t.startsWith("+") && d.length >= 11 && d.length <= 15) return "+" + d;
  return "";
}

/**
 * Fetch through the gateway's RingCentral proxy. A relative `/restapi/...` path
 * goes to `${GATEWAY}/rc<path>`; an absolute URL (media.ringcentral.com content:
 * recordings, MMS attachments) goes through `/rc/fetch?url=`.
 */
export async function rcFetch(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
  if (!GATEWAY) throw new Error("The Comms gateway isn't configured for this build (VITE_COMMS_GATEWAY_URL).");
  const target = /^https?:\/\//.test(pathOrUrl)
    ? `${GATEWAY}/rc/fetch?url=${encodeURIComponent(pathOrUrl)}`
    : `${GATEWAY}/rc${pathOrUrl}`;
  const headers = gatewayHeaders((init.headers as Record<string, string>) || {});
  const res = await fetch(target, { ...init, headers });
  if (res.status === 401) throw new SignInRequiredError();
  return res;
}

/**
 * A patient's calls with the MM line, both directions, newest first.
 *
 * ⚠️ `dateFrom` is explicit: RingCentral's default window is roughly the last
 * day, so without it a patient's call history silently starts at "yesterday".
 * ⚠️ The phone filter is DIGITS, not E.164 — a leading "+" makes the call-log
 * filter return an empty list with a 200. See `callLogPhoneParam`.
 */
export async function fetchPatientCallHistory(
  phone: string,
  opts: { sinceDays?: number; perPage?: number } = {},
): Promise<PatientCall[]> {
  const num = toE164(phone);
  if (!num) return [];
  const dateFrom = new Date(Date.now() - (opts.sinceDays ?? 365) * 24 * 60 * 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/call-log` +
    `?phoneNumber=${encodeURIComponent(callLogPhoneParam(num))}&type=Voice&view=Detailed` +
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=${opts.perPage ?? 100}`;
  const res = await rcFetch(path);
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        "RingCentral rejected the call-log read (403). The app record is probably missing the ReadCallLog permission.",
      );
    }
    if (res.status === 429) throw new Error("RingCentral is rate-limiting us right now. Try again in a minute.");
    throw new Error(`RingCentral call history failed (${res.status})`);
  }
  const json = (await res.json()) as { records?: RcCallLogRecord[] };
  return toPatientCalls(json.records ?? [], num);
}

/** Download a call recording (through the gateway) as a blob: URL. Callers own
 *  revoking it. Only runs for audio RingCentral has already said exists. */
export async function fetchRecordingBlobUrl(contentUri: string): Promise<string> {
  if (!contentUri) throw new Error("No recording attached to this call");
  const res = await rcFetch(contentUri);
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        "RingCentral rejected the recording download (403). The app record is probably missing the ReadCallRecording permission.",
      );
    }
    throw new Error(`RingCentral recording download failed (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * A voicemail's audio (and transcript, when RingCentral made one) as a blob
 * URL. The call log only points at the message; the message lists its
 * attachments; the AudioRecording attachment is the sound.
 *
 * ⚠️ Works for voicemails in the mailbox the gateway is signed in as. A
 * voicemail left on another extension (a queue, the main line) 403s until the
 * gateway allow-lists `/account/~/extension/{id}/message-store/…` and the RC
 * app can read other mailboxes (Jesus Sarmiento, 2026-08-21, ext 63007214012).
 */
export async function fetchVoicemail(messageUri: string): Promise<{ audioUrl: string; transcript?: string }> {
  if (!messageUri) throw new Error("No voicemail attached to this call");
  const res = await rcFetch(messageUri);
  if (res.status === 403 || res.status === 404) {
    throw new Error("This voicemail is in a different RingCentral mailbox than the one the gateway reads (main line / queue). Listen in RingCentral for now.");
  }
  if (!res.ok) throw new Error(`RingCentral voicemail lookup failed (${res.status})`);
  const msg = (await res.json()) as { attachments?: Array<{ type?: string; contentType?: string; uri?: string }> };
  const atts = msg.attachments ?? [];
  const audio = atts.find((a) => a.type === "AudioRecording" && a.uri) ?? atts.find((a) => /^audio\//.test(a.contentType ?? "") && a.uri);
  if (!audio?.uri) throw new Error("RingCentral has no audio for this voicemail");
  const audioRes = await rcFetch(audio.uri);
  if (!audioRes.ok) throw new Error(`RingCentral voicemail download failed (${audioRes.status})`);
  const audioUrl = URL.createObjectURL(await audioRes.blob());
  let transcript: string | undefined;
  const tr = atts.find((a) => a.type === "AudioTranscription" && a.uri);
  if (tr?.uri) {
    try {
      const t = await rcFetch(tr.uri);
      if (t.ok) transcript = (await t.text()).trim() || undefined;
    } catch { /* the transcript is a bonus */ }
  }
  return { audioUrl, transcript };
}

/** Bytes for any allow-listed RingCentral content URL — an MMS attachment — as
 *  a blob URL the browser can render. Callers own revoking the URL. */
export async function fetchRcContentBlobUrl(contentUri: string): Promise<string> {
  if (!contentUri) throw new Error("No attachment content URL");
  const res = await rcFetch(contentUri);
  if (!res.ok) throw new Error(`RingCentral attachment download failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
