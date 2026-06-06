/**
 * useSubscriptionPatients.ts — React Query hook backed by the same
 * persistent cache the Claims Board uses (localStorage via
 * PersistQueryClientProvider in App.tsx).
 *
 *   staleTime 5 min : within the window, mounts/reloads hit cache,
 *                     no Monday call. Past the window, cached data
 *                     renders immediately while a background refetch
 *                     runs — operator never sees a blank screen.
 *   gcTime    24 h  : persister can rehydrate from a previous session.
 *   refetchOnWindowFocus: true — alt-tabbing back refreshes silently.
 *
 * Falls back to mock data if the Monday token isn't configured (dev /
 * preview builds).
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchSubscriptionPatients, type LiveSubscriptionPatient,
} from "@/api/queries/subscriptionPatients";
import { hasMondayToken } from "@/api/monday";
import { ORDER_PREP_PATIENTS } from "@/components/subscription/mockData";

export const SUBSCRIPTION_PATIENTS_QUERY_KEY = ["subscription", "patients"] as const;

export function useSubscriptionPatients() {
  const q = useQuery<LiveSubscriptionPatient[]>({
    queryKey: SUBSCRIPTION_PATIENTS_QUERY_KEY,
    queryFn: fetchSubscriptionPatients,
    enabled: hasMondayToken(),
    staleTime: 5 * 60 * 1000,
    gcTime:   24 * 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect:   true,
  });

  // Mock fallback when no token / fetch hard-failed at first paint
  const usingMock = !hasMondayToken() || (q.isError && q.data === undefined);
  const data =
    q.data ?? (usingMock ? (ORDER_PREP_PATIENTS as unknown as LiveSubscriptionPatient[]) : undefined);

  return {
    data,
    loading: q.isLoading,
    isFetching: q.isFetching,        // true during background refetch
    isStale: q.isStale,
    error: q.error ? (q.error as Error).message : null,
    usingMock,
    dataUpdatedAt: q.dataUpdatedAt,
    refetch: q.refetch,
  };
}
