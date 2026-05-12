// Monday.com GraphQL API client.
//
// The frontend talks directly to api.monday.com/v2 — no backend in between.
// The token is read from VITE_MONDAY_API_TOKEN at build time. It WILL end up
// in the compiled JS bundle and be visible to anyone who opens the deployed
// page in DevTools. This is acceptable while the tool is internal-only
// (URL distributed by hand to employees). Before opening this up to wider
// distribution, move auth behind a Cloudflare Worker proxy or migrate to
// Monday OAuth.

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const CLAIMS_BOARD_ID = 18245429780;
export const SUBITEMS_BOARD_ID = 18245429979;

export class MondayApiError extends Error {
  constructor(
    message: string,
    public readonly response?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MondayApiError";
  }
}

interface MondayResponse<T> {
  data?: T;
  errors?: Array<{ message: string; [k: string]: unknown }>;
  error_message?: string;
  error_code?: string;
}

/**
 * Execute a GraphQL query against Monday. Variables are optional.
 * Throws MondayApiError on transport, GraphQL, or token-shape errors.
 */
export async function mondayQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = import.meta.env.VITE_MONDAY_API_TOKEN;
  if (!token) {
    throw new MondayApiError(
      "VITE_MONDAY_API_TOKEN is not set. Add it to a .env file locally, " +
        "or as a GitHub secret in the deploy workflow.",
    );
  }

  let res: Response;
  try {
    res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "API-Version": MONDAY_API_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new MondayApiError(
      `Network error calling Monday: ${(e as Error).message}`,
    );
  }

  let payload: MondayResponse<T>;
  try {
    payload = await res.json();
  } catch {
    throw new MondayApiError(
      `Non-JSON response from Monday (HTTP ${res.status})`,
      undefined,
      res.status,
    );
  }

  if (!res.ok || payload.errors) {
    const msg =
      payload.errors?.map((e) => e.message).join("; ") ??
      payload.error_message ??
      `HTTP ${res.status}`;
    throw new MondayApiError(`Monday API error: ${msg}`, payload, res.status);
  }

  if (payload.data === undefined) {
    throw new MondayApiError("Monday returned no data field", payload);
  }
  return payload.data;
}

/** True when the bundle has a Monday token available. */
export function hasMondayToken(): boolean {
  return !!import.meta.env.VITE_MONDAY_API_TOKEN;
}
