// Client for snoozing a Late ERA row after the operator ran a claim
// status check and confirmed the payer is still processing. Pushes
// "Late Action Date" (Monday column date_mm153jp1) to today + N days
// so the row drops out of the Check Status tab and into the Snoozed
// tab until the date elapses.
//
// Wraps the same backend endpoint as snoozeDocsUploaded
// (POST /claims/snooze-docs-uploaded) — both flows write the same
// column, just with different N values. We give it a distinct module
// + name so call sites read clearly ("Keep Outstanding" vs "Docs
// Uploaded") and so the default cadence (10 calendar days) lives in
// one obvious place.
//
// Calendar days, not business days — matches operator expectation
// that 10 days from a Friday Keep-Outstanding press means the row
// reappears on the second Monday after, not 14 calendar days later.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

const KEEP_OUTSTANDING_DAYS = 10;

export interface SnoozeLateEraResult {
  item_id: string;
  /** YYYY-MM-DD the snooze runs until — Late Action Date column value. */
  snoozed_until: string;
  column_id: string;
}

export class SnoozeLateEraError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SnoozeLateEraError";
  }
}

export function isSnoozeLateEraConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

/**
 * Snooze a Late ERA claim because the operator just ran a claim status
 * check and the payer reports it as still processing. Idempotent: a
 * second Keep Outstanding click pushes the date forward to today + 10
 * regardless of whatever the prior snooze was.
 *
 * @param mondayItemId the parent Claims Board item id
 * @param days override the default 10-day cadence
 */
export async function snoozeLateEra(
  mondayItemId: string,
  days: number = KEEP_OUTSTANDING_DAYS,
): Promise<SnoozeLateEraResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new SnoozeLateEraError(
      "Snooze Late ERA is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/snooze-docs-uploaded`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({ item_id: mondayItemId, days }),
    });
  } catch (e) {
    throw new SnoozeLateEraError(
      `Network error calling /claims/snooze-docs-uploaded: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SnoozeLateEraError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }
  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new SnoozeLateEraError(detail, res.status);
  }
  return body as SnoozeLateEraResult;
}
