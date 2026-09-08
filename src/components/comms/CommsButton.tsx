/**
 * The Actions-column entry point: a small "Comms" button that opens the
 * patient's CommsSheet. Owns its own open state so it can drop into any row
 * without threading a callback through the tables; the sheet is only mounted
 * while open, so nothing is fetched for rows nobody clicked.
 */
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SubscriptionPatient } from "@/components/subscription/mockData";
import { CommsSheet } from "./CommsSheet";

export function CommsButton({ patient, disabled }: { patient: SubscriptionPatient; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-[11px] font-semibold text-sky-800 border-sky-200 hover:bg-sky-50"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        disabled={disabled}
        title="Texts & calls with this patient (RingCentral)"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="ml-1 hidden md:inline">Comms</span>
      </Button>
      {open && <CommsSheet patient={patient} open={open} onOpenChange={setOpen} />}
    </>
  );
}
