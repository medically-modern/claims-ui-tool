import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { q: string; v: Record<string, unknown> }[] = [];
let failCol: string | null = null;
vi.mock("./monday", () => ({
  mondayQuery: vi.fn(async (q: string, v: Record<string, unknown>) => {
    calls.push({ q, v });
    if (q.includes("duplicate_item")) return { duplicate_item: { id: "999" } };
    if (failCol && v.columnId === failCol && v.itemId === "999") throw new Error("boom");
    return {};
  }),
}));

import { splitSubscription, SENSORS_ONLY_WRITES, SUPPLIES_ONLY_WRITES } from "./splitSubscription";
import { SUB_COL } from "./queries/subscriptionPatients";

beforeEach(() => { calls.length = 0; failCol = null; });

describe("splitSubscription", () => {
  it("duplicates, sets up Supplies on the copy, then narrows the original to Sensors", async () => {
    const r = await splitSubscription("111", "Ilana Deykin");
    expect(r.suppliesItemId).toBe("999");
    expect(r.failed).toEqual([]);
    const sets = calls.filter((c) => c.q.includes("change_column_value"));
    const onNew = sets.filter((c) => c.v.itemId === "999");
    const onOld = sets.filter((c) => c.v.itemId === "111");
    expect(onNew).toHaveLength(SUPPLIES_ONLY_WRITES.length);
    expect(onOld).toHaveLength(SENSORS_ONLY_WRITES.length);
    // Supplies side fully written before the original is touched.
    const lastNew = calls.lastIndexOf(onNew[onNew.length - 1]);
    const firstOld = calls.indexOf(onOld[0]);
    expect(lastNew).toBeLessThan(firstOld);
    const sub = (items: typeof sets) => items.find((c) => c.v.columnId === SUB_COL.subscription)!.v.value;
    expect(sub(onNew)).toBe(JSON.stringify({ label: "Supplies" }));
    expect(sub(onOld)).toBe(JSON.stringify({ label: "Sensors" }));
    expect(onOld.find((c) => c.v.columnId === SUB_COL.inf_set_auth_id)!.v.value).toBe(JSON.stringify(""));
    expect(onNew.find((c) => c.v.columnId === SUB_COL.sensors_auth_id)!.v.value).toBe(JSON.stringify(""));
  });

  it("leaves the original alone if the copy can't become Supplies", async () => {
    failCol = SUB_COL.subscription;
    await expect(splitSubscription("111", "Ilana Deykin")).rejects.toThrow(/Supplies profile/);
    expect(calls.some((c) => c.v.itemId === "111" && c.q.includes("change_column_value"))).toBe(false);
  });
});
