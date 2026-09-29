import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CashFlowSummary } from "./CashFlowSummary";

describe("CashFlowSummary", () => {
  it("renders the Paid, not in bank tile", () => {
    render(<MemoryRouter><CashFlowSummary claims={[]} secondaryClaims={[]} /></MemoryRouter>);
    expect(screen.getByText("Paid, not in bank")).toBeTruthy();
    expect(screen.getByText("Over 7 business days")).toBeTruthy();
    expect(screen.getByText("High risk")).toBeTruthy();
  });
});
