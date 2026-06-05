/**
 * PatientProfile.tsx — Updating Patient Profile workflow.
 *
 * Captures any patient profile change captured outside the reorder
 * form (operator-driven phone/text updates). Date/product/address can
 * also sync automatically from the reorder tool — that path doesn't
 * land here.
 *
 * For now the form is a stub:
 *   - Patient search (name, phone, Monday ID)
 *   - Picked patient → editable fields grouped by section
 *   - Save writes locally (no Monday wire yet)
 */

import { useMemo, useState } from "react";
import { Search, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ORDER_PREP_PATIENTS, PAYER_OPTIONS, SubscriptionPatient } from "./mockData";

type EditableProfile = {
  name: string; phone: string; email: string; dob: string; gender: string;
  shippingAddress: string;
  primaryPayer: string; primaryMemberId: string;
  secondaryPayer: string; secondaryMemberId: string;
  doctorName: string; doctorNpi: string; doctorPhone: string; doctorFax: string;
  doctorEmail: string; parachuteClinic: string;
  diagnosis: string; mnExpiry: string;
  subscriptionType: string; nextOrderDate: string; orderingCycle: string;
  notes: string;
};

function blankFromPatient(p: SubscriptionPatient): EditableProfile {
  return {
    name: p.name, phone: p.phone, email: "", dob: "", gender: "",
    shippingAddress: "",
    primaryPayer: p.primaryPayer, primaryMemberId: "",
    secondaryPayer: "", secondaryMemberId: "",
    doctorName: "", doctorNpi: "", doctorPhone: "", doctorFax: "",
    doctorEmail: "", parachuteClinic: "",
    diagnosis: "", mnExpiry: "",
    subscriptionType: p.subscriptionType, nextOrderDate: p.nextOrderDate,
    orderingCycle: p.orderingCycle ?? "", notes: "",
  };
}

export function PatientProfile() {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<SubscriptionPatient | null>(null);
  const [draft, setDraft] = useState<EditableProfile | null>(null);
  const [dirty, setDirty] = useState(false);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return ORDER_PREP_PATIENTS.filter((p) =>
      p.name.toLowerCase().includes(q)
      || p.phone.includes(q)
      || p.mondayItemId.includes(q),
    ).slice(0, 8);
  }, [search]);

  function pick(p: SubscriptionPatient) {
    setPicked(p); setDraft(blankFromPatient(p));
    setDirty(false); setSearch("");
  }
  function update<K extends keyof EditableProfile>(k: K, v: EditableProfile[K]) {
    if (!draft) return;
    setDraft({ ...draft, [k]: v });
    setDirty(true);
  }
  function discard() {
    if (!picked) return;
    setDraft(blankFromPatient(picked));
    setDirty(false);
  }

  if (!picked || !draft) {
    return (
      <div className="space-y-4">
        <Card className="p-6">
          <div className="text-sm text-muted-foreground mb-2">
            Search for a patient by name, phone, or Monday item ID to edit their profile.
          </div>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Patient name, phone, or Monday ID" className="pl-9" />
          </div>
          {matches.length > 0 && (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead><TableHead>Phone</TableHead>
                  <TableHead>Payer</TableHead><TableHead>Monday ID</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => pick(p)}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{p.primaryPayer}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums text-xs">{p.mondayItemId}</TableCell>
                    <TableCell><Button size="sm" variant="outline">Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {search.length >= 2 && matches.length === 0 && (
            <div className="text-sm text-muted-foreground mt-4">No matches.</div>
          )}
        </Card>
        <Card className="p-6 text-sm text-muted-foreground">
          <strong className="text-foreground">What gets edited here:</strong> any
          profile change that isn't captured by the reorder form. The reorder form
          handles Date / Product / Address automatically (and writes back to Monday
          on submit), and captures Insurance changes for ops follow-up. This page
          is the catch-all — doctor info, new diagnosis, contact changes, and
          manual edits to anything captured above.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{picked.name}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              Monday ID {picked.mondayItemId} · {picked.primaryPayer} · {picked.subscriptionType}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
              <X className="mr-1 h-4 w-4" />Close
            </Button>
            {dirty && (<Button variant="outline" size="sm" onClick={discard}>Discard</Button>)}
            <Button size="sm" disabled={!dirty}>
              <Save className="mr-2 h-4 w-4" />Save changes
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FormSection title="Contact & shipping">
          <Field label="Name" value={draft.name} onChange={(v) => update("name", v)} />
          <Field label="Phone" value={draft.phone} onChange={(v) => update("phone", v)} />
          <Field label="Email" value={draft.email} onChange={(v) => update("email", v)} />
          <Field label="DOB" value={draft.dob} onChange={(v) => update("dob", v)} type="date" />
          <Field label="Gender" value={draft.gender} onChange={(v) => update("gender", v)} />
          <Field label="Shipping address" value={draft.shippingAddress} onChange={(v) => update("shippingAddress", v)} fullWidth />
        </FormSection>

        <FormSection title="Insurance">
          <SelectField label="Primary payer" value={draft.primaryPayer} onChange={(v) => update("primaryPayer", v)} options={PAYER_OPTIONS.filter((p) => p !== "All payers")} />
          <Field label="Primary member ID" value={draft.primaryMemberId} onChange={(v) => update("primaryMemberId", v)} />
          <SelectField label="Secondary payer" value={draft.secondaryPayer} onChange={(v) => update("secondaryPayer", v)} options={["None", ...PAYER_OPTIONS.filter((p) => p !== "All payers")]} />
          <Field label="Secondary member ID" value={draft.secondaryMemberId} onChange={(v) => update("secondaryMemberId", v)} />
        </FormSection>

        <FormSection title="Doctor">
          <Field label="Doctor name" value={draft.doctorName} onChange={(v) => update("doctorName", v)} />
          <Field label="NPI" value={draft.doctorNpi} onChange={(v) => update("doctorNpi", v)} />
          <Field label="Office phone" value={draft.doctorPhone} onChange={(v) => update("doctorPhone", v)} />
          <Field label="Office fax" value={draft.doctorFax} onChange={(v) => update("doctorFax", v)} />
          <Field label="Office email" value={draft.doctorEmail} onChange={(v) => update("doctorEmail", v)} />
          <Field label="Parachute clinic" value={draft.parachuteClinic} onChange={(v) => update("parachuteClinic", v)} />
        </FormSection>

        <FormSection title="Clinical">
          <Field label="Diagnosis" value={draft.diagnosis} onChange={(v) => update("diagnosis", v)} fullWidth />
          <Field label="MN expiry" value={draft.mnExpiry} onChange={(v) => update("mnExpiry", v)} type="date" />
        </FormSection>

        <FormSection title="Subscription">
          <SelectField label="Subscription type" value={draft.subscriptionType} onChange={(v) => update("subscriptionType", v)} options={["Sensors", "Supplies", "Sensors & Supplies"]} />
          <Field label="Next order date" value={draft.nextOrderDate} onChange={(v) => update("nextOrderDate", v)} type="date" />
          <Field label="Ordering cycle" value={draft.orderingCycle} onChange={(v) => update("orderingCycle", v)} />
        </FormSection>

        <FormSection title="Notes">
          <TextareaField label="Notes" value={draft.notes} onChange={(v) => update("notes", v)} />
        </FormSection>
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground mb-3">{title}</div>
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
function TextareaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="col-span-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" rows={3} />
    </div>
  );
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[] | string[] }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
