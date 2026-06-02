// Medicare A&B jurisdiction lookup.
//
// CMS splits the country into four Medicare Administrative Contractor
// (MAC) jurisdictions. Each state belongs to exactly one. When the
// operator is reading a Medicare A&B claim, knowing the jurisdiction
// up front helps cross-reference fee schedules, denial reason
// references, and the right MAC's portal / phone number — all of
// which differ per jurisdiction.
//
// Source: CMS MAC jurisdiction map (verified 2026-06-01).
//
// Jurisdictions:
//   A — Noridian JE       Northeast + DC
//   B — CGS Administrators Midwest (Great Lakes)
//   C — Palmetto GBA       South + Caribbean territories
//   D — Noridian JF        West + Pacific territories
//
// Only meaningful for Medicare A&B (traditional FFS Medicare). Medicare
// Advantage plans (Anthem Medicare, United Medicare, Aetna Medicare,
// etc.) are administered by commercial payers and don't have a MAC
// jurisdiction — those rows shouldn't show this pill.

export type MedicareJurisdiction = "A" | "B" | "C" | "D";

const STATE_TO_JURISDICTION: Record<string, MedicareJurisdiction> = {
  // ── Jurisdiction A — Noridian JE ──────────────────────────────────────────
  CT: "A", DE: "A", ME: "A", MD: "A", MA: "A",
  NH: "A", NJ: "A", NY: "A", PA: "A", RI: "A",
  VT: "A", DC: "A",

  // ── Jurisdiction B — CGS Administrators ───────────────────────────────────
  IL: "B", IN: "B", KY: "B", MI: "B", MN: "B",
  OH: "B", WI: "B",

  // ── Jurisdiction C — Palmetto GBA ─────────────────────────────────────────
  AL: "C", AR: "C", CO: "C", FL: "C", GA: "C",
  LA: "C", MS: "C", NM: "C", NC: "C", OK: "C",
  SC: "C", TN: "C", TX: "C", VA: "C", WV: "C",
  PR: "C", VI: "C", // Puerto Rico, U.S. Virgin Islands

  // ── Jurisdiction D — Noridian JF ──────────────────────────────────────────
  AK: "D", AZ: "D", CA: "D", HI: "D", ID: "D",
  IA: "D", KS: "D", MO: "D", MT: "D", NE: "D",
  NV: "D", ND: "D", OR: "D", SD: "D", UT: "D",
  WA: "D", WY: "D",
  AS: "D", GU: "D", MP: "D", // American Samoa, Guam, Northern Mariana Is.
};

/** Look up the Medicare A&B jurisdiction for a 2-letter state code.
 *  Case-insensitive. Returns null when the code isn't a US state /
 *  territory we recognize (e.g. blank, unparseable, or a country
 *  abbreviation that snuck through the address parser). */
export function medicareJurisdictionForState(
  stateCode: string | null | undefined,
): MedicareJurisdiction | null {
  if (!stateCode) return null;
  const code = stateCode.trim().toUpperCase();
  if (code.length !== 2) return null;
  return STATE_TO_JURISDICTION[code] ?? null;
}

/** True when this claim is on traditional Medicare A&B (the only payer
 *  that maps to MAC jurisdictions). Medicare Advantage plans are
 *  excluded — they're administered by commercial payers and don't
 *  have a MAC jurisdiction. */
export function isMedicareABClaim(primaryPayor: string | null | undefined): boolean {
  if (!primaryPayor) return false;
  // Match the same pattern cashflow.ts uses (^Medicare A&B), case-insensitive.
  return /^Medicare A&B/i.test(primaryPayor);
}
