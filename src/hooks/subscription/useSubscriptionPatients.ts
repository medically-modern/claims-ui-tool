/**
 * useSubscriptionPatients.ts — single source of truth for live
 * Subscription Board data across all Subscription tabs.
 *
 * Returns { data, loading, error, refetch }. data is undefined while
 * the first fetch is in flight; subsequent refetches keep the
 * previous data visible and just flip loading.
 *
 * On token-missing or fetch failure, returns the existing mock
 * ORDER_PREP_PATIENTS so the UI doesn't go blank in dev / preview
 * builds without VITE_MONDAY_API_TOKEN.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchSubscriptionPatients, type LiveSubscriptionPatient,
} from "@/api/queries/subscriptionPatients";
import { ORDER_PREP_PATIENTS } from "@/components/subscription/mockData";

interface State {
  data: LiveSubscriptionPatient[] | undefined;
  loading: boolean;
  error: string | null;
  usingMock: boolean;
}

export function useSubscriptionPatients() {
  const [state, setState] = useState<State>({
    data: undefined, loading: true, error: null, usingMock: false,
  });
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchSubscriptionPatients();
      if (!mounted.current) return;
      setState({ data, loading: false, error: null, usingMock: false });
    } catch (e) {
      if (!mounted.current) return;
      const msg = (e as Error).message;
      // Dev / preview fallback: surface the mock so the UI still works
      setState({
        data: ORDER_PREP_PATIENTS as unknown as LiveSubscriptionPatient[],
        loading: false,
        error: msg,
        usingMock: true,
      });
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  return { ...state, refetch };
}
