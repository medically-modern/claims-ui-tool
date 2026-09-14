import { describe, expect, it } from "vitest";
import { deriveMr, isMrHardStopSource, mrIsValid } from "./mrCheck";

const TODAY = "2026-09-14";

describe("mrIsValid", () => {
  it("is valid on or after today, invalid before, invalid when blank or junk", () => {
    expect(mrIsValid("2026-09-14", TODAY)).toBe(true);
    expect(mrIsValid("2027-01-01", TODAY)).toBe(true);
    expect(mrIsValid("2026-09-13", TODAY)).toBe(false);
    expect(mrIsValid("", TODAY)).toBe(false);
    expect(mrIsValid(undefined, TODAY)).toBe(false);
    expect(mrIsValid("soon", TODAY)).toBe(false);
  });
});

describe("isMrHardStopSource", () => {
  it("matches District Endochrine in either spelling, case-insensitively, and nothing else", () => {
    expect(isMrHardStopSource("District Endochrine")).toBe(true);
    expect(isMrHardStopSource("district endocrine")).toBe(true);
    expect(isMrHardStopSource("Tandem")).toBe(false);
    expect(isMrHardStopSource("")).toBe(false);
    expect(isMrHardStopSource(undefined)).toBe(false);
  });
});

describe("deriveMr", () => {
  it("valid MR → green for anyone, including District Endochrine", () => {
    const c = deriveMr({ mnExpiry: "2026-12-31", referralSource: "District Endochrine", today: TODAY });
    expect(c.tone).toBe("ok");
    expect(c.light).toBeUndefined();
    expect(c.label).toBe("Valid");
    expect(c.detail).toContain("Dec 31, 2026");
  });
  it("expired MR, ordinary referral → light green, still ok-tone (orderable)", () => {
    const c = deriveMr({ mnExpiry: "2026-01-05", referralSource: "Tandem", today: TODAY });
    expect(c.tone).toBe("ok");
    expect(c.light).toBe(true);
    expect(c.detail).toContain("MR expired Jan 5, 2026");
    expect(c.detail).toContain("OK to order");
  });
  it("blank MR, ordinary referral → blank circle that still passes", () => {
    const c = deriveMr({ mnExpiry: "", referralSource: "Patient", today: TODAY });
    expect(c.tone).toBe("ok");
    expect(c.unknown).toBe(true);
    expect(c.light).toBeUndefined();
    expect(c.label).toBe("Not on file");
    expect(c.detail).toContain("we don't know");
  });
  it("expired MR, District Endochrine → red (hard stop)", () => {
    const c = deriveMr({ mnExpiry: "2026-09-01", referralSource: "District Endochrine", today: TODAY });
    expect(c.tone).toBe("bad");
    expect(c.detail).toContain("can't order");
  });
  it("blank MR, District Endochrine → blank circle that holds the order (pending, not red)", () => {
    const c = deriveMr({ mnExpiry: "", referralSource: "District Endochrine", today: TODAY });
    expect(c.tone).toBe("pending");
    expect(c.unknown).toBe(true);
    expect(c.label).toBe("Not on file");
    expect(c.detail).toContain("order waits");
  });
});
