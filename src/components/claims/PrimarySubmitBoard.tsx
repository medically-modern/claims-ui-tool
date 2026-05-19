import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown, Plus, Send, Search, FilePlus2, RefreshCw,
  CalendarIcon, Trash2, ArrowUpDown, X, Hourglass,
} from "lucide-react";
import { useThreadClaims } from "@/lib/claims/threadStore";
import type { ThreadClaim, ThreadClaimType, ThreadItem } from "@/lib/claims/threads";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ThreadPanel, ThreadContextStrip } from "./ThreadPanel";
import { setPlaceOfService } from "@/api/setPlaceOfService";
import { setPrimaryStatus } from "@/api/setPrimaryStatus";
import {
  setClaimParentStatus,
  setClaimParentText,
  setClaimParentDate,
  setClaimSubitemStatus,
  setClaimSubitemDropdown,
  setClaimSubitemText,
  setClaimSubitemNumber,
  CLAIM_PARENT_COL,
  CLAIM_SUBITEM_COL,
  isMondaySubitemId,
} from "@/api/setClaimField";

type QueueKey = "new" | "resubmit" | "awaiting";
type SortKey = "payor" | "dos";

const QUEUE_META: Record<QueueKey, { label: string; icon: React.ReactNode; description: string }> = {
  new:      { label: "New Claims",         icon: <FilePlus2 className="h-4 w-4" />, description: "" },
  resubmit: { label: "Resubmit",           icon: <RefreshCw className="h-4 w-4" />, description: "Auto-generated from denied / underpaid line items. Linked to original claim." },
  // "Awaiting Acceptance" — claims that have been 837'd but the
  // payer's 277 hasn't confirmed "Payer Accepted" yet. Includes
  // Stedi-Accepted, Stedi-Rejected, Payer-Rejected, and no-277-yet
  // states so the operator sees everything in flight, with a badge
  // on each row indicating where it's stuck.
  awaiting: { label: "Awaiting Acceptance", icon: <Hourglass className="h-4 w-4" />, description: "Submitted to the payer (or Stedi) but no 'Payer Accepted' 277 yet. Stays here until the payer acknowledges, then graduates to Outstanding / ERA Review on the main Claims page." },
};

const DIAGNOSIS_OPTIONS = ["E10.65", "E11.9", "E10.9", "E11.65", "E10.40", "E11.40"];
const PAYER_OPTIONS = [
  "Anthem BCBS Co.", "Aetna", "Fidelis Medicaid", "United Healthcare",
  "Cigna", "Humana", "Medicare", "Medicaid",
];
const HCPC_OPTIONS = ["A4230", "A4232", "A4239", "E0784", "E2103"];
// Canonical modifiers we typically pick from. Keep in sync with the
// Modifiers dropdown column (dropdown_mm1z7je9) on the Claims subitems
// board. The dropdown renders the union of these AND any modifiers
// currently active on the row — so ERA-derived modifiers like KF / CG
// that we don't routinely add by hand still appear as toggle-able rows.
// The Monday side accepts label-by-name writes (create_labels_if_missing)
// so unknown modifiers always write successfully.
const MODIFIER_OPTIONS = [
  "KX", "NU", "RR", "RA", "RB", "GA", "GY", "GW", "KF", "CG",
  "KH", "KI", "KJ",
];

interface ProductDefaults {
  product: string;
  hcpcs: string;
  modifiers: string[];
  units: number;
  charge: number;
  estPay: number;
}

const PRODUCT_CATALOG: ProductDefaults[] = [
  { product: "Infusion Sets", hcpcs: "A4230", modifiers: ["KX", "NU"], units: 10, charge: 185.0,  estPay: 142.5 },
  { product: "Cartridges",    hcpcs: "A4232", modifiers: ["KX", "NU"], units: 10, charge: 95.0,   estPay: 72.25 },
  { product: "CGM Sensors",   hcpcs: "A4239", modifiers: ["KX"],       units: 3,  charge: 312.0,  estPay: 248.4 },
  { product: "Insulin Pump",  hcpcs: "E0784", modifiers: ["KX", "NU"], units: 1,  charge: 6500.0, estPay: 5200.0 },
  { product: "CGM Monitor",   hcpcs: "E2103", modifiers: ["KX", "NU"], units: 1,  charge: 850.0,  estPay: 680.0 },
];

const NEUTRAL_TONE = "bg-muted text-foreground";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
}

function productForHcpc(hcpc: string) {
  return PRODUCT_CATALOG.find((p) => p.hcpcs === hcpc)?.product ?? hcpc;
}

export function PrimarySubmitBoard() {
  const { claims, updateClaim, updateItem, addItem, removeItem } = useThreadClaims();
  const [queue, setQueue] = useState<QueueKey>("new");
  const [search, setSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("dos");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Two top-level cohorts the Submit board cares about:
  //   - awaitingSubmit: Primary Status = "Submit Claim" (queues New + Resubmit)
  //   - awaitingAcceptance: Primary Status = "Submitted" AND status277 !=
  //     "Payer Accepted" — claim is in flight to the payer.
  // Rows graduate out of awaitingAcceptance as soon as status277 hits
  // "Payer Accepted"; from there they live on the main Claims page.
  const awaitingSubmit = useMemo(
    () => claims.filter((c) => c.status === "Awaiting Submission"),
    [claims],
  );
  const awaitingAcceptance = useMemo(
    () => claims.filter(
      (c) => c.status === "Submitted" && c.status277 !== "Payer Accepted",
    ),
    [claims],
  );

  const counts = useMemo(() => ({
    new:       awaitingSubmit.filter((c) => !c.parent_claim_id).length,
    resubmit:  awaitingSubmit.filter((c) => !!c.parent_claim_id).length,
    awaiting:  awaitingAcceptance.length,
  }), [awaitingSubmit, awaitingAcceptance]);

  const visible = useMemo(() => {
    const pool =
      queue === "awaiting" ? awaitingAcceptance
      : queue === "new"    ? awaitingSubmit.filter((c) => !c.parent_claim_id)
                           : awaitingSubmit.filter((c) => !!c.parent_claim_id);
    const filtered = pool
      .filter((c) => payerFilter === "all" || c.payer === payerFilter)
      .filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          c.patient.name.toLowerCase().includes(q) ||
          c.payer.toLowerCase().includes(q) ||
          c.patient.member_id.toLowerCase().includes(q) ||
          (c.icn ?? "").toLowerCase().includes(q)
        );
      });
    return [...filtered].sort((a, b) =>
      sortBy === "payor" ? a.payer.localeCompare(b.payer) : a.dos.localeCompare(b.dos),
    );
  }, [awaitingSubmit, awaitingAcceptance, queue, payerFilter, search, sortBy]);

  // Submit: write Primary Status="Submitted" to Monday, which triggers
  // the existing claims_webhook on the backend that calls
  // submit_from_claims_board (build 837 → send to Stedi → write back
  // Claim ID / PCN / Claim Sent Date). We update local state optimistically
  // so the row visually moves out of the "Awaiting Submission" queue;
  // the next refresh will pick up the backend's writebacks.
  const submitOne = async (c: ThreadClaim) => {
    if (!c.monday_item_id) {
      toast({
        title: "Can't submit",
        description: "No Monday item id on this row — local-only claim.",
      });
      return;
    }
    // Optimistic local flip so the row leaves the Submit queue immediately.
    updateClaim(c.id, { status: "Submitted" });
    try {
      await setPrimaryStatus(c.monday_item_id, "Submitted");
      toast({
        title: `Submitted ${c.patient.name}`,
        description:
          `${c.items.length} line item${c.items.length === 1 ? "" : "s"} queued to ${c.payer}. ` +
          `Stedi 837 fires in the background; Claim ID + Sent Date will appear after the response.`,
      });
    } catch (e) {
      // Revert optimistic update on failure.
      updateClaim(c.id, { status: "Awaiting Submission" });
      toast({
        title: "Submit failed",
        description: (e as Error).message,
      });
    }
  };

  const addLine = (claimId: string, product: string) => {
    const cat = PRODUCT_CATALOG.find((p) => p.product === product);
    if (!cat) return;
    const item: ThreadItem = {
      id: `${claimId}-L${Date.now()}`,
      hcpc: cat.hcpcs,
      modifiers: [...cat.modifiers],
      qty: cat.units,
      charge: cat.charge,
      est_pay: cat.estPay,
      status: "Pending",
    };
    addItem(claimId, item);
  };

  return (
    <div className="space-y-4">
      <TooltipProvider delayDuration={150}>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(Object.keys(QUEUE_META) as QueueKey[]).map((k) => {
            const tile = (
              <button
                key={k}
                onClick={() => setQueue(k)}
                className={cn(
                  "w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent",
                  queue === k && "ring-2 ring-primary",
                )}
              >
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {QUEUE_META[k].icon}
                  {QUEUE_META[k].label}
                </div>
                <div className="mt-1 text-2xl font-semibold">{counts[k]}</div>
              </button>
            );
            return QUEUE_META[k].description ? (
              <Tooltip key={k}>
                <TooltipTrigger asChild>{tile}</TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  {QUEUE_META[k].description}
                </TooltipContent>
              </Tooltip>
            ) : (
              <div key={k}>{tile}</div>
            );
          })}
        </section>

        <Card className="flex flex-wrap items-center justify-end gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Patient, payer, claim ID"
                className="h-9 w-64 pl-8"
              />
            </div>
            <Select value={payerFilter} onValueChange={setPayerFilter}>
              <SelectTrigger className="h-9 w-48"><SelectValue placeholder="All payers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All payers</SelectItem>
                {Array.from(new Set(claims.map((c) => c.payer))).sort().map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              <SelectTrigger className="h-9 w-44">
                <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dos">Sort by DOS</SelectItem>
                <SelectItem value="payor">Sort by Primary Payor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <section className="space-y-3">
          {visible.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">Nothing in this queue.</Card>
          )}
          {visible.map((c) => (
            <ClaimCard
              key={c.id}
              c={c}
              isResubmit={!!c.parent_claim_id}
              expanded={!!expanded[c.id]}
              onToggleExpand={() => setExpanded((p) => ({ ...p, [c.id]: !p[c.id] }))}
              onUpdate={(patch) => updateClaim(c.id, patch)}
              onUpdateItem={(iid, patch) => updateItem(c.id, iid, patch)}
              onAddItem={(product) => addLine(c.id, product)}
              onRemoveItem={(iid) => removeItem(c.id, iid)}
              onSubmit={() => submitOne(c)}
            />
          ))}
        </section>
      </TooltipProvider>
    </div>
  );
}

function ClaimCard({
  c, isResubmit, expanded, onToggleExpand, onUpdate, onUpdateItem, onAddItem, onRemoveItem, onSubmit,
}: {
  c: ThreadClaim;
  isResubmit: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (p: Partial<ThreadClaim>) => void;
  onUpdateItem: (iid: string, p: Partial<ThreadItem>) => void;
  onAddItem: (product: string) => void;
  onRemoveItem: (iid: string) => void;
  onSubmit: () => void;
}) {
  const dosDate = c.dos ? new Date(c.dos + "T00:00:00") : undefined;

  // Shared optimistic-write pattern. Updates local state immediately,
  // fires the Monday write in the background, reverts + toasts on
  // failure. Same shape the existing POS handler used — generalised so
  // every cell can follow it.
  const writeWithRevert = (
    promise: Promise<void>,
    revert: () => void,
    label: string,
  ) => {
    promise.catch((e) => {
      revert();
      toast({
        title: `Couldn't save ${label} to Monday`,
        description: (e as Error).message,
      });
    });
  };

  // 9 grid cells: Patient | Payer | Member ID | DOS | Dx | POS | Type | Submit (col-span-2)
  // POS sits between Dx and Type per the operator's preferred read order.
  const gridCols =
    "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.85fr)_32px] gap-3 items-end";
  const cellCls = "min-w-0";

  const usedProducts = c.items.map((i) => productForHcpc(i.hcpc));

  const isLocked = c.status !== "Awaiting Submission";

  return (
    <Card className={cn("overflow-hidden border-l-4", isResubmit ? "border-l-info" : "border-l-rose-300")}>
      {isResubmit && (
        <ThreadContextStrip claim={c} expanded={expanded} onToggle={onToggleExpand} />
      )}
      <div className={cn(gridCols, "border-b bg-muted/30 px-3 py-2")}>
        <Field label="Name" className={cellCls}>
          <Input
            value={c.patient.name}
            onChange={(e) => onUpdate({ patient: { ...c.patient, name: e.target.value } })}
            disabled={isLocked}
            className="h-7 w-full border-0 bg-transparent px-1 text-xs font-semibold focus-visible:bg-background"
          />
        </Field>

        <Field label="Payor" className={cellCls}>
          <Select
            value={c.payer}
            disabled={isLocked}
            onValueChange={(v) => {
              const prev = c.payer;
              onUpdate({ payer: v });
              if (c.monday_item_id) {
                writeWithRevert(
                  setClaimParentStatus(c.monday_item_id, CLAIM_PARENT_COL.primary_payor, v),
                  () => onUpdate({ payer: prev }),
                  "Payor",
                );
              }
            }}
          >
            <SelectTrigger className={cn("h-7 w-full border-0 text-xs font-medium", NEUTRAL_TONE)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from(new Set([...PAYER_OPTIONS, c.payer])).map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Member ID" className={cellCls}>
          <Input
            value={c.patient.member_id}
            disabled={isLocked}
            onChange={(e) => onUpdate({ patient: { ...c.patient, member_id: e.target.value } })}
            // onBlur to avoid hammering Monday on every keystroke. The
            // operator's done editing when focus leaves the cell.
            onBlur={(e) => {
              const next = e.target.value;
              if (!c.monday_item_id) return;
              if (next === c.patient.member_id && next !== "") return;
              const prev = c.patient.member_id;
              writeWithRevert(
                setClaimParentText(c.monday_item_id, CLAIM_PARENT_COL.member_id, next),
                () => onUpdate({ patient: { ...c.patient, member_id: prev } }),
                "Member ID",
              );
            }}
            className="h-7 w-full text-xs md:text-xs"
          />
        </Field>

        <Field label="DOS" className={cellCls}>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={isLocked}
                className="h-7 w-full justify-start px-2 text-xs font-normal"
              >
                <CalendarIcon className="mr-1 h-3 w-3 shrink-0" />
                <span className="truncate">{fmtDate(c.dos) || "Pick date"}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dosDate}
                onSelect={(d) => {
                  const next = d ? d.toISOString().slice(0, 10) : "";
                  const prev = c.dos;
                  onUpdate({ dos: next });
                  if (c.monday_item_id) {
                    writeWithRevert(
                      setClaimParentDate(c.monday_item_id, CLAIM_PARENT_COL.dos, next),
                      () => onUpdate({ dos: prev }),
                      "DOS",
                    );
                  }
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        </Field>

        <Field label="Dx" className={cellCls}>
          <Select
            value={c.diagnosis ?? DIAGNOSIS_OPTIONS[0]}
            disabled={isLocked}
            onValueChange={(v) => {
              const prev = c.diagnosis ?? DIAGNOSIS_OPTIONS[0];
              onUpdate({ diagnosis: v });
              if (c.monday_item_id) {
                writeWithRevert(
                  setClaimParentStatus(c.monday_item_id, CLAIM_PARENT_COL.diagnosis, v),
                  () => onUpdate({ diagnosis: prev }),
                  "Diagnosis",
                );
              }
            }}
          >
            <SelectTrigger className={cn("h-7 w-full border-0 text-xs font-medium", NEUTRAL_TONE)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIAGNOSIS_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        {/* Place of Service — between Dx and Type. Drives CMS-1500 Box 24B /
            837 placeOfServiceCode. Home -> 12 (default for DME shipped to
            patient), Office -> 11 (clinical-setting visit). Writes through
            to Monday immediately so the next submit picks it up. */}
        <Field label="POS" className={cellCls}>
          <Select
            value={c.place_of_service ?? "Home"}
            disabled={isLocked}
            onValueChange={(v) => {
              const next = v as "Home" | "Office";
              // Optimistic local update first so the select snaps to the
              // new value; the Monday write resolves in the background.
              onUpdate({ place_of_service: next });
              if (c.monday_item_id) {
                void setPlaceOfService(c.monday_item_id, next).catch((e) => {
                  // Revert and surface error; the Monday board is the source
                  // of truth and we shouldn't claim a write succeeded if it
                  // didn't.
                  onUpdate({ place_of_service: c.place_of_service ?? "Home" });
                  toast({
                    title: "Couldn't save POS to Monday",
                    description: (e as Error).message,
                  });
                });
              }
            }}
          >
            <SelectTrigger className={cn("h-7 w-full border-0 text-xs font-medium", NEUTRAL_TONE)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Home">Home (12)</SelectItem>
              <SelectItem value="Office">Office (11)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Type" className={cellCls}>
          {isResubmit ? (
            <Select
              value={c.type}
              disabled={isLocked}
              onValueChange={(v) => {
                const prev = c.type;
                const next = v as ThreadClaimType;
                onUpdate({ type: next });
                if (c.monday_item_id) {
                  writeWithRevert(
                    setClaimParentStatus(c.monday_item_id, CLAIM_PARENT_COL.claim_type, next),
                    () => onUpdate({ type: prev }),
                    "Claim Type",
                  );
                }
              }}
            >
              <SelectTrigger className={cn("h-7 w-full border-0 text-xs font-medium", NEUTRAL_TONE)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Original">Original</SelectItem>
                <SelectItem value="Corrected">Corrected</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className={cn("h-7 w-full rounded px-2 text-xs font-medium flex items-center", NEUTRAL_TONE)}>
              Original
            </div>
          )}
        </Field>

        <div className="col-span-2 flex justify-end">
          {c.status === "Submitted" ? (
            <Status277Badge value={c.status277} requestRejected={c.request_rejected} />
          ) : (
            /*
              Live submit. Click → setPrimaryStatus(itemId, "Submitted") on
              Monday → /claims/webhook on the backend fires → 837 to Stedi →
              writeback (Claim ID / PCN / Claim Sent Date). isLocked guards
              against re-clicking after the first submit lands.
            */
            <Button
              size="sm"
              className="h-7 w-full bg-emerald-700 text-white hover:bg-emerald-800"
              disabled={isLocked || c.items.length === 0}
              onClick={() => void onSubmit()}
            >
              <Send className="mr-1 h-3.5 w-3.5" />
              {isLocked ? "Submitted" : "Submit"}
            </Button>
          )}
        </div>
      </div>

      <div className="text-xs">
        <div className={cn(gridCols, "border-b bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground !items-center")}>
          <div>Subitem</div>
          <div>HCPC</div>
          <div>Modifiers</div>
          <div>Auth ID</div>
          <div>Qty</div>
          <div>Charge</div>
          <div>Est Pay</div>
          {/* extra blanks pad to 9 cells so subitem rows align with the
              parent row's 9-column grid (Patient/Payer/MemberID/DOS/Dx/POS/Type/Submit) */}
          <div />
          <div />
        </div>

        {c.items.map((i) => {
          // Only items loaded from Monday have a real (numeric) id. Items
          // added locally via addLine carry a synthetic "<claimId>-L<ts>" id
          // and have no Monday backing yet — skip writes for those.
          const canPersist = isMondaySubitemId(i.id);
          return (
          <div key={i.id} className={cn(gridCols, "border-b px-3 py-1.5 hover:bg-muted/20 !items-center")}>
            <Input
              value={productForHcpc(i.hcpc)}
              onChange={() => { /* product follows hcpc */ }}
              readOnly
              className="h-7 w-full border-0 bg-transparent px-1 text-[11px] font-normal text-muted-foreground focus-visible:bg-background"
            />
            <Select
              value={i.hcpc}
              disabled={isLocked}
              onValueChange={(v) => {
                const prev = i.hcpc;
                onUpdateItem(i.id, { hcpc: v });
                if (canPersist) {
                  writeWithRevert(
                    setClaimSubitemStatus(i.id, CLAIM_SUBITEM_COL.hcpc_code, v),
                    () => onUpdateItem(i.id, { hcpc: prev }),
                    "HCPC",
                  );
                }
              }}
            >
              <SelectTrigger className={cn("h-7 w-full border-0 text-xs font-semibold", NEUTRAL_TONE)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set([...HCPC_OPTIONS, i.hcpc])).map((h) => (
                  <SelectItem key={h} value={h}>{h}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ModifierMultiSelect
              value={i.modifiers}
              disabled={isLocked}
              onChange={(v) => {
                const prev = i.modifiers;
                onUpdateItem(i.id, { modifiers: v });
                if (canPersist) {
                  writeWithRevert(
                    setClaimSubitemDropdown(i.id, CLAIM_SUBITEM_COL.modifiers, v),
                    () => onUpdateItem(i.id, { modifiers: prev }),
                    "Modifiers",
                  );
                }
              }}
            />
            <Input
              className="h-7 w-full text-xs md:text-xs"
              placeholder="—"
              disabled={isLocked}
              // Auth ID isn't tracked in ThreadItem yet, so we can't
              // round-trip an optimistic update. Just blind-write on
              // blur — failures surface in a toast.
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (!canPersist || !next) return;
                writeWithRevert(
                  setClaimSubitemText(i.id, CLAIM_SUBITEM_COL.auth_id, next),
                  () => { /* no local state to revert */ },
                  "Auth ID",
                );
              }}
            />
            <Input
              type="number"
              value={i.qty}
              disabled={isLocked}
              onChange={(e) => onUpdateItem(i.id, { qty: Number(e.target.value) })}
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (!canPersist) return;
                if (next === i.qty) return;
                const prev = i.qty;
                writeWithRevert(
                  setClaimSubitemNumber(i.id, CLAIM_SUBITEM_COL.claim_quantity, next),
                  () => onUpdateItem(i.id, { qty: prev }),
                  "Qty",
                );
              }}
              className="h-7 w-full text-xs md:text-xs"
            />
            <div className="relative w-full">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                value={i.charge}
                disabled={isLocked}
                onChange={(e) => onUpdateItem(i.id, { charge: Number(e.target.value) })}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (!canPersist) return;
                  if (next === i.charge) return;
                  const prev = i.charge;
                  writeWithRevert(
                    setClaimSubitemNumber(i.id, CLAIM_SUBITEM_COL.charge_amount, next),
                    () => onUpdateItem(i.id, { charge: prev }),
                    "Charge",
                  );
                }}
                className="h-7 w-full pl-5 text-xs md:text-xs"
              />
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">${i.est_pay.toFixed(2)}</div>
            {/* extra blank cell — parent grid is 9 wide (POS added between
                Dx and Type); subitem rows pad to match alignment. */}
            <div />
            {isLocked ? (
              <span aria-hidden className="h-6 w-6" />
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => onRemoveItem(i.id)}
                aria-label="Delete subitem"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          );
        })}

        {!isLocked && (
          <div className="px-3 py-1.5">
            <AddSubitemPicker used={usedProducts} onPick={onAddItem} />
          </div>
        )}
      </div>

      {isResubmit && expanded && (
        <ThreadPanel
          currentClaimId={c.id}
          hideCurrent={!isLocked}
          onHide={onToggleExpand}
        />
      )}
    </Card>
  );
}

function Status277Badge({
  value,
  requestRejected,
}: {
  value?: ThreadClaim["status277"];
  requestRejected?: boolean;
}) {
  // Display priority:
  //   1. Request Rejected (primary status) — the 837 never made it
  //      out the door, so 277 doesn't apply yet. Show that first.
  //   2. Status277 from the 277 acknowledgment.
  //   3. "None" — submitted but no 277 received yet (and not Request
  //      Rejected at the Stedi/Primary level either).
  // "Payer Accepted" graduates out of this tab before render — we
  // keep it in the switch only for completeness of the type union.
  const { label, classes } =
    requestRejected           ? { label: "Request Rejected", classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : value === "Payer Accepted"  ? { label: "Payer Accepted",   classes: "bg-emerald-100 text-emerald-800 border-emerald-200" }
    : value === "Stedi Accepted"  ? { label: "Stedi Accepted",   classes: "bg-amber-100 text-amber-800 border-amber-200" }
    : value === "Payer Rejected"  ? { label: "Payer Rejected",   classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : value === "Stedi Rejected"  ? { label: "Stedi Rejected",   classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : { label: "None", classes: "bg-muted text-muted-foreground border-muted-foreground/20" };
  return (
    <span
      className={cn(
        "inline-flex h-7 w-full items-center justify-center rounded-md border px-2 text-xs font-medium",
        classes,
      )}
    >
      {label}
    </span>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function ModifierMultiSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (m: string) =>
    onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);
  const remove = (m: string) => onChange(value.filter((x) => x !== m));
  // Union of canonical options + anything already active on the row that
  // isn't in the canonical list (e.g. KF / CG coming from a Medicare ERA).
  // Without this, those modifiers render as active chips but the dropdown
  // doesn't show them — so the operator can't uncheck them without
  // clicking the × on the chip. Preserves the canonical order, then
  // appends extras in the order they appear on the row.
  const dropdownOptions = [
    ...MODIFIER_OPTIONS,
    ...value.filter((m) => !MODIFIER_OPTIONS.includes(m)),
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-7 min-w-[5rem] flex-wrap items-center gap-1 rounded border border-input bg-background px-1.5 text-xs hover:bg-accent",
            disabled && "cursor-not-allowed opacity-50 hover:bg-background",
          )}
        >
          {value.length === 0 ? (
            <span className="px-1 text-muted-foreground">—</span>
          ) : (
            value.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
              >
                {m}
                {!disabled && (
                  <X
                    className="h-2.5 w-2.5 cursor-pointer opacity-60 hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); remove(m); }}
                  />
                )}
              </span>
            ))
          )}
          <ChevronDown className="ml-auto h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-2">
        <div className="grid gap-1">
          {dropdownOptions.map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
              <Checkbox checked={value.includes(m)} onCheckedChange={() => toggle(m)} />
              <span>{m}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddSubitemPicker({ used, onPick }: { used: string[]; onPick: (product: string) => void }) {
  const [open, setOpen] = useState(false);
  const available = PRODUCT_CATALOG.filter((p) => !used.includes(p.product));
  if (available.length === 0) {
    return <span className="text-xs text-muted-foreground">All products added.</span>;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" /> Add subitem
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="grid gap-0.5">
          {available.map((p) => (
            <button
              key={p.product}
              onClick={() => { onPick(p.product); setOpen(false); }}
              className="flex items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="font-medium">{p.product}</span>
              <span className="text-[10px] text-muted-foreground">{p.hcpcs}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
