import { describe, expect, it } from "vitest";
import { fmtShortDate, isMonthOf, isMtdTick, lastFull, monthTicks, mtdTickLabel, parseMtdLabel, pickFull, realizationMeasuredOn, splitMonthColumns, tickLabel } from "./monthColumns";

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
  it("shortens month labels and always carries the year", () => {
    expect(tickLabel("Jul 2026")).toBe("Jul '26");
    expect(tickLabel("Sep MTD")).toBe("Sep MTD");
    expect(tickLabel("something else")).toBe("something else");
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

describe("tickLabel always carries the year", () => {
  it("labels every month the same way, single-year chart or not", () => {
    expect(tickLabel("Jul 2026")).toBe("Jul '26");
    expect(tickLabel("Apr 2025")).toBe("Apr '25");
  });
  it("passes the MTD tick through untouched", () => {
    expect(tickLabel("Sep MTD")).toBe("Sep MTD");
  });
  it("passes anything unrecognised through", () => {
    expect(tickLabel("whatever")).toBe("whatever");
  });
});

describe("monthTicks — one constant stride", () => {
  const months = (n: number) => Array.from({ length: n }, (_, i) => `M${i}`);

  it("shows every month when they all fit", () => {
    expect(monthTicks(months(5))).toEqual(["M0", "M1", "M2", "M3", "M4"]);
    expect(monthTicks(months(7))).toEqual(months(7));
  });

  it("uses ONE stride across the whole axis, never a mix", () => {
    // 19 points, budget 7 -> stride 3, and every gap is 3.
    const picked = monthTicks(months(19));
    const idx = picked.map((m) => Number(m.slice(1)));
    const gaps = new Set(idx.slice(1).map((v, i) => v - idx[i]));
    expect(gaps).toEqual(new Set([3]));
  });

  it("always labels the newest point — the MTD tick", () => {
    const m = [...months(18), "Sep MTD"];
    expect(monthTicks(m).at(-1)).toBe("Sep MTD");
    expect(monthTicks([...months(40), "Sep MTD"]).at(-1)).toBe("Sep MTD");
  });

  it("stays inside the tick budget", () => {
    for (const n of [8, 13, 19, 25, 40, 100]) {
      expect(monthTicks(months(n)).length).toBeLessThanOrEqual(7);
    }
  });

  it("honours a custom budget", () => {
    expect(monthTicks(months(12), 4).length).toBeLessThanOrEqual(4);
  });

  it("includes the oldest month only when it lands on the stride", () => {
    // 19 @ stride 3 counting back from index 18 reaches 0 exactly.
    expect(monthTicks(months(19))[0]).toBe("M0");
    // 20 @ stride 3 counting back from index 19 lands on 1, so the oldest
    // month is dropped rather than pinned — pinning it would put one short
    // gap into an otherwise even axis.
    expect(monthTicks(months(20))[0]).toBe("M1");
  });

  it("handles the degenerate cases", () => {
    expect(monthTicks([])).toEqual([]);
    expect(monthTicks(["Sep MTD"])).toEqual(["Sep MTD"]);
  });
});
