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
import { useMemo, useState } from "react";
import { Loader2, MessageSquare, Phone, Send } from "lucide-react";
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

export function PatientRail({ p, onAllNotes }: { p: LiveSubscriptionPatient; onAllNotes?: () => void }) {
  const [tab, setTab] = useState<"texts" | "calls">("texts");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { invalidate } = useInvalidateSubscription();
  const phone = useMemo(() => toE164(p.phone), [p.phone]);
  const markers = useMemo(() => markersFor(p), [p]);
  const notes = useMemo(() => noteLines(p.coordinatorNotes), [p.coordinatorNotes]);
  const cannotText = /^no$/i.test(p.canText || "");
  const nTexts = p.textsSinceOrder;
  const nCalls = p.callsSinceOrder;

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
          {(["texts", "calls"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold", tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t === "texts" ? <MessageSquare className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
              {t === "texts" ? "Texts" : "Calls"}
              {typeof (t === "texts" ? nTexts : nCalls) === "number" && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{t === "texts" ? nTexts : nCalls}</span>
              )}
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
        ) : (
          <div className="h-full min-h-0"><CallsTab phone={phone} /></div>
        )}
      </div>

      {/* Composer — the layout is the target; sending lands with the gateway's send route. */}
      <div className="border-t bg-muted/40 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <input className="w-full flex-1 rounded-lg border border-input bg-card px-3 py-2 text-[13px] disabled:opacity-60" placeholder="Write a text…" disabled aria-label="Write a text"
            title="Sending isn't wired yet — the gateway has no send route. Texts go out from RingCentral for now." />
          <Button size="sm" disabled className="h-9 gap-1.5" title="Sending isn't wired yet — the gateway has no send route"><Send className="h-3.5 w-3.5" /> Send text</Button>
        </div>
      </div>

      {/* Recent notes */}
      <div className="border-t px-3.5 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <b className="text-[12px]">Recent notes</b>
          {onAllNotes && <button type="button" onClick={onAllNotes} className="text-[11px] text-primary hover:underline">All notes</button>}
        </div>
        {notes.length ? (
          <div className="space-y-1.5">
            {notes.slice(0, 3).map((n, i) => (
              <div key={i} className="rounded-lg bg-muted px-2.5 py-1.5 text-[12px]">
                {n.stamp && <div className="text-[10px] text-muted-foreground">{n.stamp}</div>}
                <div className="whitespace-pre-wrap break-words">{n.text}</div>
              </div>
            ))}
          </div>
        ) : <div className="text-[11px] text-muted-foreground">No notes yet.</div>}
        <div className="mt-2 flex items-center gap-1.5">
          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addNote(); }}
            className="w-full flex-1 rounded-lg border border-input bg-card px-2.5 py-1.5 text-[12px]" placeholder="Add a note (stamped with your initials)" aria-label="Add a note" />
          <Button size="sm" className="h-8 px-2.5 text-[11px]" onClick={() => void addNote()} disabled={!note.trim() || saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
          </Button>
        </div>
      </div>
    </aside>
  );
}
