import { UNIQUE_COMBOS } from "@/lib/claims/uniqueCombos";

// Build CARC -> full remark text, RARC -> full remark text from the playbook
const carcRemarkMap = new Map<string, string>();
const rarcRemarkMap = new Map<string, string>();

for (const row of UNIQUE_COMBOS) {
  const carcCodes = String(row["CARC Code(s)"] ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rarcCodes = String(row["RARC Code(s)"] ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const carcRemarks = String(row["CARC Remarks"] ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const rarcRemarks = String(row["RARC Remarks"] ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  carcCodes.forEach((code) => {
    const match = carcRemarks.find((r) => new RegExp(`(^|[^0-9])${code}\\b`).test(r));
    if (match && !carcRemarkMap.has(code)) carcRemarkMap.set(code, match);
  });
  rarcCodes.forEach((code) => {
    const match = rarcRemarks.find((r) => new RegExp(`^${code}\\b`).test(r));
    if (match && !rarcRemarkMap.has(code)) rarcRemarkMap.set(code, match);
  });
}

export function carcPlaybookText(code: string | number): string | null {
  const key = String(code).replace(/^CO-?/i, "").replace(/^PR-?/i, "").trim();
  return carcRemarkMap.get(key) ?? null;
}

export function rarcPlaybookText(code: string): string | null {
  return rarcRemarkMap.get(code.trim()) ?? null;
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
): DenialAnalysisLookup {
  if (carc.length === 0 && rarc.length === 0) {
    return { reason: null, state: "new" };
  }

  const carcKey = [...carc].map((c) => String(c).trim()).sort().join(",");
  const rarcKey = [...rarc].map((c) => c.trim()).sort().join(",");

  let bestExact: { reason: string; verified: boolean } | null = null;
  let bestPartial: { reason: string; verified: boolean } | null = null;

  for (const row of UNIQUE_COMBOS) {
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
