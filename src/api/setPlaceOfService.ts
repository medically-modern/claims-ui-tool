// Update the Place of Service status column (color_mm3fk3qv) on a
// Claims Board item. Labels live on Monday already: Home, Office.
//
// Used by ClaimDetail.tsx — operator clicks the Home/Office toggle in
// the patient-info strip and the change writes through immediately.
// The backend's 837 builder (claims_submission_service) reads this and
// maps Home -> 12, Office -> 11 in placeOfServiceCode.

import { mondayQuery, CLAIMS_BOARD_ID } from "./monday";

const PLACE_OF_SERVICE_COL = "color_mm3fk3qv";

const MUTATION = `
  mutation SetPlaceOfService($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${PLACE_OF_SERVICE_COL}",
      value: $value
    ) { id }
  }
`;

export async function setPlaceOfService(
  mondayItemId: string,
  label: "Home" | "Office",
): Promise<void> {
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(CLAIMS_BOARD_ID),
    value: JSON.stringify({ label }),
  });
}
