// Client for POST /admin/insurance-baseline/reanchor/{item_id} on the
// Stedi-Monday backend.
//
// The backend decides Insurance Change? by diffing every eligibility check
// against a frozen "baseline" of the patient's insurance. Writing the column
// to "No" by hand doesn't stick — the next check re-diffs against the same
// old baseline and flips it back to Yes. This endpoint re-anchors the baseline
// to the insurance on the row right now AND resets the flag to "No", so a
// reconciled change stays reconciled (Brandon, 2026-09-28).
//
// Auth: X-Admin-Key header — same VITE_ADMIN_API_KEY pattern as the rest of
// src/api/.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isReanchorConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function reanchorInsuranceBaseline(itemId: string): Promise<void> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new Error("Not configured for this build (VITE_API_BASE_URL / VITE_ADMIN_API_KEY).");
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE.replace(/\/$/, "")}/admin/insurance-baseline/reanchor/${encodeURIComponent(itemId)}`, {
      method: "POST",
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
  } catch (e) {
    throw new Error(`Network error: ${(e as Error).message}`);
  }
  let body: { reanchored?: boolean; reason?: string; detail?: string } = {};
  try { body = await res.json(); } catch { /* keep empty */ }
  if (!res.ok) throw new Error(body.detail || `The backend refused the reset (${res.status})`);
  if (!body.reanchored) throw new Error(body.reason ? `Not reset: ${body.reason}` : "The backend didn't reset the baseline");
}
