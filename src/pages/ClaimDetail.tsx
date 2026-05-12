import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppHeader } from "@/components/claims/AppHeader";
import {
  ClaimStatusBadge, LineStatusBadge, PrimaryStatusBadge, StatusBadge, Status277Badge,
} from "@/components/claims/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getClaim } from "@/lib/claims/mockData";
import { useAllClaims } from "@/hooks/useAllClaims";
import { hasMondayToken } from "@/api/monday";
import {
  carcMeaning, claimAge, eraReceived, fmtDate, fmtMoney, lineStatus,
  suggestedOutcome, variance, variancePretty,
} from "@/lib/claims/logic";
import type {
  Claim, DenialAction, DenialAnalysis, ServiceLine,
} from "@/lib/claims/types";
import {
  AlertCircle, CalendarIcon, CheckCircle2, ChevronDown,
  FileWarning, Ban, AlertTriangle,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { carcPlaybookText, rarcPlaybookText, lookupDenialAnalysis } from "@/lib/claims/playbook";
import { useThreadClaims } from "@/lib/claims/threadStore";
import { Send } from "lucide-react";
import type { ItemStatus, ThreadClaim, ThreadClaimType } from "@/lib/claims/threads";

type LineUserStatus = "Paid" | "Underpaid" | "Denied";

const DENIAL_ANALYSIS_OPTIONS: NonNullable<DenialAnalysis>[] = [
  "No Auth", "Units / Frequency", "Wrong Modifiers", "Invalid Diagnosis Code",
  "Wrong Payer", "Documentation Required", "Pump / Monitor Not on File",
  "Inpatient / SNF / Hospice", "Inactive Coverage", "Timely Filing",
  "Duplicate Claim", "Other / Needs Review",
];

const DENIAL_ACTION_OPTIONS: NonNullable<DenialAction>[] = [
  "New claim", "Corrected claim", "Appeal", "Investigate", "Submit auth",
  "Upload docs", "Contact payer", "Action Complete", "No Action / Write Off",
];

const ClaimDetail = () => {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();

  // Look up the claim from real Monday data first; fall back to mock when
  // no token is configured (local dev). Match by Claim ID column or by the
  // Monday item id, since some claims don't have a Claim ID set yet.
  const { data: mondayClaims, isLoading: claimsLoading } = useAllClaims();
  const initial = (() => {
    if (!claimId) return undefined;
    if (hasMondayToken()) {
      if (!mondayClaims) return undefined; // still loading
      return mondayClaims.find(
        (c) => c.id === claimId || c.mondayItemId === claimId,
      );
    }
    return getClaim(claimId);
  })();

  if (hasMondayToken() && claimsLoading && !initial) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Loading…" showBack />
        <main className="mx-auto max-w-[1440px] px-6 py-12">
          <p className="text-muted-foreground">Fetching claim {claimId} from Monday…</p>
        </main>
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader title="Claim not found" showBack />
        <main className="mx-auto max-w-[1440px] px-6 py-12">
          <p className="text-muted-foreground">No claim with id {claimId}.</p>
          <Button asChild className="mt-4"><Link to="/claims">Back to queue</Link></Button>
        </main>
      </div>
    );
  }

  const [claim, setClaim] = useState<Claim>(initial);
  const [denialAction, setDenialAction] = useState<DenialAction>(claim.denialAction);
  const [actionContext, setActionContext] = useState(claim.actionContext ?? "");
  const [nextActionDate, setNextActionDate] = useState<Date | undefined>(
    claim.nextActionDate ? new Date(claim.nextActionDate) : undefined,
  );
  const defaultLineUserStatus = (l: ServiceLine): LineUserStatus => {
    const s = lineStatus(l);
    if (s === "Paid" || s === "PR") return "Paid";
    if (s === "Partial") return "Underpaid";
    return "Denied";
  };
  const [lineUserStatus, setLineUserStatus] = useState<Record<string, LineUserStatus>>(
    Object.fromEntries(claim.lines.map((l) => [l.id, defaultLineUserStatus(l)])),
  );
  const [lineAnalysis, setLineAnalysis] = useState<Record<string, DenialAnalysis>>(
    Object.fromEntries(claim.lines.map((l) => [l.id, l.denialAnalysis])),
  );
  const [overrideReason, setOverrideReason] = useState("");

  function appendActivity(message: string) {
    return [
      ...(claim.activity ?? []),
      { ts: new Date().toISOString(), actor: "you", message },
    ];
  }

  const age = claimAge(claim);
  const era = eraReceived(claim);
  const v = variance(claim);
  const vPretty = variancePretty(claim);
  const outcome = suggestedOutcome(claim);

  const linesWithIssues = useMemo(
    () => claim.lines.filter((l) => lineUserStatus[l.id] !== "Paid"),
    [claim.lines, lineUserStatus],
  );

  function writeback(label: string, fields: Record<string, unknown>) {
    // Placeholder: real impl posts to Monday API
    console.log("[Monday writeback]", label, fields);
    toast.success("Claim updated successfully.", {
      description: `Saved: ${Object.keys(fields).join(", ")}`,
    });
  }

  function markPrimaryPaid() {
    const v = Math.abs(variance(claim));
    if (v > 5 && !overrideReason.trim()) {
      toast.error("Variance exceeds tolerance — manager override reason required.");
      return;
    }
    const note = v > 5
      ? `Marked primary paid with manager override: ${overrideReason}`
      : "Marked primary paid via Command Center.";
    setClaim({
      ...claim, primaryStatus: "Paid", denialAction: "Action Complete",
      subscriptionClearance: claim.secondaryPayer || claim.prAmount > 0 ? "Manager Review" : "Clear",
      claimsHoldReason: claim.secondaryPayer ? "Secondary outstanding" : (claim.prAmount > 0 ? "Patient balance" : null),
      activity: appendActivity(note),
    });
    writeback("Primary Paid / Resolved", {
      Primary: "Paid", "Denial Action": "Action Complete",
      "Notes & Activity": note,
    });
  }

  function saveDenial() {
    if (!denialAction) {
      toast.error("Choose a claim-level denial action."); return;
    }
    if (!actionContext.trim()) {
      toast.error("Action context is required."); return;
    }
    if (!nextActionDate) {
      toast.error("Next action date is required."); return;
    }
    setClaim({
      ...claim, primaryStatus: "Denied (Or Partly)",
      denialAction, actionContext,
      nextActionDate: nextActionDate.toISOString(),
      subscriptionClearance: "Hold",
      claimsHoldReason: "Denial / appeal pending",
      lines: claim.lines.map((l) => ({ ...l, denialAnalysis: lineAnalysis[l.id] })),
      activity: appendActivity(`Saved denial action: ${denialAction}. ${actionContext}`),
    });
    writeback("Denial saved", {
      Primary: "Denied (Or Partly)",
      "Denial Action": denialAction,
      "Action Context": actionContext,
      "Next Action Date": format(nextActionDate, "yyyy-MM-dd"),
    });
  }

  function markInvestigation() {
    if (!actionContext.trim() || !nextActionDate) {
      toast.error("Action context and next action date required."); return;
    }
    setClaim({
      ...claim,
      denialAction: "Investigate",
      actionContext,
      nextActionDate: nextActionDate.toISOString(),
      activity: appendActivity(`Marked for investigation: ${actionContext}`),
    });
    writeback("Marked for Investigation", {
      Primary: "Review", "Denial Action": "Investigate",
      "Action Context": actionContext,
      "Next Action Date": format(nextActionDate, "yyyy-MM-dd"),
    });
  }

  function runStatusCheck() {
    if (eraReceived(claim)) {
      toast.error("ERA already received — review the ERA instead of running a status check.");
      return;
    }
    setClaim({ ...claim, activity: appendActivity("Status check requested.") });
    writeback("Claim Status Check triggered", {
      "Claim Status Check": "Run",
      "Notes & Activity": "Status check requested via Command Center.",
    });
  }

  function moveToSecondary() {
    if (!claim.secondaryPayer) {
      toast.error("No secondary payer on file — cannot mark Ready for Secondary.");
      return;
    }
    setClaim({
      ...claim,
      primaryStatus: "Paid",
      transfer: "Ready for Secondary",
      subscriptionClearance: "Manager Review",
      claimsHoldReason: "Secondary outstanding",
      activity: appendActivity(`Handed off to secondary: ${claim.secondaryPayer}.`),
    });
    writeback("Ready for Secondary", {
      Primary: "Paid", Transfer: "Ready for Secondary",
    });
  }

  function writeOff() {
    if (!actionContext.trim()) {
      toast.error("Action context explaining why is required."); return;
    }
    setClaim({
      ...claim,
      primaryStatus: "Bad Debt",
      denialAction: "No Action / Write Off",
      actionContext,
      subscriptionClearance: "Manager Review",
      activity: appendActivity(`Wrote off: ${actionContext}`),
    });
    writeback("Write Off", {
      Primary: "Bad Debt",
      "Denial Action": "No Action / Write Off",
      "Action Context": actionContext,
    });
  }

  function escalate() {
    setClaim({
      ...claim,
      subscriptionClearance: "Manager Review",
      activity: appendActivity(`Escalated for manager review${actionContext ? `: ${actionContext}` : "."}`),
    });
    writeback("Escalated", {
      "Subscription Clearance": "Manager Review",
      "Notes & Activity": "Escalation requested via Command Center.",
    });
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <AppHeader
        title={claim.patientName}
        subtitle={`DOB ${fmtDate(claim.dob)} · DOS ${fmtDate(claim.dos)} · ${claim.primaryPayor} · Member ID ${claim.memberId}`}
        showBack
      />

      <main className="mx-auto max-w-[1440px] px-6 py-6 space-y-6">
        {/* Status badges row */}
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryStatusBadge status={claim.primaryStatus} />
          <Status277Badge status={claim.status277} />
          <ClaimStatusBadge status={claim.claimStatusCategory} />
          <StatusBadge tone={era ? "info" : "neutral"}>
            ERA {era ? "Received" : "Not Received"}
          </StatusBadge>
          {age != null && (
            <StatusBadge tone={age >= 30 ? "danger" : age >= 15 ? "warning" : "neutral"}>
              {age}d old
            </StatusBadge>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            Claim {claim.claimId}{claim.payerClaimNumber ? ` · Payer #${claim.payerClaimNumber}` : ""}
          </div>
        </div>

        {/* Summary cards */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat label="Expected Pay" value={fmtMoney(claim.estPay)}
            sub="Based on service lines" />
          <SummaryStat label="Primary Paid" value={fmtMoney(claim.primaryPaid)}
            sub={claim.primaryPaidDate ? `Paid ${fmtDate(claim.primaryPaidDate)}` : "Not paid yet"} />
          <SummaryStat label="Patient Responsibility" value={fmtMoney(claim.prAmount)}
            sub={`Deductible ${fmtMoney(claim.lines.reduce((s, l) => s + l.deductible, 0))} · Coins ${fmtMoney(claim.lines.reduce((s, l) => s + l.coinsurance, 0))}`} />
          <SummaryStat
            label="Difference"
            value={vPretty.tone === "balanced" ? "Balanced" : (v > 0 ? `${fmtMoney(v)} short` : `${fmtMoney(Math.abs(v))} over`)}
            sub="Est. Pay − Paid − PR"
            tone={vPretty.tone === "balanced" ? "success" : vPretty.tone === "short" ? "danger" : "info"}
          />
        </section>

        {/* ERA table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Service Lines</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Product</TableHead>
                    <TableHead>HCPCS</TableHead>
                    <TableHead>Mods</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Charge</TableHead>
                    <TableHead className="text-right">Est. Pay</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Ded.</TableHead>
                    <TableHead className="text-right">Coins/Copay</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    <TableHead>CARC/RARC</TableHead>
                    <TableHead className="w-[140px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claim.lines.map((l) => (
                    <LineRow
                      key={l.id}
                      line={l}
                      status={lineUserStatus[l.id]}
                      onStatusChange={(s) => setLineUserStatus((p) => ({ ...p, [l.id]: s }))}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Denial analysis section — work denials only */}
        {claim.primaryStatus === "Denied (Or Partly)" && linesWithIssues.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Denial Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {linesWithIssues.map((l) => {
                const interpreted = lookupDenialAnalysis(l.carc, l.rarc);
                return (
                <div key={l.id} className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_minmax(220px,1fr)]">
                  <div>
                    <div className="font-medium text-sm">{l.product}</div>
                    <div className="text-xs text-muted-foreground">{l.hcpcs}{l.modifiers.length ? ` · ${l.modifiers.join(", ")}` : ""}</div>
                  </div>
                  <div className="text-sm">
                    <div className="font-mono text-xs">
                      {[...l.carc.map((c) => `CO-${c}`), ...l.rarc].join(" · ") || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {l.adjustmentReasons[0] ?? l.remarkText[0] ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Denial Reason (Playbook)</div>
                    <div className="mt-1 text-sm font-medium">
                      {interpreted ?? <span className="text-muted-foreground italic">Not in playbook</span>}
                    </div>
                  </div>
                </div>
                );
              })}

              <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <label className="text-sm font-medium">Claim-level Denial Action</label>
                    <span className="text-xs text-muted-foreground">
                      {`Applies to: ${linesWithIssues.length} of ${claim.lines.length} unresolved items`}
                    </span>
                  </div>
                  <Select
                    value={denialAction ?? undefined}
                    onValueChange={(v) => setDenialAction(v as DenialAction)}
                  >
                    <SelectTrigger><SelectValue placeholder="Choose action" /></SelectTrigger>
                    <SelectContent>
                      {DENIAL_ACTION_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Next Action Date</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !nextActionDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {nextActionDate ? format(nextActionDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={nextActionDate} onSelect={setNextActionDate}
                        initialFocus className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Action Context</label>
                  <Textarea
                    placeholder="e.g. Reduce units to 30 and resubmit. Upload clinical notes to payer portal."
                    value={actionContext}
                    onChange={(e) => setActionContext(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="md:col-span-2">
                  <CreateFollowUpButton
                    claim={claim}
                    denialAction={denialAction}
                    disabled={
                      denialAction !== "New claim" && denialAction !== "Corrected claim"
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Final decision panel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Final Decision</CardTitle>
            <p className="text-sm text-muted-foreground">Pick one outcome to close out this claim.</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <DecisionCard
                tone="success" icon={<CheckCircle2 className="h-5 w-5" />}
                title="Paid"
                desc="Primary paid correctly. Remainder is PR or going to secondary."
                cta="Mark Paid" onClick={markPrimaryPaid}
                disabled={linesWithIssues.length > 0}
              />
              <DecisionCard
                tone="danger" icon={<FileWarning className="h-5 w-5" />}
                title="Denied / Partial Denial"
                desc="One or more lines were denied or underpaid. Send to the denial flow."
                cta="Send to Denial" onClick={saveDenial}
                disabled={linesWithIssues.length === 0}
              />
            </div>
            <div className="mt-6 flex items-center justify-between">
              <Button variant="outline" onClick={escalate}>
                <AlertTriangle className="mr-2 h-4 w-4" /> Escalate for review
              </Button>
              <Button variant="ghost" onClick={() => navigate("/claims")}>Back to Queue</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

function SummaryStat({
  label, value, sub, tone = "neutral",
}: {
  label: string; value: string; sub?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneText: Record<typeof tone, string> = {
    neutral: "text-foreground",
    success: "text-success-soft-foreground",
    warning: "text-warning-soft-foreground",
    danger: "text-danger-soft-foreground",
    info: "text-info-soft-foreground",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneText[tone])}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function CodeChip({ code, meaning }: { code: string; meaning: string | null }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] underline decoration-dotted underline-offset-2">
            {code}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="font-medium">{code}</div>
          <div className="text-xs text-muted-foreground">{meaning ?? "No description on file"}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LineRow({
  line, status, onStatusChange,
}: {
  line: ServiceLine;
  status: LineUserStatus;
  onStatusChange: (s: LineUserStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const diff = line.estPay - line.primaryPaid - line.patientResponsibility;
  const diffTone =
    Math.abs(diff) <= 0.5 ? "text-muted-foreground" :
    diff > 0 ? "text-danger-soft-foreground" : "text-info-soft-foreground";

  return (
    <>
      <TableRow className="hover:bg-muted/30">
        <TableCell className="w-8">
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </TableCell>
        <TableCell className="font-medium">{line.product}</TableCell>
        <TableCell className="font-mono text-xs">{line.hcpcs}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {line.modifiers.map((m) => (
              <span key={m} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{m}</span>
            ))}
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">{line.units}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtMoney(line.charge)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtMoney(line.estPay)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtMoney(line.primaryPaid)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtMoney(line.deductible)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtMoney(line.coinsurance + line.copay)}</TableCell>
        <TableCell className={cn("text-right tabular-nums", diffTone)}>{fmtMoney(diff)}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {line.carc.length === 0 && line.rarc.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <>
                {line.carc.map((c) => {
                  const code = `CO-${c}`;
                  return (
                    <CodeChip
                      key={`c${c}`}
                      code={code}
                      meaning={carcPlaybookText(c) ?? carcMeaning(c)}
                    />
                  );
                })}
                {line.rarc.map((r) => (
                  <CodeChip key={`r${r}`} code={r} meaning={rarcPlaybookText(r)} />
                ))}
              </>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Select value={status} onValueChange={(v) => onStatusChange(v as LineUserStatus)}>
            <SelectTrigger
              className={cn(
                "h-8 w-[130px] font-medium",
                status === "Paid" && "bg-success-soft text-success-soft-foreground border-success-soft",
                status === "Underpaid" && "bg-warning-soft text-warning-soft-foreground border-warning-soft",
                status === "Denied" && "bg-danger-soft text-danger-soft-foreground border-danger-soft",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Underpaid">Underpaid</SelectItem>
              <SelectItem value="Denied">Denied</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30">
          <TableCell />
          <TableCell colSpan={12} className="py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
              <Detail label="Allowed" value={fmtMoney(line.allowed)} />
              <Detail label="CO Amount" value={fmtMoney(line.coAmount)} />
              <Detail label="PR Amount" value={fmtMoney(line.prAmount)} />
              <Detail label="OA Amount" value={fmtMoney(line.oaAmount)} />
              <Detail label="PI Amount" value={fmtMoney(line.piAmount)} />
              <Detail label="Copay" value={fmtMoney(line.copay)} />
              <Detail label="Coinsurance" value={fmtMoney(line.coinsurance)} />
              <Detail label="Patient Resp." value={fmtMoney(line.patientResponsibility)} />
            </div>
            {(line.adjustmentReasons.length || line.remarkText.length) > 0 && (
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {line.adjustmentReasons.map((r, i) => <div key={`a${i}`}>• {r}</div>)}
                {line.remarkText.map((r, i) => <div key={`r${i}`}>• {r}</div>)}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function DecisionCard({
  tone, icon, title, desc, cta, onClick, disabled,
}: {
  tone: "success" | "danger" | "warning" | "info" | "neutral";
  icon: React.ReactNode; title: string; desc: string; cta: string;
  onClick: () => void; disabled?: boolean;
}) {
  const toneBg: Record<typeof tone, string> = {
    success: "bg-success-soft text-success-soft-foreground",
    danger: "bg-danger-soft text-danger-soft-foreground",
    warning: "bg-warning-soft text-warning-soft-foreground",
    info: "bg-info-soft text-info-soft-foreground",
    neutral: "bg-neutral-soft text-neutral-soft-foreground",
  };
  const cardTone: Record<typeof tone, string> = {
    success: "bg-success-soft/40 border-success-soft-foreground/30",
    danger: "bg-danger-soft/40 border-danger-soft-foreground/30",
    warning: "bg-warning-soft/40 border-warning-soft-foreground/30",
    info: "bg-info-soft/40 border-info-soft-foreground/30",
    neutral: "bg-background",
  };
  const ctaTone: Record<typeof tone, string> = {
    success: "bg-success-soft-foreground text-white hover:bg-success-soft-foreground/90",
    danger: "bg-danger-soft-foreground text-white hover:bg-danger-soft-foreground/90",
    warning: "",
    info: "",
    neutral: "",
  };
  return (
    <div className={cn("rounded-lg border p-4 flex flex-col gap-3", cardTone[tone], disabled && "opacity-50")}>
      <div className="flex items-center gap-2">
        <div className={cn("grid h-8 w-8 place-items-center rounded-md", toneBg[tone])}>{icon}</div>
        <div className="font-medium">{title}</div>
      </div>
      <p className="text-xs text-muted-foreground flex-1">{desc}</p>
      <Button
        size="sm"
        variant={tone === "neutral" ? "outline" : "default"}
        className={cn(ctaTone[tone])}
        onClick={onClick}
        disabled={disabled}
      >
        {cta}
      </Button>
    </div>
  );
}

function CreateFollowUpButton({
  claim,
  denialAction,
  disabled,
}: {
  claim: Claim;
  denialAction: DenialAction;
  disabled?: boolean;
}) {
  const { claims, addRoot, spawnFollowUp } = useThreadClaims();

  const handleClick = () => {
    let parentId = claim.id;
    if (!claims.some((c) => c.id === parentId)) {
      // Seed the thread store with this claim as a root, mapping ServiceLines -> ThreadItems.
      const items = claim.lines.map((l, idx) => {
        let status: ItemStatus = "Pending";
        if (l.primaryPaid > 0 && l.primaryPaid >= l.estPay * 0.95) status = "Paid/Done";
        else if (l.primaryPaid > 0) status = "Partial";
        else if (l.carc.length > 0 || l.rarc.length > 0) status = "Denied";
        return {
          id: `${claim.id}_i${idx}`,
          hcpc: l.hcpcs,
          modifiers: [...l.modifiers],
          qty: l.units,
          charge: l.charge,
          est_pay: l.estPay,
          status,
          paid_amount: l.primaryPaid,
        };
      });
      const root: ThreadClaim = {
        id: claim.id,
        type: "Original",
        status: "Partially Paid",
        patient: { name: claim.patientName, dob: claim.dob, member_id: claim.memberId },
        payer: claim.primaryPayor,
        dos: claim.dos.slice(0, 10),
        icn: claim.payerClaimNumber ?? claim.claimId,
        items,
        createdAt: Date.now() - 1000,
      };
      addRoot(root);
    }
    const type: ThreadClaimType = denialAction === "Corrected claim" ? "Corrected" : "Original";
    const created = spawnFollowUp(parentId, type);
    if (created) {
      toast.success("Follow-up claim created", {
        description: `${created.items.length} item(s) linked to original. See Resubmit queue.`,
      });
    } else {
      toast.error("Could not create follow-up claim.");
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={disabled}
      className="bg-emerald-700 text-white hover:bg-emerald-800"
    >
      Create Follow-up Claim
      <Send className="ml-2 h-4 w-4" />
    </Button>
  );
}

export default ClaimDetail;
