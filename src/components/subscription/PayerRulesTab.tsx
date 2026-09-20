/**
 * PayerRulesTab — the rules, rendered from the same table the circles use.
 *
 * Nothing here is typed by hand: every row comes from lib/subscription/
 * payerRules.ts, so what this tab says and what the board does cannot drift
 * apart. The counts are tonight's: how many loaded patients each rule is
 * deciding right now (a light mark carrying that rule's id), and how many
 * patients each payer group holds. A rule that fires on the same twenty
 * patients every week and gets overridden every time is a rule that is wrong
 * — this is where that shows (game plan, Phase 1).
 */
import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { mrOf, type Checkpoint, type CheckpointKind, type SubscriptionPatient } from "./mockData";
import {
  CONFIRM_OOP_THRESHOLD, OOP_WINDOW_DAYS, PAYER_GROUPS, RULES,
  payerGroupFor, type PayerGroup, type RuleDef, type RuleId,
} from "@/lib/subscription/payerRules";

const CHECK_NAME: Record<CheckpointKind | "all", string> = {
  confirmation: "Confirm",
  benefits: "Eligibility",
  auth: "Authorization",
  lastPaid: "Last Claim Paid",
  mr: "Medical Records",
  all: "All five",
};

function checksOf(p: SubscriptionPatient): Checkpoint[] {
  return [p.confirmation, p.benefits, p.auth, p.lastPaid, mrOf(p)];
}

function Mark({ verdict }: { verdict: RuleDef["verdict"] }) {
  return verdict === "pass" ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-emerald-700">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-50 ring-2 ring-emerald-600">
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      light green
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-rose-700">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-50 ring-2 ring-rose-600">
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      light red
    </span>
  );
}

function yesNo(v: boolean, yes = "yes", no = "no") {
  return <span className={cn(v ? "text-foreground" : "text-muted-foreground")}>{v ? yes : no}</span>;
}

function authWord(a: PayerGroup["auth"]): string {
  switch (a) {
    case "dvs": return "DVS per order → paid claim";
    case "never": return "never required";
    case "column-plan-change": return "the column, re-check on plan change";
    default: return "the column";
  }
}

export function PayerRulesTab({ patients }: { patients: SubscriptionPatient[] }) {
  // Only the live cohort counts: Not Active rows are not being decided tonight.
  const cohort = useMemo(
    () => patients.filter((p) => p.patientStatus !== "Dead"),
    [patients],
  );

  const stats = useMemo(() => {
    const byRule = new Map<RuleId, number>();
    const byGroup = new Map<string, number>();
    const payersInGroup = new Map<string, Map<string, number>>();
    let firstOrders = 0;
    let lightRows = 0;
    const flags = new Map<string, number>();
    for (const p of cohort) {
      const g = payerGroupFor(p.primaryPayer);
      byGroup.set(g.id, (byGroup.get(g.id) ?? 0) + 1);
      const pm = payersInGroup.get(g.id) ?? new Map<string, number>();
      pm.set(p.primaryPayer || "(blank)", (pm.get(p.primaryPayer || "(blank)") ?? 0) + 1);
      payersInGroup.set(g.id, pm);
      if (p.firstOrder) firstOrders += 1;
      const seen = new Set<RuleId>();
      let anyLight = false;
      for (const c of checksOf(p)) {
        if (c.light && c.ruleId) { anyLight = true; seen.add(c.ruleId); }
      }
      if (anyLight) lightRows += 1;
      for (const id of seen) byRule.set(id, (byRule.get(id) ?? 0) + 1);
      for (const f of p.flags ?? []) flags.set(f.id, (flags.get(f.id) ?? 0) + 1);
    }
    return { byRule, byGroup, payersInGroup, firstOrders, lightRows, flags };
  }, [cohort]);

  const n = cohort.length;
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : "—");

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-3">
        <div className="text-[15px] font-semibold">How to read the circles</div>
        <p className="text-[13px] text-muted-foreground leading-relaxed max-w-4xl">
          Every check is computed twice. First the <span className="font-semibold text-foreground">baseline</span>:
          what the Monday column says on its own, read the same way for every patient. Then the{" "}
          <span className="font-semibold text-foreground">ruled</span> verdict: the baseline with the payer's rules applied.
          If they agree the mark is <span className="font-semibold text-foreground">dark</span> — the column decided.
          If they differ the mark is <span className="font-semibold text-foreground">light</span> — a rule changed the
          answer, and hovering the circle says which one. Light never means "a rule was consulted"; it means the same
          board value would read differently under a different payer.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <span><span className="font-semibold tabular-nums">{n}</span> patients loaded</span>
          <span><span className="font-semibold tabular-nums">{stats.lightRows}</span> rows ({pct(stats.lightRows)}) carry at least one light mark tonight</span>
          <span><span className="font-semibold tabular-nums">{stats.firstOrders}</span> first orders</span>
          <span><span className="font-semibold tabular-nums">{stats.flags.get("oop-unknown") ?? 0}</span> OOP unknown · <span className="font-semibold tabular-nums">{stats.flags.get("gp-unknown") ?? 0}</span> GP unknown</span>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="text-[15px] font-semibold">Confirm — decided per patient, not per payer</div>
        <p className="text-[13px] text-muted-foreground leading-relaxed max-w-4xl">
          A Confirmed, Delay, Cancel or Pause from the patient is the column speaking and reads dark for everyone.
          When there is <span className="text-foreground">no reply</span> (No Response, or the text has not been answered),
          the answer depends on money: no reply is acceptable when OOP Estimate is at most ${CONFIRM_OOP_THRESHOLD} and
          the board's Total GP for the fill is not negative. Over ${CONFIRM_OOP_THRESHOLD}, or a fill that loses money,
          needs the patient's yes. A blank or unreadable figure is <span className="text-foreground">unknown</span>, which
          cannot pass — and from {OOP_WINDOW_DAYS} days before the order a blank OOP Estimate also raises the OOP-unknown badge,
          because the estimate is written at 19 days out and by then it should exist. First orders are exempt from all of it.
        </p>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b">
          <div className="text-[15px] font-semibold">Payer groups</div>
          <div className="text-[12px] text-muted-foreground">One row per group. Counts are the patients loaded now.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-2 font-bold">Group</th>
                <th className="text-left px-3 py-2 font-bold">Payers</th>
                <th className="text-right px-3 py-2 font-bold">Patients</th>
                <th className="text-left px-3 py-2 font-bold">Eligibility freshness</th>
                <th className="text-left px-3 py-2 font-bold">COB check</th>
                <th className="text-left px-3 py-2 font-bold">Primary match</th>
                <th className="text-left px-3 py-2 font-bold">Hospice</th>
                <th className="text-left px-3 py-2 font-bold">Authorization</th>
                <th className="text-left px-3 py-2 font-bold">Secondary open OK</th>
              </tr>
            </thead>
            <tbody>
              {PAYER_GROUPS.map((g) => {
                const payers = [...(stats.payersInGroup.get(g.id) ?? new Map<string, number>()).entries()]
                  .sort((a, b) => b[1] - a[1]);
                return (
                  <tr key={g.id} className="border-t align-top">
                    <td className="px-5 py-3">
                      <div className="font-semibold">{g.name}</div>
                      <div className="text-[11px] text-muted-foreground max-w-[260px] leading-snug mt-0.5">{g.source}</div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {payers.length === 0
                        ? <span>—</span>
                        : payers.slice(0, 8).map(([name, c]) => (
                            <div key={name} className="whitespace-nowrap">{name} <span className="tabular-nums">· {c}</span></div>
                          ))}
                      {payers.length > 8 && <div className="text-[11px]">+{payers.length - 8} more</div>}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{stats.byGroup.get(g.id) ?? 0}</td>
                    <td className="px-3 py-3">
                      {g.eligibility.freshnessDays != null
                        ? <span>{g.eligibility.freshnessDays} days{g.eligibility.sameMonth ? " and same month" : ""}</span>
                        : <span className="text-muted-foreground">none</span>}
                    </td>
                    <td className="px-3 py-3">{yesNo(g.eligibility.cobCheck)}</td>
                    <td className="px-3 py-3">{yesNo(g.eligibility.primaryMatch)}</td>
                    <td className="px-3 py-3">{yesNo(g.eligibility.hospiceOk, "billable (GW)", "stop")}</td>
                    <td className="px-3 py-3">{authWord(g.auth)}</td>
                    <td className="px-3 py-3">{yesNo(g.claims.secondaryOpenOk)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b">
          <div className="text-[15px] font-semibold">Every rule that can make a mark light</div>
          <div className="text-[12px] text-muted-foreground">
            "Tonight" = patients whose circle is currently light because of this rule. The set worth auditing.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-5 py-2 font-bold">Check</th>
                <th className="text-left px-3 py-2 font-bold">Applies to</th>
                <th className="text-left px-3 py-2 font-bold">When</th>
                <th className="text-left px-3 py-2 font-bold">Mark</th>
                <th className="text-right px-3 py-2 font-bold">Tonight</th>
                <th className="text-left px-3 py-2 font-bold">Source</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r) => {
                const count = stats.byRule.get(r.id) ?? 0;
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="font-semibold">{CHECK_NAME[r.check]}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.id}</div>
                    </td>
                    <td className="px-3 py-3 max-w-[200px]">{r.applies}</td>
                    <td className="px-3 py-3 max-w-[360px] leading-snug">
                      {r.when}
                      {r.flag && <div className="text-[11px] text-violet-700 mt-0.5">+ {r.flag === "oop-unknown" ? "OOP unknown" : "GP unknown"} badge on the row</div>}
                    </td>
                    <td className="px-3 py-3"><Mark verdict={r.verdict} /></td>
                    <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", count === 0 && "text-muted-foreground")}>{count}</td>
                    <td className="px-3 py-3 max-w-[320px] text-[12px] text-muted-foreground leading-snug">{r.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
