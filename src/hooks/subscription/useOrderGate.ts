/**
 * useOrderGate — reads the deterministic arrival-audit gate for one
 * Subscription Board row. Only first orders need it (the audit is a
 * new-arrival profile check), so callers pass `enabled` = isFirstOrder.
 *
 * React Query dedupes by item_id, so the First Order pill and the Send-to-Order
 * button can both call this for the same row without a second request. When the
 * backend isn't configured the query stays disabled and returns undefined, so
 * the UI falls back to its normal (non-audited) behaviour.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchOrderGate, isOrderGateConfigured, type OrderGate } from "@/api/orderGate";

export function useOrderGate(itemId: string | undefined, enabled: boolean): OrderGate | undefined {
  const { data } = useQuery({
    queryKey: ["order-gate", itemId],
    queryFn: () => fetchOrderGate(itemId as string),
    enabled: !!itemId && enabled && isOrderGateConfigured(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });
  return data;
}
