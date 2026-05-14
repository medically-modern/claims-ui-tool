// Update the Denial Action status column (color_mm2998p) on a Claims
// Board item. Labels live on Monday already: New claim, Action Complete,
// Corrected claim, Appeal, Investigate, Submit auth, Upload docs,
// Contact payer, Bad Debt.
//
// Used by ClaimDetail.tsx — the operator's Denial Action Select
// auto-writes on change so the action lands on Monday even when the
// resolution is deferred (operator picks Appeal, leaves, comes back
// later to mark Outstanding).

import { mondayQuery, CLAIMS_BOARD_ID } from "./monday";

const DENIAL_ACTION_COL = "color_mm2998p";

const MUTATION = `
  mutation SetDenialAction($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${DENIAL_ACTION_COL}",
      value: $value
    ) { id }
  }
`;

export async function setDenialAction(
  mondayItemId: string,
  label: string,
): Promise<void> {
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(CLAIMS_BOARD_ID),
    value: JSON.stringify({ label }),
  });
}
