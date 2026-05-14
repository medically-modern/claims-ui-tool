// Update a single item's Action Context (text_mm29v2ph) on the Claims
// Board. Operator-typed free text describing what was done on a denial
// — e.g. "Called payer 5/13, agent confirmed they need updated CMN, faxed".
//
// Used from ClaimDetail.tsx when the operator saves a denial action or
// resolves a denial. Direct Monday write; no backend hop required.

import { mondayQuery, CLAIMS_BOARD_ID } from "./monday";

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

export async function setActionContext(
  mondayItemId: string,
  text: string,
): Promise<void> {
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(CLAIMS_BOARD_ID),
    value: JSON.stringify(text),
  });
}
