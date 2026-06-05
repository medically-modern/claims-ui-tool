/**
 * MedicalRecords.tsx — Medical Records compliance workstream.
 *
 * Four sub-tabs (Send Request / Confirm Receipt / Chase Clinicals / Evaluate)
 * each with a queue. Clicking a row opens the corresponding command-center
 * panel for that patient, ported in from medically-modern/command-center
 * (the masheke checklist).
 *
 * Mock Monday wiring — the panels' read/write helpers will no-op on save
 * (no token in this env), but the UI renders identical to command-center
 * so we can iterate on layout + cadence rules here.
 */

import { useMemo, useState } from "react";
import {
  ArrowLeft, ClipboardCheck, Clock, FileText, Phone, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import { ORDER_PREP_PATIENTS, SubscriptionPatient } from "./mockData";
import { mockMashekePatient, MashekePatientRow } from "./medicalRecordsMock";

import type { Patient } from "@/lib/masheke/workflow";
import { PatientProfileCard } from "@/components/masheke/PatientProfileCard";
import { SendRequestPanel } from "@/components/masheke/SendRequestPanel";
import { ConfirmReceiptPanel } from "@/components/masheke/ConfirmReceiptPanel";
import { ChaseClinicalsPanel } from "@/components/masheke/ChaseClinicalsPanel";
import { EvaluatePanel } from "@/components/masheke/EvaluatePanel";

type MrTab = "send" | "receipt" | "chase" | "evaluate";

const TABS: { id: MrTab; label: string; icon: typeof Send; blurb: string }[] = [
  { id: "send",     label: "Send Request",    icon: Send,           blurb: "Exp-20 hit, request not sent yet. Fax or Parachute depending on doctor." },
  { id: "receipt",  label: "Confirm Receipt", icon: Phone,          blurb: "Fax sent; call the office the next day to confirm receipt." },
  { id: "chase",    label: "Chase Clinicals", icon: Clock,          blurb: "Receipt confirmed (or Parachute submitted); chase every 3 business days." },
  { id: "evaluate", label: "Evaluate",        icon: ClipboardCheck, blurb: "Records received; evaluate sufficiency, set MN expiry, mark Valid." },
];

export function MedicalRecords() {
  const [tab, setTab] = useState<MrTab>("send");
  const [search, setSearch] = useState("");
  const [openPatientId, setOpenPatientId] = useState<string | null>(null);

  // Bucketed mock queues — replace with real per-stage queries later
  const bucketed = useMemo(() => {
    const buckets: Record<MrTab, MashekePatientRow[]> = {
      send: [], receipt: [], chase: [], evaluate: [],
    };
    ORDER_PREP_PATIENTS.forEach((p, i) => {
      const row = decorate(p, i);
      const tier = i % 7;
      if (tier === 0) buckets.send.push(row);
      else if (tier === 1) buckets.receipt.push(row);
      else if (tier <= 4) buckets.chase.push(row);
      else if (tier === 5) buckets.evaluate.push(row);
    });
    return buckets;
  }, []);

  const rows = bucketed[tab];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => p.name.toLowerCase().includes(q) || p.primaryPayer.toLowerCase().includes(q));
  }, [rows, search]);

  // Mock Patient for the open detail view
  const openMashekePatient: Patient | null = useMemo(() => {
    if (!openPatientId) return null;
    const all = [...bucketed.send, ...bucketed.receipt, ...bucketed.chase, ...bucketed.evaluate];
    const sub = all.find((p) => p.id === openPatientId);
    if (!sub) return null;
    return mockMashekePatient(sub);
  }, [openPatientId, bucketed]);

  // No-op patch updater for now — the panels accept a partial Patient
  // update and call this; we just ignore writes since Monday isn't wired
  // in this env. UI behaves correctly otherwise.
  const noop = (_patch: Partial<Patient>) => {};

  // ─── Detail view ─────────────────────────────────────────────────────────
  if (openMashekePatient) {
    const stage = TABS.find((t) => t.id === tab)!;
    const Panel =
      tab === "send"    ? <SendRequestPanel    patient={openMashekePatient} onUpdate={noop} /> :
      tab === "receipt" ? <ConfirmReceiptPanel patient={openMashekePatient} onUpdate={noop} /> :
      tab === "chase"   ? <ChaseClinicalsPanel patient={openMashekePatient} onUpdate={noop} /> :
                          <EvaluatePanel       patient={openMashekePatient} onUpdate={noop} />;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setOpenPatientId(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to {stage.label} queue
          </Button>
          <Badge variant="outline">{stage.label}</Badge>
          <div className="text-sm text-muted-foreground">{openMashekePatient.name}</div>
        </div>
        <PatientProfileCard patient={openMashekePatient} defaultDoctorOpen />
        {Panel}
      </div>
    );
  }

  // ─── Queue view ──────────────────────────────────────────────────────────
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as MrTab)}>
        <TabsList className="bg-card border">
          {TABS.map((t) => {
            const Icon = t.icon;
            const n = bucketed[t.id].length;
            return (
              <TabsTrigger key={t.id} value={t.id} className="gap-2 px-4">
                <Icon className="h-4 w-4" />{t.label}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{n}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">{current.label}</div>
            <div className="text-sm text-muted-foreground">{current.blurb}</div>
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient or payer" className="max-w-xs" />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">No patients in this queue right now.</Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Doctor / Clinic</TableHead>
                <TableHead>Channel</TableHead>
                {tab === "chase" || tab === "receipt" ? <TableHead>Attempts</TableHead> : <TableHead>Trigger</TableHead>}
                <TableHead>Last activity</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenPatientId(p.id)}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.phone}</div>
                  </TableCell>
                  <TableCell>
                    <div>{p.doctorName}</div>
                    <div className="text-xs text-muted-foreground">{p.channel === "fax" ? `Fax: ${p.doctorFax ?? "—"}` : "Parachute"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={p.channel === "parachute" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-blue-50 text-blue-700 border-blue-200"}>
                      {p.channel === "parachute" ? "Parachute" : "Fax"}
                    </Badge>
                  </TableCell>
                  {(tab === "chase" || tab === "receipt") ? (
                    <TableCell className="tabular-nums">#{p.attempts}</TableCell>
                  ) : (
                    <TableCell><Badge variant="outline">Exp-20</Badge></TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground">{p.stuckSince ?? "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpenPatientId(p.id); }}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function decorate(p: SubscriptionPatient, idx: number): MashekePatientRow {
  const channel: "fax" | "parachute" = idx % 3 === 0 ? "parachute" : "fax";
  const doctors = ["Dr. Jason Sloane", "Dr. Rachel Goldstein", "Dr. Maria Hernandez", "Dr. Sam Patel", "Dr. Andrew Wu"];
  return {
    ...p,
    channel,
    attempts: (idx % 4) + 1,
    doctorName: doctors[idx % doctors.length],
    doctorFax: channel === "fax" ? `(${315 + (idx % 4)}) 555-${String(1000 + (idx * 7) % 9000).padStart(4, "0")}` : undefined,
  };
}
