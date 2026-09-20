/**
 * The claims spawned from one Subscription Board patient — the data behind
 * the profile's Claim history card. Fetched per patient when the profile
 * opens (one filtered Monday query, sub-second), never from the whole-board
 * loader, and cached so reopening the same patient costs nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { hasMondayToken } from "@/api/monday";
import { fetchClaimsForSubscriptionItem } from "@/api/queries/allClaims";
import type { Claim } from "@/lib/claims/types";

export function useClaimHistory(subscriptionItemId: string | null | undefined) {
  const id = String(subscriptionItemId ?? "").trim();
  const q = useQuery<Claim[]>({
    queryKey: ["subscription", "claimHistory", id],
    queryFn: () => fetchClaimsForSubscriptionItem(id),
    enabled: hasMondayToken() && !!id,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return {
    claims: q.data ?? [],
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : null,
    refetch: q.refetch,
  };
}
