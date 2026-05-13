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
  spawned: boolean;
  secondary_item_id: string | null;
  reason: string | null;
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

const MEDICARE_PRIMARY_PAYORS = new Set([
  "Medicare A&B",
  "Fidelis Medicare",
  "Anthem BCBS Medicare",
  "United Medicare",
  "Aetna Medicare",
]);

export type SubmissionType = "Forwarded" | "Insurance" | "Patient";

/**
 * True when the Raw ERA Claim Status indicates the primary payer
 * auto-forwarded this claim to a secondary (Medicare crossover behavior).
 * Mary Moody's ERA text was "Processed as Primary, Forwarded to Secondary
 * Payer" — that "Forwarded to Secondary" phrase is the authoritative signal.
 */
export function isForwardedByPrimary(
  rawEraClaimStatus: string | null | undefined,
): boolean {
  return /forwarded to secondary/i.test(rawEraClaimStatus || "");
}

export function predictSubmissionType(
  primaryPayor: string | null | undefined,
  secondaryPayer: string | null | undefined,
  rawEraClaimStatus?: string | null | undefined,
): SubmissionType {
  // ERA text wins: if Medicare already auto-forwarded the claim, that's
  // Forwarded even if our Secondary Payer column on Monday is blank.
  if (isForwardedByPrimary(rawEraClaimStatus)) return "Forwarded";
  if (!(secondaryPayer || "").trim()) return "Patient";
  if (MEDICARE_PRIMARY_PAYORS.has((primaryPayor || "").trim())) return "Forwarded";
  return "Insurance";
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
