import { describe, expect, it } from "vitest";
import {
  callConnected,
  callLogPhoneParam,
  callOutcomeLabel,
  formatCallDuration,
  isVoicemail,
  summarizeCalls,
  toPatientCall,
  toPatientCalls,
  type RcCallLogRecord,
} from "./callHistory";

const call = (over: Partial<RcCallLogRecord> = {}): RcCallLogRecord => ({
  id: "1",
  startTime: "2026-08-13T14:00:00.000Z",
  duration: 0,
  direction: "Inbound",
  result: "Missed",
  from: { phoneNumber: "+13475550101" },
  to: { phoneNumber: "+13475037148" },
  ...over,
});

describe("callConnected", () => {
  it("reads the exact result, not a substring", () => {
    expect(callConnected({ result: "Accepted" })).toBe(true);
    expect(callConnected({ result: "Call connected" })).toBe(true);
    // "Answered Not Accepted" CONTAINS "answered" but is a missed call. A
    // substring test would count every abandoned ring as a conversation.
    expect(callConnected({ result: "Answered Not Accepted" })).toBe(false);
    expect(callConnected({ result: "Missed" })).toBe(false);
  });

  it("counts a CLAIMED call as connected via its legs", () => {
    // The §5.13 trap: forwarding the call to the rep who claimed it tears down
    // the inbound leg, so the parent record reads as missed. Reading that
    // literally shows "Missed" to the person who just took the call.
    const claimed = {
      result: "Missed",
      duration: 0,
      legs: [{ result: "Accepted", duration: 214 }],
    };
    expect(callConnected(claimed)).toBe(true);
    expect(toPatientCall(call(claimed))?.connected).toBe(true);
  });

  it("treats real talk time as connected whatever the label says", () => {
    expect(callConnected({ result: "Unknown", duration: 96 })).toBe(true);
  });

  it("lets a NAMED missed result outrank the duration heuristic", () => {
    // RingCentral reports ring time in `duration` on some missed calls, so the
    // "duration means somebody talked" fallback must only apply to results we
    // don't recognise — otherwise an 18-second ring reads as a conversation.
    expect(callConnected({ result: "Missed", duration: 18 })).toBe(false);
    expect(callConnected({ result: "No Answer", duration: 25 })).toBe(false);
    // …but an unrecognised label with real talk time still counts.
    expect(callConnected({ result: "Some New RC Label", duration: 25 })).toBe(true);
  });

  it("does NOT count voicemail as connected, despite its duration", () => {
    // A voicemail has a duration (the message), but nobody spoke to the patient.
    expect(callConnected({ result: "Voicemail", duration: 31 })).toBe(false);
    expect(isVoicemail({ result: "Voicemail" })).toBe(true);
  });
});

describe("toPatientCall", () => {
  it("drops a record with no start time rather than inventing one", () => {
    expect(toPatientCall(call({ startTime: "" }))).toBeNull();
  });

  it("zeroes the duration of a call that never connected", () => {
    // RingCentral reports ring time on some missed calls; showing it as talk
    // time would read as a conversation that never happened.
    const c = toPatientCall(call({ result: "Missed", duration: 18 }));
    expect(c?.connected).toBe(false);
    expect(c?.durationSec).toBe(0);
  });

  it("takes the OTHER party's number per direction", () => {
    expect(toPatientCall(call())?.otherNumber).toBe("+13475550101");
    expect(
      toPatientCall(
        call({ direction: "Outbound", to: { phoneNumber: "+13475550101" }, from: { phoneNumber: "+13475037148" } }),
      )?.otherNumber,
    ).toBe("+13475550101");
  });

  it("finds a recording hanging off a LEG, not just the parent", () => {
    // A claimed/forwarded call records on the leg that carried the audio.
    const c = toPatientCall(
      call({
        result: "Accepted",
        duration: 60,
        legs: [{ result: "Accepted", recording: { id: "9", contentUri: "https://media.ringcentral.com/x" } }],
      }),
    );
    expect(c?.recording?.contentUri).toBe("https://media.ringcentral.com/x");
  });

  it("omits recording entirely when the account records nothing", () => {
    // Not an error — the common case when ReadCallRecording isn't granted.
    expect(toPatientCall(call())?.recording).toBeUndefined();
  });
});

describe("toPatientCalls", () => {
  it("keeps only this patient's calls, newest first", () => {
    const rows = [
      call({ id: "a", startTime: "2026-08-10T10:00:00.000Z" }),
      call({ id: "b", startTime: "2026-08-13T09:00:00.000Z" }),
      // Someone else on the shared MM line — must never surface on this profile.
      call({ id: "c", from: { phoneNumber: "+13479999999" } }),
    ];
    expect(toPatientCalls(rows, "(347) 555-0101").map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("matches on the last 10 digits, however the number was typed", () => {
    const rows = [call({ from: { phoneNumber: "3475550101" } })];
    expect(toPatientCalls(rows, "+1 (347) 555-0101")).toHaveLength(1);
  });
});

describe("callLogPhoneParam", () => {
  // Regression: the first build queried the call-log with toE164() output. The
  // filter returns 200 + an EMPTY LIST for a leading "+", so every patient read
  // as "no calls in the last year" — including one we had called 13 times that
  // week. Verified live: "+17174242514" → 0 records, "17174242514" → 13.
  it("strips the + — the call-log filter silently returns nothing with it", () => {
    expect(callLogPhoneParam("+17174242514")).toBe("17174242514");
    expect(callLogPhoneParam("+17174242514")).not.toContain("+");
  });

  it("reduces any formatting to bare digits", () => {
    expect(callLogPhoneParam("(717) 424-2514")).toBe("7174242514");
    expect(callLogPhoneParam("717-424-2514")).toBe("7174242514");
    expect(callLogPhoneParam("7174242514")).toBe("7174242514");
  });

  it("is empty-safe", () => {
    expect(callLogPhoneParam("")).toBe("");
    expect(callLogPhoneParam(undefined as unknown as string)).toBe("");
  });
});

describe("formatCallDuration", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatCallDuration(65)).toBe("1:05");
    expect(formatCallDuration(3725)).toBe("1:02:05");
    expect(formatCallDuration(9)).toBe("0:09");
  });

  it("shows a dash rather than 0:00 for a call that never connected", () => {
    expect(formatCallDuration(0)).toBe("—");
    expect(formatCallDuration(NaN)).toBe("—");
  });
});

describe("callOutcomeLabel", () => {
  const base = toPatientCall(call({ result: "Accepted", duration: 187 }))!;
  it("labels by outcome", () => {
    expect(callOutcomeLabel(base)).toBe("3:07");
    expect(callOutcomeLabel({ ...base, connected: false, durationSec: 0 })).toBe("Missed");
    expect(callOutcomeLabel({ ...base, direction: "Outbound", connected: false, durationSec: 0 })).toBe("No answer");
    expect(callOutcomeLabel({ ...base, voicemail: true })).toBe("Voicemail");
  });
});

describe("summarizeCalls", () => {
  it("badges MISSED INBOUND only — our own unanswered outbound isn't the patient's fault", () => {
    const calls = [
      toPatientCall(call({ id: "1", result: "Missed" }))!,
      toPatientCall(call({ id: "2", result: "Accepted", duration: 100 }))!,
      toPatientCall(call({ id: "3", direction: "Outbound", result: "No Answer" }))!,
    ];
    const s = summarizeCalls(calls);
    expect(s).toMatchObject({ total: 3, missedInbound: 1, connected: 1, recorded: 0 });
    expect(s.lastCallAt).toBe("2026-08-13T14:00:00.000Z");
  });

  it("is empty-safe", () => {
    expect(summarizeCalls([])).toMatchObject({ total: 0, missedInbound: 0, lastCallAt: "" });
  });
});
