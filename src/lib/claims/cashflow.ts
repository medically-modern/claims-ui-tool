// Cash-flow bucketing across both the Primary Claims Board and the
// Secondary Claims Board.
//
// Buckets:
//   - "soonEra"      → ERA in hand (primary or secondary), future pay date
//   - "soonMedicaid" → pure Medicaid no ERA, settles within 7 days
//   - "expectedPrimaryNonMedicaid" → non-Medicaid primary no-ERA <21 days
//   - "expectedPrimaryMedicaid"    → pure Medicaid no-ERA >7 days away
//   - "expectedSecondaryConfirm"   → secondary awaiting operator to pick a
//     destination (Confirm Payor tab; status = Awaiting Payor Confirmation)
//   - "expectedSecondaryInsurance" → secondary in flight to a payer
//     (Submit Claim / Forwarded / Submitted) awaiting ERA
//   - "expectedSecondaryPatient"   → secondary type=Patient, awaiting payment
//   - "highRisk"     → non-Medicaid primary no ERA, 21+ days old
//   - "settled"      → already paid (paid date in the past)
//   - "out"          → pre-submission, write-off, terminal — not inflow
//
// Cash flow contribution per claim:
//   - settled primary ERA in hand future pay  → secondary cash flow (the
//     primary's already landed, money was counted then)
//   - primary awaiting ERA                    → est. pay
//   - secondary ERA in hand future pay        → secondaryPaid (what AARP/Medigap
//     will deposit)
//   - secondary awaiting ERA / patient        → c.remaining (the PR the primary
//     passed down)

import type { Claim } from "./types";
import type { SecClaim } from "@/components/claims/SecondaryBoard";

// Pure Medicaid only — variants like "Fidelis Medicaid" or "United Medicaid"
// pay on commercial timelines, not the 3-Wednesday cycle.
const PURE_MEDICAID_PAYERS = new Set(["Medicaid"]);

export function isPureMedicaid(payer: string | null | undefined): boolean {
  return !!payer && PURE_MEDICAID_PAYERS.has(payer.trim());
}

/**
 * eMedNY payment cycle rule. Verified against eMedNY's official
 * published cycle calendar (cycle 2543: end Wed 5/13/2026, check
 * release Wed 6/3/2026):
 *
 *   EFT date = cycle_end_Wednesday + 21 days
 *
 * where cycle_end_Wednesday is the next Wednesday ON OR AFTER the
 * submission date. Claims sent ON a Wednesday stay in THAT day's
 * cycle — they do not roll forward.
 *
 * Example: claim sent Wed 5/13 → cycle ends 5/13 → EFT Wed 6/3.
 * Example: claim sent Mon 5/18 → cycle ends Wed 5/20 → EFT Wed 6/10.
 *
 * Mirrors the backend _emedny_pay_date in services/claims_submission_
 * service.py — keep both in sync.
 */
export function medicaidPaymentDate(sentDate: Date): Date {
  const dow = sentDate.getDay(); // 0=Sun, 3=Wed
  const daysUntilWed = (3 - dow + 7) % 7;
  const cycleEnd = new Date(sentDate);
  cycleEnd.setDate(cycleEnd.getDate() + daysUntilWed);
  const eft = new Date(cycleEnd);
  eft.setDate(eft.getDate() + 21);
  return eft;
}

/** Parse a YYYY-MM-DD string as a *local* date (not UTC). Monday's
 *  date columns hand back date-only strings; new Date(s) on those
 *  defaults to UTC midnight and rolls back a day in any negative-
 *  offset timezone. Use this so date math operates on the same day
 *  Monday is showing. */
function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(s);
}

/** Render a Date as YYYY-MM-DD in local time (no UTC conversion). The
 *  output is consumed by fmtDate, which already parses YYYY-MM-DD as a
 *  local date — so the day rendered downstream matches the day the
 *  projection computed. */
function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type CashFlowBucket =
  | "soonEra"
  | "soonMedicaid"
  | "expectedPrimaryNonMedicaid"
  | "expectedPrimaryMedicaid"
  | "expectedSecondaryConfirm"
  | "expectedSecondaryInsurance"
  | "expectedSecondaryPatient"
  | "futurePump"
  | "highRiskDenials"
  | "highRiskLate"
  | "settled"
  | "out";

const SOON_HORIZON_DAYS = 7;
/** Non-Medicaid no-ERA claims younger than this are still expected to pay.
 *  Older than this and we treat it as stuck / High Risk. */
const EXPECTED_AGE_LIMIT_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Pre-submission / terminal primary statuses that aren't part of cash
// flow projection. Note: "Future Claim" is handled separately below —
// Medicare pump rentals sit in Future Claim until they're billed and
// have their own tile. Non-Medicare-pump Future Claims still fall
// through to "out".
const PRE_OR_TERMINAL: ReadonlySet<string> = new Set([
  "Submit Claim",
  "Not Started Yet",
  "Bad Debt",
  "Request Rejected",
]);

/** Bucket a primary-board Claim. */
export function classifyForCashFlow(claim: Claim, today: Date): CashFlowBucket {
  const todayMs = today.getTime();

  // Denials short-circuit BEFORE the paid-date check. Most denials
  // carry a primaryPaidDate (the ERA arrived and stamped $0 or a
  // partial); if we let the paid-date branch run first, those rows
  // would all bucket as "settled" and disappear from cash flow. A
  // denial is at risk regardless of whether an ERA has stamped it —
  // the dollar amount is the leftover (estPay - primaryPaid), handled
  // in expectedInflowAmount, not the headline projection.
  if (claim.primaryStatus === "Denied (Or Partly)") {
    return "highRiskDenials";
  }

  // Check paid date FIRST. The Primary status field doesn't tell us
  // whether money has actually hit the bank — the paid date does.
  if (claim.primaryPaidDate) {
    const paidMs = new Date(claim.primaryPaidDate).getTime();
    if (Number.isFinite(paidMs)) {
      if (paidMs <= todayMs) return "settled";
      const daysAway = Math.ceil((paidMs - todayMs) / MS_PER_DAY);
      if (daysAway > SOON_HORIZON_DAYS) {
        // Future ERA more than 7 days out → still scheduled inflow, but
        // there isn't a perfect Expected sub-bucket; treat as
        // expectedPrimaryNonMedicaid (Medicaid prefills usually fall
        // within the 7-day Soon window anyway).
        return isPureMedicaid(claim.primaryPayor)
          ? "expectedPrimaryMedicaid"
          : "expectedPrimaryNonMedicaid";
      }
      return isPureMedicaid(claim.primaryPayor) ? "soonMedicaid" : "soonEra";
    }
  }

  if (PRE_OR_TERMINAL.has(claim.primaryStatus)) return "out";
  if (claim.primaryStatus === "Paid") return "out";

  // Medicare pump rentals: a 13-month schedule, one claim per month.
  // The scheduled-but-not-yet-billed claims sit on Monday as "Future
  // Claim" with an E0784 line. We don't gate on payor here — Medicare
  // is the only payer that bills E0784 as a recurring monthly rental,
  // so the combination of "Future Claim" + E0784 is unambiguous on
  // its own. (A previous version required the primaryPayor regex to
  // match /^Medicare A&B/, which silently dropped rows whose payor
  // column read "Medicare" or any other variant.)
  if (
    claim.primaryStatus === "Future Claim" &&
    (claim.lines || []).some((l) => (l.hcpcs || "").trim() === "E0784")
  ) {
    return "futurePump";
  }
  // Future Claim that isn't a pump rental → genuinely pre-submission;
  // not yet expected inflow.
  if (claim.primaryStatus === "Future Claim") return "out";

  // No ERA yet — pure Medicaid uses the eMedNY cycle math. Parse the
  // sent date as local (not UTC) so the day-of-week we compute matches
  // the day Monday is showing — otherwise the projection lands a day
  // off after the UTC midnight shift.
  if (isPureMedicaid(claim.primaryPayor) && claim.claimSentDate) {
    const sent = parseLocalDate(claim.claimSentDate);
    if (Number.isFinite(sent.getTime())) {
      const projectedPay = medicaidPaymentDate(sent);
      const daysAway = Math.ceil(
        (projectedPay.getTime() - todayMs) / MS_PER_DAY,
      );
      return daysAway <= SOON_HORIZON_DAYS
        ? "soonMedicaid"
        : "expectedPrimaryMedicaid";
    }
  }

  // Non-Medicaid without ERA — Expected if still within normal payer
  // turnaround (< 21 days), High Risk past that.
  if (claim.claimSentDate) {
    const sent = new Date(claim.claimSentDate);
    if (Number.isFinite(sent.getTime())) {
      const ageDays = Math.floor((todayMs - sent.getTime()) / MS_PER_DAY);
      return ageDays < EXPECTED_AGE_LIMIT_DAYS
        ? "expectedPrimaryNonMedicaid"
        : "highRiskLate";
    }
  }

  return "highRiskLate";
}

/** Bucket a secondary-board SecClaim. */
export function classifyForCashFlowSecondary(
  claim: SecClaim,
  today: Date,
): CashFlowBucket {
  const todayMs = today.getTime();

  // Settled / closed-out states first.
  if (
    claim.status === "Patient Paid" ||
    claim.status === "Bad Debt"
  ) {
    return "out";
  }

  // Pay date already in the past → already landed, exclude from inflow.
  if (claim.secondaryPayDate) {
    const paidMs = new Date(claim.secondaryPayDate).getTime();
    if (Number.isFinite(paidMs)) {
      if (paidMs <= todayMs) return "settled";
      // ERA received with future pay date → Soon (ERA received).
      return "soonEra";
    }
  }

  // Confirm Payor — operator hasn't yet picked Insurance vs Patient on
  // a freshly-spawned secondary. This is the same predicate the
  // Secondary Board uses to put a row in its "Confirm Payor" tab
  // (see bucketFor() in SecondaryBoard.tsx). These claims can't move
  // forward until the operator acts, so the cash flow tile surfaces
  // them as their own line.
  if (claim.status === "Awaiting Payor Confirmation") {
    return "expectedSecondaryConfirm";
  }

  // No pay date yet. Patient-type goes to its own Expected sub-bucket.
  // Either the operator hasn't sent the statement yet, or it's out for
  // patient payment.
  if (
    claim.status === "Sent to Patient" ||
    (claim.secondaryPayer === "Patient")
  ) {
    return "expectedSecondaryPatient";
  }

  // Insurance/Forwarded — in flight to a secondary payer. Covers three
  // status values: "Primary Paid - Submit Secondary" (operator has
  // confirmed payor but hasn't fired the 837), "Primary Paid -
  // Forwarded" (Medicare auto-crossover, awaiting payer ERA), and
  // "Secondary Submitted" (837 sent, awaiting ERA). Rolled together
  // because from a cash-flow standpoint they all represent dollars
  // expected from an insurance payer.
  return "expectedSecondaryInsurance";
}

// ---------------------------------------------------------------------------
// Legacy fallback detection + historical-average correction.
//
// The backend stamps a flat legacy charge on supplies/pump lines when
// no payer rate schedule entry exists yet (see
// LEGACY_PROCEDURE_CODE_CHARGE_MAP in claim_assumptions.py):
//
//   E0784, A4224, A4225, A4230, A4231, A4232, E2103 → $1000 flat
//   A4239                                           → $500 per unit
//
// Those are intentionally high so the operator notices, but they wildly
// over-state cash flow projections. For the Cash Flow view we replace
// each "obviously legacy" line's estPay with a HCPCS-level historical
// average paid-per-unit, computed from the currently-loaded paid lines.
// Conservative hardcoded estimates are used as last-resort when we
// have no paid history yet.
//
// The actual Monday data is untouched — corrections live only inside
// this module's projection math. Each CashFlowEntry carries an
// `estimated` flag so the drill-down panel can visually mark which
// rows got rewritten.
// ---------------------------------------------------------------------------

const LEGACY_FLAT_CHARGE_HCPCS = new Set([
  "E0784",
  "A4224",
  "A4225",
  "A4230",
  "A4231",
  "A4232",
  "E2103",
]);
const LEGACY_FLAT_CHARGE_AMOUNT = 1000;
const LEGACY_PER_UNIT_HCPCS = new Set(["A4239"]);
const LEGACY_PER_UNIT_AMOUNT = 500;

/**
 * Conservative per-unit fallback estimates — used only when we have
 * NO paid-history data for this HCPCS+payorClass combination yet.
 *
 * Payor-aware because Medicare and commercial price the same HCPCS
 * very differently in some cases. E0784 is the canonical example:
 * Medicare bills it as a $300/month 13-month rental, commercial
 * bills it as a one-shot ~$2,500 purchase. Sharing one estimate
 * would either under-price commercials or over-price Medicare;
 * worse, a single commercial pump payment in the history would
 * pull the global E0784 average up and inflate every Medicare
 * patient's projected inflow.
 *
 * For HCPCS where Medicare and commercial price similarly (supplies,
 * sensors), only `default` is set and Medicare falls through to it.
 */
type PayorClass = "medicare" | "other";

const CONSERVATIVE_PER_UNIT_ESTIMATE: Record<
  string,
  Partial<Record<PayorClass, number>> & { default: number }
> = {
  E0784: { medicare: 300, default: 2500 }, // Medicare rental vs commercial purchase
  E2103: { default: 150 }, // monitor flat
  A4224: { default: 15 },
  A4225: { default: 3 },
  A4230: { default: 6 },
  A4231: { default: 6 },
  A4232: { default: 3 },
  A4239: { default: 150 }, // CGM sensors per unit
};

/** Map a primary-payor label to "medicare" or "other". We match any
 *  payor with the word Medicare anywhere in the name so Medicare
 *  Advantage plans like "United Medicare", "Aetna Medicare", "Anthem
 *  BCBS Medicare" — which all reimburse on the Medicare fee schedule
 *  for DME — get bucketed alongside traditional Medicare A&B. A
 *  /^Medicare/ prefix-only check would silently miss every MA plan,
 *  and we'd project pumps at the inflated commercial \$2,500 rate
 *  (or worse, whatever the rate schedule wrote). */
function payorClass(payor: string | null | undefined): PayorClass {
  return /\bMedicare\b/i.test((payor || "").trim()) ? "medicare" : "other";
}

function conservativeFor(hcpcs: string, payor: string | null | undefined): number | undefined {
  const entry = CONSERVATIVE_PER_UNIT_ESTIMATE[hcpcs];
  if (!entry) return undefined;
  const cls = payorClass(payor);
  return entry[cls] ?? entry.default;
}

/** True when a line's charge looks exactly like the backend's legacy
 *  fallback (flat $1000 for the flat HCPCS set, or $500 × units for
 *  A4239). False-positive risk is low — real contracted charges
 *  rarely land precisely on these magic numbers. */
function isLegacyFallbackLine(line: {
  hcpcs?: string;
  charge?: number;
  estPay?: number;
  units?: number;
}): boolean {
  const code = (line.hcpcs || "").trim();
  if (!code) return false;
  const charge = line.charge ?? 0;
  const units = Math.max(1, line.units ?? 1);
  if (LEGACY_FLAT_CHARGE_HCPCS.has(code) && charge === LEGACY_FLAT_CHARGE_AMOUNT) {
    return true;
  }
  if (LEGACY_PER_UNIT_HCPCS.has(code) && charge === LEGACY_PER_UNIT_AMOUNT * units) {
    return true;
  }
  return false;
}

/** Per-HCPCS-and-payor-class average paid-per-unit, computed from all
 *  paid lines in the loaded primary claims. Keyed by `${hcpcs}::${cls}`
 *  so Medicare and commercial averages don't bleed into each other
 *  (an inflated commercial pump payment shouldn't drive up the rate
 *  used to project a Medicare patient's monthly rental, and vice
 *  versa). Used to replace legacy-fallback estPay with a realistic
 *  projection. */
export type HistoricalRates = Record<string, number>;

function historyKey(hcpcs: string, payor: string | null | undefined): string {
  return `${hcpcs}::${payorClass(payor)}`;
}

export function buildHistoricalAverages(claims: Claim[]): HistoricalRates {
  const sums: Record<string, { sum: number; count: number }> = {};
  for (const c of claims) {
    for (const l of c.lines || []) {
      const code = (l.hcpcs || "").trim();
      if (!code) continue;
      const units = Math.max(1, l.units ?? 1);
      const paid = l.primaryPaid ?? 0;
      if (paid <= 0) continue;
      const perUnit = paid / units;
      const key = historyKey(code, c.primaryPayor);
      const bucket = sums[key] ?? { sum: 0, count: 0 };
      bucket.sum += perUnit;
      bucket.count += 1;
      sums[key] = bucket;
    }
  }
  const avg: HistoricalRates = {};
  for (const [key, { sum, count }] of Object.entries(sums)) {
    if (count > 0) avg[key] = sum / count;
  }
  return avg;
}

/**
 * Corrected estPay for one line. Returns { amount, corrected } —
 * `corrected` is true when we substituted a value because the line
 * looked like a legacy fallback OR because it's a Medicare pump
 * rental (which has a fixed monthly rate independent of what the
 * rate schedule wrote into the charge column).
 *
 * Both the historical-average lookup and the conservative fallback
 * are scoped by payor class (Medicare vs commercial) so a Medicare
 * line gets a Medicare estimate and not a commercial one.
 */
function correctedLineEstPay(
  line: {
    hcpcs?: string;
    charge?: number;
    estPay?: number;
    units?: number;
  },
  history: HistoricalRates,
  payor: string | null | undefined,
): { amount: number; corrected: boolean } {
  const code = (line.hcpcs || "").trim();

  // Medicare pump rental short-circuit. PAYER_RATE_SCHEDULE writes
  // Medicare A&B E0784 charge = \$600 which then flows into the
  // line's estPay, but the actual reimbursable monthly rental amount
  // is closer to \$300 (see CONSERVATIVE_PER_UNIT_ESTIMATE). Without
  // this override the legacy detection would skip the line (charge
  // doesn't match the \$1000 flat) and cash flow would project at
  // the inflated \$600. Force the correction whenever the payor is
  // Medicare and the line is E0784, regardless of what's in charge.
  const isMedicarePump = code === "E0784" && payorClass(payor) === "medicare";

  if (!isLegacyFallbackLine(line) && !isMedicarePump) {
    return { amount: line.estPay ?? 0, corrected: false };
  }
  const units = Math.max(1, line.units ?? 1);
  const historical = history[historyKey(code, payor)];
  if (historical != null && Number.isFinite(historical)) {
    return { amount: historical * units, corrected: true };
  }
  const conservative = conservativeFor(code, payor);
  if (conservative != null) {
    return { amount: conservative * units, corrected: true };
  }
  // No history, no conservative entry — leave it alone but still flag
  // so the operator sees the line is on a legacy estimate.
  return { amount: line.estPay ?? 0, corrected: true };
}

/**
 * Dollar contribution to cash flow for a primary claim. ERA-in-hand uses
 * the actual Primary Paid (truth, no correction). Otherwise we sum each
 * line's estPay, swapping legacy-fallback lines for the historical
 * average. Returns { amount, corrected } so the caller can flag the
 * entry as "estimated" in the drill-down panel.
 *
 * Denial special-case: the at-risk amount is the GAP between the
 * (corrected) estPay and whatever already paid — i.e., what we could
 * still recover by working the denial. A fully-denied claim contributes
 * its full estPay; a partial denial contributes only the unpaid
 * remainder so dollars that already landed aren't double-counted.
 */
export function expectedInflowAmount(
  claim: Claim,
  history: HistoricalRates = {},
): { amount: number; corrected: boolean } {
  const isDenied = claim.primaryStatus === "Denied (Or Partly)";

  // ERA in hand AND not a denial → trust what the payer actually sent.
  if (claim.primaryPaidDate && !isDenied) {
    return { amount: claim.primaryPaid, corrected: false };
  }

  // Sum the per-line corrected estPay (legacy fallbacks swapped for
  // historical averages where applicable). Payor is threaded through
  // so the correction picks the right Medicare-vs-commercial bucket.
  let estPayTotal = 0;
  let anyCorrected = false;
  for (const l of claim.lines || []) {
    const r = correctedLineEstPay(l, history, claim.primaryPayor);
    estPayTotal += r.amount;
    if (r.corrected) anyCorrected = true;
  }
  // Fallback for legacy rows with no subitems — use the parent rollup.
  if ((claim.lines || []).length === 0) {
    estPayTotal = claim.estPay;
  }

  // Denials: at-risk = estPay - whatever's already paid (clamp to 0
  // so over-paid denials don't show negative). Non-denial pre-ERA: the
  // full estPay is the projection.
  const amount = isDenied
    ? Math.max(0, estPayTotal - (claim.primaryPaid || 0))
    : estPayTotal;

  return { amount, corrected: anyCorrected };
}

/**
 * Dollar contribution to cash flow for a secondary claim. ERA-in-hand
 * uses the actual Secondary Paid; otherwise project from the PR the
 * primary passed down (c.remaining).
 */
export function expectedInflowAmountSecondary(claim: SecClaim): number {
  if (claim.secondaryPayDate && claim.secondaryPaid != null) {
    return claim.secondaryPaid;
  }
  return claim.remaining;
}

/**
 * One claim's contribution to a Cash Flow bucket, in just the form the
 * drill-down drawer needs to render: who, when service happened, when
 * money is expected, and how much. `kind` lets the drawer route clicks
 * (primaries open ClaimDetail; secondaries currently link to their
 * parent primary since the Secondary Board doesn't have its own detail
 * page). `payDate` is null when we don't yet have an ERA-stamped pay
 * date — the column shows a dash in that case.
 */
export interface CashFlowEntry {
  id: string;
  mondayItemId: string;
  name: string;
  /** Primary payor label off the claim — same for both primary and
   *  secondary entries (the secondary's parent primary). Shown as a
   *  column in the drill-down so the operator can identify the
   *  insurance carrier at a glance without clicking into ClaimDetail. */
  payor: string;
  dos: string | null;
  /** When the claim was originally sent to the payer. For the High Risk
   *  drill-downs especially this is the load-bearing piece of context —
   *  the operator needs to see how long a denial / Late ERA has been
   *  sitting before deciding which to work first. */
  claimSentDate: string | null;
  payDate: string | null;
  amount: number;
  kind: "primary" | "secondary";
  /** True when the row's amount came from a corrected legacy estPay —
   *  see correctedLineEstPay above. The drill-down panel renders these
   *  in amber with an "est." prefix so the operator can tell which
   *  numbers are historical-average projections vs. real estPay. */
  estimated?: boolean;
}

export interface BucketStat {
  count: number;
  total: number;
  entries: CashFlowEntry[];
}

export interface CashFlowStats {
  // Aggregate
  totalOpen: BucketStat;
  primaryTotal: BucketStat;
  secondaryTotal: BucketStat;

  // Soon
  soon: BucketStat;
  soonEra: BucketStat;
  soonMedicaid: BucketStat;

  // Expected (split five ways)
  expected: BucketStat;
  expectedPrimaryNonMedicaid: BucketStat;
  expectedPrimaryMedicaid: BucketStat;
  expectedSecondaryConfirm: BucketStat;
  expectedSecondaryInsurance: BucketStat;
  expectedSecondaryPatient: BucketStat;

  // Medicare pump 13-month rental schedule — scheduled-but-not-yet-
  // billed claims on Monday with status "Future Claim". Sits between
  // Expected and High Risk because the money is far enough out that
  // it isn't comparable to in-flight claims.
  futurePump: BucketStat;

  // High risk (primary only) — denials + late ERAs combined for the
  // tile total, plus the two sub-stats for drill-down rows.
  highRisk: BucketStat;
  highRiskDenials: BucketStat;
  highRiskLate: BucketStat;

  // Per-tile pump-claim breakdown. A claim counts as a pump claim when
  // any service line has HCPCS E0784. Pumps run $4k-$6k per claim so
  // they outsize the rest of the dollar totals — this lets the operator
  // see how much of each tile is "pump money" specifically.
  totalOpenPumps: BucketStat;
  soonPumps: BucketStat;
  expectedPumps: BucketStat;
  highRiskPumps: BucketStat;
}

function emptyStat(): BucketStat {
  return { count: 0, total: 0, entries: [] };
}

function addToStat(stat: BucketStat, entry: CashFlowEntry): void {
  stat.count += 1;
  stat.total += entry.amount;
  stat.entries.push(entry);
}

// CMS HCPCS for the insulin pump. A claim with this code on any line
// counts as a "pump claim" for Cash Flow breakdown purposes.
const PUMP_HCPCS = "E0784";

/** True only for *commercial* pump claims (E0784 line, primary payor
 *  is NOT Medicare A&B). Medicare bills E0784 as a 13-month rental at
 *  roughly $300/month — those are routine recurring transactions, not
 *  big-dollar one-shots, and they're already surfaced separately on
 *  the Future Pump tile. The "Pump claims" breakdown on
 *  Soon/Expected/High Risk/Total Open exists to flag commercial pumps
 *  (one-time ~$4-6k transactions) that disproportionately move the
 *  dollar totals; rolling Medicare rentals into the same row would
 *  drown that signal in monthly noise. */
function claimHasPump(c: Claim): boolean {
  if (/^Medicare A&B/i.test(c.primaryPayor || "")) return false;
  return (c.lines || []).some((l) => (l.hcpcs || "").trim() === PUMP_HCPCS);
}

/** Pay date for the drill-down drawer. ERA-in-hand → use that ERA's
 *  pay date. Pure-Medicaid awaiting ERA → use the projected eMedNY
 *  cycle pay date. Otherwise null (drawer shows a dash). Uses local-
 *  time parse + format so the day matches Monday's cell instead of
 *  shifting one day backward via UTC conversion. */
function projectedPrimaryPayDate(c: Claim): string | null {
  if (c.primaryPaidDate) return c.primaryPaidDate;
  if (isPureMedicaid(c.primaryPayor) && c.claimSentDate) {
    const sent = parseLocalDate(c.claimSentDate);
    if (!Number.isNaN(sent.getTime())) {
      return formatLocalYmd(medicaidPaymentDate(sent));
    }
  }
  return null;
}

function entryFromPrimary(
  c: Claim,
  amount: number,
  estimated: boolean,
): CashFlowEntry {
  return {
    id: c.id,
    mondayItemId: c.mondayItemId,
    name: c.patientName,
    payor: c.primaryPayor || "—",
    dos: c.dos || null,
    // Prefer Claim Resent Date when set — that's the effective last-
    // submission instant for aging (mirrors logic.ts effectiveSentDate).
    claimSentDate: c.claimResentDate || c.claimSentDate || null,
    payDate: projectedPrimaryPayDate(c),
    amount,
    kind: "primary",
    estimated,
  };
}

function entryFromSecondary(c: SecClaim, amount: number): CashFlowEntry {
  return {
    id: c.id,
    mondayItemId: c.mondayItemId ?? c.id,
    name: c.patientName,
    payor: c.primaryPayor || "—",
    dos: c.dos || null,
    // The secondary's own send date if we have it; otherwise the
    // primary's send date as a fallback so the column isn't empty.
    claimSentDate: c.secondarySentDate || c.primarySentDate || null,
    payDate: c.secondaryPayDate || null,
    amount,
    kind: "secondary",
  };
}

/** Merge multiple BucketStats into one. Entries are concatenated; the
 *  drawer sorts them at render time. Used to build the parent tiles
 *  (Soon, Expected, Total Open) out of their constituent sub-buckets,
 *  and to expose Primary / Secondary slices of Total Open. */
function mergeStats(...stats: BucketStat[]): BucketStat {
  const merged = emptyStat();
  for (const s of stats) {
    merged.count += s.count;
    merged.total += s.total;
    merged.entries.push(...s.entries);
  }
  return merged;
}

export function computeCashFlow(
  claims: Claim[],
  secondaryClaims: SecClaim[] = [],
  today: Date = new Date(),
): CashFlowStats {
  // Build per-HCPCS paid-per-unit averages once, up front. Used to
  // correct estPay for legacy-fallback lines (see expectedInflowAmount).
  const history = buildHistoricalAverages(claims);

  const buckets: Record<
    Exclude<CashFlowBucket, "settled" | "out">,
    BucketStat
  > = {
    soonEra: emptyStat(),
    soonMedicaid: emptyStat(),
    expectedPrimaryNonMedicaid: emptyStat(),
    expectedPrimaryMedicaid: emptyStat(),
    expectedSecondaryConfirm: emptyStat(),
    expectedSecondaryInsurance: emptyStat(),
    expectedSecondaryPatient: emptyStat(),
    futurePump: emptyStat(),
    highRiskDenials: emptyStat(),
    highRiskLate: emptyStat(),
  };

  // Pump-claim counters per tile. Primaries only — secondaries don't
  // contribute, because a secondary pump claim is just the patient-
  // responsibility leftover from the primary and would double-count.
  const soonPumps = emptyStat();
  const expectedPumps = emptyStat();
  const highRiskPumps = emptyStat();

  // Per-kind slices of Total Open. The Total Open tile's "Primary" and
  // "Secondary" sub-rows drill in via these.
  const primaryTotal = emptyStat();
  const secondaryTotal = emptyStat();

  for (const c of claims) {
    const bucket = classifyForCashFlow(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const { amount, corrected } = expectedInflowAmount(c, history);
    const entry = entryFromPrimary(c, amount, corrected);
    addToStat(buckets[bucket], entry);
    // futurePump claims aren't part of Total Open / Primary Total —
    // they're scheduled future inflow, not open A/R right now. Total
    // Open should still feel like "open A/R" so it stays comparable
    // to the rest of the dashboards.
    if (bucket !== "futurePump") {
      addToStat(primaryTotal, entry);
    }
    if (claimHasPump(c)) {
      if (bucket === "soonEra" || bucket === "soonMedicaid") {
        addToStat(soonPumps, entry);
      } else if (
        bucket === "expectedPrimaryNonMedicaid" ||
        bucket === "expectedPrimaryMedicaid"
      ) {
        addToStat(expectedPumps, entry);
      } else if (bucket === "highRiskDenials" || bucket === "highRiskLate") {
        addToStat(highRiskPumps, entry);
      }
      // futurePump entries are already a pump-only tile, so we don't
      // also aggregate them into expectedPumps — they have their own
      // dedicated tile.
    }
  }

  for (const c of secondaryClaims) {
    const bucket = classifyForCashFlowSecondary(c, today);
    if (bucket === "settled" || bucket === "out") continue;
    const amount = expectedInflowAmountSecondary(c);
    const entry = entryFromSecondary(c, amount);
    addToStat(buckets[bucket], entry);
    addToStat(secondaryTotal, entry);
    // Note: no pump aggregation for secondaries. See comment above.
  }

  // Parent tiles compose from their sub-buckets so the drill-down
  // drawer can show the same combined entry list shown on the tile.
  const soon = mergeStats(buckets.soonEra, buckets.soonMedicaid);
  const expected = mergeStats(
    buckets.expectedPrimaryNonMedicaid,
    buckets.expectedPrimaryMedicaid,
    buckets.expectedSecondaryConfirm,
    buckets.expectedSecondaryInsurance,
    buckets.expectedSecondaryPatient,
  );
  // High Risk = denials + late, surfaced as one tile total with two
  // drill-down rows. Both groups are operator-blocked: a denial needs
  // resolution; a late claim needs a status check or replacement.
  const highRisk = mergeStats(buckets.highRiskDenials, buckets.highRiskLate);
  // Total Open intentionally excludes futurePump — that money is
  // scheduled rental cycles, not currently outstanding A/R.
  const totalOpen = mergeStats(soon, expected, highRisk);
  const totalOpenPumps = mergeStats(soonPumps, expectedPumps, highRiskPumps);

  return {
    totalOpen,
    primaryTotal,
    secondaryTotal,
    soon,
    soonEra: buckets.soonEra,
    soonMedicaid: buckets.soonMedicaid,
    expected,
    expectedPrimaryNonMedicaid: buckets.expectedPrimaryNonMedicaid,
    expectedPrimaryMedicaid: buckets.expectedPrimaryMedicaid,
    expectedSecondaryConfirm: buckets.expectedSecondaryConfirm,
    expectedSecondaryInsurance: buckets.expectedSecondaryInsurance,
    expectedSecondaryPatient: buckets.expectedSecondaryPatient,
    futurePump: buckets.futurePump,
    highRisk,
    highRiskDenials: buckets.highRiskDenials,
    highRiskLate: buckets.highRiskLate,
    totalOpenPumps,
    soonPumps,
    expectedPumps,
    highRiskPumps,
  };
}
