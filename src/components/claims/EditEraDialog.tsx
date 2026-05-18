// EditEraDialog
//
// Manual ERA entry for the Outstanding bucket. Opens when the operator
// hits "Edit ERA" on a row that hasn't received an automated 835.
// Per-line editable fields: Paid / Deductible / Coinsurance / Copay /
// PR. Plus a Primary Paid Date input that defaults to today.
//
// On confirm: calls /claims/manual-era. Backend writes per-line columns
// + parent rollups + sets Raw ERA Claim Status to "Manual entry" +
// flips Primary Status to Review. The row moves to ERA Review and the
// operator goes through the normal Mark Paid flow from there.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fmtMoney } from "@/lib/claims/logic";
import type { Claim } from "@/lib/claims/types";

export interface EditEraConfirm {
  primaryPaidDate: string; // YYYY-MM-DD
  lines: Array<{
    subitemId: string;
    primaryPaid: number;
    deductible: number;
    coinsurance: number;
    copay: number;
    pr: number;
  }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: Claim;
  busy: boolean;
  onConfirm: (req: EditEraConfirm) => void | Promise<void>;
}

interface RowState {
  subitemId: string;
  hcpcs: string;
  product: string;
  charge: number;
  estPay: number;
  primaryPaid: number;
  deductible: number;
  coinsurance: number;
  copay: number;
  pr: number;
  /** True when operator has touched PR — locks it from auto-derivation. */
  prTouched: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultsFor(claim: Claim): RowState[] {
  return claim.lines.map((l) => ({
    subitemId: l.id,
    hcpcs: l.hcpcs,
    product: l.product,
    charge: l.charge,
    estPay: l.estPay,
    // Pre-fill with whatever's currently on the subitem so the operator
    // can adjust from existing values instead of starting from zero.
    primaryPaid: l.primaryPaid || 0,
    deductible: l.deductible || 0,
    coinsurance: l.coinsurance || 0,
    copay: l.copay || 0,
    pr: l.patientResponsibility || 0,
    prTouched: l.patientResponsibility > 0,
  }));
}

export function EditEraDialog({
  open, onOpenChange, claim, busy, onConfirm,
}: Props) {
  const [rows, setRows] = useState<RowState[]>(() => defaultsFor(claim));
  const [primaryPaidDate, setPrimaryPaidDate] = useState<string>(todayIso());

  useEffect(() => {
    if (open) {
      setRows(defaultsFor(claim));
      setPrimaryPaidDate(todayIso());
    }
  }, [open, claim]);

  function setField(id: string, k: keyof RowState, v: number) {
    setRows((rs) => rs.map((r) => {
      if (r.subitemId !== id) return r;
      const next = { ...r, [k]: v };
      // Auto-derive PR from deductible + coinsurance + copay UNTIL the
      // operator explicitly types in the PR field. Some payers report
      // PR as a single bucket; we let them override.
      if (k === "deductible" || k === "coinsurance" || k === "copay") {
        if (!r.prTouched) {
          next.pr = next.deductible + next.coinsurance + next.copay;
        }
      }
      if (k === "pr") {
        next.prTouched = true;
      }
      return next;
    }));
  }

  const totals = useMemo(() => {
    const paid = rows.reduce((s, r) => s + r.primaryPaid, 0);
    const pr = rows.reduce((s, r) => s + r.pr, 0);
    const expected = rows.reduce((s, r) => s + r.estPay, 0);
    return { paid, pr, expected, variance: expected - paid - pr };
  }, [rows]);

  const canConfirm = !busy && rows.length > 0;

  function handleConfirm() {
    void onConfirm({
      primaryPaidDate,
      lines: rows.map((r) => ({
        subitemId: r.subitemId,
        primaryPaid: r.primaryPaid,
        deductible: r.deductible,
        coinsurance: r.coinsurance,
        copay: r.copay,
        pr: r.pr,
      })),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit ERA — manual entry</DialogTitle>
          <DialogDescription>
            Enter what the payer told you over the phone (or what's on the
            check stub). On save, this row moves to ERA Review where you
            can verify and Mark Paid. Audit-tagged as "Manual entry" so
            it's distinguishable from automated 835 writebacks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-end gap-3 rounded-md border bg-muted/30 p-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="ppd" className="text-xs">
                Primary Paid Date (EFT / check date)
              </Label>
              <Input
                id="ppd"
                type="date"
                value={primaryPaidDate}
                onChange={(e) => setPrimaryPaidDate(e.target.value)}
                className="h-8 w-44"
              />
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {claim.primaryPayor} · DOS {claim.dos.slice(0, 10)} ·{" "}
              Member {claim.memberId}
            </div>
          </div>

          <div className="rounded-md border">
            <div className="grid grid-cols-[1.2fr_repeat(6,1fr)] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
              <span>Line</span>
              <span className="text-right">Charge</span>
              <span className="text-right">Paid</span>
              <span className="text-right">Deductible</span>
              <span className="text-right">Coinsurance</span>
              <span className="text-right">Copay</span>
              <span className="text-right">PR (total)</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.subitemId}
                className="grid grid-cols-[1.2fr_repeat(6,1fr)] items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <div>
                  <div className="font-medium">{r.hcpcs}</div>
                  <div className="text-xs text-muted-foreground">{r.product}</div>
                </div>
                <div className="text-right tabular-nums text-muted-foreground">
                  {fmtMoney(r.charge)}
                </div>
                <Input
                  type="number" min={0} step={0.01}
                  className="h-8 text-right"
                  value={r.primaryPaid}
                  onChange={(e) => setField(r.subitemId, "primaryPaid", Number(e.target.value) || 0)}
                />
                <Input
                  type="number" min={0} step={0.01}
                  className="h-8 text-right"
                  value={r.deductible}
                  onChange={(e) => setField(r.subitemId, "deductible", Number(e.target.value) || 0)}
                />
                <Input
                  type="number" min={0} step={0.01}
                  className="h-8 text-right"
                  value={r.coinsurance}
                  onChange={(e) => setField(r.subitemId, "coinsurance", Number(e.target.value) || 0)}
                />
                <Input
                  type="number" min={0} step={0.01}
                  className="h-8 text-right"
                  value={r.copay}
                  onChange={(e) => setField(r.subitemId, "copay", Number(e.target.value) || 0)}
                />
                <Input
                  type="number" min={0} step={0.01}
                  className="h-8 text-right font-medium"
                  value={r.pr}
                  onChange={(e) => setField(r.subitemId, "pr", Number(e.target.value) || 0)}
                  title={r.prTouched
                    ? "PR set manually"
                    : "PR auto-derived from Deductible + Coinsurance + Copay; type to override"}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Expected</div>
              <div className="tabular-nums">{fmtMoney(totals.expected)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Primary Paid</div>
              <div className="tabular-nums">{fmtMoney(totals.paid)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">PR Total</div>
              <div className="tabular-nums">{fmtMoney(totals.pr)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Variance</div>
              <div className={`tabular-nums ${Math.abs(totals.variance) <= 5 ? "text-emerald-700" : "text-amber-700"}`}>
                {fmtMoney(totals.variance)}
              </div>
            </div>
          </div>

          {totals.paid === 0 && totals.pr === 0 && (
            <Alert>
              <AlertDescription>
                Nothing entered yet — make sure you fill in at least the
                Paid column before saving. Saving zero-everything will
                just look like a denial without any CARC codes.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {busy ? "Saving…" : "Save & move to ERA Review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default EditEraDialog;
