// Client for POST /claims/spawn-resubmission on the Stedi-Monday backend.
//
// Called when the operator clicks Submit Claim in the denial workflow and
// confirms which service lines to carry forward in the LineResubmitDialog.
// The backend creates a new Monday item containing only those lines, points
// it at the parent via Parent Claim ID, and stamps Claim Type (Corrected or
// Original) so the 837 generator emits the right CLM05-3 + REF*F8.
//
// Auth: X-Admin-Key header — same pattern as markPaid.ts.

export interface SpawnResubmissionLineOverride {
  /** Override the units billed on this line (e.g. 45 → 35 when records
   *  only support 35). Falls through to the parent's claim quantity when
   *  null/undefined. */
  units?: number | null;
  /** Override the charge amount on this line. Falls through to parent's
   *  charge when null/undefined. */
  charge?: number | null;
}

export interface SpawnResubmissionRequest {
  parentItemId: string;
  /** Monday subitem ids on the parent that should be carried onto the
   *  child claim. Empty list is rejected by the backend. */
  lineSubitemIds: string[];
  /** Per-line overrides keyed by subitem id. */
  lineOverrides?: Record<string, SpawnResubmissionLineOverride>;
  /** Maps to Claim Type on the child:
   *   - "Corrected claim" → Claim Type = Corrected → 837 emits CLM05-3 = 7
   *     + REF*F8 with parent's payer claim number. Use when the payer's
   *     denial reason was a correctable error.
   *   - "New claim" → Claim Type = Original → 837 goes out as fresh.
   *     Use when the prior claim was rejected outright (e.g. Wrong Payer)
   *     and a corrected-claim flag would just trigger a duplicate denial.
   */
  denialAction: "Corrected claim" | "New claim";
}

export interface SpawnResubmissionResult {
  child_item_id: string;
  parent_item_id: string;
  claim_type: "Corrected" | "Original";
  lines_carried: number;
  /** True when the backend returned a cached child from a recent identical
   *  request (covers accidental double-clicks). */
  idempotent_hit: boolean;
}

export class SpawnResubmissionError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "SpawnResubmissionError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isSpawnResubmissionConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function spawnResubmission(
  req: SpawnResubmissionRequest,
): Promise<SpawnResubmissionResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new SpawnResubmissionError(
      "Spawn Resubmission is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/claims/spawn-resubmission`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({
        parent_item_id: req.parentItemId,
        line_subitem_ids: req.lineSubitemIds,
        line_overrides: req.lineOverrides ?? {},
        denial_action: req.denialAction,
      }),
    });
  } catch (e) {
    throw new SpawnResubmissionError(
      `Network error calling /claims/spawn-resubmission: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SpawnResubmissionError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new SpawnResubmissionError(detail, res.status, body);
  }

  return body as SpawnResubmissionResult;
}

/** URL to view the spawned child item on Monday's UI. Mirrors the helper
 *  in markPaid.ts for symmetry. */
export function childClaimUrl(childItemId: string): string {
  return `https://medicallymodern-force.monday.com/boards/18245429780/pulses/${childItemId}`;
}
