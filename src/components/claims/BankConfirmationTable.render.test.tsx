import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/api/bankConfirmation", async (orig) => {
  const actual = await orig<typeof import("@/api/bankConfirmation")>();
  const claims = [
    { itemId: "1", board: "primary", patientName: "Jane Roe", payer: "UNITED", paid: 100,
      paidDate: "2026-09-01", method: "ACH", depositTotal: 180, eftDate: "2026-09-01",
      trace: "TR1", checkNumber: "TR1", originator: "O1", stripeCharge: "", hitBank: "" },
    { itemId: "2", board: "secondary", patientName: "John Doe", payer: "UNITED", paid: 80,
      paidDate: "2026-09-01", method: "ACH", depositTotal: 180, eftDate: "2026-09-01",
      trace: "TR1", checkNumber: "TR1", originator: "O1", stripeCharge: "", hitBank: "Mismatch" },
  ];
  return {
    ...actual,
    useParkedClaims: () => ({ data: claims, isLoading: false, isFetching: false, refetch: vi.fn(), error: null }),
  };
});

import { BankConfirmationTable } from "./BankConfirmationTable";

describe("BankConfirmationTable", () => {
  it("renders one deposit for two claims and expands", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BankConfirmationTable />
      </QueryClientProvider>,
    );
    expect(screen.getAllByText("UNITED")).toHaveLength(1);
    expect(screen.getAllByText("Mismatch").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Expand"));
    expect(screen.getByText("Jane Roe")).toBeTruthy();
    expect(screen.getByText("John Doe")).toBeTruthy();
  });
});
