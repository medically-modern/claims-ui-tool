/**
 * payerRules.ts — the rules that make a check read differently by payer.
 *
 * This file IS the spec. The Rules tab in the tool renders from these tables,
 * and the five derive functions in checks.ts consult nothing else, so the
 * documentation and the behaviour cannot drift apart (game plan, Phase 0/1).
 *
 * How a rule shows up on the board — the dark / light convention:
 *
 *   Every check is computed twice. First the BASELINE: what the Monday column
 *   says on its own, read the same way for every patient. Then the RULED
 *   verdict: the baseline with this payer's rules applied. If they agree the
 *   mark is DARK — the column decided and the payer was irrelevant. If they
 *   differ the mark is LIGHT — a rule changed the answer, and the hover says
 *   which one. So light never means "a rule was consulted"; it means the same
 *   board value would read differently under a different payer, which keeps
 *   light rare and worth looking at (Brandon, 2026-09-20).
 *
 * The sources are REORDER_PROCESS.md (the runbook) and Brandon's decisions,
 * dated inline. Anything marked "proposed" was inferred by us and is waiting
 * on confirmation — see the checklist at the bottom of the Payer rules tab.
 */
import type { CheckpointKind } from "@/components/subscription/mockData";
import { isMedicaid } from "./dvs";

// ─── Payer groups ───────────────────────────────────────────────────────────

export type PayerGroupId = "medicaid" | "medicare" | "fidelis" | "commercial";

export interface PayerGroup {
  id: PayerGroupId;
  name: string;
  /** Primary Insurance labels (color_mm254qxj) in this group. The commercial
   *  group is the catch-all: every label not claimed by another group. */
  payers: readonly string[];
  eligibility: {
    /** The eligibility check must be no older than this many days before the
     *  date of service, or null when the payer has no freshness rule. */
    freshnessDays: number | null;
    /** …and fall in the same calendar month as the date of service. */
    sameMonth: boolean;
    /** COB Check (color_mm6vpy5a) "Other Primary Reported" blocks. */
    cobCheck: boolean;
    /** Suggested Primary (dropdown_mm5yx3sm) must match Primary Insurance. */
    primaryMatch: boolean;
    /** A hospice election is billable (GW modifier) rather than a stop. */
    hospiceOk: boolean;
  };
  /** How the Authorization circle is decided.
   *    dvs               — per-order DVS → paid claim ladder (Medicaid)
   *    never             — auth is never required; the column can't block
   *    column            — Supplies/Sensors Auth Status speaks for itself
   *    column-plan-change — column, plus a re-check when the plan changed */
  auth: "dvs" | "never" | "column" | "column-plan-change";
  claims: {
    /** Primary Fully Paid + Secondary Outstanding does not hold the reorder. */
    secondaryOpenOk: boolean;
  };
  /** Where the group's rules come from, for the Rules tab. */
  source: string;
}

export const PAYER_GROUPS: readonly PayerGroup[] = [
  {
    id: "medicaid",
    name: "Medicaid",
    payers: ["Medicaid"],
    eligibility: { freshnessDays: null, sameMonth: false, cobCheck: false, primaryMatch: false, hospiceOk: false },
    auth: "dvs",
    claims: { secondaryOpenOk: false },
    source: "Runbook step 4 — DVS per order, the paid claim is the gate. Verified live 2026-09-19.",
  },
  {
    id: "medicare",
    name: "Medicare A&B",
    payers: ["Medicare A&B"],
    eligibility: { freshnessDays: 7, sameMonth: true, cobCheck: true, primaryMatch: true, hospiceOk: true },
    auth: "never",
    claims: { secondaryOpenOk: true },
    source: "Runbook step 5 — 7 days and same month (decided 2026-09-14); auth never required; secondary may be open, Medicare only.",
  },
  {
    id: "fidelis",
    name: "Fidelis Low-Cost",
    payers: ["Fidelis Low-Cost"],
    eligibility: { freshnessDays: null, sameMonth: false, cobCheck: true, primaryMatch: true, hospiceOk: false },
    auth: "column-plan-change",
    claims: { secondaryOpenOk: false },
    source: "Runbook step 6 — Child Health Plus plans need a sensor auth; re-check when the plan changes.",
  },
  {
    id: "commercial",
    name: "Everyone else",
    payers: [],
    eligibility: { freshnessDays: null, sameMonth: false, cobCheck: true, primaryMatch: true, hospiceOk: false },
    auth: "column",
    claims: { secondaryOpenOk: false },
    source: "Runbook steps 7–8 — commercial, Medicare Advantage and the long tail. Confirm is decided per patient (below), not per payer.",
  },
] as const;

const COMMERCIAL = PAYER_GROUPS.find((g) => g.id === "commercial")!;

/** The group a Primary Insurance label belongs to. Blank or unknown → Everyone
 *  else. Managed Medicaid plans ("United Medicaid") are Medicaid: they need the
 *  DVS too — same test the Run DVS button uses. */
export function payerGroupFor(primaryInsurance: string | null | undefined): PayerGroup {
  const label = String(primaryInsurance ?? "").trim();
  if (isMedicaid(label)) return PAYER_GROUPS[0];
  return PAYER_GROUPS.find((g) => g.payers.includes(label)) ?? COMMERCIAL;
}

// ─── Rules — every decision that can make a mark light ──────────────────────

export type RuleId =
  | "first-order"
  | "confirm.no-reply-ok"
  | "confirm.oop-over-threshold"
  | "confirm.fill-loses-money"
  | "confirm.oop-unknown"
  | "confirm.gp-unknown"
  | "elig.hospice-medicare"
  | "elig.hospice-other"
  | "elig.medicare-freshness"
  | "elig.cob-other-primary"
  | "elig.primary-mismatch"
  | "auth.medicare-never"
  | "auth.fidelis-plan-change"
  | "claims.medicare-secondary-open"
  | "mr.expired-order-anyway"
  | "mr.expired-hard-stop"
  | "mr.blank";

export interface RuleDef {
  id: RuleId;
  /** Which circle it decides. "all" = the first-order bypass. */
  check: CheckpointKind | "all";
  /** Who it applies to, in words, for the Rules tab. */
  applies: string;
  /** The condition, in words. */
  when: string;
  /** What it does to the mark: pass = light green, block = light red. */
  verdict: "pass" | "block";
  /** Also raises a badge on the row (the unknown-money flags). */
  flag?: PatientFlagId;
  source: string;
}

export type PatientFlagId = "oop-unknown" | "gp-unknown";

export interface PatientFlag {
  id: PatientFlagId;
  label: string;
  detail: string;
}

/** Confirm: OOP Estimate above this needs the patient's yes. */
export const CONFIRM_OOP_THRESHOLD = 5;
/** OOP Estimate must be populated this close to an order (Brandon, 2026-09-20). */
export const OOP_WINDOW_DAYS = 20;

export const RULES: readonly RuleDef[] = [
  {
    id: "first-order",
    check: "all",
    applies: "First orders (Order Type = First Order)",
    when: "always",
    verdict: "pass",
    source: "Brandon, 2026-09-20 — a first order has no history to check against; nothing can hold it, it goes straight to Ready to Order.",
  },
  {
    id: "confirm.no-reply-ok",
    check: "confirmation",
    applies: "Any payer",
    when: `Patient Order Response is No Response or blank, OOP Estimate ≤ $${CONFIRM_OOP_THRESHOLD} and Total GP ≥ $0`,
    verdict: "pass",
    source: "Runbook steps 4–6 — no reply is acceptable when the patient owes nothing and the fill is profitable. Final rule 2026-09-20.",
  },
  {
    id: "confirm.oop-over-threshold",
    check: "confirmation",
    applies: "Any payer",
    when: `Patient Order Response is No Response or blank and OOP Estimate > $${CONFIRM_OOP_THRESHOLD}`,
    verdict: "block",
    source: "Runbook step 7 — affirmative confirmation when the patient will owe money. Threshold $5, Brandon 2026-09-20.",
  },
  {
    id: "confirm.fill-loses-money",
    check: "confirmation",
    applies: "Any payer",
    when: "Patient Order Response is No Response or blank and the board's Total GP for the fill is negative",
    verdict: "block",
    source: "Money-losing derivation 2026-09-20 — margin is the whole shipment, read off Total GP (numeric_mm2xvjc1).",
  },
  {
    id: "confirm.oop-unknown",
    check: "confirmation",
    applies: "Reorders",
    when: "Patient Order Response is No Response or blank and OOP Estimate is blank or not a number",
    verdict: "block",
    flag: "oop-unknown",
    source: `Brandon, 2026-09-20 — unknown is never $0. The badge only shows inside ${OOP_WINDOW_DAYS} days of the order, where the estimate should exist.`,
  },
  {
    id: "confirm.gp-unknown",
    check: "confirmation",
    applies: "Reorders",
    when: "Patient Order Response is No Response or blank and Total GP is blank",
    verdict: "block",
    flag: "gp-unknown",
    source: "Brandon, 2026-09-20 — a blank margin can't pass; fix the financials on the board.",
  },
  {
    id: "elig.hospice-medicare",
    check: "benefits",
    applies: "Medicare A&B",
    when: "SNF/Hospice/Hospital/Deceased contains Hospice",
    verdict: "pass",
    source: "Runbook step 5 — hospice is billable on Medicare A&B with the GW modifier.",
  },
  {
    id: "elig.hospice-other",
    check: "benefits",
    applies: "Every payer except Medicare A&B",
    when: "SNF/Hospice/Hospital/Deceased contains Hospice",
    verdict: "block",
    source: "Proposed — the billing path has to be verified before shipping. Was a warning; now a stop.",
  },
  {
    id: "elig.medicare-freshness",
    check: "benefits",
    applies: "Medicare A&B",
    when: "Active? is Active but Last Eligibility Check is more than 7 days before the date of service, or in a different calendar month",
    verdict: "block",
    source: "Runbook step 5, decided 2026-09-14 — an Aug 31 check does not cover a Sep 1 order.",
  },
  {
    id: "elig.cob-other-primary",
    check: "benefits",
    applies: "Every payer except Medicaid",
    when: "Active? is Active but COB Check reads Other Primary Reported",
    verdict: "block",
    source: "Runbook step 8 — another payer is primary; the claim would deny.",
  },
  {
    id: "elig.primary-mismatch",
    check: "benefits",
    applies: "Every payer except Medicaid",
    when: "Active? is Active but Suggested Primary names a different payer than Primary Insurance (Unknown / Failed don't count)",
    verdict: "block",
    source: "Runbook steps 5 and 8 — on Medicare the suggestion must read Medicare A&B; on Anthem a mismatch routes to manual review.",
  },
  {
    id: "auth.medicare-never",
    check: "auth",
    applies: "Medicare A&B",
    when: "Supplies / Sensors Auth Status is anything other than a pass",
    verdict: "pass",
    source: "Runbook step 5 — an authorization is never required on Medicare A&B.",
  },
  {
    id: "auth.fidelis-plan-change",
    check: "auth",
    applies: "Fidelis Low-Cost, sensors served",
    when: "Insurance Change? is Yes",
    verdict: "block",
    source: "Runbook step 6 — the plan changed since the last order; the sensor auth has to be re-evaluated under the new plan (Child Health Plus needs one).",
  },
  {
    id: "claims.medicare-secondary-open",
    check: "lastPaid",
    applies: "Medicare A&B",
    when: "Primary Claim Paid? is Fully Paid and Secondary Claim Paid? is Outstanding",
    verdict: "pass",
    source: "Runbook step 5 — primary must be paid; the secondary may still be open. Medicare only.",
  },
  {
    id: "mr.expired-order-anyway",
    check: "mr",
    applies: "Every referral source except District Endochrine",
    when: "MN Expiry is in the past",
    verdict: "pass",
    source: "Runbook, MR section (2026-09-14) — order anyway and chase the records.",
  },
  {
    id: "mr.expired-hard-stop",
    check: "mr",
    applies: "District Endochrine referrals",
    when: "MN Expiry is in the past",
    verdict: "block",
    source: "Runbook, MR section (2026-09-14) — records first, no order.",
  },
  {
    id: "mr.blank",
    check: "mr",
    applies: "Any referral source",
    when: "MN Expiry is blank",
    verdict: "block",
    source: "Brandon, 2026-09-20 — unknown can't count as valid; a blank forces someone to fill it in.",
  },
] as const;

const RULE_BY_ID: ReadonlyMap<RuleId, RuleDef> = new Map(RULES.map((r) => [r.id, r]));

export function ruleById(id: RuleId): RuleDef {
  return RULE_BY_ID.get(id)!;
}

// ─── Small shared helpers ───────────────────────────────────────────────────

/** "First Order" on Order Type (color_mm2w6kd). Order Count is blank on every
 *  row today, so the label is the only signal. */
export function isFirstOrder(orderType: string | null | undefined): boolean {
  return /first/i.test(String(orderType ?? ""));
}

/**
 * A money cell as a number. "$1,234.50" → 1234.5. Anything without a digit —
 * blank, "Incomplete benefits data", "No rates available for …" — is null:
 * unknown, never zero.
 */
export function parseMoney(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "−" : ""}$${body}`;
}

function parseIsoDay(s: string | null | undefined): Date | null {
  const v = String(s ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysBetweenIso(fromIso: string, toIso: string): number | null {
  const a = parseIsoDay(fromIso);
  const b = parseIsoDay(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ─── Confirm policy — per patient, not per payer ────────────────────────────

export interface ConfirmPolicyInput {
  oopEstimate: string;
  /** Total GP (numeric_mm2xvjc1) as the board holds it — raw text, so blank
   *  is distinguishable from zero. */
  totalGp: string;
  orderDate: string;
  today: string;
  firstOrder: boolean;
}

export interface ConfirmPolicy {
  /** No reply is NOT enough — the patient has to say yes. */
  affirmativeOnly: boolean;
  /** The rule that decided, for the hover and the Rules tab. */
  ruleId: RuleId;
  /** The reason in words, with the numbers. */
  why: string;
  oop: number | null;
  gp: number | null;
  /** Row badges: a money figure that should exist and doesn't. */
  flags: PatientFlag[];
}

/**
 * Confirm is the one check decided per patient rather than per payer group:
 * affirmative confirmation is required when the patient's OOP Estimate is
 * over $5, or when the board's Total GP for the fill is negative. Blank or
 * unreadable in either is UNKNOWN, which can't pass. (Final rule, Brandon
 * 2026-09-20; first orders are exempt from all of it.)
 */
export function confirmPolicy(i: ConfirmPolicyInput): ConfirmPolicy {
  const oop = parseMoney(i.oopEstimate);
  const gp = parseMoney(i.totalGp);
  const flags: PatientFlag[] = [];

  if (i.firstOrder) {
    return {
      affirmativeOnly: false, ruleId: "first-order", oop, gp, flags,
      why: "First order — no prior claim to price against; nothing holds a first order.",
    };
  }

  const daysToOrder = daysBetweenIso(i.today, i.orderDate);
  const inWindow = daysToOrder != null && daysToOrder <= OOP_WINDOW_DAYS;

  // Badges are about data quality and stand on their own: a blank figure that
  // should exist is worth a badge whatever the verdict ends up being.
  if (oop == null && inWindow) {
    flags.push({
      id: "oop-unknown",
      label: "OOP unknown",
      detail: i.oopEstimate
        ? `OOP Estimate reads "${i.oopEstimate}" — not a number, ${OOP_WINDOW_DAYS} days or less from the order. Fix the estimate for this patient.`
        : `OOP Estimate is blank ${OOP_WINDOW_DAYS} days or less from the order. It should never be — fix the estimate for this patient.`,
    });
  }
  if (gp == null) {
    flags.push({
      id: "gp-unknown",
      label: "GP unknown",
      detail: "Total GP is blank on the board — run Calculate Financials for this patient.",
    });
  }

  // The verdict, strongest known fact first.
  if (oop == null) {
    return {
      affirmativeOnly: true, ruleId: "confirm.oop-unknown", oop, gp, flags,
      why: i.oopEstimate
        ? `OOP Estimate reads "${i.oopEstimate}" — unknown cost, so no reply is not enough`
        : inWindow
          ? "OOP Estimate is blank this close to the order — unknown cost, so no reply is not enough"
          : `OOP Estimate not computed yet (it arrives about ${OOP_WINDOW_DAYS} days out) — unknown cost until then`,
    };
  }
  if (oop > CONFIRM_OOP_THRESHOLD) {
    return {
      affirmativeOnly: true, ruleId: "confirm.oop-over-threshold", oop, gp, flags,
      why: `OOP Estimate ${fmtUsd(oop)} is over $${CONFIRM_OOP_THRESHOLD} — the patient has to say yes`,
    };
  }
  if (gp == null) {
    return {
      affirmativeOnly: true, ruleId: "confirm.gp-unknown", oop, gp, flags,
      why: "Total GP is blank — margin unknown, so no reply is not enough",
    };
  }
  if (gp < 0) {
    return {
      affirmativeOnly: true, ruleId: "confirm.fill-loses-money", oop, gp, flags,
      why: `This fill loses money (Total GP ${fmtUsd(gp)}) — the patient has to say yes`,
    };
  }
  return {
    affirmativeOnly: false, ruleId: "confirm.no-reply-ok", oop, gp, flags,
    why: `No reply is acceptable — OOP Estimate ${fmtUsd(oop)} and the fill clears ${fmtUsd(gp)}`,
  };
}

// ─── Eligibility freshness (Medicare) ───────────────────────────────────────

/**
 * Is the eligibility check fresh enough for this date of service? The date of
 * service is the order date, or today when the order date has already passed
 * (a late order ships today). Fresh = checked no more than `days` before the
 * DOS, and in the same calendar month as the DOS when the group says so.
 */
export function eligibilityIsFresh(opts: {
  lastCheck: string; orderDate: string; today: string; days: number; sameMonth: boolean;
}): { fresh: boolean; dos: string; ageDays: number | null } {
  const dos = opts.orderDate && opts.orderDate.slice(0, 10) > opts.today ? opts.orderDate.slice(0, 10) : opts.today;
  const ageDays = daysBetweenIso(opts.lastCheck, dos); // positive = check before DOS
  if (ageDays == null) return { fresh: false, dos, ageDays: null };
  if (ageDays > opts.days) return { fresh: false, dos, ageDays };
  if (opts.sameMonth && opts.lastCheck.slice(0, 7) !== dos.slice(0, 7)) return { fresh: false, dos, ageDays };
  return { fresh: true, dos, ageDays };
}
