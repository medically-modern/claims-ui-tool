// Client for POST /claims/secondary/waive-sync on the Stedi-Monday backend.
//
// Fired after the Waive Payment path on the Secondary Board's Confirm
// Payor step. The waive itself (Secondary Status=Paid, Secondary
// Paid=$0, move to Paid And Closed) is a direct Monday write in
// confirmSecondaryPayor.ts; this endpoint handles the cross-board part
// the direct write can't reach — the Subscription Board's
// "Secondary Claim Paid?" flips to "None" (nothing collected, nothing
// in flight) and the outstanding PR amount clears.
//
// Auth: X-Admin-Key header, same as the other mark-paid endpoints.

export class WaiveSecondarySyncError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WaiveSecondarySyncError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isWaiveSecondarySyncConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function waiveSecondarySync(
  mondayItemId: string,
): Promise<void> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new WaiveSecondarySyncError(
      "Waive sync is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/secondary/waive-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({ item_id: mondayItemId }),
    });
  } catch (e) {
    throw new WaiveSecondarySyncError(
      `Network error calling waive-sync: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* non-JSON body — keep the HTTP status string */
    }
    throw new WaiveSecondarySyncError(detail, res.status);
  }
}
