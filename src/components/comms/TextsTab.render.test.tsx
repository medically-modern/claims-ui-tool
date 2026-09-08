/**
 * Render smoke for the Texts tab against a mocked gateway: signed in via the
 * shared `mm-auth` key, one conversation with an automated reorder text, a
 * staff-attributed reply, a patient reply and a failed send; plus an order-due
 * marker. Proves the thread renders and the labels the operator relies on
 * are where they should be — without a network or a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const FAKE_JWT =
  "eyJhbGciOiJSUzI1NiJ9." +
  btoa(JSON.stringify({ email: "brandon@medicallymodern.com", name: "Brandon Ellis", hd: "medicallymodern.com", exp: 9999999999 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "") +
  ".sig";

describe("TextsTab (render smoke)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_COMMS_GATEWAY_URL", "https://gateway.test");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client");
    localStorage.setItem("mm-auth", JSON.stringify({ email: "brandon@medicallymodern.com", name: "Brandon Ellis", exp: 9999999999, token: FAKE_JWT }));
    Element.prototype.scrollIntoView = vi.fn();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders bubbles, attribution, the automated reorder label, a delivery failure and the order marker", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gateway.test/messaging/conversation");
      expect((init?.headers as Record<string, string>)["X-MM-Auth"]).toBe(FAKE_JWT);
      return new Response(
        JSON.stringify({
          complete: true,
          messages: [
            { id: 1, direction: "Outbound", time: "2026-09-01T18:05:00Z", text: "Hi Sue, confirm your order: https://reorder.medicallymodern.com/r/abc", messageStatus: "Delivered" },
            { id: 2, direction: "Inbound", time: "2026-09-02T14:00:00Z", text: "My insurance changed to Fidelis", messageStatus: "Received" },
            { id: 3, direction: "Outbound", time: "2026-09-02T23:10:00Z", text: "Can you send a photo of the new card?", sentBy: "katie@medicallymodern.com", messageStatus: "Delivered" },
            { id: 4, direction: "Outbound", time: "2026-09-03T01:00:00Z", text: "Following up", sentBy: "brandon@medicallymodern.com", messageStatus: "SendingFailed", deliveryError: "SMS-RC-410" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { TextsTab } = await import("./TextsTab");
    render(<TextsTab phone="+17175551234" markers={[{ day: "2026-09-08", label: "Order due Sep 8 (today)", tone: "order" }]} />);

    await waitFor(() => expect(screen.getByText("My insurance changed to Fidelis")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Reorder text (automated)")).toBeInTheDocument();
    expect(screen.getByText("Katie")).toBeInTheDocument();
    expect(screen.getByText("Brandon")).toBeInTheDocument();
    expect(screen.getByText(/Not delivered\./)).toBeInTheDocument();
    expect(screen.getByText(/landline or not a working mobile number/)).toBeInTheDocument();
    expect(screen.getByText("Order due Sep 8 (today)")).toBeInTheDocument();
    expect(screen.getByText(/4 messages · 1 from patient/)).toBeInTheDocument();
  });

  it("shows the sign-in gate instead of fetching when nobody is signed in", async () => {
    localStorage.removeItem("mm-auth");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { TextsTab } = await import("./TextsTab");
    render(<TextsTab phone="+17175551234" markers={[]} />);
    expect(await screen.findByText("Sign in to see texts")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the sign-in gate when the gateway answers 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Sign in required" }), { status: 401 })));
    const { TextsTab } = await import("./TextsTab");
    render(<TextsTab phone="+17175551234" markers={[]} />);
    expect(await screen.findByText(/didn't accept the current sign-in/)).toBeInTheDocument();
  });
});
