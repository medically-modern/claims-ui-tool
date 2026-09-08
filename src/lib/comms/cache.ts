/**
 * Per-session memo of what the Comms panel has already pulled, keyed by the
 * patient's E.164 number.
 *
 * This is the rate-budget rule from the Command Center made concrete: opening
 * the same patient twice in one sitting must not cost two RingCentral reads.
 * In-memory only (a reload starts clean — texts change), and a FAILED load is
 * evicted so the next open retries instead of replaying the error.
 */
import { fetchPatientCallHistory } from "./gateway";
import { fetchConversation, type ConversationResult } from "./messagingApi";
import type { PatientCall } from "./callHistory";

interface Entry<T> {
  promise: Promise<T>;
  at: number;
}

const conversations = new Map<string, Entry<ConversationResult>>();
const calls = new Map<string, Entry<PatientCall[]>>();

function memo<T>(map: Map<string, Entry<T>>, key: string, load: () => Promise<T>, force: boolean): Promise<T> {
  const hit = map.get(key);
  if (hit && !force) return hit.promise;
  const promise = load().catch((e) => {
    // Don't cache failures.
    if (map.get(key)?.promise === promise) map.delete(key);
    throw e;
  });
  map.set(key, { promise, at: Date.now() });
  return promise;
}

export function getConversation(phoneE164: string, force = false): Promise<ConversationResult> {
  return memo(conversations, phoneE164, () => fetchConversation(phoneE164), force);
}

export function getCalls(phoneE164: string, force = false): Promise<PatientCall[]> {
  return memo(calls, phoneE164, () => fetchPatientCallHistory(phoneE164), force);
}

/** When the cached copy was fetched (ms since epoch), or null. */
export function fetchedAt(kind: "texts" | "calls", phoneE164: string): number | null {
  const e = (kind === "texts" ? conversations : calls).get(phoneE164);
  return e ? e.at : null;
}

/** Forget everything — used after sign-in so a 401'd attempt is retried. */
export function clearCommsCache(): void {
  conversations.clear();
  calls.clear();
}
