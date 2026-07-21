/**
 * lanes.ts — Order Cycle v2 lane + block model.
 *
 * Spec: ORDER_CYCLE_V2_DESIGN.md (Subscription Board workspace folder).
 *
 * Three lanes replace the old due/paused binary:
 *   scheduled — order date in the future (or missing). Nothing to do.
 *   due       — order date arrived/past AND no block. Tonight's worklist.
 *   blocked   — a block reason is actively set (or Status = Paused).
 *
 * THE RULE: the separator between due and blocked is the presence of a
 * block reason, NOT date math. Brandon orders Mon/Tue/Wed nights,
 * irregularly — an order due last Thursday that he hasn't gotten to on
 * Monday is DUE ("not gotten to yet"), never auto-"paused". There is no
 * session-schedule config anywhere in this file on purpose.
 */

import type { SubscriptionPatient } from "@/components/subscription/mockData";

export type Lane = "scheduled" | "due" | "blocked";

/**
 * Two-level reason model (Brandon 2026-07-21): the DROPDOWN keeps
 * SPECIFIC reasons — the operator needs to read "No confirmation" or
 * "Hospital/SNF" on the row, not a vague bucket. The consolidation
 * lives in code: every specific reason maps to a FAMILY that drives
 * the resolution watcher and the SOP. Detail for humans, buckets for
 * automation.
 */
export type ReasonFamily = "insurance" | "auth" | "money" | "patient" | "other";

export const REASON_FAMILY: Record<string, ReasonFamily> = {
  // Insurance — resolves when eligibility comes back Active
  "Inactive Insurance":        "insurance",
  "Collect new insurance":     "insurance",   // legacy label, same family
  // Auth/clinical — resolves when auth is valid for served categories
  "Need new auth":             "auth",
  "Patient needs dr appt":     "auth",
  // Money — resolves via the claim mirror columns
  "Last claim denied":         "money",
  "Still owes last invoice":   "money",
  "Last Order Unpaid":         "money",       // generic (e.g. claim unresolved)
  // Waiting on patient — resolves via inbound contact or check-in date
  "No confirmation":           "patient",
  "Has enough supplies":       "patient",
  "Hospital/SNF":              "patient",
  "Hasn't received pump yet":  "patient",
  "OOP too expensive":         "patient",
  "Not using currently":       "patient",
  "Waiting on Patient":        "patient",     // legacy generic
  // Escape hatch — never auto-resolves, requires a note
  "Other":                     "other",
};

/** Reasons offered in the Block dialog, grouped by family for display. */
export const BLOCK_REASON_GROUPS: Array<{ family: ReasonFamily; label: string; reasons: string[] }> = [
  { family: "insurance", label: "Insurance", reasons: ["Inactive Insurance"] },
  { family: "auth",      label: "Auth / Clinical", reasons: ["Need new auth", "Patient needs dr appt"] },
  { family: "money",     label: "Last Order Money", reasons: ["Last claim denied", "Still owes last invoice", "Last Order Unpaid"] },
  { family: "patient",   label: "Waiting on Patient", reasons: [
    "No confirmation", "Has enough supplies", "Hospital/SNF",
    "Hasn't received pump yet", "OOP too expensive", "Not using currently",
  ] },
  { family: "other",     label: "Other", reasons: ["Other"] },
];

export const BLOCK_REASONS = BLOCK_REASON_GROUPS.flatMap((g) => g.reasons);
export type BlockReason = (typeof BLOCK_REASONS)[number];

export function reasonFamily(reason: string): ReasonFamily {
  return REASON_FAMILY[reason] ?? "other";
}

/** Patient-family blocks REQUIRE a check-in date (the timing cadence). */
export function checkInRequiredFor(reasons: string[]): boolean {
  return reasons.some((r) => reasonFamily(r) === "patient");
}

/** Default check-in horizon (days) suggested when blocking. */
export const DEFAULT_CHECK_IN_DAYS = 14;

/** Dead Reason labels (existing Monday dropdown) offered on churn. */
export const DEAD_REASONS = [
  "Stopped using",
  "Using other supplier",
  "Must go to pharmacy",
  "Out-of-network insurance",
  "Too expensive",
  "deceased",
] as const;

/** Misses of consecutive check-ins that force the renew-or-churn decision. */
export const FORCED_DECISION_MISSES = 2;

/**
 * Live fields the lane/watcher logic reads beyond the base mock shape.
 * All optional — mock data and older cached rows simply lack them.
 */
export interface BlockFields {
  checkInDate?: string;          // date_mm5fdn4h  (ISO yyyy-mm-dd)
  missedCheckIns?: number;       // numeric_mm5fcsvt
  blockResolution?: string;      // color_mm5f3v2n  Watching / Possibly Resolved
  blockNote?: string;            // long_text_mm5ffcqk
  blockedDate?: string;          // date_mm5f7des
  lastPatientContact?: string;   // text_mm5frhe9  "<ISO ts> <in|out> <sms|call|email>"
  primaryClaimPaid?: string;     // color_mm33spks
  secondaryClaimPaid?: string;   // color_mm3aa9bx
  active?: string;               // color_mm2nzm33
  oopEstimate?: string;          // text_mm404p7d
  dedRemaining?: string;         // text_mm3g32ja
  isNotActive?: boolean;         // group = Not Active
}

export type LanePatient = SubscriptionPatient & BlockFields;

// ─── Date helpers (no Date.now side effects in callers' render loops) ───────
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysIso(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

/** ISO date compare — "2026-07-21" <= "2026-07-22" lexically correct. */
function onOrBefore(iso: string, todayStr: string): boolean {
  return !!iso && iso <= todayStr;
}

// ─── Lane derivation ─────────────────────────────────────────────────────────
export function isBlocked(p: LanePatient): boolean {
  return p.patientStatus === "Paused" || !!(p.pauseReason && p.pauseReason.trim());
}

export function getLane(p: LanePatient, todayStr: string = todayIso()): Lane {
  if (isBlocked(p)) return "blocked";
  if (onOrBefore(p.nextOrderDate, todayStr)) return "due";
  return "scheduled";
}

/** Blocked with no reason recorded — data-hygiene triage state. */
export function needsReason(p: LanePatient): boolean {
  return p.patientStatus === "Paused" && !(p.pauseReason && p.pauseReason.trim());
}

/** Parse the multi-select pause reason cell ("A, B") into labels. */
export function blockReasons(p: LanePatient): string[] {
  return (p.pauseReason ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Resolution watchers (client-side; doc §3.2) ─────────────────────────────
/**
 * Last Order Unpaid resolution:
 *   Primary Claim Paid? = Fully Paid AND Secondary ∈ {Fully Paid, None, blank}.
 * Partial / Denied / Outstanding all HOLD the block.
 */
function lastOrderPaidResolved(p: LanePatient): boolean {
  const pri = (p.primaryClaimPaid ?? "").trim();
  const sec = (p.secondaryClaimPaid ?? "").trim();
  const priOk = /fully paid|patient paid/i.test(pri);
  const secOk = !sec || /^none$/i.test(sec) || /fully paid|patient paid/i.test(sec);
  return priOk && secOk;
}

/**
 * Waiting-on-Patient resolution: inbound patient contact SINCE the block
 * was set (RingCentral stamp, dual-trigger doc §3.1#5). Stamp format:
 * "<ISO ts> <in|out> <channel>". Only inbound counts.
 */
function patientContactSinceBlock(p: LanePatient): boolean {
  const stamp = (p.lastPatientContact ?? "").trim();
  if (!stamp) return false;
  const [ts, direction] = stamp.split(/\s+/);
  if (!ts || (direction && direction.toLowerCase() !== "in")) return false;
  const contactDate = ts.slice(0, 10);
  const blockedDate = (p.blockedDate ?? "").trim();
  if (!blockedDate) return true; // stamped contact, unknown block date — surface it
  return contactDate >= blockedDate;
}

/** Per-reason resolution predicate — dispatched by FAMILY, not label. */
export function reasonResolved(p: LanePatient, reason: string): boolean {
  switch (reasonFamily(reason)) {
    case "insurance":
      return (p.active ?? "").trim() === "Active";
    case "auth":
      return p.auth.tone === "ok";
    case "money":
      return lastOrderPaidResolved(p);
    case "patient":
      return patientContactSinceBlock(p);
    default:
      return false; // "Other" and unknowns never auto-resolve
  }
}

/**
 * True when EVERY recorded block reason's resolution signal has fired.
 * Multi-reason blocks require all of them to clear (a patient blocked for
 * "Waiting on Patient, Last Order Unpaid" isn't orderable until both do).
 */
export function possiblyResolved(p: LanePatient): boolean {
  if (!isBlocked(p)) return false;
  const reasons = blockReasons(p);
  if (reasons.length === 0) return false;
  return reasons.every((r) => reasonResolved(p, r));
}

/** Check-in date arrived (or passed) on a blocked patient. */
export function checkInDue(p: LanePatient, todayStr: string = todayIso()): boolean {
  if (!isBlocked(p)) return false;
  return onOrBefore(p.checkInDate ?? "", todayStr);
}

// ─── Readiness (Order Prep vs Ready to Order — the second axis) ──────────────
/**
 * Within Scheduled and Due, every patient is either ORDER PREP (something
 * still to clear) or READY TO ORDER (ships the moment the order date
 * arrives — which can be decided BEFORE the date). Blocked patients are
 * never ready by definition. Readiness is derived: all 4 checkpoints
 * green, or the backend cron already promoted Ordering Cycle.
 */
export function allChecksGreen(p: LanePatient): boolean {
  return p.confirmation.tone === "ok" && p.benefits.tone === "ok"
    && p.auth.tone === "ok" && p.lastPaid.tone === "ok";
}

export function isReady(p: LanePatient): boolean {
  if (isBlocked(p)) return false;
  return (p.orderingCycle || "") === "Ready to Order" || allChecksGreen(p);
}

// ─── Ship-without-confirmation candidate (doc §4) ────────────────────────────
export const SHIP_MAX_OOP = 100;   // OOP Estimate must be under this
export const SHIP_MIN_GP  = 100;   // Total GP must exceed this

function parseMoneyNum(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export interface ShipCandidate {
  ok: boolean;
  oop: number | null;
  gp: number | null;
}

/**
 * Suggestion ONLY — a human always makes the ship call (never auto-ship).
 * Candidate when: reorder text sent + no confirmation yet + the other 3
 * checkpoints green + no unreviewed changes + OOP < $100 + GP > $100.
 * Unknown OOP (no estimate AND no deductible-remaining) ≠ candidate:
 * "guaranteed profitable" requires a known cost.
 */
export function shipCandidate(p: LanePatient): ShipCandidate {
  const no = { ok: false, oop: null, gp: null } as ShipCandidate;
  // Awaiting = text sent, no response. "Not sent" isn't a candidate (we
  // haven't even asked); Confirmed doesn't need one.
  if (p.confirmation.tone === "ok") return no;
  if (p.confirmation.label !== "Awaiting") return no;
  // Changes reported but unreviewed → must be reviewed by a human first.
  if (p.confirmation.changes && p.confirmation.changes.length > 0) return no;
  // Other three checkpoints must be green.
  if (p.benefits.tone !== "ok" || p.auth.tone !== "ok" || p.lastPaid.tone !== "ok") return no;
  const oop = parseMoneyNum(p.oopEstimate) ?? parseMoneyNum(p.dedRemaining);
  const gp = p.financials?.totalGP ?? null;
  if (oop == null || gp == null) return { ok: false, oop, gp };
  const ok = oop < SHIP_MAX_OOP && gp > SHIP_MIN_GP;
  return { ok, oop, gp };
}
