// Client for the Denial Playbook admin endpoints on the
// Stedi-Monday backend. Powers the per-line Verify dropdown +
// "Sync Playbook" button in ClaimDetail's Denial Analysis card.
//
// Surfaces:
//   - GET  /admin/playbook/combos        → fetchPlaybookCombos()
//   - POST /admin/playbook/verify-combo  → verifyPlaybookCombo(...)
//   - POST /admin/refresh-playbook       → refreshPlaybook()
//
// Auth: X-Admin-Key — same VITE_ADMIN_API_KEY pattern the rest of
// the API clients in this folder use.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

/** One row of the Denial Playbook "Unique Combos" tab. Mirrors the
 *  shape returned by GET /admin/playbook/combos and the `combos[]`
 *  array in services/denial_playbook_data.json. */
export interface PlaybookCombo {
  carc: string;
  rarc: string;
  /** Operator-signed-off bucket (Verified: Denial Analysis on the
   *  Sheet). Empty string when the row hasn't been verified yet. */
  verified_analysis: string;
  /** Operator-signed-off action (Verified: Action on the Sheet).
   *  Empty string when not set. */
  verified_action: string;
  /** Classifier's suggested bucket (Denial Analysis on the Sheet). */
  suggested_analysis: string;
  /** Classifier's suggested action. */
  suggested_action: string;
}

export interface PlaybookCombosResponse {
  source_sheet_id: string;
  tab: string;
  fetched_at: string;
  verified_count: number;
  unverified_count: number;
  combos: PlaybookCombo[];
}

export interface VerifyComboRequest {
  carc: string;
  /** RARC can be empty when the combo is CARC-only. */
  rarc?: string;
  verifiedAnalysis: string;
  verifiedAction?: string;
}

export interface VerifyComboResult {
  carc: string;
  rarc: string;
  verified_analysis: string;
  verified_action: string;
  /** 1-indexed Sheet row that was updated. 0 when a new row was
   *  appended. */
  row_index: number;
  was_appended: boolean;
  /** How many combos the backend's lookup cache holds after the
   *  force_refresh that ran post-write. Useful as a sanity check
   *  that the cache reload succeeded. */
  cache_combos_loaded: number;
}

export interface RefreshPlaybookSummary {
  started_at: string;
  ended_at: string | null;
  since_processed_at: string | null;
  transactions_returned: number;
  transactions_processed: number;
  drive_uploads: number;
  drive_upload_errors: number;
  combos_seen: number;
  combos_new: number;
  latest_processed_at: string | null;
  error: string | null;
}

export class PlaybookApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "PlaybookApiError";
  }
}

export function isPlaybookApiConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new PlaybookApiError(
      "Playbook API is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        "X-Admin-Key": ADMIN_KEY,
      },
    });
  } catch (e) {
    throw new PlaybookApiError(
      `Network error calling ${path}: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new PlaybookApiError(
      `Non-JSON response from ${path} (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new PlaybookApiError(detail, res.status, body);
  }

  return body as T;
}

/** Read every combo on the Denial Playbook "Unique Combos" tab. */
export function fetchPlaybookCombos(): Promise<PlaybookCombosResponse> {
  return call<PlaybookCombosResponse>("/admin/playbook/combos", {
    method: "GET",
  });
}

/** Write Verified: Denial Analysis (and optionally Verified: Action)
 *  for a (CARC, RARC) combo. Creates the row if it doesn't exist. */
export function verifyPlaybookCombo(
  req: VerifyComboRequest,
): Promise<VerifyComboResult> {
  return call<VerifyComboResult>("/admin/playbook/verify-combo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      carc: req.carc,
      rarc: req.rarc ?? "",
      verified_analysis: req.verifiedAnalysis,
      verified_action: req.verifiedAction,
    }),
  });
}

/** Force the hourly Sheet-refresh cycle now: pulls any new ERAs from
 *  Stedi, archives JSONs to Drive, appends any unseen CARC/RARC combos
 *  to the Sheet. Use after editing the Sheet directly or after a
 *  burst of new ERAs landed and the operator wants to make sure
 *  everything's caught up. */
export function refreshPlaybook(): Promise<RefreshPlaybookSummary> {
  return call<RefreshPlaybookSummary>("/admin/refresh-playbook", {
    method: "POST",
  });
}
