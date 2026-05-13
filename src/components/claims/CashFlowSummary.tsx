// Top-of-page cash flow summary. Four tiles: Total Open, Soon, Medicaid 1+
// Week, High Risk. Read-only — doesn't filter the table below; it's purely
// a "what's coming in and when" snapshot for the operator.

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, Calendar, Clock, AlertTriangle, Info } from "lucide-react";
import { computeCashFlow } from "@/lib/claims/cashflow";
import { fmtMoney } from "@/lib/claims/logic";
import type { Claim } from "@/lib/claims/types";
import { cn } from "@/lib/utils";

interface Props {
  claims: Claim[];
}

// Drop the cents — these are aggregate dollars, not invoice-level numbers.
function money(n: number): string {
  return fmtMoney(Math.round(n)).replace(/\.00$/, "");
}

export function CashFlowSummary({ claims }: Props) {
  const stats = useMemo(() => computeCashFlow(claims), [claims]);

  return (
    <TooltipProvider delayDuration={150}>
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Cash flow
            </h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm text-xs">
                Expected inflow projection. Excludes claims already settled
                (paid date in the past) and pre-submission states. Medicaid
                uses the 3 / 4 Wednesday rule from the submission date.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Tile
            tone="info"
            icon={<TrendingUp className="h-5 w-5" />}
            label="Total open"
            amount={stats.totalOpen.total}
            count={stats.totalOpen.count}
            subtitle="all expected inflow"
          />
          <Tile
            tone="success"
            icon={<Calendar className="h-5 w-5" />}
            label="Soon"
            amount={stats.soon.total}
            count={stats.soon.count}
            subtitle="ERA in hand or Medicaid next Wed"
            breakdown={[
              { label: "ERA received", value: stats.soonEra.total, count: stats.soonEra.count },
              { label: "Medicaid (next Wed)", value: stats.soonMedicaid.total, count: stats.soonMedicaid.count },
            ]}
            tooltipText="Non-Medicaid claims where the EFT effective date is in the future, plus pure Medicaid claims whose 3/4-Wednesday settle date is within 7 days. Near-zero risk."
          />
          <Tile
            tone="neutral"
            icon={<Clock className="h-5 w-5" />}
            label="Expected"
            amount={stats.expected.total}
            count={stats.expected.count}
            subtitle="Medicaid 1+ wk + new claims (<21d)"
            tooltipText="Pure Medicaid claims whose eMedNY settle date is more than 7 days away, plus non-Medicaid claims still awaiting an ERA but submitted within the last 21 days (normal payer turnaround window). Low-medium risk."
          />
          <Tile
            tone="danger"
            icon={<AlertTriangle className="h-5 w-5" />}
            label="High risk"
            amount={stats.highRisk.total}
            count={stats.highRisk.count}
            subtitle="no ERA, sent 21+ days ago"
            tooltipText="Non-Medicaid claims submitted 21+ days ago that still have no ERA. Past normal payer turnaround — something may be wrong (denial, payer issue, lost claim)."
          />
        </div>
      </section>
    </TooltipProvider>
  );
}

type Tone = "info" | "success" | "neutral" | "danger";

const TONE_CLASSES: Record<Tone, { icon: string; ring: string }> = {
  info:    { icon: "bg-blue-100 text-blue-700",     ring: "" },
  success: { icon: "bg-emerald-100 text-emerald-700", ring: "" },
  neutral: { icon: "bg-amber-100 text-amber-800",   ring: "" },
  danger:  { icon: "bg-rose-100 text-rose-700",     ring: "" },
};

interface BreakdownRow {
  label: string;
  value: number;
  count: number;
}

function Tile({
  label,
  amount,
  count,
  subtitle,
  icon,
  tone,
  tooltipText,
  breakdown,
}: {
  label: string;
  amount: number;
  count: number;
  subtitle: string;
  icon: React.ReactNode;
  tone: Tone;
  tooltipText?: string;
  breakdown?: BreakdownRow[];
}) {
  const t = TONE_CLASSES[tone];
  const body = (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-md", t.icon)}>
          {icon}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums leading-none">
            {money(amount)}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-medium">{count.toLocaleString()} claim{count === 1 ? "" : "s"}</span>
          <span className="mx-1">·</span>
          <span>{subtitle}</span>
        </div>
        {breakdown && breakdown.length > 0 && (
          <div className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
            {breakdown.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2">
                <span>{row.label}</span>
                <span className="tabular-nums">
                  <span className="font-medium text-foreground">{money(row.value)}</span>
                  <span className="ml-1 text-muted-foreground">({row.count})</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
  if (!tooltipText) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
