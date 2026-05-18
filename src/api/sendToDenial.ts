// Client for POST /claims/send-to-denial — fired from the ERA Review
// row button. Backend flips Primary Status to "Denied (Or Partly)" AND
// writes the Subscription Board's Primary Claim Paid? column to:
//   - "Denied"  when every subitem's Primary Paid is $0
//   - "Partial" when at least one subitem has Primary Paid > 0
// Secondary Claim Paid? cleared to "None" either way.

export interface SendToDenialResult {
  primary_updated: boolean;
  denial_label: "Denied" | "Partial";
  subscription_synced: boolean;
}

export class SendToDenialError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "SendToDenialError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isSendToDenialConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function sendToDenial(
  mondayItemId: string,
): Promise<SendToDenialResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new SendToDenialError(
      "Send to Denial is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/send-to-denial`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({ item_id: mondayItemId }),
    });
  } catch (e) {
    throw new SendToDenialError(
      `Network error calling /claims/send-to-denial: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SendToDenialError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new SendToDenialError(detail, res.status, body);
  }

  return body as SendToDenialResult;
}
