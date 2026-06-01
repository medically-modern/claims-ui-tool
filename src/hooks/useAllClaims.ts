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
    // Include pre-submission rows so thread breadcrumbs can navigate to
    // freshly-spawned children that are sitting in Submit Claim status.
    // Bucket filters in Claims.tsx already exclude pre-submission statuses
    // so this doesn't change what gets listed; it just makes lookups
    // (ClaimDetail, getThread) able to find every related claim.
    queryFn: () => fetchAllClaims({ excludePreSubmission: false }),
    // Skip the network call entirely when no Monday token is configured so
    // local dev without a .env doesn't blow up; pages that need a fallback
    // can detect `isFetching === false && data === undefined` and substitute
    // mock data.
    enabled: hasMondayToken(),
    // Claim data updates relatively slowly. Five-minute freshness window is
    // fine; user can hit the Refresh button to force.
    //
    // With localStorage persistence (PersistQueryClientProvider in App.tsx),
    // a reload within this window renders from cache and skips Monday
    // entirely — the difference between ~10s of paginated GraphQL and
    // instant first paint. Past the window, we still show cached data
    // immediately and refetch silently in the background, so the user
    // never sees a blank screen.
    staleTime: 5 * 60 * 1000,
    // gcTime needs to be long enough that the persister can save and
    // restore the entry across reloads. The QueryClient default is 5
    // minutes — bumping per-query so claims that aren't refetched for
    // a while still come back from localStorage on the next visit.
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
