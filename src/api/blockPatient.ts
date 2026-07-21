/**
 * blockPatient.ts — Order Cycle v2 block/unblock/check-in/churn writes.
 *
 * All writes go column-by-column (per feedback_monday_batch_writes:
 * Monday batch mutations are atomic — one bad column kills the batch).
 * The single change_multiple_column_values call here is intentionally
 * scoped to ONE dropdown column so create_labels_if_missing works.
 *
 * Block Note is append-only: callers pass the existing note text and an
 * entry; we prepend "[yyyy-mm-dd] entry" above the history so the newest
 * context reads first in Monday and in the drawer.
 */

import { mondayQuery } from "./monday";
import { SUB_COL, SUBSCRIPTION_BOARD_ID } from "./queries/subscriptionPatients";
import { todayIso } from "@/lib/subscription/lanes";

const NOT_ACTIVE_GROUP_ID = "group_mkp19fyp";

const SIMPLE_MUT = `
  mutation SetSimple($itemId: ID!, $boardId: ID!, $columnId: String!, $value: String!) {
    change_simple_column_value(
      item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value
    ) { id }
  }
`;
const STATUS_MUT = `
  mutation SetStatus($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(
      item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value
    ) { id }
  }
`;
const DROPDOWN_MUT = `
  mutation SetDropdown($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_multiple_column_values(
      item_id: $itemId, board_id: $boardId, column_values: $value,
      create_labels_if_missing: true
    ) { id }
  }
`;
const MOVE_GROUP_MUT = `
  mutation MoveGroup($itemId: ID!, $groupId: String!) {
    move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
  }
`;

async function writeSimple(itemId: string, columnId: string, value: string) {
  await mondayQuery(SIMPLE_MUT, {
    itemId, boardId: String(SUBSCRIPTION_BOARD_ID), columnId, value,
  });
}
async function writeStatus(itemId: string, columnId: string, label: string | null) {
  await mondayQuery(STATUS_MUT, {
    itemId, boardId: String(SUBSCRIPTION_BOARD_ID), columnId,
    value: JSON.stringify(label ? { label } : {}),
  });
}
async function writeDropdownLabels(itemId: string, columnId: string, labels: string[]) {
  await mondayQuery(DROPDOWN_MUT, {
    itemId, boardId: String(SUBSCRIPTION_BOARD_ID),
    value: JSON.stringify({ [columnId]: { labels } }),
  });
}

function appendNote(existing: string | undefined, entry: string): string {
  const stamped = `[${todayIso()}] ${entry.trim()}`;
  const rest = (existing ?? "").trim();
  return rest ? `${stamped}\n${rest}` : stamped;
}

export interface WriteResult {
  ok: string[];
  failed: Array<{ step: string; error: string }>;
}

/** Run steps sequentially; record failures per step, never throw mid-way. */
async function runSteps(
  steps: Array<[string, () => Promise<void>]>,
): Promise<WriteResult> {
  const ok: string[] = [];
  const failed: WriteResult["failed"] = [];
  for (const [name, fn] of steps) {
    try {
      await fn();
      ok.push(name);
    } catch (e) {
      failed.push({ step: name, error: (e as Error).message });
    }
  }
  return { ok, failed };
}

/**
 * Block a patient: set reason(s) + note + optional check-in date.
 * Flips Status → Paused, arms the watcher (Resolution = Watching),
 * stamps Blocked Date, resets the missed-check-in counter.
 */
export async function blockPatient(
  itemId: string,
  opts: {
    reasons: string[];
    note: string;
    checkInDate?: string;   // ISO yyyy-mm-dd
    existingNote?: string;
  },
): Promise<WriteResult> {
  const entry = `BLOCKED — ${opts.reasons.join(", ")}${opts.note ? `: ${opts.note}` : ""}`;
  return runSteps([
    ["reason",     () => writeDropdownLabels(itemId, SUB_COL.pause_reason, opts.reasons)],
    ["status",     () => writeStatus(itemId, SUB_COL.status, "Paused")],
    ["resolution", () => writeStatus(itemId, SUB_COL.block_resolution, "Watching")],
    ["blockedDate",() => writeSimple(itemId, SUB_COL.blocked_date, todayIso())],
    ["checkIn",    () => writeSimple(itemId, SUB_COL.check_in_date, opts.checkInDate ?? "")],
    ["missed",     () => writeSimple(itemId, SUB_COL.missed_checkins, "0")],
    ["note",       () => writeSimple(itemId, SUB_COL.block_note, appendNote(opts.existingNote, entry))],
  ]);
}

/**
 * Unblock: Status → Active, clear reason/resolution/dates/counter.
 * Block Note keeps the full history (append an UNBLOCKED entry).
 */
export async function unblockPatient(
  itemId: string,
  opts: { note?: string; existingNote?: string },
): Promise<WriteResult> {
  const entry = `UNBLOCKED${opts.note ? ` — ${opts.note}` : ""}`;
  return runSteps([
    ["status",     () => writeStatus(itemId, SUB_COL.status, "Active")],
    ["reason",     () => writeDropdownLabels(itemId, SUB_COL.pause_reason, [])],
    ["resolution", () => writeStatus(itemId, SUB_COL.block_resolution, null)],
    ["blockedDate",() => writeSimple(itemId, SUB_COL.blocked_date, "")],
    ["checkIn",    () => writeSimple(itemId, SUB_COL.check_in_date, "")],
    ["missed",     () => writeSimple(itemId, SUB_COL.missed_checkins, "")],
    ["note",       () => writeSimple(itemId, SUB_COL.block_note, appendNote(opts.existingNote, entry))],
  ]);
}

/**
 * Record a check-in on a blocked patient.
 *  - contact=true  → counter resets to 0; next date optional.
 *  - contact=false → counter +1; next date required by the UI
 *    (at FORCED_DECISION_MISSES the UI forces renew-or-churn instead).
 */
export async function recordCheckIn(
  itemId: string,
  opts: {
    contact: boolean;
    note: string;
    nextDate?: string;
    currentMissed: number;
    existingNote?: string;
  },
): Promise<WriteResult> {
  const nextMissed = opts.contact ? 0 : opts.currentMissed + 1;
  const entry = `CHECK-IN (${opts.contact ? "patient contact" : `no contact — miss #${nextMissed}`})${opts.note ? `: ${opts.note}` : ""}${opts.nextDate ? ` · next ${opts.nextDate}` : ""}`;
  return runSteps([
    ["missed",  () => writeSimple(itemId, SUB_COL.missed_checkins, String(nextMissed))],
    ["checkIn", () => writeSimple(itemId, SUB_COL.check_in_date, opts.nextDate ?? "")],
    ["note",    () => writeSimple(itemId, SUB_COL.block_note, appendNote(opts.existingNote, entry))],
  ]);
}

/**
 * Churn: move to Not Active with a Dead Reason. Reactivation is always
 * possible — Not Active is a parking lot, not a grave (doc §3.1).
 */
export async function churnPatient(
  itemId: string,
  opts: { deadReason: string; note?: string; existingNote?: string },
): Promise<WriteResult> {
  const entry = `MOVED TO NOT ACTIVE — ${opts.deadReason}${opts.note ? `: ${opts.note}` : ""}`;
  return runSteps([
    ["note",       () => writeSimple(itemId, SUB_COL.block_note, appendNote(opts.existingNote, entry))],
    ["deadReason", () => writeDropdownLabels(itemId, SUB_COL.dead_reason, [opts.deadReason])],
    ["status",     () => writeStatus(itemId, SUB_COL.status, "Not Active")],
    ["reason",     () => writeDropdownLabels(itemId, SUB_COL.pause_reason, [])],
    ["resolution", () => writeStatus(itemId, SUB_COL.block_resolution, null)],
    ["checkIn",    () => writeSimple(itemId, SUB_COL.check_in_date, "")],
    ["group",      () => mondayQuery(MOVE_GROUP_MUT, { itemId, groupId: NOT_ACTIVE_GROUP_ID }).then(() => undefined)],
  ]);
}
