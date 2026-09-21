/**
 * The patient's text thread, read-only, with the board's dates laid onto the
 * timeline so the operator can see what happened SINCE the last order without
 * cross-referencing Monday.
 *
 * Rendering rules carried over from the Command Center's ConversationThread:
 * sender name ABOVE the bubble and the bubble tinted per sender, so a long
 * thread can be scanned for "who sent what"; a delivery failure sits OUTSIDE
 * the bubble because it's the one line the operator has to act on.
 *
 * Added here: day dividers, board markers (order due / blocked / check-in),
 * and the automated reorder text is labelled as such — it's sent by Josh's
 * reorder cron, not a person, so it never carries a `sentBy`.
 *
 * ⚠️ Fetches when mounted (the sheet mounts this tab only while open) and
 * memoises per number for the session — see lib/comms/cache.ts.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Loader2, PauseCircle, RefreshCw, Bell, Bot, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isAuthed, onAuthChange } from "@/lib/comms/auth";
import { SignInRequiredError } from "@/lib/comms/gateway";
import { clearCommsCache, fetchedAt, getConversation } from "@/lib/comms/cache";
import { sendMessage, type ConversationMessage, type ConversationResult } from "@/lib/comms/messagingApi";
import { etDay, fmtDayLabel, fmtWhenET, senderColor, senderName } from "@/lib/comms/format";
import { MessageAttachments } from "./MessageAttachments";
import { SmsDeliveryNote } from "./SmsDeliveryNote";
import { SignInGate } from "./SignInGate";

export type MarkerTone = "order" | "block" | "checkin";
export interface TimelineMarker {
  /** yyyy-mm-dd (board dates are plain days). */
  day: string;
  label: string;
  tone: MarkerTone;
}

/** Josh's reorder cron sends the reorder link from the same RingCentral line;
 *  its text carries the reorder site URL, which is how it's told apart from a
 *  text a person typed. */
const REORDER_LINK = /reorder\.medicallymodern\.com/i;
export function isAutomatedReorderText(m: ConversationMessage): boolean {
  return m.direction === "Outbound" && !m.sentBy && REORDER_LINK.test(m.text || "");
}

type Item =
  | { kind: "day"; key: string; day: string }
  | { kind: "marker"; key: string; marker: TimelineMarker }
  | { kind: "msg"; key: string; m: ConversationMessage };

/** Interleave messages + markers into one day-grouped list. Markers sit at the
 *  top of their day (they're day-granular facts, not timestamped events). */
export function buildTimeline(messages: ConversationMessage[], markers: TimelineMarker[]): Item[] {
  const byDay = new Map<string, { markers: TimelineMarker[]; msgs: ConversationMessage[] }>();
  const bucket = (day: string) => {
    let b = byDay.get(day);
    if (!b) {
      b = { markers: [], msgs: [] };
      byDay.set(day, b);
    }
    return b;
  };
  for (const mk of markers) if (mk.day) bucket(mk.day).markers.push(mk);
  for (const m of messages) {
    const d = etDay(m.time) || "0000-00-00";
    bucket(d).msgs.push(m);
  }
  const days = [...byDay.keys()].sort();
  const out: Item[] = [];
  for (const day of days) {
    const b = byDay.get(day)!;
    out.push({ kind: "day", key: `day:${day}`, day });
    b.markers.forEach((mk, i) => out.push({ kind: "marker", key: `mk:${day}:${i}`, marker: mk }));
    b.msgs
      .slice()
      .sort((a, c) => String(a.time).localeCompare(String(c.time)))
      .forEach((m) => out.push({ kind: "msg", key: `m:${m.id}`, m }));
  }
  return out;
}

function MarkerRow({ marker }: { marker: TimelineMarker }) {
  const Icon = marker.tone === "order" ? CalendarClock : marker.tone === "block" ? PauseCircle : Bell;
  const cls =
    marker.tone === "order"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : marker.tone === "block"
        ? "border-rose-300 bg-rose-50 text-rose-800"
        : "border-amber-300 bg-amber-50 text-amber-800";
  return (
    <div className="flex justify-center">
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", cls)}>
        <Icon className="h-3 w-3" /> {marker.label}
      </span>
    </div>
  );
}

function DayDivider({ day }: { day: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{fmtDayLabel(day)}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function Bubble({ m }: { m: ConversationMessage }) {
  const out = m.direction === "Outbound";
  const auto = isAutomatedReorderText(m);
  const who = auto ? "Reorder text (automated)" : out ? (m.sentBy ? senderName(m.sentBy) : "Team · not attributed") : "";
  return (
    <div className={cn("flex flex-col", out ? "items-end" : "items-start")}>
      {out && (
        <span className="mb-0.5 mr-1 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          {auto && <Bot className="h-3 w-3" />}
          {who}
        </span>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          !out
            ? "bg-card border border-border"
            : auto
              ? "bg-slate-500 text-white"
              : m.sentBy
                ? `${senderColor(m.sentBy)} text-white`
                : "bg-primary text-primary-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
        <MessageAttachments attachments={m.attachments} />
        <p className={cn("mt-0.5 text-[10px]", out ? "text-white/70" : "text-muted-foreground")}>{fmtWhenET(m.time)}</p>
      </div>
      <SmsDeliveryNote direction={m.direction} messageStatus={m.messageStatus} deliveryError={m.deliveryError} className="max-w-[80%]" />
    </div>
  );
}

export function TextsTab({ phone, markers, mondayItemId, canText = true }: {
  phone: string;
  markers: TimelineMarker[];
  /** The patient's Monday item id, tied to the send for attribution (optional). */
  mondayItemId?: string;
  /** Board "Can Text" — when false, the composer is disabled (opted out). */
  canText?: boolean;
}) {
  const [authed, setAuthed] = useState(isAuthed());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState<string | null>(null);
  const [data, setData] = useState<ConversationResult | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => onAuthChange(() => setAuthed(isAuthed())), []);

  const load = async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const r = await getConversation(phone, force);
      setData(r);
      setAt(fetchedAt("texts", phone));
      setNeedSignIn(null);
    } catch (e) {
      if (e instanceof SignInRequiredError) {
        setData(null);
        // "" = show the gate with its default copy; a non-empty string
        // replaces that copy (the stored sign-in was rejected server-side).
        setNeedSignIn(
          authed ? "The gateway didn't accept the current sign-in. Sign in again with your @medicallymodern.com account." : "",
        );
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      await sendMessage(phone, text, mondayItemId);
      setDraft("");
      // A 200 means RingCentral accepted it, not that it arrived — so don't
      // claim "sent". Refetch the thread; the new bubble's delivery note shows
      // Queued / Sent / Delivered / SendingFailed as RingCentral reports it.
      await load(true);
    } catch (e) {
      if (e instanceof SignInRequiredError) {
        setNeedSignIn("The gateway didn't accept the current sign-in. Sign in again with your @medicallymodern.com account.");
      } else {
        setSendErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSending(false);
    }
  };

  // Keyed on the phone STRING and the signed-in flag only — never on an object
  // identity that changes every render (the Command Center's 2026-08-20
  // incident was exactly that: a thread fetch in a render loop).
  useEffect(() => {
    if (!phone) return;
    if (!authed) {
      setData(null);
      setNeedSignIn("");
      return;
    }
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, authed]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  if (!phone) {
    return <p className="p-4 text-sm text-muted-foreground">No usable phone number on file for this patient.</p>;
  }

  if (!authed || needSignIn !== null) {
    return (
      <div className="p-4">
        <SignInGate
          reason={needSignIn || undefined}
          onSignedIn={() => {
            clearCommsCache();
            setNeedSignIn(null);
            setAuthed(true);
          }}
        />
      </div>
    );
  }

  const items = data ? buildTimeline(data.messages, markers) : [];
  const inbound = data?.messages.filter((m) => m.direction === "Inbound").length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading texts…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Couldn't load the texts. {error}</div>
          </div>
        ) : data && data.messages.length === 0 ? (
          <>
            {items.map((it) => (it.kind === "marker" ? <MarkerRow key={it.key} marker={it.marker} /> : null))}
            <p className="py-12 text-center text-sm text-muted-foreground">No texts with this number.</p>
          </>
        ) : (
          <>
            {data && !data.complete && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-center text-[11px] text-amber-800">
                Long thread — the oldest messages weren't loaded.
              </p>
            )}
            {items.map((it) =>
              it.kind === "day" ? (
                <DayDivider key={it.key} day={it.day} />
              ) : it.kind === "marker" ? (
                <MarkerRow key={it.key} marker={it.marker} />
              ) : (
                <Bubble key={it.key} m={it.m} />
              ),
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer. Enter sends; Shift+Enter is a newline. Disabled when the
          board says Can Text = No — that's a patient opt-out, not a UI state. */}
      {canText ? (
        <div className="shrink-0 border-t bg-card p-2">
          {sendErr && (
            <div className="mb-1.5 flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <div>{sendErr}</div>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder="Write a text… (Enter to send, Shift+Enter for a new line)"
              disabled={sending}
              rows={1}
              className="max-h-32 min-h-[38px] flex-1 resize-none text-[13px]"
            />
            <Button size="sm" className="h-9 px-3" onClick={() => void send()} disabled={sending || !draft.trim()} title="Send text">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t bg-rose-50 px-4 py-2 text-[11px] font-medium text-rose-800">
          Can Text = No on the board — texting is disabled for this patient. Call instead.
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-t bg-card px-4 py-2">
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </button>
        <span className="text-[11px] text-muted-foreground">
          {data ? `${data.messages.length} messages · ${inbound} from patient` : ""}
          {at ? ` · pulled ${fmtWhenET(new Date(at).toISOString())}` : ""}
        </span>
      </div>
    </div>
  );
}
