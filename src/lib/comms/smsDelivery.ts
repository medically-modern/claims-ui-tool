/**
 * Did a text actually land? — the rule behind the "Not delivered" marker.
 *
 * Ported verbatim from command-center `src/lib/shared/smsDelivery.ts`.
 *
 * ⚠️ A successful send is NOT a delivered text. RingCentral accepts the
 * message, queues it, and only seconds later flips it to `SendingFailed` in the
 * message store — so the THREAD, not the send call, is where a failure becomes
 * visible. STATUS decides, CODE only explains: `messageStatus` is the verdict;
 * `deliveryErrorCode` is a reason we may or may not recognise.
 *
 * Codes are RingCentral's (developers.ringcentral.com/guide/messaging/sms/sms-errors);
 * the gateway passes them through verbatim and all interpretation lives here.
 */

export type SmsDeliveryState = "pending" | "delivered" | "failed";

/** RingCentral's terminal failure statuses. Everything else — `Queued`, `Sent`,
 *  `Received`, or a status we have never seen — is PENDING, never failed. */
const FAILED_STATUSES = new Set(["SendingFailed", "DeliveryFailed"]);

export function smsDeliveryState(messageStatus?: string): SmsDeliveryState {
  const s = (messageStatus ?? "").trim();
  if (FAILED_STATUSES.has(s)) return "failed";
  if (s === "Delivered") return "delivered";
  return "pending";
}

const REASONS: Array<{ codes: string[]; reason: string }> = [
  {
    codes: ["SMS-RC-410", "SMS-UP-410", "SMS-CAR-411", "SMS-CAR-400"],
    reason: "That number can't receive texts — it's a landline or not a working mobile number. Check the number on file.",
  },
  {
    codes: ["SMS-CAR-412"],
    reason: "The patient's phone was unreachable (off or out of service). Worth retrying later.",
  },
  {
    codes: ["SMS-RC-413", "SMS-UP-413", "SMS-CAR-413", "SMS-CAR-460"],
    reason: "The patient has opted out of texts from this number — don't re-send. Call them instead.",
  },
  {
    codes: ["SMS-RC-430", "SMS-UP-430", "SMS-UP-431", "SMS-CAR-430", "SMS-CAR-431", "SMS-CAR-435", "SMS-CAR-461"],
    reason: "The carrier blocked it as spam. Re-word it without links or all-caps and try again.",
  },
  {
    codes: ["SMS-UP-432", "SMS-CAR-432", "SMS-CAR-434"],
    reason: "The message was too long for the carrier. Shorten it and re-send.",
  },
  {
    codes: ["SMS-CAR-414", "SMS-UP-414", "SMS-RC-503", "SMS-RC-504", "SMS-RC-501"],
    reason: "Our texting number isn't set up to send this — nothing wrong with the patient's number. Flag it to Josh.",
  },
  {
    codes: ["SMS-RC-403", "SMS-CAR-450", "SMS-CAR-451", "SMS-CAR-452"],
    reason: "We've hit the texting limit for now. Try again later.",
  },
  {
    codes: ["SMS-CAR-410", "SMS-UP-433", "SMS-CAR-433", "SMS-RC-500", "SMS-UP-500", "SMS-CAR-500"],
    reason: "RingCentral or the carrier failed to send it. Try again.",
  },
  {
    codes: ["SMS-CAR-104", "SMS-CAR-199"],
    reason: "The carrier never confirmed delivery, so we can't tell whether it arrived. Follow up another way.",
  },
];

const BY_CODE = new Map<string, string>(
  REASONS.flatMap((r) => r.codes.map((c) => [c, r.reason] as const)),
);

export function smsFailureReason(deliveryErrorCode?: string): string {
  const code = (deliveryErrorCode ?? "").trim().toUpperCase();
  const known = BY_CODE.get(code);
  if (known) return known;
  if (code) return `RingCentral reported ${code}.`;
  return "RingCentral gave no reason. Check the number on file.";
}

/** The whole verdict for one message, for the UI to render or ignore. */
export function smsDelivery(m: { messageStatus?: string; deliveryError?: string }): {
  state: SmsDeliveryState;
  reason: string | null;
} {
  const state = smsDeliveryState(m.messageStatus);
  return { state, reason: state === "failed" ? smsFailureReason(m.deliveryError) : null };
}
