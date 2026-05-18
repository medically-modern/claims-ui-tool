// Client for POST /claims/manual-era on the Stedi-Monday backend.
//
// Used by the "Edit ERA" dialog on the Outstanding bucket. Lets the
// operator enter per-line payment + adjustment values manually when no
// 835 came through (payer paid but didn't send remittance, or operator
// got the breakdown by phone).
//
// On success the row lands in ERA Review with Raw ERA Claim Status =
// "Manual entry" so it's auditable.

export interface ManualEraLine {
  subitemId: string;
  primaryPaid: number;
  deductible: number;
  coinsurance: number;
  copay: number;
  /** Optional override for total patient responsibility on this line.
   *  Backend derives PR = deductible + coinsurance + copay when omitted. */
  pr?: number | null;
}

export interface ManualEraRequest {
  itemId: string;
  lines: ManualEraLine[];
  /** Defaults to today on the backend when omitted. */
  primaryPaidDate?: string | null;
}

export interface ManualEraResult {
  parent_updated: boolean;
  lines_updated: number;
  primary_paid_total: number;
  pr_total: number;
  primary_paid_date: string;
}

export class ManualEraError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ManualEraError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isManualEraConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function applyManualEra(
  req: ManualEraRequest,
): Promise<ManualEraResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new ManualEraError(
      "Manual ERA is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/manual-era`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({
        item_id: req.itemId,
        primary_paid_date: req.primaryPaidDate ?? null,
        lines: req.lines.map((l) => ({
          subitem_id: l.subitemId,
          primary_paid: l.primaryPaid,
          deductible: l.deductible,
          coinsurance: l.coinsurance,
          copay: l.copay,
          pr: l.pr ?? null,
        })),
      }),
    });
  } catch (e) {
    throw new ManualEraError(
      `Network error calling /claims/manual-era: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ManualEraError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new ManualEraError(detail, res.status, body);
  }

  return body as ManualEraResult;
}
