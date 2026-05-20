// Top-of-page cash flow summary. Four tiles: Total Open, Soon, Expected,
// High Risk. Spans both Primary and Secondary claims. Each breakdown row
// is a button that opens a drill-down drawer listing the underlying
// claims (Name / DOS / Pay date / Amount). See CashFlowDetailDrawer.tsx.

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, Calendar, Clock, AlertTriangle, Info } from "lucide-react";
import { computeCashFlow, type BucketStat } from "@/lib/claims/cashflow";
import { fmtMoney } from "@/lib/claims/logic";
import type { Claim } from "@/lib/claims/types";
import type { SecClaim } from "@/components/claims/SecondaryBoard";
import { cn } from "@/lib/utils";
import { CashFlowDetailDrawer } from "./CashFlowDetailDrawer";

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

  // Active drawer: title + entries from whichever breakdown row was
  // clicked. Closing the drawer leaves the cached values in place so
  // the slide-out animation doesn't show an empty body mid-frame.
  const [drawer, setDrawer] = useState<{
    open: boolean;
    title: string;
    description?: string;
    stat: BucketStat;
  } | null>(null);

  function openDrawer(title: string, stat: BucketStat, description?: string) {
    setDrawer({ open: true, title, description, stat });
  }
  function closeDrawer() {
    setDrawer((d) => (d ? { ...d, open: false } : d));
  }

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
                cycle (cycle-end Wednesday + 21 days). Click any breakdown
                row to see which claims are in it.
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
                stat: stats.primaryTotal,
                description: "All primary claims awaiting payment.",
              },
              {
                label: "Secondary",
                stat: stats.secondaryTotal,
                description: "All secondary claims awaiting payment (insurance or patient).",
              },
              {
                label: "Pump claims",
                stat: stats.totalOpenPumps,
                emphasis: true,
                description: "Open claims with an insulin pump (HCPCS E0784).",
              },
            ]}
            onOpenBucket={openDrawer}
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
                stat: stats.soonEra,
                description: "ERA in hand with a future EFT pay date within 7 days.",
              },
              {
                label: "Medicaid (next Wed)",
                stat: stats.soonMedicaid,
                description: "Pure Medicaid claims whose eMedNY pay date is within 7 days.",
              },
              {
                label: "Pump claims",
                stat: stats.soonPumps,
                emphasis: true,
                description: "Pump claims (HCPCS E0784) in the Soon bucket.",
              },
            ]}
            tooltipText="Claims with the EFT pay date within 7 days, OR pure-Medicaid awaiting ERA whose eMedNY settle date is within 7 days. Spans both Primary and Secondary."
            onOpenBucket={openDrawer}
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
                stat: stats.expectedPrimaryNonMedicaid,
                description: "Commercial primaries within their normal 21-day turnaround, no ERA yet.",
              },
              {
                label: "Primary (medicaid)",
                stat: stats.expectedPrimaryMedicaid,
                description: "Pure-Medicaid claims more than 7 days from their eMedNY pay date.",
              },
              {
                label: "Secondary (Insurance)",
                stat: stats.expectedSecondaryInsurance,
                description: "Forwarded / insurance-routed secondaries awaiting ERA or payment.",
              },
              {
                label: "Secondary (Patient)",
                stat: stats.expectedSecondaryPatient,
                description: "Patient-balance secondaries awaiting collection.",
              },
              {
                label: "Pump claims",
                stat: stats.expectedPumps,
                emphasis: true,
                description: "Pump claims (HCPCS E0784) in the Expected bucket.",
              },
            ]}
            tooltipText="Non-Medicaid primaries awaiting ERA within their normal turnaround window, pure-Medicaid more than a week from their eMedNY settle date, and secondaries (Forwarded/Insurance/Patient) still awaiting payment."
            onOpenBucket={openDrawer}
          />
          <Tile
            tone="danger"
            icon={<AlertTriangle className="h-5 w-5" />}
            label="High risk"
            amount={stats.highRisk.total}
            count={stats.highRisk.count}
            subtitle="No primary ERA, sent 21+ days ago"
            breakdown={[
              {
                label: "Pump claims",
                stat: stats.highRiskPumps,
                emphasis: true,
                description: "Pump claims (HCPCS E0784) at risk — sent 21+ days ago, no ERA.",
              },
            ]}
            tooltipText="Non-Medicaid primary claims submitted 21+ days ago that still have no ERA. Past normal payer turnaround — something may be wrong (denial, payer issue, lost claim)."
            onOpenBucket={openDrawer}
          />
        </div>
      </section>

      {drawer && (
        <CashFlowDetailDrawer
          open={drawer.open}
          onOpenChange={(o) => (o ? null : closeDrawer())}
          title={drawer.title}
          description={drawer.description}
          entries={drawer.stat.entries}
          total={drawer.stat.total}
        />
      )}
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
  stat: BucketStat;
  // Pump rows are visually separated — pumps are $4-6k each, so the
  // operator wants to see the pump-only contribution at a glance.
  emphasis?: boolean;
  /** Short hint shown under the drawer title when this row is opened. */
  description?: string;
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
  onOpenBucket,
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
  onOpenBucket: (title: string, stat: BucketStat, description?: string) => void;
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
            {breakdown.map((row) => {
              // We render every breakdown row — even empty ones — so the
              // operator gets visual confirmation that the bucket is
              // empty rather than thinking the data didn't load. Empty
              // rows are non-interactive (no hover, no click).
              const isEmpty = row.stat.count === 0;
              return (
                <button
                  key={row.label}
                  type="button"
                  disabled={isEmpty}
                  onClick={(e) => {
                    // Stop propagation so the tile-wrapping tooltip
                    // trigger doesn't also fire on click.
                    e.stopPropagation();
                    onOpenBucket(row.label, row.stat, row.description);
                  }}
                  className={cn(
                    "flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left transition-colors",
                    row.emphasis && "mt-1 border-t border-dashed pt-1",
                    isEmpty
                      ? "cursor-default opacity-60"
                      : "hover:bg-muted/60 cursor-pointer",
                  )}
                >
                  <span className={cn(row.emphasis && "font-medium text-foreground")}>
                    {row.label}
                  </span>
                  <span className="tabular-nums">
                    <span className="font-medium text-foreground">{money(row.stat.total)}</span>
                    <span className="ml-1 text-muted-foreground">({row.stat.count})</span>
                  </span>
                </button>
              );
            })}
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
