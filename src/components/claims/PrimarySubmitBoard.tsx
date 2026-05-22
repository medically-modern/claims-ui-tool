import { useEffect, useMemo, useRef, useState } from "react";
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
import { StatusBadge } from "./StatusBadge";
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
  createClaimSubitem,
  deleteClaimSubitem,
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

// Mirrored from Monday Claims Board column color_mky2gpz5 (33 labels).
// Refresh via scripts/refresh-monday-schema.sh after any column edit.
// Monday has a couple of label duplicates (e.g. "E10.649" appears at both
// indices 17 and 106) — we dedupe via Set when rendering. The dropdown
// already includes the row's active value at render time, so a code we
// don't list still appears for the row it's on.
const DIAGNOSIS_OPTIONS = [
  "E08.43",
  "E10.10", "E10.22", "E10.29", "E10.311", "E10.3393", "E10.3559",
  "E10.40", "E10.42", "E10.649", "E10.65", "E10.69", "E10.8", "E10.9",
  "E11.21", "E11.22", "E11.29", "E11.3292", "E11.40", "E11.42",
  "E11.45", "E11.49", "E11.59", "E11.649", "E11.65", "E11.69",
  "E11.8", "E11.9",
  "E13.65", "E13.9",
  "O24.111",
];
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

// Same-family HCPC aliases — different code, same product name. Aetna
// uses A4231 instead of A4230 for infusion sets; Medicare uses A4225
// instead of A4232 for cartridges; Medicare also uses A4224 for the
// infusion-set line. Without these the row's Subitem label falls back
// to the raw HCPC code, which is ugly and inconsistent with how the
// other payer variants render. Keep this in sync with claim_assumptions.
// _INFUSION_HCPCS / _CARTRIDGE_HCPCS sets on the backend.
const HCPC_ALIAS_PRODUCT: Record<string, string> = {
  A4224: "Infusion Set",
  A4231: "Infusion Set",
  A4225: "Cartridges",
};

function productForHcpc(hcpc: string) {
  return (
    HCPC_ALIAS_PRODUCT[hcpc]
    ?? PRODUCT_CATALOG.find((p) => p.hcpcs === hcpc)?.product
    ?? hcpc
  );
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

  // How many of the Awaiting Acceptance rows are actually Payer Rejected
  // (277 came back with category A3 / "returned as unprocessable" — claim
  // never reached adjudication). Surfaced as a small red pill on the
  // Awaiting Acceptance tile so the operator sees rejects at a glance
  // and doesn't have to click in to find them. Same source data the row
  // badges use; just rolled up.
  const payerRejectedCount = useMemo(
    () => awaitingAcceptance.filter((c) => c.status277 === "Payer Rejected").length,
    [awaitingAcceptance],
  );

  // "Stedi Accepted" claims that haven't graduated to "Payer Accepted"
  // (or rejected) within 48h are a second flavor of red flag: Stedi
  // forwarded the 837 fine, but the payer is sitting on it (or never
  // got it). Common causes: routing glitches, payer-side EDI backlog,
  // or rare cases where Stedi's webhook fired Accepted but the payer
  // never replied at all. Surfaced as an amber pill alongside the
  // payer-rejected pill so the operator can chase the slow ones.
  //
  // We use max(claimSentDate, claimResentDate) as the proxy for "when
  // did this submission go out". Stedi typically acks within minutes,
  // so 48h-since-send ≈ 48h-since-Stedi-Accepted. Dates are parsed as
  // YYYY-MM-DD strings (Monday's date columns) and read as UTC midnight,
  // which means the threshold is slightly conservative (a claim sent
  // late in the day will register stale a few hours earlier than its
  // exact 48-hour anniversary — fine for an operator dashboard).
  const staleStediAcceptedCount = useMemo(() => {
    const now = Date.now();
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    return awaitingAcceptance.filter((c) => {
      if (c.status277 !== "Stedi Accepted") return false;
      const sentIso = c.claimResentDate || c.claimSentDate;
      if (!sentIso) return false;
      const sentMs = Date.parse(sentIso);
      if (!Number.isFinite(sentMs)) return false;
      return now - sentMs >= FORTY_EIGHT_HOURS_MS;
    }).length;
  }, [awaitingAcceptance]);

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

  // Add a new subitem to a claim. Two writes happen in parallel:
  //   1. Optimistic local insert with a synthetic id so the row renders
  //      immediately (no spinner waiting on Monday).
  //   2. Monday create_subitem + initial column writes (hcpc, modifiers,
  //      qty, charge, est_pay) so the row exists when the operator hits
  //      Submit. On success, the synthetic id is swapped for the real
  //      Monday id via updateItem so any subsequent cell edits write
  //      through to the right subitem.
  // Failure path: remove the locally-added item + toast. Caller has no
  // stale "added but not persisted" row sitting around.
  const addLine = (claimId: string, product: string) => {
    const cat = PRODUCT_CATALOG.find((p) => p.product === product);
    if (!cat) return;
    const claim = claims.find((c) => c.id === claimId);
    const mondayParentId = claim?.monday_item_id;

    const syntheticId = `${claimId}-L${Date.now()}`;
    const item: ThreadItem = {
      id: syntheticId,
      hcpc: cat.hcpcs,
      modifiers: [...cat.modifiers],
      qty: cat.units,
      charge: cat.charge,
      est_pay: cat.estPay,
      status: "Pending",
    };
    addItem(claimId, item);

    if (!mondayParentId) return;  // local-only claim, nothing to persist

    void createClaimSubitem(mondayParentId, {
      name: cat.product,
      hcpc: cat.hcpcs,
      modifiers: cat.modifiers,
      qty: cat.units,
      charge: cat.charge,
      est_pay: cat.estPay,
    }).then((realId) => {
      // Swap synthetic id for the Monday-assigned id so future cell
      // edits hit the right subitem (isMondaySubitemId guards cell-edit
      // writes against synthetic ids).
      updateItem(claimId, syntheticId, { id: realId });
    }).catch((e) => {
      removeItem(claimId, syntheticId);
      toast({
        title: `Couldn't add ${cat.product} on Monday`,
        description: (e as Error).message,
      });
    });
  };

  // Delete a subitem from a claim. Local removal is immediate; Monday
  // delete fires in the background for real subitems. Synthetic ids
  // (locally-added items whose Monday create failed or hasn't landed
  // yet) just disappear from local state — there's nothing on Monday
  // to delete.
  const handleRemoveItem = (claimId: string, itemId: string) => {
    removeItem(claimId, itemId);
    if (!isMondaySubitemId(itemId)) return;
    void deleteClaimSubitem(itemId).catch((e) => {
      toast({
        title: "Couldn't delete line on Monday",
        description:
          (e as Error).message +
          " — refresh to see the current Monday state.",
      });
    });
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
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-semibold">{counts[k]}</span>
                  {/* On the Awaiting Acceptance tile, surface two roll-ups
                      so the operator sees trouble without clicking in:
                        - red:   payer rejected (277 category A3, rework)
                        - amber: Stedi Accepted >= 48h with no payer reply
                                 yet (payer-side stall — chase or refile).
                      Both hidden when zero so the tile stays clean on
                      healthy days. */}
                  {k === "awaiting" && payerRejectedCount > 0 && (
                    <StatusBadge tone="danger">
                      {payerRejectedCount} payer rejected
                    </StatusBadge>
                  )}
                  {k === "awaiting" && staleStediAcceptedCount > 0 && (
                    <StatusBadge tone="warning">
                      {staleStediAcceptedCount} stale 48h+
                    </StatusBadge>
                  )}
                </div>
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
              onRemoveItem={(iid) => handleRemoveItem(c.id, iid)}
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

  // Debounce text/number cell writes so Monday updates within ~500ms
  // of the last keystroke instead of waiting for blur. Keyed by a
  // string (e.g. "auth-<subitemId>") so concurrent edits on different
  // cells don't trample each other. flushTimer cancels any pending
  // write for the same key — used by blur handlers so leaving the
  // input commits immediately rather than waiting out the debounce.
  const writeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  useEffect(() => {
    // Cleanup on unmount: clear pending timers so we don't fire a
    // write after the component is gone (causes a stale-state warning
    // and serves no purpose).
    const timers = writeTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);
  const scheduleWrite = (key: string, fn: () => void, ms = 500) => {
    const existing = writeTimers.current.get(key);
    if (existing) clearTimeout(existing);
    writeTimers.current.set(
      key,
      setTimeout(() => {
        writeTimers.current.delete(key);
        fn();
      }, ms),
    );
  };
  const flushWrite = (key: string, fn: () => void) => {
    const existing = writeTimers.current.get(key);
    if (existing) clearTimeout(existing);
    writeTimers.current.delete(key);
    fn();
  };

  // Auth ID write helper. Used by both the debounced onChange and the
  // blur flush. Trims the new value, rebuilds the parent concat from
  // all subitems (deduped), and fires the subitem + parent writes in
  // parallel. No revert path — by the time a debounced write resolves,
  // the local state has already moved on, so reverting would only
  // re-introduce the failed value briefly. Failures still surface as
  // a toast via writeWithRevert.
  const writeAuth = (subitem: ThreadItem, rawValue: string) => {
    const trimmed = rawValue.trim();
    const parentConcat = Array.from(
      new Set(
        c.items
          .map((x) => (x.id === subitem.id ? trimmed : (x.auth_id ?? "")))
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ).join(", ");
    const subitemWrite = setClaimSubitemText(
      subitem.id, CLAIM_SUBITEM_COL.auth_id, trimmed,
    );
    const parentWrite = c.monday_item_id
      ? setClaimParentText(
          c.monday_item_id, CLAIM_PARENT_COL.auth, parentConcat,
        )
      : Promise.resolve();
    writeWithRevert(
      Promise.all([subitemWrite, parentWrite]).then(() => {}),
      () => { /* no-op — see comment above */ },
      "Auth ID",
    );
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
            onChange={(e) => {
              const next = e.target.value;
              const prev = c.patient.member_id;
              onUpdate({ patient: { ...c.patient, member_id: next } });
              if (!c.monday_item_id) return;
              scheduleWrite(`member-${c.id}`, () => {
                writeWithRevert(
                  setClaimParentText(
                    c.monday_item_id!, CLAIM_PARENT_COL.member_id, next,
                  ),
                  () => onUpdate({ patient: { ...c.patient, member_id: prev } }),
                  "Member ID",
                );
              });
            }}
            // Blur flushes immediately — covers the click-Submit-right-
            // after-typing case where the debounced timer hasn't fired
            // yet. The scheduleWrite is cancelled inside flushWrite so
            // we don't double-write.
            onBlur={(e) => {
              const next = e.target.value;
              if (!c.monday_item_id) return;
              const prev = c.patient.member_id;
              flushWrite(`member-${c.id}`, () => {
                writeWithRevert(
                  setClaimParentText(
                    c.monday_item_id!, CLAIM_PARENT_COL.member_id, next,
                  ),
                  () => onUpdate({ patient: { ...c.patient, member_id: prev } }),
                  "Member ID",
                );
              });
            }}
            className="h-7 w-full text-xs md:text-xs"
          />
        </Field>

        {/* PR Payor ID — Stedi trading partner ID we send the 837 to.
            Editable inline because spawned children sometimes need a
            different trading partner than the parent (e.g. corrected
            claim is now going to Medicaid instead of Cigna), and the
            backend currently has no UX to fix this between spawn and
            submit. Same debounced autosave pattern as Member ID. */}
        <Field label="PR Payor ID" className={cellCls}>
          <Input
            value={c.payor_id ?? ""}
            placeholder="e.g. ZTXQE"
            disabled={isLocked}
            onChange={(e) => {
              const next = e.target.value;
              const prev = c.payor_id;
              onUpdate({ payor_id: next });
              if (!c.monday_item_id) return;
              scheduleWrite(`payor-${c.id}`, () => {
                writeWithRevert(
                  setClaimParentText(
                    c.monday_item_id!, CLAIM_PARENT_COL.payor_id, next,
                  ),
                  () => onUpdate({ payor_id: prev }),
                  "PR Payor ID",
                );
              });
            }}
            onBlur={(e) => {
              const next = e.target.value;
              if (!c.monday_item_id) return;
              const prev = c.payor_id;
              flushWrite(`payor-${c.id}`, () => {
                writeWithRevert(
                  setClaimParentText(
                    c.monday_item_id!, CLAIM_PARENT_COL.payor_id, next,
                  ),
                  () => onUpdate({ payor_id: prev }),
                  "PR Payor ID",
                );
              });
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
              {Array.from(
                new Set([
                  ...DIAGNOSIS_OPTIONS,
                  // If the row currently carries a code not in the canonical
                  // list (e.g. board added a new label since our last schema
                  // refresh, or a typo'd legacy value), include it so the
                  // operator can still see + keep the existing selection.
                  ...(c.diagnosis ? [c.diagnosis] : []),
                ]),
              ).map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
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
            // Three rejection states all share the same surface: a
            // tooltip-bearing badge showing WHICH leg of the pipeline
            // rejected, plus a refresh-icon button to flip Primary
            // Status back to "Submit Claim" and unlock the row.
            //
            //   - request_rejected=true   → "Request Rejected"
            //   - status277="Stedi Rejected" → "Stedi Rejected"
            //   - status277="Payer Rejected" → "Payer Rejected"
            //
            // Non-rejection states (Submitted-no-277-yet, Stedi Accepted)
            // still show the read-only Status277Badge.
            (c.request_rejected
              || c.status277 === "Stedi Rejected"
              || c.status277 === "Payer Rejected") ? (
              <RejectionCell
                claim={c}
                onMoveToSubmit={() => {
                  if (!c.monday_item_id) return;
                  const prevStatus277 = c.status277;
                  const prevRequestRejected = c.request_rejected;
                  onUpdate({
                    status: "Awaiting Submission",
                    request_rejected: undefined,
                    status277: undefined,
                  });
                  setPrimaryStatus(c.monday_item_id, "Submit Claim").catch((e) => {
                    onUpdate({
                      status: "Submitted",
                      request_rejected: prevRequestRejected,
                      status277: prevStatus277,
                    });
                    toast({
                      title: "Couldn't move row back to Submit Claim",
                      description: (e as Error).message,
                    });
                  });
                }}
              />
            ) : (
              <Status277Badge value={c.status277} requestRejected={false} />
            )
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
              value={i.auth_id ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                onUpdateItem(i.id, { auth_id: next });
                if (!canPersist) return;
                scheduleWrite(`auth-${i.id}`, () => writeAuth(i, next));
              }}
              // Blur flushes any pending debounce immediately so click-
              // Submit-right-after-typing doesn't race the Monday write.
              onBlur={(e) => {
                const next = e.target.value;
                if (!canPersist) return;
                flushWrite(`auth-${i.id}`, () => writeAuth(i, next));
              }}
            />
            <Input
              type="number"
              value={i.qty}
              disabled={isLocked}
              onChange={(e) => {
                const next = Number(e.target.value);
                onUpdateItem(i.id, { qty: next });
                if (!canPersist) return;
                scheduleWrite(`qty-${i.id}`, () => {
                  writeWithRevert(
                    setClaimSubitemNumber(
                      i.id, CLAIM_SUBITEM_COL.claim_quantity, next,
                    ),
                    () => { /* see writeAuth comment */ },
                    "Qty",
                  );
                });
              }}
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (!canPersist) return;
                flushWrite(`qty-${i.id}`, () => {
                  writeWithRevert(
                    setClaimSubitemNumber(
                      i.id, CLAIM_SUBITEM_COL.claim_quantity, next,
                    ),
                    () => {},
                    "Qty",
                  );
                });
              }}
              className="h-7 w-full text-xs md:text-xs"
            />
            <div className="relative w-full">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                value={i.charge}
                disabled={isLocked}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  onUpdateItem(i.id, { charge: next });
                  if (!canPersist) return;
                  scheduleWrite(`charge-${i.id}`, () => {
                    writeWithRevert(
                      setClaimSubitemNumber(
                        i.id, CLAIM_SUBITEM_COL.charge_amount, next,
                      ),
                      () => {},
                      "Charge",
                    );
                  });
                }}
                onBlur={(e) => {
                  const next = Number(e.target.value);
                  if (!canPersist) return;
                  flushWrite(`charge-${i.id}`, () => {
                    writeWithRevert(
                      setClaimSubitemNumber(
                        i.id, CLAIM_SUBITEM_COL.charge_amount, next,
                      ),
                      () => {},
                      "Charge",
                    );
                  });
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

      {/* Action Context disclosure — surfaces the denial-workflow
          notes the operator wrote on ClaimDetail when resolving the
          parent denial, so they remember WHY this corrected claim was
          spawned + what they decided to do, without leaving the page.
          Read-only — to edit, the operator goes to ClaimDetail where
          the autosave is already wired. Only shown on Resubmit rows
          (Original/New rows have no parent to inherit notes from). */}
      {isResubmit && (
        <details className="border-t bg-muted/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
            {c.action_context
              ? "▾ Notes"
              : "▾ Notes (none captured yet)"}
          </summary>
          <div className="mt-2 whitespace-pre-wrap text-sm text-foreground">
            {c.action_context || (
              <span className="text-muted-foreground italic">
                No Action Context on this row. To add or edit notes,
                open ClaimDetail on the parent denial (or this row)
                and use the Action Context textarea — it autosaves.
              </span>
            )}
          </div>
        </details>
      )}

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
  //   3. "Submitted" — Primary Status flipped to Submitted on Monday,
  //      backend posted the 837, but no 277 acknowledgment back yet.
  //      Reads more naturally than "None" because it matches the
  //      lifecycle stage: Submitted → Stedi Accepted → Payer Accepted.
  // "Payer Accepted" graduates out of this tab before render — we
  // keep it in the switch only for completeness of the type union.
  const { label, classes } =
    requestRejected           ? { label: "Request Rejected", classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : value === "Payer Accepted"  ? { label: "Payer Accepted",   classes: "bg-emerald-100 text-emerald-800 border-emerald-200" }
    : value === "Stedi Accepted"  ? { label: "Stedi Accepted",   classes: "bg-amber-100 text-amber-800 border-amber-200" }
    : value === "Payer Rejected"  ? { label: "Payer Rejected",   classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : value === "Stedi Rejected"  ? { label: "Stedi Rejected",   classes: "bg-rose-100 text-rose-800 border-rose-200" }
    : { label: "Submitted", classes: "bg-sky-100 text-sky-800 border-sky-200" };
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

function RejectionCell({
  claim,
  onMoveToSubmit,
}: {
  claim: ThreadClaim;
  onMoveToSubmit: () => void;
}) {
  // Pick the rejection label to display. request_rejected takes
  // precedence — if the 837 never made it to Stedi, the 277 chain
  // never started, so we don't want to show a stale Stedi/Payer
  // status that might still be lingering on the row from a prior
  // submission attempt.
  const label =
    claim.request_rejected               ? "Request Rejected"
    : claim.status277 === "Stedi Rejected" ? "Stedi Rejected"
    : claim.status277 === "Payer Rejected" ? "Payer Rejected"
    : "Rejected";

  return (
    <div className="flex w-full items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          {/*
            Badge surface — shows the rejection type. Wrapped in a
            tooltip so hovering reveals the full rejection_reason
            from Monday (column text_mm1zsp2x). Falls back to a
            "check the Updates tab" hint for rows that were rejected
            before the backend started populating the column.
          */}
          <span
            className={cn(
              "inline-flex h-7 flex-1 cursor-help items-center justify-center rounded-md border px-2 text-xs font-medium",
              "border-rose-200 bg-rose-100 text-rose-800",
            )}
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-sm whitespace-pre-wrap text-xs">
          {claim.rejection_reason ? (
            <>
              <div className="mb-0.5 font-semibold">{label}</div>
              <div>{claim.rejection_reason}</div>
            </>
          ) : (
            <div className="italic text-muted-foreground">
              No reason recorded yet for this rejection — check the
              Updates tab on this row in Monday for details.
            </div>
          )}
        </TooltipContent>
      </Tooltip>
      {/*
        Action button — refresh icon only to keep the cell compact.
        Tooltip clarifies what it does. Click flips Primary Status
        back to "Submit Claim" so the row unlocks and re-appears in
        the New Claims tab for editing + re-submission.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 shrink-0 p-0"
            onClick={onMoveToSubmit}
            aria-label="Move back to Submit Claim"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          Move back to Submit Claim
        </TooltipContent>
      </Tooltip>
    </div>
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
