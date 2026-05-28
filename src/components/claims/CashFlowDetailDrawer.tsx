// Drill-down drawer for a Cash Flow tile breakdown row. Click any
// "Finalized, not Paid" / "Medicaid (next Thursday)" / "Primary (non-medicaid)" /
// "Pump claims" / etc. on a Cash Flow tile and this drawer slides in
// listing exactly which claims rolled into that bucket — kept
// intentionally minimal: Name, DOS, Pay date, Amount.
//
// Rows are clickable: primaries navigate to ClaimDetail; secondaries
// navigate to their parent primary (the Secondary Board doesn't have
// its own detail page yet, but the parent's ClaimDetail surfaces the
// secondary thread).
//
// Entries are sorted ascending by pay date so the next inflow is at
// the top. Rows with no pay date sort to the bottom.

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { fmtDate, fmtMoney } from "@/lib/claims/logic";
import type { CashFlowEntry } from "@/lib/claims/cashflow";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Short hint under the title (e.g. "ERA in hand, settles within 7 days"). */
  description?: string;
  entries: CashFlowEntry[];
  /** Tile total — shown next to the count in the header so the
   *  drawer agrees with the tile that opened it. */
  total: number;
}

function payDateSortKey(s: string | null): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function CashFlowDetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  entries,
  total,
}: Props) {
  const navigate = useNavigate();

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => payDateSortKey(a.payDate) - payDateSortKey(b.payDate)),
    [entries],
  );

  function go(entry: CashFlowEntry) {
    // Primaries route to their own ClaimDetail. Secondaries route to
    // their parent primary — Secondary Board doesn't have a detail
    // page of its own. The id used here is the Claims Board item id
    // we already store on each entry.
    onOpenChange(false);
    navigate(`/claims/${entry.id}`);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {sorted.length.toLocaleString()} claim{sorted.length === 1 ? "" : "s"}
            <span className="mx-1">·</span>
            <span className="tabular-nums">{fmtMoney(total)}</span>
            {description && (
              <>
                <span className="mx-1">·</span>
                <span>{description}</span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 9rem)" }}>
          {sorted.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No claims in this bucket right now.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2 text-left font-medium">Name</th>
                  <th className="py-1.5 pr-2 text-left font-medium">DOS</th>
                  <th className="py-1.5 pr-2 text-left font-medium">Pay date</th>
                  <th className="py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((e) => (
                  <tr
                    key={`${e.kind}-${e.id}`}
                    onClick={() => go(e)}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/50"
                  >
                    <td className="py-2 pr-2">
                      <div className="font-medium text-foreground">{e.name}</div>
                      {e.kind === "secondary" && (
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Secondary
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                      {fmtDate(e.dos)}
                    </td>
                    <td className="py-2 pr-2 tabular-nums text-muted-foreground">
                      {fmtDate(e.payDate)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium text-foreground">
                      {fmtMoney(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
