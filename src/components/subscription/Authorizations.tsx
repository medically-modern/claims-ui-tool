/**
 * Authorizations.tsx — Authorization workstream queue.
 *
 * Four sub-tabs:
 *   Benefits        — verify auth requirement / INN / DME for new payers
 *                     (the auth-requirement check; not the Stedi eligibility
 *                     run, that lives inside the Order Cycle)
 *   Submit Auth     — patients whose auth needs to be (re)submitted
 *   Auth Outstanding — submitted, awaiting payer
 *   DVS             — Medicaid Supplies alternate path; submit at order time
 *
 * Stub queues for now — port command-center panel logic in a follow-up.
 */

import { useMemo, useState } from "react";
import {
  AlertCircle, ArrowRight, CheckCircle2, Clock, FileText, Send, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ORDER_PREP_PATIENTS, SubscriptionPatient, currentPhase } from "./mockData";

type AuthTab = "benefits" | "submit" | "outstanding" | "dvs";

const TABS: { id: AuthTab; label: string; icon: typeof Shield; blurb: string }[] = [
  { id: "benefits",    label: "Benefits",         icon: Shield,      blurb: "Auth requirement / INN / DME verification for new payers." },
  { id: "submit",      label: "Submit Auth",      icon: Send,        blurb: "Patients whose auth needs to be (re)submitted." },
  { id: "outstanding", label: "Auth Outstanding", icon: Clock,       blurb: "Submitted, waiting on payer." },
  { id: "dvs",         label: "DVS",              icon: FileText,    blurb: "Medicaid Supplies — submit DVS at order time." },
];

export function Authorizations() {
  const [tab, setTab] = useState<AuthTab>("benefits");
  const [search, setSearch] = useState("");

  // Crude bucketing off the existing mock data — replace with real signals
  // once the auth workflow has its own per-patient state.
  const bucketed = useMemo(() => {
    const benefits:    SubscriptionPatient[] = [];
    const submit:      SubscriptionPatient[] = [];
    const outstanding: SubscriptionPatient[] = [];
    const dvs:         SubscriptionPatient[] = [];
    for (const p of ORDER_PREP_PATIENTS) {
      if (p.primaryPayer === "Medicaid" && p.subscriptionType !== "Sensors") {
        dvs.push(p); continue;
      }
      if (p.auth.tone === "ok") continue;
      if (currentPhase(p) === "auth" && p.blockedBy === "payer") {
        outstanding.push(p);
      } else if (p.benefits.tone !== "ok" && p.confirmation.tone === "ok") {
        benefits.push(p);
      } else if (p.auth.tone === "warn" || p.auth.tone === "bad") {
        submit.push(p);
      }
    }
    return { benefits, submit, outstanding, dvs };
  }, []);

  const current = TABS.find((t) => t.id === tab)!;
  const rows = (bucketed as Record<AuthTab, SubscriptionPatient[]>)[tab];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) =>
      p.name.toLowerCase().includes(q) || p.primaryPayer.toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as AuthTab)}>
        <TabsList className="bg-card border">
          {TABS.map((t) => {
            const Icon = t.icon;
            const n = (bucketed as Record<AuthTab, SubscriptionPatient[]>)[t.id].length;
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

      {tab === "dvs" ? <DvsQueue rows={filtered} /> : <AuthQueue tab={tab} rows={filtered} />}
    </div>
  );
}

function AuthQueue({ tab, rows }: { tab: AuthTab; rows: SubscriptionPatient[] }) {
  if (rows.length === 0) {
    return <Card className="p-12 text-center text-sm text-muted-foreground">No patients in this queue right now.</Card>;
  }
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>Payer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Days in queue</TableHead>
            <TableHead className="w-[140px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.phone}</div>
              </TableCell>
              <TableCell>{p.primaryPayer}</TableCell>
              <TableCell><Badge variant="outline">{p.subscriptionType}</Badge></TableCell>
              <TableCell>
                {p.auth.tone === "ok" && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200"><CheckCircle2 className="mr-1 h-3 w-3" />Valid</Badge>}
                {p.auth.tone === "warn" && <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><AlertCircle className="mr-1 h-3 w-3" />{p.auth.label}</Badge>}
                {p.auth.tone === "bad" && <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><AlertCircle className="mr-1 h-3 w-3" />{p.auth.label}</Badge>}
                {p.auth.tone === "pending" && <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Clock className="mr-1 h-3 w-3" />Pending</Badge>}
              </TableCell>
              <TableCell className="tabular-nums">{p.stuckSince ? daysSince(p.stuckSince) : "—"}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline">
                  {tab === "benefits" ? "Verify" : tab === "submit" ? "Submit" : "Check payer"}
                  <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function DvsQueue({ rows }: { rows: SubscriptionPatient[] }) {
  if (rows.length === 0) {
    return <Card className="p-12 text-center text-sm text-muted-foreground">No Medicaid Supplies patients ready for DVS.</Card>;
  }
  return (
    <>
      <Card className="p-4 mb-4 bg-purple-50 border-purple-200 text-sm">
        <strong className="text-purple-900">DVS at order time:</strong> NY Medicaid Supplies bypasses
        traditional auth. We submit a Dispensing Validation System request through ePACES at order
        validation; response (Review ID or rejection) lands immediately, and the claim response
        comes back in the same exchange. Powered by the existing <code>automate-dvs</code> Playwright bot.
      </Card>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Member ID</TableHead>
              <TableHead>Service date</TableHead>
              <TableHead>Product codes</TableHead>
              <TableHead>DVS status</TableHead>
              <TableHead className="w-[160px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.phone}</div>
                </TableCell>
                <TableCell className="tabular-nums text-xs text-muted-foreground">M{p.mondayItemId.slice(-7)}</TableCell>
                <TableCell>{p.nextOrderDate}</TableCell>
                <TableCell className="text-xs text-muted-foreground">A4233, A4253</TableCell>
                <TableCell><Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Clock className="mr-1 h-3 w-3" />Pending</Badge></TableCell>
                <TableCell>
                  <Button size="sm">
                    Submit DVS
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function daysSince(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000));
}
