// Client for POST /claims/mark-paid on the Stedi-Monday backend.
//
// When the operator clicks Mark Paid on a primary claim in the Review ERA
// UI, we call this endpoint with the Monday item id. The backend:
//   1. Flips the primary's Primary status to "Paid".
//   2. If PR Amount > 0, creates a corresponding item on the Secondary
//      Claims Board with patient + primary-snapshot data and copies the
//      subitems. Pre-fills Submission Type (Forwarded / Insurance /
//      Patient) based on the payer combo. Operator confirms before the
//      next action fires.
//
// Auth: X-Admin-Key header must match the backend's ADMIN_API_KEY env var.
// Both VITE_API_BASE_URL and VITE_ADMIN_API_KEY are wired in at build time
// from GitHub secrets (and so end up in the public bundle). Same risk
// profile as VITE_MONDAY_API_TOKEN; acceptable while the tool is
// internal-only.

export interface MarkPaidResult {
  primary_updated: boolean;
  /** Sum of patient-responsibility carried over from the primary's ERA.
   *  >0 means a secondary spawn is queued; 0 means nothing else to do. */
  pr_amount: number;
  primary_claim_id: string;
  /** "queued" when PR > 0 (spawn runs as a Railway background task);
   *  "skipped" when PR = 0 (no spawn needed, just the primary flip).
   *  Always returns in ~1-2s regardless. */
  spawn_status: "queued" | "skipped";
}

export class MarkPaidError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "MarkPaidError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isMarkPaidConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function markPrimaryPaid(
  mondayItemId: string,
): Promise<MarkPaidResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new MarkPaidError(
      "Mark Paid is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/mark-paid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({
        item_id: mondayItemId,
        today: new Date().toISOString().slice(0, 10),
      }),
    });
  } catch (e) {
    throw new MarkPaidError(
      `Network error calling /claims/mark-paid: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MarkPaidError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new MarkPaidError(detail, res.status, body);
  }

  return body as MarkPaidResult;
}

/** URL to view the new secondary item on Monday's UI. */
export function secondaryItemUrl(secondaryItemId: string): string {
  return `https://medicallymodern-force.monday.com/boards/18413019028/pulses/${secondaryItemId}`;
}

// ─── Submission-type prediction (mirrors the backend classifier) ─────────────
// Used by the Mark Paid confirmation dialog to tell the operator what kind
// of secondary item is about to be created.

// Secondary Payer values that DON'T indicate a real secondary insurance —
// either bill the patient (Patient), or Medicare auto-crossover that the
// ERA text would have surfaced (Medicare Suppl.), or an explicit
// no-insurance flag the operator set ("None", "Bad Debt",
// "No Patient Responsibility"). Anything else in the column means
// "we have a real secondary insurance on file."
//
// KEEP IN SYNC with the backend's NON_INSURANCE_SECONDARY_VALUES set in
// services/secondary_board_service.py — both classifiers run on the
// same column values and should produce identical results, otherwise
// the Mark Paid confirmation preview will mislead the operator.
const NON_INSURANCE_SECONDARY_VALUES = new Set<string>([
  "Patient",
  "Medicare Suppl.",
  "None",
  "Bad Debt",
  "No Patient Responsibility",
]);

export type SubmissionType = "Forwarded" | "Insurance" | "Patient";

/**
 * True when the Raw ERA Claim Status indicates the primary payer
 * auto-forwarded this claim to a secondary (Medicare crossover behavior).
 * Example text: "Processed as Primary, Forwarded to Secondary Payer".
 */
export function isForwardedByPrimary(
  rawEraClaimStatus: string | null | undefined,
): boolean {
  return /forwarded to secondary/i.test(rawEraClaimStatus || "");
}

/**
 * True when the ERA file that produced this row contained a Reversal CLP
 * (X12 CLP-02 = 22 "Reversal of Previous Payment" or 17 "Payment Reversed")
 * paired with the reissue. The backend tags the final raw_era_claim_status
 * with "(Reversal in ERA)" — see process_era_content in stedi_webhook.py.
 *
 * Operator-visible signal: a Reversal pill on the row tells them this
 * claim isn't a clean automated paid — payer flipped the original
 * decision. Worth investigating before treating as cleanly paid; in some
 * cases the net effect ends up being a denial after the dust settles.
 */
export function hasReversalInEra(
  rawEraClaimStatus: string | null | undefined,
): boolean {
  return /reversal/i.test(rawEraClaimStatus || "");
}

export function predictSubmissionType(
  primaryPayor: string | null | undefined,
  secondaryPayer: string | null | undefined,
  rawEraClaimStatus?: string | null | undefined,
): SubmissionType {
  // 1. ERA text wins. If the primary auto-forwarded (Medicare crossover,
  //    some BCBS plans, etc.), that's Forwarded regardless of any column.
  if (isForwardedByPrimary(rawEraClaimStatus)) return "Forwarded";

  // 2. Real secondary insurance on file — anything in the Secondary Payer
  //    column other than the "not really insurance" sentinel values.
  const sec = (secondaryPayer || "").trim();
  if (sec && !NON_INSURANCE_SECONDARY_VALUES.has(sec)) {
    return "Insurance";
  }

  // 3. Default: bill the patient. Covers Medicare primary without a real
  //    secondary (the patient has no supplement) and any commercial primary
  //    without a real secondary on file.
  return "Patient";
}

/**
 * Short string for the confirmation dialog:
 *   - "None"          when no secondary will be created (PR <= 0)
 *   - "Forwarded" | "Insurance" | "Patient"  when one will
 */
export function summarizeSecondary(
  prAmount: number,
  primaryPayor: string | null | undefined,
  secondaryPayer: string | null | undefined,
  rawEraClaimStatus?: string | null | undefined,
): string {
  if (prAmount <= 0) return "None";
  return predictSubmissionType(primaryPayor, secondaryPayer, rawEraClaimStatus);
}
