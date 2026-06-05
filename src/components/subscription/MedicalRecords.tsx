/**
 * MedicalRecords.tsx — Medical Records compliance workstream.
 *
 * Four sub-tabs mirroring command-center's MR flow:
 *   Send Request    — patients hitting Exp-20, request not yet sent
 *   Confirm Receipt — sent via fax, day-after call to confirm receipt
 *   Chase Clinicals — receipt confirmed, every-3-business-day chase
 *   Evaluate        — records received, evaluate sufficiency / sign-off
 *
 * Stub queues for now — port command-center panel logic in a follow-up.
 */

import { useMemo, useState } from "react";
import {
  ArrowRight, CheckCircle2, ClipboardCheck, Clock, FileText, Phone,
  Send,
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

type MrTab = "send" | "receipt" | "chase" | "evaluate";

const TABS: { id: MrTab; label: string; icon: typeof Send; blurb: string }[] = [
  { id: "send",     label: "Send Request",    icon: Send,            blurb: "Exp-20 hit, request not sent yet. Fax or Parachute depending on doctor." },
  { id: "receipt",  label: "Confirm Receipt", icon: Phone,           blurb: "Fax sent; call the office the next day to confirm receipt." },
  { id: "chase",    label: "Chase Clinicals", icon: Clock,           blurb: "Receipt confirmed (or Parachute submitted); chase every 3 business days." },
  { id: "evaluate", label: "Evaluate",        icon: ClipboardCheck,  blurb: "Records received; evaluate sufficiency, set MN expiry, mark Valid." },
];

type Channel = "fax" | "parachute";
type MrRow = SubscriptionPatient & { channel: Channel; sentDate?: string; lastContact?: string; attempts: number };

function decorate(p: SubscriptionPatient, idx: number): MrRow {
  const channel: Channel = idx % 3 === 0 ? "parachute" : "fax";
  return { ...p, channel, attempts: (idx % 4) + 1 };
}

export function MedicalRecords() {
  const [tab, setTab] = useState<MrTab>("send");
  const [search, setSearch] = useState("");

  const bucketed = useMemo(() => {
    const send: MrRow[] = [];
    const receipt: MrRow[] = [];
    const chase: MrRow[] = [];
    const evaluate: MrRow[] = [];
    ORDER_PREP_PATIENTS.forEach((p, i) => {
      const r = decorate(p, i);
      const tier = i % 7;
      if (tier === 0)      send.push(r);
      else if (tier === 1) receipt.push(r);
      else if (tier <= 4)  chase.push(r);
      else if (tier === 5) evaluate.push(r);
    });
    return { send, receipt, chase, evaluate };
  }, []);

  const current = TABS.find((t) => t.id === tab)!;
  const rows = (bucketed as Record<MrTab, MrRow[]>)[tab];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) =>
      p.name.toLowerCase().includes(q) || p.primaryPayer.toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as MrTab)}>
        <TabsList className="bg-card border">
          {TABS.map((t) => {
            const Icon = t.icon;
            const n = (bucketed as Record<MrTab, MrRow[]>)[t.id].length;
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
                <TableHead className="w-[160px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.phone}</div>
                  </TableCell>
                  <TableCell>
                    <div>Dr. Doe</div>
                    <div className="text-xs text-muted-foreground">{p.channel === "fax" ? "Fax: (555) 555-0100" : "Parachute"}</div>
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
                    <Button size="sm" variant={tab === "evaluate" ? "default" : "outline"}>
                      {tab === "send" ? "Send request" :
                       tab === "receipt" ? "Confirm receipt" :
                       tab === "chase" ? "Log chase" :
                       "Evaluate"}
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === "evaluate" && (
        <Card className="p-4 text-sm text-muted-foreground">
          When you evaluate, this is also where you'll set the MN expiry date (today + 6 months
          or as specified) and flip MR Status to Valid. If a chase was triggered by the auth team,
          we'll notify them automatically that they can now submit.
        </Card>
      )}
    </div>
  );
}
