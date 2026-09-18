import { describe, expect, it } from "vitest";
import { fmtShortDate, isMonthOf, isMtdTick, lastFull, mtdTickLabel, parseMtdLabel, pickFull, realizationMeasuredOn, spansYears, splitMonthColumns, tickLabel } from "./monthColumns";

describe("parseMtdLabel", () => {
  it("parses the job's header format", () => {
    expect(parseMtdLabel("Sep 2026 MTD · thru Sep 17")).toEqual({
      month: "Sep 2026", thru: "Sep 17", day: 17, daysInMonth: 30, label: "Sep 2026 MTD · thru Sep 17",
    });
  });
  it("tolerates a bare MTD header and a parenthesised cut-off", () => {
    expect(parseMtdLabel("Feb 2028 MTD")).toMatchObject({ month: "Feb 2028", thru: undefined, daysInMonth: 29 });
    expect(parseMtdLabel("Oct 2026 MTD (thru Oct 3)")).toMatchObject({ month: "Oct 2026", thru: "Oct 3", day: 3 });
  });
  it("returns null for certified month headers", () => {
    expect(parseMtdLabel("Aug 2026")).toBeNull();
    expect(parseMtdLabel("")).toBeNull();
    expect(parseMtdLabel("Metric")).toBeNull();
  });
});

describe("splitMonthColumns", () => {
  it("finds the MTD column as the last column (the sheet's layout)", () => {
    const cols = splitMonthColumns(["May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026 MTD · thru Sep 19"]);
    expect(cols.full).toEqual([0, 1, 2, 3]);
    expect(cols.mtd).toMatchObject({ idx: 4, month: "Sep 2026", thru: "Sep 19" });
  });
  it("keeps sheet order for full months and finds the MTD column wherever it sits", () => {
    const cols = splitMonthColumns(["Sep 2026 MTD · thru Sep 17", "Jul 2026", "Aug 2026"]);
    expect(cols.full).toEqual([1, 2]);
    expect(cols.mtd?.idx).toBe(0);
  });
  it("hides a stale MTD column once its month is certified", () => {
    const cols = splitMonthColumns(["Sep 2026 MTD · thru Sep 30", "Jul 2026", "Aug 2026", "Sep 2026"]);
    expect(cols.full).toEqual([1, 2, 3]);
    expect(cols.mtd).toBeNull();
  });
  it("is a no-op for sheets without an MTD column", () => {
    const cols = splitMonthColumns(["Jul 2026", "Aug 2026"]);
    expect(cols).toEqual({ full: [0, 1], mtd: null });
  });
});

describe("pickFull / lastFull — MoM stays on the last two FULL months", () => {
  const months = ["Sep 2026 MTD · thru Sep 17", "Jul 2026", "Aug 2026"];
  const cols = splitMonthColumns(months);
  it("drops the MTD value from a row's series", () => {
    expect(pickFull([305323, 306726, 302767], cols)).toEqual([306726, 302767]);
    expect(lastFull(["$305k", "$307k", "$303k"], cols)).toBe("$303k");
  });
  it("handles short rows and missing rows", () => {
    expect(pickFull([1], cols)).toEqual([]);
    expect(pickFull(undefined, cols)).toEqual([]);
    expect(lastFull(undefined, cols)).toBeUndefined();
  });
});

describe("chart tick labels", () => {
  it("shortens month labels; adds the year only when the chart spans years", () => {
    expect(tickLabel("Jul 2026", false)).toBe("Jul");
    expect(tickLabel("Jul 2026", true)).toBe("Jul '26");
    expect(tickLabel("Sep MTD", true)).toBe("Sep MTD");
    expect(tickLabel("something else", true)).toBe("something else");
    expect(spansYears(["Jul 2026", "Aug 2026", "Sep MTD"])).toBe(false);
    expect(spansYears(["Apr 2025", "Aug 2026"])).toBe(true);
  });
  it("names and recognises the MTD tick", () => {
    expect(mtdTickLabel({ month: "Sep 2026" })).toBe("Sep MTD");
    expect(isMtdTick("Sep MTD")).toBe(true);
    expect(isMtdTick("Sep 2026")).toBe(false);
  });
});

describe("realizationMeasuredOn", () => {
  it("adds the newest ended month's age to its month end", () => {
    // Measured Sep 19: Aug 31 + 19. Sep is the running month (age floored at 0) and is ignored.
    const d = realizationMeasuredOn(["May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026"], [111, 81, 50, 19, 0]);
    expect(d && fmtShortDate(d)).toBe("Sep 19");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-09-19");
  });
  it("isMonthOf matches the measured-on month", () => {
    const d = realizationMeasuredOn(["Aug 2026", "Sep 2026"], [19, 0])!;
    expect(isMonthOf("Sep 2026", d)).toBe(true);
    expect(isMonthOf("Aug 2026", d)).toBe(false);
    expect(isMonthOf("Sep MTD", d)).toBe(false);
  });
  it("crosses a year boundary and survives blanks", () => {
    const d = realizationMeasuredOn(["Dec 2026", "Jan 2027"], [3, null]);
    expect(d?.toISOString().slice(0, 10)).toBe("2027-01-03");
    expect(realizationMeasuredOn(["Sep 2026"], [0])).toBeNull();
    expect(realizationMeasuredOn([], [])).toBeNull();
  });
});
