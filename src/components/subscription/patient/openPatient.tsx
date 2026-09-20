/**
 * openPatient — which patient is open full-page, app-wide.
 *
 * The patient page takes over the whole area under the app header: no
 * Claims/Subscription/Financials tabs, no Order Cycle/Patient Profile/… tabs;
 * the only switching is Profile | Orders | Claims for that patient, and Back
 * returns to the Order Cycle (Brandon, 2026-09-20). Held at the page level so
 * both the board's row click and the Patient Profile list can open it and
 * the top-level page can hide its chrome.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface OpenPatientState {
  id: string | null;
  open: (mondayItemId: string) => void;
  close: () => void;
}

const Ctx = createContext<OpenPatientState>({ id: null, open: () => {}, close: () => {} });

export function OpenPatientProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((mondayItemId: string) => setId(mondayItemId), []);
  const close = useCallback(() => setId(null), []);
  const value = useMemo(() => ({ id, open, close }), [id, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOpenPatient(): OpenPatientState {
  return useContext(Ctx);
}
