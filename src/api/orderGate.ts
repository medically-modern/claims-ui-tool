// Client for GET /subscription/{item_id}/order-gate on the Stedi-Monday
// backend (the deterministic Subscription Board arrival audit). Used on the
// Ready-to-Order tab to red-pill a first order whose profile isn't safe to
// order against, and to disable Send to Order with the reason.
//
// Auth: X-Admin-Key header — same VITE_ADMIN_API_KEY pattern as the rest of
// src/api/. When the backend isn't configured the hook simply doesn't run, so
// the pill and button fall back to their normal behaviour.

const API_BASE  = import.meta.env.VITE_API_BASE_URL as string | undefined;
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

export type OrderGatePill = "red" | "amber" | "green";
export type FindingSeverity = "ERROR" | "WARN" | "UNKNOWN";

export interface OrderGateFinding {
  severity: FindingSeverity;
  code: string;
  column_id: string;
  label: string;
  message: string;
  blocks_order: boolean;
}

export interface OrderGate {
  item_id: string;
  name: string;
  orderable: boolean;
  pill: OrderGatePill;
  blocking_count: number;
  advisory_count: number;
  blocking_reason: string | null;
  findings: OrderGateFinding[];
  summary: string;
}

export class OrderGateError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "OrderGateError";
  }
}

export function isOrderGateConfigured(): boolean {
  return !!(API_BASE && ADMIN_KEY);
}

export async function fetchOrderGate(itemId: string, opts: { fresh?: boolean } = {}): Promise<OrderGate> {
  if (!API_BASE || !ADMIN_KEY) {
    throw new OrderGateError(
      "Order gate is not configured. Set VITE_API_BASE_URL and VITE_ADMIN_API_KEY at build time.",
    );
  }
  // fresh=1 recomputes the audit and overwrites the stored verdict, instead of
  // serving the cached one — the way to clear a stale red after the profile has
  // been fixed (Brandon, 2026-09-21).
  const qs = opts.fresh ? "?fresh=1" : "";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/subscription/${encodeURIComponent(itemId)}/order-gate${qs}`, {
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
  } catch (e) {
    throw new OrderGateError(`Network error: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new OrderGateError(`Non-JSON response (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) {
    const detail =
      (typeof parsed === "object" && parsed && "detail" in parsed
        ? String((parsed as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new OrderGateError(detail, res.status);
  }
  return parsed as OrderGate;
}
