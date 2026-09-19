/**
 * FinancialsHub — month-to-date column.
 *
 * The sheet job keeps the MTD column as the LAST column, but the UI must not
 * depend on that: these tests feed a payload shaped exactly like
 * GET /monthly-financials with the MTD column FIRST (the worst case) and
 * check that the UI still renders it last, keeps MoM on the last two full
 * months, and never lets it leak into "as of" / audit labels. A final test
 * uses the real layout (MTD last).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/pages/Forecast", () => ({ ForecastDashboard: () => null }));
vi.mock("@/hooks/subscription/useSubscriptionPatients", () => ({
  useSubscriptionPatients: () => ({ data: [], usingMock: true }),
}));
// API_BASE is read at module load, so stub the env BEFORE the (dynamic) import.
vi.stubEnv("VITE_API_BASE_URL", "http://backend.test");
const { default: FinancialsHub } = await import("./FinancialsHub");

type Row = { row: number; label: string; values: string[]; raw: (number | null)[] };
const row = (row: number, label: string, values: (string | number | null)[]): Row => ({
  row, label,
  values: values.map((v) => (v === null || v === "" ? "" : typeof v === "number" ? String(v) : v)),
  raw: values.map((v) => (typeof v === "number" ? v : null)),
});

// KPIs tab with the MTD column FIRST (worst case for the UI); May/Jun are ARR/ARP backfill only.
const KPI_MONTHS = ["Sep 2026 MTD · thru Sep 17", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026"];
const kpis = {
  months: KPI_MONTHS,
  rows: [
    row(3, "Metric", KPI_MONTHS),
    row(4, "Active unique patients", [732, "", "", 601, 634]),
    row(5, "Total unique patients (Active + Paused)", [798, 548, 632, 657, 696]),
    row(8, "Net patient adds (new − churned)", ["+102", "", "", "+54", "+31"]),
    row(9, "Churn % (pure — left the book)", ["1.23%", "", "", "0.83%", "2.68%"]),
    row(11, "ARR", ["$2,964,768", "$2,035,526", "$2,352,242", "$2,452,289", "$2,590,658"]),
    row(16, "True realization % (not meaningful until column is 2+ months old)", ["", "97.5%", "95.9%", "90.7%", "62.9%"]),
    row(17, "Reorder conversion % (ordered ÷ reorders due)", ["", "", "", "", "69.4%"]),
  ],
};
// ARR raw values (strings above are display-only) — MoM must be Aug vs Jul.
kpis.rows[5].raw = [2964768, 2035526, 2352242, 2452289, 2590658];
kpis.rows[3].raw = [102, null, null, 54, 31];
kpis.rows[4].raw = [0.0123, null, null, 0.0083, 0.0268];

const M_MONTHS = ["Sep 2026 MTD · thru Sep 17", "Jul 2026", "Aug 2026"];
const monthly = {
  months: M_MONTHS,
  rows: [
    row(3, "KPI", M_MONTHS),
    row(4, "PATIENTS (snapshot at month end)", ["", "", ""]),
    row(5, "Total unique patients (Active + Paused)", [798, 657, 696]),
    row(14, "Active unique patients", [732, 601, 634]),
    row(50, "REVENUE", ["", "", ""]),
    row(53, "Annualized gross revenue (total ARR)", ["$2,964,768", "$2,452,289", "$2,590,658"]),
    row(54, "Annualized recurring profit (total ARP)", ["$1,238,326", "$992,237", "$1,050,595"]),
    row(60, "Total revenue", ["$305,323", "$306,726", "$302,767"]),
    row(86, "Total gross profit", ["$102,402", "$88,053", "$74,878"]),
    row(93, "FIXED COSTS & NET PROFIT", ["", "", ""]),
    row(94, "Fixed costs (editable — allocated to products by revenue share)", ["$39,667", "$70,000", "$70,000"]),
    row(95, "Net profit", ["$62,735", "$18,053", "$4,878"]),
    row(162, "MONTH-OVER-MONTH DELTAS", ["", "", ""]),
    row(163, "Total revenue Δ%", ["", "", "-1.3%"]),
    row(171, "SELF-AUDIT (script health — investigate any CHECK)", ["", "", ""]),
    row(179, "Audit status", ["CHECK", "OK", "OK"]),
  ],
};
monthly.rows[2].raw = [798, 657, 696];
monthly.rows[3].raw = [732, 601, 634];
monthly.rows[5].raw = [2964768, 2452289, 2590658];
monthly.rows[6].raw = [1238326, 992237, 1050595];
monthly.rows[7].raw = [305323, 306726, 302767];
monthly.rows[8].raw = [102402, 88053, 74878];

const payload = (over: Partial<{ kpis: typeof kpis; monthly: typeof monthly }> = {}) => ({
  sheet_id: "sheet-1", generated_at: 0, cache_age_seconds: 0,
  kpis, monthly,
  realization: { months: ["Jul 2026", "Aug 2026"], rows: [row(3, "Metric", ["Jul 2026", "Aug 2026"])] },
  ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><FinancialsHub /></QueryClientProvider>);
}

// Header cells may stack lines in <div>s (the MTD header); join them with a
// space. jsdom applies no CSS, so drop the phone-only (`sm:hidden`) variant
// and read the desktop text.
const headerTexts = (table: HTMLElement) =>
  within(table).getAllByRole("columnheader").map((th) => {
    const clone = th.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".sm\\:hidden").forEach((n) => n.remove());
    const parts = Array.from(clone.querySelectorAll("div")).map((d) => d.textContent?.trim() ?? "");
    return (parts.length ? parts.join(" ") : clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });

describe("FinancialsHub — MTD column", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload()), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("KPIs: renders the MTD column LAST (after Aug) even if the sheet had it first", async () => {
    mount();
    const table = (await screen.findByText("Metric")).closest("table") as HTMLElement;
    expect(headerTexts(table)).toEqual([
      "Metric", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026 MTD · thru Sep 17", "MoM",
    ]);
    const active = within(table).getByText("Active unique patients").closest("tr") as HTMLElement;
    const cells = within(active).getAllByRole("cell").map((td) => td.textContent?.trim());
    // label, May, Jun, Jul, Aug, MTD, MoM
    expect(cells.slice(0, 6)).toEqual(["Active unique patients", "—", "—", "601", "634", "732"]);
  });

  it("KPIs: MoM stays on the last two FULL months (Aug vs Jul), never MTD vs Aug", async () => {
    mount();
    const table = (await screen.findByText("Metric")).closest("table") as HTMLElement;
    const arr = within(table).getByText("ARR").closest("tr") as HTMLElement;
    const cells = within(arr).getAllByRole("cell").map((td) => td.textContent?.trim());
    expect(cells[cells.length - 1]).toBe("+5.6%");   // 2,590,658 / 2,452,289 − 1
    expect(cells).not.toContain("+14.4%");            // would be 2,964,768 / 2,590,658 − 1
    const churn = within(table).getByText(/^Churn %/).closest("tr") as HTMLElement;
    const c = within(churn).getAllByRole("cell").map((td) => td.textContent?.trim());
    expect(c[c.length - 1]).toBe("+1.9pp");           // 2.68 − 0.83, not 1.23 − 2.68
  });

  it("labels: 'as of' is the last certified month; the MTD badge names the cut-off", async () => {
    mount();
    await screen.findByText("Metric");
    expect(screen.getByText(/SNAPSHOT · as of Aug 2026/)).toBeInTheDocument();
    expect(screen.getByText(/MTD · Sep 2026 thru Sep 17 · refreshes daily/)).toBeInTheDocument();
    expect(screen.getAllByText(/MONTH-END · AUG 2026/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/MONTH-END · SEP/)).toBeNull();
    // legend explains the proration and the blank cohort rows
    expect(screen.getByText(/Fixed costs are prorated 17\/30 days/)).toBeInTheDocument();
  });

  it("Monthly Model: MTD column last, delta rows blank for MTD, audit badge = certified month", async () => {
    mount();
    await screen.findByText("Metric");
    // Radix tabs activate on pointer-down, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Monthly Model" }), { button: 0 });
    await waitFor(() => expect(screen.getByText(/Self-audit \(Aug 2026\): OK/)).toBeInTheDocument());
    expect(screen.getByText(/MTD self-audit: CHECK/)).toBeInTheDocument();

    const patients = screen.getByText("Total unique patients (Active + Paused)").closest("table") as HTMLElement;
    expect(headerTexts(patients)).toEqual(["", "Jul 2026", "Aug 2026", "Sep 2026 MTD · thru Sep 17"]);
    const tot = within(patients).getByText("Total unique patients (Active + Paused)").closest("tr") as HTMLElement;
    expect(within(tot).getAllByRole("cell").map((td) => td.textContent?.trim()))
      .toEqual(["Total unique patients (Active + Paused)", "657", "696", "798"]);

    // Collapsed sections open on click; the deltas section shows "—" under MTD.
    fireEvent.click(screen.getByRole("button", { name: /MONTH-OVER-MONTH DELTAS/ }));
    const delta = (await screen.findByText("Total revenue Δ%")).closest("tr") as HTMLElement;
    expect(within(delta).getAllByRole("cell").map((td) => td.textContent?.trim()))
      .toEqual(["Total revenue Δ%", "—", "-1.3%", "—"]);

    // "Fixed costs (editable…)" is a DATA row inside FIXED COSTS & NET PROFIT
    // (section headers match case-sensitively), showing the prorated MTD value.
    fireEvent.click(screen.getByRole("button", { name: /FIXED COSTS & NET PROFIT/ }));
    const fixed = (await screen.findByText(/^Fixed costs \(editable/)).closest("tr") as HTMLElement;
    expect(within(fixed).getAllByRole("cell").map((td) => td.textContent?.trim()).slice(1))
      .toEqual(["$70,000", "$70,000", "$39,667"]);
    expect(screen.queryByRole("button", { name: /^Fixed costs \(editable/ })).toBeNull();
  });

  it("real layout (MTD last in the sheet): same rendering, MoM still Aug vs Jul", async () => {
    const months = ["Jul 2026", "Aug 2026", "Sep 2026 MTD · thru Sep 19"];
    const k = {
      months: ["May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026 MTD · thru Sep 19"],
      rows: [
        row(3, "Metric", ["May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026 MTD · thru Sep 19"]),
        row(4, "Active unique patients", ["", "", 601, 634, 732]),
        row(11, "ARR", ["$2,035,526", "$2,352,242", "$2,452,289", "$2,590,658", "$2,977,557"]),
      ],
    };
    k.rows[2].raw = [2035526, 2352242, 2452289, 2590658, 2977557];
    const mo = { months, rows: [row(3, "KPI", months), row(4, "PATIENTS (snapshot at month end)", ["", "", ""]),
      row(5, "Total unique patients (Active + Paused)", [657, 696, 798])] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload({ kpis: k as typeof kpis, monthly: mo as typeof monthly })),
        { status: 200, headers: { "Content-Type": "application/json" } }));
    mount();
    const table = (await screen.findByText("Metric")).closest("table") as HTMLElement;
    expect(headerTexts(table)).toEqual([
      "Metric", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026 MTD · thru Sep 19", "MoM",
    ]);
    const arr = within(table).getByText("ARR").closest("tr") as HTMLElement;
    const cells = within(arr).getAllByRole("cell").map((td) => td.textContent?.trim());
    expect(cells.slice(-2)).toEqual(["$2,977,557", "+5.6%"]);
    expect(screen.getByText(/SNAPSHOT · as of Aug 2026/)).toBeInTheDocument();
  });

  it("charts: the MTD point is plotted last and styled as provisional; growth stays month-end", async () => {
    mount();
    await screen.findByText("Metric");
    // Every chart carries a style legend naming the MTD point (blue dotted / hatched bar).
    const hints = screen.getAllByText((_, el) => el?.tagName === "SPAN" && /^(Blue dotted|Hatched bar) = Sep MTD \(thru Sep 17\)/.test(el.textContent ?? ""));
    expect(hints.filter((h) => h.textContent?.startsWith("Blue dotted")).length).toBe(2);
    expect(hints.filter((h) => h.textContent?.startsWith("Hatched bar")).length).toBe(2);
    // Book MoM is still Aug vs Jul (696/657 = +5.9%), not MTD vs Aug (798/696 = +14.7%).
    const bookCard = screen.getByText("Total patient book").closest("div.rounded-lg") as HTMLElement;
    expect(within(bookCard).getByText(/^MoM/).parentElement?.textContent).toContain("+5.9%");
    expect(bookCard.textContent).not.toContain("+14.7%");
    // (The marks themselves — hollow blue dot, dashed connector, hatched bars — need
    // a laid-out ResponsiveContainer, which jsdom does not provide; they are
    // checked in a real browser. See the PR screenshots.)
  });

  it("hides a stale MTD column once its month has a certified column (the 1st, between runs)", async () => {
    const staleMonths = ["Sep 2026 MTD · thru Sep 30", "Jul 2026", "Aug 2026", "Sep 2026"];
    const staleMonthly = {
      months: staleMonths,
      rows: [
        row(3, "KPI", staleMonths),
        row(4, "PATIENTS (snapshot at month end)", ["", "", "", ""]),
        row(5, "Total unique patients (Active + Paused)", [810, 657, 696, 812]),
      ],
    };
    const staleKpis = {
      months: ["Sep 2026 MTD · thru Sep 30", "Jul 2026", "Aug 2026", "Sep 2026"],
      rows: [row(3, "Metric", staleMonths), row(4, "Active unique patients", [740, 601, 634, 741])],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload({ kpis: staleKpis as typeof kpis, monthly: staleMonthly as typeof monthly })),
        { status: 200, headers: { "Content-Type": "application/json" } }));
    mount();
    const table = (await screen.findByText("Metric")).closest("table") as HTMLElement;
    expect(headerTexts(table)).toEqual(["Metric", "Jul 2026", "Aug 2026", "Sep 2026", "MoM"]);
    expect(screen.getByText(/SNAPSHOT · as of Sep 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/refreshes daily/)).toBeNull();
  });
});
