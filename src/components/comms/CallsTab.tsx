/**
 * The patient's calls with the MM line — both directions, how long each
 * lasted, and a player where RingCentral recorded it. Adapted from the Command
 * Center's `CallHistoryButton` (list body only; the sheet owns the chrome).
 *
 * No sign-in needed: the gateway's `/rc` call-log proxy is CORS-locked but not
 * token-gated. Fetches when mounted, memoised per number for the session.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, RefreshCw, Voicemail } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchRecordingBlobUrl, fetchVoicemail, SignInRequiredError } from "@/lib/comms/gateway";
import { isAuthed } from "@/lib/comms/auth";
import { placeCall } from "@/lib/comms/callApi";
import { fetchedAt, getCalls } from "@/lib/comms/cache";
import { callsSince } from "@/lib/comms/sinceOrder";
import { callOutcomeLabel, summarizeCalls, type PatientCall } from "@/lib/comms/callHistory";
import { fmtWhenET } from "@/lib/comms/format";
import { SignInGate } from "./SignInGate";

interface AudioState {
  loading?: boolean;
  url?: string;
  transcript?: string;
  err?: string;
}

function CallIcon({ call }: { call: PatientCall }) {
  const cls = "h-4 w-4 shrink-0";
  if (call.voicemail) return <Voicemail className={cn(cls, "text-amber-600")} />;
  if (!call.connected)
    return <PhoneMissed className={cn(cls, call.direction === "Inbound" ? "text-destructive" : "text-muted-foreground")} />;
  return call.direction === "Inbound" ? (
    <PhoneIncoming className={cn(cls, "text-emerald-700")} />
  ) : (
    <PhoneOutgoing className={cn(cls, "text-emerald-700")} />
  );
}

/**
 * `sinceDay` (yyyy-mm-dd) narrows the list to calls on or after that day — the
 * patient page passes the last order day, so the tab shows this order's
 * conversation and not a year of history (Brandon, 2026-09-20). Older calls
 * stay one click away. No `sinceDay` = the whole year, as in the Claims sheet.
 */
export function CallsTab({ phone, sinceDay = "", sinceLabel, mondayItemId }: { phone: string; sinceDay?: string; sinceLabel?: string; mondayItemId?: string }) {
  const [loading, setLoading] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [calls, setCalls] = useState<PatientCall[] | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [audio, setAudio] = useState<Record<string, AudioState>>({});
  const [calling, setCalling] = useState(false);
  const [needSignIn, setNeedSignIn] = useState(false);
  const blobs = useRef<string[]>([]);

  // Placing a call rings the operator's own RingCentral phone first (RingOut),
  // so it needs the signed-in identity — unlike reading the call log.
  const call = async () => {
    if (calling) return;
    if (!isAuthed()) { setNeedSignIn(true); return; }
    setCalling(true);
    try {
      await placeCall(phone, mondayItemId);
      toast.success("Calling…", { description: "Your RingCentral phone rings first, then we connect the patient." });
    } catch (e) {
      if (e instanceof SignInRequiredError) setNeedSignIn(true);
      else toast.error("Couldn't place the call", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCalling(false);
    }
  };

  const load = async (force: boolean) => {
    setLoading(true);
    setErr(null);
    try {
      setCalls(await getCalls(phone, force));
      setAt(fetchedAt("calls", phone));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // A history we couldn't read is NOT an empty history.
      setCalls(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!phone) return;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  // Release every blob: URL we created — recordings hold real memory.
  useEffect(() => {
    return () => {
      blobs.current.forEach((u) => URL.revokeObjectURL(u));
      blobs.current = [];
    };
  }, []);

  const play = async (call: PatientCall) => {
    if ((!call.recording && !call.voicemailMessage) || audio[call.id]?.url || audio[call.id]?.loading) return;
    setAudio((a) => ({ ...a, [call.id]: { loading: true } }));
    try {
      if (call.recording) {
        const url = await fetchRecordingBlobUrl(call.recording.contentUri);
        blobs.current.push(url);
        setAudio((a) => ({ ...a, [call.id]: { url } }));
      } else if (call.voicemailMessage) {
        const { audioUrl, transcript } = await fetchVoicemail(call.voicemailMessage.uri);
        blobs.current.push(audioUrl);
        setAudio((a) => ({ ...a, [call.id]: { url: audioUrl, transcript } }));
      }
    } catch (e) {
      setAudio((a) => ({ ...a, [call.id]: { err: e instanceof Error ? e.message : String(e) } }));
    }
  };

  if (!phone) {
    return <p className="p-4 text-sm text-muted-foreground">No usable phone number on file for this patient.</p>;
  }

  const recent = sinceDay ? callsSince(calls ?? [], sinceDay) : (calls ?? []);
  const olderCount = (calls?.length ?? 0) - recent.length;
  const shown = showOlder ? (calls ?? []) : recent;
  const summary = summarizeCalls(shown);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b bg-card px-4 py-2">
        <span className="text-[12px] font-medium text-muted-foreground">Call history</span>
        <Button size="sm" className="h-8 gap-1.5" disabled={calling} onClick={() => void call()} title="Call the patient — RingCentral rings your phone first, then connects them">
          {calling ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />} Call patient
        </Button>
      </div>
      {needSignIn && (
        <div className="shrink-0 border-b p-3">
          <SignInGate reason="Sign in with your @medicallymodern.com account to place calls." onSignedIn={() => setNeedSignIn(false)} />
        </div>
      )}
      <div className="flex-1 overflow-y-auto bg-muted/20 p-4">
        {loading && !calls ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading call history…
          </div>
        ) : err ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Couldn't load the call history. {err}</div>
          </div>
        ) : calls && shown.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {calls.length === 0 ? "No calls with this number in the last year." : "No calls since the last order."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((c) => {
              const a = audio[c.id] ?? {};
              return (
                <li key={c.id} className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <CallIcon call={c} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{c.direction === "Inbound" ? "Patient called" : "We called"}</div>
                      <div className="text-xs text-muted-foreground">{fmtWhenET(c.startTime, { withYear: true })}</div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-sm tabular-nums",
                        c.connected ? "font-semibold" : "text-muted-foreground",
                        !c.connected && c.direction === "Inbound" && "font-semibold text-destructive",
                      )}
                      title={c.result ? `RingCentral: ${c.result}` : undefined}
                    >
                      {callOutcomeLabel(c)}
                    </span>
                    {(c.recording || c.voicemailMessage) && !a.url && (
                      <button
                        type="button"
                        onClick={() => void play(c)}
                        disabled={a.loading}
                        className={cn("inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold hover:bg-muted/60 disabled:opacity-50", c.voicemailMessage && !c.recording ? "text-amber-700" : "text-emerald-700")}
                        title={c.voicemailMessage && !c.recording ? "Play voicemail" : "Play recording"}
                      >
                        {a.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        Play
                      </button>
                    )}
                  </div>
                  {a.url && <audio controls autoPlay src={a.url} className="mt-2 h-9 w-full" />}
                  {a.transcript && <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-950"><span className="font-semibold">Transcript:</span> {a.transcript}</p>}
                  {a.err && <p className="mt-1.5 text-xs text-destructive">Couldn't load the recording. {a.err}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {calls && sinceDay && olderCount > 0 && (
        <button
          type="button"
          onClick={() => setShowOlder((v) => !v)}
          className="shrink-0 border-t bg-muted/30 px-4 py-1.5 text-center text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {showOlder ? "Hide calls from before the last order" : `Show ${olderCount} older ${olderCount === 1 ? "call" : "calls"} from before the last order`}
        </button>
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
          {calls
            ? `${summary.total} ${summary.total === 1 ? "call" : "calls"}${summary.missedInbound ? ` · ${summary.missedInbound} missed` : ""}${summary.recorded ? ` · ${summary.recorded} recorded` : ""} · ${sinceDay && !showOlder ? (sinceLabel ? sinceLabel.charAt(0).toLowerCase() + sinceLabel.slice(1) : "since the last order") : "last 12 months"}`
            : sinceDay ? (sinceLabel ?? "Since the last order") : "Last 12 months"}
          {at ? ` · pulled ${fmtWhenET(new Date(at).toISOString())}` : ""}
        </span>
      </div>
    </div>
  );
}
