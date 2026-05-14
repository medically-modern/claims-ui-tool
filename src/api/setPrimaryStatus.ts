// Update a single item's Primary Status on the Claims Board.
//
// Primary Status column (color_mkxmywtb) accepts these labels:
//   Submit Claim, Submitted, Outstanding, Late, Review, Appeals, Paid,
//   Denied (Or Partly), Bad Debt, Request rejected, Future Claim,
//   Not Started Yet
//
// Used by the Denials tab's Action Complete dialog to move a worked
// denial back to Outstanding (still pending payer response) or to
// Submit Claim (ready to resubmit as a corrected claim).
//
// NOTE — this is a Monday-only write. We do NOT trigger the
// Subscription Board sync here because the denial workflow is
// reversible (operator might appeal, get paid, get denied again).
// Subscription state will catch up the next time the claim hits a
// terminal disposition via the existing /claims/mark-paid or ERA-Denied
// auto-flip paths.

import { mondayQuery, CLAIMS_BOARD_ID } from "./monday";

const PRIMARY_STATUS_COL = "color_mkxmywtb";

const MUTATION = `
  mutation SetPrimaryStatus($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${PRIMARY_STATUS_COL}",
      value: $value
    ) { id }
  }
`;

export async function setPrimaryStatus(
  mondayItemId: string,
  label: string,
): Promise<void> {
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(CLAIMS_BOARD_ID),
    value: JSON.stringify({ label }),
  });
}
