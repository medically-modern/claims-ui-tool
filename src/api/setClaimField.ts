// Generic Monday column writers for the Claims Board (parent items and
// subitems). Used by PrimarySubmitBoard and any other component that lets
// the operator edit a cell — every UI edit fires through here so the
// Monday board stays the source of truth and the backend's Submit flow
// (which re-reads Monday at submission time) picks up the latest values.
//
// Design choices:
//   - One function per kind (status / text / date / dropdown / numbers)
//     keeps the JSON encoding shapes explicit at the call site rather
//     than buried in a switch. The cell components already know what
//     kind of column they're editing.
//   - `create_labels_if_missing: true` on status / dropdown writes so a
//     payer or diagnosis that isn't in Monday's option list yet auto-
//     creates instead of failing. The Claims Board dropdowns evolve
//     organically and we don't want a hard rejection from a missing
//     option to block a submission.
//   - Subitem writers target SUBITEMS_BOARD_ID; parent writers target
//     CLAIMS_BOARD_ID. Both share the same mutation shape.
//   - Synthetic subitem IDs (from addLine, e.g. "abc-L1234567890")
//     should be filtered out by the caller — those subitems don't
//     exist on Monday yet. The functions here will fail loudly if you
//     pass one, on purpose.

import { mondayQuery, CLAIMS_BOARD_ID, SUBITEMS_BOARD_ID } from "./monday";

const CHANGE_MULTI = `
  mutation ChangeMulti(
    $itemId: ID!,
    $boardId: ID!,
    $columnValues: JSON!,
    $createLabels: Boolean!
  ) {
    change_multiple_column_values(
      item_id: $itemId,
      board_id: $boardId,
      column_values: $columnValues,
      create_labels_if_missing: $createLabels
    ) { id }
  }
`;

async function writeOne(
  boardId: number,
  itemId: string,
  columnId: string,
  encodedValue: unknown,
  createLabels: boolean,
): Promise<void> {
  await mondayQuery(CHANGE_MULTI, {
    itemId,
    boardId: String(boardId),
    columnValues: JSON.stringify({ [columnId]: encodedValue }),
    createLabels,
  });
}

// ---------- Parent (Claims Board) writers ----------

/** Status column write — value is the human label. Auto-creates the
 *  label on Monday if it doesn't exist yet. */
export function setClaimParentStatus(
  itemId: string,
  columnId: string,
  label: string,
): Promise<void> {
  return writeOne(CLAIMS_BOARD_ID, itemId, columnId, { label }, true);
}

/** Text column write — plain string. Empty string is allowed and
 *  clears the cell. */
export function setClaimParentText(
  itemId: string,
  columnId: string,
  text: string,
): Promise<void> {
  return writeOne(CLAIMS_BOARD_ID, itemId, columnId, text, false);
}

/** Date column write — YYYY-MM-DD. Empty string clears the cell. */
export function setClaimParentDate(
  itemId: string,
  columnId: string,
  isoDate: string,
): Promise<void> {
  const value = isoDate ? { date: isoDate } : {};
  return writeOne(CLAIMS_BOARD_ID, itemId, columnId, value, false);
}

// ---------- Subitem (Claims Subitems Board) writers ----------

/** Status column write on a subitem. */
export function setClaimSubitemStatus(
  subitemId: string,
  columnId: string,
  label: string,
): Promise<void> {
  return writeOne(SUBITEMS_BOARD_ID, subitemId, columnId, { label }, true);
}

/** Dropdown (multi-label) column write on a subitem. Empty array clears. */
export function setClaimSubitemDropdown(
  subitemId: string,
  columnId: string,
  labels: string[],
): Promise<void> {
  return writeOne(
    SUBITEMS_BOARD_ID,
    subitemId,
    columnId,
    { labels },
    true,
  );
}

/** Text column write on a subitem. */
export function setClaimSubitemText(
  subitemId: string,
  columnId: string,
  text: string,
): Promise<void> {
  return writeOne(SUBITEMS_BOARD_ID, subitemId, columnId, text, false);
}

/** Numeric column write on a subitem. Monday expects a stringified
 *  number; empty string clears the cell. */
export function setClaimSubitemNumber(
  subitemId: string,
  columnId: string,
  n: number | "",
): Promise<void> {
  const value = n === "" ? "" : String(n);
  return writeOne(SUBITEMS_BOARD_ID, subitemId, columnId, value, false);
}

// ---------- Column IDs (parent + subitem) ----------
//
// Centralised here so cell components don't sprinkle Monday IDs through
// their JSX. Keep in sync with MONDAY_BOARD_SCHEMA.md.

export const CLAIM_PARENT_COL = {
  primary_payor:   "color_mkxmhypt",
  member_id:       "text_mktat89m",
  dos:             "date_mkwr7spz",
  diagnosis:       "color_mky2gpz5",
  place_of_service:"color_mm3fk3qv",
  claim_type:      "color_mm2nvk1p",
  // Parent-level Authorization text. Holds the comma-joined union of
  // all subitem Auth IDs — rewritten whenever a subitem auth changes
  // so the 837 builder (services/claims_submission_service.py reads
  // parent.auth) picks up the latest set. Line-level auth IDs are also
  // sent individually via the SV1 REF*G1 loop, but this parent string
  // is what the operator + board see at a glance.
  auth:            "text_mkwrb2t9",
} as const;

export const CLAIM_SUBITEM_COL = {
  hcpc_code:       "color_mm1cdvq8",
  modifiers:       "dropdown_mm1z7je9",
  auth_id:         "text_mm1z8nks",
  claim_quantity:  "numeric_mm20r76b",
  charge_amount:   "numeric_mm1za8v5",
} as const;

/** True when a ThreadItem.id looks like a real Monday subitem id (numeric)
 *  rather than a synthetic id from addLine (which contains "-L"). */
export function isMondaySubitemId(id: string): boolean {
  return /^\d+$/.test(id);
}

// ---------- Subitem structural mutations (create / delete) ----------
//
// Without these, the operator can use the "+ Add subitem" / trash icons
// on PrimarySubmitBoard and think they're editing the claim — but the
// changes never reach Monday, and the next Submit picks up the OLD
// Monday state. These mutations close that gap: add fires create_subitem
// + the initial column writes; delete fires delete_item.

const CREATE_SUBITEM = `
  mutation CreateSubitem($parentId: ID!, $itemName: String!) {
    create_subitem(parent_item_id: $parentId, item_name: $itemName) {
      id
      board { id }
    }
  }
`;

const DELETE_ITEM = `
  mutation DeleteItem($itemId: ID!) {
    delete_item(item_id: $itemId) { id }
  }
`;

/**
 * Create a new subitem under the given Claims Board parent and set
 * its starting field values in one call. Returns the new Monday
 * subitem id so the caller can swap its synthetic local id.
 *
 * Why a single helper for create + initial fields: a freshly created
 * subitem has blank HCPC / Modifiers / Qty / Charge, and Submit would
 * read those blanks into the 837. Setting them up-front means the
 * row is submission-ready the moment the operator clicks Add.
 */
export async function createClaimSubitem(
  parentItemId: string,
  args: {
    name: string;
    hcpc?: string;
    modifiers?: string[];
    qty?: number;
    charge?: number;
    est_pay?: number;
  },
): Promise<string> {
  // 1) Create the subitem and get back its id + the subitem board id.
  const created = await mondayQuery<{
    create_subitem: { id: string; board: { id: string } };
  }>(CREATE_SUBITEM, {
    parentId: parentItemId,
    itemName: args.name,
  });
  const subitemId = created.create_subitem.id;
  const boardId = created.create_subitem.board.id;

  // 2) Build the per-column values, omitting any that weren't passed.
  // Mirrors the encoding the cell-edit writers use.
  const columnValues: Record<string, unknown> = {};
  if (args.hcpc) columnValues[CLAIM_SUBITEM_COL.hcpc_code] = { label: args.hcpc };
  if (args.modifiers !== undefined) {
    columnValues[CLAIM_SUBITEM_COL.modifiers] = { labels: args.modifiers };
  }
  if (args.qty !== undefined) {
    columnValues[CLAIM_SUBITEM_COL.claim_quantity] = String(args.qty);
  }
  if (args.charge !== undefined) {
    columnValues[CLAIM_SUBITEM_COL.charge_amount] = String(args.charge);
  }
  // Est. Pay column (only set if explicitly provided). Default to charge
  // for parity with how backend spawns populate this field.
  if (args.est_pay !== undefined) {
    columnValues["numeric_mm1zspsy"] = String(args.est_pay);
  }

  if (Object.keys(columnValues).length > 0) {
    await mondayQuery(CHANGE_MULTI, {
      itemId: subitemId,
      boardId,
      columnValues: JSON.stringify(columnValues),
      createLabels: true,
    });
  }
  return subitemId;
}

/** Delete a Monday subitem (or any item). Used by the row's trash button. */
export async function deleteClaimSubitem(subitemId: string): Promise<void> {
  await mondayQuery(DELETE_ITEM, { itemId: subitemId });
}
