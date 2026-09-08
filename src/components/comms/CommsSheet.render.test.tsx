/**
 * Render smoke for the whole sheet (Radix Sheet + Tabs in jsdom) and the Calls
 * tab against a mocked `/rc` call-log: the header chips come from the board
 * row, Texts is the default tab, and switching to Calls hits the proxy with a
 * DIGITS-ONLY phone filter (a leading "+" returns nothing — see callHistory).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SubscriptionPatient } from "@/components/subscription/mockData";

const patient = {
  id: "1",
  mondayItemId: "111",
  name: "Sue Hartley",
  phone: "(717) 555-1234",
  primaryPayer: "Medicaid",
  nextOrderDate: "2026-09-08",
  subscriptionType: "Sensors",
  runCheck: "Pass",
  patientStatus: "Active",
  orderType: "Reorder",
  confirmation: { tone: "pending", label: "Awaiting" },
  benefits: { tone: "ok", label: "Active" },
  auth: { tone: "ok", label: "Valid" },
  lastPaid: { tone: "ok", label: "Paid" },
} as unknown as SubscriptionPatient;

describe("CommsSheet (render smoke)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_COMMS_GATEWAY_URL", "https://gateway.test");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client");
    localStorage.clear(); // signed out → Texts shows the gate, no fetch
    Element.prototype.scrollIntoView = vi.fn();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("opens with the board context in the header and loads calls on the Calls tab", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.origin + u.pathname).toBe("https://gateway.test/rc/restapi/v1.0/account/~/extension/~/call-log");
      expect(u.searchParams.get("phoneNumber")).toBe("17175551234");
      expect(u.searchParams.get("dateFrom")).toBeTruthy();
      return new Response(
        JSON.stringify({
          records: [
            { id: "a", startTime: "2026-09-02T15:00:00Z", duration: 187, direction: "Inbound", result: "Accepted", from: { phoneNumber: "+17175551234" }, to: { phoneNumber: "+12125550100" } },
            { id: "b", startTime: "2026-09-01T15:00:00Z", duration: 12, direction: "Inbound", result: "Missed", from: { phoneNumber: "+17175551234" }, to: { phoneNumber: "+12125550100" } },
            { id: "c", startTime: "2026-09-01T16:00:00Z", duration: 40, direction: "Outbound", result: "Call connected", from: { phoneNumber: "+12125550100" }, to: { phoneNumber: "+19995550000" } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { CommsSheet } = await import("./CommsSheet");
    render(<CommsSheet patient={patient} open onOpenChange={() => {}} />);

    expect(await screen.findByText("Sue Hartley")).toBeInTheDocument();
    expect(screen.getByText(/\(717\) 555-1234/)).toBeInTheDocument();
    expect(screen.getByText(/Order due Sep 8/)).toBeInTheDocument();
    expect(screen.getByText("Reorder text sent · awaiting reply")).toBeInTheDocument();
    // Texts is the default tab and, signed out, shows the gate without fetching.
    expect(await screen.findByText("Sign in to see texts")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Calls/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Calls/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText("Patient called").length).toBe(2));
    // The other-number filter drops the call that wasn't with this patient.
    expect(screen.queryByText("We called")).not.toBeInTheDocument();
    expect(screen.getByText("3:07")).toBeInTheDocument();
    expect(screen.getByText("Missed")).toBeInTheDocument();
    expect(screen.getByText(/2 calls · 1 missed/)).toBeInTheDocument();
  });

  it("says so when the phone on file isn't usable", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { CommsSheet } = await import("./CommsSheet");
    render(<CommsSheet patient={{ ...patient, phone: "555-12" }} open onOpenChange={() => {}} />);
    expect(await screen.findByText(/not a usable number/)).toBeInTheDocument();
  });
});
