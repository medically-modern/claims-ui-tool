/**
 * circleDetail.ts — what the popover says when an operator clicks a circle.
 *
 * Brandon, 2026-09-20, walking through Tara Pratt's five circles:
 *   Confirm      "No Reply — Advanced by rules: OOP Estimate $0 and GP $x."
 *                Only a Pause button, since the default is already advanced;
 *                if the default were held, only an Advance button.
 *   Eligibility  "Active", plus the last-checked date and Suggested Primary
 *                with a ✓ when it matches the primary payer, ✗ when not.
 *   Auth         DVS payer: "Required — Run DVS". Otherwise the Sensors /
 *                Supplies status with the approved dates, high level.
 *   Last paid    Primary AND secondary claim states.
 *   MR           Status, expiry date, and the rule that says ordering is fine.
 *
 * Pure: it turns a patient + checkpoint into lines. The component renders
 * them and owns the buttons. The verdict line always names who decided —
 * the board (dark) or a rule (light) — so the hover and the popover agree.
 */
import type { Checkpoint, CheckpointKind, SubscriptionPatient } from "@/components/subscription/mockData";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { parseMoney, fmtUsd } from "./payerRules";

export type CircleFactTone = "ok" | "bad" | "muted";
export interface CircleFact {
  label: string;
  value: string;
  tone?: CircleFactTone;
  /** A green circle-check or red circle-x drawn before the value. */
  mark?: "ok" | "bad";
}
export type CircleAction = "pause" | "advance" | "run-eligibility" | "run-dvs" | "none";

export interface CircleDetail {
  /** The bold line. */
  headline: string;
  facts: CircleFact[];
  /** "Advanced by rules — …" / "Held by rules — …" / "Overridden — …"; absent when the board decided alone. */
  verdict?: { kind: "advanced" | "held" | "overridden" | "waiting"; text: string };
  action: CircleAction;
}

type P = SubscriptionPatient & Partial<LiveSubscriptionPatient>;

function usDate(iso: string | null | undefined): string {
  const s = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysAgo(iso: string, today: string): number | null {
  const a = new Date(String(iso).slice(0, 10) + "T00:00:00").getTime();
  const b = new Date(today + "T00:00:00").getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

/**
 * Is a "[8/2/26, 2:23 PM ET] …" / "Aug 2, 2026, 2:23 PM ET" stamp on or after
 * the last order day? Everything on this board is scoped "since the last
 * order" (Brandon, 2026-09-20). No last-order day, or an unparseable stamp →
 * it counts.
 */
export function sinceLastOrder(stamp: string | null | undefined, lastOrderDay: string | null | undefined): boolean {
  const day = String(lastOrderDay ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
  const raw = String(stamp ?? "");
  const m = /\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(raw);
  let t: number;
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    t = new Date(y, Number(m[1]) - 1, Number(m[2])).getTime();
  } else {
    t = new Date(raw.replace(/\s+(ET|EST|EDT)\b/i, "")).getTime();
  }
  if (!Number.isFinite(t)) return true;
  return t >= new Date(day + "T00:00:00").getTime();
}

/** Per-code Medicaid claim results ("A4232 Claim" / "A4230 Claim"). */
export interface CodeResult { code: "A4230" | "A4232"; item: string; paid: number | null; denied: string | null; full: boolean | null; expected: number | null }

/**
 * NY Medicaid allowed amount per box the DVS claim bills (measured 2026-09-20
 * across every paid row: A4230 $456.00 for 3, A4232 $108.30 for 3).
 * A4230 = infusion sets, A4232 = cartridges/reservoirs.
 */
export const MEDICAID_BOX_RATE: Record<"A4230" | "A4232", number> = { A4230: 152.0, A4232: 36.1 };

export function parseCodeResult(code: "A4230" | "A4232", cell: string | null | undefined, qty: string | number | null | undefined): CodeResult | null {
  const raw = String(cell ?? "").trim();
  if (!raw) return null;
  const item = code === "A4230" ? "Infusion sets" : "Cartridges";
  const n = Number(qty);
  const expected = Number.isFinite(n) && n > 0 ? Math.round(MEDICAID_BOX_RATE[code] * n * 100) / 100 : null;
  const paidM = /paid:?\s*\$?\s*([\d,]+(?:\.\d+)?)/i.exec(raw);
  if (paidM) {
    const paid = Number(paidM[1].replace(/,/g, ""));
    return { code, item, paid, denied: null, expected, full: expected == null ? null : paid + 0.005 >= expected };
  }
  const denM = /denied:?\s*(.*)$/i.exec(raw);
  return { code, item, paid: null, denied: denM ? denM[1].trim() : raw, expected, full: false };
}

function normPayer(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Suggested Primary matches the board's Primary Insurance? Loose: "Medicaid" ⊂ "United Medicaid". */
export function suggestedMatches(suggested: string | null | undefined, primary: string | null | undefined): boolean | null {
  const a = normPayer(suggested), b = normPayer(primary);
  if (!a || /^(unknown|failed|na|none)$/.test(a)) return null;
  if (!b) return null;
  return a === b || a.includes(b) || b.includes(a);
}

/** The default action for a circle: green → Pause; otherwise the one thing that moves it. */
function defaultAction(kind: CheckpointKind, c: Checkpoint): CircleAction {
  if (c.tone === "ok") return "pause";
  if (kind === "confirmation") return "advance";
  if (kind === "benefits") return c.tone === "pending" ? "none" : "run-eligibility";
  if (kind === "auth") return c.dvsNeeded ? "run-dvs" : "none";
  return "none";
}

function ruleVerdict(c: Checkpoint, text?: string): CircleDetail["verdict"] | undefined {
  if (c.ruleId === "confirm.override") return { kind: "overridden", text: text ?? c.why ?? "" };
  if (!c.light || !c.why) return undefined;
  if (c.tone === "ok") return { kind: "advanced", text: text ?? c.why };
  if (c.tone === "pending") return { kind: "waiting", text: text ?? c.why };
  return { kind: "held", text: text ?? c.why };
}

export function describeCircle(kind: CheckpointKind, c: Checkpoint, p: P, today: string, lastOrderDay?: string | null): CircleDetail {
  switch (kind) {
    case "confirmation": {
      const oop = parseMoney(p.oopEstimate ?? "");
      const gp = p.financials?.totalGP;
      const facts: CircleFact[] = [];
      // Patient Response Timestamp is not cleared between orders, so a reply
      // only counts here when it came in since the last order.
      if (p.patientResponseAt && sinceLastOrder(p.patientResponseAt, lastOrderDay)) {
        facts.push({ label: "Answered", value: p.patientResponseAt });
      }
      facts.push({ label: "OOP Estimate", value: oop == null ? "not populated yet" : fmtUsd(oop), tone: oop == null ? "muted" : undefined });
      facts.push({ label: "GP on this fill", value: typeof gp === "number" && Number.isFinite(gp) ? fmtUsd(gp) : "not calculated", tone: typeof gp === "number" && gp < 0 ? "bad" : undefined });
      // The no-reply rule reads best as the two numbers it looked at.
      const text = c.ruleId === "confirm.no-reply-ok" && oop != null && typeof gp === "number"
        ? `OOP Estimate is ${fmtUsd(oop)} and GP is ${fmtUsd(gp)}, so no reply is needed`
        : undefined;
      return { headline: c.label, facts, verdict: ruleVerdict(c, text), action: defaultAction(kind, c) };
    }
    case "benefits": {
      const facts: CircleFact[] = [];
      const last = p.lastEligibilityCheck ?? "";
      if (last) {
        const n = daysAgo(last, today);
        facts.push({ label: "Last checked", value: `${usDate(last)}${n != null ? ` · ${n === 0 ? "today" : `${n}d ago`}` : ""}` });
      } else {
        facts.push({ label: "Last checked", value: "never", tone: "muted" });
      }
      const sp = p.suggestedPrimary ?? "";
      const match = suggestedMatches(sp, p.primaryPayer);
      facts.push({
        label: "Suggested Primary",
        value: sp ? `${sp}${match === false ? " · mismatch" : ""}` : "none returned",
        tone: match === false ? "bad" : sp ? undefined : "muted",
        mark: match === true ? "ok" : match === false ? "bad" : undefined,
      });
      if (p.cobCheck && !/^ok$/i.test(p.cobCheck)) facts.push({ label: "COB", value: p.cobCheck, tone: "bad" });
      if (p.lastEligibilityError && c.tone !== "ok") facts.push({ label: "Stedi said", value: p.lastEligibilityError, tone: "bad" });
      return { headline: c.label, facts, verdict: ruleVerdict(c), action: defaultAction(kind, c) };
    }
    case "auth": {
      const facts: CircleFact[] = [];
      if (c.medicaidDvs) {
        const t = p.triggerDvs || "";
        if (c.dvsNeeded) {
          // The headline says it all; no fact line (Brandon, 2026-09-20).
        } else if (c.tone === "ok") {
          // Cleared: what each code paid, with a check when it's the full amount.
          for (const r of [parseCodeResult("A4230", p.a4230Claim, p.infusionSet1Qty), parseCodeResult("A4232", p.a4232Claim, p.cartridgeQty)]) {
            if (!r) continue;
            facts.push({
              label: r.item,
              value: r.paid != null
                ? `${fmtUsd(r.paid)}${r.expected != null ? (r.full ? " · full" : ` · expected ${fmtUsd(r.expected)}`) : ""}`
                : `Denied — ${r.denied}`,
              mark: r.full === true ? "ok" : r.full === false ? "bad" : undefined,
              tone: r.full === false ? "bad" : undefined,
            });
          }
          if (p.claimsPaidDate) facts.push({ label: "Paid", value: usDate(p.claimsPaidDate) });
        } else {
          facts.push({ label: "DVS", value: t || "—" });
          if (p.claimsStatusCol) facts.push({ label: "Medicaid claim", value: p.claimsStatusCol });
          for (const r of [parseCodeResult("A4230", p.a4230Claim, p.infusionSet1Qty), parseCodeResult("A4232", p.a4232Claim, p.cartridgeQty)]) {
            if (r?.denied) facts.push({ label: r.item, value: `Denied — ${r.denied}`, tone: "bad", mark: "bad" });
          }
        }
        return { headline: c.dvsNeeded ? "Required — run DVS" : c.label, facts, verdict: ruleVerdict(c), action: defaultAction(kind, c) };
      }
      // Non-DVS: one mention per served category, never repeated between the
      // headline and the lines (Brandon, 2026-09-20). Same status across the
      // board → "Sensors & Supplies — no auth needed"; otherwise the headline
      // names each status and the lines carry only dates and units.
      const entries = ([
        ["Sensors", p.subscriptionType !== "Supplies", p.sensorsAuthStatus, p.sensorsAuthStart, p.sensorsAuthEnd, p.sensorsAuthUnits],
        ["Supplies", p.subscriptionType !== "Sensors", p.suppliesAuthStatus, p.suppliesAuthStart, p.suppliesAuthEnd, p.suppliesAuthUnits],
      ] as const).filter(([, served]) => served).map(([name, , st, a, b, u]) => {
        const start = usDate(a), end = usDate(b);
        const extra = [start || end ? `${start || "?"} → ${end || "?"}` : "", u && Number(u) > 0 ? `${u} units` : ""].filter(Boolean).join(" · ");
        return { name, status: (st || "").trim() || "not set", extra };
      });
      const uniform = entries.length > 0 && entries.every((e) => e.status === entries[0].status);
      const headline = uniform
        ? `${entries.map((e) => e.name).join(" & ")} — ${entries[0].status.toLowerCase()}`
        : entries.map((e) => `${e.name}: ${e.status}`).join(" · ") || c.label;
      for (const e of entries) if (e.extra) facts.push({ label: e.name, value: e.extra });
      return { headline, facts, verdict: ruleVerdict(c), action: defaultAction(kind, c) };
    }
    case "lastPaid": {
      const facts: CircleFact[] = [
        { label: "Primary claim", value: p.primaryClaimPaid || "not recorded", tone: p.primaryClaimPaid ? undefined : "muted" },
        { label: "Secondary claim", value: p.secondaryClaimPaid || "None", tone: p.secondaryClaimPaid ? undefined : "muted" },
      ];
      if (p.claimsPaidDate) facts.push({ label: "Paid", value: `${usDate(p.claimsPaidDate)}${p.claimsPaidAmount ? ` · ${p.claimsPaidAmount}` : ""}` });
      return { headline: c.label, facts, verdict: ruleVerdict(c), action: defaultAction(kind, c) };
    }
    case "mr": {
      const exp = p.mnExpiry ?? "";
      const n = exp ? daysAgo(exp, today) : null;
      const facts: CircleFact[] = [
        { label: "MN expiry", value: exp ? `${usDate(exp)}${n != null ? (n > 0 ? ` · expired ${n}d ago` : n === 0 ? " · expires today" : ` · ${-n}d left`) : ""}` : "not set", tone: exp ? (n != null && n > 0 ? "bad" : "ok") : "muted" },
      ];
      if (p.referralSource) facts.push({ label: "Referral source", value: p.referralSource });
      const text = c.ruleId === "mr.expired-order-anyway" ? "medical records don't have to be valid to order for this patient" : undefined;
      return { headline: p.mrStatus || c.label, facts, verdict: ruleVerdict(c, text), action: defaultAction(kind, c) };
    }
  }
}
