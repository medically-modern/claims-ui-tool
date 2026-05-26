// Client for POST /admin/eft-enrollment/mark on the Stedi-Monday
// backend. Called from the EFT Enrollment tab when the operator clicks
// Mark Submitted / Mark Approved / Mark Denied on a row.
//
// Auth: X-Admin-Key header — same VITE_ADMIN_API_KEY pattern as the
// rest of src/api/.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export type EftEnrollmentAction = "submitted" | "approved" | "denied";

export interface EftEnrollmentMarkResult {
  item_id: string;
  board: "primary" | "secondary";
  action: EftEnrollmentAction;
  status_index: number;
  submitted_date: string | null;
  payer_eftd_yes: boolean;
}

export class EftEnrollmentMarkError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "EftEnrollmentMarkError";
  }
}

export function isEftEnrollmentMarkConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function markEftEnrollment(
  itemId: string,
  board: "primary" | "secondary",
  action: EftEnrollmentAction,
): Promise<EftEnrollmentMarkResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new EftEnrollmentMarkError(
      "EFT Enrollment Mark is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/admin/eft-enrollment/mark`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({ item_id: itemId, board, action }),
    });
  } catch (e) {
    throw new EftEnrollmentMarkError(
      `Network error: ${(e as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new EftEnrollmentMarkError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }
  if (!res.ok) {
    const detail =
      (typeof parsed === "object" && parsed && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new EftEnrollmentMarkError(detail, res.status);
  }
  return parsed as EftEnrollmentMarkResult;
}
