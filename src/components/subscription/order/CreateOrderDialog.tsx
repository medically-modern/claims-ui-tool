/**
 * CreateOrderDialog — the "one more box" flow (Brandon, 2026-09-20).
 *
 * Search a patient, and the dialog seeds a new order from their most recent
 * order (same products, insurance, auths, address). Adjust the products if
 * needed, hit Create, and it lands a fresh row in the Order group with the
 * Cardinal / fulfilment columns left blank — the manual "duplicate the last
 * order and clear the right-hand side" step, one dialog.
 */
import { useMemo, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { NewOrderRow } from "@/api/queries/newOrders";
import { createDuplicateOrder, type OrderProducts } from "@/api/setNewOrder";
import {
  CARTRIDGE_TYPES, CGM_TYPES, INFUSION_SET_1_TYPES, INFUSION_SET_2_TYPES, PUMP_TYPES, SUBSCRIPTION_TYPES,
} from "@/lib/subscription/orderProductOptions";

const normNm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const normDb = (v: string) => {
  const s = String(v || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (iso) return iso[1] + iso[2] + iso[3];
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (us) return us[3] + us[1].padStart(2, "0") + us[2].padStart(2, "0");
  return s.replace(/\D/g, "");
};
function productsFromRow(r: NewOrderRow): OrderProducts {
  return {
    cgmType: r.cgmType, qtyCgmSensors: r.qtyCgmSensors, qtyCgmMonitor: r.qtyCgmMonitor,
    pumpType: r.pumpType, qtyPump: r.qtyPump,
    cartridgeType: r.cartridgeType, qtyCartridge: r.qtyCartridge,
    infusionSet1Type: r.infusionSet1Type, qtyInfusionSet1: r.qtyInfusionSet1,
    infusionSet2Type: r.infusionSet2Type, qtyInfusionSet2: r.qtyInfusionSet2,
  };
}
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface PatientEntry { key: string; name: string; dob: string; source: NewOrderRow; count: number }

/** Group all order rows by patient and keep each patient's most recent order. */
function patientsFromRows(rows: NewOrderRow[]): PatientEntry[] {
  const by = new Map<string, PatientEntry>();
  for (const r of rows) {
    if (!r.name.trim()) continue;
    const key = `${normNm(r.name)}|${normDb(r.dob)}`;
    const cur = by.get(key);
    if (!cur) { by.set(key, { key, name: r.name, dob: r.dob, source: r, count: 1 }); continue; }
    cur.count += 1;
    // Newer order date wins as the template (fallback: higher item id).
    const newer = (r.orderDate || "").localeCompare(cur.source.orderDate || "");
    if (newer > 0 || (newer === 0 && r.id.localeCompare(cur.source.id) > 0)) cur.source = r;
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function ProductRow({ label, type, options, onType, qty, onQty, qty2Label, qty2, onQty2 }: {
  label: string; type: string; options: readonly string[]; onType: (v: string) => void;
  qty: string; onQty: (v: string) => void;
  qty2Label?: string; qty2?: string; onQty2?: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_84px] items-start gap-2">
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

export function CreateOrderDialog({ open, onClose, rows, onCreated }: {
  open: boolean; onClose: () => void; rows: NewOrderRow[]; onCreated?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PatientEntry | null>(null);
  const [prod, setProd] = useState<OrderProducts | null>(null);
  const [subType, setSubType] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [creating, setCreating] = useState(false);

  const patients = useMemo(() => patientsFromRows(rows), [rows]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as PatientEntry[];
    return patients.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [patients, query]);

  const reset = () => { setQuery(""); setPicked(null); setProd(null); setSubType(""); setOrderDate(todayIso()); setCreating(false); };
  const close = () => { reset(); onClose(); };
  const pick = (p: PatientEntry) => { setPicked(p); setProd(productsFromRow(p.source)); setSubType(p.source.subscriptionType || ""); setOrderDate(todayIso()); };
  const setField = (k: keyof OrderProducts, v: string) => setProd((p) => (p ? { ...p, [k]: v } : p));

  const create = async () => {
    if (!picked || !prod) return;
    setCreating(true);
    try {
      await createDuplicateOrder(picked.source, { products: prod, orderDateIso: orderDate, subscriptionType: subType, note: "One-off order creation" });
      toast.success(`Order created for ${picked.name}`, { description: "Landed in the Order group — pre-check will run." });
      onCreated?.();
      close();
    } catch (e) {
      toast.error("Couldn't create the order", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };

  const s = picked?.source;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-[18px]">Create new order</SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          {!picked ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a patient by name…" className="pl-9" />
              </div>
              <div className="text-[12px] text-muted-foreground">Pick a patient — the new order copies their most recent order (products, insurance, auths, address). You can adjust the products next.</div>
              <div className="divide-y rounded-lg border">
                {results.length === 0 ? (
                  <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">{query.trim() ? "No patients match." : "Start typing a name."}</div>
                ) : results.map((p) => (
                  <button key={p.key} type="button" onClick={() => pick(p)} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted">
                    <div>
                      <div className="text-[13px] font-semibold">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">{p.dob ? `DOB ${p.dob} · ` : ""}last order {p.source.orderDate || "—"} · {p.count} on board</div>
                    </div>
                    <span className="text-[11px] font-medium text-primary">Use →</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-[14px] font-semibold">{picked.name}</div>
                  <button type="button" onClick={reset} className="text-[12px] font-medium text-primary hover:underline">Change patient</button>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                  {s?.dob && <div>DOB {s.dob}</div>}
                  {s?.subscriptionType && <div>{s.subscriptionType}</div>}
                  {s?.primaryInsurance && <div>{s.primaryInsurance}</div>}
                  {s?.pos && <div>POS {s.pos}</div>}
                </div>
                {s?.patientAddress && <div className="mt-1 text-[12px]">{s.patientAddress}</div>}
                <div className="mt-1 text-[11px] text-muted-foreground">Copied from the order dated {s?.orderDate || "—"} — everything except the products, subscription and date below carries over.</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground">Subscription type</div>
                  <Select value={subType || "—"} onValueChange={(v) => setSubType(v === "—" ? "" : v)}>
                    <SelectTrigger className="mt-0.5 h-9 text-[13px]"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="—" className="text-[13px]">—</SelectItem>
                      {SUBSCRIPTION_TYPES.map((t) => <SelectItem key={t} value={t} className="text-[13px]">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground">Order date</div>
                  <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className="mt-0.5 h-9 text-[13px]" />
                </div>
              </div>

              {prod && (
                <div className="space-y-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Products</div>
                  <ProductRow label="CGM / sensors" type={prod.cgmType} options={CGM_TYPES} onType={(v) => setField("cgmType", v)}
                    qty={prod.qtyCgmSensors} onQty={(v) => setField("qtyCgmSensors", v)}
                    qty2Label="Monitor qty" qty2={prod.qtyCgmMonitor} onQty2={(v) => setField("qtyCgmMonitor", v)} />
                  <ProductRow label="Pump" type={prod.pumpType} options={PUMP_TYPES} onType={(v) => setField("pumpType", v)}
                    qty={prod.qtyPump} onQty={(v) => setField("qtyPump", v)} />
                  <ProductRow label="Cartridge" type={prod.cartridgeType} options={CARTRIDGE_TYPES} onType={(v) => setField("cartridgeType", v)}
                    qty={prod.qtyCartridge} onQty={(v) => setField("qtyCartridge", v)} />
                  <ProductRow label="Infusion set 1" type={prod.infusionSet1Type} options={INFUSION_SET_1_TYPES} onType={(v) => setField("infusionSet1Type", v)}
                    qty={prod.qtyInfusionSet1} onQty={(v) => setField("qtyInfusionSet1", v)} />
                  <ProductRow label="Infusion set 2" type={prod.infusionSet2Type} options={INFUSION_SET_2_TYPES} onType={(v) => setField("infusionSet2Type", v)}
                    qty={prod.qtyInfusionSet2} onQty={(v) => setField("qtyInfusionSet2", v)} />
                  <div className="text-[11px] text-muted-foreground">Only lines with a qty above 0 are added. Set a type to <b>Not Serving</b> to skip it.</div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={close} className="text-[13px]">Cancel</Button>
                <Button onClick={() => void create()} disabled={creating} className={cn("gap-1.5 text-[13px]")}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create order
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
