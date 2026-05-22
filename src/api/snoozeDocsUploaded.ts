// Client for POST /claims/snooze-docs-uploaded on the Stedi-Monday
// backend. Called from ClaimDetail's "Uploaded Docs" decision card on a
// Late-ERA claim. The backend writes Late Action Date (Monday column
// date_mm153jp1) = today + N days, which drops the row out of the
// Late ERA bucket until the date elapses (inLateEra checks this).
//
// Auth: X-Admin-Key header — same VITE_ADMIN_API_KEY pattern the rest
// of src/api/ uses.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export interface SnoozeDocsUploadedResult {
  item_id: string;
  /** YYYY-MM-DD the snooze runs until — Late Action Date column value. */
  snoozed_until: string;
  column_id: string;
}

export class SnoozeDocsUploadedError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SnoozeDocsUploadedError";
  }
}

export function isSnoozeDocsUploadedConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

/**
 * Snooze a claim from the Late ERA bucket because the operator just
 * uploaded medical docs to the payer and expects a response in ~N
 * days. Idempotent on the backend: re-calling pushes the date forward
 * to today + days regardless of any prior snooze.
 *
 * @param mondayItemId the parent Claims Board item id
 * @param days number of days to snooze (default 14)
 */
export async function snoozeDocsUploaded(
  mondayItemId: string,
  days = 14,
): Promise<SnoozeDocsUploadedResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new SnoozeDocsUploadedError(
      "Snooze Docs Uploaded is not configured. Set VITE_API_BASE_URL and " +
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
    throw new SnoozeDocsUploadedError(
      `Network error calling /claims/snooze-docs-uploaded: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SnoozeDocsUploadedError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }
  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new SnoozeDocsUploadedError(detail, res.status);
  }
  return body as SnoozeDocsUploadedResult;
}
