/**
 * noteActivity.ts — when did anyone last write a note on this patient?
 *
 * The three note columns are plain text/long-text cells, so the value tells
 * you WHAT was written but not WHEN. Brandon's rule for the row's "read this
 * before ordering" icon is a 30-day window ending at the order date, which a
 * bare cell value cannot answer — a note typed six months ago would badge the
 * row forever, which is exactly the staleness that made the old Pencil badge
 * useless (≈half of them were from a previous order cycle).
 *
 * Monday's board activity log does carry the timestamp, and it can be filtered
 * to specific columns, so one extra query per refresh buys a real answer.
 * Measured on the live board 2026-09-19: 187 events across these three columns
 * in 35 days, 168 distinct patients — small enough to fetch whole.
 *
 * ⚠️ `created_at` on activity_logs is NOT an ISO string — it is 100-nanosecond
 * ticks since the epoch as a decimal string (17 digits). Divide by 1e4 for
 * milliseconds. Parsing it as a date silently yields Invalid Date.
 */
import { mondayQuery } from "../monday";

/** How far back to read the log. The window the UI asks about ends at the
 *  order date and reaches 30 days before it, and orders can sit past due for
 *  a while, so 60 days covers every row the board can show without paging
 *  through a year of history. */
const LOOKBACK_DAYS = 60;
const PAGE_SIZE = 500;
const MAX_PAGES = 8;

const ACTIVITY_QUERY = `
query ($boardId: [ID!], $cols: [String!], $from: ISO8601DateTime!, $to: ISO8601DateTime!, $page: Int!) {
  boards(ids: $boardId) {
    activity_logs(column_ids: $cols, from: $from, to: $to, limit: ${PAGE_SIZE}, page: $page) {
      created_at
      data
    }
  }
}`;

interface ActivityResponse {
  boards: Array<{ activity_logs: Array<{ created_at: string; data: string }> | null }>;
}

/**
 * itemId → epoch ms of the most recent write to any of `columnIds`.
 * Returns an empty map (never throws) if the log is unavailable: a missing
 * timestamp must degrade to "don't badge it", not to a crashed board.
 */
export async function fetchNoteActivity(
  boardId: string | number,
  columnIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 86_400_000);
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await mondayQuery<ActivityResponse>(ACTIVITY_QUERY, {
        boardId: String(boardId),
        cols: columnIds,
        from: from.toISOString(),
        to: to.toISOString(),
        page,
      });
      const logs = res.boards?.[0]?.activity_logs ?? [];
      for (const log of logs) {
        let pulseId = "";
        try {
          pulseId = String((JSON.parse(log.data) as { pulse_id?: string | number }).pulse_id ?? "");
        } catch {
          continue;
        }
        if (!pulseId) continue;
        const ticks = Number(log.created_at);
        if (!Number.isFinite(ticks)) continue;
        const ms = ticks / 1e4;
        const prev = out.get(pulseId);
        if (prev == null || ms > prev) out.set(pulseId, ms);
      }
      if (logs.length < PAGE_SIZE) break;
    }
  } catch {
    // Board still renders; rows simply carry no note timestamp.
    return out;
  }
  return out;
}
