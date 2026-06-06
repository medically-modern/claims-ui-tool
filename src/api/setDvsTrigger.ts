/**
 * setDvsTrigger.ts — write the 'Trigger DVS' label to color_mm2narpj
 * on the Subscription Board. Monday automation watches for that flip
 * and kicks the ePACES Playwright bot, which then writes Running →
 * Success / Failed / MLTC back to the same column.
 *
 * Single-item and parallel-bulk paths so the DVS queue can hit
 * "Run DVS for N" without serializing 88 Monday writes.
 */

import { mondayQuery } from "./monday";
import { SUBSCRIPTION_BOARD_ID, SUB_DVS_COL } from "./queries/dvsPatients";

const TRIGGER_DVS_LABEL = "Trigger DVS";
const CHUNK_SIZE = 10;

const SET_STATUS_MUT = `
  mutation SetTriggerDvs($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${SUB_DVS_COL.trigger_dvs}",
      value: $value
    ) { id }
  }
`;

/** Write 'Trigger DVS' to a single Subscription Board item. */
export async function setDvsTrigger(mondayItemId: string): Promise<void> {
  await mondayQuery(SET_STATUS_MUT, {
    itemId: mondayItemId,
    boardId: String(SUBSCRIPTION_BOARD_ID),
    value: JSON.stringify({ label: TRIGGER_DVS_LABEL }),
  });
}

export interface BulkResult {
  successIds: string[];
  failures: Array<{ id: string; error: string }>;
}

/**
 * Write 'Trigger DVS' to a list of items in parallel chunks of 10.
 * Returns per-item success/failure so the operator can see what landed
 * and what needs a manual retry. Continues on failure — one bad row
 * doesn't block the rest of the bulk.
 *
 * onProgress fires after each chunk so the UI can update a toast.
 */
export async function bulkTriggerDvs(
  mondayItemIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult> {
  const successIds: string[] = [];
  const failures: BulkResult["failures"] = [];
  let done = 0;
  const total = mondayItemIds.length;

  for (let i = 0; i < mondayItemIds.length; i += CHUNK_SIZE) {
    const chunk = mondayItemIds.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(chunk.map((id) => setDvsTrigger(id)));
    results.forEach((r, idx) => {
      const id = chunk[idx];
      if (r.status === "fulfilled") {
        successIds.push(id);
      } else {
        failures.push({
          id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });
    done += chunk.length;
    onProgress?.(done, total);
  }

  return { successIds, failures };
}
