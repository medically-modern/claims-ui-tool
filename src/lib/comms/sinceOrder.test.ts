import { describe, expect, it } from "vitest";
import { callsSince, isAutomatedText, textsSince } from "./sinceOrder";
import type { ConversationMessage } from "./messagingApi";
import type { PatientCall } from "./callHistory";

const msg = (o: Partial<ConversationMessage>): ConversationMessage => ({ id: 1, direction: "Inbound", text: "", time: "2026-09-10T15:00:00Z", ...o });

describe("isAutomatedText", () => {
  it("catches the reorder link and the order summary, not a typed text or a patient's reply", () => {
    expect(isAutomatedText(msg({ direction: "Outbound", text: "It's time for your next order… https://reorder.medicallymodern.com?token=abc" }))).toBe(true);
    expect(isAutomatedText(msg({ direction: "Outbound", text: "Hi Adam Smith, here's a summary of what we'll be sending you:\n\nItems:" }))).toBe(true);
    expect(isAutomatedText(msg({ direction: "Outbound", text: "Hi, calling about your sets", sentBy: "kelly@medicallymodern.com" }))).toBe(false);
    expect(isAutomatedText(msg({ direction: "Outbound", text: "Can you confirm your address?" }))).toBe(false);
    expect(isAutomatedText(msg({ direction: "Inbound", text: "here's a summary of what we'll be sending you" }))).toBe(false);
  });
});

describe("textsSince / callsSince", () => {
  it("counts only conversation on or after the last order day", () => {
    const list = [
      msg({ id: 1, time: "2026-08-01T12:00:00Z", text: "old" }),
      msg({ id: 2, time: "2026-08-30T18:00:00Z", direction: "Outbound", text: "https://reorder.medicallymodern.com?token=x" }),
      msg({ id: 3, time: "2026-09-01T12:00:00Z", text: "Are there pink sensors?" }),
      msg({ id: 4, time: "2026-09-02T12:00:00Z", direction: "Outbound", text: "Yes!", sentBy: "kelly@medicallymodern.com" }),
    ];
    expect(textsSince(list, "2026-08-04").map((m) => m.id)).toEqual([3, 4]);
    expect(textsSince(list, "").map((m) => m.id)).toEqual([1, 3, 4]);
    const calls = [
      { id: "a", direction: "Inbound", startTime: "2026-08-02T12:00:00Z" },
      { id: "b", direction: "Outbound", startTime: "2026-09-05T12:00:00Z" },
    ] as PatientCall[];
    expect(callsSince(calls, "2026-08-04").map((c) => c.id)).toEqual(["b"]);
  });
});
