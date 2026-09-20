import { useQuery } from "@tanstack/react-query";
import { hasMondayToken } from "@/api/monday";
import { fetchPatientFiles, type PatientFile } from "@/api/queries/patientFiles";

/** The MN docs and insurance card on a patient's item, fetched when the
 *  profile opens. Links expire after an hour, so it re-fetches by then. */
export function usePatientFiles(mondayItemId: string | null | undefined) {
  const q = useQuery<PatientFile[]>({
    queryKey: ["subscription", "patientFiles", mondayItemId],
    queryFn: () => fetchPatientFiles(mondayItemId!),
    enabled: hasMondayToken() && !!mondayItemId,
    staleTime: 45 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
  return { files: q.data ?? [], loading: q.isLoading, error: q.error ? (q.error as Error).message : null, refetch: q.refetch };
}
