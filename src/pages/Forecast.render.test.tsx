import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Forecast from "./Forecast";

// Smoke test: with no Monday token the hook falls back to mock data (no network),
// so this renders the full dashboard + chart and asserts it doesn't crash.
describe("Forecast page (render smoke)", () => {
  it("renders KPIs and chart without crashing", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><Forecast /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Cash Flow Forecast")).toBeTruthy();
    expect(screen.getByText(/Bank balance @ 90 days/)).toBeTruthy();
    expect(screen.getByText(/Projected cash/)).toBeTruthy();
    expect(screen.getByText("Cash in bank")).toBeTruthy();
    expect(screen.getByText(/Monthly hiring headroom/)).toBeTruthy();
  });
});
