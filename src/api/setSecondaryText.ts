// Update a text column on the Secondary Claims Board. Used by inline
// row editors on SecondaryBoard.tsx — e.g. PR Payor ID, Secondary
// Member ID. Writes go directly to Monday (no backend coordinator)
// because no cross-board state changes.

import { mondayQuery, SECONDARY_BOARD_ID } from "./monday";

const UPDATE_TEXT_MUT = `
  mutation SetSecondaryText(
    $itemId: ID!,
    $boardId: ID!,
    $columnId: String!,
    $value: String!
  ) {
    change_simple_column_value(
      item_id:   $itemId,
      board_id:  $boardId,
      column_id: $columnId,
      value:     $value
    ) { id }
  }
`;

export async function setSecondaryText(
  mondayItemId: string,
  columnId: string,
  value: string,
): Promise<void> {
  await mondayQuery(UPDATE_TEXT_MUT, {
    itemId:   mondayItemId,
    boardId:  String(SECONDARY_BOARD_ID),
    columnId,
    value,
  });
}

// Column IDs the Secondary Board exposes for inline edit. Centralised
// here so callers don't sprinkle raw column ids through JSX.
export const SECONDARY_PARENT_COL = {
  // PR Payor ID — Stedi trading partner ID we send the secondary 837
  // to (e.g. "ZTXQE" for Emblem). Editable inline so the operator can
  // set / correct it before hitting Submit Secondary.
  payor_id:           "text_mm1gcz3y",
  secondary_member_id: "text_mm3a7ega",
} as const;
