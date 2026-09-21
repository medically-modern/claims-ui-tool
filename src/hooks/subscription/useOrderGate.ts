/**
 * useOrderGate — reads the deterministic arrival-audit gate for one
 * Subscription Board row. Only first orders need it (the audit is a
 * new-arrival profile check), so callers pass `enabled` = isFirstOrder.
 *
 * React Query dedupes by item_id, so the First Order pill and the Send-to-Order
 * button can both call this for the same row without a second request. When the
 * backend isn't configured the query stays disabled and returns undefined, so
 * the UI falls back to its normal (non-audited) behaviour.
 *
 * `recheck()` forces a fresh audit (fresh=1) and writes the new verdict into the
 * shared cache, so an operator can clear a stale red from the pill the moment
 * they've fixed the profile — without waiting for a webhook (Brandon,
 * 2026-09-21).
 */
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOrderGate, isOrderGateConfigured, type OrderGate } from "@/api/orderGate";

export interface OrderGateState {
  gate: OrderGate | undefined;
  /** A forced fresh audit is in flight. */
  rechecking: boolean;
  /** Re-run the audit (fresh=1) and update the cache for every consumer. */
  recheck: () => void;
}

export function useOrderGate(itemId: string | undefined, enabled: boolean): OrderGateState {
  const qc = useQueryClient();
  const [rechecking, setRechecking] = useState(false);
  const { data } = useQuery({
    queryKey: ["order-gate", itemId],
    queryFn: () => fetchOrderGate(itemId as string),
    enabled: !!itemId && enabled && isOrderGateConfigured(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });

  const recheck = useCallback(() => {
    if (!itemId || rechecking || !isOrderGateConfigured()) return;
    setRechecking(true);
    fetchOrderGate(itemId, { fresh: true })
      .then((fresh) => qc.setQueryData(["order-gate", itemId], fresh))
      .catch(() => { /* keep the last verdict on a failed re-check */ })
      .finally(() => setRechecking(false));
  }, [itemId, qc, rechecking]);

  return { gate: data, rechecking, recheck };
}
