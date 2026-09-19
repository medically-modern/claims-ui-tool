/**
 * The Actions-column comms entry: a phone and a speech bubble, each carrying
 * how many of that kind we've exchanged with the patient since their last
 * order, and each opening the Comms sheet on its own tab.
 *
 * Brandon, 2026-09-19: "instead of just a comms button, I want to show like a
 * phone icon and text icon, and it shows how many calls and texts we've had
 * with the patient since the last order."
 *
 * ⚠️ The counts do NOT come from RingCentral at render time. That would be one
 * API read per row per tab load — 30-100 calls a page, slow, rate-limited, and
 * the text half needs a Google sign-in the operator may not have done. They
 * come from two Monday columns the backend fills on its existing hourly
 * RingCentral pass, so the row renders them for free and they mean the same
 * thing to every reader. Until those columns exist the icons simply show no
 * number — the buttons still work, and counts light up the day the backend
 * ships. See SUB_COL.calls_since_order / texts_since_order.
 */
import { useState } from "react";
import { MessageSquare, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SubscriptionPatient } from "@/components/subscription/mockData";
import { CommsSheet } from "./CommsSheet";

function CountIcon({
  icon: Icon, count, label, onClick,
}: {
  icon: typeof Phone;
  count?: number;
  label: string;
  onClick: () => void;
}) {
  // A zero is worth showing — "we have not spoken to this patient since their
  // last order" is exactly the thing the operator needs to notice. Undefined
  // is different: the backend has not counted yet, so we say nothing.
  const known = typeof count === "number";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold transition-colors",
        known && count === 0
          ? "border-slate-200 text-slate-400 hover:bg-slate-50"
          : "border-sky-200 text-sky-800 hover:bg-sky-50",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {known && <span className="tabular-nums">{count}</span>}
    </button>
  );
}

export function CommsIcons({ patient }: { patient: SubscriptionPatient }) {
  const [tab, setTab] = useState<"texts" | "calls" | null>(null);
  const since = "since their last order";
  return (
    <>
      <CountIcon
        icon={Phone}
        count={patient.callsSinceOrder}
        label={`Calls with ${patient.name} ${since}`}
        onClick={() => setTab("calls")}
      />
      <CountIcon
        icon={MessageSquare}
        count={patient.textsSinceOrder}
        label={`Texts with ${patient.name} ${since}`}
        onClick={() => setTab("texts")}
      />
      {tab && (
        <CommsSheet
          patient={patient}
          defaultTab={tab}
          open
          onOpenChange={(o) => !o && setTab(null)}
        />
      )}
    </>
  );
}
