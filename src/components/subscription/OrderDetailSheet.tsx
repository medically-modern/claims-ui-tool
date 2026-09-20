/**
 * OrderDetailSheet — the "click in" view for a New Order Board row. Patient-level
 * facts live on the full profile (opened from the patient name); this panel is
 * for the order-board-specific fields and the edits that belong to THIS order:
 * POS (Office/Home), DDP, and — rarely — the product types/quantities. The rest
 * (Cardinal fulfilment, tracking, holds, substitutions) stays read-only; the
 * board and Cardinal own those.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { NewOrderRow } from "@/api/queries/newOrders";
import { orderCategories, orderStatusTone, pillClass, posLabel, preCheckTone } from "@/lib/subscription/orderBoard";
import {
  setOrderPos, setOrderDdp, updateOrderProducts, type OrderProducts,
} from "@/api/setNewOrder";
import {
  CARTRIDGE_TYPES, CGM_TYPES, INFUSION_SET_1_TYPES, INFUSION_SET_2_TYPES, PUMP_TYPES,
} from "@/lib/subscription/orderProductOptions";

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

function productsFromRow(r: NewOrderRow): OrderProducts {
  return {
    cgmType: r.cgmType, qtyCgmSensors: r.qtyCgmSensors, qtyCgmMonitor: r.qtyCgmMonitor,
    pumpType: r.pumpType, qtyPump: r.qtyPump,
    cartridgeType: r.cartridgeType, qtyCartridge: r.qtyCartridge,
    infusionSet1Type: r.infusionSet1Type, qtyInfusionSet1: r.qtyInfusionSet1,
    infusionSet2Type: r.infusionSet2Type, qtyInfusionSet2: r.qtyInfusionSet2,
  };
}

/** One editable product line: a type dropdown + one or two qty inputs. */
function ProductRow({ label, type, options, onType, qty, onQty, qty2Label, qty2, onQty2 }: {
  label: string; type: string; options: readonly string[]; onType: (v: string) => void;
  qty: string; onQty: (v: string) => void;
  qty2Label?: string; qty2?: string; onQty2?: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_84px] items-center gap-2">
      <div>
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <Select value={type || "Not Serving"} onValueChange={onType}>
          <SelectTrigger className="mt-0.5 h-8 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>{options.map((o) => <SelectItem key={o} value={o} className="text-[12px]">{o}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <div className="text-[11px] font-medium text-muted-foreground">Qty</div>
        <Input type="number" min={0} value={qty} onChange={(e) => onQty(e.target.value)} className="mt-0.5 h-8 text-[12px]" />
      </div>
      {qty2Label && onQty2 && (
        <div className="col-start-2">
          <div className="text-[11px] font-medium text-muted-foreground">{qty2Label}</div>
          <Input type="number" min={0} value={qty2 ?? ""} onChange={(e) => onQty2(e.target.value)} className="mt-0.5 h-8 text-[12px]" />
        </div>
      )}
    </div>
  );
}

export function OrderDetailSheet({ row, open, onClose, onChanged }: {
  row: NewOrderRow | null; open: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const [pos, setPos] = useState("");
  const [ddp, setDdp] = useState(false);
  const [savingPos, setSavingPos] = useState<"Office" | "Home" | null>(null);
  const [savingDdp, setSavingDdp] = useState(false);
  const [editProducts, setEditProducts] = useState(false);
  const [prod, setProd] = useState<OrderProducts>(() => productsFromRow(row ?? ({} as NewOrderRow)));
  const [savingProd, setSavingProd] = useState(false);
  const seedId = useRef<string | null>(null);

  useEffect(() => {
    if (!row) return;
    if (seedId.current === row.id) return;
    seedId.current = row.id;
    setPos(row.pos || "");
    setDdp(/ddp/i.test(row.ddpOrder));
    setProd(productsFromRow(row));
    setEditProducts(false);
  }, [row]);

  if (!row) return null;
  const cats = orderCategories(row);
  const setProdField = (k: keyof OrderProducts, v: string) => setProd((p) => ({ ...p, [k]: v }));

  const changePos = async (next: "Office" | "Home") => {
    if (next === pos || savingPos) return;
    setSavingPos(next);
    try { await setOrderPos(row.id, next); setPos(next); toast.success(`POS set to ${next}`); onChanged?.(); }
    catch (e) { toast.error("Couldn't change POS", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setSavingPos(null); }
  };
  const toggleDdp = async () => {
    const next = !ddp;
    setSavingDdp(true);
    try { await setOrderDdp(row.id, next); setDdp(next); toast.success(next ? "Marked DDP — pressing Order will set Process Claim" : "DDP removed"); onChanged?.(); }
    catch (e) { toast.error("Couldn't change DDP", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setSavingDdp(false); }
  };
  const saveProducts = async () => {
    setSavingProd(true);
    try { await updateOrderProducts(row.id, prod); toast.success("Products updated"); setEditProducts(false); onChanged?.(); }
    catch (e) { toast.error("Couldn't update products", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setSavingProd(false); }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-[18px]">{row.name}</SheetTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {row.orderStatus && <Pill label={row.orderStatus} tone={orderStatusTone(row.orderStatus)} />}
            {row.preCheck && <Pill label={row.preCheck} tone={preCheckTone(row.preCheck)} />}
            {posLabel(pos) && <Pill label="Office" tone="amber" />}
            {row.shipMethod && <Pill label={row.shipMethod} tone="slate" />}
            {ddp && <Pill label="DDP" tone="purple" />}
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

          {/* ── Order-board-specific edits (Brandon, 2026-09-20) ── */}
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Order settings</div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">POS</span>
                <div className="inline-flex rounded-md border bg-card p-0.5">
                  {(["Office", "Home"] as const).map((v) => (
                    <button key={v} type="button" disabled={!!savingPos} onClick={() => void changePos(v)}
                      className={cn("inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] font-semibold transition-colors",
                        pos === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
                      {savingPos === v && <Loader2 className="h-3 w-3 animate-spin" />}{v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">DDP</span>
                <Button size="sm" variant={ddp ? "default" : "outline"} disabled={savingDdp} onClick={() => void toggleDdp()}
                  className={cn("h-8 gap-1.5 text-[12px]", ddp && "bg-violet-600 hover:bg-violet-700")}
                  title="DDP orders go out manually; pressing Order sets Process Claim, not Ordered">
                  {savingDdp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
                  {ddp ? "DDP — on" : "Send via DDP"}
                </Button>
              </div>
            </div>
            {ddp && <div className="text-[11px] text-violet-800">Pressing <b>Order</b> on this row will set <b>Process Claim</b> (submit manually through DDP).</div>}
          </div>

          <Section title="Order">
            <Field label="Order date" value={fmtDate(row.orderDate)} />
            <Field label="Order type" value={row.orderType} />
            <Field label="Frequency" value={row.orderFrequency} />
            <Field label="Subscription" value={row.subscriptionType} />
            <Field label="Primary insurance" value={row.primaryInsurance} />
            <Field label="Member ID" value={row.memberId} />
            <Field label="DOB" value={row.dob} />
            <Field label="Address" value={row.patientAddress} wide />
          </Section>

          {/* Products — read-only summary, with an inline editor for the rare edit. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Products &amp; auth</div>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setEditProducts((v) => !v)}>
                {editProducts ? "Cancel" : "Edit products"}
              </Button>
            </div>

            {!editProducts ? (
              <div className="space-y-2">
                {cats.length > 0 ? cats.map((c) => {
                  const single = c.category === "Pump" || c.category === "Monitor";
                  const line = c.items.map((i) => `${i.name}${i.qty ? ` ${i.qty}` : ""}`).join(" · ");
                  return (
                    <div key={c.category} className="rounded-lg border bg-muted/20 px-3 py-2">
                      <div className="text-[12px] font-semibold text-foreground">{c.category}</div>
                      <div className="mt-0.5 text-[13px]">{line || <span className="text-muted-foreground">{single ? `${c.category} only` : "nothing on this order"}</span>}</div>
                      {c.auths.length > 0 && <div className="mt-1 text-[12px] text-muted-foreground">Auth on file: {c.auths.map((a) => a.label).join(", ")}</div>}
                    </div>
                  );
                }) : <div className="text-[13px] text-muted-foreground">No products on this order.</div>}
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border bg-card p-3">
                <ProductRow label="CGM / sensors" type={prod.cgmType} options={CGM_TYPES} onType={(v) => setProdField("cgmType", v)}
                  qty={prod.qtyCgmSensors} onQty={(v) => setProdField("qtyCgmSensors", v)}
                  qty2Label="Monitor qty" qty2={prod.qtyCgmMonitor} onQty2={(v) => setProdField("qtyCgmMonitor", v)} />
                <ProductRow label="Pump" type={prod.pumpType} options={PUMP_TYPES} onType={(v) => setProdField("pumpType", v)}
                  qty={prod.qtyPump} onQty={(v) => setProdField("qtyPump", v)} />
                <ProductRow label="Cartridge" type={prod.cartridgeType} options={CARTRIDGE_TYPES} onType={(v) => setProdField("cartridgeType", v)}
                  qty={prod.qtyCartridge} onQty={(v) => setProdField("qtyCartridge", v)} />
                <ProductRow label="Infusion set 1" type={prod.infusionSet1Type} options={INFUSION_SET_1_TYPES} onType={(v) => setProdField("infusionSet1Type", v)}
                  qty={prod.qtyInfusionSet1} onQty={(v) => setProdField("qtyInfusionSet1", v)} />
                <ProductRow label="Infusion set 2" type={prod.infusionSet2Type} options={INFUSION_SET_2_TYPES} onType={(v) => setProdField("infusionSet2Type", v)}
                  qty={prod.qtyInfusionSet2} onQty={(v) => setProdField("qtyInfusionSet2", v)} />
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => { setProd(productsFromRow(row)); setEditProducts(false); }}>Cancel</Button>
                  <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={savingProd} onClick={() => void saveProducts()}>
                    {savingProd && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save products
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">Set a type to <b>Not Serving</b> and qty to <b>0</b> to drop a line.</div>
              </div>
            )}
          </div>

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
