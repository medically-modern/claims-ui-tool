/**
 * The "this text never landed" marker under an outbound bubble. Silent on
 * anything that has not actually failed. Ported from command-center
 * `shared/SmsDeliveryNote` (Tailwind skin only).
 */
import { AlertTriangle } from "lucide-react";
import { smsDelivery } from "@/lib/comms/smsDelivery";
import { cn } from "@/lib/utils";

export function SmsDeliveryNote({
  direction,
  messageStatus,
  deliveryError,
  className,
}: {
  direction: "Inbound" | "Outbound";
  messageStatus?: string;
  deliveryError?: string;
  className?: string;
}) {
  if (direction !== "Outbound") return null;
  const { state, reason } = smsDelivery({ messageStatus, deliveryError });
  if (state !== "failed") return null;
  return (
    <div
      className={cn(
        "mt-1 flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] leading-snug text-destructive",
        className,
      )}
    >
      <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
      <span>
        <strong>Not delivered.</strong> {reason}
      </span>
    </div>
  );
}
