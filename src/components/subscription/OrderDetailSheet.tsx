/**
 * OrderDetailSheet — the "click in" view for a New Order Board row: the Order
 * tab shows the daily-flow fields, this holds the rest (Cardinal fulfilment,
 * tracking, holds, substitutions, the raw line-item detail). Read-only; the
 * board and Cardinal own these values.
 */
import { ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { NewOrderRow } from "@/api/queries/newOrders";
import { orderCategories, orderStatusTone, pillClass, posLabel, preCheckTone } from "@/lib/subscription/orderBoard";

const NEW_ORDER_BOARD = "18405457690";

function fmtDate(iso: string): string {
  const s = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return iso || "—";
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function Pill({ label, tone }: { label: string; tone: Parameters<typeof pillClass>[0] }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1", pillClass(tone))}>{label}</span>;
}
function Field({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  if (!value || !value.trim()) return null;
  return (
    <div className={cn(wide && "col-span-2")}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-[13px] font-medium break-words">{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
    </div>
  );
}

export function OrderDetailSheet({ row, open, onClose }: { row: NewOrderRow | null; open: boolean; onClose: () => void }) {
  if (!row) return null;
  const pos = posLabel(row.pos);
  const cats = orderCategories(row);
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-[18px]">{row.name}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {row.orderStatus && <Pill label={row.orderStatus} tone={orderStatusTone(row.orderStatus)} />}
            {row.preCheck && <Pill label={row.preCheck} tone={preCheckTone(row.preCheck)} />}
            {pos && <Pill label="Office" tone="amber" />}
            {row.ddpOrder && /yes|ddp/i.test(row.ddpOrder) && <Pill label="DDP" tone="purple" />}
          </div>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {row.preCheckDetail && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <span className="font-semibold">Pre-check:</span> {row.preCheckDetail}
            </div>
          )}
          {row.holdReason && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
              <span className="font-semibold">Hold:</span> {row.holdReason}
            </div>
          )}

          <Section title="Order">
            <Field label="Order date" value={fmtDate(row.orderDate)} />
            <Field label="Order type" value={row.orderType} />
            <Field label="Frequency" value={row.orderFrequency} />
            <Field label="Subscription" value={row.subscriptionType} />
            <Field label="Primary insurance" value={row.primaryInsurance} />
            <Field label="Member ID" value={row.memberId} />
            <Field label="POS" value={row.pos} />
            <Field label="DOB" value={row.dob} />
            <Field label="Address" value={row.patientAddress} wide />
          </Section>

          {cats.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Products &amp; auth</div>
              <div className="space-y-2">
                {cats.map((c) => (
                  <div key={c.category} className="rounded-lg border bg-muted/20 px-3 py-2">
                    <div className="text-[12px] font-semibold text-foreground">{c.category}</div>
                    <div className="mt-0.5 text-[13px]">
                      {c.items.length ? c.items.map((i) => `${i.name}${i.qty ? ` ${i.qty}` : ""}`).join(" · ") : <span className="text-muted-foreground">nothing on this order</span>}
                    </div>
                    {c.auths.length > 0 && (
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        {c.auths.map((a) => `${a.label} auth ${a.id}`).join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(row.cahOrderNumber || row.poNumber || row.carrier || row.estShipDate || row.shipDate || row.deliveryDate || row.trackingNumbers.length || row.signedBy || row.lastCardinalSync) && (
            <Section title="Fulfilment">
              <Field label="CAH order #" value={row.cahOrderNumber} />
              <Field label="PO #" value={row.poNumber} />
              <Field label="Carrier" value={row.carrier} />
              <Field label="Est. ship" value={row.estShipDate ? fmtDate(row.estShipDate) : ""} />
              <Field label="Shipped" value={row.shipDate ? fmtDate(row.shipDate) : ""} />
              <Field label="Delivered" value={row.deliveryDate ? fmtDate(row.deliveryDate) : ""} />
              <Field label="Signed by" value={row.signedBy} />
              <Field label="Tracking" value={row.trackingNumbers.join(", ")} wide />
              <Field label="Confirmed address" value={row.confirmedAddress} wide />
              <Field label="Last Cardinal sync" value={row.lastCardinalSync} wide />
            </Section>
          )}

          {(row.apiStatus || row.apiMessage || row.backordered || row.backorderedQty || row.substituteSet || row.substitutionStatus) && (
            <Section title="System">
              <Field label="API status" value={row.apiStatus} />
              <Field label="API message" value={row.apiMessage} wide />
              <Field label="Backordered" value={row.backordered} />
              <Field label="Backordered qty" value={row.backorderedQty} />
              <Field label="Substitute set" value={row.substituteSet} />
              <Field label="Substitution status" value={row.substitutionStatus} />
              <Field label="Substitution CAH" value={row.substitutionCah} />
            </Section>
          )}

          {row.lineItemDetail && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Line item detail</div>
              <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-[12px] leading-relaxed">{row.lineItemDetail}</pre>
            </div>
          )}

          <a href={`https://medicallymodern-force.monday.com/boards/${NEW_ORDER_BOARD}/pulses/${row.id}`} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> Open on Monday
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
