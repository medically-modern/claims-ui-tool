/**
 * SubscriptionBoard.tsx — the new tab in the Claims Command Center.
 *
 * Two sub-tabs:
 *   - Order Preparation: row per patient with 4 checkpoint cells
 *     (Confirmation / Benefits / Auth / Last Order Paid). Operator works
 *     left-to-right clearing each cell until the patient moves to Submit.
 *   - Submit Order: patients with all 4 cells green, ready to ship.
 *
 * Backed by mock data for the first pass. Real Monday wiring lands when the
 * Subscription API endpoints exist.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, Clock, ExternalLink, RefreshCw, Search,
  Send, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  CHECKPOINT_STATE_OPTIONS, Checkpoint, ORDER_PREP_PATIENTS, PAYER_OPTIONS,
  SUBMIT_ORDER_PATIENTS, SubscriptionPatient,
} from "./mockData";

type SubTab = "prep" | "submit";

const SUB_TYPE_PILL = "inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700";

// ─── Checkpoint cell — visual atom ───────────────────────────────────────────
function CheckpointCell({ check, onClick }: { check: Checkpoint; onClick?: () => void }) {
  const palette = {
    ok:      { ring: "ring-emerald-200 bg-emerald-50",  text: "text-emerald-700",  icon: <Check className="h-3.5 w-3.5" /> },
    warn:    { ring: "ring-amber-200 bg-amber-50",      text: "text-amber-700",    icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    bad:     { ring: "ring-rose-200 bg-rose-50",        text: "text-rose-700",     icon: <X className="h-3.5 w-3.5" /> },
    pending: { ring: "ring-sky-200 bg-sky-50",          text: "text-sky-700",      icon: <Clock className="h-3.5 w-3.5" /> },
  }[check.tone];

  return (
    <button
      onClick={onClick}
      className="block w-full text-left"
    >
      <div className={cn("flex items-center gap-1.5", palette.text)}>
        <span className={cn("inline-grid h-5 w-5 place-items-center rounded-full ring-1", palette.ring)}>
          {palette.icon}
        </span>
        <span className="text-xs font-semibold">{check.label}</span>
      </div>
      {check.detail && (
        <div className="ml-6 mt-0.5 truncate text-[11px] text-muted-foreground">
          {check.detail}
        </div>
      )}
    </button>
  );
}

// Compute the order-prep next-action button label
function nextActionLabel(p: SubscriptionPatient): { label: string; primary: boolean } {
  if (p.confirmation.tone !== "ok") return { label: "Review Confirmation", primary: false };
  if (p.benefits.tone !== "ok")     return { label: "Run Eligibility",     primary: false };
  if (p.auth.tone !== "ok")         return { label: "Work Auth",            primary: false };
  if (p.lastPaid.tone !== "ok")     return { label: "Open Last Claim",     primary: false };
  return { label: "Submit Order", primary: true };
}

function rowAccent(p: SubscriptionPatient): "red" | "amber" | "none" {
  const cells = [p.confirmation, p.benefits, p.auth, p.lastPaid];
  if (cells.some((c) => c.tone === "bad")) return "red";
  if (cells.some((c) => c.tone === "warn" || c.tone === "pending")) return "amber";
  return "none";
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysFromToday(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// ─── KPI tile ────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sublines, tone,
}: {
  label: string;
  value: string | number;
  sublines?: Array<{ label: string; value: string }>;
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
}) {
  const dotPalette = {
    info:    "bg-sky-100 text-sky-600",
    warning: "bg-amber-100 text-amber-600",
    danger:  "bg-rose-100 text-rose-600",
    success: "bg-emerald-100 text-emerald-600",
    neutral: "bg-slate-100 text-slate-600",
  }[tone ?? "neutral"];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg", dotPalette)}>
          <Clock className="h-4 w-4" />
        </div>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{label}</div>
      {sublines && sublines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px] text-muted-foreground">
          {sublines.map((s) => (
            <li key={s.label}><span className="mr-1.5 text-foreground/80">{s.label}:</span>{s.value}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────
export function SubscriptionBoard() {
  const [subTab, setSubTab] = useState<SubTab>("prep");
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>("All payers");
  const [state, setState] = useState<string>("All states");
  const [activePatient, setActivePatient] = useState<SubscriptionPatient | null>(null);

  const prep = ORDER_PREP_PATIENTS;
  const submit = SUBMIT_ORDER_PATIENTS;

  // KPI counts (Order Prep)
  const kpis = useMemo(() => {
    const awaiting = prep.filter((p) => p.confirmation.tone === "pending").length;
    const changes  = prep.filter((p) => p.confirmation.label === "Review changes").length;
    const noResp   = prep.filter((p) => p.confirmation.label === "No response").length;
    const blocked  = prep.filter(rowAccent).filter((p) => rowAccent(p) === "red").length;
    const ready    = submit.length;
    return {
      total: prep.length, awaiting, changes, noResp, blocked, ready,
    };
  }, [prep, submit]);

  // Filter rows
  const filteredPrep = useMemo(() => {
    return prep.filter((p) => {
      if (search) {
        const q = search.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !p.mondayItemId.includes(q) && !p.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))) {
          return false;
        }
      }
      if (payer !== "All payers" && p.primaryPayer !== payer) return false;
      // Quick state filter (mocked, just demos the chip)
      if (state !== "All states") {
        if (state === "Awaiting Response" && p.confirmation.tone !== "pending") return false;
        if (state === "Review Changes" && p.confirmation.label !== "Review changes") return false;
        if (state === "No Response" && p.confirmation.label !== "No response") return false;
        if (state === "Confirmed" && p.confirmation.tone !== "ok") return false;
        if (state === "Benefits Inactive" && p.benefits.tone !== "bad") return false;
        if (state === "Auth Expiring" && !(p.auth.tone === "warn" && p.auth.label.startsWith("Renew"))) return false;
        if (state === "Auth Expired" && p.auth.label !== "Expired") return false;
        if (state === "Last Claim Unpaid" && p.lastPaid.tone !== "bad") return false;
      }
      return true;
    });
  }, [prep, search, payer, state]);

  return (
    <div className="space-y-4">
      {/* Sub-tabs + bulk actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={subTab} onValueChange={(v) => setSubTab(v as SubTab)}>
          <TabsList className="bg-card border">
            <TabsTrigger value="prep">Order Preparation</TabsTrigger>
            <TabsTrigger value="submit">Submit Order</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Send className="mr-2 h-4 w-4" /> Send Reorder Text
          </Button>
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Run Eligibility Batch
          </Button>
        </div>
      </div>

      {subTab === "prep" ? (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile tone="info"    label="Awaiting Response"  value={kpis.awaiting}
              sublines={[
                { label: "sent < 5d", value: String(prep.filter(p => p.confirmation.label === "Awaiting" && (p.confirmation.detail || "").includes("4d")).length) },
                { label: "sent 5d+",  value: String(prep.filter(p => p.confirmation.label === "Awaiting" && /(\d{1,2})d/.exec(p.confirmation.detail || "")?.[1] && Number(/(\d{1,2})d/.exec(p.confirmation.detail || "")?.[1]) >= 5).length) },
              ]} />
            <KpiTile tone="warning" label="Changes to Review"   value={kpis.changes}
              sublines={[
                { label: "product",   value: String(prep.filter(p => p.confirmation.detail?.includes("pump")).length) },
                { label: "address",   value: String(prep.filter(p => p.confirmation.detail?.includes("address")).length) },
                { label: "insurance", value: String(prep.filter(p => p.confirmation.detail?.includes("insurance")).length) },
              ]} />
            <KpiTile tone="danger"  label="Action Needed"       value={kpis.blocked}
              sublines={[
                { label: "auth",      value: String(prep.filter(p => p.auth.tone === "bad").length) },
                { label: "benefits",  value: String(prep.filter(p => p.benefits.tone === "bad").length) },
                { label: "prior claim", value: String(prep.filter(p => p.lastPaid.tone === "bad").length) },
              ]} />
            <KpiTile tone="neutral" label="Patients in Prep"    value={kpis.total} />
            <KpiTile tone="success" label="Ready to Submit"     value={kpis.ready} />
            <KpiTile tone="neutral" label="No Response (high-risk)" value={kpis.noResp} />
          </div>

          {/* Search + filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patient, phone, UID, member ID"
                className="pl-9"
              />
            </div>
            <Select value={payer} onValueChange={setPayer}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYER_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHECKPOINT_STATE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Order Preparation table */}
          <Card className="overflow-hidden">
            <div className="text-xs">
              <div className="grid grid-cols-[210px_120px_140px_180px_140px_140px_140px_140px_140px] gap-3 border-b bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <div>Patient</div>
                <div>Order Date</div>
                <div>Subscription</div>
                <div>Primary Payer</div>
                <div>Confirmation</div>
                <div>Benefits</div>
                <div>Auth</div>
                <div>Last Order Paid</div>
                <div>Action</div>
              </div>
              {filteredPrep.map((p) => {
                const accent = rowAccent(p);
                const action = nextActionLabel(p);
                const days = daysFromToday(p.nextOrderDate);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "relative grid grid-cols-[210px_120px_140px_180px_140px_140px_140px_140px_140px] gap-3 border-b px-4 py-3 hover:bg-muted/20",
                      accent !== "none" && "pl-[20px]",
                    )}
                  >
                    {accent !== "none" && (
                      <span
                        className={cn(
                          "absolute left-0 top-0 h-full w-[3px]",
                          accent === "red" ? "bg-rose-500" : "bg-amber-400",
                        )}
                      />
                    )}
                    {/* Patient */}
                    <button onClick={() => setActivePatient(p)} className="text-left">
                      <div className="text-[13px] font-semibold text-foreground">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">{p.phone} · {p.mondayItemId}</div>
                    </button>
                    {/* Order date */}
                    <div>
                      <div className="text-[13px] font-medium">{fmtDate(p.nextOrderDate)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {days > 0 ? `in ${days}d` : days === 0 ? "today" : `${-days}d ago`}
                      </div>
                    </div>
                    {/* Subscription type */}
                    <div className="flex items-start">
                      <span className={SUB_TYPE_PILL}>{p.subscriptionType}</span>
                    </div>
                    {/* Primary payer */}
                    <div>
                      <div className="text-[13px]">{p.primaryPayer}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.benefits.label === "Active" ? "Active" : p.benefits.label}
                      </div>
                    </div>
                    {/* 4 checkpoint cells */}
                    <CheckpointCell check={p.confirmation} onClick={() => setActivePatient(p)} />
                    <CheckpointCell check={p.benefits}     onClick={() => setActivePatient(p)} />
                    <CheckpointCell check={p.auth}          onClick={() => setActivePatient(p)} />
                    <CheckpointCell check={p.lastPaid}      onClick={() => setActivePatient(p)} />
                    {/* Action button */}
                    <div className="flex items-start">
                      <Button
                        size="sm"
                        variant={action.primary ? "default" : "outline"}
                        className="h-7 text-[11px]"
                        onClick={() => setActivePatient(p)}
                      >
                        {action.label}
                        <ArrowRight className="ml-1.5 h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              {filteredPrep.length === 0 && (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No patients match the current filters.
                </div>
              )}
            </div>
          </Card>
        </>
      ) : (
        // Submit Order tab
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile tone="success" label="Ready to Submit"    value={submit.length} />
            <KpiTile tone="success" label="Submitted today"    value={0} />
            <KpiTile tone="neutral" label="Submitted this week" value={0} />
            <KpiTile tone="neutral" label="Avg time in queue"  value="< 1d" />
            <KpiTile tone="neutral" label="Total OOP"          value="$2,890" />
            <KpiTile tone="neutral" label="Oldest waiting"     value="2d" />
          </div>

          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Primary Payer</TableHead>
                  <TableHead>OOP Est</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submit.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="text-[13px] font-semibold">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">{p.phone}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-[13px] font-medium">{fmtDate(p.nextOrderDate)}</div>
                      <div className="text-[11px] text-muted-foreground">in {daysFromToday(p.nextOrderDate)}d</div>
                    </TableCell>
                    <TableCell>
                      <span className={SUB_TYPE_PILL}>{p.subscriptionType}</span>
                    </TableCell>
                    <TableCell>{p.primaryPayer}</TableCell>
                    <TableCell>$0.00</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm">
                        <Send className="mr-1.5 h-3 w-3" /> Submit Order
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* Patient detail drawer */}
      <Sheet open={!!activePatient} onOpenChange={(o) => !o && setActivePatient(null)}>
        <SheetContent className="w-[520px] sm:max-w-[520px]">
          {activePatient && (
            <>
              <SheetHeader>
                <SheetTitle>{activePatient.name}</SheetTitle>
                <SheetDescription>
                  {activePatient.subscriptionType} · {activePatient.primaryPayer} · order {fmtDate(activePatient.nextOrderDate)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Readiness checks</div>
                  <div className="space-y-2">
                    {[
                      { name: "1. Confirmation",      c: activePatient.confirmation },
                      { name: "2. Benefits active",   c: activePatient.benefits },
                      { name: "3. Auth valid",        c: activePatient.auth },
                      { name: "4. Last order paid",   c: activePatient.lastPaid },
                    ].map((row) => (
                      <Card key={row.name} className="p-3 flex items-center justify-between">
                        <div>
                          <div className="text-[13px] font-semibold">{row.name}</div>
                          {row.c.detail && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">{row.c.detail}</div>
                          )}
                        </div>
                        <CheckpointCell check={row.c} />
                      </Card>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Patient info</div>
                  <Card className="p-3 space-y-1.5 text-[13px]">
                    <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{activePatient.phone}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Monday ID</span><span className="font-mono text-[11px]">{activePatient.mondayItemId}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Subscription</span><span>{activePatient.subscriptionType}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Primary payer</span><span>{activePatient.primaryPayer}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Next order</span><span>{fmtDate(activePatient.nextOrderDate)}</span></div>
                  </Card>
                </div>
              </div>
              <SheetFooter className="mt-6">
                <Button variant="outline" className="w-full" asChild>
                  <a
                    href={`https://medicallymodern-force.monday.com/boards/18407459988/pulses/${activePatient.mondayItemId}`}
                    target="_blank" rel="noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in Monday
                  </a>
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
