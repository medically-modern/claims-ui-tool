import {
  Patient,
  UNIVERSAL_CHECKS,
  PRODUCT_CODES,
  ProductCodeId,
  ProductCodeState,
  CodeStatus,
  EMPTY_INSURANCE,
  InsuranceState,
  deriveInsuranceOutcome,
  AuthChoice,
  SosChoice,
  UniversalChoice,
  computeNextOrderDates,
} from "@/lib/samantha/workflow";
import {
  resolveHcpcs,
  isAutoFilledMedicaidSupply,
  PRODUCT_LABELS,
  type PrimaryInsurance,
  type Serving,
  type ProductId,
  type ResolvedProduct,
} from "@/lib/samantha/hcpcRules";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, ShieldCheck, ShieldAlert, Repeat, Package, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo } from "react";

interface Props {
  patient: Patient;
  onUniversalChange: (id: string, value: UniversalChoice) => void;
  onCodeChange: (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => void;
  onNotesChange: (v: string) => void;
  onSaveNotesToMonday?: (notes: string) => Promise<void>;
  onNeverBilledChange?: (field: "neverBilledIsCar" | "neverBilledCgm", value: boolean) => void;
}

// Map resolver ProductId → existing ProductCodeId used for state tracking
const PRODUCT_TO_CODE_ID: Record<ProductId, ProductCodeId> = {
  monitor: "cgm-monitor",
  sensors: "cgm-sensors",
  insulin_pump: "pump",
  infusion_set: "infusion-sets",
  cartridge: "cartridges",
};

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export function InsurancePanel({
  patient,
  onUniversalChange,
  onCodeChange,
  onNotesChange,
  onSaveNotesToMonday,
  onNeverBilledChange,
}: Props) {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const universalDone = Object.values(ins.universal).every((v) => v === "confirmed");
  const universalCount = Object.values(ins.universal).filter((v) => v === "confirmed").length;
  const outcome = deriveInsuranceOutcome(ins);

  const serving = patient.serving || "";
  const primaryInsurance = patient.primaryInsurance || "";
  const resolved: ResolvedProduct[] = resolveHcpcs(
    primaryInsurance || null,
    serving || null,
    patient.secondaryInsurance ?? null,
  );
  // Products to render in Samantha's UI — Medicaid-billed supplies are
  // hidden and auto-filled downstream (Auth=Required, SoS=Skip).
  const visibleResolved = resolved.filter((r) => !isAutoFilledMedicaidSupply(r));
  const dropdownsReady = !!serving && !!primaryInsurance;

  const nextOrderDates = useMemo(
    () => computeNextOrderDates(ins, primaryInsurance, patient.secondaryInsurance ?? ""),
    [ins, primaryInsurance, patient.secondaryInsurance],
  );

  // Default the Insulin Pump card to Auth=Required, SoS=Clear when the
  // patient is on Medicaid + Insulin Pump serving — for that combo the
  // answer is always the same, so we pre-fill so Samantha doesn't have
  // to pick. The pump card stays visible and can be overridden.
  const pumpState = ins.codes["pump"];
  useEffect(() => {
    if (primaryInsurance !== "Medicaid" || serving !== "Insulin Pump") return;
    const patch: Partial<ProductCodeState> = {};
    if (!pumpState?.auth) patch.auth = "required";
    if (!pumpState?.sos) patch.sos = "clear";
    if (Object.keys(patch).length > 0) {
      onCodeChange("pump", patch);
    }
  }, [primaryInsurance, serving, pumpState?.auth, pumpState?.sos, onCodeChange]);

  return (
    <section className="rounded-xl border bg-card p-5 shadow-card space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Insurance & Benefits · Samantha</h2>
          <p className="text-xs text-muted-foreground">
            Work top to bottom. Each step unlocks the next.
          </p>
        </div>
      </div>

      {/* STEP 1 — Phone call universal checks
         (Serving + Primary Insurance now live in the Patient Profile card above.) */}
      <StepSection
        number={1}
        title="Call the payer · confirm universal checks"
        subtitle="Fill these from a phone call to the insurance payer. All three required."
        complete={universalDone}
        rightAccessory={
          <span
            className={cn(
              "text-[10px] font-mono px-2 py-1 rounded",
              universalDone ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
            )}
          >
            {universalCount}/3 confirmed
          </span>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {UNIVERSAL_CHECKS.map((check, i) => {
            const value: UniversalChoice = ins.universal[check.id] ?? "";
            const confirmed = value === "confirmed";
            const notConfirmed = value === "not-confirmed";
            return (
              <div
                key={check.id}
                className={cn(
                  "flex flex-col gap-2 p-3 rounded-lg border transition-colors",
                  confirmed && "border-success/40 bg-success/5",
                  notConfirmed && "border-destructive/40 bg-destructive/5",
                  !value && "bg-background",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-muted-foreground">CHECK 0{i + 1}</span>
                    <span className="font-medium text-sm">{check.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.hint}</p>
                </div>
                <Select
                  value={value || "__none__"}
                  onValueChange={(v) => onUniversalChange(check.id, (v === "__none__" ? "" : v) as UniversalChoice)}
                >
                  <SelectTrigger
                    className={cn(
                      "mt-auto h-9 text-sm font-medium",
                      confirmed && "bg-success/10 border-success/40 text-success",
                      notConfirmed && "bg-destructive/10 border-destructive/40 text-destructive",
                    )}
                  >
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not selected —</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="not-confirmed">Not Confirmed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </StepSection>

      {/* STEP 2 — Product cards */}
      <StepSection
        number={2}
        title="Product-Specific SoS and Auth Requirements"
        subtitle="For each product, select Auth Requirements and Same or Similar status."
        complete={
          dropdownsReady &&
          visibleResolved.length > 0 &&
          visibleResolved.every((r) => {
            const s = ins.codes[PRODUCT_TO_CODE_ID[r.product]];
            // Both Auth and SoS are required for every visible product.
            return !!s?.auth && !!s?.sos;
          })
        }
      >
        {!dropdownsReady && (
          <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Select Serving and Primary Insurance to load the codes for this patient.
            </p>
          </div>
        )}

        {dropdownsReady && visibleResolved.length === 0 && (
          <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              No product cards to display
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
              All products for this patient's serving type bill to Medicaid and are handled
              automatically. You can proceed with the universal checks above and send to
              Monday when ready.
            </p>
          </div>
        )}

        {dropdownsReady && visibleResolved.length > 0 && (
          <div className="space-y-3">
            {visibleResolved.map((r) => {
              const codeId = PRODUCT_TO_CODE_ID[r.product];
              const meta = PRODUCT_CODES.find((c) => c.id === codeId);
              if (!meta) return null;
              const state = ins.codes[codeId] ?? { status: "pending" as CodeStatus };
              return (
                <CodeCard
                  key={codeId}
                  meta={meta}
                  resolved={r}
                  state={state}
                  universalDone={universalDone}
                  onChange={(patch) => onCodeChange(codeId, patch)}
                />
              );
            })}
          </div>
        )}
      </StepSection>

      {/* Medicare A&B · Never Billed attestation boxes */}
      {primaryInsurance === "Medicare A&B" && (() => {
        const isState = ins.codes["infusion-sets"];
        const cartState = ins.codes["cartridges"];
        const showIsCar = isState?.sos === "clear" && cartState?.sos === "clear";
        const cgmState = ins.codes["cgm-sensors"];
        const showCgm = cgmState?.sos === "clear";
        if (!showIsCar && !showCgm) return null;
        return (
          <div className="space-y-3">
            {showIsCar && (
              <div className={cn(
                "rounded-xl border-2 p-4 transition-colors",
                ins.neverBilledIsCar
                  ? "border-success/40 bg-success/5"
                  : "border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20",
              )}>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="never-billed-is-car"
                    checked={!!ins.neverBilledIsCar}
                    onCheckedChange={(v) => onNeverBilledChange?.("neverBilledIsCar", !!v)}
                    className="mt-0.5"
                  />
                  <label htmlFor="never-billed-is-car" className="cursor-pointer">
                    <p className="text-sm font-semibold">E0784, A4224, and A4225 has never been billed for the patient</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Medicare A&B requires confirmation that infusion sets and cartridges have never been billed.
                    </p>
                  </label>
                </div>
                {ins.neverBilledIsCar && (
                  <div className="mt-2 ml-7 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span className="text-xs font-medium text-success">Confirmed</span>
                  </div>
                )}
              </div>
            )}
            {showCgm && (
              <div className={cn(
                "rounded-xl border-2 p-4 transition-colors",
                ins.neverBilledCgm
                  ? "border-success/40 bg-success/5"
                  : "border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/20",
              )}>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="never-billed-cgm"
                    checked={!!ins.neverBilledCgm}
                    onCheckedChange={(v) => onNeverBilledChange?.("neverBilledCgm", !!v)}
                    className="mt-0.5"
                  />
                  <label htmlFor="never-billed-cgm" className="cursor-pointer">
                    <p className="text-sm font-semibold">A4239, A4238, or E2103 has never been billed for the patient</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Medicare A&B requires confirmation that CGM codes have never been billed.
                    </p>
                  </label>
                </div>
                {ins.neverBilledCgm && (
                  <div className="mt-2 ml-7 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span className="text-xs font-medium text-success">Confirmed</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Reference Notes */}
      <NotesPanel
        notes={patient.notes}
        onNotesChange={onNotesChange}
        onSaveToMonday={onSaveNotesToMonday}
        description="Shared notes across Benefits, Submit Auth, and Auth Outstanding."
        placeholder="Reference notes..."
      />

      {/* Monday output */}
      {dropdownsReady && (
        <MondayOutput patient={patient} resolved={resolved} outcome={outcome} nextOrderDates={nextOrderDates} />
      )}
    </section>
  );
}

function StepSection({
  number,
  title,
  subtitle,
  complete,
  rightAccessory,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  complete?: boolean;
  rightAccessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-xl border-2 p-4 transition-colors border-border bg-muted/10",
    )}>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn(
            "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 border-2",
            complete
              ? "bg-success/15 text-success border-success/40"
              : "bg-background text-foreground border-border",
          )}>
            {number}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Step {number} · {title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {rightAccessory}
      </div>
      {children}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: ReturnType<typeof deriveInsuranceOutcome> }) {
  if (outcome === "all-clear") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-success/15 text-success">
        <CheckCircle2 className="h-3.5 w-3.5" /> All clear · ready for welcome call
      </span>
    );
  }
  if (outcome === "auth-required") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-warning/20 text-warning-foreground">
        <Clock className="h-3.5 w-3.5" /> Auth required
      </span>
    );
  }
  if (outcome === "blocker") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-destructive/15 text-destructive border border-destructive/30">
        <AlertTriangle className="h-3.5 w-3.5" /> Escalate
      </span>
    );
  }
  return null;
}

interface CardProps {
  meta: typeof PRODUCT_CODES[number];
  resolved: ResolvedProduct;
  state: ProductCodeState;
  universalDone: boolean;
  onChange: (patch: Partial<ProductCodeState>) => void;
}

/** Same-or-Similar lookback window per product. Pump and CGM Monitor get
 *  a 4-year lookback (capital DME); everything else is 90 days. */
const SOS_LOOKBACK_DAYS: Record<string, number> = {
  "pump": 365 * 4,
  "cgm-monitor": 365 * 4,
};

function sosClearBeforeDate(productId: string): { date: string; isLong: boolean } {
  const days = SOS_LOOKBACK_DAYS[productId] ?? 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const mm = String(cutoff.getMonth() + 1).padStart(2, "0");
  const dd = String(cutoff.getDate()).padStart(2, "0");
  const yyyy = cutoff.getFullYear();
  return { date: `${mm}/${dd}/${yyyy}`, isLong: days > 90 };
}

function CodeCard({ meta, resolved, state, universalDone, onChange }: CardProps) {
  const billsToMedicaid = resolved.billsTo === "medicaid";
  const auth: AuthChoice = state.auth ?? "";
  const sos: SosChoice = state.sos ?? "";
  const isRecurring = meta.cadence === "RECURRING";

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 border border-border bg-background p-4",
        isRecurring ? "border-l-primary" : "border-l-accent-foreground/40",
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full",
                isRecurring
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-foreground/70 border border-border",
              )}
            >
              {isRecurring ? <Repeat className="h-3 w-3" /> : <Package className="h-3 w-3" />}
              {meta.cadence}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">{meta.group}</span>
          </div>
          <h4 className="text-sm font-semibold">{meta.name}</h4>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs font-mono text-muted-foreground">HCPCS · {resolved.hcpc}</p>
            {billsToMedicaid && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                Bills to Medicaid
              </span>
            )}
          </div>
        </div>
        <StatusPill auth={auth} sos={sos} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Auth Requirements
          </label>
          <Select
            value={auth || "__none__"}
            onValueChange={(v) => {
              const next = (v === "__none__" ? "" : v) as AuthChoice;
              const patch: Partial<ProductCodeState> = { auth: next };
              // When auth = required, auto-select SoS to Skip.
              // The user can still override to Clear or Not Clear.
              if (next === "required") {
                patch.sos = "skip";
              }
              onChange(patch);
            }}
          >
            <SelectTrigger
              className={cn(
                "mt-1 h-9 font-medium",
                auth === "required" && "bg-warning/15 border-warning/50 text-warning-foreground",
                auth === "not-required" && "bg-success/10 border-success/40 text-success",
              )}
            >
              <SelectValue placeholder="Select auth status…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Not selected —</SelectItem>
              <SelectItem value="not-required">Not Required</SelectItem>
              <SelectItem value="required">Required</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Same or Similar
          </label>
          <Select
            value={sos || "__none__"}
            onValueChange={(v) => { const newSos = (v === "__none__" ? "" : v) as SosChoice; onChange(newSos === "not-clear" ? { sos: newSos } : { sos: newSos, lastBillDate: "" }); }}
          >
            <SelectTrigger
              className={cn(
                "mt-1 h-9 font-medium",
                sos === "not-clear" && "bg-warning/15 border-warning/50 text-warning-foreground",
                sos === "clear" && "bg-success/10 border-success/40 text-success",
                sos === "skip" && "bg-sky-50 border-sky-300 text-sky-800 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-200",
              )}
            >
              <SelectValue placeholder="Select SoS status…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Not selected —</SelectItem>
              <SelectItem value="clear">Clear</SelectItem>
              <SelectItem value="not-clear">Not Clear</SelectItem>
              <SelectItem value="skip">Skip (defer until auth resolved)</SelectItem>
            </SelectContent>
          </Select>
          {(() => {
            const { date, isLong } = sosClearBeforeDate(meta.id);
            return (
              <p className="mt-1 text-[10px] text-muted-foreground leading-tight">
                Last bill must be before{" "}
                <span className="font-semibold text-foreground">{date}</span>
                <span className="ml-1 text-muted-foreground/80">
                  ({isLong ? "4 yr" : "90 day"} lookback)
                </span>
              </p>
            );
          })()}
        </div>
      </div>

      {/* Last Bill Date — appears when SoS = Not Clear */}
      {sos === "not-clear" && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-warning-foreground/80 mb-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {meta.name} Last Bill Date
          </label>
          <p className="text-[11px] text-muted-foreground mb-2">
            {meta.name} last bill date
          </p>
          <Input
            type="date"
            value={state.lastBillDate ?? ""}
            onChange={(e) => onChange({ lastBillDate: e.target.value })}
            className="max-w-xs h-9 bg-background border-warning/30 focus-visible:ring-warning/40"
          />
        </div>
      )}
    </div>
  );
}

function StatusPill({ auth, sos }: { auth: AuthChoice; sos: SosChoice }) {
  if (!auth || !sos) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-muted text-muted-foreground">
        <Clock className="h-3 w-3" /> Pending
      </span>
    );
  }
  if (sos === "not-clear") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-warning/20 text-warning-foreground">
        <ShieldAlert className="h-3 w-3" /> SoS not clear
      </span>
    );
  }
  if (auth === "required") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-warning/20 text-warning-foreground">
        <Clock className="h-3 w-3" /> Auth required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-success/15 text-success">
      <ShieldCheck className="h-3 w-3" /> Clear
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Monday.com output — copy/paste helper
// ─────────────────────────────────────────────────────────────────────

function deriveMondayColumns(patient: Patient, resolved: ResolvedProduct[]) {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const u = ins.universal;

  const universalAllConfirmed =
    u["in-network"] === "confirmed" &&
    u["active"] === "confirmed" &&
    u["dme-benefits"] === "confirmed";
  const anyUniversalNotConfirmed = Object.values(u).some((v) => v === "not-confirmed");

  // 1) Active/Network — both must be confirmed
  const activeNetwork =
    u["in-network"] === "confirmed" && u["active"] === "confirmed" ? "Active/In-network" : "Stuck";

  // 2) DME Benefits
  const dmeBenefits = u["dme-benefits"] === "confirmed" ? "Yes" : "Partial / No";

  // Per-product states (only those active for this serving).
  // Medicaid-billed infusion sets / cartridges are auto-filled to
  // Auth=Required, SoS=Clear (the user doesn't see them in the UI; the
  // SoS check is conceptually "skipped" so we treat it as not-not-clear
  // for the aggregate roll-up).
  const productStates = resolved.map((r) => {
    const codeId = PRODUCT_TO_CODE_ID[r.product];
    const s = ins.codes[codeId];
    if (isAutoFilledMedicaidSupply(r)) {
      return {
        product: r.product,
        label: PRODUCT_LABELS[r.product],
        auth: "required" as AuthChoice,
        sos: "clear" as SosChoice,
      };
    }
    return {
      product: r.product,
      label: PRODUCT_LABELS[r.product],
      auth: (s?.auth ?? "") as AuthChoice,
      sos: (s?.sos ?? "") as SosChoice,
    };
  });

  // SoS is now always required regardless of Auth — a product is filled when
  // both Auth and SoS are picked.
  const allFilled =
    productStates.length > 0 &&
    productStates.every((p) => !!p.auth && !!p.sos);

  // 3) Auth — only depends on auth selections, not SoS
  const anyAuthRequired = productStates.some((p) => p.auth === "required");
  const allAuthsFilled =
    productStates.length > 0 && productStates.every((p) => !!p.auth);
  const auth = !allAuthsFilled ? "—" : anyAuthRequired ? "Auths Required" : "No Auths Required";

  // 4) SoS — count every product. Priority: not-clear > skip > clear.
  const anyNotClear = productStates.some((p) => p.sos === "not-clear");
  const anySkip = productStates.some((p) => p.sos === "skip");
  const pumpNotClear = productStates.some((p) => p.product === "insulin_pump" && p.sos === "not-clear");
  const sosCol = !allFilled
    ? "—"
    : anyNotClear
      ? "Partial / Not Clear"
      : anySkip
        ? "Skip"
        : "All Clear";

  // 5) Not Clear Products — list every product whose SoS came back not clear.
  const notClearProducts = productStates
    .filter((p) => p.sos === "not-clear")
    .map((p) => p.label)
    .join(", ");

  // 5b) Skip SoS Products — list every product whose SoS was skipped.
  const skipSosProducts = productStates
    .filter((p) => p.sos === "skip")
    .map((p) => p.label)
    .join(", ");

  // 6) Stage Advancer
  // - If any universal not confirmed OR pump SoS not clear → "Benefits / SoS"
  // - Else if all clear → "Complete"
  // - Else (still working / not all filled) → "Benefits / SoS"
  let stageAdvancer: string;
  if (anyUniversalNotConfirmed || !universalAllConfirmed || !allFilled || pumpNotClear) {
    stageAdvancer = "Benefits / SoS";
  } else if (anyAuthRequired) {
    stageAdvancer = "Authorization";
  } else {
    stageAdvancer = "Complete";
  }

  // 7) Escalation column
  // Only escalate for universal not confirmed or pump SoS not clear.
  // Other products being not-clear on SoS do not trigger escalation.
  const shouldEscalate = anyUniversalNotConfirmed || pumpNotClear;
  const escalation = shouldEscalate ? "Escalation Required" : "—";

  return {
    activeNetwork,
    dmeBenefits,
    auth,
    sos: sosCol,
    notClearProducts: notClearProducts || "—",
    skipSosProducts: skipSosProducts || "—",
    stageAdvancer,
    escalation,
    allFilled,
    shouldEscalate,
  };
}

/** Derive the Never Billed Monday columns for the preview. */
function deriveNeverBilledColumns(patient: Patient) {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const isMedicareAB = patient.primaryInsurance === "Medicare A&B";
  const isState = ins.codes["infusion-sets"];
  const cartState = ins.codes["cartridges"];
  const cgmState = ins.codes["cgm-sensors"];
  const showIsCar = isMedicareAB && isState?.sos === "clear" && cartState?.sos === "clear";
  const showCgm = isMedicareAB && cgmState?.sos === "clear";
  return {
    showIsCar,
    showCgm,
    neverBilledIsCar: showIsCar && !!ins.neverBilledIsCar ? "Never Billed" : showIsCar ? "—" : null,
    neverBilledCgm: showCgm && !!ins.neverBilledCgm ? "Never Billed" : showCgm ? "—" : null,
  };
}

// Monday auth-result column labels per product
const PRODUCT_AUTH_COLUMN: Record<ProductId, string> = {
  monitor: "CGM auth result",
  sensors: "Sensors auth result",
  insulin_pump: "Insulin pump auth result",
  infusion_set: "Infusion set auth result",
  cartridge: "Cartridges auth result",
};

const ALL_AUTH_PRODUCTS: ProductId[] = ["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"];

const GOOD_VALUES = new Set(["Active/In-network", "Yes", "No Auths Required", "All Clear", "Complete", "Never Billed"]);
const WARN_VALUES = new Set(["Stuck", "Partial / No", "Auths Required", "Partial / Not Clear", "Authorization", "Benefits / SoS"]);
const BAD_VALUES = new Set(["Escalation Required"]);
const SKIP_VALUES = new Set(["Skip"]);
function valueTone(v: string): "good" | "warn" | "bad" | "skip" | "neutral" {
  if (GOOD_VALUES.has(v)) return "good";
  if (WARN_VALUES.has(v)) return "warn";
  if (BAD_VALUES.has(v)) return "bad";
  if (SKIP_VALUES.has(v)) return "skip";
  return "neutral";
}

function MondayOutput({
  patient,
  resolved,
  outcome,
  nextOrderDates,
}: {
  patient: Patient;
  resolved: ResolvedProduct[];
  outcome: ReturnType<typeof deriveInsuranceOutcome>;
  nextOrderDates: import("@/lib/samantha/workflow").NextOrderDates;
}) {
  const cols = deriveMondayColumns(patient, resolved);
  const nb = deriveNeverBilledColumns(patient);
  const ins = patient.insurance ?? EMPTY_INSURANCE;

  const rows: { key: string; label: string; value: string }[] = [
    { key: "active", label: "Active/Network", value: cols.activeNetwork },
    { key: "dme", label: "DME Benefits", value: cols.dmeBenefits },
    { key: "auth", label: "Auth", value: cols.auth },
    { key: "sos", label: "SoS", value: cols.sos },
    { key: "notclear", label: "Not Clear Products", value: cols.notClearProducts },
    { key: "skipsos", label: "Skip SoS Products", value: cols.skipSosProducts },
    { key: "stage", label: "Stage Advancer", value: cols.stageAdvancer },
    { key: "escalation", label: "Escalation", value: cols.escalation },
    ...(nextOrderDates.ipNextOrderDate
      ? [{ key: "nod-ip", label: "IP Next Order Date", value: formatDateDisplay(nextOrderDates.ipNextOrderDate) }]
      : []),
    ...(nextOrderDates.sensorsNextOrderDate
      ? [{ key: "nod-sensors", label: "Sensors Next Order Date", value: formatDateDisplay(nextOrderDates.sensorsNextOrderDate) }]
      : []),
    ...(nextOrderDates.suppliesNextOrderDate
      ? [{ key: "nod-supplies", label: "Supplies Next Order Date", value: formatDateDisplay(nextOrderDates.suppliesNextOrderDate) }]
      : []),
    ...(nb.neverBilledIsCar !== null
      ? [{ key: "nb-iscar", label: "Never billed IS/Car", value: nb.neverBilledIsCar }]
      : []),
    ...(nb.neverBilledCgm !== null
      ? [{ key: "nb-cgm", label: "Never billed CGM", value: nb.neverBilledCgm }]
      : []),
  ];

  // Auth result columns: show all 5 only if any product requires auth.
  // Medicaid-billed supplies are auto-Required (they're hidden in the UI
  // but still need to land on Monday with Auth Result = "Required").
  const isProductAuthRequired = (r: ResolvedProduct) =>
    isAutoFilledMedicaidSupply(r)
      ? true
      : ins.codes[PRODUCT_TO_CODE_ID[r.product]]?.auth === "required";
  const anyAuthRequired = resolved.some(isProductAuthRequired);
  const requiredSet = new Set(
    resolved.filter(isProductAuthRequired).map((r) => r.product),
  );
  const servedSet = new Set(resolved.map((r) => r.product));
  const authResultRows = anyAuthRequired
    ? ALL_AUTH_PRODUCTS.map((p) => ({
        key: `auth-${p}`,
        label: PRODUCT_AUTH_COLUMN[p],
        value: requiredSet.has(p)
          ? "Required"
          : servedSet.has(p)
            ? "No Auth Needed"
            : "Not Serving",
      }))
    : [];

  return (
    <div className="space-y-4">
      {/* Part 1 — main columns */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Monday board · main columns</h3>
            <p className="text-[11px] text-muted-foreground">
              Pick the matching dropdown option for each column on the Monday board.
            </p>
          </div>
        </div>

        <div className="rounded-md border bg-background divide-y">
          {rows.map((r) => {
            const tone = valueTone(r.value);
            return (
              <div key={r.key} className="grid grid-cols-[220px_1fr] items-center gap-3 px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {r.label}
                </span>
                <span
                  className={cn(
                    "inline-flex w-fit items-center px-2 py-0.5 rounded text-sm font-medium",
                    tone === "good" && "bg-success/15 text-success",
                    tone === "warn" && "bg-warning/20 text-warning-foreground",
                    tone === "bad" && "bg-destructive/15 text-destructive border border-destructive/30",
                    tone === "skip" && "bg-sky-400/20 text-sky-700 dark:text-sky-300 border border-sky-500/40",
                    tone === "neutral" && "font-mono text-foreground",
                  )}
                >
                  {r.value}
                </span>
              </div>
            );
          })}
        </div>

        {!cols.allFilled && (
          <p className="text-[11px] text-muted-foreground italic">
            Fill Auth + SoS for every product to compute Auth and SoS columns.
          </p>
        )}
      </div>

      {/* Part 2 — product-specific auth result columns */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Monday board · product-specific auth result columns</h3>
          <p className="text-[11px] text-muted-foreground">
            {anyAuthRequired
              ? 'Set each of the 5 auth result columns on the Monday board to the value below.'
              : 'No auths required — leave the auth result columns blank on the Monday board.'}
          </p>
        </div>

        {anyAuthRequired && (
          <div className="rounded-md border bg-background divide-y">
            {authResultRows.map((r) => (
              <div key={r.key} className="grid grid-cols-[220px_1fr] items-center gap-3 px-3 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {r.label}
                </span>
                <span
                  className={cn(
                    "inline-flex w-fit items-center px-2 py-0.5 rounded text-sm font-medium",
                    r.value === "Required" && "bg-warning/20 text-warning-foreground",
                    r.value === "Not Serving" && "bg-success/15 text-success",
                    r.value === "No Auth Needed" && "bg-sky-500/15 text-sky-700 dark:text-sky-300",
                  )}
                >
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
