// Board-agnostic Action Context (text_mm29v2ph) writer. Both Primary
// and Secondary Claims Boards inherited this column with the same id
// from the original duplication, so we just need to point the mutation
// at the right board.
//
// Used by the EFT Enrollment tab's inline notes editor, where rows
// span both boards.

import { mondayQuery, CLAIMS_BOARD_ID, SECONDARY_BOARD_ID } from "./monday";

const ACTION_CONTEXT_COL = "text_mm29v2ph";

const MUTATION = `
  mutation SetActionContext($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${ACTION_CONTEXT_COL}",
      value: $value
    ) { id }
  }
`;

export async function setActionContextOnBoard(
  mondayItemId: string,
  board: "primary" | "secondary",
  text: string,
): Promise<void> {
  const boardId = board === "primary" ? CLAIMS_BOARD_ID : SECONDARY_BOARD_ID;
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(boardId),
    value: JSON.stringify(text),
  });
}
