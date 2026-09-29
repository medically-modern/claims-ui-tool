// Set "Hit Bank?" on claims from the Cash Flow › Paid, not in bank drill-down.
// POST /admin/hit-bank/mark on the Stedi-Monday backend writes the label
// and, for Yes, moves any row parked in "Paid, but NOT in Bank" to
// Paid And Closed in the same call. Normally Josh's daily QuickBooks
// match sets this; the buttons are the manual override.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export type HitBankLabel = "Yes" | "Mismatch";

export function isHitBankMarkConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function markHitBank(
  board: "primary" | "secondary",
  itemIds: string[],
  label: HitBankLabel | null,
): Promise<void> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new Error("Hit Bank marking needs VITE_API_BASE_URL and VITE_ADMIN_API_KEY.");
  }
  const res = await fetch(`${API_BASE}/admin/hit-bank/mark`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
    body: JSON.stringify({ board, item_ids: itemIds, label }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b && typeof b === "object" && "detail" in b) detail = String(b.detail);
    } catch { /* keep status */ }
    throw new Error(detail);
  }
}
