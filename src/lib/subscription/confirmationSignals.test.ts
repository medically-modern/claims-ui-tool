import { describe, expect, it } from "vitest";
import {
  agoLabel, excerpt, parseContactStamp, parseReorderTextSent, readSignal, readWindowStart,
} from "./confirmationSignals";

const ORDER = "2026-09-14";
const NOW = new Date(2026, 8, 14, 20, 0).getTime();
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe("parseReorderTextSent", () => {
  it("reads the board format", () => {
    expect(parseReorderTextSent("Aug 25, 2026, 2:00 PM ET")).toBe(at(2026, 8, 25, 14));
  });
  it("handles noon and midnight", () => {
    expect(new Date(parseReorderTextSent("Jan 1, 2026, 12:00 AM ET")!).getHours()).toBe(0);
    expect(new Date(parseReorderTextSent("Jan 1, 2026, 12:00 PM ET")!).getHours()).toBe(12);
  });
  it("is null on blank or foreign shapes", () => {
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

describe("readWindowStart", () => {
  it("opens 30 days before the order date", () => {
    expect(readWindowStart(ORDER, NOW)).toBe(at(2026, 8, 15, 0));
  });
  it("falls back to 30 days before now when the row has no order date", () => {
    expect(readWindowStart("", NOW)).toBe(NOW - 30 * 86_400_000);
    expect(readWindowStart(null, NOW)).toBe(NOW - 30 * 86_400_000);
  });
});

describe("readSignal", () => {
  const base = {
    helpMessage: "", coordinatorNotes: "",
    notesUpdatedAt: null as number | null, lastPatientContact: "", orderDate: ORDER,
  };

  it("nothing said, nothing to read", () => {
    expect(readSignal(base, NOW).needsRead).toBe(false);
  });

  it("a coordinator note inside the window needs a read", () => {
    const s = readSignal({ ...base, coordinatorNotes: "wants it overnighted", notesUpdatedAt: at(2026, 9, 12) }, NOW);
    expect(s.needsRead).toBe(true);
    expect(s.summary).toBe("note 2d ago");
  });

  it("counts our note and the patient's portal message the same way", () => {
    for (const k of ["coordinatorNotes", "helpMessage"] as const) {
      const s = readSignal({ ...base, [k]: "something", notesUpdatedAt: at(2026, 9, 10) }, NOW);
      expect(s.needsRead).toBe(true);
    }
  });

  // Brandon, 2026-09-19: "when I hover over a confirm with a message icon, it
  // should say what the message is. Like: Subscription note: abc… / Patient
  // Portal: xyz…"
  describe("hover lines", () => {
    it("labels each note with whose it is, ours first", () => {
      const s = readSignal({
        ...base,
        coordinatorNotes: "called, wants 90 days",
        helpMessage: "please ship to my daughter",
        notesUpdatedAt: at(2026, 9, 13),
      }, NOW);
      expect(s.lines).toEqual([
        "Subscription note: called, wants 90 days",
        "Patient portal: please ship to my daughter",
      ]);
    });

    it("only lines up the columns that actually have text", () => {
      const s = readSignal(
        { ...base, coordinatorNotes: "just ours", notesUpdatedAt: at(2026, 9, 13) }, NOW);
      expect(s.lines).toEqual(["Subscription note: just ours"]);
    });

    it("points an inbound text at the comms sheet rather than quoting it", () => {
      const s = readSignal({ ...base, lastPatientContact: "2026-09-08T20:08 in sms" }, NOW);
      expect(s.lines).toEqual(["Patient texted 5d ago — open Comms to read it"]);
    });

    it("stays empty when nothing is in the window", () => {
      const s = readSignal(
        { ...base, coordinatorNotes: "ancient", notesUpdatedAt: at(2026, 6, 1) }, NOW);
      expect(s.needsRead).toBe(false);
      expect(s.lines).toEqual([]);
    });
  });

  describe("excerpt", () => {
    it("leaves a short note alone and collapses its whitespace", () => {
      expect(excerpt("  wants   90\n days ")).toBe("wants 90 days");
    });
    it("cuts a long note at the last word that leaves most of the excerpt", () => {
      const out = excerpt("the patient called and asked for overnight shipping again", 40);
      expect(out).toBe("the patient called and asked for…");
    });
    it("hard-cuts rather than throwing away most of the excerpt for a word break", () => {
      // The only space is at char 20 of a 40-char budget — honouring it would
      // halve the excerpt, so the cut wins over the word boundary.
      expect(excerpt("a".repeat(20) + " " + "b".repeat(200), 40))
        .toBe("a".repeat(20) + " " + "b".repeat(19) + "…");
      expect(excerpt("x".repeat(200), 10)).toBe("x".repeat(10) + "…");
    });
    it("is empty for empty input", () => {
      expect(excerpt(null)).toBe("");
      expect(excerpt(undefined)).toBe("");
    });
  });

  it("an inbound text inside the window needs a read", () => {
    const s = readSignal({ ...base, lastPatientContact: "2026-09-08T20:08 in sms" }, NOW);
    expect(s.needsRead).toBe(true);
    expect(s.summary).toBe("texted 5d ago");
  });

  it("names both sources when both fired", () => {
    const s = readSignal({
      ...base, coordinatorNotes: "x", notesUpdatedAt: at(2026, 9, 13),
      lastPatientContact: "2026-09-08T20:08 in sms",
    }, NOW);
    expect(s.sources).toHaveLength(2);
    expect(s.summary).toBe("note yesterday · texted 5d ago");
  });

  it("IGNORES a note older than 30 days before the order date", () => {
    // The staleness that made the old Pencil badge useless.
    const s = readSignal({ ...base, coordinatorNotes: "ancient", notesUpdatedAt: at(2026, 7, 1) }, NOW);
    expect(s.needsRead).toBe(false);
  });

  it("COUNTS a note written after the order date — the window has a floor, not a ceiling", () => {
    const later = new Date(2026, 8, 20, 12).getTime();
    const s = readSignal({ ...base, coordinatorNotes: "called today", notesUpdatedAt: at(2026, 9, 19) }, later);
    expect(s.needsRead).toBe(true);
  });

  it("does not badge note text of unknown age", () => {
    // No activity-log entry = we can't date it = it must not badge forever.
    const s = readSignal({ ...base, coordinatorNotes: "who knows when", notesUpdatedAt: null }, NOW);
    expect(s.needsRead).toBe(false);
  });

  it("does not badge a timestamp with no note text behind it", () => {
    const s = readSignal({ ...base, notesUpdatedAt: at(2026, 9, 12) }, NOW);
    expect(s.needsRead).toBe(false);
  });

  it("ignores outbound contact — us talking is not them saying something", () => {
    expect(readSignal({ ...base, lastPatientContact: "2026-09-08T20:08 out sms" }, NOW).needsRead).toBe(false);
  });

  it("ignores contact from before the window", () => {
    expect(readSignal({ ...base, lastPatientContact: "2026-07-01T09:00 in sms" }, NOW).needsRead).toBe(false);
  });

  it("labels a call and an email differently from a text", () => {
    expect(readSignal({ ...base, lastPatientContact: "2026-09-08T20:08 in call" }, NOW).summary).toBe("called 5d ago");
    expect(readSignal({ ...base, lastPatientContact: "2026-09-08T20:08 in email" }, NOW).summary).toBe("emailed 5d ago");
  });
});
