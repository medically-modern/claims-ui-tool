/**
 * "Comms" — everything RingCentral knows about this patient, in a side sheet:
 * the text thread (with who on the team sent each message) and the call log,
 * with the board's own dates (order due, blocked, check-in) laid onto the
 * timeline so reorder night doesn't need a second tab open in Monday.
 *
 * Data comes from Josh's monday-gateway (see lib/comms/gateway.ts). Texts need
 * a one-time Google sign-in per browser; calls don't. Nothing is fetched until
 * the sheet opens, and each number is fetched once per session.
 */
import { useMemo } from "react";
import { LogOut, MessageSquare, Phone } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { SubscriptionPatient } from "@/components/subscription/mockData";
import { toE164, commsConfigured } from "@/lib/comms/gateway";
import { getUser, signOut } from "@/lib/comms/auth";
import { clearCommsCache } from "@/lib/comms/cache";
import { fmtPhone } from "@/lib/comms/format";
import { TextsTab, type TimelineMarker } from "./TextsTab";
import { CallsTab } from "./CallsTab";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function relDays(iso: string): string {
  if (!iso) return "";
  const a = new Date(iso + "T00:00:00").getTime();
  const b = new Date(todayIso() + "T00:00:00").getTime();
  const n = Math.round((a - b) / 86_400_000);
  return n === 0 ? "today" : n > 0 ? `in ${n}d` : `${-n}d ago`;
}
function fmtDay(iso: string): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The board facts worth seeing inline with the thread. */
export function markersFor(p: SubscriptionPatient): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  if (p.nextOrderDate) {
    out.push({ day: p.nextOrderDate, label: `Order due ${fmtDay(p.nextOrderDate)} (${relDays(p.nextOrderDate)})`, tone: "order" });
  }
  if (p.blockedDate && (p.patientStatus === "Paused" || p.pauseReason)) {
    out.push({ day: p.blockedDate, label: `Blocked${p.pauseReason ? ` — ${p.pauseReason}` : ""}`, tone: "block" });
  }
  if (p.checkInDate && (p.patientStatus === "Paused" || p.pauseReason)) {
    out.push({ day: p.checkInDate, label: `Check-in due ${fmtDay(p.checkInDate)} (${relDays(p.checkInDate)})`, tone: "checkin" });
  }
  return out;
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-800",
        tone === "bad" && "border-rose-200 bg-rose-50 text-rose-800",
        tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function CommsSheet({
  patient,
  open,
  onOpenChange,
}: {
  patient: SubscriptionPatient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const phone = useMemo(() => toE164(patient.phone), [patient.phone]);
  const markers = useMemo(() => markersFor(patient), [patient]);
  const user = getUser();
  const conf = patient.confirmation;
  const reorderChip =
    conf.label === "Not sent"
      ? { text: "Reorder text not sent yet", tone: "neutral" as const }
      : conf.label === "Awaiting"
        ? { text: "Reorder text sent · awaiting reply", tone: "warn" as const }
        : conf.tone === "ok"
          ? { text: `Patient: ${conf.label}`, tone: "good" as const }
          : { text: `Patient: ${conf.label}`, tone: "warn" as const };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b px-4 pb-3 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-emerald-700" />
            {patient.name}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {phone ? fmtPhone(phone) : `Phone on file: "${patient.phone || "—"}" (not a usable number)`}
            {patient.subscriptionType ? ` · ${patient.subscriptionType}` : ""}
            {patient.primaryPayer ? ` · ${patient.primaryPayer}` : ""}
          </SheetDescription>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {patient.nextOrderDate && (
              <Chip tone={relDays(patient.nextOrderDate).endsWith("ago") || relDays(patient.nextOrderDate) === "today" ? "good" : "neutral"}>
                Order due {fmtDay(patient.nextOrderDate)} · {relDays(patient.nextOrderDate)}
              </Chip>
            )}
            {patient.orderType && <Chip>{patient.orderType}</Chip>}
            <Chip tone={reorderChip.tone}>{reorderChip.text}</Chip>
            {(patient.patientStatus === "Paused" || patient.pauseReason) && (
              <Chip tone="bad">Paused{patient.pauseReason ? ` — ${patient.pauseReason}` : ""}</Chip>
            )}
          </div>
        </SheetHeader>

        {!commsConfigured() ? (
          <p className="p-4 text-sm text-muted-foreground">
            The Comms gateway isn't configured for this build (<code>VITE_COMMS_GATEWAY_URL</code>).
          </p>
        ) : (
          <Tabs defaultValue="texts" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2">
              <TabsTrigger value="texts" className="gap-1.5 text-[13px]">
                <MessageSquare className="h-3.5 w-3.5" /> Texts
              </TabsTrigger>
              <TabsTrigger value="calls" className="gap-1.5 text-[13px]">
                <Phone className="h-3.5 w-3.5" /> Calls
              </TabsTrigger>
            </TabsList>
            <TabsContent value="texts" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <TextsTab phone={phone} markers={markers} />
            </TabsContent>
            <TabsContent value="calls" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
              <CallsTab phone={phone} />
            </TabsContent>
          </Tabs>
        )}

        <div className="flex shrink-0 items-center justify-between border-t bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground">
          <span>RingCentral via monday-gateway · times in ET</span>
          {user ? (
            <button
              type="button"
              onClick={() => {
                signOut();
                clearCommsCache();
              }}
              className="inline-flex items-center gap-1 hover:text-foreground"
              title={`Signed in as ${user.email}`}
            >
              <LogOut className="h-3 w-3" /> {user.name || user.email}
            </button>
          ) : (
            <span>Not signed in</span>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
