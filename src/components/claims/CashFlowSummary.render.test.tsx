import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The not-in-bank tile only renders with the Hit Bank gate on.
vi.mock("@/lib/claims/hitBankGate", () => ({ HIT_BANK_GATE_ENABLED: true }));
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CashFlowSummary } from "./CashFlowSummary";
import type { Claim } from "@/lib/claims/types";

const claim = {
  id: "c1", mondayItemId: "111", patientName: "Jane Roe", primaryPayor: "United Healthcare",
  primaryStatus: "Paid", estPay: 120, primaryPaid: 120, prAmount: 0, rawEraDate: null,
  claimId: "X", lines: [], dos: "2026-09-20", claimSentDate: "2026-09-21",
  primaryPaidDate: "2026-10-01", bankEftDate: "2026-10-01", bankPaymentMethod: "ACH",
  bankTraceNumber: "TRC123", hitBank: null,
} as unknown as Claim;

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><CashFlowSummary claims={[claim]} secondaryClaims={[]} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CashFlowSummary", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20)); });
  afterEach(() => { vi.useRealTimers(); });

  it("clicking the Paid, not in bank tile lists its claims with bank details", () => {
    renderIt();
    expect(screen.getByText("Paid, not in bank")).toBeTruthy();
    fireEvent.click(screen.getByText("Paid, not in bank"));
    expect(screen.getByText("Jane Roe")).toBeTruthy();
    expect(screen.getByText("TRC123")).toBeTruthy();
    expect(screen.getByText("In bank")).toBeTruthy();
  });
});
