import { describe, expect, it } from "vitest";
import {
  agoLabel, evaluateSignal, parseContactStamp, parseReorderTextSent,
} from "./confirmationSignals";

const ASK = "Aug 25, 2026, 2:00 PM ET";
const askMs = new Date(2026, 7, 25, 14, 0).getTime();
const NOW = new Date(2026, 8, 14, 20, 0).getTime();

describe("parseReorderTextSent", () => {
  it("reads the board format", () => {
    expect(parseReorderTextSent(ASK)).toBe(askMs);
  });
  it("handles AM/PM and noon/midnight", () => {
    expect(new Date(parseReorderTextSent("Jan 1, 2026, 12:00 AM ET")!).getHours()).toBe(0);
    expect(new Date(parseReorderTextSent("Jan 1, 2026, 12:00 PM ET")!).getHours()).toBe(12);
  });
  it("returns null for blank or foreign shapes", () => {
    for (const v of ["", null, undefined, "sent", "2026-08-25"]) {
      expect(parseReorderTextSent(v)).toBeNull();
    }
  });
});

describe("parseContactStamp", () => {
  it("reads the stamp the triage job writes", () => {
    const c = parseContactStamp("2026-09-08T20:08 in sms")!;
    expect(c.direction).toBe("in");
    expect(c.channel).toBe("sms");
    expect(c.at).toBe(new Date("2026-09-08T20:08").getTime());
  });
  it("reads an outbound stamp as outbound", () => {
    expect(parseContactStamp("2026-09-08T20:08 out sms")!.direction).toBe("out");
  });
  it("is null on blank or junk", () => {
    expect(parseContactStamp("")).toBeNull();
    expect(parseContactStamp("nope")).toBeNull();
  });
});

describe("agoLabel", () => {
  it("reads as recency, not a timestamp", () => {
    expect(agoLabel(NOW, NOW)).toBe("today");
    expect(agoLabel(NOW - 86_400_000, NOW)).toBe("yesterday");
    expect(agoLabel(NOW - 3 * 86_400_000, NOW)).toBe("3d ago");
    expect(agoLabel(NOW - 21 * 86_400_000, NOW)).toBe("3w ago");
  });
});

describe("evaluateSignal", () => {
  const base = { orderResponse: "", reorderTextSent: ASK, lastPatientContact: "" };

  it("inbound contact after the ask needs a read", () => {
    const s = evaluateSignal({ ...base, lastPatientContact: "2026-09-08T20:08 in sms" }, NOW);
    expect(s.evaluate).toBe(true);
    expect(s.summary).toBe("texted 5d ago");
  });

  it("SURVIVES the auto-flip to No Response", () => {
    // The whole point: once the job writes No Response, the fact that they
    // texted is unchanged and must still be visible.
    const s = evaluateSignal(
      { ...base, orderResponse: "No Response", lastPatientContact: "2026-09-08T20:08 in sms" },
      NOW,
    );
    expect(s.evaluate).toBe(true);
  });

  it("counts a reply on the very day we asked", () => {
    // Three of five real patients on 2026-09-14 were exactly this case.
    const s = evaluateSignal({ ...base, lastPatientContact: "2026-08-25T20:23 in sms" }, NOW);
    expect(s.evaluate).toBe(true);
    expect(s.summary).toBe("texted 2w ago");
  });

  it("ignores contact from BEFORE the ask (previous cycle)", () => {
    const s = evaluateSignal({ ...base, lastPatientContact: "2026-08-20T09:00 in sms" }, NOW);
    expect(s.evaluate).toBe(false);
    expect(s.contact).not.toBeNull();   // still parsed, just not relevant
  });

  it("ignores outbound-only contact — us talking is not them answering", () => {
    expect(evaluateSignal({ ...base, lastPatientContact: "2026-09-08T20:08 out sms" }, NOW).evaluate).toBe(false);
  });

  it("is silent when the patient already confirmed or delayed", () => {
    for (const resp of ["Confirmed", "Delay", "Confirmed (delayed)"]) {
      expect(evaluateSignal(
        { ...base, orderResponse: resp, lastPatientContact: "2026-09-08T20:08 in sms" }, NOW,
      ).evaluate).toBe(false);
    }
  });

  it("is silent when we never asked", () => {
    expect(evaluateSignal(
      { ...base, reorderTextSent: "", lastPatientContact: "2026-09-08T20:08 in sms" }, NOW,
    ).evaluate).toBe(false);
  });

  it("is silent on no contact at all", () => {
    expect(evaluateSignal(base, NOW).evaluate).toBe(false);
  });

  it("labels a call and an email differently from a text", () => {
    expect(evaluateSignal({ ...base, lastPatientContact: "2026-09-08T20:08 in call" }, NOW).summary).toBe("called 5d ago");
    expect(evaluateSignal({ ...base, lastPatientContact: "2026-09-08T20:08 in email" }, NOW).summary).toBe("emailed 5d ago");
  });
});
