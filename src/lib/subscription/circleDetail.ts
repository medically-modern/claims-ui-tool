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
export interface CircleFact { label: string; value: string; tone?: CircleFactTone }
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

export function describeCircle(kind: CheckpointKind, c: Checkpoint, p: P, today: string): CircleDetail {
  switch (kind) {
    case "confirmation": {
      const oop = parseMoney(p.oopEstimate ?? "");
      const gp = p.financials?.totalGP;
      const facts: CircleFact[] = [];
      if (p.patientResponseAt) facts.push({ label: "Answered", value: p.patientResponseAt });
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
        value: sp ? `${sp}${match === true ? " ✓ matches" : match === false ? ` ✗ board says ${p.primaryPayer}` : ""}` : "none returned",
        tone: match === true ? "ok" : match === false ? "bad" : "muted",
      });
      if (p.cobCheck && !/^ok$/i.test(p.cobCheck)) facts.push({ label: "COB", value: p.cobCheck, tone: "bad" });
      if (p.lastEligibilityError && c.tone !== "ok") facts.push({ label: "Stedi said", value: p.lastEligibilityError, tone: "bad" });
      return { headline: c.label, facts, verdict: ruleVerdict(c), action: defaultAction(kind, c) };
    }
    case "auth": {
      const facts: CircleFact[] = [];
      if (c.medicaidDvs) {
        const t = p.triggerDvs || "";
        facts.push({ label: "DVS for this order", value: c.dvsNeeded ? "not run yet" : t || "—", tone: c.dvsNeeded ? "muted" : undefined });
        if (p.claimsStatusCol) facts.push({ label: "Medicaid claim", value: p.claimsStatusCol });
        return { headline: c.dvsNeeded ? "Required — run DVS" : c.label, facts, verdict: ruleVerdict(c), action: defaultAction(kind, c) };
      }
      const sensors = p.subscriptionType !== "Supplies";
      const supplies = p.subscriptionType !== "Sensors";
      const span = (a?: string, b?: string) => { const s = usDate(a), e = usDate(b); return s || e ? ` · ${s || "?"} → ${e || "?"}` : ""; };
      if (sensors) facts.push({ label: "Sensors", value: `${p.sensorsAuthStatus || "not set"}${span(p.sensorsAuthStart, p.sensorsAuthEnd)}${p.sensorsAuthUnits ? ` · ${p.sensorsAuthUnits} units` : ""}` });
      if (supplies) facts.push({ label: "Supplies", value: `${p.suppliesAuthStatus || "not set"}${span(p.suppliesAuthStart, p.suppliesAuthEnd)}${p.suppliesAuthUnits ? ` · ${p.suppliesAuthUnits} units` : ""}` });
      return { headline: c.label, facts, verdict: ruleVerdict(c), action: defaultAction(kind, c) };
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
      const text = c.ruleId === "mr.expired-order-anyway" ? "medical records don't have to be valid to order for this patient — chase them, but ship" : undefined;
      return { headline: p.mrStatus || c.label, facts, verdict: ruleVerdict(c, text), action: defaultAction(kind, c) };
    }
  }
}
