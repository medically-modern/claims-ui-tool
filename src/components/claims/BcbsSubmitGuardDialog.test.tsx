// Render tests for the POS override escape hatch in the submit guard
// dialog. Covers the three paths that matter:
//   - POS-only block  → override offered, locked until a reason is typed
//   - mixed block     → no override at all (payer ID must be fixed)
//   - warnings only   → unchanged "Submit anyway" behavior
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BcbsSubmitGuardDialog } from "./BcbsSubmitGuardDialog";
import type { BcbsGuardResult } from "@/lib/claims/bcbsSubmitGuard";

const POS_ONLY: BcbsGuardResult = {
  applies: true,
  hardStops: [
    {
      code: "WRONG_POS_NY_OR_NJ",
      message: "Patient lives in NY but POS is set to Office (CMS 11).",
      fix: "Change POS to Home on this row before submitting.",
      overridable: true,
    },
  ],
  warnings: [],
};

const MIXED: BcbsGuardResult = {
  applies: true,
  hardStops: [
    ...POS_ONLY.hardStops,
    {
      code: "WRONG_PAYER_NY",
      message: "Patient lives in NY but PR Payor ID is 11348.",
      fix: "Change PR Payor ID to 803.",
    },
  ],
  warnings: [],
};

function renderDialog(result: BcbsGuardResult, onConfirm = vi.fn()) {
  render(
    <BcbsSubmitGuardDialog
      open
      onOpenChange={() => {}}
      patientName="Vivian Dooher"
      result={result}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe("BcbsSubmitGuardDialog — POS override", () => {
  it("offers the override on a POS-only block and unlocks submit once a reason is typed", () => {
    const onConfirm = renderDialog(POS_ONLY);

    const submit = screen.getByRole("button", { name: /submit with override/i });
    expect(submit.hasAttribute("disabled")).toBe(true);

    // Checkbox alone isn't enough — a reason is required.
    fireEvent.click(screen.getByLabelText(/submit with POS as-is/i));
    expect(
      (screen.getByRole("button", { name: /submit with override/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText(/why is this POS correct/i), {
      target: { value: "Seen in office 8/4, confirmed with Empire" },
    });
    const unlocked = screen.getByRole("button", {
      name: /submit with override/i,
    }) as HTMLButtonElement;
    expect(unlocked.disabled).toBe(false);

    fireEvent.click(unlocked);
    expect(onConfirm).toHaveBeenCalledWith("Seen in office 8/4, confirmed with Empire");
  });

  it("rejects a too-short reason", () => {
    renderDialog(POS_ONLY);
    fireEvent.click(screen.getByLabelText(/submit with POS as-is/i));
    fireEvent.change(screen.getByLabelText(/why is this POS correct/i), {
      target: { value: "ok" },
    });
    expect(
      (screen.getByRole("button", { name: /submit with override/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("hides the override when a non-overridable stop rides along", () => {
    renderDialog(MIXED);
    expect(screen.queryByText(/submit with POS as-is/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /submit with override/i })).toBeNull();
    expect(screen.getByRole("button", { name: /close/i })).toBeTruthy();
  });

  it("keeps the plain Submit anyway path for warning-only results", () => {
    const onConfirm = renderDialog({
      applies: true,
      hardStops: [],
      warnings: [
        {
          code: "CARECENTRIX_AUTH_GAP",
          message: "Routing to CareCentrix / Horizon NJ (11348) but no Auth ID.",
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /submit anyway/i }));
    expect(onConfirm).toHaveBeenCalledWith();
  });
});
