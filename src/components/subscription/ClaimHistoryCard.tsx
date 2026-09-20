/**
 * ClaimHistoryCard — the profile's claim history, built the way the Command
 * Center mockup builds order history (Brandon, 2026-09-20): a banner about
 * what it means for tonight, the selected claim in full underneath (latest by
 * default), and the history table below. Click a row and it loads above,
 * with a "Back to latest" link.
 *
 * Replaces "order history" in the profile because for ordering the question
 * is not what shipped, it is what got PAID — how much, for which products,
 * whether primary and secondary paid, and whether the plan is still the one
 * that paid. All of it comes from the Claims Board via the Subscription Item
 * ID join; nothing is estimated here.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/claims/logic";
import type { Claim, ServiceLine } from "@/lib/claims/types";
import { lastClaimBanner, newestFirst } from "@/lib/subscription/claimHistory";
import { todayIso } from "@/lib/subscription/lanes";
import { useClaimHistory } from "@/hooks/subscription/useClaimHistory";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusPill(c: Claim) {
  const s = c.primaryStatus;
  const cls =
    s === "Paid" ? "bg-emerald-100 text-emerald-800"
    : s === "Denied" ? "bg-rose-100 text-rose-800"
    : "bg-slate-100 text-slate-700";
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold", cls)}>{s}</span>;
}

function productsOf(c: Claim): string {
  const names = c.lines.map((l) => l.product || l.hcpcs).filter(Boolean);
  return names.length ? Array.from(new Set(names)).join(", ") : "—";
}

function lineStatus(l: ServiceLine): string {
  if (l.operatorLineStatus) return l.operatorLineStatus;
  if (l.primaryPaid > 0) return l.primaryPaid + 0.005 >= l.allowed ? "Paid" : "Underpaid";
  return l.adjustmentReasons?.length ? `Denied · ${l.adjustmentReasons[0]}` : "—";
}

export function ClaimHistoryCard({ mondayItemId, currentPayer }: { mondayItemId: string; currentPayer: string }) {
  const { claims, loading, error } = useClaimHistory(mondayItemId);
  const sorted = useMemo(() => newestFirst(claims), [claims]);
  const [selId, setSelId] = useState<string | null>(null);
  const latest = sorted[0] ?? null;
  const sel = sorted.find((c) => c.mondayItemId === selId) ?? latest;
  const isLatest = sel === latest;
  const banner = useMemo(() => lastClaimBanner(claims, currentPayer, todayIso()), [claims, currentPayer]);
  const open = sorted.filter((c) => c.primaryStatus !== "Paid" && c.primaryStatus !== "Denied").length;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Receipt className="h-3.5 w-3.5" /> Claim history
        </div>
        <div className="text-[12px] text-muted-foreground">
          {loading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : `${sorted.length} claim${sorted.length === 1 ? "" : "s"}`}
          {open > 0 && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{open} still open</span>}
        </div>
      </div>

      {error && <div className="px-3 py-2 text-[12px] text-rose-700">Couldn't load claims: {error}</div>}

      {/* The banner — runbook step 7, computed. */}
      {!loading && (
        <div className={cn(
          "px-4 py-2 text-[13px] border-b",
          banner.tone === "clear" ? "bg-emerald-50 text-emerald-900"
          : banner.tone === "caution" ? "bg-amber-50 text-amber-900"
          : "bg-slate-50 text-slate-700",
        )}>
          <span className="font-semibold">{banner.headline}</span> {banner.detail}
        </div>
      )}

      {/* The selected claim, latest by default. One line of identity, then the
          money as a formula — Paid of Billed, drawn as a bar, with what the
          patient owed as its own segment (Brandon, 2026-09-20). */}
      {sel && (() => {
        const billed = sel.lines.reduce((s, l) => s + l.charge, 0);
        const paid = sel.primaryPaid;
        const owed = sel.prAmount;
        const pct = (n: number) => (billed > 0 ? Math.max(0, Math.min(100, (n / billed) * 100)) : 0);
        const paidPct = pct(paid), owedPct = pct(owed);
        const linePaidKnown = sel.lines.some((l) => l.primaryPaid > 0 || l.prAmount > 0);
        return (
          <div className="px-4 py-3 border-b">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="text-[15px] font-semibold">{isLatest ? "Latest claim" : `Claim ${sel.payerClaimNumber || sel.claimId}`}</div>
              <div className="text-[13px] text-muted-foreground">
                DOS {fmtDate(sel.dos)} · {sel.primaryPayor || "—"}{sel.secondaryPayer ? ` · secondary ${sel.secondaryPayer}` : ""}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {statusPill(sel)}
                {!isLatest && (
                  <button type="button" onClick={() => setSelId(null)} className="inline-flex items-center gap-1 text-[12px] text-sky-800 hover:underline">
                    <ArrowLeft className="h-3 w-3" /> Back to latest
                  </button>
                )}
              </div>
            </div>

            {/* Paid $564.30 of Billed $564.30 — the bar underneath is the same
                sentence drawn: green = paid, amber = patient owed, gray = the rest. */}
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[14px]">
              <span className="text-muted-foreground">Paid</span>
              <span className="text-[18px] font-semibold tabular-nums text-emerald-800">{fmtMoney(paid)}</span>
              <span className="text-muted-foreground">of billed</span>
              <span className="text-[18px] font-semibold tabular-nums">{fmtMoney(billed)}</span>
              <span className="tabular-nums text-muted-foreground">({billed > 0 ? `${Math.round(paidPct)}%` : "—"})</span>
              <span className="ml-auto text-[13px] text-muted-foreground">Paid on <span className="font-medium text-foreground">{fmtDate(sel.primaryPaidDate)}</span></span>
            </div>
            <div className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full bg-slate-200" role="img"
              aria-label={`Paid ${Math.round(paidPct)}% of billed; patient owed ${fmtMoney(owed)}`}>
              <div className="h-full bg-emerald-600" style={{ width: `${paidPct}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${owedPct}%` }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 text-[12px]">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Payer paid {fmtMoney(paid)}</span>
              <span className={cn("inline-flex items-center gap-1.5", owed > 0 && "font-semibold text-amber-800")}><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Patient owed {fmtMoney(owed)}</span>
              {billed - paid - owed > 0.005 && <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> Not paid {fmtMoney(billed - paid - owed)}</span>}
            </div>

            {sel.lines.length > 0 && (
              <table className="mt-3 w-full text-[13px]">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium py-1.5">Product</th>
                    <th className="text-right font-medium">Units</th>
                    <th className="text-right font-medium">Billed</th>
                    {linePaidKnown && <><th className="text-right font-medium">Paid</th><th className="text-right font-medium">Owed</th><th className="text-right font-medium">Line</th></>}
                  </tr>
                </thead>
                <tbody>
                  {sel.lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5">{l.product || l.hcpcs}{l.product && l.hcpcs ? <span className="ml-1.5 text-muted-foreground">{l.hcpcs}</span> : null}</td>
                      <td className="text-right tabular-nums">{l.units || "—"}</td>
                      <td className="text-right tabular-nums">{fmtMoney(l.charge)}</td>
                      {linePaidKnown && <>
                        <td className="text-right tabular-nums">{fmtMoney(l.primaryPaid)}</td>
                        <td className={cn("text-right tabular-nums", l.prAmount > 0 && "text-amber-800")}>{fmtMoney(l.prAmount)}</td>
                        <td className="text-right">{lineStatus(l)}</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* The history table — click a row to load it above. */}
      {sorted.length > 1 && (
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="text-left font-medium px-4 py-2">DOS</th><th className="text-left font-medium">Payer</th><th className="text-left font-medium">Products</th><th className="text-right font-medium">Paid</th><th className="text-right font-medium">Owed</th><th className="text-right font-medium pr-4">Status</th></tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.mondayItemId}
                  onClick={() => setSelId(c.mondayItemId)}
                  className={cn("border-t cursor-pointer hover:bg-muted/40", sel === c && "bg-sky-50")}
                  title="Show this claim above">
                <td className="px-4 py-2 tabular-nums">{fmtDate(c.dos)}</td>
                <td className="truncate max-w-[160px]">{c.primaryPayor || "—"}</td>
                <td className="truncate max-w-[220px] text-muted-foreground">{productsOf(c)}</td>
                <td className="text-right tabular-nums">{fmtMoney(c.primaryPaid)}</td>
                <td className={cn("text-right tabular-nums", c.prAmount > 0 && "text-amber-800")}>{fmtMoney(c.prAmount)}</td>
                <td className="text-right pr-4">{statusPill(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="px-4 py-3 text-[13px] text-muted-foreground">No claims linked to this patient on the Claims Board.</div>
      )}
    </Card>
  );
}
