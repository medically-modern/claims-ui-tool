// Bank Confirmation — "Paid, but NOT in Bank" tracker (Hit Bank? gate).
//
// Every claim marked Paid waits in the "Paid, but NOT in Bank" group on
// its board until the deposit is confirmed in our bank account (Josh's
// QuickBooks bank-feed match writes Hit Bank? = Yes, or an operator marks
// it here). This tab rolls those claims up by DEPOSIT — one ACH / check /
// Stripe payout covers many claims — and flags deposits that are late or
// that Josh couldn't tie out (Hit Bank? = Mismatch).
//
// Marking a deposit "In bank" writes Hit Bank? = Yes on every claim in it
// (both boards) through the backend, which moves them to Paid And Closed.

import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Landmark, Loader2,
  RefreshCw, Search, TriangleAlert,
} from "lucide-react";
import {
  useParkedClaims, groupDeposits, markDeposit, isHitBankMarkConfigured,
  BANK_CONFIRMATION_QUERY_KEY, OVERDUE_BUSINESS_DAYS,
  type Deposit, type HitBankLabel,
} from "@/api/bankConfirmation";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Filter = "all" | "overdue" | "mismatch";

function DepositStatus({ d }: { d: Deposit }) {
  const [label, tone] =
    d.mismatch ? ["Mismatch", "bg-rose-100 text-rose-800 border-rose-200"] :
    d.overdue  ? ["Overdue",  "bg-amber-100 text-amber-800 border-amber-200"] :
                 ["Waiting",  "bg-muted text-muted-foreground border-border"];
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", tone)}>
      {label}
    </span>
  );
}

function Tile({ label, value, sub, active, onClick, tone }: {
  label: string; value: string | number; sub?: string; active?: boolean;
  onClick?: () => void; tone?: "warn" | "bad";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-card p-4 text-left transition hover:shadow-sm",
        active && "ring-2 ring-primary",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-1 text-2xl font-semibold tabular-nums",
        tone === "warn" && "text-amber-700",
        tone === "bad" && "text-rose-700",
      )}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </button>
  );
}

export function BankConfirmationTable() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch, error } = useParkedClaims();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const deposits = useMemo(() => groupDeposits(data ?? []), [data]);

  const stats = useMemo(() => {
    const sum = (ds: Deposit[]) =>
      ds.reduce((a, d) => a + (d.depositTotal ?? d.claimPaidSum), 0);
    const overdue = deposits.filter((d) => d.overdue && !d.mismatch);
    const mismatch = deposits.filter((d) => d.mismatch);
    return {
      count: deposits.length,
      claims: deposits.reduce((a, d) => a + d.claims.length, 0),
      total: sum(deposits),
      overdue: overdue.length, overdueTotal: sum(overdue),
      mismatch: mismatch.length, mismatchTotal: sum(mismatch),
    };
  }, [deposits]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deposits.filter((d) => {
      if (filter === "overdue" && !(d.overdue && !d.mismatch)) return false;
      if (filter === "mismatch" && !d.mismatch) return false;
      if (q) {
        const blob = [
          d.payer, d.reference, d.originator, d.kind,
          ...d.claims.map((c) => `${c.patientName} ${c.checkNumber} ${c.trace}`),
        ].join(" ").toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [deposits, filter, search]);

  async function mark(d: Deposit, label: HitBankLabel | null) {
    setBusy((b) => ({ ...b, [d.key]: true }));
    try {
      await markDeposit(d, label);
      toast({
        title:
          label === "Yes" ? `In bank: ${d.payer}` :
          label === "Mismatch" ? `Flagged mismatch: ${d.payer}` :
          `Cleared: ${d.payer}`,
        description:
          label === "Yes"
            ? `${d.claims.length} claim${d.claims.length === 1 ? "" : "s"} moved to Paid And Closed.`
            : `${d.claims.length} claim${d.claims.length === 1 ? "" : "s"} stay in Paid, but NOT in Bank.`,
      });
      await qc.invalidateQueries({ queryKey: BANK_CONFIRMATION_QUERY_KEY });
      void refetch();
    } catch (e) {
      toast({ title: "Couldn't update Hit Bank?", description: (e as Error).message });
    } finally {
      setBusy((b) => ({ ...b, [d.key]: false }));
    }
  }

  const canMark = isHitBankMarkConfigured();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Landmark className="h-5 w-5" /> Paid, but not in bank
          </h2>
          <p className="text-sm text-muted-foreground">
            Paid claims wait here until the deposit is confirmed in the bank
            (Hit Bank? = Yes). Grouped by deposit — match the deposit total, not
            the claim payments. Overdue after {OVERDUE_BUSINESS_DAYS.ACH} business
            days for ACH, {OVERDUE_BUSINESS_DAYS.CHK} for checks,{" "}
            {OVERDUE_BUSINESS_DAYS.Stripe} for Stripe.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Waiting on the bank"
          value={stats.count}
          sub={`${stats.claims} claims · ${fmtMoney(stats.total)}`}
          active={filter === "all"} onClick={() => setFilter("all")}
        />
        <Tile
          label="Overdue"
          value={stats.overdue}
          sub={fmtMoney(stats.overdueTotal)}
          tone={stats.overdue ? "warn" : undefined}
          active={filter === "overdue"} onClick={() => setFilter("overdue")}
        />
        <Tile
          label="Mismatch"
          value={stats.mismatch}
          sub={fmtMoney(stats.mismatchTotal)}
          tone={stats.mismatch ? "bad" : undefined}
          active={filter === "mismatch"} onClick={() => setFilter("mismatch")}
        />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search payer, patient, trace / check #"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!canMark && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4" />
          Backend not configured in this build — marking is disabled (view only).
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-700">
              Couldn't load: {(error as Error).message}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Nothing waiting on the bank{filter !== "all" ? " in this view" : ""}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Payer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead className="text-right">Deposit</TableHead>
                  <TableHead className="text-right">Claims</TableHead>
                  <TableHead className="text-right">Bus. days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((d) => {
                  const open = !!expanded[d.key];
                  const offset = d.depositTotal != null
                    && Math.abs(d.depositTotal - d.claimPaidSum) >= 0.01;
                  return (
                    <Fragment key={d.key}>
                      <TableRow className={cn(d.overdue && !d.mismatch && "bg-amber-50/40", d.mismatch && "bg-rose-50/40")}>
                        <TableCell>
                          <button
                            type="button"
                            aria-label={open ? "Collapse" : "Expand"}
                            onClick={() => setExpanded((x) => ({ ...x, [d.key]: !open }))}
                          >
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium">{d.payer || "—"}</TableCell>
                        <TableCell>{d.kind}</TableCell>
                        <TableCell className="font-mono text-xs">{d.reference || "—"}</TableCell>
                        <TableCell>{fmtDate(d.expectedDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtMoney(d.depositTotal ?? d.claimPaidSum)}
                          {offset && (
                            <span title="Deposit total differs from the claim payments in this group — the ERA likely has other claims or a payer offset (PLB). Match the deposit total.">
                              <TriangleAlert className="ml-1 inline h-3.5 w-3.5 text-amber-600" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{d.claims.length}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.businessDaysWaiting ?? "—"}</TableCell>
                        <TableCell><DepositStatus d={d} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" disabled={!canMark || busy[d.key]} onClick={() => void mark(d, "Yes")}>
                              {busy[d.key] ? <Loader2 className="h-4 w-4 animate-spin" /> : "In bank"}
                            </Button>
                            {d.mismatch ? (
                              <Button size="sm" variant="outline" disabled={!canMark || busy[d.key]} onClick={() => void mark(d, null)}>
                                Clear
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" disabled={!canMark || busy[d.key]} onClick={() => void mark(d, "Mismatch")}>
                                Mismatch
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow>
                          <TableCell />
                          <TableCell colSpan={9} className="bg-muted/30">
                            <div className="mb-2 text-xs text-muted-foreground">
                              {d.originator && <>ORIG ID {d.originator} · </>}
                              Claim payments in this group {fmtMoney(d.claimPaidSum)}
                            </div>
                            <table className="w-full text-sm">
                              <thead className="text-xs text-muted-foreground">
                                <tr>
                                  <th className="py-1 text-left font-medium">Patient</th>
                                  <th className="py-1 text-left font-medium">Board</th>
                                  <th className="py-1 text-left font-medium">Paid date</th>
                                  <th className="py-1 text-left font-medium">Check / trace</th>
                                  <th className="py-1 text-right font-medium">Paid</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.claims.map((c) => (
                                  <tr key={`${c.board}-${c.itemId}`}>
                                    <td className="py-1">{c.patientName}</td>
                                    <td className="py-1 capitalize">{c.board}</td>
                                    <td className="py-1">{fmtDate(c.paidDate)}</td>
                                    <td className="py-1 font-mono text-xs">{c.checkNumber || c.trace || c.stripeCharge || "—"}</td>
                                    <td className="py-1 text-right tabular-nums">{fmtMoney(c.paid)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
