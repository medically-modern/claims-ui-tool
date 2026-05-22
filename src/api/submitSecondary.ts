// Client for POST /claims/secondary/submit on the Stedi-Monday backend.
// Called from SecondaryBoard's "Submit Secondary" button on Insurance-bucket
// rows. The backend builds the secondary 837 (COB-shaped: primary payer +
// payerPaidAmount + per-line CAS adjustments), sends it through Stedi to the
// secondary payer (e.g. Emblem ZTXQE), and on success writes Claim ID, PCN,
// Claim Sent Date, and Secondary Status = Submitted back to the Monday item.
//
// is_test=true exercises Stedi's schema validator without actually sending
// to the payer — used during initial trading-partner setup. Production
// submissions leave is_test off.
//
// Auth: X-Admin-Key header — same VITE_ADMIN_API_KEY pattern the rest of
// src/api/ uses.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export interface SubmitSecondaryResult {
  submitted: boolean;
  claim_id?: string;
  transaction_id?: string;
  pcn?: string;
  is_test?: boolean;
  inline_277_status?: string | null;
}

export class SubmitSecondaryError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SubmitSecondaryError";
  }
}

export function isSubmitSecondaryConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

/**
 * Submit a secondary 837 to the secondary payer via Stedi.
 *
 * @param mondayItemId Secondary Claims Board parent item id.
 * @param opts.isTest  Stedi validator only — doesn't actually go to the
 *                     payer and doesn't writeback Claim ID/PCN/Status.
 *                     Default false (real submission).
 */
export async function submitSecondary(
  mondayItemId: string,
  opts: { isTest?: boolean } = {},
): Promise<SubmitSecondaryResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new SubmitSecondaryError(
      "Submit Secondary is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }
  const body: Record<string, unknown> = { item_id: mondayItemId };
  if (opts.isTest) body.is_test = true;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/secondary/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new SubmitSecondaryError(
      `Network error calling /claims/secondary/submit: ${(e as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new SubmitSecondaryError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }
  if (!res.ok) {
    const detail =
      (typeof parsed === "object" && parsed && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new SubmitSecondaryError(detail, res.status);
  }
  return parsed as SubmitSecondaryResult;
}
