/**
 * Claims Board loader — the parallel plan (groups + DOS windows), cursor
 * continuation, dedupe, and the fallback to the sequential walk.
 * Monday is mocked at the mondayQuery boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mondayQuery = vi.fn();
vi.mock("@/api/monday", () => ({
  mondayQuery: (...args: unknown[]) => mondayQuery(...args),
  CLAIMS_BOARD_ID: 18245429780,
  hasMondayToken: () => true,
}));

const { dosWindows, fetchAllClaims } = await import("./allClaims");

const CLOSED = "group_closed";
const GROUPS = [
  { id: "group_submit", title: "Submit Claim" },
  { id: "group_out", title: "Outstanding Claims" },
  { id: "group_denied", title: "Denied" },
  { id: CLOSED, title: "Paid And Closed" },
];

const item = (id: string, group: string, extra: Record<string, string> = {}) => ({
  id, name: `Patient ${id}`, created_at: "2026-09-01T00:00:00Z",
  group: { id: group, title: group },
  column_values: Object.entries({ text_mm1zpzrs: `CLM-${id}`, date_mkwr7spz: "2026-09-02", ...extra })
    .map(([cid, text]) => ({ id: cid, text })),
  subitems: [],
});

const opName = (q: unknown) => /query\s+(\w+)/.exec(String(q))?.[1] ?? "?";

describe("dosWindows", () => {
  it("tiles every DOS: older-than-floor, one window per month through next month, later, and blank", () => {
    const w = dosWindows(new Date("2026-09-19T12:00:00Z"));
    expect(w.map((x) => x.label)).toEqual([
      "DOS < 2026-05-01", "DOS 2026-05", "DOS 2026-06", "DOS 2026-07", "DOS 2026-08",
      "DOS 2026-09", "DOS 2026-10", "DOS ≥ 2026-11-01", "DOS empty",
    ]);
    // Contiguous: each month's window ends the day before the next begins.
    const between = w.filter((x) => x.label.startsWith("DOS <") || /^DOS \d{4}-\d{2}$/.test(x.label) || x.label.startsWith("DOS ≥"))
      .map((x) => (x.rules[0] as { compare_value: [string, string] }).compare_value);
    for (let i = 1; i < between.length; i++) {
      const prevEnd = new Date(`${between[i - 1][1]}T00:00:00Z`);
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(prevEnd.toISOString().slice(0, 10)).toBe(between[i][0]);
    }
    expect(between[0][0]).toBe("1900-01-01");
    expect(between[between.length - 1][1]).toBe("2100-12-31");
    expect(w[w.length - 1].rules[0]).toMatchObject({ operator: "is_empty", column_id: "date_mkwr7spz" });
  });
  it("rolls the December → January boundary", () => {
    const w = dosWindows(new Date("2026-12-15T00:00:00Z"));
    expect(w.map((x) => x.label)).toContain("DOS 2027-01");
    expect(w.find((x) => x.label.startsWith("DOS ≥"))?.label).toBe("DOS ≥ 2027-02-01");
  });
});

describe("fetchAllClaims — parallel plan", () => {
  // Braces matter: mockReset() returns the mock, and a hook that RETURNS a
  // function gets it called as a cleanup — with no arguments.
  beforeEach(() => { mondayQuery.mockReset(); });

  it("loads groups in batches + Paid And Closed by DOS window, drains cursors, dedupes", async () => {
    const calls: string[] = [];
    mondayQuery.mockImplementation(async (...args: unknown[]) => {
      const [query, vars = {}] = args as [string, Record<string, unknown>];
      const op = opName(query);
      calls.push(op);
      if (op === "ClaimGroups") return { boards: [{ groups: GROUPS }] };
      if (op === "ClaimsByGroup") {
        const ids = vars.ids as string[];
        return { boards: [{ groups: ids.map((gid) => ({
          id: gid,
          items_page: gid === "group_out"
            ? { cursor: "cur-out-2", items: [item("o1", gid), item("o2", gid)] }
            : { cursor: null, items: [item(`${gid}-a`, gid)] },
        })) }] };
      }
      if (op === "ClaimsByGroupAndDos") {
        const rule = (vars.rules as Array<{ compare_value: string[]; operator: string }>)[0];
        const key = rule.operator === "is_empty" ? "empty" : rule.compare_value[0];
        // Sep window returns a claim that ALSO shows up in Outstanding (moved
        // mid-load) — must be deduped by id.
        const items = key === "2026-09-01" ? [item("c-sep", CLOSED), item("o1", CLOSED)]
          : key === "2026-08-01" ? [item("c-aug", CLOSED)] : [];
        return { boards: [{ groups: [{ id: CLOSED, items_page: { cursor: null, items } }] }] };
      }
      if (op === "ClaimsNextPage") {
        expect(vars.cursor).toBe("cur-out-2");
        return { next_items_page: { cursor: null, items: [item("o3", "group_out")] } };
      }
      throw new Error(`unexpected op ${op}`);
    });

    const claims = await fetchAllClaims({ excludePreSubmission: false });
    const ids = claims.map((c) => c.mondayItemId).sort();
    expect(ids).toEqual(["c-aug", "c-sep", "group_denied-a", "group_submit-a", "o1", "o2", "o3"]);
    // one groups lookup, 2 group batches (3 active groups → ceil(3/2)=2 per batch → 2 requests), 9 windows, 1 continuation
    expect(calls.filter((c) => c === "ClaimsByGroup").length).toBe(2);
    expect(calls.filter((c) => c === "ClaimsByGroupAndDos").length).toBe(9);
    expect(calls.filter((c) => c === "ClaimsNextPage").length).toBe(1);
    expect(calls).not.toContain("AllClaims");
    // The window's requests never ask for value/type — text only on the wire.
    const q = mondayQuery.mock.calls.find((c) => opName(c[0] as string) === "ClaimsByGroupAndDos")?.[0] as string;
    expect(q).not.toMatch(/\bvalue\b/);
    expect(q).not.toMatch(/\btype\b/);
  });

  it("falls back to the sequential board walk when the parallel plan fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mondayQuery.mockImplementation(async (query: string, vars: Record<string, unknown> = {}) => {
      const op = opName(query);
      if (op === "ClaimGroups") return { boards: [{ groups: GROUPS.filter((g) => g.id !== CLOSED) }] }; // renamed away
      if (op === "AllClaims") {
        return vars.cursor
          ? { boards: [{ items_page: { cursor: null, items: [item("b", "group_out")] } }] }
          : { boards: [{ items_page: { cursor: "c2", items: [item("a", "group_out")] } }] };
      }
      throw new Error(`unexpected op ${op}`);
    });
    const claims = await fetchAllClaims({ excludePreSubmission: false });
    expect(claims.map((c) => c.mondayItemId)).toEqual(["a", "b"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("falling back"), expect.anything());
    warn.mockRestore();
  });

  it("derives hasChildren across the whole load", async () => {
    // The child sits in Outstanding, its parent in Paid And Closed (Sep window).
    mondayQuery.mockImplementation(async (query: string, vars: Record<string, unknown> = {}) => {
      const op = opName(query);
      if (op === "ClaimGroups") return { boards: [{ groups: GROUPS }] };
      if (op === "ClaimsByGroup") return { boards: [{ groups: (vars.ids as string[]).map((gid) => ({ id: gid, items_page: { cursor: null,
        items: gid === "group_out" ? [item("child", gid, { text_mm3559h4: "parent" })] : [] } })) }] };
      if (op === "ClaimsByGroupAndDos") {
        const rule = (vars.rules as Array<{ compare_value: string[] }>)[0];
        const items = rule.compare_value?.[0] === "2026-09-01" ? [item("parent", CLOSED)] : [];
        return { boards: [{ groups: [{ id: CLOSED, items_page: { cursor: null, items } }] }] };
      }
      throw new Error(op);
    });
    const claims = await fetchAllClaims({ excludePreSubmission: false });
    const parent = claims.find((c) => c.mondayItemId === "parent");
    const child = claims.find((c) => c.mondayItemId === "child");
    expect(parent?.hasChildren).toBe(true);
    expect(child?.hasChildren).toBe(false);
    expect(child?.parentClaimItemId).toBe("parent");
  });
});
