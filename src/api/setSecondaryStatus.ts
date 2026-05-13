// Update a single item's Secondary Status on Monday's Secondary Claims Board.
//
// The Secondary Status column (color_mm3a5yak) accepts these labels:
//   Submit, Forwarded, Submitted, Outstanding, Late, Review,
//   Sent to Patient, Paid, Patient Paid, Denied, Bad Debt
//
// We currently only flip between "Paid" and "Outstanding" from the
// ERA Review row's Submit button. This call hits Monday directly from
// the browser using VITE_MONDAY_API_TOKEN — same risk profile as every
// other write in this app.
//
// NOT YET WIRED: This only updates the secondary's own status. To
// propagate Mark Paid back to the primary board / subscription board
// the backend will need a coordinator endpoint (POST /secondary/mark-paid)
// that writes the secondary status AND updates the corresponding primary
// item AND notifies the subscription board. That work is pending; for
// now this function just settles the secondary side.

import { mondayQuery, SECONDARY_BOARD_ID } from "./monday";

const SECONDARY_STATUS_COL = "color_mm3a5yak";

const MUTATION = `
  mutation SetSecondaryStatus($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${SECONDARY_STATUS_COL}",
      value: $value
    ) { id }
  }
`;

export async function setSecondaryStatus(
  mondayItemId: string,
  label: string,
): Promise<void> {
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(SECONDARY_BOARD_ID),
    value: JSON.stringify({ label }),
  });
}
