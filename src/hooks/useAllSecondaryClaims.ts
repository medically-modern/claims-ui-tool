// React Query hook for the Secondary Claims Board. SecondaryBoard.tsx
// consumes this. Mirrors useAllClaims.ts in shape.

import { useQuery } from "@tanstack/react-query";
import { fetchAllSecondaryClaims } from "@/api/queries/allSecondaryClaims";
import { hasMondayToken } from "@/api/monday";
import type { SecClaim } from "@/components/claims/SecondaryBoard";

export const ALL_SECONDARY_CLAIMS_QUERY_KEY = [
  "claims",
  "secondary",
  "all",
] as const;

export function useAllSecondaryClaims() {
  return useQuery<SecClaim[]>({
    queryKey: ALL_SECONDARY_CLAIMS_QUERY_KEY,
    queryFn: () => fetchAllSecondaryClaims(),
    enabled: hasMondayToken(),
    staleTime: 5 * 60 * 1000,
    // 24h gcTime so the persister in App.tsx can rehydrate this
    // across page reloads without React Query GC'ing the entry first.
    // See useAllClaims for the full rationale.
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
