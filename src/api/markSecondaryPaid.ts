// Client for POST /claims/secondary/mark-paid on the Stedi-Monday backend.
//
// Called when the operator clicks Submit -> Paid on the Secondary Board's
// ERA Review row. Backend:
//   1. Flips Secondary Status = Paid on the Secondary Claims Board.
//   2. Resolves the source primary via the Primary Claim ID column.
//   3. Reads Subscription Item ID off the primary.
//   4. Writes Secondary Claim Paid? = Fully Paid on the Subscription Board.
//
// Auth: X-Admin-Key header, same as Mark Paid + Run Status Check.

export interface MarkSecondaryPaidResult {
  secondary_updated: boolean;
  primary_item_id: string | null;
  subscription_item_id: string | null;
  subscription_updated: boolean;
  reason: string | null;
}

export class MarkSecondaryPaidError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "MarkSecondaryPaidError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isMarkSecondaryPaidConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function markSecondaryPaid(
  mondayItemId: string,
): Promise<MarkSecondaryPaidResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new MarkSecondaryPaidError(
      "Secondary Mark Paid is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/secondary/mark-paid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({ item_id: mondayItemId }),
    });
  } catch (e) {
    throw new MarkSecondaryPaidError(
      `Network error calling /claims/secondary/mark-paid: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MarkSecondaryPaidError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new MarkSecondaryPaidError(detail, res.status, body);
  }

  return body as MarkSecondaryPaidResult;
}
