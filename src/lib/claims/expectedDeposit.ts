// Per-payer expected-deposit-date rules. The X12 835 BPR16
// (check_issue_or_eft_effective_date) carries the payer's stated EFT
// date, but different payers map that to different real bank-settlement
// dates. We surface the *expected* deposit date in the UI so the
// operator knows when to actually look for it in Chase.
//
// Empirically (logged from real ERA → bank-feed reconciliation):
//   - Fidelis (BOP method): always sits 1 business day after BPR16.
//     They issue on Friday, money lands Monday.
//   - NY Medicaid (MCDNY): always sits 1 business day after BPR16.
//     They issue Wednesday, money lands Thursday.
//   - Medicare (Noridian / ACH): same day as BPR16. No shift.
//   - Anthem commercial: same day as BPR16. No shift.
//   - Everything else: assume same day until we learn otherwise.
//
// The raw BPR16 date stays untouched in Monday data — only the
// displayed value is shifted, with a tooltip exposing the underlying
// payer-stated date and the rule that applied.

/** Payer-name patterns that get +1 business day applied to BPR16. */
const EFT_LAG_PAYORS: { pattern: RegExp; reason: string }[] = [
  // Fidelis Care variants — "Fidelis Care", "Fidelis Medicaid",
  // "Fidelis Care New York", "Fidelis Care New York-Exchanges",
  // "FIDELIS CARE NEW YORK - MEDICARE ADVANTAGE", etc.
  { pattern: /^fidelis/i,    reason: "Fidelis +1 business day" },
  // Any payer whose name contains "Medicaid" — NY Medicaid (MCDNY),
  // Medicaid, Medicaid Managed Care, etc. NOTE: this also matches
  // "Fidelis Medicaid", which is fine — Fidelis already gets +1.
  { pattern: /\bmedicaid\b/i, reason: "Medicaid +1 business day"  },
];

/** Returns the matched rule (or null) for a given payer name. */
function lagRuleFor(payor?: string | null): { reason: string } | null {
  if (!payor) return null;
  const hit = EFT_LAG_PAYORS.find((r) => r.pattern.test(payor));
  return hit ? { reason: hit.reason } : null;
}

/**
 * Add N business days to a YYYY-MM-DD ISO date, skipping Saturday and
 * Sunday. Holidays NOT skipped — too varied per payer / processor to
 * model centrally. Operator can eyeball weekends; the once-per-year
 * holiday miss is acceptable for now.
 */
function addBusinessDays(iso: string, days: number): string {
  // Anchor at noon to dodge DST / timezone-rollback edge cases —
  // setDate() math is local-time, and we want consistent YYYY-MM-DD
  // output regardless of where the browser thinks it is.
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d.toISOString().slice(0, 10);
}

export interface ExpectedDeposit {
  /** ISO date string the UI should show as the deposit date. */
  date: string | null;
  /** True when the rule actually shifted the date (vs identity). */
  shifted: boolean;
  /** Human-readable reason — used as tooltip text on the cell. */
  reason: string | null;
  /** Original payer-stated BPR16 date. Always populated when date is. */
  source: string | null;
}

/**
 * Compute the expected bank-deposit date from an ERA's BPR16 and the
 * primary payer name. Falls through to identity (no shift) when no
 * rule matches.
 */
export function expectedDepositDate(
  bankEftDate: string | null | undefined,
  payor?: string | null,
): ExpectedDeposit {
  if (!bankEftDate) {
    return { date: null, shifted: false, reason: null, source: null };
  }
  const rule = lagRuleFor(payor);
  if (!rule) {
    return { date: bankEftDate, shifted: false, reason: null, source: bankEftDate };
  }
  return {
    date: addBusinessDays(bankEftDate, 1),
    shifted: true,
    reason: rule.reason,
    source: bankEftDate,
  };
}
