/**
 * PatientPage — the patient, full page, ported from the Command Center
 * redesign (Brandon, 2026-09-20). Replaces the side drawer that used to open
 * on a row click, and the readiness-check list it carried.
 *
 *   ┌ top bar: name · DOB · email · phone ─ Profile | Orders | Claims ─ Save ┐
 *   │ main column (the chosen view)                      │ rail: Texts/Calls │
 *   │                                                    │ notes             │
 *
 * Profile edits and the eligibility check are the two things this page
 * writes; Orders and Claims are read-only histories, treated the same way
 * (latest on top, table underneath). Comms and notes sit in the rail on every
 * view, so nothing about the patient is more than a glance away.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, FileText, Loader2, Package, PauseCircle, Pencil, RotateCcw, Save, User, UserX } from "lucide-react";
import { toast } from "sonner";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { runEligibilityCheck, saveSubscriptionPatient } from "@/api/setSubscriptionPatient";
import { Button } from "@/components/ui/button";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { useNewOrders } from "@/hooks/subscription/useNewOrders";
import { ORDER_GROUP_ID } from "@/api/queries/newOrders";
import { fixOrderAddressAndRecheck } from "@/api/setNewOrder";
import { useClaimHistory } from "@/hooks/subscription/useClaimHistory";
import { usePatientFiles } from "@/hooks/subscription/usePatientFiles";
import { ordersForPatient } from "@/lib/subscription/orderHistory";
import { cn } from "@/lib/utils";
import { ClaimHistoryCard } from "../ClaimHistoryCard";
import { BlockDialog, CheckInDialog } from "../SubscriptionBoard";
import { isBlocked, type LanePatient } from "@/lib/subscription/lanes";
import { ProfileView } from "./ProfileView";
import { OrdersView } from "./OrdersView";
import { PatientRail } from "./PatientRail";
import { InactiveDialog } from "./InactiveDialog";
import { lastOrderDay } from "@/lib/comms/sinceOrder";
import { draftFrom, draftPatch, isDirty, type ProfileDraft } from "./draft";
import { usDate } from "./atoms";

export type PatientView = "profile" | "orders" | "claims";

function fmtDob(raw: string): string {
  if (!raw) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : raw;
}

export function PatientPage({ patient, onBack, initialView = "profile" }: {
  patient: LiveSubscriptionPatient;
  onBack: () => void;
  initialView?: PatientView;
}) {
  const p = patient;
  const [view, setView] = useState<PatientView>(initialView);
  // The board's values as of the last read — or, right after a Save, what
  // was just written, so the unsaved banner clears at once instead of
  // waiting for the refetch to echo the same values back.
  const [savedBase, setSavedBase] = useState<ProfileDraft | null>(null);
  const boardBase = useMemo(() => draftFrom(p), [p]);
  const base = savedBase ?? boardBase;
  const [draft, setDraft] = useState<ProfileDraft>(boardBase);
  const [saving, setSaving] = useState(false);
  const [runningElig, setRunningElig] = useState(false);
  const [editPhone, setEditPhone] = useState(false);
  const { invalidate } = useInvalidateSubscription();

  // A fresh board read replaces the draft only when the operator has not
  // started editing — a refetch must never eat a half-typed member ID.
  useEffect(() => {
    setSavedBase(null);
    setDraft((d) => (isDirty(draftFrom(p), d) ? d : draftFrom(p)));
  }, [p]);

  const dirty = isDirty(base, draft);
  const setField = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const orders = useNewOrders();
  const myOrders = useMemo(() => ordersForPatient(orders.data, { name: p.name, dob: p.dob }), [orders.data, p.name, p.dob]);
  // The patient's live row in the Order group, if any — the target for the
  // address-fix → re-check sync on Save (Brandon, 2026-09-20).
  const openOrder = useMemo(() => myOrders.find((o) => o.row.groupId === ORDER_GROUP_ID)?.row ?? null, [myOrders]);
  const firstOrderDate = useMemo(() => {
    const dates = myOrders.map((o) => o.placed).filter(Boolean).sort();
    return dates[0] ?? "";
  }, [myOrders]);
  const claims = useClaimHistory(p.mondayItemId);
  const files = usePatientFiles(p.mondayItemId);
  const mondayUrl = `https://medicallymodern-force.monday.com/boards/18407459988/pulses/${p.mondayItemId}`;

  const save = async () => {
    const patch = draftPatch(base, draft);
    if (!Object.keys(patch).length) { toast.message("Nothing to save."); return; }
    setSaving(true);
    try {
      const r = await saveSubscriptionPatient(p.mondayItemId, patch);
      if (r.failed.length === 0) toast.success(`Saved ${r.ok.length} field${r.ok.length === 1 ? "" : "s"} to Monday`);
      else toast.error(`Saved ${r.ok.length}, ${r.failed.length} failed`, { description: r.failed.map((f) => `${f.field}: ${f.error}`).slice(0, 3).join("\n"), duration: 12_000 });
      // What landed is the new baseline; fields that failed stay dirty.
      const landed = { ...base } as unknown as Record<string, string>;
      const written = draft as unknown as Record<string, string>;
      for (const k of r.ok) landed[k] = written[k];
      setSavedBase({ ...(landed as unknown as ProfileDraft), visitDate: "" });
      setDraft((d) => ({ ...d, visitDate: "" }));
      setEditPhone(false);
      // Address fixed on the profile (Subscription Board) → also push it to the
      // patient's open Order-group row and re-trigger its pre-check: write the
      // address, blank the status, set it back to "Order" (Brandon, 2026-09-20).
      if (r.ok.includes("address") && openOrder) {
        try {
          await fixOrderAddressAndRecheck(openOrder.id, draft.address);
          toast.success("Order address updated — pre-check re-running", { description: `${p.name}'s open order on the Order board` });
        } catch (e) {
          toast.error("Saved to the profile, but couldn't update the order", { description: e instanceof Error ? e.message : String(e) });
        }
      }
      void invalidate();
    } finally {
      setSaving(false);
    }
  };
  const reset = () => { setDraft(base); setEditPhone(false); };

  // Run eligibility: blank → Run on the column, then poll the board every 10s
  // (up to 2 min) until the check lands — the answer shows up here without a
  // manual refresh. "Landed" = Last Eligibility Check or Active? changed.
  const [eligWatch, setEligWatch] = useState<{ check: string; active: string; until: number } | null>(null);
  useEffect(() => {
    if (!eligWatch) return;
    if (p.lastEligibilityCheck !== eligWatch.check || p.active !== eligWatch.active) {
      setEligWatch(null);
      toast.success("Eligibility check landed", { description: `Active status: ${p.active || "—"} · checked ${p.lastEligibilityCheck || "—"}` });
      return;
    }
    if (Date.now() > eligWatch.until) { setEligWatch(null); return; }
    const t = setTimeout(() => void invalidate(), 10_000);
    return () => clearTimeout(t);
  }, [eligWatch, p.lastEligibilityCheck, p.active, invalidate]);

  const runElig = async () => {
    setRunningElig(true);
    try {
      await runEligibilityCheck(p.mondayItemId);
      toast.success("Eligibility check requested", { description: "Run Check is set to Run on Monday — Stedi answers within a minute; this page picks the result up on its own." });
      setEligWatch({ check: p.lastEligibilityCheck, active: p.active, until: Date.now() + 120_000 });
      void invalidate();
    } catch (e) {
      toast.error("Couldn't request the check", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunningElig(false);
    }
  };

  // Pause / block from the profile (Brandon, 2026-09-20): look at what is
  // going on, then pause with a reason and a check-in date. Same dialogs the
  // board uses; a paused patient gets the check-in dialog (contact made /
  // not, unblock, or move to Not Active) instead.
  const lane = p as unknown as LanePatient;
  const blocked = isBlocked(lane);
  const [blockOpen, setBlockOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const onBlockDone = (msg: string) => { toast.success(msg); void invalidate(); };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        {/* ── Header: who (identity + status + patient-level decision), then
            where (tabs). Editing is not up here at all: a save bar appears at
            the bottom only while something is unsaved. ── */}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 pt-4">
            <button type="button" onClick={onBack} className="mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Back to the Order Cycle" aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-[20px] font-bold leading-tight tracking-tight">{p.name}</h1>
                {blocked ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700" title={p.blockNote || undefined}>
                    <PauseCircle className="h-3 w-3" /> Paused{p.pauseReason ? ` · ${p.pauseReason}` : ""}{p.checkInDate ? ` · check in ${usDate(p.checkInDate)}` : ""}
                  </span>
                ) : (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    /not active|dead/i.test(p.rawPatientStatus || "") ? "bg-muted text-muted-foreground" : "bg-emerald-50 text-emerald-800")}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />{p.rawPatientStatus || p.patientStatus || "Active"}
                  </span>
                )}
                {p.firstOrder && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">First order</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                <span title="Date of birth">DOB <b className="font-medium text-foreground">{fmtDob(p.dob) || "—"}</b></span>
                <span aria-hidden>·</span>
                <span>{p.primaryPayer}</span>
                <span aria-hidden>·</span>
                <span>{p.subscriptionType}{p.orderFrequency ? ` · ${p.orderFrequency}` : ""}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  {editPhone
                    ? <input autoFocus value={draft.phone} onChange={(e) => setField("phone", e.target.value)} onBlur={() => setEditPhone(false)} className="w-36 rounded-md border border-input bg-card px-2 py-0.5 text-[12px] text-foreground" aria-label="Phone" />
                    : <b className="font-medium text-foreground">{draft.phone || "no phone"}</b>}
                  <button type="button" onClick={() => { setEditPhone((v) => !v); setView("profile"); }} className="rounded p-0.5 hover:bg-muted hover:text-foreground" title="Edit phone" aria-label="Edit phone"><Pencil className="h-3 w-3" /></button>
                </span>
                {p.email && <><span aria-hidden>·</span><a href={`mailto:${p.email}`} className="max-w-[260px] truncate text-primary hover:underline" title={p.email}>{p.email}</a></>}
              </div>
            </div>
            {/* The one decision that belongs to the whole patient: hold them
                (Pause). Readiness is derived — five green circles and nothing
                unread — so there is no "advance" button; overrides live on
                each circle, reviewing lives on the rail (Brandon, 2026-09-20). */}
            <div className="flex shrink-0 items-center gap-1.5 self-center">
              {blocked ? (
                <>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => setCheckInOpen(true)} title="Log the check-in, unblock, or move to Not Active"><CalendarClock className="h-3.5 w-3.5" /> Check in</Button>
                  <Button variant="ghost" size="sm" className="h-8 text-[12px] text-muted-foreground" onClick={() => setBlockOpen(true)} title="Change the block reason or check-in date">Edit pause</Button>
                </>
              ) : (
                <>
                  {/* Pause is yellow (temporary), Inactive is red (out of the
                      cycle) — Brandon, 2026-09-20. */}
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 border-amber-300 bg-amber-50 text-[12px] text-amber-900 hover:bg-amber-100" onClick={() => setBlockOpen(true)}
                    title="Pause this patient — a reason and a check-in date; the row moves to Paused">
                    <PauseCircle className="h-3.5 w-3.5" /> Pause
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 border-rose-300 bg-rose-50 text-[12px] text-rose-800 hover:bg-rose-100" onClick={() => setInactiveOpen(true)}
                    title="Move this patient to Not Active — out of the Order Cycle until reactivated">
                    <UserX className="h-3.5 w-3.5" /> Inactive
                  </Button>
                </>
              )}
            </div>
          </div>
          <nav className="mt-3 flex gap-1 border-t px-5" aria-label="Patient views">
            {([
              ["profile", "Profile", <User key="u" className="h-3.5 w-3.5" />, null],
              ["claims", "Claims", <FileText key="f" className="h-3.5 w-3.5" />, claims.loading ? "…" : String(claims.claims.length)],
              ["orders", "Orders", <Package key="p" className="h-3.5 w-3.5" />, orders.loading && !orders.data.length ? "…" : String(myOrders.length)],
            ] as const).map(([k, label, icon, n]) => (
              <button key={k} type="button" onClick={() => setView(k)} aria-current={view === k ? "page" : undefined}
                className={cn("-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors",
                  view === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {icon}{label}{n != null && <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", view === k ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{n}</span>}
              </button>
            ))}
          </nav>
        </div>

        {view === "profile" && (
          <>
            <ProfileView p={p} draft={draft} setField={setField} firstOrderDate={firstOrderDate} ordersCount={myOrders.length}
              runningElig={runningElig || !!eligWatch} onRunEligibility={() => void runElig()} mondayUrl={mondayUrl}
              files={files.files} filesLoading={files.loading} />
          </>
        )}

        {view === "orders" && (
          <OrdersView p={p} orders={myOrders} loading={orders.loading} onRefresh={() => void orders.refetch()} />
        )}

        {view === "claims" && (
          <div className="space-y-3">
            <div>
              <h2 className="text-[16px] font-semibold">Claims</h2>
            </div>
            <ClaimHistoryCard mondayItemId={p.mondayItemId} currentPayer={p.primaryPayer} />
          </div>
        )}
      </div>

      <PatientRail p={p} since={lastOrderDay({ orderPlaced: myOrders[0]?.placed, nextOrderDate: p.nextOrderDate, orderFrequency: p.orderFrequency })} />

      {/* The save bar: exists only while something is unsaved, pinned to the
          bottom so it is reachable from any card without scrolling back up.
          Nothing is written to Monday until Save. */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-2.5 shadow-lg">
            <span className="text-[13px]"><b>{Object.keys(draftPatch(base, draft)).length} unsaved change{Object.keys(draftPatch(base, draft)).length === 1 ? "" : "s"}</b><span className="text-muted-foreground"> — not on Monday yet</span></span>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={reset} disabled={saving}><RotateCcw className="h-3.5 w-3.5" /> Discard</Button>
            <Button size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save to Monday
            </Button>
          </div>
        </div>
      )}

      <BlockDialog patient={blockOpen ? lane : null} open={blockOpen} onClose={() => setBlockOpen(false)} onDone={onBlockDone} />
      <CheckInDialog patient={checkInOpen ? lane : null} open={checkInOpen} onClose={() => setCheckInOpen(false)} onDone={onBlockDone} />
      <InactiveDialog patient={inactiveOpen ? p : null} open={inactiveOpen} onClose={() => setInactiveOpen(false)} />
    </div>
  );
}
