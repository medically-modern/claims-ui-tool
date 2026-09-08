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
