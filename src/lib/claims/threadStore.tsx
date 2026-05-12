import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  SAMPLE_THREAD_CLAIMS,
  createFollowUp,
  type ThreadClaim,
  type ThreadClaimType,
  type ThreadItem,
} from "./threads";

interface ThreadStore {
  claims: ThreadClaim[];
  updateClaim: (id: string, patch: Partial<ThreadClaim>) => void;
  updateItem: (claimId: string, itemId: string, patch: Partial<ThreadItem>) => void;
  addItem: (claimId: string, item: ThreadItem) => void;
  removeItem: (claimId: string, itemId: string) => void;
  spawnFollowUp: (parentId: string, type: ThreadClaimType) => ThreadClaim | null;
  addRoot: (claim: ThreadClaim) => void;
}

const Ctx = createContext<ThreadStore | null>(null);

export function ThreadClaimsProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<ThreadClaim[]>(SAMPLE_THREAD_CLAIMS);

  const updateClaim = useCallback((id: string, patch: Partial<ThreadClaim>) => {
    setClaims((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const updateItem = useCallback((claimId: string, itemId: string, patch: Partial<ThreadItem>) => {
    setClaims((all) =>
      all.map((c) =>
        c.id === claimId
          ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }
          : c,
      ),
    );
  }, []);

  const addItem = useCallback((claimId: string, item: ThreadItem) => {
    setClaims((all) =>
      all.map((c) => (c.id === claimId ? { ...c, items: [...c.items, item] } : c)),
    );
  }, []);

  const removeItem = useCallback((claimId: string, itemId: string) => {
    setClaims((all) =>
      all.map((c) =>
        c.id === claimId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c,
      ),
    );
  }, []);

  const spawnFollowUp = useCallback((parentId: string, type: ThreadClaimType) => {
    let created: ThreadClaim | null = null;
    setClaims((all) => {
      const parent = all.find((c) => c.id === parentId);
      if (!parent) return all;
      const { updatedParent, newClaim } = createFollowUp(parent, { type });
      created = newClaim;
      return [...all.map((c) => (c.id === parentId ? updatedParent : c)), newClaim];
    });
    return created;
  }, []);

  const addRoot = useCallback((claim: ThreadClaim) => {
    setClaims((all) => (all.some((c) => c.id === claim.id) ? all : [...all, claim]));
  }, []);

  const value = useMemo<ThreadStore>(
    () => ({ claims, updateClaim, updateItem, addItem, removeItem, spawnFollowUp, addRoot }),
    [claims, updateClaim, updateItem, addItem, removeItem, spawnFollowUp, addRoot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThreadClaims(): ThreadStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useThreadClaims must be used inside ThreadClaimsProvider");
  return v;
}
