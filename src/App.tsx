// app entry
//
// React Query is wrapped in PersistQueryClientProvider so the cache
// rehydrates from localStorage on every reload. That's the difference
// between "10 seconds of blank screen while Monday's GraphQL API
// re-paginates 1500+ claim rows" and "instant first paint with
// yesterday's data, refresh in the background." A 5-min staleTime
// on the heavy queries means a fresh reload within the staleness
// window won't even hit Monday at all.
//
// Cache buster: VITE_BUILD_SHA (set by the GH Pages workflow). When
// a new deploy lands with a different commit hash, the persisted
// cache is dropped wholesale on first load — protects against
// new-build / old-cached-shape mismatches (e.g. the Claim type
// gaining a new field that older entries don't carry).
//
// Storage: window.localStorage. ~5MB quota per origin; the claims
// + secondary + playbook caches we persist add up to well under
// that even on the biggest accounts. The persister writes JSON
// synchronously per cache mutation; React Query throttles those
// writes internally so we don't thrash the disk.
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Claims from "./pages/Claims.tsx";
import ClaimDetail from "./pages/ClaimDetail.tsx";
import ReplayEra from "./pages/ReplayEra.tsx";
import { ThreadClaimsProvider } from "@/lib/claims/threadStore";
import { BuildBadge } from "@/components/BuildBadge";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // gcTime > maxAge of the persister so React Query doesn't drop
      // an entry from memory between mounts before the persister has
      // a chance to write it. Per-query staleTime (5 min) is set in
      // each useAllClaims / useAllSecondaryClaims hook — the
      // persistence layer respects that, so a reload within 5 min of
      // the last fetch renders instantly without hitting Monday.
      gcTime: ONE_DAY_MS,
    },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "claims-ui-tool:react-query-cache",
  // 1.5MB compact threshold — beyond this the persister skips
  // serialising entries instead of blowing localStorage's quota.
  // 1500 claim rows sit comfortably under this; the EFT enrollment
  // tracker + playbook combos are tiny.
  throttleTime: 1000,
});

const App = () => (
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister,
      // Drop the cache after a day — fresh enough that we don't
      // render week-old data on a vacation return, long enough that
      // routine same-day reloads always hit the cache.
      maxAge: ONE_DAY_MS,
      // Bust the cache whenever a new build ships. Keeps us safe
      // from schema drift (e.g. adding a new field to Claim).
      buster: (import.meta.env.VITE_BUILD_SHA as string) || "dev",
      dehydrateOptions: {
        // Persist only successful fetches. Mutations + in-flight
        // queries aren't useful across reloads.
        shouldDehydrateQuery: (query) => query.state.status === "success",
      },
    }}
  >
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ThreadClaimsProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/claims" element={<Claims />} />
            <Route path="/claims/:claimId" element={<ClaimDetail />} />
            <Route path="/replay-era" element={<ReplayEra />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BuildBadge />
        </ThreadClaimsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </PersistQueryClientProvider>
);

export default App;
