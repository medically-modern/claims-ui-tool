import {
  Patient,
  PRODUCT_CODES,
  ProductCodeId,
  ProductCodeState,
  EMPTY_INSURANCE,
  AUTH_SUBMISSION_METHODS,
  AuthSubmissionMethod,
  SosChoice,
} from "@/lib/samantha/workflow";
import {
  resolveHcpcs,
  isAutoFilledMedicaidSupply,
  PRODUCT_LABELS,
  type ProductId,
  type ResolvedProduct,
} from "@/lib/samantha/hcpcRules";
import { Input } from "@/components/ui/input";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Repeat, Send, Inbox, ShieldCheck, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClinicalsDownloadButton } from "./ClinicalsDownloadButton";
import { FinalClinicalsUpload } from "./FinalClinicalsUpload";

interface Props {
  patient: Patient;
  onCodeChange: (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => void;
  onNotesChange: (v: string) => void;
  onSaveNotesToMonday?: (notes: string) => Promise<void>;
}

const PRODUCT_TO_CODE_ID: Record<ProductId, ProductCodeId> = {
  monitor: "cgm-monitor",
  sensors: "cgm-sensors",
  insulin_pump: "pump",
  infusion_set: "infusion-sets",
  cartridge: "cartridges",
};

export function AuthOutstandingPanel({ patient, onCodeChange, onNotesChange, onSaveNotesToMonday }: Props) {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const serving = patient.serving || "";
  const primaryInsurance = patient.primaryInsurance || "";
  const dropdownsReady = !!serving && !!primaryInsurance;

  const resolved: ResolvedProduct[] = resolveHcpcs(
    primaryInsurance || null,
    serving || null,
    patient.secondaryInsurance ?? null,
  );

  // Hide infusion sets / cartridges that bill to Medicaid — Medicaid handles
  // auth approvals on its own; nothing for the user to track here.
  const visibleResolved = resolved.filter((r) => !isAutoFilledMedicaidSupply(r));

  // Only visible products that require auth
  const authRequired = visibleResolved.filter(
    (r) => ins.codes[PRODUCT_TO_CODE_ID[r.product]]?.auth === "required",
  );

  return (
    <section className="rounded-xl border bg-card p-5 shadow-card space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Authorizations Outstanding</h2>
          <p className="text-xs text-muted-foreground">
            Review submission info and enter approval details for each required product.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FinalClinicalsUpload itemId={patient.id} />
          <ClinicalsDownloadButton itemId={patient.id} />
        </div>
      </div>

      {!dropdownsReady && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Select Serving and Primary Insurance on the Benefits tab to load auth-eligible products.
          </p>
        </div>
      )}

      {dropdownsReady && (
        <AuthRequirementsMatrix
          resolved={resolved}
          medicaidProducts={new Set(resolved.filter(isAutoFilledMedicaidSupply).map((r) => r.product))}
          ins={ins}
        />
      )}


            {dropdownsReady && authRequired.length === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No products with auth required found.
          </p>
        </div>
      )}

      {dropdownsReady && authRequired.length > 0 && (
        <div className="space-y-4">
          {authRequired.map((r) => {
            const codeId = PRODUCT_TO_CODE_ID[r.product];
            const meta = PRODUCT_CODES.find((c) => c.id === codeId);
            if (!meta) return null;
            const state = ins.codes[codeId] ?? { status: "pending" as const };
            return (
              <ProductAuthBlock
                key={codeId}
                meta={meta}
                resolved={r}
                state={state}
                onChange={(patch) => onCodeChange(codeId, patch)}
                primaryInsurance={primaryInsurance}
              />
            );
          })}
        </div>
      )}

      {/* Notes — same Call Reference Notes column as Benefits + Submit Auth.
          Carries the running log forward so anything Samantha logs at the
          outstanding-auth step lands in the same place. */}
      <NotesPanel
        notes={patient.notes}
        onNotesChange={onNotesChange}
        onSaveToMonday={onSaveNotesToMonday}
        description="Carries over from Benefits + Submit Auth. Add anything from approval / denial follow-up."
        placeholder="Approval / denial details, rep names, follow-up actions…"
      />
    </section>
  );
}

interface BlockProps {
  meta: typeof PRODUCT_CODES[number];
  resolved: ResolvedProduct;
  state: ProductCodeState;
  onChange: (patch: Partial<ProductCodeState>) => void;
  primaryInsurance: string;
}

function ProductAuthBlock({ meta, resolved, state, onChange, primaryInsurance }: BlockProps) {
  const isRecurring = meta.cadence === "RECURRING";

  return (
    <div
      className={cn(
        "rounded-xl border-l-4 border bg-card overflow-hidden",
        isRecurring ? "border-l-primary" : "border-l-accent-foreground/40",
      )}
    >
      {/* Product header */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-muted/30 border-b">
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
          <p className="text-xs font-mono text-muted-foreground">HCPCS · {resolved.hcpc}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-warning/20 text-warning-foreground">
          Auth Required
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 bg-muted/20">

        {/* STEP 1 — Submit Auth (read-only EXCEPT Auth ID) */}
        <StageBlock
          title="Submit Auth"
          subtitle="Read-only — submitted previously"
          tone="active"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <FieldLabel>Auth Submission Method</FieldLabel>
              <div className="mt-1 h-9 flex items-center px-3 rounded-md border bg-muted text-sm font-medium text-foreground/80">
                {state.authSubmissionMethod || "—"}
              </div>
            </div>
            <div>
              <FieldLabel>Auth Submission Date</FieldLabel>
              <div className="mt-1 h-9 flex items-center px-3 rounded-md border bg-muted text-sm text-foreground/80">
                {state.authSubmissionDate || "—"}
              </div>
            </div>
            <div>
              <FieldLabel>Auth ID</FieldLabel>
              <div className="mt-1 h-9 flex items-center px-3 rounded-md border bg-muted text-sm font-mono text-foreground/80">
                {state.authId || "—"}
              </div>
            </div>
            {primaryInsurance === "Horizon BCBS" && state.authSubmissionMethod === "Payer Portal" && (
              <div className="sm:col-span-2">
                <FieldLabel>Intake ID · Carecentrix</FieldLabel>
                <div className="mt-1 h-9 flex items-center px-3 rounded-md border bg-muted text-sm font-mono text-foreground/80">
                  {state.intakeId || "—"}
                </div>
              </div>
            )}
          </div>
        </StageBlock>

        {/* STEP 2 — Authorizations Outstanding (fully editable) */}
        <StageBlock
          title="Authorizations Outstanding"
          subtitle="Enter approval details"
          tone="waiting"
        >
          {(() => {
            const noAuthNeeded = state.authOutstandingResult === "no-auth-needed";
            // Display-only placeholder for the Units field — typical
            // approved unit count by product. Not used as a default value.
            const unitsPlaceholderByProduct: Record<ProductId, string> = {
              monitor: "1",
              sensors: "12",
              insulin_pump: "1",
              infusion_set: "30",
              cartridge: "30",
            };
            const unitsPlaceholder = unitsPlaceholderByProduct[resolved.product] ?? "";
            return (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {/* Same or Similar — editable, same options as Benefits */}
            <div className="sm:col-span-5">
              <FieldLabel>Same or Similar</FieldLabel>
              <Select
                value={(state.sos as string) || "__none__"}
                onValueChange={(v) => {
                  const newSos = (v === "__none__" ? "" : v) as "clear" | "not-clear" | "skip" | "";
                  onChange(newSos === "not-clear" ? { sos: newSos } : { sos: newSos, lastBillDate: "" });
                }}
              >
                <SelectTrigger
                  className={cn(
                    "mt-1 h-9 font-medium",
                    state.sos === "not-clear" && "bg-warning/15 border-warning/50 text-warning-foreground",
                    state.sos === "clear" && "bg-success/10 border-success/40 text-success",
                    state.sos === "skip" && "bg-sky-50 border-sky-300 text-sky-800 dark:bg-sky-950/40 dark:border-sky-800 dark:text-sky-200",
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
              {state.sos === "not-clear" && (
                <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
                  <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-warning-foreground/80 mb-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {meta.name} Last Bill Date
                  </label>
                  <Input
                    type="date"
                    value={state.lastBillDate ?? ""}
                    onChange={(e) => onChange({ lastBillDate: e.target.value })}
                    className="max-w-xs h-9 bg-background border-warning/30 focus-visible:ring-warning/40"
                  />
                </div>
              )}
            </div>
            <div className="sm:col-span-5">
              <FieldLabel>Auth Result</FieldLabel>
              <Select
                value={state.authOutstandingResult || "__none__"}
                onValueChange={(v) => {
                  const next = (v === "__none__" ? "" : v) as
                    | "auth-valid"
                    | "denied"
                    | "no-auth-needed"
                    | "";
                  // Picking No Auth Needed wipes the per-product auth
                  // metadata in one shot — there is no auth so the
                  // ID / dates / units don't apply.
                  if (next === "no-auth-needed") {
                    onChange({
                      authOutstandingResult: next,
                      authId: "",
                      authStart: "",
                      authEnd: "",
                      authUnits: "",
                    });
                  } else {
                    onChange({ authOutstandingResult: next });
                  }
                }}
              >
                <SelectTrigger className={cn(
                  "mt-1 h-9 font-medium",
                  state.authOutstandingResult === "auth-valid" && "bg-green-50 border-green-400 text-green-700",
                  state.authOutstandingResult === "denied" && "bg-red-50 border-red-400 text-red-700",
                  state.authOutstandingResult === "no-auth-needed" && "bg-sky-50 border-sky-400 text-sky-700",
                  !state.authOutstandingResult && "bg-background",
                )}>
                  <SelectValue placeholder="Select result…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Select —</SelectItem>
                  <SelectItem value="auth-valid">Auth Valid</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                  <SelectItem value="no-auth-needed">No Auth Needed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {state.sos === "skip" && state.authOutstandingResult === "no-auth-needed" && (
              <div className="sm:col-span-5 rounded-md border border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30 p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <FieldLabel>Same or Similar — recheck</FieldLabel>
                  <span className="text-[10px] text-muted-foreground italic">
                    Skipped at Benefits — confirm now that no auth was needed.
                  </span>
                </div>
                <Select
                  value={state.sosRecheck || "__none__"}
                  onValueChange={(v) => {
                    const next = (v === "__none__" ? "" : v) as "" | "clear" | "not-clear";
                    onChange({ sosRecheck: next });
                  }}
                >
                  <SelectTrigger className={cn(
                    "h-9 font-medium bg-background",
                    state.sosRecheck === "clear" && "bg-success/10 border-success/40 text-success",
                    state.sosRecheck === "not-clear" && "bg-warning/15 border-warning/50 text-warning-foreground",
                  )}>
                    <SelectValue placeholder="Select Clear / Not Clear…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not selected —</SelectItem>
                    <SelectItem value="clear">Clear</SelectItem>
                    <SelectItem value="not-clear">Not Clear</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {noAuthNeeded && (
              <div className="sm:col-span-5 rounded-md border border-warning/40 bg-warning/5 p-3">
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
            <div className="sm:col-span-5">
              <FieldLabel>Auth ID</FieldLabel>
              <Input
                value={state.authId ?? ""}
                onChange={(e) => onChange({ authId: e.target.value })}
                placeholder={noAuthNeeded ? "—" : "e.g. 123456"}
                disabled={noAuthNeeded}
                className="mt-1 h-9 bg-background font-mono text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Auth Start</FieldLabel>
              <Input
                type="date"
                value={state.authStart ?? ""}
                onChange={(e) => onChange({ authStart: e.target.value })}
                disabled={noAuthNeeded}
                className="mt-1 h-9 bg-background"
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Auth End</FieldLabel>
              <Input
                type="date"
                value={state.authEnd ?? ""}
                onChange={(e) => onChange({ authEnd: e.target.value })}
                disabled={noAuthNeeded}
                className="mt-1 h-9 bg-background"
              />
            </div>
            <div>
              <FieldLabel>Units</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={state.authUnits ?? ""}
                onChange={(e) => onChange({ authUnits: e.target.value })}
                placeholder={noAuthNeeded ? "—" : unitsPlaceholder}
                disabled={noAuthNeeded}
                className="mt-1 h-9 bg-background"
              />
            </div>
          </div>
            );
          })()}
        </StageBlock>
      </div>
    </div>
  );
}

function StageBlock({
  title,
  subtitle,
  tone = "active",
  children,
}: {
  title: string;
  subtitle?: string;
  tone?: "active" | "waiting";
  children: React.ReactNode;
}) {
  // tone === "active"  → Step 1 (read-only reference; dimmed so the eye skips it)
  // tone === "waiting" → Step 2 (the editable focus area; pops with color + ring)
  const isActive = tone === "active";
  const palette = isActive
    ? {
        cardBorder: "border-border/60 bg-muted/30",
        cardOuter: "opacity-90",
        headerBg: "bg-muted/40 border-border/60",
        body: "bg-muted/20",
      }
    : {
        cardBorder: "border-[#0F4C5C]/55 ring-2 ring-[#0F4C5C]/20 shadow-elevate",
        cardOuter: "",
        headerBg: "bg-[#0F4C5C]/15 border-[#0F4C5C]/30",
        body: "bg-background",
      };

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden flex flex-col",
        palette.cardBorder,
        palette.cardOuter,
      )}
    >
      <div className={cn("flex items-center gap-3 px-4 py-3 border-b", palette.headerBg)}>
        <div className="min-w-0 flex-1">
          <h5 className="text-sm font-semibold leading-tight">{title}</h5>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      <div className={cn("p-4 flex-1", palette.body)}>{children}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}

function AuthRequirementsMatrix({
  resolved,
  medicaidProducts,
  ins,
}: {
  resolved: ResolvedProduct[];
  /** Products whose supplies route to Medicaid for this patient.
   *  Renders an "E-paces DVS" pill alongside the Required status. */
  medicaidProducts: Set<ProductId>;
  ins: { codes: Partial<Record<ProductCodeId, ProductCodeState>> };
}) {
  const ALL: ProductId[] = ["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"];
  const servedSet = new Set(resolved.map((r) => r.product));

  return (
    <div className="rounded-xl border-2 border-border bg-muted/10 p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="h-8 w-8 rounded-full bg-background border-2 border-border flex items-center justify-center shrink-0">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Auth Status from Monday</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Read-only — these values are pulled directly from the Monday board.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {ALL.map((p) => {
          const codeId = PRODUCT_TO_CODE_ID[p];
          const isServed = servedSet.has(p);
          const state = ins.codes[codeId];
          const label = state?._mondayAuthLabel || "";
          const isNotServing = label.toLowerCase() === "not serving";
          const isRequired = label.toLowerCase() === "required";
          const isNoAuth = label.toLowerCase() === "no auth needed";
          const isSubmitted = label.toLowerCase() === "submitted";
          const isMedicaidRouted = medicaidProducts.has(p);

          return (
            <div
              key={p}
              className={cn(
                "rounded-lg border p-3 bg-background flex flex-col gap-2",
                isNotServing && "opacity-60",
                isRequired && "border-warning/50 bg-warning/5",
                isSubmitted && "border-emerald-300/60 bg-emerald-50/50",
                isNoAuth && "border-success/40 bg-success/5",
              )}
            >
              <div>
                <p className="text-sm font-semibold leading-tight">{PRODUCT_LABELS[p]}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                  {isServed && !isNotServing ? "Serving" : "Not Serving"}
                </p>
              </div>
              <div className="mt-auto flex flex-col gap-1.5">
                {/* Always render the pill slot so every card reserves the
                    same vertical space — invisible when not Medicaid-routed. */}
                <span
                  aria-hidden={!isMedicaidRouted}
                  className={cn(
                    "self-start inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap border",
                    isMedicaidRouted
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40"
                      : "invisible border-transparent",
                  )}
                >
                  E-paces DVS
                </span>
                <div
                  className={cn(
                    "h-9 flex items-center px-3 rounded-md border text-sm font-medium bg-muted",
                    isRequired && "bg-warning/15 border-warning/50 text-warning-foreground",
                    isSubmitted && "bg-emerald-100 border-emerald-300 text-emerald-800",
                    isNoAuth && "bg-success/10 border-success/40 text-success",
                    isNotServing && "text-muted-foreground",
                  )}
                >
                  {label || "—"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
