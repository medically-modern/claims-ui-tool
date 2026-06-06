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

/**
 * Move a Secondary Claims Board item to a specific group, WITHOUT
 * touching Secondary Status. Used after the auto-submit path where
 * the backend already wrote Status=Submitted on Monday and we just
 * need the visual group to follow.
 *
 * Failures are surfaced to the caller (unlike
 * setSecondaryStatusAndMove which swallows them) so the caller can
 * decide whether to retry or toast.
 */
export async function moveSecondaryToGroup(
  mondayItemId: string,
  groupId: string,
): Promise<void> {
  await mondayQuery(MOVE_GROUP_MUT, {
    itemId: mondayItemId,
    groupId,
  });
}

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

// SMS Status — color_mm41nfw4. Cleared when Send Invoice fires so
// stale Delivered/Failed labels from prior automation runs don't
// gate Mark Paid prematurely.
const SMS_STATUS_COL = "color_mm41nfw4";

const SMS_STATUS_CLEAR_MUT = `
  mutation ClearSmsStatus($itemId: ID!, $boardId: ID!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${SMS_STATUS_COL}",
      value: "{}"
    ) { id }
  }
`;

export async function clearSmsStatus(mondayItemId: string): Promise<void> {
  await mondayQuery(SMS_STATUS_CLEAR_MUT, {
    itemId: mondayItemId,
    boardId: String(SECONDARY_BOARD_ID),
  });
}

// Secondary Payor — color_mkxq1a2p. Status column with labels like
// "NY Medicaid", "Medicaid", "AARP Supplement", etc. Edited from the
// Secondary Payor dropdown on the Submit Insurance row body. Without
// a Monday write, the dropdown only updates local React state and
// resets to whatever Monday has on the next refetch.
const SECONDARY_PAYER_COL = "color_mkxq1a2p";

const SECONDARY_PAYER_MUT = `
  mutation SetSecondaryPayor($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${SECONDARY_PAYER_COL}",
      value: $value
    ) { id }
  }
`;

/** Write the Secondary Payor label (e.g. "NY Medicaid") to Monday. */
export async function setSecondaryPayer(
  mondayItemId: string,
  label: string | null,
): Promise<void> {
  await mondayQuery(SECONDARY_PAYER_MUT, {
    itemId: mondayItemId,
    boardId: String(SECONDARY_BOARD_ID),
    value: JSON.stringify(label ? { label } : {}),
  });
}

// Patient Question Answered — color_mm41rxvr. Set to "Answered" when
// the operator clicks Mark Answered on a Patient Questions row. Read by
// allSecondaryClaims so the bucket filter can hide answered questions
// without erasing the question text.
const PATIENT_QUESTION_ANSWERED_COL = "color_mm41rxvr";

const PATIENT_QUESTION_ANSWERED_MUT = `
  mutation MarkQuestionAnswered($itemId: ID!, $boardId: ID!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: "${PATIENT_QUESTION_ANSWERED_COL}",
      value: $value
    ) { id }
  }
`;

/**
 * Mark the patient's question answered. Writes "Answered" to
 * color_mm41rxvr; on the next refetch the row drops out of the
 * Patient Questions bucket while its question text stays on the row.
 */
export async function fireQuestionAnswered(
  mondayItemId: string,
): Promise<void> {
  await mondayQuery(PATIENT_QUESTION_ANSWERED_MUT, {
    itemId: mondayItemId,
    boardId: String(SECONDARY_BOARD_ID),
    value: JSON.stringify({ label: "Answered" }),
  });
}

// Pay Link Sent Date — stamped ONCE when the operator first clicks
// Send Invoice. Stays put on subsequent follow-ups so the original
// invoice timestamp is preserved.
const PAY_LINK_SENT_DATE_COL = "date_mm3q88et";
// Latest Follow-up date — stamped to today each time Send Follow-Up
// fires. Separate so the cadence counter resets per follow-up while
// the initial Send Invoice date stays the source of truth for
// "when did we first invoice this patient".
const LATEST_FOLLOW_UP_DATE_COL = "date_mm41rs0q";

const SET_DATE_MUT = `
  mutation SetDate($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
    change_column_value(
      item_id: $itemId,
      board_id: $boardId,
      column_id: $columnId,
      value: $value
    ) { id }
  }
`;

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
 * Fire the Send Invoice trigger by writing "Sent" to color_mm3x6qe6.
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
    value: JSON.stringify({ label: "Sent" }),
  });
  // NOTE: do NOT stamp PAY_LINK_SENT_DATE_COL here — Josh's Monday
  // automation already writes that date column when the patient
  // checkout link is generated upstream of our Send Invoice click.
  // Stamping again from our side would be a redundant Monday write.
  // We just READ that column via allSecondaryClaims and render it
  // on the row header.
}

/**
 * Fire the Send Follow-Up trigger by clearing color_mm3x6qe6 then
 * writing "Follow-up". The clear-then-set sequence guarantees Monday
 * fires a fresh "changed to Follow-up" event even if the column was
 * already set to a non-blank label from a prior Send Invoice / Send
 * Follow-Up. Drives a Monday automation that texts the patient the
 * follow-up SMS (different copy than the initial Send Invoice text).
 *
 * Errors on the clear step are swallowed (best-effort) — if Monday
 * can't clear (e.g. column already empty), the follow-up label write
 * still runs and the automation still fires. Errors on the Follow-up
 * write propagate.
 */
export async function fireSendFollowUpTrigger(
  mondayItemId: string,
): Promise<void> {
  try {
    await mondayQuery(SEND_INVOICE_TRIGGER_MUT, {
      itemId: mondayItemId,
      boardId: String(SECONDARY_BOARD_ID),
      value: JSON.stringify({}),
    });
  } catch {
    // Best-effort clear — fall through to the Follow-up write either way.
  }
  await mondayQuery(SEND_INVOICE_TRIGGER_MUT, {
    itemId: mondayItemId,
    boardId: String(SECONDARY_BOARD_ID),
    value: JSON.stringify({ label: "Follow-up" }),
  });
  // Stamp Latest Follow-up date with today's ISO date (YYYY-MM-DD —
  // Monday date columns accept this directly). Best-effort: if the
  // date write fails the follow-up SMS still went out.
  try {
    const today = new Date().toISOString().slice(0, 10);
    await mondayQuery(SET_DATE_MUT, {
      itemId: mondayItemId,
      boardId: String(SECONDARY_BOARD_ID),
      columnId: LATEST_FOLLOW_UP_DATE_COL,
      value: JSON.stringify({ date: today }),
    });
  } catch {
    // Surfaced separately to the operator via the calling toast if
    // they care, but we don't want a date-write hiccup to look like
    // the SMS didn't fire.
  }
}
