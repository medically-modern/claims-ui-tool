/**
 * useOrderingCycleSync — after every fresh read of the Subscription Board,
 * write back any Ordering Cycle label the tool disagrees with (Order Prep ↔
 * Ready to Order only; lib/subscription/orderingCycleSync.ts has the rules).
 *
 * Guards:
 *  - only after a network fetch in THIS session (isFetchedAfterMount), never
 *    from the restored IndexedDB snapshot, which may be an hour old;
 *  - one pass per dataUpdatedAt, so a render never re-triggers writes;
 *  - a row/target written in the last 5 minutes is not written again, so two
 *    browsers (or a slow Monday) can't ping-pong;
 *  - writes run 4 at a time and the board refetches when they land.
 *
 * Every pass that writes anything is reported through `last` so the board
 * can show "Synced 3 with Monday".
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveSubscriptionPatient } from "@/api/setSubscriptionPatient";
import type { LanePatient } from "@/lib/subscription/lanes";
import { describeSync, planSync, type SyncWrite } from "@/lib/subscription/orderingCycleSync";
import { useInvalidateSubscription } from "./useInvalidateSubscription";
import { useSubscriptionPatients } from "./useSubscriptionPatients";

const RECENT_MS = 5 * 60 * 1000;
const WIDTH = 4;

export interface SyncReport { at: number; writes: SyncWrite[]; failed: number }

export function useOrderingCycleSync(): { last: SyncReport | null; syncing: boolean } {
  const { data, dataUpdatedAt, isFetching, isFetchedAfterMount, usingMock } = useSubscriptionPatients();
  const { invalidate } = useInvalidateSubscription();
  const [last, setLast] = useState<SyncReport | null>(null);
  const [syncing, setSyncing] = useState(false);
  const donePass = useRef(0);
  const recent = useRef(new Map<string, number>());

  useEffect(() => {
    if (!data || usingMock || isFetching || !isFetchedAfterMount) return;
    if (!dataUpdatedAt || donePass.current === dataUpdatedAt) return;
    donePass.current = dataUpdatedAt;

    const now = Date.now();
    const plan = planSync(data as unknown as LanePatient[]).filter((w) => {
      const k = `${w.itemId}:${w.to}`;
      const t = recent.current.get(k);
      return !(t && now - t < RECENT_MS);
    });
    if (plan.length === 0) return;

    let live = true;
    setSyncing(true);
    (async () => {
      let failed = 0;
      let i = 0;
      const worker = async () => {
        while (i < plan.length) {
          const w = plan[i++];
          recent.current.set(`${w.itemId}:${w.to}`, Date.now());
          try {
            const r = await saveSubscriptionPatient(w.itemId, { orderingCycle: w.to });
            if (r.failed.length) failed++;
          } catch {
            failed++;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(WIDTH, plan.length) }, worker));
      if (!live) return;
      setLast({ at: Date.now(), writes: plan, failed });
      setSyncing(false);
      toast.success(`Monday updated — ${describeSync(plan)}`, failed ? { description: `${failed} write${failed === 1 ? "" : "s"} failed; will retry on the next refresh` } : undefined);
      void invalidate();
    })();
    return () => { live = false; };
  }, [data, dataUpdatedAt, isFetching, isFetchedAfterMount, usingMock, invalidate]);

  return { last, syncing };
}
