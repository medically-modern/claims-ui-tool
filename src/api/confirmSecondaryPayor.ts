// Confirm Payor flow — operator picks Insurance or Patient as the
// final destination for a freshly-spawned secondary item. Writes
// Submission Type + Payor Confirmed AND moves the item to the right
// Monday group so the visual board mirrors the workflow stage.
//
//   Insurance -> Submit Claim group (group_mkpehq9q)
//                Operator submits the 837 from there.
//   Patient   -> Send Invoice group (group_mm3ba7x1)
//                Operator generates + sends the patient statement.
//
// Direct Monday write — no backend coordinator needed because no
// cross-board state changes (Primary stays Partial, Subscription
// stays Outstanding; nothing flips until the operator actually sends
// the claim / invoice or marks paid).

import { mondayQuery, SECONDARY_BOARD_ID } from "./monday";

const SUBMIT_CLAIM_GROUP = "group_mkpehq9q";
const SEND_INVOICE_GROUP = "group_mm3ba7x1";

const UPDATE_COLS_MUT = `
  mutation ConfirmPayorCols(
    $itemId: ID!,
    $boardId: ID!,
    $columnValues: JSON!
  ) {
    change_multiple_column_values(
      item_id: $itemId,
      board_id: $boardId,
      column_values: $columnValues,
      create_labels_if_missing: true
    ) { id }
  }
`;

const MOVE_GROUP_MUT = `
  mutation MoveGroup($itemId: ID!, $groupId: String!) {
    move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
  }
`;

export async function confirmSecondaryPayor(
  mondayItemId: string,
  submissionType: "Insurance" | "Patient",
): Promise<void> {
  // 1. Columns: Submission Type + Payor Confirmed.
  const values = {
    color_mm3awg8g: { label: submissionType },
    color_mm3bhy6m: { label: "Yes" },
  };
  await mondayQuery(UPDATE_COLS_MUT, {
    itemId: mondayItemId,
    boardId: String(SECONDARY_BOARD_ID),
    columnValues: JSON.stringify(values),
  });

  // 2. Move the item to the right destination group. If this fails
  // it's not a deal-breaker — the columns already landed, so the
  // frontend will route correctly via bucketOf. The group move is
  // for the operator's Monday-side visual organization.
  const targetGroup =
    submissionType === "Insurance" ? SUBMIT_CLAIM_GROUP : SEND_INVOICE_GROUP;
  try {
    await mondayQuery(MOVE_GROUP_MUT, {
      itemId: mondayItemId,
      groupId: targetGroup,
    });
  } catch (e) {
    console.warn("[confirmSecondaryPayor] group move failed:", e);
  }
}
