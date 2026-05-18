// Top-of-page cash flow summary. Four tiles: Total Open, Soon, Expected,
// High Risk. Spans both Primary and Secondary claims.

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, Calendar, Clock, AlertTriangle, Info } from "lucide-react";
import { computeCashFlow } from "@/lib/claims/cashflow";
import { fmtMoney } from "@/lib/claims/logic";
import type { Claim } from "@/lib/claims/types";
import type { SecClaim } from "@/components/claims/SecondaryBoard";
import { cn } from "@/lib/utils";

interface Props {
  claims: Claim[];
  secondaryClaims?: SecClaim[];
}

// Drop the cents — aggregate dollars, not invoice-level.
function money(n: number): string {
  return fmtMoney(Math.round(n)).replace(/\.00$/, "");
}

export function CashFlowSummary({ claims, secondaryClaims = [] }: Props) {
  const stats = useMemo(
    () => computeCashFlow(claims, secondaryClaims),
    [claims, secondaryClaims],
  );

  const avgClaim =
    stats.totalOpen.count > 0
      ? stats.totalOpen.total / stats.totalOpen.count
      : 0;

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
                Expected inflow projection across both Primary and Secondary
                boards. Excludes claims already settled (paid date in the
                past) and pre-submission states. Medicaid uses the eMedNY
                cycle (cycle-end Wednesday + 21 days).
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
            avg={avgClaim}
            breakdown={[
              {
                label: "Primary",
                value: stats.primaryTotal.total,
                count: stats.primaryTotal.count,
              },
              {
                label: "Secondary",
                value: stats.secondaryTotal.total,
                count: stats.secondaryTotal.count,
              },
              {
                label: "Pump claims",
                value: stats.totalOpenPumps.total,
                count: stats.totalOpenPumps.count,
                emphasis: true,
              },
            ]}
          />
          <Tile
            tone="success"
            icon={<Calendar className="h-5 w-5" />}
            label="Soon"
            amount={stats.soon.total}
            count={stats.soon.count}
            subtitle="Received ERA / Medicaid next 7 days"
            breakdown={[
              {
                label: "Received ERA",
                value: stats.soonEra.total,
                count: stats.soonEra.count,
              },
              {
                label: "Medicaid (next Wed)",
                value: stats.soonMedicaid.total,
                count: stats.soonMedicaid.count,
              },
              {
                label: "Pump claims",
                value: stats.soonPumps.total,
                count: stats.soonPumps.count,
                emphasis: true,
              },
            ]}
            tooltipText="Claims with the EFT pay date within 7 days, OR pure-Medicaid awaiting ERA whose eMedNY settle date is within 7 days. Spans both Primary and Secondary."
          />
          <Tile
            tone="neutral"
            icon={<Clock className="h-5 w-5" />}
            label="Expected"
            amount={stats.expected.total}
            count={stats.expected.count}
            subtitle="ERA's outstanding within 21 days of DOS / Medicaid 7-21 days"
            breakdown={[
              {
                label: "Primary (non-medicaid)",
                value: stats.expectedPrimaryNonMedicaid.total,
                count: stats.expectedPrimaryNonMedicaid.count,
              },
              {
                label: "Primary (medicaid)",
                value: stats.expectedPrimaryMedicaid.total,
                count: stats.expectedPrimaryMedicaid.count,
              },
              {
                label: "Secondary (Insurance)",
                value: stats.expectedSecondaryInsurance.total,
                count: stats.expectedSecondaryInsurance.count,
              },
              {
                label: "Secondary (Patient)",
                value: stats.expectedSecondaryPatient.total,
                count: stats.expectedSecondaryPatient.count,
              },
              {
                label: "Pump claims",
                value: stats.expectedPumps.total,
                count: stats.expectedPumps.count,
                emphasis: true,
              },
            ]}
            tooltipText="Non-Medicaid primaries awaiting ERA within their normal turnaround window, pure-Medicaid more than a week from their eMedNY settle date, and secondaries (Forwarded/Insurance/Patient) still awaiting payment."
          />
          <Tile
            tone="danger"
            icon={<AlertTriangle className="h-5 w-5" />}
            label="High risk"
            amount={stats.highRisk.total}
            count={stats.highRisk.count}
            subtitle="No primary ERA, sent 21+ days ago"
            breakdown={
              stats.highRiskPumps.count > 0
                ? [
                    {
                      label: "Pump claims",
                      value: stats.highRiskPumps.total,
                      count: stats.highRiskPumps.count,
                      emphasis: true,
                    },
                  ]
                : undefined
            }
            tooltipText="Non-Medicaid primary claims submitted 21+ days ago that still have no ERA. Past normal payer turnaround — something may be wrong (denial, payer issue, lost claim)."
          />
        </div>
      </section>
    </TooltipProvider>
  );
}

type Tone = "info" | "success" | "neutral" | "danger";

const TONE_CLASSES: Record<Tone, { icon: string; ring: string }> = {
  info:    { icon: "bg-blue-100 text-blue-700",      ring: "" },
  success: { icon: "bg-emerald-100 text-emerald-700", ring: "" },
  neutral: { icon: "bg-amber-100 text-amber-800",    ring: "" },
  danger:  { icon: "bg-rose-100 text-rose-700",      ring: "" },
};

interface BreakdownRow {
  label: string;
  value: number;
  count: number;
  // Pump rows are visually separated — pumps are $4-6k each, so the
  // operator wants to see the pump-only contribution at a glance.
  emphasis?: boolean;
}

function Tile({
  label,
  amount,
  count,
  subtitle,
  avg,
  icon,
  tone,
  tooltipText,
  breakdown,
}: {
  label: string;
  amount: number;
  count: number;
  subtitle?: string;
  avg?: number;
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
          {avg != null && avg > 0 && (
            <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              avg {money(avg)}/claim
            </div>
          )}
        </div>
      </div>
      <div className="mt-3">
        <div className="text-sm font-semibold">{label}</div>
        {(subtitle || count > 0) && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-medium">
              {count.toLocaleString()} claim{count === 1 ? "" : "s"}
            </span>
            {subtitle && (
              <>
                <span className="mx-1">·</span>
                <span>{subtitle}</span>
              </>
            )}
          </div>
        )}
        {breakdown && breakdown.length > 0 && (
          <div className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
            {breakdown.map((row) => (
              <div
                key={row.label}
                className={cn(
                  "flex items-baseline justify-between gap-2",
                  row.emphasis && "mt-1 border-t border-dashed pt-1",
                )}
              >
                <span className={cn(row.emphasis && "font-medium text-foreground")}>
                  {row.label}
                </span>
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
