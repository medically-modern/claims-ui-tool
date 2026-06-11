// Update a single primary item's Secondary Payer on the Claims Board.
//
// Secondary Payer column (color_mkxq1a2p) is a status column with these
// fixed labels (index → label, verified against MONDAY_BOARD_SCHEMA.md
// on 2026-06-09):
//
//   0 → Second to Secondary
//   1 → Patient
//   2 → NY Medicaid
//   3 → Medicare Suppl.
//   4 → Bad Debt
//   6 → No Patient Responsibility
//   7 → Horizon BCBS NJ
//   8 → Cigna
//   9 → Molina
//
// Used by the Mark-fully-paid confirmation dialog: when the operator
// picks a different secondary payer from the dropdown, we stamp it onto
// the primary BEFORE calling /claims/mark-paid. The backend spawn reads
// this column to classify the secondary's Submission Type (Insurance vs
// Patient) and route it accordingly, so the column must be correct at
// mark-paid time — hence the synchronous write-then-mark ordering.
//
// We write by INDEX, not label, to avoid Monday silently creating a
// duplicate label (same lesson as setPrimaryStatus / the Review rename).

import { mondayQuery, CLAIMS_BOARD_ID } from "./monday";

const SECONDARY_PAYER_COL = "color_mkxq1a2p";

/** Single source of truth for the dropdown + the index-based write.
 *  Order here is the order shown in the dropdown. */
export const SECONDARY_PAYER_OPTIONS: ReadonlyArray<{
  label: string;
  index: number;
}> = [
  { label: "Second to Secondary", index: 0 },
  { label: "Patient", index: 1 },
  { label: "NY Medicaid", index: 2 },
  { label: "Medicare Suppl.", index: 3 },
  { label: "Bad Debt", index: 4 },
  { label: "No Patient Responsibility", index: 6 },
  { label: "Horizon BCBS NJ", index: 7 },
  { label: "Cigna", index: 8 },
  { label: "Molina", index: 9 },
];

const LABEL_TO_INDEX = new Map(
  SECONDARY_PAYER_OPTIONS.map((o) => [o.label, o.index]),
);

const MUTATION = `
  mutation SetSecondaryPayer($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${SECONDARY_PAYER_COL}",
      value: $value
    ) { id }
  }
`;

export async function setSecondaryPayer(
  mondayItemId: string,
  label: string,
): Promise<void> {
  const index = LABEL_TO_INDEX.get(label);
  if (index === undefined) {
    throw new Error(`Unknown Secondary Payer label: "${label}"`);
  }
  await mondayQuery(MUTATION, {
    itemId: mondayItemId,
    boardId: String(CLAIMS_BOARD_ID),
    value: JSON.stringify({ index }),
  });
}
