import { UNIQUE_COMBOS, type UniqueCombo } from "@/lib/claims/uniqueCombos";

/**
 * A "playbook row" is the live equivalent of UniqueCombo — a row off
 * the Denial Playbook Sheet's "Unique Combos" tab. Both the bundled
 * UNIQUE_COMBOS snapshot and the live PlaybookRow shape (from
 * /admin/playbook/combos in src/api/playbook.ts) satisfy this — they
 * use identical column-name keys. Functions in this module accept
 * either, so callers can pass the React-Query-cached live rows from
 * usePlaybookCombos when available and fall back to the static
 * snapshot when not (dev environments without API config).
 */
export type PlaybookRowLike = Pick<
  UniqueCombo,
  | "CARC Code(s)"
  | "RARC Code(s)"
  | "CARC Remarks"
  | "RARC Remarks"
  | "Denial Analysis"
  | "Verified: Denial Analysis"
>;

// Build CARC -> full remark text, RARC -> full remark text. Memoized
// per-source: the bundled snapshot is loaded once at module init; live
// rows passed in get a cached map keyed by reference identity so
// repeated calls on the same array don't rebuild.
function buildRemarkMaps(rows: readonly PlaybookRowLike[]) {
  const carcMap = new Map<string, string>();
  const rarcMap = new Map<string, string>();
  for (const row of rows) {
    const carcCodes = String(row["CARC Code(s)"] ?? "")
      .split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const rarcCodes = String(row["RARC Code(s)"] ?? "")
      .split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const carcRemarks = String(row["CARC Remarks"] ?? "")
      .split(";").map((s) => s.trim()).filter(Boolean);
    const rarcRemarks = String(row["RARC Remarks"] ?? "")
      .split(";").map((s) => s.trim()).filter(Boolean);

    carcCodes.forEach((code) => {
      const match = carcRemarks.find((r) => new RegExp(`(^|[^0-9])${code}\\b`).test(r));
      if (match && !carcMap.has(code)) carcMap.set(code, match);
    });
    rarcCodes.forEach((code) => {
      const match = rarcRemarks.find((r) => new RegExp(`^${code}\\b`).test(r));
      if (match && !rarcMap.has(code)) rarcMap.set(code, match);
    });
  }
  return { carcMap, rarcMap };
}

const _staticRemarkMaps = buildRemarkMaps(UNIQUE_COMBOS);
const _liveRemarkCache = new WeakMap<
  readonly PlaybookRowLike[],
  { carcMap: Map<string, string>; rarcMap: Map<string, string> }
>();

function remarkMapsFor(rows?: readonly PlaybookRowLike[]) {
  if (!rows) return _staticRemarkMaps;
  let entry = _liveRemarkCache.get(rows);
  if (!entry) {
    entry = buildRemarkMaps(rows);
    _liveRemarkCache.set(rows, entry);
  }
  return entry;
}

export function carcPlaybookText(
  code: string | number,
  rows?: readonly PlaybookRowLike[],
): string | null {
  const key = String(code).replace(/^CO-?/i, "").replace(/^PR-?/i, "").trim();
  return remarkMapsFor(rows).carcMap.get(key) ?? null;
}

export function rarcPlaybookText(
  code: string,
  rows?: readonly PlaybookRowLike[],
): string | null {
  return remarkMapsFor(rows).rarcMap.get(code.trim()) ?? null;
}

/**
 * State of a (CARC, RARC) combo in the Denial Playbook:
 *   verified   — combo exists in the playbook with "Verified: Denial
 *                Analysis" = "Yes". Auto-fillable on future ERAs.
 *   unverified — combo exists in the playbook but isn't verified yet
 *                (no operator signoff on the bucket).
 *   new        — combo isn't in the playbook at all. Brand-new denial
 *                pattern we haven't seen before — gets flagged so it
 *                can be added to the Unique Combos sheet.
 *
 * Mirrors the three branches the backend takes when it stamps Action
 * Context on the subitem during ERA ingestion (see
 * services/monday_service.py:populate_era_service_line_subitems). The
 * frontend doesn't read that breadcrumb; it re-derives the same state
 * by querying its bundled snapshot here.
 */
export type DenialPlaybookState = "verified" | "unverified" | "new";

export interface DenialAnalysisLookup {
  /** Human-readable bucket label (e.g. "SoS (units/frequency)"), or
   *  null when the combo isn't in the playbook at all. */
  reason: string | null;
  state: DenialPlaybookState;
}

/**
 * Look up the playbook bucket + verification state for a denial.
 *
 * Returns:
 *   { reason, state: "verified" }    — exact match with Verified=Yes
 *   { reason, state: "unverified" }  — exact OR CARC-only partial match
 *                                       but Verified != "Yes"
 *   { reason: null, state: "new" }   — no match in the playbook snapshot
 *
 * Empty CARC/RARC inputs return "new" so the UI surfaces a red flag on
 * denied lines that arrived without adjustment codes — that's itself a
 * data issue worth seeing.
 *
 * The backend's bundled JSON (services/denial_playbook_data.json) and
 * the frontend's UNIQUE_COMBOS export are parallel snapshots of the
 * "Unique Combos" tab in the Denial Playbook Sheet (sheet id
 * 1xqqLEw6T3gIzpd2YHskp7joaLEmxr7y17c6BmeuI3lA). Phase 2 will swap
 * this static lookup for a live API read so verified buckets appear
 * in the UI within seconds of operator save, but the return shape
 * here is designed to stay the same so callers don't change.
 */
export function lookupDenialAnalysis(
  carc: (string | number)[],
  rarc: string[],
  rows?: readonly PlaybookRowLike[],
): DenialAnalysisLookup {
  if (carc.length === 0 && rarc.length === 0) {
    return { reason: null, state: "new" };
  }

  const carcKey = [...carc].map((c) => String(c).trim()).sort().join(",");
  const rarcKey = [...rarc].map((c) => c.trim()).sort().join(",");

  // Live rows from usePlaybookCombos when available; bundled snapshot
  // as a fallback for dev environments without API config and the
  // very first paint before the React Query fetch resolves.
  const source: readonly PlaybookRowLike[] = rows ?? UNIQUE_COMBOS;

  let bestExact: { reason: string; verified: boolean } | null = null;
  let bestPartial: { reason: string; verified: boolean } | null = null;

  for (const row of source) {
    const rowCarc = String(row["CARC Code(s)"] ?? "")
      .split(/[,;]/).map((s) => s.trim()).filter(Boolean).sort().join(",");
    const rowRarc = String(row["RARC Code(s)"] ?? "")
      .split(/[,;]/).map((s) => s.trim()).filter(Boolean).sort().join(",");

    const verified = String(row["Verified: Denial Analysis"] ?? "").toLowerCase() === "yes";
    const reason = String(row["Denial Analysis"] ?? "");

    if (rowCarc === carcKey && rowRarc === rarcKey) {
      // Exact match. A verified hit wins outright; otherwise hold onto
      // it as the unverified-best in case nothing better turns up.
      if (verified) return { reason: reason || "", state: "verified" };
      if (!bestExact) bestExact = { reason, verified };
    } else if (!bestPartial && rowCarc === carcKey) {
      // CARC-only partial — used as a fallback when the exact (CARC,
      // RARC) tuple isn't in the playbook but we've seen the CARC alone.
      bestPartial = { reason, verified };
    }
  }

  const hit = bestExact ?? bestPartial;
  if (!hit) return { reason: null, state: "new" };
  return { reason: hit.reason || null, state: "unverified" };
}
