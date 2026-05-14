// Update Claim Resent Date (date_mm29scz) on a Claims Board item.
//
// Stamped today when the operator resolves a denial back to Outstanding.
// Drives the effective-sent-date used by Late ERA aging so a freshly
// resent claim doesn't immediately reappear in the Late bucket.
// Submit-Claim path does NOT write this — that happens when the new 837
// actually goes out in the submit flow.

import { mondayQuery, CLAIMS_BOARD_ID } from "./monday";

const CLAIM_RESENT_DATE_COL = "date_mm29scz";

const MUTATION = `
  mutation SetClaimResentDate($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${CLAIM_RESENT_DATE_COL}",
      value: $value
    ) { id }
  }
`;

/**
 * @param mondayItemId  Claims Board item id
 * @param dateIso       YYYY-MM-DD
 */
export async function setClaimResentDate(
  mondayItemId: string,
  dateIso: string,
): Promise<void> {
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(CLAIMS_BOARD_ID),
    value: JSON.stringify({ date: dateIso }),
  });
}
