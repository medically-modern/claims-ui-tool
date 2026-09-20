/**
 * usePrefetchSubscription — start the Subscription Board reads the moment the
 * app opens, alongside the claims load, instead of when the operator first
 * clicks the Subscription Board tab (Brandon, 2026-09-20: "as soon as the
 * page opens and begins loading claims, it should also begin loading the
 * subscription board").
 *
 * prefetchQuery goes through the same cache and keys as useSubscriptionPatients
 * / useNewOrders, so when the tab mounts its useQuery finds the data already
 * there (or the fetch already in flight and joins it). It honours the same
 * staleTime: a fresh snapshot restored from IndexedDB is not re-read.
 *
 * Waits for the persisted cache to finish restoring first, so the prefetch
 * sees the restored snapshot and can skip the network when it is fresh.
 */
import { useEffect } from "react";
import { useIsRestoring, useQueryClient } from "@tanstack/react-query";
import { hasMondayToken } from "@/api/monday";
import { fetchSubscriptionPatients } from "@/api/queries/subscriptionPatients";
import { fetchNewOrders } from "@/api/queries/newOrders";
import { SUBSCRIPTION_PATIENTS_QUERY_KEY, SUBSCRIPTION_PATIENTS_STALE_MS } from "./useSubscriptionPatients";
import { NEW_ORDERS_QUERY_KEY, NEW_ORDERS_STALE_MS } from "./useNewOrders";

export function usePrefetchSubscription(): void {
  const queryClient = useQueryClient();
  const restoring = useIsRestoring();
  useEffect(() => {
    if (restoring || !hasMondayToken()) return;
    void queryClient.prefetchQuery({
      queryKey: SUBSCRIPTION_PATIENTS_QUERY_KEY,
      queryFn: fetchSubscriptionPatients,
      staleTime: SUBSCRIPTION_PATIENTS_STALE_MS,
    });
    // The Order Board feeds the patient page (order history, "since the last
    // order"); it is a small read and the page opens noticeably faster with it
    // already in hand.
    void queryClient.prefetchQuery({
      queryKey: NEW_ORDERS_QUERY_KEY,
      queryFn: fetchNewOrders,
      staleTime: NEW_ORDERS_STALE_MS,
    });
  }, [restoring, queryClient]);
}
