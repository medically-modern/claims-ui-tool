import { describe, expect, it } from "vitest";
import { buildTimeline, isAutomatedReorderText } from "./TextsTab";
import { markersFor } from "./CommsSheet";
import type { ConversationMessage } from "@/lib/comms/messagingApi";
import type { SubscriptionPatient } from "@/components/subscription/mockData";

const msg = (o: Partial<ConversationMessage> & { id: number; time: string }): ConversationMessage => ({
  direction: "Inbound",
  text: "hi",
  ...o,
});

describe("isAutomatedReorderText", () => {
  it("flags an unattributed outbound text carrying the reorder link", () => {
    expect(
      isAutomatedReorderText(msg({ id: 1, time: "2026-09-01T18:00:00Z", direction: "Outbound", text: "Hi Sue, confirm your order: https://reorder.medicallymodern.com/r/abc" })),
    ).toBe(true);
  });
  it("does not flag a person's text, an inbound text, or an attributed send with the link", () => {
    expect(isAutomatedReorderText(msg({ id: 1, time: "2026-09-01T18:00:00Z", direction: "Outbound", text: "Any update on your insurance?" }))).toBe(false);
    expect(isAutomatedReorderText(msg({ id: 2, time: "2026-09-01T18:00:00Z", direction: "Inbound", text: "https://reorder.medicallymodern.com/r/abc" }))).toBe(false);
    expect(
      isAutomatedReorderText(msg({ id: 3, time: "2026-09-01T18:00:00Z", direction: "Outbound", sentBy: "katie@medicallymodern.com", text: "resending https://reorder.medicallymodern.com/r/abc" })),
    ).toBe(false);
  });
});

describe("buildTimeline", () => {
  it("groups by ET day, puts markers at the top of their day, keeps messages in time order", () => {
    const items = buildTimeline(
      [
        msg({ id: 2, time: "2026-09-02T01:30:00Z" }), // Sep 1, 9:30pm ET
        msg({ id: 1, time: "2026-09-01T23:00:00Z" }), // Sep 1, 7:00pm ET
        msg({ id: 3, time: "2026-09-03T14:00:00Z" }), // Sep 3
      ],
      [{ day: "2026-09-01", label: "Order due", tone: "order" }],
    );
    expect(items.map((i) => i.kind)).toEqual(["day", "marker", "msg", "msg", "day", "msg"]);
    expect(items.filter((i) => i.kind === "msg").map((i) => (i.kind === "msg" ? i.m.id : 0))).toEqual([1, 2, 3]);
  });
  it("gives a future marker its own day after the last message", () => {
    const items = buildTimeline([msg({ id: 1, time: "2026-09-01T23:00:00Z" })], [{ day: "2026-09-08", label: "Order due", tone: "order" }]);
    expect(items.map((i) => i.kind)).toEqual(["day", "msg", "day", "marker"]);
  });
  it("renders markers alone when there are no messages", () => {
    const items = buildTimeline([], [{ day: "2026-09-08", label: "Order due", tone: "order" }]);
    expect(items.map((i) => i.kind)).toEqual(["day", "marker"]);
  });
});

describe("markersFor", () => {
  const base = {
    id: "1",
    mondayItemId: "1",
    name: "Sue",
    phone: "7175551234",
    primaryPayer: "Medicaid",
    subscriptionType: "Sensors",
    runCheck: "Pass",
    patientStatus: "Active",
    confirmation: { tone: "ok", label: "Confirmed" },
    benefits: { tone: "ok", label: "Active" },
    auth: { tone: "ok", label: "Valid" },
    lastPaid: { tone: "ok", label: "Paid" },
  } as unknown as SubscriptionPatient;

  it("always marks the order date; block + check-in only when paused/blocked", () => {
    const active = markersFor({ ...base, nextOrderDate: "2026-09-08", blockedDate: "2026-09-01", checkInDate: "2026-09-15" });
    expect(active.map((m) => m.tone)).toEqual(["order"]);
    const paused = markersFor({
      ...base,
      nextOrderDate: "2026-09-08",
      patientStatus: "Paused",
      pauseReason: "Hospital/SNF",
      blockedDate: "2026-09-01",
      checkInDate: "2026-09-15",
    });
    expect(paused.map((m) => m.tone)).toEqual(["order", "block", "checkin"]);
    expect(paused[1].label).toContain("Hospital/SNF");
  });
  it("skips markers with no date", () => {
    expect(markersFor({ ...base, nextOrderDate: "" })).toEqual([]);
  });
});
