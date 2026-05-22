// Live read of the Denial Playbook "Unique Combos" tab via the
// stedi-monday-integration backend (/admin/playbook/combos). Cached
// in React Query so every place that needs the playbook shares one
// fetch:
//   - ClaimDetail's per-line picker + Verified/Unverified/New pill
//   - DenialAnalysisTable's workbook view
//   - Anywhere else that calls lookupDenialAnalysis()
//
// Invalidating PLAYBOOK_COMBOS_QUERY_KEY (via useQueryClient) after a
// successful verifyPlaybookCombo() pushes the new bucket to every
// open surface, so the operator doesn't have to refresh to see their
// edit reflected on a different claim with the same (CARC, RARC).

import { useQuery } from "@tanstack/react-query";
import {
  fetchPlaybookCombos,
  isPlaybookApiConfigured,
  type PlaybookCombosResponse,
} from "@/api/playbook";

/** Query key shared across the app. Exported so write-side helpers
 *  (verify-combo save, sync button) can call
 *  queryClient.invalidateQueries({ queryKey: PLAYBOOK_COMBOS_QUERY_KEY }). */
export const PLAYBOOK_COMBOS_QUERY_KEY = ["playbook", "combos"] as const;

export function usePlaybookCombos() {
  return useQuery<PlaybookCombosResponse>({
    queryKey: PLAYBOOK_COMBOS_QUERY_KEY,
    queryFn: fetchPlaybookCombos,
    // Don't even attempt the fetch when the backend API isn't wired
    // up (dev environments missing VITE_API_BASE_URL/VITE_ADMIN_API_KEY).
    // Callers can detect data === undefined + isFetching === false and
    // fall back to the bundled UNIQUE_COMBOS snapshot in that case.
    enabled: isPlaybookApiConfigured(),
    // The sheet changes only when an operator verifies a combo OR the
    // hourly cron appends a new one. Five minutes is a reasonable
    // freshness window; explicit invalidation on save covers the
    // operator-edit case without waiting for the timer.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
