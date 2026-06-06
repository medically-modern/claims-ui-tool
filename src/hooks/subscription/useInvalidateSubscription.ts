/**
 * useInvalidateSubscription.ts — small helper for components that
 * mutate Subscription Board rows. After a successful Monday write,
 * call invalidate() to schedule a background refetch of the
 * subscription patients query so cached data catches up.
 */
import { useQueryClient } from "@tanstack/react-query";
import { SUBSCRIPTION_PATIENTS_QUERY_KEY } from "./useSubscriptionPatients";

export function useInvalidateSubscription() {
  const qc = useQueryClient();
  return {
    invalidate: () => qc.invalidateQueries({ queryKey: SUBSCRIPTION_PATIENTS_QUERY_KEY }),
  };
}
