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
import { ArrowLeft, FileText, Loader2, Package, Pencil, RotateCcw, Save, User } from "lucide-react";
import { toast } from "sonner";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { runEligibilityCheck, saveSubscriptionPatient } from "@/api/setSubscriptionPatient";
import { Button } from "@/components/ui/button";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { useNewOrders } from "@/hooks/subscription/useNewOrders";
import { useClaimHistory } from "@/hooks/subscription/useClaimHistory";
import { usePatientFiles } from "@/hooks/subscription/usePatientFiles";
import { ordersForPatient } from "@/lib/subscription/orderHistory";
import { cn } from "@/lib/utils";
import { ClaimHistoryCard } from "../ClaimHistoryCard";
import { ProfileView } from "./ProfileView";
import { OrdersView } from "./OrdersView";
import { PatientRail, noteLines } from "./PatientRail";
import { draftFrom, draftPatch, isDirty, type ProfileDraft } from "./draft";
import { Section, usDate } from "./atoms";

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

  const notes = noteLines(p.coordinatorNotes);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        {/* ── Top bar ── */}
        <div className="rounded-2xl border bg-card px-5 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground" title="Back to the board">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div><div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Patient name</div><div className="text-[18px] font-bold leading-tight">{p.name}</div></div>
            <div><div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">DOB</div><div className="text-[13px] font-semibold">{fmtDob(p.dob) || "—"}</div></div>
            <div><div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Email</div><div className="text-[13px]">{p.email ? <a href={`mailto:${p.email}`} className="text-primary hover:underline">{p.email}</a> : "—"}</div></div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Phone</div>
              <div className="flex items-center gap-1.5">
                {editPhone
                  ? <input autoFocus value={draft.phone} onChange={(e) => setField("phone", e.target.value)} className="w-40 rounded-md border border-input bg-card px-2 py-0.5 text-[13px]" aria-label="Phone" />
                  : <b className="text-[15px] text-primary">{draft.phone || "—"}</b>}
                <button type="button" onClick={() => { setEditPhone((v) => !v); setView("profile"); }} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Edit phone"><Pencil className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="inline-flex rounded-xl bg-muted p-[3px]">
                {([
                  ["profile", "Profile", <User key="u" className="h-3.5 w-3.5" />, null],
                  ["orders", "Orders", <Package key="p" className="h-3.5 w-3.5" />, orders.loading && !orders.data.length ? "…" : String(myOrders.length)],
                  ["claims", "Claims", <FileText key="f" className="h-3.5 w-3.5" />, claims.loading ? "…" : String(claims.claims.length)],
                ] as const).map(([k, label, icon, n]) => (
                  <button key={k} type="button" onClick={() => setView(k)}
                    className={cn("inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-semibold", view === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {icon}{label}{n != null && <span className={cn("rounded px-1.5 text-[10px] tabular-nums", view === k ? "bg-primary/10 text-primary" : "bg-muted-foreground/10")}>{n}</span>}
                  </button>
                ))}
              </div>
              {view === "profile" && (
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={reset} disabled={!dirty || saving} title="Discard unsaved edits"><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
                  <Button size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void save()} disabled={!dirty || saving} title="Nothing is written to Monday until you press Save">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {dirty && view === "profile" && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
            <b>Unsaved changes.</b> Nothing is written to Monday until you press Save.
            <button type="button" onClick={reset} className="ml-auto text-[12px] underline-offset-2 hover:underline">Discard</button>
          </div>
        )}

        {view === "profile" && (
          <>
            <ProfileView p={p} draft={draft} setField={setField} firstOrderDate={firstOrderDate} ordersCount={myOrders.length}
              runningElig={runningElig || !!eligWatch} onRunEligibility={() => void runElig()} mondayUrl={mondayUrl}
              files={files.files} filesLoading={files.loading} />
            <Section id="all-notes" title={<div><div className="text-[10px] font-semibold uppercase tracking-[.08em] text-muted-foreground">Subscription notes</div><div className="text-[11px] text-muted-foreground">The running log on this patient's Subscription-board item · newest first · add one from the Notes tab in the rail; it posts at once, stamped with the time and your initials</div></div>}
              right={<span className="rounded-md bg-muted px-2 py-0.5 text-[11px]">{notes.length} note{notes.length === 1 ? "" : "s"}</span>}>
              {notes.length ? (
                <div className="space-y-2">
                  {notes.map((n, i) => (
                    <div key={i} className="rounded-lg bg-muted px-3 py-2 text-[12px]">
                      {n.stamp && <div className="text-[10px] text-muted-foreground">{n.stamp}</div>}
                      <div className="whitespace-pre-wrap break-words">{n.text}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-[12px] italic text-muted-foreground">No notes on this item yet.</div>}
              {p.patientHelpMessage && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Patient message from the reorder portal</div>
                  <div className="whitespace-pre-wrap">{p.patientHelpMessage}</div>
                </div>
              )}
            </Section>
          </>
        )}

        {view === "orders" && (
          <OrdersView p={p} orders={myOrders} loading={orders.loading} onRefresh={() => void orders.refetch()} />
        )}

        {view === "claims" && (
          <div className="space-y-3">
            <div>
              <h2 className="text-[16px] font-semibold">Claims</h2>
              <div className="text-[11px] text-muted-foreground">Every claim raised from this subscription, joined on the Subscription Item ID · latest on top, click a row to show it above{p.nextOrderDate ? ` · next order ${usDate(p.nextOrderDate)}` : ""}</div>
            </div>
            <ClaimHistoryCard mondayItemId={p.mondayItemId} currentPayer={p.primaryPayer} />
          </div>
        )}
      </div>

      <PatientRail p={p} lastOrderDay={myOrders[0]?.placed ?? ""} />
    </div>
  );
}
