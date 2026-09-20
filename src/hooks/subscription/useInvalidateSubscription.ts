/**
 * useInvalidateSubscription.ts — small helper for components that
 * mutate Subscription Board rows. After a successful Monday write,
 * call invalidate() to schedule a background refetch of the
 * subscription patients query so cached data catches up.
 *
 * markDvsRequested() is the optimistic half for Run DVS: the refetch takes
 * several seconds and the operator was staring at an unchanged amber circle
 * for all of them (Brandon, 2026-09-20). It rewrites the cached rows the way
 * deriveChecks will once Monday says Trigger DVS = "Trigger DVS" — the
 * Authorization circle becomes the gray "DVS requested" — and then asks for
 * the refetch, which replaces the guess with the real row.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { SUBSCRIPTION_PATIENTS_QUERY_KEY } from "./useSubscriptionPatients";

export function useInvalidateSubscription() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: SUBSCRIPTION_PATIENTS_QUERY_KEY });
  const markDvsRequested = (itemIds: string[]) => {
    if (!itemIds.length) return;
    const ids = new Set(itemIds.map(String));
    qc.setQueryData<LiveSubscriptionPatient[]>(SUBSCRIPTION_PATIENTS_QUERY_KEY, (rows) =>
      rows?.map((p) => ids.has(String(p.mondayItemId))
        ? { ...p, triggerDvs: "Trigger DVS", auth: { ...p.auth, tone: "pending", awaiting: true, label: "DVS requested", dvsNeeded: false, medicaidDvs: true, light: undefined, why: undefined, ruleId: undefined } }
        : p));
    void invalidate();
  };
  /** Optimistic half of Mark reviewed: the badge flips now, the refetch
   *  confirms. (Undo just refetches — the unread summary isn't kept.) */
  const markReviewed = (itemId: string, label: string) => {
    qc.setQueryData<LiveSubscriptionPatient[]>(SUBSCRIPTION_PATIENTS_QUERY_KEY, (rows) =>
      rows?.map((p) => String(p.mondayItemId) === String(itemId)
        ? { ...p, confirmation: { ...p.confirmation, needsRead: undefined, needsReadLines: undefined, reviewed: label } }
        : p));
    void invalidate();
  };
  return { invalidate, markDvsRequested, markReviewed };
}
