import { describe, expect, it } from "vitest";
import { makeStamp, parseStamp, stampFor } from "./orderStamps";

describe("order stamps", () => {
  it("round-trips, with and without a reason", () => {
    const now = new Date(2026, 8, 20, 14, 5);
    const a = makeStamp({ initials: "BE", nextOrderDate: "2026-09-19", now });
    expect(a).toBe("2026-09-20T14:05 BE for 2026-09-19");
    expect(parseStamp(a)).toMatchObject({ iso: "2026-09-20T14:05", initials: "BE", forOrder: "2026-09-19", reason: "" });
    const b = makeStamp({ initials: "BE", nextOrderDate: "2026-09-19", reason: "confirmed by phone\n at 2pm", now });
    expect(parseStamp(b)?.reason).toBe("confirmed by phone at 2pm");
  });
  it("only counts for the order it names", () => {
    const s = "2026-09-20T14:05 BE for 2026-09-19 — ok";
    expect(stampFor(s, "2026-09-19")).not.toBeNull();
    expect(stampFor(s, "2026-11-18")).toBeNull();   // the order went out, Next Order moved
    expect(stampFor(s, "")).toBeNull();
    expect(stampFor("garbage", "2026-09-19")).toBeNull();
  });
});
