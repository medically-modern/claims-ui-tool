/**
 * PatientRail — the right column of the patient page, ported from the Command
 * Center redesign: Texts | Calls on top (the RingCentral thread and call log
 * for the patient's number, via Josh's monday-gateway), a composer, and the
 * most recent Subscription notes with an add-note box underneath.
 *
 * Sending a text is not wired: the gateway exposes the conversation read
 * (`/messaging/conversation`) but no send route yet, so the composer is shown
 * disabled with the reason, rather than hidden — the layout is the target.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquare, NotebookPen, Phone, Send } from "lucide-react";
import { toast } from "sonner";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { addSubscriptionNote } from "@/api/setSubscriptionPatient";
import { Button } from "@/components/ui/button";
import { CallsTab } from "@/components/comms/CallsTab";
import { TextsTab } from "@/components/comms/TextsTab";
import { markersFor } from "@/components/comms/CommsSheet";
import { getUser } from "@/lib/comms/auth";
import { commsConfigured, toE164 } from "@/lib/comms/gateway";
import { fmtPhone } from "@/lib/comms/format";
import { getCalls, getConversation } from "@/lib/comms/cache";
import { callsSince, textsSince, type SincePoint } from "@/lib/comms/sinceOrder";
import { usDate } from "./atoms";
import { useInvalidateSubscription } from "@/hooks/subscription/useInvalidateSubscription";
import { cn } from "@/lib/utils";

/** The notes column, one entry per line, newest first as written. */
export function noteLines(raw: string): Array<{ stamp: string; text: string }> {
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^\[([^\]]+)\]\s*(?:([A-Z]{1,3})\s*[—–-]\s*)?(.*)$/.exec(l);
      return m ? { stamp: [m[1], m[2]].filter(Boolean).join(" · "), text: m[3] } : { stamp: "", text: l };
    });
}

export function operatorInitials(): string {
  const u = getUser();
  const name = u?.name || u?.email || "";
  const init = name.split(/[\s.@_]+/).filter(Boolean).map((x) => x[0]).join("").toUpperCase().slice(0, 2);
  return init || "MM";
}

/** The notes the rail shows: our subscription notes plus the patient's own
 *  message from the reorder portal, newest first as written. */
export function allNotes(p: LiveSubscriptionPatient): Array<{ stamp: string; text: string; source: "team" | "patient" }> {
  const ours = noteLines(p.coordinatorNotes).map((n) => ({ ...n, source: "team" as const }));
  const portal = (p.patientHelpMessage || "").trim();
  return portal ? [{ stamp: "Patient · reorder portal", text: portal, source: "patient" as const }, ...ours] : ours;
}

/**
 * Texts and calls SINCE THE LAST ORDER, from the same cached RingCentral reads
 * the tabs use (no extra fetch), leaving out the automated reorder texts. Null
 * until the thread has loaded — the tab shows no number rather than a zero.
 */
function useSinceOrderCounts(phone: string, lastOrderDay: string) {
  const [texts, setTexts] = useState<number | null>(null);
  const [calls, setCalls] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setTexts(null); setCalls(null);
    if (!phone || !commsConfigured()) return;
    getConversation(phone).then((r) => { if (live) setTexts(textsSince(r.messages, lastOrderDay).length); }).catch(() => {});
    getCalls(phone).then((c) => { if (live) setCalls(callsSince(c, lastOrderDay).length); }).catch(() => {});
    return () => { live = false; };
  }, [phone, lastOrderDay]);
  return { texts, calls };
}

export function PatientRail({ p, since }: { p: LiveSubscriptionPatient; since: SincePoint }) {
  const lastOrderDay = since.day;
  const sinceLabel = lastOrderDay
    ? `Since the last order (${usDate(lastOrderDay)}${since.estimated ? ", estimated from Next Order − frequency" : ""})`
    : "No order date to count from — everything counts";
  const [tab, setTab] = useState<"texts" | "calls" | "notes">("texts");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { invalidate } = useInvalidateSubscription();
  const phone = useMemo(() => toE164(p.phone), [p.phone]);
  const markers = useMemo(() => markersFor(p), [p]);
  const notes = useMemo(() => allNotes(p), [p]);
  const cannotText = /^no$/i.test(p.canText || "");
  const counts = useSinceOrderCounts(phone, lastOrderDay);
  const nTexts = counts.texts ?? p.textsSinceOrder;
  const nCalls = counts.calls ?? p.callsSinceOrder;

  const addNote = async () => {
    const text = note.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await addSubscriptionNote(p.mondayItemId, text, p.coordinatorNotes || "", operatorInitials());
      setNote("");
      toast.success("Note added to the Subscription board");
      void invalidate();
    } catch (e) {
      toast.error("Couldn't add the note", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      {/* Texts | Calls */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          {([
            ["texts", "Texts", <MessageSquare key="t" className="h-3.5 w-3.5" />, nTexts],
            ["calls", "Calls", <Phone key="c" className="h-3.5 w-3.5" />, nCalls],
            ["notes", "Notes", <NotebookPen key="n" className="h-3.5 w-3.5" />, notes.length],
          ] as const).map(([t, label, icon, n]) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              title={t === "notes" ? "Subscription notes and the patient's reorder-portal message" : t === "texts" ? `${sinceLabel}; automated reorder texts left out` : sinceLabel}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold", tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {icon}{label}
              {typeof n === "number" && <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", n > 0 ? "bg-sky-100 text-sky-800" : "bg-muted text-muted-foreground")}>{n}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2 text-[11px] text-muted-foreground">
        <Phone className="h-3 w-3" />
        <span className="font-semibold text-foreground">{phone ? fmtPhone(phone) : (p.phone || "no phone on file")}</span>
        <span>primary{p.primaryContact ? ` · ${p.primaryContact}` : ""}</span>
        {p.alternatePhone && <span>· alt {p.alternatePhone}{p.caregiverName ? ` · ${p.caregiverName}` : ""}</span>}
      </div>
      {cannotText && <div className="mx-3 mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-800">Can Text = No on the board — call instead.</div>}

      {/* The thread / the call log */}
      <div className="min-h-[360px] flex-1 overflow-hidden">
        {!commsConfigured() ? (
          <div className="p-4 text-[12px] text-muted-foreground">The Comms gateway isn't configured for this build (<code>VITE_COMMS_GATEWAY_URL</code>).</div>
        ) : !phone ? (
          <div className="grid h-full place-items-center p-6 text-center text-[12px] text-muted-foreground">Phone on file isn't a usable number: "{p.phone || "—"}".</div>
        ) : tab === "texts" ? (
          <div className="h-full min-h-0"><TextsTab phone={phone} markers={markers} /></div>
        ) : tab === "calls" ? (
          <div className="h-full min-h-0"><CallsTab phone={phone} sinceDay={lastOrderDay} sinceLabel={sinceLabel} /></div>
        ) : (
          <div className="h-full min-h-0 overflow-y-auto bg-muted/20 p-3">
            {notes.length ? (
              <div className="space-y-2">
                {notes.map((n, i) => (
                  <div key={i} className={cn("rounded-lg border px-3 py-2 text-[12px]", n.source === "patient" ? "border-amber-200 bg-amber-50 text-amber-950" : "bg-card")}>
                    {n.stamp && <div className={cn("text-[10px]", n.source === "patient" ? "text-amber-800" : "text-muted-foreground")}>{n.stamp}</div>}
                    <div className="whitespace-pre-wrap break-words">{n.text}</div>
                  </div>
                ))}
              </div>
            ) : <div className="py-10 text-center text-[12px] text-muted-foreground">No notes on this patient yet.</div>}
          </div>
        )}
      </div>

      {/* The box under the list matches the tab: a text to send, or a note to add. */}
      {tab === "texts" && (
        <div className="border-t bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <input className="w-full flex-1 rounded-lg border border-input bg-card px-3 py-2 text-[13px] disabled:opacity-60" placeholder="Write a text…" disabled aria-label="Write a text"
              title="Sending isn't wired yet — the gateway has no send route. Texts go out from RingCentral for now." />
            <Button size="sm" disabled className="h-9 gap-1.5" title="Sending isn't wired yet — the gateway has no send route"><Send className="h-3.5 w-3.5" /> Send text</Button>
          </div>
        </div>
      )}
      {tab === "notes" && (
        <div className="border-t bg-muted/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addNote(); }}
              className="w-full flex-1 rounded-lg border border-input bg-card px-3 py-2 text-[13px]" placeholder="Add a note (stamped with your initials)" aria-label="Add a note" />
            <Button size="sm" className="h-9 gap-1.5" onClick={() => void addNote()} disabled={!note.trim() || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <NotebookPen className="h-3.5 w-3.5" />} Add note
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}
