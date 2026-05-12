// React Query hook for the full claim list. Both pages/Claims.tsx and
// pages/ClaimDetail.tsx use this. Caching is shared by queryKey, so opening
// a detail page right after the list loads doesn't re-fetch.

import { useQuery } from "@tanstack/react-query";
import { fetchAllClaims } from "@/api/queries/allClaims";
import { hasMondayToken } from "@/api/monday";
import type { Claim } from "@/lib/claims/types";

export const ALL_CLAIMS_QUERY_KEY = ["claims", "all"] as const;

export function useAllClaims() {
  return useQuery<Claim[]>({
    queryKey: ALL_CLAIMS_QUERY_KEY,
    queryFn: () => fetchAllClaims(),
    // Skip the network call entirely when no Monday token is configured so
    // local dev without a .env doesn't blow up; pages that need a fallback
    // can detect `isFetching === false && data === undefined` and substitute
    // mock data.
    enabled: hasMondayToken(),
    // Claim data updates relatively slowly. Five-minute freshness window is
    // fine; user can hit the Refresh button to force.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
