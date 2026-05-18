// Cross-page "Marking paid…" state.
//
// When the operator clicks Mark Paid — from either the ERA Review row
// button OR the ClaimDetail page — the row should pulse with a processing
// chip until the Monday status propagates and the claim drops out of the
// Review bucket. Local React state in Claims.tsx is lost the moment the
// operator navigates to ClaimDetail and back, which made the detail-view
// Mark Paid look like it never fired when the operator returned to the
// list.
//
// Solution: sessionStorage. Survives navigation within a tab; auto-clears
// when the tab closes; never leaks across tabs / users.
//
// Each entry holds a millis timestamp so we can sweep stale ones after
// the 60s safety window (covers the 45s timeout in Claims.tsx + buffer).

const KEY = "claims:markPaidProcessing";
const MAX_AGE_MS = 60_000;

export type MarkPaidProcessingMap = Record<string, number>;

function read(): MarkPaidProcessingMap {
  if (typeof window === "undefined" || !window.sessionStorage) return {};
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as MarkPaidProcessingMap;
  } catch {
    return {};
  }
}

function write(next: MarkPaidProcessingMap): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    if (Object.keys(next).length === 0) {
      window.sessionStorage.removeItem(KEY);
    } else {
      window.sessionStorage.setItem(KEY, JSON.stringify(next));
    }
  } catch {
    // sessionStorage can be unavailable (e.g. Safari private mode);
    // silently fall through — the in-memory state still works.
  }
}

/** Sweep entries older than MAX_AGE_MS. Returns the cleaned map. */
function sweep(map: MarkPaidProcessingMap): MarkPaidProcessingMap {
  const now = Date.now();
  const out: MarkPaidProcessingMap = {};
  for (const [id, ts] of Object.entries(map)) {
    if (typeof ts === "number" && now - ts <= MAX_AGE_MS) {
      out[id] = ts;
    }
  }
  return out;
}

/** Mark a claim as currently being processed by Mark Paid. */
export function addProcessing(claimId: string): void {
  if (!claimId) return;
  const cur = sweep(read());
  cur[claimId] = Date.now();
  write(cur);
}

/** Remove a claim from the processing set. */
export function removeProcessing(claimId: string): void {
  if (!claimId) return;
  const cur = sweep(read());
  delete cur[claimId];
  write(cur);
}

/** Return the current processing map (with stale entries swept). Side
 *  effect: writes the swept map back so the next call is cheap. */
export function getAllProcessing(): MarkPaidProcessingMap {
  const cur = sweep(read());
  write(cur);
  return cur;
}
