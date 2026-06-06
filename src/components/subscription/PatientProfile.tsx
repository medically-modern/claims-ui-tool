/**
 * PatientProfile.tsx — Updating Patient Profile workflow.
 *
 * Main view: table of all patients (8 basic columns) + filters.
 * Click a row → detail view with 9 grouped sections, all editable.
 *
 * Sections (top → bottom):
 *   1. Demographics
 *   2. Order / Subscription
 *   3. Insurance + Run Eligibility Check button
 *   4. Doctor
 *   5. Status & flags (Status / Pause Reason / Dead Reason)
 *   6. Clinical / Medical Records (also surfaced in MR workflow)
 *   7. Authorizations (also surfaced in Auth workflow)
 *   8. Eligibility / Coverage (read-only — populated by the check)
 *   9. Billing context (read-only)
 *
 * Saves are local (in-memory overrides). The Run Eligibility Check
 * button flips Run Check → "Run" on Monday and lets the existing
 * webhook handle the actual eligibility run — stubbed here with a
 * toast and a local state update.
 */

import { useMemo, useState } from "react";
import { Search, Save, X, ArrowLeft, RefreshCw, Upload, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import {
  PAYER_OPTIONS, PAUSE_REASON_OPTIONS, PATIENT_STATUS_OPTIONS,
} from "./mockData";
import { useSubscriptionPatients } from "@/hooks/subscription/useSubscriptionPatients";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { runEligibilityCheck, saveSubscriptionPatient } from "@/api/setSubscriptionPatient";
import { Loader2, RefreshCw as ReloadIcon } from "lucide-react";

// ─── Field shape ─────────────────────────────────────────────────────────────
type EditableProfile = {
  // Demographics
  name: string; dob: string; gender: string;
  phone: string; email: string; address: string; patientUid: string;
  // Order / Subscription
  subscriptionType: string; nextOrderDate: string;
  sensorsType: string; suppliesType: string;
  infusionSet1: string; infusionSet1Qty: string;
  infusionSet2: string; infusionSet2Qty: string;
  // Insurance
  primaryInsurance: string; memberId1: string;
  secondaryInsurance: string; memberId2: string;
  insuranceCardName: string;
  // Doctor
  doctorName: string; doctorNpi: string; doctorAddress: string;
  doctorPhone: string; doctorFax: string; clinicalsMethod: string;
  // Status & flags
  status: string; pauseReason: string; deadReason: string;
  // Clinical / MR
  diagnosis: string; mnExpiry: string;
  // Authorizations
  sensorsAuthStatus: string; sensorsAuthId: string;
  sensorsAuthStart: string; sensorsAuthEnd: string; sensorsAuthUnits: string;
  suppliesAuthStatus: string;
  infusionAuthId: string; cartridgeAuthId: string;
  suppliesAuthStart: string; suppliesAuthEnd: string; suppliesAuthUnits: string;
  priorAuthReqSensors: string; priorAuthReqSupplies: string;
  triggerDvs: string;
  mnDocs: { id: string; name: string; url: string; uploadedAt: string }[];
};

// ─── Mock data helpers (deterministic per-patient defaults) ──────────────────
function hash(s: string): number {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pick<T>(arr: readonly T[], h: number): T { return arr[h % arr.length]; }

/** Format a phone-ish string into (XXX)-XXX-XXXX. Handles bare digits,
 *  +1-prefixed, and mixed-format strings. Returns the input as-is if
 *  it can\'t be parsed into 10 digits.
 */
function fmtPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)})-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Format an ISO YYYY-MM-DD into MM/DD/YYYY. Returns empty if invalid. */
function fmtDobUS(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

const SUB_TYPE_PILLS: Record<string, string> = {
  "Sensors":            "inline-flex items-center whitespace-nowrap rounded-full bg-sky-100 px-3 py-1 text-[12px] font-semibold text-sky-700",
  "Supplies":           "inline-flex items-center whitespace-nowrap rounded-full bg-violet-100 px-3 py-1 text-[12px] font-semibold text-violet-700",
  "Sensors & Supplies": "inline-flex items-center whitespace-nowrap rounded-full bg-orange-100 px-3 py-1 text-[12px] font-semibold text-orange-700",
};

const SENSORS_TYPES   = ["Dexcom G7", "Dexcom G6", "FreeStyle Libre 3", "FreeStyle Libre 2"];
const SUPPLIES_TYPES  = ["Tandem t:slim X2", "Omnipod 5", "Medtronic 780G", "Tandem Mobi"];
const INFUSION_SETS   = ["AutoSoft 90 9 mm 23\"", "TruSteel 6 mm 23\"", "VariSoft 6 mm 23\"", "Contact Detach 8 mm 23\""];
const DOCTORS         = ["Jason Sloane", "Rachel Goldstein", "Maria Hernandez", "Sam Patel", "Andrew Wu"];
const AUTH_STATUSES   = ["Not Checked", "No Auth Needed", "Auth Valid", "Submitted", "Expiring", "Expired", "Mismatch", "Denied", "Required"];
const CLINICALS_METHODS = ["Fax", "Parachute"];
const GENDERS         = ["Male", "Female"];
const DEAD_REASONS    = ["No reason on file", "Switched supplier", "Deceased", "Insurance dropped", "Patient request"];
const SECONDARY_PAYERS = ["None", "Medicare A&B", "Medicaid", "United Medicaid", "Cigna", "Anthem BCBS Commercial"];

function defaultsFromLivePatient(p: LiveSubscriptionPatient): EditableProfile {
  // Live mapping — fill from Monday columns, fall back to "" for any
  // field that doesn't have a corresponding column yet (MN Docs files,
  // Insurance Card file, etc. — those are file columns we'll wire
  // later in a separate pass).
  return {
    name: p.name,
    dob:  p.dob,
    gender: p.gender,
    phone: p.phone,
    email: p.email,
    address: p.address,
    patientUid: p.patientUid || p.mondayItemId,
    subscriptionType: p.subscriptionType,
    nextOrderDate: p.nextOrderDate,
    sensorsType: p.sensorsType,
    suppliesType: p.suppliesType,
    infusionSet1: p.infusionSet1,
    infusionSet1Qty: p.infusionSet1Qty,
    infusionSet2: p.infusionSet2,
    infusionSet2Qty: p.infusionSet2Qty,
    primaryInsurance: p.primaryPayer,
    memberId1: p.memberId1,
    secondaryInsurance: p.secondaryInsurance,
    memberId2: p.memberId2,
    insuranceCardName: p.insuranceCardName,
    doctorName: p.doctorName,
    doctorNpi: p.doctorNpi,
    doctorAddress: p.doctorAddress,
    doctorPhone: p.doctorPhone,
    doctorFax: p.doctorFax,
    clinicalsMethod: p.clinicalsMethod,
    status: p.patientStatus,
    pauseReason: p.pauseReason ?? "",
    deadReason: p.deadReason ?? "",
    diagnosis: p.diagnosis,
    mnExpiry: p.mnExpiry,
    mnDocs: [],
    sensorsAuthStatus: p.sensorsAuthStatus,
    sensorsAuthId: p.sensorsAuthId,
    sensorsAuthStart: p.sensorsAuthStart,
    sensorsAuthEnd: p.sensorsAuthEnd,
    sensorsAuthUnits: p.sensorsAuthUnits,
    suppliesAuthStatus: p.suppliesAuthStatus,
    infusionAuthId: p.infusionAuthId,
    cartridgeAuthId: p.cartridgeAuthId,
    suppliesAuthStart: p.suppliesAuthStart,
    suppliesAuthEnd: p.suppliesAuthEnd,
    suppliesAuthUnits: p.suppliesAuthUnits,
    priorAuthReqSensors: p.priorAuthReq,
    priorAuthReqSupplies: p.priorAuthReq,
    triggerDvs: p.triggerDvs,
  };
}

// Legacy mock-data shim kept around for any test code that imports it.
// Returns the same shape but built from a stripped-down SubscriptionPatient.
function defaultsFromPatient(p: { id: string; name: string; phone: string; primaryPayer: string; nextOrderDate: string; subscriptionType: string; mondayItemId: string; patientStatus: string; pauseReason?: string; deadReason?: string }): EditableProfile {
  const h = hash(p.id);
  const dobY = 1955 + (h % 35);
  const dobM = String((h % 12) + 1).padStart(2, "0");
  const dobD = String((h % 28) + 1).padStart(2, "0");
  return {
    name: p.name,
    dob: `${dobY}-${dobM}-${dobD}`,
    gender: pick(GENDERS, h),
    phone: p.phone,
    email: `${p.name.split(" ")[0].toLowerCase()}.${p.name.split(" ").pop()?.toLowerCase() ?? "test"}@example.com`,
    address: `${629 + (h % 800)} Chatham Street, Rome, NY 13440`,
    patientUid: p.mondayItemId,

    subscriptionType: p.subscriptionType,
    nextOrderDate: p.nextOrderDate,
    sensorsType: p.subscriptionType !== "Supplies" ? pick(SENSORS_TYPES, h) : "",
    suppliesType: p.subscriptionType !== "Sensors" ? pick(SUPPLIES_TYPES, h >> 1) : "",
    infusionSet1: p.subscriptionType !== "Sensors" ? pick(INFUSION_SETS, h) : "",
    infusionSet1Qty: p.subscriptionType !== "Sensors" ? "1" : "",
    infusionSet2: p.subscriptionType !== "Sensors" && h % 4 === 0 ? pick(INFUSION_SETS, h >> 2) : "",
    infusionSet2Qty: p.subscriptionType !== "Sensors" && h % 4 === 0 ? "1" : "",

    primaryInsurance: p.primaryPayer,
    memberId1: `74${(10000000 + (h % 90000000))}`,
    secondaryInsurance: pick(SECONDARY_PAYERS, h),
    memberId2: pick(SECONDARY_PAYERS, h) === "None" ? "" : `FP${(10000 + (h % 90000))}T`,
    insuranceCardName: "",

    doctorName: `Dr. ${pick(DOCTORS, h)}`,
    doctorNpi: String(1000000000 + (h % 999999999)).slice(0, 10),
    doctorAddress: `${100 + (h % 900)} Medical Plaza, Syracuse, NY 13202`,
    doctorPhone: `(315) ${String(500 + (h % 400))}-${String(1000 + (h * 11) % 9000).padStart(4, "0")}`,
    doctorFax: `(315) ${String(900 + (h % 99))}-${String(1000 + (h * 7) % 9000).padStart(4, "0")}`,
    clinicalsMethod: pick(CLINICALS_METHODS, h),

    status: p.patientStatus,
    pauseReason: p.pauseReason ?? "",
    deadReason: p.deadReason ?? "",

    diagnosis: "E11.65 — Type 2 diabetes with hyperglycemia",
    mnExpiry: "",

    sensorsAuthStatus: p.subscriptionType !== "Supplies" ? pick(AUTH_STATUSES, h) : "Not Checked",
    sensorsAuthId: "",
    sensorsAuthStart: "",
    sensorsAuthEnd: "",
    sensorsAuthUnits: p.subscriptionType !== "Supplies" ? "3" : "",
    suppliesAuthStatus: p.subscriptionType !== "Sensors" ? pick(AUTH_STATUSES, h >> 2) : "Not Checked",
    infusionAuthId: "",
    cartridgeAuthId: "",
    suppliesAuthStart: "",
    suppliesAuthEnd: "",
    suppliesAuthUnits: p.subscriptionType !== "Sensors" ? "30" : "",
    priorAuthReqSensors: "Evaluate",
    priorAuthReqSupplies: "Evaluate",
    triggerDvs: p.primaryPayer.toLowerCase().includes("medicaid") && p.subscriptionType !== "Sensors" ? "Yes" : "No",
    // Deterministic mock MN docs — 1-3 saved files per patient
    mnDocs: (() => {
      const n = (h % 3) + 1;
      const titles = ["MN Letter 2026-05.pdf", "Office Visit Note 2026-04.pdf", "Prescription Refill 2026-03.pdf", "Labs A1C 2026-02.pdf"];
      return Array.from({ length: n }).map((_, i) => ({
        id: `doc-${p.id}-${i}`,
        name: titles[(h + i) % titles.length],
        url: "#",
        uploadedAt: `2026-${String(((h + i) % 5) + 2).padStart(2, "0")}-${String(((h * 3 + i * 7) % 27) + 1).padStart(2, "0")}`,
      }));
    })(),
  };
}

// ─── Component ───────────────────────────────────────────────────────────────
export function PatientProfile() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [payerFilter, setPayerFilter] = useState<string>("All payers");
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditableProfile>>({});
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [runningElig, setRunningElig] = useState(false);
  const [sortKey, setSortKey] = useState<"name" | "phone" | "dob" | "primaryPayer" | "subscriptionType" | "nextOrderDate" | "patientStatus" | "doctorName">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data: livePatients, loading, error, usingMock, refetch } = useSubscriptionPatients();
  const patients: LiveSubscriptionPatient[] = livePatients ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = patients.filter((p) => {
      if (statusFilter !== "All" && p.patientStatus !== statusFilter) return false;
      if (payerFilter !== "All payers" && p.primaryPayer !== payerFilter) return false;
      if (q && !(p.name.toLowerCase().includes(q) || p.phone.includes(q) || p.mondayItemId.includes(q))) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      const av = String((a as unknown as Record<string, unknown>)[sortKey] ?? "");
      const bv = String((b as unknown as Record<string, unknown>)[sortKey] ?? "");
      return sortDir === "asc"
        ? av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" })
        : bv.localeCompare(av, undefined, { numeric: true, sensitivity: "base" });
    });
    return sorted;
  }, [patients, search, statusFilter, payerFilter, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function openPatient(p: LiveSubscriptionPatient) {
    setOpenId(p.id);
    setDrafts((d) => d[p.id] ? d : { ...d, [p.id]: defaultsFromLivePatient(p) });
  }
  function update<K extends keyof EditableProfile>(k: K, v: EditableProfile[K]) {
    if (!openId) return;
    setDrafts((d) => ({ ...d, [openId]: { ...d[openId], [k]: v } }));
    setDirtyMap((m) => ({ ...m, [openId]: true }));
  }
  async function save() {
    if (!openId || !draft) return;
    const opened = patients.find((p) => p.id === openId);
    if (!opened) return;
    setSaving(true);
    // Compute diff against the live patient — only write fields the
    // operator actually changed.
    const original = defaultsFromLivePatient(opened);
    const patch: Record<string, string> = {};
    (Object.keys(draft) as (keyof EditableProfile)[]).forEach((k) => {
      if (k === "mnDocs") return;
      if (draft[k] !== original[k]) patch[k as string] = String(draft[k]);
    });
    if (Object.keys(patch).length === 0) {
      toast.message("Nothing to save.");
      setSaving(false);
      return;
    }
    try {
      const result = await saveSubscriptionPatient(opened.mondayItemId, patch);
      if (result.failed.length === 0) {
        toast.success(`Saved ${result.ok.length} field${result.ok.length === 1 ? "" : "s"}`);
      } else {
        toast.error(`Saved ${result.ok.length}, ${result.failed.length} failed`, {
          description: result.failed.map((f) => `${f.field}: ${f.error}`).slice(0, 3).join("\n"),
          duration: 12_000,
        });
      }
      setDirtyMap((m) => ({ ...m, [openId]: false }));
      void refetch();
    } finally {
      setSaving(false);
    }
  }
  function discard() {
    if (!openId) return;
    const p = patients.find((x) => x.id === openId);
    if (!p) return;
    setDrafts((d) => ({ ...d, [openId]: defaultsFromLivePatient(p) }));
    setDirtyMap((m) => ({ ...m, [openId]: false }));
  }
  async function runEligibility() {
    if (!openId) return;
    const opened = patients.find((p) => p.id === openId);
    if (!opened) return;
    setRunningElig(true);
    try {
      await runEligibilityCheck(opened.mondayItemId);
      toast.success("Run Check flipped to 'Run' on Monday", {
        description: "Webhook will fire the eligibility check; refresh in a few seconds.",
      });
    } catch (e) {
      toast.error("Couldn't flip Run Check", { description: (e as Error).message });
    } finally {
      setRunningElig(false);
    }
  }

  const opened = openId ? patients.find((p) => p.id === openId) : null;
  const draft  = openId ? drafts[openId] : null;
  const dirty  = openId ? !!dirtyMap[openId] : false;

  // ─── Detail view ─────────────────────────────────────────────────────────
  if (opened && draft) {
    return (
      <div className="space-y-4">
        {/* Sticky-ish header */}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
                <ArrowLeft className="mr-2 h-4 w-4" />Back to patients
              </Button>
              <div>
                <div className="text-lg font-semibold">{opened.name}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  UID {opened.mondayItemId} · {opened.primaryPayer} · {opened.subscriptionType}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {dirty && <Button variant="outline" size="sm" onClick={discard}>Discard</Button>}
              <Button size="sm" disabled={!dirty || saving} onClick={save}>
                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : <><Save className="mr-2 h-4 w-4" />Save changes</>}
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FormSection title="Demographics">
            <Field label="Name" value={draft.name} onChange={(v) => update("name", v)} />
            <Field label="DOB" value={draft.dob} onChange={(v) => update("dob", v)} type="date" />
            <SelectField label="Gender" value={draft.gender} onChange={(v) => update("gender", v)} options={GENDERS} />
            <ReadOnlyField label="Patient UID" value={draft.patientUid} />
            <Field label="Phone" value={draft.phone} onChange={(v) => update("phone", v)} />
            <Field label="Email" value={draft.email} onChange={(v) => update("email", v)} />
            <Field label="Address" value={draft.address} onChange={(v) => update("address", v)} fullWidth />
          </FormSection>

          <FormSection title="Order / Subscription">
            <SelectField label="Subscription type" value={draft.subscriptionType} onChange={(v) => update("subscriptionType", v)} options={["Sensors", "Supplies", "Sensors & Supplies"]} />
            <Field label="Next Order date" value={draft.nextOrderDate} onChange={(v) => update("nextOrderDate", v)} type="date" />
            <SelectField label="Sensors type" value={draft.sensorsType || "—"} onChange={(v) => update("sensorsType", v === "—" ? "" : v)} options={["—", ...SENSORS_TYPES]} />
            <SelectField label="Supplies type" value={draft.suppliesType || "—"} onChange={(v) => update("suppliesType", v === "—" ? "" : v)} options={["—", ...SUPPLIES_TYPES]} />
            <SelectField label="Infusion Set 1" value={draft.infusionSet1 || "—"} onChange={(v) => update("infusionSet1", v === "—" ? "" : v)} options={["—", ...INFUSION_SETS]} />
            <Field label="Inf. Qty 1" value={draft.infusionSet1Qty} onChange={(v) => update("infusionSet1Qty", v)} type="number" />
            <SelectField label="Infusion Set 2" value={draft.infusionSet2 || "—"} onChange={(v) => update("infusionSet2", v === "—" ? "" : v)} options={["—", ...INFUSION_SETS]} />
            <Field label="Inf. Qty 2" value={draft.infusionSet2Qty} onChange={(v) => update("infusionSet2Qty", v)} type="number" />
          </FormSection>

          <FormSection title="Insurance" action={
            <Button size="sm" variant="outline" onClick={runEligibility} disabled={runningElig}>
              {runningElig ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Running…</> : <><RefreshCw className="mr-2 h-3.5 w-3.5" />Run Eligibility Check</>}
            </Button>
          }>
            <SelectField label="Primary insurance" value={draft.primaryInsurance} onChange={(v) => update("primaryInsurance", v)} options={PAYER_OPTIONS.filter((p) => p !== "All payers")} />
            <Field label="Member ID 1" value={draft.memberId1} onChange={(v) => update("memberId1", v)} />
            <SelectField label="Secondary insurance" value={draft.secondaryInsurance} onChange={(v) => update("secondaryInsurance", v)} options={SECONDARY_PAYERS} />
            <Field label="Member ID 2" value={draft.memberId2} onChange={(v) => update("memberId2", v)} />
            <FileField label="Insurance Card" value={draft.insuranceCardName} onChange={(v) => update("insuranceCardName", v)} fullWidth />
          </FormSection>

          <FormSection title="Doctor">
            <Field label="Doctor name" value={draft.doctorName} onChange={(v) => update("doctorName", v)} />
            <Field label="NPI" value={draft.doctorNpi} onChange={(v) => update("doctorNpi", v)} />
            <Field label="Doctor address" value={draft.doctorAddress} onChange={(v) => update("doctorAddress", v)} fullWidth />
            <Field label="Doctor phone" value={draft.doctorPhone} onChange={(v) => update("doctorPhone", v)} />
            <Field label="Doctor fax" value={draft.doctorFax} onChange={(v) => update("doctorFax", v)} />
            <SelectField label="Fax / Parachute" value={draft.clinicalsMethod} onChange={(v) => update("clinicalsMethod", v)} options={CLINICALS_METHODS} />
          </FormSection>

          <FormSection title="Status & flags">
            <SelectField label="Status" value={draft.status} onChange={(v) => update("status", v)} options={PATIENT_STATUS_OPTIONS.filter((s) => s !== "All")} />
            <SelectField label="Pause reason" value={draft.pauseReason || "—"} onChange={(v) => update("pauseReason", v === "—" ? "" : v)} options={["—", ...PAUSE_REASON_OPTIONS.filter((p) => p !== "Any pause reason")]} />
            <SelectField label="Dead reason" value={draft.deadReason || "—"} onChange={(v) => update("deadReason", v === "—" ? "" : v)} options={["—", ...DEAD_REASONS]} />
          </FormSection>

          <FormSection title="Clinical / Medical Records" subtitle="Editable here; managed primarily in the Medical Records workflow">
            <Field label="Diagnosis" value={draft.diagnosis} onChange={(v) => update("diagnosis", v)} fullWidth />
            <Field label="MN Expiry" value={draft.mnExpiry} onChange={(v) => update("mnExpiry", v)} type="date" />
            <div className="col-span-1" />
            <FileList
              label="MN Docs"
              files={draft.mnDocs}
              onRemove={(id) => update("mnDocs", draft.mnDocs.filter((f) => f.id !== id))}
              onAdd={(name) => update("mnDocs", [...draft.mnDocs, { id: `doc-${Date.now()}`, name, url: "#", uploadedAt: new Date().toISOString().slice(0, 10) }])}
            />
          </FormSection>

          <FormSection title="Authorizations" subtitle="Editable here; managed primarily in the Authorizations workflow" fullWidth>
            <div className="col-span-2 grid grid-cols-2 gap-3 mb-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Sensors</div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">Supplies</div>
            </div>
            <SelectField label="Auth status" value={draft.sensorsAuthStatus} onChange={(v) => update("sensorsAuthStatus", v)} options={AUTH_STATUSES} />
            <SelectField label="Auth status" value={draft.suppliesAuthStatus} onChange={(v) => update("suppliesAuthStatus", v)} options={AUTH_STATUSES} />
            <Field label="Auth ID" value={draft.sensorsAuthId} onChange={(v) => update("sensorsAuthId", v)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Inf. Set Auth ID" value={draft.infusionAuthId} onChange={(v) => update("infusionAuthId", v)} />
              <Field label="Cartridge Auth ID" value={draft.cartridgeAuthId} onChange={(v) => update("cartridgeAuthId", v)} />
            </div>
            <Field label="Auth start" value={draft.sensorsAuthStart} onChange={(v) => update("sensorsAuthStart", v)} type="date" />
            <Field label="Auth start" value={draft.suppliesAuthStart} onChange={(v) => update("suppliesAuthStart", v)} type="date" />
            <Field label="Auth end" value={draft.sensorsAuthEnd} onChange={(v) => update("sensorsAuthEnd", v)} type="date" />
            <Field label="Auth end" value={draft.suppliesAuthEnd} onChange={(v) => update("suppliesAuthEnd", v)} type="date" />
            <Field label="Units" value={draft.sensorsAuthUnits} onChange={(v) => update("sensorsAuthUnits", v)} type="number" />
            <Field label="Units" value={draft.suppliesAuthUnits} onChange={(v) => update("suppliesAuthUnits", v)} type="number" />
            <SelectField label="Prior Auth Req?" value={draft.priorAuthReqSensors} onChange={(v) => update("priorAuthReqSensors", v)} options={["Yes", "No", "Evaluate"]} />
            <SelectField label="Prior Auth Req?" value={draft.priorAuthReqSupplies} onChange={(v) => update("priorAuthReqSupplies", v)} options={["Yes", "No", "Evaluate"]} />
            <div className="col-span-2 border-t pt-3 mt-1">
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Trigger DVS" value={draft.triggerDvs} onChange={(v) => update("triggerDvs", v)} options={["Yes", "No"]} />
              </div>
            </div>
          </FormSection>

          <ReadOnlyContextSection title="Eligibility / Coverage (read-only)" subtitle="Populated by Run Eligibility Check" entries={[
            ["Active?", "Active"],
            ["Stedi Payer Name", "Fidelis Care New York"],
            ["Stedi Plan Name", "Child Health Plus"],
            ["Stedi Member ID", draft.memberId1],
            ["Date Plan Begin", "2025-12-01"],
            ["Deductible", "$0.00"],
            ["Ded. Remaining", "$0.00"],
            ["Coinsurance %", "20%"],
            ["OOP Max", "$3,500"],
            ["OOP Max Remaining", "$2,750"],
          ]} />

          <ReadOnlyContextSection title="Billing context (read-only)" subtitle="From the Claims Board" entries={[
            ["Primary Claim Paid?", "Yes"],
            ["Secondary Claim Paid?", "—"],
          ]} />
        </div>
      </div>
    );
  }

  // ─── Main table view ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {usingMock && (
        <Card className="p-3 bg-amber-50 border-amber-200 text-xs text-amber-900 flex items-center gap-2">
          <ReloadIcon className="h-3.5 w-3.5" />
          Couldn\'t reach Monday — showing mock data. {error}
          <Button variant="ghost" size="sm" className="h-6 ml-auto" onClick={() => void refetch()}>Retry</Button>
        </Card>
      )}
      {loading && livePatients === undefined && (
        <Card className="p-12 text-center">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-muted-foreground" />
          <div className="text-sm text-muted-foreground">Loading patients from Monday…</div>
        </Card>
      )}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search patient, phone, Monday ID" className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PATIENT_STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s === "All" ? "All statuses" : s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={payerFilter} onValueChange={setPayerFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PAYER_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground tabular-nums">
            {filtered.length} of {patients.length} patients
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Patient"            k="name"             sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Phone"              k="phone"            sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="DOB"                k="dob"              sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Primary Insurance"  k="primaryPayer"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Subscription"       k="subscriptionType" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Next Order"         k="nextOrderDate"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Status"             k="patientStatus"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHead label="Doctor"             k="doctorName"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => {
              return (
                <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openPatient(p)}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="tabular-nums">{fmtPhone(p.phone)}</TableCell>
                  <TableCell className="tabular-nums">{fmtDobUS(p.dob) || p.dob}</TableCell>
                  <TableCell>{p.primaryPayer}</TableCell>
                  <TableCell><span className={SUB_TYPE_PILLS[p.subscriptionType] ?? SUB_TYPE_PILLS["Sensors"]}>{p.subscriptionType}</span></TableCell>
                  <TableCell className="tabular-nums">{p.nextOrderDate}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      p.patientStatus === "Active" ? "bg-green-50 text-green-700 border-green-200" :
                      p.patientStatus === "Paused" ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
                                                     "bg-red-50 text-red-700 border-red-200"
                    }>{p.patientStatus}</Badge>
                  </TableCell>
                  <TableCell>{p.doctorName || "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">No patients match.</div>
        )}
      </Card>
    </div>
  );
}

// ─── Form atoms ──────────────────────────────────────────────────────────────
function FormSection({ title, subtitle, action, fullWidth, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; fullWidth?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={`p-4 ${fullWidth ? "lg:col-span-2" : ""}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </Card>
  );
}

function Field({ label, value, onChange, type = "text", fullWidth }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
    </div>
  );
}

function SelectField({ label, value, onChange, options, fullWidth }: {
  label: string; value: string; onChange: (v: string) => void;
  options: readonly string[] | string[]; fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 px-3 py-2 text-sm bg-muted/40 rounded-md tabular-nums">{value}</div>
    </div>
  );
}

function FileField({ label, value, onChange, fullWidth }: {
  label: string; value: string; onChange: (v: string) => void; fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 flex items-center gap-2">
        {value ? (
          <>
            <div className="flex-1 px-3 py-2 text-sm bg-muted/40 rounded-md flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />{value}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onChange("")}><X className="h-3.5 w-3.5" /></Button>
          </>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => onChange("uploaded_file.pdf")}>
            <Upload className="mr-2 h-3.5 w-3.5" />Upload file
          </Button>
        )}
      </div>
    </div>
  );
}

function ReadOnlyContextSection({ title, subtitle, entries }: {
  title: string; subtitle?: string; entries: [string, string][];
}) {
  return (
    <Card className="p-4 lg:col-span-2 bg-muted/30">
      <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-1">{title}</div>
      {subtitle && <div className="text-[11px] text-muted-foreground mb-3">{subtitle}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] text-muted-foreground">{k}</div>
            <div className="text-sm font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FileList({ label, files, onRemove, onAdd }: {
  label: string;
  files: { id: string; name: string; url: string; uploadedAt: string }[];
  onRemove: (id: string) => void;
  onAdd: (name: string) => void;
}) {
  return (
    <div className="col-span-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1 space-y-1.5">
        {files.length === 0 && (
          <div className="text-xs text-muted-foreground italic px-3 py-2">No files saved yet.</div>
        )}
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm bg-muted/40 rounded-md">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex-1 truncate">{f.name}</div>
            <span className="text-[11px] text-muted-foreground tabular-nums">{f.uploadedAt}</span>
            <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
              <a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => { if (f.url === "#") e.preventDefault(); }}>View</a>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
              <a href={f.url} download onClick={(e) => { if (f.url === "#") e.preventDefault(); }}>Download</a>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onRemove(f.id)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="w-full" onClick={() => onAdd(`Upload ${new Date().toISOString().slice(0,10)}.pdf`)}>
          <Upload className="mr-2 h-3.5 w-3.5" />Add file
        </Button>
      </div>
    </div>
  );
}

// Sortable table header — click toggles asc/desc on the active column.
function SortableHead<K extends string>({ label, k, sortKey, sortDir, onClick }: {
  label: string; k: K; sortKey: K; sortDir: "asc" | "desc"; onClick: (k: K) => void;
}) {
  const active = sortKey === k;
  return (
    <TableHead
      onClick={() => onClick(k)}
      className="cursor-pointer select-none whitespace-nowrap"
    >
      <span className={active ? "font-semibold" : ""}>
        {label}
        {active && (
          <span className="ml-1 text-muted-foreground">{sortDir === "asc" ? "▲" : "▼"}</span>
        )}
      </span>
    </TableHead>
  );
}
