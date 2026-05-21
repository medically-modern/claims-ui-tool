// LineResubmitDialog
//
// Opens when the operator clicks Submit Claim from the denial workflow.
// Lets them pick which service lines to carry onto the resubmission and
// optionally edit units / charge per line — the A4230 45→35 case being
// the canonical example.
//
// On Confirm: calls the parent's onConfirm with the selected subitem ids
// + line overrides. The dialog doesn't touch Monday directly; the parent
// (ClaimDetail) decides whether to call spawnResubmission and handles
// navigation to the new child item afterward.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { lineStatus, fmtMoney } from "@/lib/claims/logic";
import type { Claim, DenialAction } from "@/lib/claims/types";

export interface LineResubmitOverride {
  units?: number;
  charge?: number;
}

export interface LineResubmitConfirm {
  selectedSubitemIds: string[];
  overrides: Record<string, LineResubmitOverride>;
  /** "Corrected claim" → backend sets Claim Type=Corrected, 837 emits
   *  CLM05-3=7 + REF*F8 with parent ICN. "New claim" → Claim Type=Original,
   *  fresh 837. The dialog defaults to the denialAction already on the
   *  claim but the operator can flip via the toggle. */
  denialAction: "Corrected claim" | "New claim";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: Claim;
  /** What was already picked on the denial (drives the default for the
   *  Corrected/New toggle). Anything other than New claim defaults to
   *  Corrected claim. */
  initialDenialAction: DenialAction;
  busy: boolean;
  onConfirm: (req: LineResubmitConfirm) => void | Promise<void>;
}

// Per-line UI state. Lines come from claim.lines; we mirror their id and
// keep edits in this local state so cancel discards cleanly.
interface RowState {
  /** ServiceLine.id — also the Monday subitem id when sourced from real data. */
  id: string;
  hcpcs: string;
  product: string;
  modifiers: string[];
  status: ReturnType<typeof lineStatus>;
  origUnits: number;
  origCharge: number;
  origEstPay: number;
  origPaid: number;
  // editable
  checked: boolean;
  units: number;
  charge: number;
}

function defaultsFor(
  claim: Claim,
  denialAction: "Corrected claim" | "New claim",
): RowState[] {
  return claim.lines.map((l) => {
    const s = lineStatus(l);
    // Corrected claim goes out as a CLM05-3=7 replacement that wipes
    // the original on the payer's side, so every line MUST be on the
    // resubmission — leaving the Paid line off would lose the dollars
    // we already collected. Default ALL lines checked.
    //
    // New claim is a fresh submission; re-billing a Paid line creates
    // a duplicate, so Paid lines default off and the operator opts in
    // explicitly.
    const checked =
      denialAction === "Corrected claim" ? true : s !== "Paid";
    return {
      id: l.id,
      hcpcs: l.hcpcs,
      product: l.product,
      modifiers: l.modifiers,
      status: s,
      origUnits: l.units,
      origCharge: l.charge,
      origEstPay: l.estPay,
      origPaid: l.primaryPaid,
      checked,
      units: l.units,
      charge: l.charge,
    };
  });
}

export function LineResubmitDialog({
  open, onOpenChange, claim, initialDenialAction, busy, onConfirm,
}: Props) {
  const initialAction: "Corrected claim" | "New claim" =
    initialDenialAction === "New claim" ? "New claim" : "Corrected claim";
  const [rows, setRows] = useState<RowState[]>(() =>
    defaultsFor(claim, initialAction),
  );
  const [denialAction, setDenialAction] =
    useState<"Corrected claim" | "New claim">(initialAction);

  // Reset when reopened against a different claim or after a confirm.
  useEffect(() => {
    if (open) {
      const a: "Corrected claim" | "New claim" =
        initialDenialAction === "New claim" ? "New claim" : "Corrected claim";
      setRows(defaultsFor(claim, a));
      setDenialAction(a);
    }
  }, [open, claim, initialDenialAction]);

  // Re-apply check defaults when the operator toggles Corrected/New
  // mid-flow. Corrected -> all lines on; New -> Paid lines off.
  // Any per-line units/charge overrides the operator already typed
  // are preserved by reading them out of the current rows state.
  function setActionAndRetoggle(next: "Corrected claim" | "New claim") {
    setDenialAction(next);
    setRows((prev) => {
      const fresh = defaultsFor(claim, next);
      return fresh.map((r) => {
        const existing = prev.find((p) => p.id === r.id);
        return existing
          ? { ...r, units: existing.units, charge: existing.charge }
          : r;
      });
    });
  }

  const selected = rows.filter((r) => r.checked);
  const includesPaidLine = selected.some((r) => r.status === "Paid");
  const selectedEstPay = selected.reduce((sum, r) => {
    // Scale est pay proportionally when units shifted (the backend does
    // the same — see claim_resubmission_service est_pay recompute).
    const scale = r.origUnits > 0 ? r.units / r.origUnits : 1;
    return sum + r.origEstPay * scale;
  }, 0);

  const canConfirm = useMemo(
    () => !busy && selected.length > 0,
    [busy, selected.length],
  );

  function toggle(id: string, checked: boolean) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, checked } : r)));
  }
  function setUnits(id: string, v: number) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, units: v } : r)));
  }
  function setCharge(id: string, v: number) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, charge: v } : r)));
  }

  function handleConfirm() {
    const overrides: Record<string, LineResubmitOverride> = {};
    for (const r of selected) {
      const o: LineResubmitOverride = {};
      if (r.units !== r.origUnits) o.units = r.units;
      if (Math.abs(r.charge - r.origCharge) > 0.005) o.charge = r.charge;
      if (Object.keys(o).length > 0) overrides[r.id] = o;
    }
    void onConfirm({
      selectedSubitemIds: selected.map((r) => r.id),
      overrides,
      denialAction,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Resubmit claim — pick lines</DialogTitle>
          <DialogDescription>
            Creates a new claim on the board with only the selected lines.
            The original stays put with the lineage recorded — you'll be
            able to walk back to it from the new claim's thread breadcrumb.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <Label className="mb-2 block text-xs font-semibold uppercase text-muted-foreground">
              Submission type
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={denialAction === "Corrected claim" ? "default" : "outline"}
                onClick={() => setActionAndRetoggle("Corrected claim")}
              >
                Corrected claim
              </Button>
              <Button
                type="button"
                size="sm"
                variant={denialAction === "New claim" ? "default" : "outline"}
                onClick={() => setActionAndRetoggle("New claim")}
              >
                New claim
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {denialAction === "Corrected claim"
                ? "Goes out as a replacement (CLM05-3 = 7) referencing the original ICN. Use when the denial was a fixable error."
                : "Goes out as a fresh original. Use when the prior claim was rejected outright (e.g. Wrong Payer) — a corrected flag would get bounced as a duplicate."}
            </p>
          </div>

          <div className="rounded-md border">
            <div className="grid grid-cols-[2rem_1fr_5rem_6rem_6rem_5rem] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
              <span></span>
              <span>Line</span>
              <span className="text-right">Status</span>
              <span className="text-right">Units</span>
              <span className="text-right">Charge</span>
              <span className="text-right">Paid</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[2rem_1fr_5rem_6rem_6rem_5rem] items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <Checkbox
                  checked={r.checked}
                  onCheckedChange={(v) => toggle(r.id, Boolean(v))}
                  aria-label={`Include ${r.hcpcs}`}
                />
                <div>
                  <div className="font-medium">
                    {r.hcpcs}{" "}
                    {r.modifiers.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ({r.modifiers.join(", ")})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.product}</div>
                </div>
                <span className="text-right text-xs">{r.status}</span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="h-8 text-right"
                  value={r.units}
                  disabled={!r.checked}
                  onChange={(e) => setUnits(r.id, Number(e.target.value) || 0)}
                />
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  className="h-8 text-right"
                  value={r.charge}
                  disabled={!r.checked}
                  onChange={(e) => setCharge(r.id, Number(e.target.value) || 0)}
                />
                <span className="text-right tabular-nums text-muted-foreground">
                  {fmtMoney(r.origPaid)}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span>
              <strong>{selected.length}</strong> of {rows.length} lines selected
            </span>
            <span>
              New est. pay:{" "}
              <strong className="tabular-nums">
                {fmtMoney(selectedEstPay)}
              </strong>
            </span>
          </div>

          {includesPaidLine && (
            <Alert>
              <AlertDescription>
                Heads up — one of the selected lines was already paid. Re-billing
                a paid line is usually a mistake (creates a duplicate); make
                sure you actually want this.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {busy ? "Spawning…" : `Spawn ${denialAction.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LineResubmitDialog;
