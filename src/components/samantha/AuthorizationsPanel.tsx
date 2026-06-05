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
import { CalendarDays, Package, Repeat, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClinicalsDownloadButton } from "./ClinicalsDownloadButton";

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

export function AuthorizationsPanel({ patient, onCodeChange, onNotesChange, onSaveNotesToMonday }: Props) {
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
  // the auth flow on its own, so the user has nothing to submit here.
  const visibleResolved = resolved.filter((r) => !isAutoFilledMedicaidSupply(r));

  // Only visible products that require auth
  const authRequired = visibleResolved.filter(
    (r) => ins.codes[PRODUCT_TO_CODE_ID[r.product]]?.auth === "required",
  );

  return (
    <section className="rounded-xl border bg-card p-5 shadow-card space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Submit Auth</h2>
          <p className="text-xs text-muted-foreground">
            Submit auth for each required product.
          </p>
        </div>
        <ClinicalsDownloadButton itemId={patient.id} />
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
            Set a product above to <span className="font-semibold">Required</span> to track its
            submission and outstanding approval below.
          </p>
        </div>
      )}

      {dropdownsReady && authRequired.length > 0 && (() => {
        // Carecentrix Intake ID is shared across all auth-required products —
        // there's only ever one ID per patient. Derive the shared value once
        // from the first non-empty intakeId, and provide a setter that fans
        // the change out to every auth-required product so they stay in sync.
        const sharedIntakeId =
          authRequired
            .map((r) => ins.codes[PRODUCT_TO_CODE_ID[r.product]]?.intakeId)
            .find((v) => !!v) ?? "";
        const setIntakeIdForAll = (value: string) => {
          for (const r of authRequired) {
            onCodeChange(PRODUCT_TO_CODE_ID[r.product], { intakeId: value });
          }
        };

        return (
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
                  sharedIntakeId={sharedIntakeId}
                  onSharedIntakeIdChange={setIntakeIdForAll}
                />
              );
            })}
          </div>
        );
      })()}

      {/* Notes — same Call Reference Notes column as the Benefits tab. */}
      <NotesPanel
        notes={patient.notes}
        onNotesChange={onNotesChange}
        onSaveToMonday={onSaveNotesToMonday}
        description="Carries over from the Benefits tab. Add anything new from the auth submission step."
        placeholder="Auth submission notes, confirmation numbers, any rep feedback…"
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
  /** Shared Carecentrix Intake ID derived once and kept in sync across products. */
  sharedIntakeId: string;
  onSharedIntakeIdChange: (value: string) => void;
}

function ProductAuthBlock({
  meta,
  resolved,
  state,
  onChange,
  primaryInsurance,
  sharedIntakeId,
  onSharedIntakeIdChange,
}: BlockProps) {
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

      {/* Submit Auth fields */}
      <div className="p-4 bg-muted/20">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(() => {
            const isCallOrFax =
              state.authSubmissionMethod === "Call" || state.authSubmissionMethod === "Fax";
            return (
              <div className={isCallOrFax ? "" : "sm:col-span-2"}>
                <FieldLabel>Auth Submission Method</FieldLabel>
                <Select
                  value={state.authSubmissionMethod || "__none__"}
                  onValueChange={(v) =>
                    onChange({
                      authSubmissionMethod: (v === "__none__" ? "" : v) as AuthSubmissionMethod,
                    })
                  }
                >
                  <SelectTrigger className="mt-1 h-9 bg-background font-medium">
                    <SelectValue placeholder="Select submission method…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not selected —</SelectItem>
                    {AUTH_SUBMISSION_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })()}
          {(state.authSubmissionMethod === "Call" || state.authSubmissionMethod === "Fax") && (
            <div>
              <FieldLabel>
                {state.authSubmissionMethod === "Call" ? "Call Number" : "Fax Number"}
              </FieldLabel>
              <Input
                value={state.callFaxNumber ?? ""}
                onChange={(e) => onChange({ callFaxNumber: e.target.value })}
                placeholder="e.g. (555) 123-4567"
                className="mt-1 h-9 bg-background font-mono text-sm"
              />
            </div>
          )}
          <div>
            <FieldLabel>Auth Submission Date</FieldLabel>
            <Input
              type="date"
              value={state.authSubmissionDate ?? ""}
              onChange={(e) => onChange({ authSubmissionDate: e.target.value })}
              className="mt-1 h-9 bg-background"
            />
          </div>
          <div>
            <FieldLabel>Auth ID</FieldLabel>
            <Input
              value={state.authId ?? ""}
              onChange={(e) => onChange({ authId: e.target.value })}
              placeholder="e.g. 123456"
              className="mt-1 h-9 bg-background font-mono text-sm"
            />
          </div>
          {primaryInsurance === "Horizon BCBS" && state.authSubmissionMethod === "Payer Portal" && (
            <div className="sm:col-span-2">
              <FieldLabel>Intake ID · Carecentrix</FieldLabel>
              <Input
                value={sharedIntakeId}
                onChange={(e) => onSharedIntakeIdChange(e.target.value)}
                placeholder="e.g. INTAKE-789"
                className="mt-1 h-9 bg-background font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Shared across all products — only one Intake ID per patient.
              </p>
            </div>
          )}
        </div>

        {/* Same or Similar — inline with this product's card */}
        {(() => {
          const sos: SosChoice = state.sos ?? "";
          return (
            <div className="border-t border-border pt-3 mt-3">
              <FieldLabel>Same or Similar</FieldLabel>
              <Select
                value={sos || "__none__"}
                onValueChange={(v) => {
                  const newSos = (v === "__none__" ? "" : v) as SosChoice;
                  onChange(newSos === "not-clear" ? { sos: newSos } : { sos: newSos, lastBillDate: "" });
                }}
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
              {sos === "not-clear" && (
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
          );
        })()}
      </div>
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
  // Show all 5 products, in canonical order
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
          const isMedicaidRouted = medicaidProducts.has(p);

          return (
            <div
              key={p}
              className={cn(
                "rounded-lg border p-3 bg-background flex flex-col gap-2",
                isNotServing && "opacity-60",
                isRequired && "border-warning/50 bg-warning/5",
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
