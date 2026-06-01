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

const MOVE_GROUP_MUT = `
  mutation MoveGroup($itemId: ID!, $groupId: String!) {
    move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
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

/**
 * Set Secondary Status AND move the item to a group in one operation.
 * If the group move fails (network blip, group renamed, whatever), the
 * status write already landed so the row is correct in the data layer —
 * the group move is just visual organization on Monday.
 *
 * Group IDs for the workflow transitions:
 *   group_mm332zns  Insurance Outstanding
 *   group_mkwta260  Patient Responsibility Outstanding
 *   group_mkxsng4r  Paid And Closed
 *   group_mm3ba7x1  Send Invoice
 *   group_mkpehq9q  Submit Claim
 */
export async function setSecondaryStatusAndMove(
  mondayItemId: string,
  label: string,
  groupId: string,
): Promise<void> {
  await setSecondaryStatus(mondayItemId, label);
  try {
    await mondayQuery(MOVE_GROUP_MUT, {
      itemId: mondayItemId,
      groupId,
    });
  } catch (e) {
    console.warn(
      "[setSecondaryStatusAndMove] group move failed for "
        + `${mondayItemId} -> ${groupId}:`,
      e,
    );
  }
}

// ─── Send Invoice trigger column ─────────────────────────────────────────────
// Separate Monday status column (color_mm3x6qe6) with the single label
// "Done". Flipping this to Done is the trigger Brandon's downstream Monday
// automation watches for: when Send Invoice → Done, an external automation
// fires the patient SMS with the invoice link.
//
// We keep this column intentionally minimal (one label) so the automation
// never has to disambiguate state — the only event is "Done flip,
// payload-ready row." Reset / re-fire happens by clearing the column on
// Monday (no API call from here).
//
// The write is decoupled from Secondary Status + group move so the SMS
// automation fires even if a future caller doesn't move the row (e.g. a
// bulk-send tool that just stamps Send Invoice across many rows).
const SEND_INVOICE_TRIGGER_COL = "color_mm3x6qe6";

const SEND_INVOICE_TRIGGER_MUT = `
  mutation FireSendInvoice($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${SEND_INVOICE_TRIGGER_COL}",
      value: $value
    ) { id }
  }
`;

/**
 * Fire the Send Invoice trigger by writing "Done" to color_mm3x6qe6.
 * Drives the Monday automation that sends the patient an SMS with their
 * invoice link. Idempotent — flipping to Done when already Done is a
 * no-op on Monday's side.
 */
export async function fireSendInvoiceTrigger(
  mondayItemId: string,
): Promise<void> {
  await mondayQuery(SEND_INVOICE_TRIGGER_MUT, {
    itemId: mondayItemId,
    boardId: String(SECONDARY_BOARD_ID),
    value: JSON.stringify({ label: "Done" }),
  });
}
