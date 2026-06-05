/**
 * Authorizations.tsx — Authorization workstream.
 *
 * Four sub-tabs mirroring the command-center auth flows + DVS:
 *   Benefits         → InsurancePanel (verify INN / Active / DME benefits +
 *                      per-code requirements / fees / units)
 *   Submit Auth      → AuthorizationsPanel (submit auth per product code)
 *   Auth Outstanding → AuthOutstandingPanel (track submitted auths)
 *   DVS              → custom queue for Medicaid Supplies DVS at order time
 *
 * Click a row → detail view with PatientProfileCard + the stage panel.
 * Per-patient state lives in-memory only (no Monday writes on this side).
 */

import { useMemo, useState } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Clock, FileText,
  Send, Shield,
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
import {
  decorateSamanthaRow, mockSamanthaPatient, SamanthaPatientRow,
} from "./authorizationsMock";

import { EMPTY_INSURANCE, type Patient, type UniversalChoice }
  from "@/lib/samantha/workflow";
import type { ProductCodeId, ProductCodeState }
  from "@/lib/samantha/workflow";
import { PatientProfileCard } from "@/components/samantha/PatientProfileCard";
import { InsurancePanel } from "@/components/samantha/InsurancePanel";
import { AuthorizationsPanel } from "@/components/samantha/AuthorizationsPanel";
import { AuthOutstandingPanel } from "@/components/samantha/AuthOutstandingPanel";

type AuthTab = "benefits" | "submit" | "outstanding" | "dvs";

const TABS: { id: AuthTab; label: string; icon: typeof Shield; blurb: string }[] = [
  { id: "benefits",    label: "Benefits",         icon: Shield,    blurb: "Verify in-network status, active coverage, and DME benefits for each product code." },
  { id: "submit",      label: "Submit Auth",      icon: Send,      blurb: "Patients whose auth needs to be (re)submitted." },
  { id: "outstanding", label: "Auth Outstanding", icon: Clock,     blurb: "Submitted, waiting on payer." },
  { id: "dvs",         label: "DVS",              icon: FileText,  blurb: "Medicaid Supplies — submit DVS at order time via ePACES." },
];

export function Authorizations() {
  const [tab, setTab] = useState<AuthTab>("benefits");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // Per-patient in-memory overrides (insurance state, notes, etc.)
  const [overrides, setOverrides] = useState<Record<string, Partial<Patient>>>({});

  // Bucket queues by stage
  const bucketed = useMemo(() => {
    const buckets: Record<AuthTab, SamanthaPatientRow[]> = {
      benefits: [], submit: [], outstanding: [], dvs: [],
    };
    ORDER_PREP_PATIENTS.forEach((p, i) => {
      const row = decorateSamanthaRow(p, i);
      // Medicaid + non-Sensors → DVS bucket
      if (p.primaryPayer.toLowerCase().includes("medicaid")
          && p.subscriptionType !== "Sensors") {
        buckets.dvs.push(row); return;
      }
      // Auth gate state drives the rest
      if (p.auth.tone === "ok") return;
      if (currentPhase(p) === "auth" && p.blockedBy === "payer") {
        buckets.outstanding.push(row);
      } else if (p.benefits.tone !== "ok" && p.confirmation.tone === "ok") {
        buckets.benefits.push(row);
      } else if (p.auth.tone === "warn" || p.auth.tone === "bad") {
        buckets.submit.push(row);
      }
    });
    return buckets;
  }, []);

  const rows = bucketed[tab];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) =>
      p.name.toLowerCase().includes(q) || p.primaryPayer.toLowerCase().includes(q),
    );
  }, [rows, search]);

  // Build the merged Patient for the open row
  const openPatient: Patient | null = useMemo(() => {
    if (!openId) return null;
    const all = [
      ...bucketed.benefits, ...bucketed.submit,
      ...bucketed.outstanding, ...bucketed.dvs,
    ];
    const row = all.find((p) => p.id === openId);
    if (!row) return null;
    const base = mockSamanthaPatient(row, tab);
    return { ...base, ...overrides[openId] };
  }, [openId, bucketed, tab, overrides]);

  // Patch helper — merges into per-patient overrides
  function patchOpen(patch: Partial<Patient>) {
    if (!openId) return;
    setOverrides((o) => ({ ...o, [openId]: { ...o[openId], ...patch } }));
  }
  function updateCode(codeId: ProductCodeId, patch: Partial<ProductCodeState>) {
    if (!openPatient) return;
    const ins = openPatient.insurance ?? EMPTY_INSURANCE;
    const prev = ins.codes[codeId] ?? { status: "pending" as const };
    const nextCode = { ...prev, ...patch } as ProductCodeState;
    patchOpen({ insurance: { ...ins, codes: { ...ins.codes, [codeId]: nextCode } } });
  }
  function onUniversalChange(id: string, value: UniversalChoice) {
    if (!openPatient) return;
    const ins = openPatient.insurance ?? EMPTY_INSURANCE;
    patchOpen({ insurance: { ...ins, universal: { ...ins.universal, [id]: value } } });
  }
  function onNotesChange(notes: string) { patchOpen({ notes }); }
  async function noopSave(_notes: string) { /* no-op until Monday wired */ }

  // ─── Detail view ─────────────────────────────────────────────────────────
  if (openPatient) {
    const stage = TABS.find((t) => t.id === tab)!;
    const Panel =
      tab === "benefits" ? (
        <InsurancePanel
          patient={openPatient}
          onUniversalChange={onUniversalChange}
          onCodeChange={updateCode}
          onNotesChange={onNotesChange}
          onSaveNotesToMonday={noopSave}
          onNeverBilledChange={(field, value) => {
            const ins = openPatient.insurance ?? EMPTY_INSURANCE;
            patchOpen({ insurance: { ...ins, [field]: value } });
          }}
        />
      ) : tab === "submit" ? (
        <AuthorizationsPanel
          patient={openPatient}
          onCodeChange={updateCode}
          onNotesChange={onNotesChange}
          onSaveNotesToMonday={noopSave}
        />
      ) : tab === "outstanding" ? (
        <AuthOutstandingPanel
          patient={openPatient}
          onCodeChange={updateCode}
          onNotesChange={onNotesChange}
          onSaveNotesToMonday={noopSave}
        />
      ) : (
        <DvsDetail patient={openPatient} />
      );
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to {stage.label} queue
          </Button>
          <Badge variant="outline">{stage.label}</Badge>
          <div className="text-sm text-muted-foreground">{openPatient.name}</div>
        </div>
        <PatientProfileCard patient={openPatient} />
        {Panel}
      </div>
    );
  }

  // ─── Queue view ──────────────────────────────────────────────────────────
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as AuthTab)}>
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

      {tab === "dvs" && (
        <Card className="p-4 bg-purple-50 border-purple-200 text-sm">
          <strong className="text-purple-900">DVS at order time:</strong> NY Medicaid Supplies bypasses
          traditional auth. We submit a Dispensing Validation System request through ePACES at order
          validation; response (Review ID or rejection) lands immediately, and the claim response
          comes back in the same exchange. Powered by the existing <code>automate-dvs</code> Playwright bot.
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">No patients in this queue right now.</Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Days in queue</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(p.id)}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.phone}</div>
                  </TableCell>
                  <TableCell>{p.primaryPayer}</TableCell>
                  <TableCell><Badge variant="outline">{p.subscriptionType}</Badge></TableCell>
                  <TableCell>
                    {p.auth.tone === "warn" && <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200"><AlertCircle className="mr-1 h-3 w-3" />{p.auth.label}</Badge>}
                    {p.auth.tone === "bad"  && <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200"><AlertCircle className="mr-1 h-3 w-3" />{p.auth.label}</Badge>}
                    {p.auth.tone === "pending" && <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200"><Clock className="mr-1 h-3 w-3" />Pending</Badge>}
                    {p.auth.tone === "ok" && tab === "dvs" && <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">DVS ready</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums">{p.stuckSince ? daysSince(p.stuckSince) : "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpenId(p.id); }}>
                      Open<ArrowRight className="ml-1 h-3 w-3" />
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

// ─── DVS detail (custom — no command-center counterpart) ─────────────────────
function DvsDetail({ patient }: { patient: Patient }) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-3">DVS request</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Patient</div><div className="font-medium">{patient.name}</div></div>
          <div><div className="text-xs text-muted-foreground">Medicaid ID</div><div className="font-medium tabular-nums">{patient.memberId1}</div></div>
          <div><div className="text-xs text-muted-foreground">Service date</div><div className="font-medium">{new Date().toLocaleDateString()}</div></div>
          <div><div className="text-xs text-muted-foreground">Product codes</div><div className="font-medium">A4233, A4253</div></div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button>
            <Send className="mr-2 h-4 w-4" />Submit DVS via ePACES
          </Button>
          <Button variant="outline">
            View ePACES Activity
          </Button>
          <div className="text-xs text-muted-foreground">
            DVS response typically lands in &lt; 30 seconds; Review ID writes back to the patient row.
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-3">Last DVS activity</div>
        <div className="text-sm text-muted-foreground">No prior DVS submissions on file for this patient.</div>
      </Card>
    </div>
  );
}

function daysSince(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000));
}
