// Client for POST /claim-status/run/{item_id} on the Stedi-Monday backend.
//
// When the operator clicks Run Status Check on a Late ERA row, we call
// this endpoint with the Monday item id. The backend:
//   1. Builds a 276 payload from the Claims Board item.
//   2. Sends it through Stedi to the payer.
//   3. Parses the 277 response into a writeback dict.
//   4. Writes Claim Status Category, Detail, 277 ICN/Paid Amount,
//      Last Claim Status Check, etc. back to the Monday item.
//   5. Returns the writeback so the UI can show what landed.
//
// Auth: X-Admin-Key header must match the backend's ADMIN_API_KEY env var
// (same key used by /claims/mark-paid).

export interface ClaimStatusWriteback {
  /** Mapped Monday-friendly status label. Values mirror Status277 enum on the
   *  frontend: "Paid", "Denied", "Pending", "In Process", "Requests Info",
   *  "No Match", "Error", "Acknowledged". */
  "Claim Status Category"?: string;
  "Claim Status Detail"?: string;
  "277 ICN"?: string;
  "277 Paid Amount"?: number;
  "Last Claim Status Check"?: string;
  /** Raw X12 status category code (A / F / P / E / etc). */
  _category_code?: string;
  /** Raw X12 status code (F1 / F2 / A1 / etc). */
  _status_code?: string;
  _n_claims_returned?: number;
  _check_number?: string;
  _paid_date?: string;
  _patient_account_number?: string;
  /** True when the pipeline produced an error writeback (Validation,
   *  Unexpected, Stedi rejection, etc.). */
  _failure_reason?: string;
}

export interface ClaimStatusRunResult {
  status: "success" | "error";
  item_id: string;
  results?: ClaimStatusWriteback;
  error?: string;
}

export class ClaimStatusError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ClaimStatusError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isClaimStatusCheckConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function runClaimStatusCheck(
  mondayItemId: string,
): Promise<ClaimStatusWriteback> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new ClaimStatusError(
      "Run Status Check is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/claim-status/run/${encodeURIComponent(mondayItemId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": ADMIN_KEY,
        },
      },
    );
  } catch (e) {
    throw new ClaimStatusError(
      `Network error calling /claim-status/run: ${(e as Error).message}`,
    );
  }

  let body: ClaimStatusRunResult;
  try {
    body = (await res.json()) as ClaimStatusRunResult;
  } catch {
    throw new ClaimStatusError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok || body.status === "error") {
    const detail = body.error || `HTTP ${res.status}`;
    throw new ClaimStatusError(detail, res.status, body);
  }

  return body.results ?? {};
}
