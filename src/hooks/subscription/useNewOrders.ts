import { useQuery } from "@tanstack/react-query";
import { hasMondayToken } from "@/api/monday";
import { fetchNewOrders, NewOrderRow } from "@/api/queries/newOrders";

export const NEW_ORDERS_QUERY_KEY = ["subscription", "newOrders"] as const;

export function useNewOrders() {
  const q = useQuery<NewOrderRow[]>({
    queryKey: NEW_ORDERS_QUERY_KEY,
    queryFn: fetchNewOrders,
    enabled: hasMondayToken(),
    staleTime:         30 * 1000,
    gcTime:            24 * 60 * 60 * 1000,
    refetchInterval:        30 * 1000,
    refetchIntervalInBackground: false,
    refetchOnMount:       "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect:   true,
  });
  return {
    data: q.data ?? [],
    loading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error ? (q.error as Error).message : null,
    refetch: q.refetch,
    dataUpdatedAt: q.dataUpdatedAt,
  };
}
