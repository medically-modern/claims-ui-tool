/**
 * splitSubscription — turn one "Sensors & Supplies" subscription into two
 * (Brandon, 2026-09-29):
 *
 *   existing item → Sensors only   (keeps its claims / order history)
 *   new item      → Supplies only  (duplicate of the existing item)
 *
 * The duplicate carries everything that's the same patient — demographics,
 * insurance, doctor, diagnosis, MN docs, next order date, frequency. Each side
 * then has the other product line switched off: "Not Serving" on the product
 * / auth / coverage status columns and the other side's quantities, auth IDs
 * and auth dates cleared. Financial columns recalculate on the board.
 *
 * Writes go one column per call (feedback_monday_batch_writes: one bad column
 * kills a whole batch). Order matters: the new Supplies item is fully set up
 * BEFORE the original is narrowed to Sensors, so a failure part-way never
 * leaves the patient without supplies on either profile.
 */
import { mondayQuery } from "./monday";
import { SUB_COL, SUBSCRIPTION_BOARD_ID } from "./queries/subscriptionPatients";

const CGM_COVERAGE = "color_mm2cmgqe";
const NOT_SERVING = "Not Serving";

type Write =
  | { col: string; kind: "status"; label: string | null }
  | { col: string; kind: "text" }       // clear a text / number column
  | { col: string; kind: "date" };      // clear a date column

/** Columns written on the ORIGINAL item → Sensors only. */
export const SENSORS_ONLY_WRITES: Write[] = [
  { col: SUB_COL.subscription, kind: "status", label: "Sensors" },
  { col: SUB_COL.supplies_type, kind: "status", label: NOT_SERVING },
  { col: SUB_COL.supplies_auth_status, kind: "status", label: NOT_SERVING },
  { col: SUB_COL.inf_set_1, kind: "status", label: null },
  { col: SUB_COL.inf_set_2, kind: "status", label: null },
  { col: SUB_COL.inf_qty_1, kind: "text" },
  { col: SUB_COL.inf_qty_2, kind: "text" },
  { col: SUB_COL.cartridge_qty, kind: "text" },
  { col: SUB_COL.inf_set_auth_id, kind: "text" },
  { col: SUB_COL.cartridge_auth_id, kind: "text" },
  { col: SUB_COL.supplies_units, kind: "text" },
  { col: SUB_COL.supplies_auth_start, kind: "date" },
  { col: SUB_COL.supplies_auth_end, kind: "date" },
];

/** Columns written on the NEW (duplicated) item → Supplies only. */
export const SUPPLIES_ONLY_WRITES: Write[] = [
  { col: SUB_COL.subscription, kind: "status", label: "Supplies" },
  { col: SUB_COL.sensors_type, kind: "status", label: NOT_SERVING },
  { col: SUB_COL.sensors_auth_status, kind: "status", label: NOT_SERVING },
  { col: CGM_COVERAGE, kind: "status", label: NOT_SERVING },
  { col: SUB_COL.cgm_qty, kind: "text" },
  { col: SUB_COL.sensors_auth_id, kind: "text" },
  { col: SUB_COL.sensors_id_2, kind: "text" },
  { col: SUB_COL.sensors_units, kind: "text" },
  { col: SUB_COL.sensors_auth_start, kind: "date" },
  { col: SUB_COL.sensors_auth_end, kind: "date" },
];

const DUPLICATE_MUT = `
  mutation Dup($boardId: ID!, $itemId: ID!) {
    duplicate_item(board_id: $boardId, item_id: $itemId, with_updates: false) { id }
  }
`;
const RENAME_MUT = `
  mutation Rename($boardId: ID!, $itemId: ID!, $value: String!) {
    change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
  }
`;
const SET_MUT = `
  mutation Set($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
  }
`;

function valueFor(w: Write): string {
  if (w.kind === "status") return JSON.stringify(w.label ? { label: w.label } : {});
  if (w.kind === "date") return JSON.stringify({});
  return JSON.stringify("");
}

async function applyWrites(itemId: string, writes: Write[]): Promise<{ col: string; error: string }[]> {
  const failed: { col: string; error: string }[] = [];
  for (const w of writes) {
    try {
      await mondayQuery(SET_MUT, {
        boardId: String(SUBSCRIPTION_BOARD_ID), itemId, columnId: w.col, value: valueFor(w),
      });
    } catch (e) {
      failed.push({ col: w.col, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return failed;
}

export interface SplitResult {
  suppliesItemId: string;
  failed: { item: "sensors" | "supplies"; col: string; error: string }[];
}

export async function splitSubscription(itemId: string, name: string): Promise<SplitResult> {
  const dup = await mondayQuery<{ duplicate_item: { id: string } }>(DUPLICATE_MUT, {
    boardId: String(SUBSCRIPTION_BOARD_ID), itemId: String(itemId),
  });
  const suppliesItemId = String(dup.duplicate_item?.id ?? "");
  if (!suppliesItemId) throw new Error("Monday didn't return the new item.");

  // Monday may suffix the copy's name; keep it identical to the original.
  await mondayQuery(RENAME_MUT, {
    boardId: String(SUBSCRIPTION_BOARD_ID), itemId: suppliesItemId, value: name,
  }).catch(() => undefined);

  const supFailed = await applyWrites(suppliesItemId, SUPPLIES_ONLY_WRITES);
  if (supFailed.some((f) => f.col === SUB_COL.subscription)) {
    // The new item never became Supplies-only — don't narrow the original.
    throw new Error(`Couldn't set up the Supplies profile: ${supFailed[0].error}`);
  }
  const senFailed = await applyWrites(String(itemId), SENSORS_ONLY_WRITES);
  return {
    suppliesItemId,
    failed: [
      ...supFailed.map((f) => ({ item: "supplies" as const, ...f })),
      ...senFailed.map((f) => ({ item: "sensors" as const, ...f })),
    ],
  };
}
