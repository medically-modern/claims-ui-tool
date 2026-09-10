// Bill to Patient — fired from the ERA Review row's Status dropdown.
//
// The operator looked at the secondary ERA (typically a $0 or partial
// remit) and decided the remaining balance belongs to the patient. We
// re-route the row into the Patient invoice flow by putting it in
// exactly the state a Confirm Payor → Patient click leaves a freshly-
// spawned row in, so the existing Submit > Patient bucket (Preview Link
// + Send Invoice → SMS) takes over from there:
//
//   Submission Type  (color_mm3awg8g) -> "Patient"
//   Secondary Status (color_mm3a5yak) -> "Submit"   stage 1 = needs invoice
//   Payor Confirmed  (color_mm3bhy6m) -> "Yes"      (already Yes on ERA rows,
//                                                    re-stamped so the row can
//                                                    never fall into Confirm)
//   Group                              -> Send Invoice (group_mm3ba7x1)
//
// The group move is not cosmetic: Josh's "generate pay link" automation
// (recipe 194, "When an item moves to Send Invoice, send a webhook")
// fires on entry to that group and writes Pay Link Token + Pay Link URL
// a couple of seconds later. That URL is what lights up the Preview
// Link button in the Patient bucket. Verified on Marc Grab's activity
// log 2026-09-10: Payor Confirmed → Yes, move → Send Invoice, +2s Pay
// Link URL written, Secondary Status untouched (still "Submit").
//
// Secondary ERA columns (Secondary Paid (A), raw ERA date, bank fields)
// are deliberately left alone — they're facts about what the secondary
// did. deriveStatus() in api/queries/allSecondaryClaims.ts lets the
// Patient submission type win over the "ERA arrived" short-circuit so
// the row lands in Submit > Patient on refetch instead of bouncing back
// into ERA Review.
//
// Direct Monday write from the browser, no backend hop: nothing
// cross-board changes at this point. The Subscription Board sync
// happens later when the patient pays (markPatientPaid → mark-paid
// endpoint), same as every other patient-billed row.

import { mondayQuery, SECONDARY_BOARD_ID } from "./monday";

const SUBMISSION_TYPE_COL  = "color_mm3awg8g";
const SECONDARY_STATUS_COL = "color_mm3a5yak";
const PAYOR_CONFIRMED_COL  = "color_mm3bhy6m";
export const SEND_INVOICE_GROUP = "group_mm3ba7x1";

// Labels verified against the board's column settings on 2026-09-10.
// Written by label WITHOUT create_labels_if_missing so a typo here
// fails loudly instead of silently minting a new label on Monday.
//
// Order matters for the per-column fallback below, which writes these
// one at a time and can stop partway. Secondary Status goes FIRST:
// if it lands and Submission Type then fails, the row is (Forwarded /
// Insurance) + Submit + ERA columns, which deriveStatus still routes
// to ERA Review — i.e. nothing moved and the operator can just retry.
// The other order is dangerous: Patient + <old status> with the old
// status still "Review" derives to Patient Paid and the row would
// surface in Invoice Review with no pay link.
const BILL_TO_PATIENT_VALUES: Record<string, unknown> = {
  [SECONDARY_STATUS_COL]: { label: "Submit" },
  [SUBMISSION_TYPE_COL]:  { label: "Patient" },
  [PAYOR_CONFIRMED_COL]:  { label: "Yes" },
};

const UPDATE_COLS_MUT = `
  mutation BillToPatientCols($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
    change_multiple_column_values(
      item_id: $itemId,
      board_id: $boardId,
      column_values: $columnValues
    ) { id }
  }
`;

const UPDATE_ONE_COL_MUT = `
  mutation BillToPatientCol($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: $columnId,
      value: $value
    ) { id }
  }
`;

const MOVE_GROUP_MUT = `
  mutation MoveGroup($itemId: ID!, $groupId: String!) {
    move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
  }
`;

/**
 * Thrown when the column writes landed (the row IS re-routed on Monday)
 * but the move into the Send Invoice group failed. Callers should treat
 * the re-route as successful and warn that the pay link won't generate
 * until the row is dragged into Send Invoice on Monday.
 */
export class BillToPatientGroupMoveError extends Error {
  constructor(public readonly cause: unknown) {
    super(
      "Row re-routed to Patient on Monday, but the move into the Send Invoice " +
        "group failed — the pay link won't generate until it's moved there. " +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = "BillToPatientGroupMoveError";
  }
}

export async function billSecondaryToPatient(mondayItemId: string): Promise<void> {
  const boardId = String(SECONDARY_BOARD_ID);

  // 1. Column writes. change_multiple_column_values is atomic — one bad
  //    column id fails the whole batch — so fall back to per-column
  //    writes if the batch is rejected. The fallback is NOT atomic: it
  //    walks BILL_TO_PATIENT_VALUES in order and can stop partway, so
  //    the order is chosen (see above) so that every prefix of it
  //    leaves the row somewhere deriveStatus still routes sensibly.
  //    A fallback failure is reported with which column stopped it so
  //    the operator knows the row may be partially updated on Monday.
  try {
    await mondayQuery(UPDATE_COLS_MUT, {
      itemId: mondayItemId,
      boardId,
      columnValues: JSON.stringify(BILL_TO_PATIENT_VALUES),
    });
  } catch (batchErr) {
    console.warn(
      "[billSecondaryToPatient] batch write failed, retrying per column:",
      batchErr,
    );
    const landed: string[] = [];
    for (const [columnId, value] of Object.entries(BILL_TO_PATIENT_VALUES)) {
      try {
        await mondayQuery(UPDATE_ONE_COL_MUT, {
          itemId: mondayItemId,
          boardId,
          columnId,
          value: JSON.stringify(value),
        });
        landed.push(columnId);
      } catch (colErr) {
        const msg = colErr instanceof Error ? colErr.message : String(colErr);
        throw new Error(
          landed.length === 0
            ? `Monday rejected the column write (${columnId}): ${msg}`
            : `Monday write stopped partway (${landed.length} of ${
                Object.keys(BILL_TO_PATIENT_VALUES).length
              } columns landed, failed on ${columnId}): ${msg}. ` +
              "Check the row on Monday, then retry Bill to Patient.",
        );
      }
    }
  }

  // 2. Group move → Send Invoice. This is what triggers pay-link
  //    generation, so a failure here is surfaced (unlike the cosmetic
  //    group moves elsewhere) — but as a distinct error type, because
  //    the columns above already landed and the row is correctly routed.
  try {
    await mondayQuery(MOVE_GROUP_MUT, {
      itemId: mondayItemId,
      groupId: SEND_INVOICE_GROUP,
    });
  } catch (moveErr) {
    throw new BillToPatientGroupMoveError(moveErr);
  }
}
