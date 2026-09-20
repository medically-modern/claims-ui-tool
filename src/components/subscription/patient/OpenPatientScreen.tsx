/**
 * OpenPatientScreen — the patient page mounted at the top of the app, from the
 * shared subscription query, so it renders the same fresh row the board has.
 */
import { Loader2 } from "lucide-react";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { Card } from "@/components/ui/card";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import { PatientPage } from "./PatientPage";
import { useOpenPatient } from "./openPatient";

export function OpenPatientScreen() {
  const { id, close } = useOpenPatient();
  const { data, loading } = useSubscriptionPatients();
  const row = (data ?? []).find((p) => p.mondayItemId === id) as LiveSubscriptionPatient | undefined;
  if (!id) return null;
  if (row) return <PatientPage patient={row} onBack={close} />;
  return (
    <div className="space-y-3">
      <button type="button" onClick={close} className="text-[12px] text-muted-foreground hover:text-foreground">← Back to the Order Cycle</button>
      <Card className="p-6 text-[13px] text-muted-foreground">
        {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading the patient…</span> : "That patient is no longer on the board."}
      </Card>
    </div>
  );
}
