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
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", cls)}>{s}</span>;
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
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Receipt className="h-3.5 w-3.5" /> Claim history
        </div>
        <div className="text-[11px] text-muted-foreground">
          {loading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : `${sorted.length} claim${sorted.length === 1 ? "" : "s"}`}
          {open > 0 && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{open} still open</span>}
        </div>
      </div>

      {error && <div className="px-3 py-2 text-[12px] text-rose-700">Couldn't load claims: {error}</div>}

      {/* The banner — runbook step 7, computed. */}
      {!loading && (
        <div className={cn(
          "px-3 py-2 text-[12px] border-b",
          banner.tone === "clear" ? "bg-emerald-50 text-emerald-900"
          : banner.tone === "caution" ? "bg-amber-50 text-amber-900"
          : "bg-slate-50 text-slate-700",
        )}>
          <span className="font-semibold">{banner.headline}</span> {banner.detail}
        </div>
      )}

      {/* The selected claim, latest by default. */}
      {sel && (
        <div className="px-3 py-3 border-b">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[13px] font-semibold">
                {isLatest ? "Latest claim" : `Claim ${sel.payerClaimNumber || sel.claimId}`}
                <span className="ml-2 font-normal text-muted-foreground">DOS {fmtDate(sel.dos)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {sel.primaryPayor || "—"}{sel.payerClaimNumber ? ` · #${sel.payerClaimNumber}` : ""}{sel.secondaryPayer ? ` · secondary ${sel.secondaryPayer}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusPill(sel)}
              {!isLatest && (
                <button type="button" onClick={() => setSelId(null)} className="inline-flex items-center gap-1 text-[11px] text-sky-800 hover:underline">
                  <ArrowLeft className="h-3 w-3" /> Back to latest
                </button>
              )}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-4 gap-2 text-[12px]">
            <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Billed</div><div className="tabular-nums font-medium">{fmtMoney(sel.lines.reduce((s, l) => s + l.charge, 0))}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Primary paid</div><div className="tabular-nums font-medium">{fmtMoney(sel.primaryPaid)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Patient owed</div><div className={cn("tabular-nums font-medium", sel.prAmount > 0 && "text-amber-800")}>{fmtMoney(sel.prAmount)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-muted-foreground">Paid on</div><div className="tabular-nums font-medium">{fmtDate(sel.primaryPaidDate)}</div></div>
          </div>

          {sel.lines.length > 0 && (
            <table className="mt-2 w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr><th className="text-left font-medium py-1">Product</th><th className="text-right font-medium">Units</th><th className="text-right font-medium">Billed</th><th className="text-right font-medium">Paid</th><th className="text-right font-medium">Owed</th><th className="text-right font-medium">Line</th></tr>
              </thead>
              <tbody>
                {sel.lines.map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1">{l.product || l.hcpcs}{l.product && l.hcpcs ? <span className="ml-1 text-muted-foreground">{l.hcpcs}</span> : null}</td>
                    <td className="text-right tabular-nums">{l.units || "—"}</td>
                    <td className="text-right tabular-nums">{fmtMoney(l.charge)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(l.primaryPaid)}</td>
                    <td className={cn("text-right tabular-nums", l.prAmount > 0 && "text-amber-800")}>{fmtMoney(l.prAmount)}</td>
                    <td className="text-right">{lineStatus(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* The history table — click a row to load it above. */}
      {sorted.length > 1 && (
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="text-left font-medium px-3 py-1.5">DOS</th><th className="text-left font-medium">Payer</th><th className="text-left font-medium">Products</th><th className="text-right font-medium">Paid</th><th className="text-right font-medium">Owed</th><th className="text-right font-medium pr-3">Status</th></tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.mondayItemId}
                  onClick={() => setSelId(c.mondayItemId)}
                  className={cn("border-t cursor-pointer hover:bg-muted/40", sel === c && "bg-sky-50")}
                  title="Show this claim above">
                <td className="px-3 py-1.5 tabular-nums">{fmtDate(c.dos)}</td>
                <td className="truncate max-w-[140px]">{c.primaryPayor || "—"}</td>
                <td className="truncate max-w-[180px] text-muted-foreground">{productsOf(c)}</td>
                <td className="text-right tabular-nums">{fmtMoney(c.primaryPaid)}</td>
                <td className={cn("text-right tabular-nums", c.prAmount > 0 && "text-amber-800")}>{fmtMoney(c.prAmount)}</td>
                <td className="text-right pr-3">{statusPill(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="px-3 py-3 text-[12px] text-muted-foreground">No claims linked to this patient on the Claims Board.</div>
      )}
    </Card>
  );
}
