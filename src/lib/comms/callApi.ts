/**
 * Place an outbound call to a patient through the gateway, using RingCentral
 * RingOut: the gateway rings the signed-in operator's phone FIRST, then dials
 * the patient and bridges the two. The browser never touches RingCentral, and
 * there is no softphone — the operator talks on their own RingCentral phone.
 *
 * Sign-in matters here (unlike the read-only call log): the gateway needs the
 * verified X-MM-Auth identity to know whose phone to ring back.
 *
 * ⚠️ Route + body are Josh's to confirm on the gateway (2026-09-22) — mirrors
 * how /messaging/send was settled. If he names the route or fields differently,
 * only the constants here change.
 */
import { gatewayHeaders, gatewayUrl, SignInRequiredError } from "./gateway";

/** The gateway's RingOut route. ASSUMED — confirm with Josh. */
const RINGOUT_ROUTE = "/calls/ringout";

export async function placeCall(to: string, mondayItemId?: string): Promise<void> {
  const base = gatewayUrl();
  if (!base) throw new Error("The Comms gateway isn't configured for this build (VITE_COMMS_GATEWAY_URL).");
  if (!to) throw new Error("No usable phone number for this patient.");
  let res: Response;
  try {
    res = await fetch(`${base}${RINGOUT_ROUTE}`, {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ to, ...(mondayItemId ? { mondayItemId } : {}) }),
    });
  } catch (e) {
    throw new Error(`Network error: ${(e as Error).message}`);
  }
  if (res.status === 401) throw new SignInRequiredError();
  if (res.ok) return; // RingOut accepted — the operator's phone rings next.

  let payload: { error?: string } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    /* keep empty */
  }
  if (res.status === 503) throw new Error("Calling isn't set up on the gateway right now.");
  if (res.status === 502) throw new Error(payload.error || "The gateway hit an upstream error placing the call — try again.");
  throw new Error(payload.error || `Placing the call failed (${res.status})`);
}
