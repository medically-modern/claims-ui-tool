import { useCallback, useEffect, useRef, useState } from "react";
import type { Patient, ProductCodeId, ProductCodeState } from "@/lib/samantha/workflow";
import { fetchGroupItems, fetchItemById, GROUPS, hasToken } from "@/lib/samantha/mondayApi";
import { mondayItemToPatient } from "@/lib/samantha/mondayMapping";

/**
 * Apply the local-edit overlay on top of a freshly-fetched patient.
 *
 * IMPORTANT: insurance.codes must be deep-merged per code id, NOT shallow-replaced.
 * The user's overlay holds fields they edited (auth, sos), but the fresh fetch from
 * an auth-group fetch ALSO carries Monday-only readback fields like _mondayAuthLabel,
 * methods, dates. A naive `{ ...p, ...overlay }` clobbers those Monday fields when
 * the user switches from Benefits → Submit Auth (the overlay was built without them).
 */
function applyOverlay(p: Patient, o: Partial<Patient> | undefined): Patient {
  if (!o) return p;
  const merged: Patient = { ...p, ...o };
  if (o.insurance && p.insurance) {
    const fromMondayCodes = p.insurance.codes ?? {};
    const fromOverlayCodes = o.insurance.codes ?? {};
    const codeKeys = new Set<ProductCodeId>([
      ...(Object.keys(fromMondayCodes) as ProductCodeId[]),
      ...(Object.keys(fromOverlayCodes) as ProductCodeId[]),
    ]);
    const codes: Partial<Record<ProductCodeId, ProductCodeState>> = {};
    for (const k of codeKeys) {
      codes[k] = {
        ...(fromMondayCodes[k] ?? { status: "pending" }),
        ...(fromOverlayCodes[k] ?? {}),
      } as ProductCodeState;
    }
    merged.insurance = {
      ...p.insurance,
      ...o.insurance,
      codes,
    };
  }
  return merged;
}

const POLL_MS = 30_000;
const LS_KEY = "sam-overlays";
const LS_CACHE_KEY = "sam-patients-cache";

function loadCachedPatients(): Patient[] {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Patient[];
  } catch { return []; }
}

function persistPatientCache(patients: Patient[]): void {
  try {
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(patients));
  } catch { /* ignore */ }
}

function loadOverlays(): Map<string, Partial<Patient>> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, Partial<Patient>>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function persistOverlays(map: Map<string, Partial<Patient>>): void {
  try {
    const obj: Record<string, Partial<Patient>> = {};
    map.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    // Storage full or unavailable
  }
}

function removeOverlay(id: string): void {
  try {
    const map = loadOverlays();
    map.delete(id);
    persistOverlays(map);
  } catch {
    // ignore
  }
}

export type SidebarGroup = "benefits" | "submitAuth" | "authOutstanding";

export function useMondayPatients(activeGroup: SidebarGroup = "benefits", injectedPatientId?: string | null) {
  const cachedRef = useRef(loadCachedPatients());
  const [patients, setPatients] = useState<Patient[]>(cachedRef.current);
  const [loading, setLoading] = useState(cachedRef.current.length === 0);
  const [error, setError] = useState<string | null>(null);
  // local-session overlay so UI edits persist without re-fetching from Monday
  const overlayRef = useRef<Map<string, Partial<Patient>>>(loadOverlays());

  const mountedRef = useRef(true);

  const refetch = useCallback(async (maybeSilent: unknown = false) => {
    const silent = maybeSilent === true;
    if (!hasToken()) {
      if (mountedRef.current) {
        setError("VITE_MONDAY_API_TOKEN is not set. Add it in your project env vars and rebuild.");
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const groupId = GROUPS[activeGroup];
      const items = await fetchGroupItems(groupId);
      if (!mountedRef.current) return;
      const safeItems = Array.isArray(items) ? items : [];
      const ps = safeItems.map(mondayItemToPatient);
      const merged = ps.map((p) => applyOverlay(p, overlayRef.current.get(p.id)));

      // If a specific patient was deep-linked but isn't in this group, fetch individually.
      if (injectedPatientId && !merged.some((p) => p.id === injectedPatientId)) {
        try {
          const useAuth = activeGroup === "authOutstanding";
          const item = await fetchItemById(injectedPatientId, useAuth);
          if (item) {
            const injected = mondayItemToPatient(item);
            merged.unshift(applyOverlay(injected, overlayRef.current.get(injected.id)));
          }
        } catch { /* ignore \u2014 patient may not be on this board */ }
      }

      setPatients(merged);
      persistPatientCache(merged);
    } catch (e) {
      if (mountedRef.current)
        setError(e instanceof Error ? e.message : "Failed to load patients from Monday");
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, [activeGroup]);

  useEffect(() => {
    mountedRef.current = true;
    refetch(cachedRef.current.length > 0);
    const id = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refetch]);

  // Local-only update — used by UI handlers. Does NOT write to Monday;
  // call writeStatusIndex from mondayApi for that.
  const update = useCallback((id: string, patch: Partial<Patient>) => {
    overlayRef.current.set(id, { ...(overlayRef.current.get(id) ?? {}), ...patch });
    setPatients((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        return { ...p, ...patch, lastUpdated: new Date().toISOString() };
      }),
    );
  }, []);

  const clearOverlay = useCallback((id: string) => {
    overlayRef.current.delete(id);
    removeOverlay(id);
  }, []);


  const saveOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    if (overlay) {
      const saved = loadOverlays();
      saved.set(id, overlay);
      persistOverlays(saved);
    }
  }, []);

  const hasOverlay = useCallback((id: string) => {
    const overlay = overlayRef.current.get(id);
    return !!overlay && Object.keys(overlay).length > 0;
  }, []);


  return { patients, loading, error, refetch, update, clearOverlay, saveOverlay, hasOverlay };
}
