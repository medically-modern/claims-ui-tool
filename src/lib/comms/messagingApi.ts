/**
 * The patient's text thread, from the gateway's `/messaging/conversation`.
 *
 * Ported from command-center `src/lib/assignedPatients/messagingApi.ts` (read
 * side only — this panel doesn't send texts yet).
 *
 * Why this route rather than the raw RingCentral message-store: the gateway
 * pages the whole history (SMS + MMS, ten years back), merges its own archive
 * of texts RingCentral has already purged, and — the part that matters at
 * reorder time — stamps each outbound message with WHICH STAFF MEMBER sent it,
 * from the verified Google token recorded at send time. That record lives only
 * on the gateway, which is why this route needs a signed-in account.
 */
import { gatewayHeaders, gatewayUrl, SignInRequiredError } from "./gateway";
import { smsFailureReason } from "./smsDelivery";

/** A media part of an MMS — a photo the patient texted back, a PDF, etc. The
 *  uri needs the RC bearer token, so it's fetched through `/rc/fetch`. */
export interface MessageAttachment {
  id: number;
  contentType: string;
  uri: string;
}

export interface ConversationMessage {
  id: number;
  direction: "Inbound" | "Outbound";
  text: string;
  /** ISO timestamp (UTC instant). */
  time: string;
  /** Which employee sent it. Absent for inbound, and for outbound messages sent
   *  before this tracking existed or from outside the Command Center (e.g. the
   *  automated reorder text, or a text typed in the RingCentral app). */
  sentBy?: string;
  /** Present on MMS — the message's media parts. */
  attachments?: MessageAttachment[];
  /** RingCentral's delivery verdict, verbatim: `Queued` · `Sent` · `Delivered`
   *  · `SendingFailed` · `DeliveryFailed` · `Received`. Read it through
   *  smsDelivery.ts, never by comparing strings at the call site. */
  messageStatus?: string;
  /** RingCentral's `deliveryErrorCode` on a failed send, e.g. `SMS-RC-410`. */
  deliveryError?: string;
}

export interface ConversationResult {
  /** Oldest → newest. */
  messages: ConversationMessage[];
  /** Whether the whole history was read (the gateway caps paging). */
  complete: boolean;
}

/**
 * Send failed after the request reached the gateway. `retryable` says whether
 * re-sending is safe: a 502 that carries a RingCentral `deliveryError` means RC
 * ACCEPTED the text and then gave up on it (a landline, a dead number), so a
 * resend would double-text the patient — never retry that one. A 502 with only
 * `error` is a genuine upstream failure and is safe to retry.
 */
export class SendFailedError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly deliveryError?: string) {
    super(message);
    this.name = "SendFailedError";
  }
}

/** The gateway's send route. Field names differ from the read route on purpose:
 *  it takes `to`, not `phone` (Josh, 2026-09-21). */
const SEND_ROUTE = "/messaging/send";

/**
 * Send one SMS through the gateway. The gateway normalizes `to` to E.164,
 * stamps the sender from the verified X-MM-Auth token, and calls RingCentral.
 * There is no `from` — the sending line is server-side config.
 *
 * ⚠️ A resolved promise (HTTP 200) means RingCentral ACCEPTED the message, NOT
 * that it was delivered. The delivery verdict (`SendingFailed` on a bad number)
 * lands seconds later and only ever appears on the thread, so the caller should
 * refetch the conversation and let the bubble's delivery note show the outcome
 * rather than claiming "sent".
 */
export async function sendMessage(to: string, text: string, mondayItemId?: string): Promise<void> {
  const base = gatewayUrl();
  if (!base) throw new Error("The Comms gateway isn't configured for this build (VITE_COMMS_GATEWAY_URL).");
  const body = text.trim();
  if (!body) throw new Error("Nothing to send.");
  let res: Response;
  try {
    res = await fetch(`${base}${SEND_ROUTE}`, {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ to, text: body, ...(mondayItemId ? { mondayItemId } : {}) }),
    });
  } catch (e) {
    throw new SendFailedError(`Network error: ${(e as Error).message}`, true);
  }
  if (res.status === 401) throw new SignInRequiredError();
  if (res.ok) return; // RingCentral accepted it; the thread carries the real verdict.

  let payload: { error?: string; deliveryError?: string } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    /* keep empty */
  }
  if (res.status === 503) {
    throw new SendFailedError("Texting isn't set up on the gateway right now.", false);
  }
  if (res.status === 502) {
    // deliveryError → RC took it and gave up. Not retryable (would double-text).
    if (payload.deliveryError) {
      throw new SendFailedError(smsFailureReason(payload.deliveryError), false, payload.deliveryError);
    }
    // error only → a real upstream failure, safe to retry.
    throw new SendFailedError(payload.error || "The texting gateway hit an upstream error — try again.", true);
  }
  // 400 (bad recipient/body) and anything else: don't auto-retry.
  throw new SendFailedError(payload.error || `Sending failed (${res.status})`, false);
}

export async function fetchConversation(phone: string): Promise<ConversationResult> {
  const base = gatewayUrl();
  if (!base) throw new Error("The Comms gateway isn't configured for this build (VITE_COMMS_GATEWAY_URL).");
  const res = await fetch(`${base}/messaging/conversation`, {
    method: "POST",
    headers: gatewayHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ phone }),
  });
  if (res.status === 401) throw new SignInRequiredError();
  if (!res.ok) {
    let msg = `Loading conversation failed (${res.status})`;
    try {
      const e = (await res.json()) as { error?: string };
      if (e?.error) msg = e.error;
    } catch {
      /* keep default */
    }
    if (res.status === 429) msg = "RingCentral is rate-limiting us right now. Try again in a minute.";
    throw new Error(msg);
  }
  const j = (await res.json()) as ConversationResult;
  return { messages: j.messages ?? [], complete: !!j.complete };
}
