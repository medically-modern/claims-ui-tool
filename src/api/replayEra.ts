// Client for POST /stedi/replay-era on the Stedi-Monday backend.
//
// Lets the operator manually re-run an 835 ERA payload through the same
// writeback pipeline the live Stedi webhook uses. Use when the webhook
// missed an ERA, dropped one, or we need to re-process an old payload.
//
// Body is just the parsed Stedi 835 JSON; backend takes care of routing
// each claim row to the right Monday item.

export interface ReplayEraResultRow {
  pcn: string;
  claim_status: string;
  primary_paid: string;
  pr_amount: string;
  route: "primary" | "secondary";
  item_id: string | null;
  outcome: "populated" | "no-match" | "secondary-not-spawned" | string;
}

export interface ReplayEraResult {
  rows_parsed: number;
  rows_written: number;
  rows_skipped: number;
  results: ReplayEraResultRow[];
}

export class ReplayEraError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ReplayEraError";
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export function isReplayEraConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function replayEra(
  eraJson: unknown,
  opts?: { transactionId?: string },
): Promise<ReplayEraResult> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new ReplayEraError(
      "Replay ERA is not configured. Set VITE_API_BASE_URL and " +
        "VITE_ADMIN_API_KEY at build time.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/stedi/replay-era`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": ADMIN_KEY,
      },
      body: JSON.stringify({
        era_json: eraJson,
        transaction_id: opts?.transactionId ?? null,
      }),
    });
  } catch (e) {
    throw new ReplayEraError(
      `Network error calling /stedi/replay-era: ${(e as Error).message}`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ReplayEraError(
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const detail =
      (typeof body === "object" && body && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new ReplayEraError(detail, res.status, body);
  }

  return body as ReplayEraResult;
}
