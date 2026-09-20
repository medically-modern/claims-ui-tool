/**
 * ProfileView — the Subscription profile, ported from the Command Center
 * redesign mockup (Brandon, 2026-09-20: "copy/paste this redesign into this
 * tool"). Six cards under an overview strip, then the notes log:
 *
 *   Overview · Demographics · Insurance (editable, Run eligibility check)
 *   Medical necessity & auth · Order details (editable) · Doctor · Financials
 *
 * Editing: the draft lives in the page; nothing is written to Monday until
 * Save, which writes only the fields that changed (setSubscriptionPatient).
 */
import { Loader2, Mail, RefreshCw, Upload } from "lucide-react";
import type { LiveSubscriptionPatient } from "@/api/queries/subscriptionPatients";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAYER_OPTIONS } from "../mockData";
import {
  Chip, EditField, EditSelect, Eyebrow, Fact, ReadBox, Section, daysText, daysUntil, money, usDate,
} from "./atoms";
import type { ProfileDraft } from "./draft";

const PRIMARY_PAYERS = PAYER_OPTIONS.filter((p) => p !== "All payers");
const SECONDARY_PAYERS = ["None", "NY Medicaid", "Medicare Supplement", "Other"];
const SUBSCRIPTIONS = ["Supplies", "Sensors", "Sensors & Supplies"];
const FREQUENCIES = ["30-Days", "60-Days", "75-Days", "90-Days"];
const SENSORS = ["Not Serving", "Dexcom G7", "Dexcom G7 15-Day", "Dexcom G6", "FreeStyle Libre 3 Plus", "FreeStyle Libre 2 Plus", "FreeStyle Libre 14-Day", "Guardian 4", "Simplera Sync", "Instinct"];
const PUMPS = ["Not Serving", "Mobi", "t:slim", "iLet", "Minimed 780G"];
// Spelled exactly as the board spells them (verified 2026-07-31); Monday
// rejects a label it does not have, so a typo here is a failed save.
const INFUSION_SETS_1 = [
  "Not Serving", "AutoSoft XC 6 mm 5\"", "AutoSoft XC 6 mm 23\"", "AutoSoft XC 6 mm 32\"", "AutoSoft XC 6 mm 43\"",
  "AutoSoft XC 9 mm 23\"", "AutoSoft XC 9 mm 43\"", "AutoSoft 90 6 mm 23\"", "AutoSoft 90 6 mm 43\"",
  "AutoSoft 90 9 mm 23\"", "AutoSoft 90 9 mm 43\"", "AutoSoft 30 13 mm 23\"", "AutoSoft 30 13 mm 43\"",
  "TruSteel 6 mm 23\"", "TruSteel 6 mm 32\"", "TruSteel 8 mm 23\"", "TruSteel 8 mm 32\"",
  "VariSoft 13 mm 23\"", "VariSoft 13 mm 32\"", "VariSoft 17 mm 23\"", "Contact 6 mm 23\"",
  "Inset 6 mm 23\"", "Luer 6 mm 32\"", "Mio Advance Clear 9 mm 23\"", "QuickSet 18\"",
];
const INFUSION_SETS_2 = [
  "Not Serving", "AutoSoft XC 6 mm 5\"", "AutoSoft XC 6 mm 23\"", "AutoSoft XC 6 mm 32\"", "AutoSoft XC 6 mm 43\"",
  "AutoSoft XC 9 mm 23\"", "AutoSoft 90 6 mm 23\"", "AutoSoft 90 6 mm 43\"", "AutoSoft 90 9 mm 23\"",
  "AutoSoft 90 9 mm 43\"", "AutoSoft 30 13 mm 23\"", "TruSteel 6 mm 23\"", "TruSteel 6 mm 32\"",
  "TruSteel 8 mm 23\"", "TruSteel 8 mm 32\"", "VariSoft 13 mm 23\"", "VariSoft 13 mm 32\"",
  "VariSoft 17 mm 23\"", "Contact 6 mm 23\"", "Inset 6 mm 23\"",
];

function yn(v: string): { text: string; tone?: "good" } {
  if (/^(yes|true|1|v)$/i.test(v)) return { text: "Yes", tone: "good" };
  if (/^(no|false|0)$/i.test(v)) return { text: "No" };
  return { text: v };
}

function authTone(s: string): "good" | "warn" | "bad" | undefined {
  if (!s) return undefined;
  if (/valid|no auth|not serving/i.test(s)) return "good";
  if (/expired|denied/i.test(s)) return "bad";
  return "warn";
}

/** Days between two yyyy-mm-dd, positive when b is after a. */
function isoPlusMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ProfileView({
  p, draft, setField, firstOrderDate, ordersCount, runningElig, onRunEligibility, mondayUrl,
}: {
  p: LiveSubscriptionPatient;
  draft: ProfileDraft;
  setField: <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => void;
  firstOrderDate: string;
  ordersCount: number;
  runningElig: boolean;
  onRunEligibility: () => void;
  mondayUrl: string;
}) {
  const dte = daysUntil(draft.nextOrderDate || p.nextOrderDate);
  const status = p.rawPatientStatus || p.patientStatus;
  const statusTone = /paused/i.test(status) ? "text-amber-700" : /not active|dead|cancel/i.test(status) ? "text-rose-700" : "text-emerald-700";
  const mnDays = daysUntil(p.mnExpiry);
  const mrLabel = p.mrStatus || (p.mnExpiry ? (mnDays != null && mnDays < 0 ? "MR Expired" : "MR Valid") : "");
  const mrTone = /expired|invalid/i.test(mrLabel) ? "bad" : mrLabel ? "good" : undefined;
  const fin = p.financials;
  const hasFin = !!fin && (fin.totalRevenue !== 0 || fin.totalCost !== 0 || fin.totalGP !== 0);
  const elig = p.active;
  const eligTone = /^active$/i.test(elig) ? "good" : /inactive|failed|advantage/i.test(elig) ? "bad" : undefined;
  const reorder = reorderState(p);

  return (
    <div className="space-y-4">
      {/* ── Subscription overview ── */}
      <Section title="Subscription overview" accent>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Fact label="Status">
            <span className={cn("inline-flex items-center gap-1.5", statusTone)}>
              <span className="h-[7px] w-[7px] rounded-full bg-current" />{status || "Active"}
            </span>
          </Fact>
          <Fact label="Next order">
            {p.nextOrderDate ? <>{usDate(p.nextOrderDate)} <span className={cn("text-[11px] font-normal", dte != null && dte < 0 ? "text-amber-700" : "text-muted-foreground")}>({daysText(dte)})</span></> : ""}
          </Fact>
          <Fact label="Subscription">
            {p.subscriptionType}
            <span className="text-[11px] font-normal text-muted-foreground"> · {[p.orderType, p.orderFrequency].filter(Boolean).join(" · ") || "—"}</span>
          </Fact>
          <Fact label="First order">{firstOrderDate ? usDate(firstOrderDate) : ""}</Fact>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Demographics ── */}
        <Section title="Demographics">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Fact label="Gender">{p.gender}</Fact>
            <Fact label="Email">{p.email ? <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`mailto:${p.email}`}><Mail className="h-3 w-3" />{p.email}</a> : ""}</Fact>
          </div>
          <div className="mt-3">
            <EditField label="Address" value={draft.address} onChange={(v) => setField("address", v)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <Fact label="Referral source">{p.referralSource}</Fact>
            <EditSelect label="Can text" value={draft.canText} onChange={(v) => setField("canText", v)} options={["Yes", "No"]} blank="—" />
          </div>
          <Eyebrow className="mb-2 mt-4 border-t pt-3">Contacts</Eyebrow>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            <Fact label="Primary contact">{p.primaryContact}</Fact>
            <Fact label="Alternate contact">{p.alternateContact}</Fact>
            <Fact label="Caregiver name">{p.caregiverName}</Fact>
            <Fact label="Caregiver authorized" tone={yn(p.caregiverAuthorized).tone}>{yn(p.caregiverAuthorized).text}</Fact>
            <Fact label="Alternate phone">{p.alternatePhone}</Fact>
            <Fact label="Last patient contact">{p.lastPatientContact}</Fact>
          </div>
        </Section>

        {/* ── Insurance — editable, with the eligibility check ── */}
        <Section
          title="Insurance"
          right={
            <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-[11px]" onClick={onRunEligibility} disabled={runningElig}
              title="Flips Run Check to Run on Monday — Stedi answers within a minute; Active status and the coverage figures below refresh">
              {runningElig ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Run eligibility check
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <EditSelect label="Primary insurance" value={draft.primaryInsurance} onChange={(v) => setField("primaryInsurance", v)} options={PRIMARY_PAYERS} />
            <EditField label="Member ID 1" value={draft.memberId1} onChange={(v) => setField("memberId1", v)} />
            <EditSelect label="Secondary insurance" value={draft.secondaryInsurance} onChange={(v) => setField("secondaryInsurance", v)} options={SECONDARY_PAYERS} blank="—" />
            <EditField label="Member ID 2" value={draft.memberId2} onChange={(v) => setField("memberId2", v)} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
            <Fact label="Last eligibility check">{p.lastEligibilityCheck ? usDate(p.lastEligibilityCheck) : ""}</Fact>
            <Fact label="Active status" tone={eligTone}>{elig || (p.runCheck && p.runCheck !== "—" ? p.runCheck : "")}</Fact>
            <Fact label="Deductible left">{p.dedRemaining}</Fact>
            <Fact label="OOP remaining">{p.oopMaxRemaining}</Fact>
            <Fact label="OOP estimate (this order)" tone={p.flags?.some((f) => f.id === "oop-unknown") ? "warn" : undefined}>{p.oopEstimate}</Fact>
            <Fact label="Stedi plan">{[p.stediPayerName, p.stediPlanName].filter(Boolean).join(" · ")}</Fact>
            {p.suggestedPrimary && p.suggestedPrimary !== p.primaryPayer && (
              <Fact label="Suggested primary" tone="warn" className="col-span-2">{p.suggestedPrimary} <span className="text-[11px] font-normal text-muted-foreground">— differs from the payer on file</span></Fact>
            )}
            {p.cobCheck && !/^ok$/i.test(p.cobCheck) && <Fact label="COB check" tone="bad" className="col-span-2">{p.cobCheck}</Fact>}
            {p.lastEligibilityError && <Fact label="Last eligibility error" tone="bad" className="col-span-2">{p.lastEligibilityError}</Fact>}
          </div>
        </Section>

        {/* ── Medical necessity & auth ── */}
        <Section title="Medical necessity & auth">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Medical records" tone={mrTone}>
              {mrLabel}
              {p.mnExpiry && <div className="text-[11px] font-normal text-muted-foreground">Expires {usDate(p.mnExpiry)}{mnDays != null ? ` · ${mnDays < 0 ? `${-mnDays} days ago` : `in ${mnDays} days`}` : ""}</div>}
            </Fact>
            <Fact label="Files">
              {p.mnDocsName
                ? <span className="text-[12px]">{p.mnDocsName}</span>
                : <span className="text-[11px] font-normal text-muted-foreground">Files live on the Monday item (Medical Necessity Docs column).</span>}
            </Fact>
            <Fact label="Diagnosis">{p.diagnosis}</Fact>
            <Fact label="Sensors auth" tone={authTone(p.sensorsAuthStatus)}>
              {p.sensorsAuthStatus}{p.sensorsAuthEnd && <div className="text-[11px] font-normal text-muted-foreground">to {usDate(p.sensorsAuthEnd)}</div>}
            </Fact>
            <Fact label="Supplies auth" tone={authTone(p.suppliesAuthStatus)}>
              {p.suppliesAuthStatus}{p.suppliesAuthEnd && <div className="text-[11px] font-normal text-muted-foreground">to {usDate(p.suppliesAuthEnd)}</div>}
            </Fact>
            <Fact label="Infusion set auth ID"><span className="font-mono text-[12px]">{p.infusionAuthId}</span></Fact>
            <Fact label="Cartridge auth ID"><span className="font-mono text-[12px]">{p.cartridgeAuthId}</span></Fact>
            <Fact label="Sensors auth ID"><span className="font-mono text-[12px]">{p.sensorsAuthId}</span></Fact>
          </div>
          <div className="mt-4">
            <Eyebrow className="mb-2">Medical necessity documents</Eyebrow>
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <a
                href={mondayUrl} target="_blank" rel="noopener"
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-muted/40 px-3 py-4 text-center hover:bg-muted"
                title="File upload goes through the Monday item for now — this opens it"
              >
                <Upload className="h-5 w-5 text-muted-foreground" />
                <b className="text-[13px]">Upload MN Docs</b>
                <span className="text-[11px] text-muted-foreground">Opens the Monday item — drop the file on its Medical Necessity Docs column</span>
              </a>
              <div>
                <EditField label="Visit date" type="date" value={draft.visitDate} onChange={(v) => {
                  setField("visitDate", v);
                  setField("mnExpiry", v ? isoPlusMonths(v, 6) : draft.mnExpiry);
                }} />
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Saved with the page's Save button: sets MN expiry to visit + 6 months{draft.visitDate && draft.mnExpiry ? ` (${usDate(draft.mnExpiry)})` : ""} and refreshes Medical Records.
                </div>
              </div>
            </div>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Order details — editable ── */}
        <Section title={<Eyebrow>Order details</Eyebrow>} right={<span className="text-[11px] text-muted-foreground">editable · saves to the Subscription board</span>}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <EditField label="Next order date" type="date" value={draft.nextOrderDate} onChange={(v) => setField("nextOrderDate", v)} />
            <EditSelect label="Subscription" value={draft.subscriptionType} onChange={(v) => setField("subscriptionType", v)} options={SUBSCRIPTIONS} />
            <EditSelect label="Frequency" value={draft.orderFrequency} onChange={(v) => setField("orderFrequency", v)} options={FREQUENCIES} blank="—" />
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Reorder form</div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{reorder}</div>
            </div>
            <EditSelect label="Sensors type" value={draft.sensorsType} onChange={(v) => setField("sensorsType", v)} options={SENSORS} blank="—" />
            <EditField label="CGM qty" type="number" min={0} value={draft.cgmQty} onChange={(v) => setField("cgmQty", v)} />
            <EditSelect label="Supplies type (pump)" value={draft.suppliesType} onChange={(v) => setField("suppliesType", v)} options={PUMPS} blank="—" />
            <EditField label="Cartridges qty" type="number" min={0} value={draft.cartridgeQty} onChange={(v) => setField("cartridgeQty", v)} />
            <EditSelect label="Infusion set 1" value={draft.infusionSet1} onChange={(v) => setField("infusionSet1", v)} options={INFUSION_SETS_1} blank="—" />
            <EditField label="Inf. qty 1" type="number" min={0} value={draft.infusionSet1Qty} onChange={(v) => setField("infusionSet1Qty", v)} />
            <EditSelect label="Infusion set 2" value={draft.infusionSet2} onChange={(v) => setField("infusionSet2", v)} options={INFUSION_SETS_2} blank="—" />
            <EditField label="Inf. qty 2" type="number" min={0} value={draft.infusionSet2Qty} onChange={(v) => setField("infusionSet2Qty", v)} />
          </div>
        </Section>

        {/* ── Doctor ── */}
        <Section title="Doctor info">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Doctor">{p.doctorName}</Fact>
            <Fact label="NPI"><span className="font-mono text-[12px]">{p.doctorNpi}</span></Fact>
          </div>
          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-muted-foreground">Doctor address</div>
            <ReadBox>{p.doctorAddress}</ReadBox>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label="Doctor phone">{p.doctorPhone}</Fact>
            <Fact label="Doctor fax">{p.doctorFax}</Fact>
            <Fact label="Fax / Parachute">{p.clinicalsMethod}</Fact>
          </div>
        </Section>

        {/* ── Financials — read off the board, never re-derived ── */}
        <Section title="Financials">
          <div className="mb-1.5 text-[11px] text-muted-foreground">{p.subscriptionType === "Sensors" ? "Sensors" : "Supplies"}</div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3">
            <Fact label="Revenue">{hasFin ? money(p.subscriptionType === "Sensors" ? fin.sensorsRevenue : fin.suppliesRevenue) : ""}</Fact>
            <Fact label="Cost">{hasFin ? money(p.subscriptionType === "Sensors" ? fin.sensorsCost : fin.suppliesCost) : ""}</Fact>
            <Fact label="GP">{hasFin ? money(p.subscriptionType === "Sensors" ? fin.sensorsGP : fin.suppliesGP) : ""}</Fact>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3 border-t pt-3">
            <Fact label="Total revenue">{hasFin ? money(fin.totalRevenue) : ""}</Fact>
            <Fact label="Total cost">{hasFin ? money(fin.totalCost) : ""}</Fact>
            <Fact label="Total GP" tone={hasFin && fin.totalGP < 0 ? "bad" : undefined}>{hasFin ? money(fin.totalGP) : ""}</Fact>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-3">
            <Fact label="Shipping">{hasFin ? money(fin.shippingCost) : ""}</Fact>
            <Fact label="ARR">{hasFin ? money(fin.arr) : ""}</Fact>
            <Fact label="ARP">{hasFin ? money(fin.arp) : ""}</Fact>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
            <Fact label="Total orders">{ordersCount}{firstOrderDate ? <span className="text-[11px] font-normal text-muted-foreground"> since {usDate(firstOrderDate)}</span> : null}</Fact>
            <Fact label="Calculate financials">{p.calculateFinancials}</Fact>
          </div>
          {p.flags?.some((f) => f.id === "gp-unknown") && (
            <div className="mt-3 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] text-violet-800">Total GP is blank on the board — run Calculate Financials for this patient.</div>
          )}
        </Section>
      </div>
    </div>
  );
}

/** The reorder form's state, as chips: not sent / texted, awaiting / answered. */
export function reorderState(p: LiveSubscriptionPatient) {
  const resp = p.patientOrderResponse;
  const link = p.reorderLink ? <a className="text-[11px] text-primary hover:underline" href={p.reorderLink} target="_blank" rel="noopener">open form</a> : null;
  if (!p.reorderTextSent && !resp) {
    return <><Chip>Not sent yet</Chip><span className="text-[11px] text-muted-foreground">goes out automatically ahead of the order</span></>;
  }
  if (!resp || /no response/i.test(resp)) {
    return <><Chip tone="amber">No response yet</Chip><span className="text-[11px] text-muted-foreground">texted</span>{link}</>;
  }
  const tone = /confirm/i.test(resp) ? "green" : /cancel/i.test(resp) ? "red" : "amber";
  return <><Chip tone={tone}>{resp}</Chip>{p.patientResponseAt && <span className="text-[11px] text-muted-foreground">{p.patientResponseAt.replace(/ ET$/, "")}</span>}{link}</>;
}
