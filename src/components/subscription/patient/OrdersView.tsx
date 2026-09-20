/**
 * OrdersView — the patient's orders, ported from the Command Center redesign
 * mockup: the upcoming order on top, the selected order as a confirmation-
 * email style card (latest by default), the history table underneath. Click a
 * history row and it loads above. Everything is read from the New Order Board
 * (lib/subscription/orderHistory.ts); nothing here writes.
 */
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Clock, Loader2, Package, RefreshCw, Truck } from "lucide-react";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { cn } from "@/lib/utils";
import { trackerSteps, type OrderView as Order } from "@/lib/subscription/orderHistory";
import { Chip, Eyebrow, Fact, Pill, Section, daysText, daysUntil, trackingUrl, usDate } from "./atoms";
import { reorderState } from "./ProfileView";

function expectedItems(p: LiveSubscriptionPatient): string[] {
  const served = (v: string) => !!v && !/^not serving$/i.test(v);
  const out: string[] = [];
  if (served(p.infusionSet1)) out.push(`${p.infusionSet1Qty || "—"} × ${p.infusionSet1}`);
  if (served(p.infusionSet2)) out.push(`${p.infusionSet2Qty || "—"} × ${p.infusionSet2}`);
  if (p.cartridgeQty && Number(p.cartridgeQty) > 0) out.push(`${p.cartridgeQty} × cartridges`);
  if (served(p.sensorsType) && p.subscriptionType !== "Supplies") out.push(`${p.cgmQty || "—"} × ${p.sensorsType} sensors`);
  return out;
}

export function UpcomingOrder({ p }: { p: LiveSubscriptionPatient }) {
  const dte = daysUntil(p.nextOrderDate);
  const items = expectedItems(p);
  return (
    <Section
      accent
      title={<Eyebrow>Upcoming order</Eyebrow>}
      right={dte != null && dte >= 0 && dte <= 14 ? <Chip tone="amber"><Clock className="h-3 w-3" /> places {dte === 0 ? "today" : `in ${dte} days`}</Chip> : null}
    >
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-[1fr_1fr_1.2fr_1.6fr]">
        <Fact label="Next order">
          {p.nextOrderDate ? <>{usDate(p.nextOrderDate)} <span className={cn("text-[11px] font-normal", dte != null && dte < 0 ? "text-amber-700" : "text-muted-foreground")}>({daysText(dte)})</span></> : ""}
        </Fact>
        <Fact label="Subscription">{p.subscriptionType}{p.orderFrequency && <span className="text-[11px] font-normal text-muted-foreground"> · {p.orderFrequency}</span>}</Fact>
        <Fact label="Expected items">{items.length ? items.map((t) => <div key={t}>{t}</div>) : ""}</Fact>
        <div className="min-w-0">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Reorder form</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">{reorderState(p)}</div>
        </div>
      </div>
    </Section>
  );
}

function ItemRow({ name, qty, kind, right }: { name: string; qty: string; kind?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground"><Package className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">{name}</div>
        <div className="text-[11px] text-muted-foreground">Quantity: {qty || "—"}{kind ? ` · ${kind}` : ""}</div>
      </div>
      {right}
    </div>
  );
}

function OrderCard({ o, shipTo }: { o: Order; shipTo: string }) {
  const total = o.shipments.length + (o.backordered ? 1 : 0);
  const pending = o.backordered;
  const boLines = o.lines.filter((l) => /backorder/i.test(l.status));
  const steps = trackerSteps(o);
  const band = (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-muted/50 px-4 py-3">
      <div><Eyebrow>Order</Eyebrow><b className="font-mono text-[13px]">{o.cah ? `#${o.cah}` : o.ddp ? "DDP" : `#${o.id}`}</b></div>
      <div><Eyebrow>Placed</Eyebrow><b className="text-[13px]">{usDate(o.placed) || "—"}</b></div>
      <div><Eyebrow>Type</Eyebrow><b className="text-[13px]">{o.row.orderType || "—"}<span className="font-normal text-muted-foreground"> · {o.row.subscriptionType || "—"}</span></b></div>
      {o.row.poNumber && <div><Eyebrow>PO</Eyebrow><b className="font-mono text-[11px]">{o.row.poNumber}</b></div>}
      <div className="ml-auto"><Pill tone={o.status.tone}>{o.status.tone === "good" || o.status.tone === "light" ? <Check className="h-3 w-3" /> : o.status.tone === "blue" ? <Truck className="h-3 w-3" /> : null}{o.status.label}</Pill></div>
    </div>
  );

  if (o.ddp) {
    return (
      <div className="space-y-3 rounded-2xl border border-l-4 border-l-emerald-500 bg-card p-4 shadow-sm">
        {band}
        <div className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Ordered via DDP — no history available. Cardinal never handled this order, so there are no shipments, tracking or status to show.</div>
        {o.items.length > 0 && <div className="space-y-2">{o.items.map((i, k) => <ItemRow key={k} name={i.name} qty={i.qty} kind={i.kind} />)}</div>}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3 rounded-2xl border border-l-4 bg-card p-4 shadow-sm", o.complete ? "border-l-emerald-500" : "border-l-amber-400")}>
      {band}
      {o.hold && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{o.hold}</div>}
      {o.row.substitutionStatus && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Substitution: {o.row.substituteSet || "set"} · {o.row.substitutionStatus}{o.row.substitutionCah ? ` · new Cardinal #${o.row.substitutionCah}` : ""}
        </div>
      )}

      <div className="space-y-3">
        {o.shipments.map((s, n) => {
          const url = trackingUrl(s.carrier, s.tracking);
          // What is in this box: the SKU lines Cardinal listed for it, or —
          // when there is only one shipment — everything that was ordered.
          const boxItems = o.shipments.length === 1 && !pending
            ? o.items
            : o.lines.filter((l) => s.skus.includes(l.sku)).map((l) => ({ name: l.sku, qty: l.qty, kind: "Cardinal SKU" }));
          return (
            <div key={s.tracking || n} className={cn("rounded-xl border p-3", s.delivered ? "border-emerald-200 bg-emerald-50/40" : "border-sky-200 bg-sky-50/40")}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
                <b className="text-[13px]">{total > 1 ? `Shipment ${n + 1} of ${total}` : "Shipment"}</b>
                {s.delivered
                  ? <Pill tone="good"><Check className="h-3 w-3" /> Delivered {usDate(s.delivered)}</Pill>
                  : s.shippedOn
                    ? <Pill tone="blue"><Truck className="h-3 w-3" /> In transit · shipped {usDate(s.shippedOn)}</Pill>
                    : <Pill tone="amber"><Clock className="h-3 w-3" /> Ships soon</Pill>}
                <span className="text-muted-foreground">
                  {s.carrier}{s.tracking ? <> · {url ? <a className="text-primary hover:underline" href={url} target="_blank" rel="noopener">{s.tracking}</a> : s.tracking}</> : ""}
                  {s.from ? ` · from ${s.from.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : ""}
                  {o.row.signedBy && s.delivered ? ` · signed ${o.row.signedBy}` : ""}
                </span>
              </div>
              <div className="space-y-2">
                {boxItems.length
                  ? boxItems.map((i, k) => <ItemRow key={k} name={i.name} qty={i.qty} kind={i.kind} />)
                  : <div className="text-[11px] text-muted-foreground">Cardinal didn't list the lines in this shipment.</div>}
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
              <b className="text-[13px]">{o.shipments.length ? `Shipment ${total} of ${total}` : "Not shipped yet"}</b>
              <Pill tone="red"><AlertTriangle className="h-3 w-3" /> Backordered</Pill>
              <span className="text-muted-foreground">
                {o.shipments.length ? "not shipped yet" : ""}
                {o.backorderedQty ? ` · backordered qty ${o.backorderedQty}` : ""}
                {o.row.estShipDate ? ` · Cardinal ETA ${usDate(o.row.estShipDate)}` : ""}
                {o.row.backordered ? ` · ${o.row.backordered}` : ""}
              </span>
            </div>
            <div className="space-y-2">
              {boLines.length
                ? boLines.map((l) => <ItemRow key={l.n} name={l.sku} qty={l.qty} kind="Cardinal SKU · backordered" />)
                : o.items.filter((i) => i.kind === "infusion set").map((i, k) => <ItemRow key={k} name={i.name} qty={i.qty} kind={i.kind} />)}
            </div>
          </div>
        )}
        {!o.shipments.length && !pending && o.items.length > 0 && (
          <div className="space-y-2">{o.items.map((i, k) => <ItemRow key={k} name={i.name} qty={i.qty} kind={i.kind} />)}</div>
        )}
      </div>

      {shipTo && <div className="text-[12px]"><span className="mr-3 text-muted-foreground">Ship to</span>{shipTo}</div>}

      {/* Tracker */}
      <div className="relative mt-2 grid grid-cols-5 gap-2 text-center">
        <div aria-hidden className="absolute left-[10%] right-[10%] top-[14px] h-[2px] bg-border" />
        {steps.map((s) => (
          <div key={s.label} className="relative">
            <div className={cn(
              "relative z-10 mx-auto mb-1.5 grid h-7 w-7 place-items-center rounded-full border-2 bg-card text-muted-foreground",
              s.done && !s.error && (s.partial ? "border-emerald-300 bg-emerald-300 text-white" : "border-emerald-600 bg-emerald-600 text-white"),
              s.error && "border-rose-500 bg-rose-50 text-rose-600",
            )}>
              {s.error ? <AlertTriangle className="h-3.5 w-3.5" /> : s.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
            </div>
            <div className={cn("text-[12px] font-semibold", s.error && "text-rose-700", !s.done && "text-muted-foreground")}>{s.label}</div>
            <div className="text-[10px] text-muted-foreground">{s.sub}</div>
          </div>
        ))}
      </div>
      {o.row.lastCardinalSync && <div className="text-[11px] text-muted-foreground">Last updated {o.row.lastCardinalSync} · Cardinal sync</div>}
    </div>
  );
}

export function OrdersView({ p, orders, loading, onRefresh }: {
  p: LiveSubscriptionPatient; orders: Order[]; loading: boolean; onRefresh: () => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const latest = orders[0] ?? null;
  const sel = orders.find((o) => o.id === selId) ?? latest;
  const isLatest = sel === latest;
  const openCount = orders.filter((o) => !o.complete).length;
  const sub = !sel ? "" : sel.ddp ? "Ordered via DDP — no history available."
    : sel.backordered ? "Part of it is still with Cardinal."
    : sel.complete ? "Complete — nothing to do on it."
    : "Still in progress.";
  const shipTo = sel?.row.confirmedAddress || sel?.row.patientAddress || p.address || "";

  return (
    <div className="space-y-4">
      <UpcomingOrder p={p} />
      {loading && !orders.length ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading orders from the New Order Board…</div>
      ) : !sel ? (
        <Section><b className="text-[13px]">No orders on the order board</b><div className="text-[11px] text-muted-foreground">Nothing on the New Order Board matches this patient by name{p.dob ? " and date of birth" : ""}.</div></Section>
      ) : (
        <>
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">{isLatest ? "Latest order" : `Order #${sel.cah || sel.id}`}{!isLatest && <span className="ml-2 text-[11px] font-normal text-muted-foreground">· placed {usDate(sel.placed)}</span>}</h2>
                <div className="text-[11px] text-muted-foreground">{sub}</div>
              </div>
              <div className="flex items-center gap-2">
                {!isLatest && <button type="button" onClick={() => setSelId(null)} className="inline-flex items-center gap-1 text-[11px] text-sky-800 hover:underline"><ArrowLeft className="h-3 w-3" /> Back to latest</button>}
                {openCount > 1 && <Chip tone="amber">{openCount} orders still open</Chip>}
              </div>
            </div>
            <OrderCard o={sel} shipTo={shipTo} />
          </section>

          <Section className="p-0 px-0 py-0 overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <b className="text-[13px]">Order history</b>
                <div className="text-[11px] text-muted-foreground">{orders.length} order{orders.length === 1 ? "" : "s"} on the New Order Board · newest first · click a row to show it above</div>
              </div>
              <button type="button" onClick={onRefresh} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-bold">Order #</th>
                    <th className="px-3 py-2 text-left font-bold">Created</th>
                    <th className="px-3 py-2 text-left font-bold">Type</th>
                    <th className="px-3 py-2 text-left font-bold">Items</th>
                    <th className="px-3 py-2 text-left font-bold">Status</th>
                    <th className="px-3 py-2 text-left font-bold">Shipped</th>
                    <th className="px-3 py-2 text-left font-bold">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o, i) => (
                    <tr key={o.id} onClick={() => setSelId(o.id)} title="Show this order above"
                        className={cn("cursor-pointer border-t hover:bg-muted/40", sel === o && "bg-sky-50")}>
                      <td className="px-4 py-2.5 font-mono">{o.cah || (o.ddp ? "DDP" : o.id)}{i === 0 && <Chip tone="blue" className="ml-1.5 px-1.5 text-[10px]">latest</Chip>}</td>
                      <td className="px-3 py-2.5 tabular-nums">{usDate(o.placed) || "—"}</td>
                      <td className="px-3 py-2.5">{o.row.orderType || "—"}<div className="text-[11px] text-muted-foreground">{o.row.subscriptionType}</div></td>
                      <td className="px-3 py-2.5">{o.items.length ? o.items.map((it) => `${it.qty} × ${it.name}`).join(", ") : "—"}</td>
                      <td className="px-3 py-2.5"><Pill tone={o.status.tone}>{o.status.label.replace(/ \d+\/\d+\/\d{4}$/, "")}</Pill></td>
                      <td className="px-3 py-2.5 tabular-nums">{o.shipments[0]?.shippedOn ? usDate(o.shipments[0].shippedOn) : "—"}{o.shipments[0]?.tracking && <div className="text-[11px] text-muted-foreground">{o.shipments[0].carrier} · {o.shipments[0].tracking}</div>}</td>
                      <td className="px-3 py-2.5 tabular-nums">{o.row.deliveryDate ? usDate(o.row.deliveryDate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
