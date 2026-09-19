/**
 * monthColumns.ts — how the Financials tab tells the sheet's certified
 * month-end columns apart from the single month-to-date (MTD) column.
 *
 * The sheet writer (scripts/monthly-financials-sheet.py --mtd) rewrites one
 * MTD column every morning, headed like "Sep 2026 MTD · thru Sep 19", and
 * keeps it as the LAST column of the Monthly Financials / KPIs tabs (month-end
 * runs certify it in place or insert left of it). The UI still never assumes
 * a position — it finds the column by header, so a sheet with the MTD column
 * anywhere (or nowhere) renders the same way.
 *
 * Rules the views rely on:
 *   - MoM deltas, charts, "as of" labels, audit badge and payer-share sorting
 *     use ONLY `full` (the last two full months for MoM).
 *   - The MTD column renders after the full months and is hidden when its
 *     month already has a certified column (the hour on the 1st between the
 *     month-end run and the next MTD run).
 */

export interface MtdColumn {
  /** index into SheetTab.months / row.values / row.raw */
  idx: number;
  /** "Sep 2026" */
  month: string;
  /** "Sep 17" — data cut-off as written by the sheet job, if present */
  thru?: string;
  /** day-of-month of the cut-off (17), when `thru` parses */
  day?: number;
  /** days in the MTD month (30), when the month label parses */
  daysInMonth?: number;
  /** the raw header text, verbatim */
  label: string;
}

export interface MonthColumns {
  /** certified month-end columns, in sheet order */
  full: number[];
  /** the month-to-date column to render, or null */
  mtd: MtdColumn | null;
}

const MTD_RE = /^([A-Za-z]{3} \d{4}) MTD(?:\s*[·(]\s*thru\s+([^)]+?)\)?)?\s*$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse an MTD header; null for a normal month header. */
export function parseMtdLabel(label: string): Omit<MtdColumn, "idx"> | null {
  const m = MTD_RE.exec((label ?? "").trim());
  if (!m) return null;
  const month = m[1];
  const thru = m[2]?.trim() || undefined;
  const out: Omit<MtdColumn, "idx"> = { month, thru, label: label.trim() };

  const [mon, yr] = month.split(" ");
  const mi = MONTHS.indexOf(mon.toLowerCase());
  const year = Number(yr);
  if (mi >= 0 && Number.isFinite(year)) {
    out.daysInMonth = new Date(year, mi + 1, 0).getDate();
  }
  const d = thru ? /(\d{1,2})\s*$/.exec(thru) : null;
  if (d) out.day = Number(d[1]);
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Split a tab's month headers into certified columns and the MTD column. */
export function splitMonthColumns(months: string[]): MonthColumns {
  const full: number[] = [];
  let mtd: MtdColumn | null = null;
  months.forEach((label, idx) => {
    const p = parseMtdLabel(label);
    if (p) {
      if (!mtd) mtd = { idx, ...p }; // one MTD column by construction; ignore any extra
    } else {
      full.push(idx);
    }
  });
  // Certified month already present → the MTD column is stale (the 1st,
  // between the month-end run and the next MTD refresh). Hide it.
  if (mtd && full.some((i) => norm(months[i]) === norm(mtd!.month))) mtd = null;
  return { full, mtd };
}

/** Values of a row restricted to the certified columns (for MoM / charts). */
export function pickFull<T>(arr: T[] | undefined, cols: MonthColumns): T[] {
  if (!arr) return [];
  return cols.full.map((i) => arr[i]).filter((v) => v !== undefined) as T[];
}

/** The last certified column's value in a row (undefined if none). */
export function lastFull<T>(arr: T[] | undefined, cols: MonthColumns): T | undefined {
  const i = cols.full[cols.full.length - 1];
  return i === undefined || !arr ? undefined : arr[i];
}

// ─── Chart ticks ─────────────────────────────────────────────────────────────

/** The x-axis label the charts use for the MTD point ("Sep MTD"). */
export function mtdTickLabel(mtd: Pick<MtdColumn, "month">): string {
  return `${mtd.month.slice(0, 3)} MTD`;
}
const MTD_TICK_RE = /^[A-Za-z]{3} MTD$/;
export const isMtdTick = (value: string) => MTD_TICK_RE.test(value);

/**
 * Compact x-axis labels that fit a phone: "Jul", "Aug" — with the year
 * ("Apr '25") only on charts that span more than one calendar year — and
 * "Sep MTD" for the provisional point. Anything else passes through.
 */
export function tickLabel(value: string, withYear: boolean): string {
  if (isMtdTick(value)) return value;
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(value.trim());
  if (!m) return value;
  return withYear ? `${m[1]} '${m[2].slice(2)}` : m[1];
}

/** True when the month labels cover more than one calendar year. */
export function spansYears(months: string[]): boolean {
  const years = new Set(months.map((v) => /(\d{4})$/.exec(v)?.[1]).filter(Boolean));
  return years.size > 1;
}

// ─── Realization freshness ───────────────────────────────────────────────────

/**
 * When the Realization tab was last measured, derived from its own numbers:
 * "Days since month end" of the newest DOS month that has already ended,
 * added to that month's last day. Returns null when nothing can be derived
 * (e.g. every column is the running month, whose age is floored at 0).
 * Uses the sheet's month labels ("Aug 2026") — no clock needed.
 */
export function realizationMeasuredOn(months: string[], ages: (number | null)[]): Date | null {
  let best: Date | null = null;
  months.forEach((label, i) => {
    const age = ages[i];
    const m = /^([A-Za-z]{3}) (\d{4})$/.exec(label.trim());
    if (age === null || age === undefined || age <= 0 || !m) return;
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi < 0) return;
    const monthEnd = new Date(Date.UTC(Number(m[2]), mi + 1, 0));   // last day of the DOS month
    const measured = new Date(monthEnd.getTime() + age * 864e5);
    if (!best || measured > best) best = measured;
  });
  return best;
}

/** "Sep 19" — for pills; UTC-safe because the dates come from UTC math. */
export function fmtShortDate(d: Date): string {
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${mon} ${d.getUTCDate()}`;
}

/** True when a "Sep 2026" label is the calendar month of `d` (UTC). */
export function isMonthOf(label: string, d: Date): boolean {
  const m = /^([A-Za-z]{3}) (\d{4})$/.exec(label.trim());
  if (!m) return false;
  return MONTHS.indexOf(m[1].toLowerCase()) === d.getUTCMonth() && Number(m[2]) === d.getUTCFullYear();
}
