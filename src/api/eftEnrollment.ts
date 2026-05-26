// Data layer for the EFT Enrollment tracker tab. Reads both Primary
// and Secondary Claims Boards filtered by Payer EFT'd? = "No", merges
// into one operator-friendly shape, and exposes both the fetcher and
// the React Query hook.
//
// Column IDs:
//   Primary (board 18245429780)
//     color_mm3qevse   Payer EFT'd?               (Yes / No)
//     color_mm3qaejr   EFT Enrollment Status      (Not Started / Submitted / Approved / Denied)
//     date_mm3qrb5b    EFT Submitted Date
//     color_mkxmhypt   Primary Payor
//     date_mm11zg2f    Primary Paid Date (D)
//     numeric_mm3jm85z Bank Deposit Total
//     date_mm3je93r    Bank EFT Date
//     text_mm1gz8ss    Raw Remittance Trace Number
//     text_mm3jpw1b    Bank Payer Originator ID
//     text_mm11m3fh    Check #
//     text_mm29v2ph    Action Context (notes)
//
//   Secondary (board 18413019028)
//     color_mm3qap5q   Payer EFTd?
//     color_mm3q5qby   EFT Enrollment Status
//     date_mm3qghrt    EFT Submitted Date
//     color_mkxq1a2p   Secondary Payer
//     color_mm3a93ek   Primary Payor (kept for context)
//     date_mm11zg2f    Secondary Paid Date (D)
//     numeric_mm3js9d0 Bank Deposit Total
//     date_mm3jq5zk    Bank EFT Date
//     text_mm1gz8ss    Raw Remittance Trace Number
//     text_mm3jz59k    Bank Payer Originator ID
//     text_mm11m3fh    Check #
//     text_mm29v2ph    Action Context (notes)

import { useQuery } from "@tanstack/react-query";
import { mondayQuery } from "./monday";

export type EftEnrollmentStatus =
  | "Not Started"
  | "Submitted"
  | "Approved"
  | "Denied"
  | null;

export interface EftEnrollmentRow {
  /** Monday item id — used by the mark endpoint. */
  itemId: string;
  /** "primary" | "secondary" — which board the row lives on. */
  board: "primary" | "secondary";
  patientName: string;
  /** Payer that pays *this* claim. For primary that's the primary payer;
   *  for secondary that's the secondary payer. */
  payer: string;
  /** Paid date the payer stamped on the ERA (already EFT-lag-shifted
   *  at write time by the parser for Fidelis / pure Medicaid). */
  paidDate: string | null;
  /** Bank reconciliation fields, all present when Payment Method=CHK
   *  but rendered defensively because some may be blank on stale rows. */
  checkNumber: string | null;
  bankDepositTotal: number | null;
  bankEftDate: string | null;
  bankTraceNumber: string | null;
  bankPayerOriginatorId: string | null;
  /** EFT enrollment workflow fields. */
  enrollmentStatus: EftEnrollmentStatus;
  submittedDate: string | null;
  /** Free-text operator notes (re-used Action Context column). */
  notes: string;
}

const PRIMARY_BOARD_ID   = "18245429780";
const SECONDARY_BOARD_ID = "18413019028";

const PRIMARY_COLS = {
  payerEftd:       "color_mm3qevse",
  enrollStatus:    "color_mm3qaejr",
  submittedDate:   "date_mm3qrb5b",
  payor:           "color_mkxmhypt",
  paidDate:        "date_mm11zg2f",
  bankDeposit:     "numeric_mm3jm85z",
  bankEftDate:     "date_mm3je93r",
  bankTrace:       "text_mm1gz8ss",
  bankOriginator:  "text_mm3jpw1b",
  checkNumber:     "text_mm11m3fh",
  notes:           "text_mm29v2ph",
} as const;

const SECONDARY_COLS = {
  payerEftd:       "color_mm3qap5q",
  enrollStatus:    "color_mm3q5qby",
  submittedDate:   "date_mm3qghrt",
  // Secondary Payer status column. For Medicare-supplement crossovers
  // this often just reads "Medicare Suppl." as a placeholder until the
  // actual supplemental payer is known — see payorRaw below for the
  // real payer name carried in the ERA.
  payor:           "color_mkxq1a2p",
  // Secondary Payer Name (Raw) — written by secondary_era_writeback
  // from the 835 N1*PR loop. Carries the actual payer name (e.g.
  // "HIGHMARK BLUE CROSS BLUE SHIELD WV"), which is what we actually
  // need for EFT enrollment. Falls back to the status column when
  // blank (some older rows pre-date this writeback).
  payorRaw:        "text_mm3a2yax",
  paidDate:        "date_mm11zg2f",
  bankDeposit:     "numeric_mm3js9d0",
  bankEftDate:     "date_mm3jq5zk",
  bankTrace:       "text_mm1gz8ss",
  bankOriginator:  "text_mm3jz59k",
  checkNumber:     "text_mm11m3fh",
  notes:           "text_mm29v2ph",
} as const;

interface MondayColumnValue {
  id: string;
  text: string | null;
}
interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}
interface ItemsPageByColumnValuesResponse {
  items_page_by_column_values: {
    items: MondayItem[];
  };
}

const PRIMARY_QUERY = `
  query EftEnrollmentPrimary {
    items_page_by_column_values(
      board_id: ${PRIMARY_BOARD_ID},
      columns: [{ column_id: "${PRIMARY_COLS.payerEftd}", column_values: ["No"] }],
      limit: 500
    ) {
      items {
        id
        name
        column_values(ids: [${Object.values(PRIMARY_COLS).map((c) => `"${c}"`).join(", ")}]) {
          id
          text
        }
      }
    }
  }
`;

const SECONDARY_QUERY = `
  query EftEnrollmentSecondary {
    items_page_by_column_values(
      board_id: ${SECONDARY_BOARD_ID},
      columns: [{ column_id: "${SECONDARY_COLS.payerEftd}", column_values: ["No"] }],
      limit: 500
    ) {
      items {
        id
        name
        column_values(ids: [${Object.values(SECONDARY_COLS).map((c) => `"${c}"`).join(", ")}]) {
          id
          text
        }
      }
    }
  }
`;

function valueAt(item: MondayItem, columnId: string): string {
  return (item.column_values.find((c) => c.id === columnId)?.text ?? "").trim();
}

function parseEnrollmentStatus(text: string): EftEnrollmentStatus {
  switch (text) {
    case "Not Started":
    case "Submitted":
    case "Approved":
    case "Denied":
      return text;
    default:
      return null;
  }
}

function parseNumber(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function mapPrimaryItem(item: MondayItem): EftEnrollmentRow {
  return {
    itemId:                item.id,
    board:                 "primary",
    patientName:           item.name,
    payer:                 valueAt(item, PRIMARY_COLS.payor),
    paidDate:              valueAt(item, PRIMARY_COLS.paidDate) || null,
    checkNumber:           valueAt(item, PRIMARY_COLS.checkNumber) || null,
    bankDepositTotal:      parseNumber(valueAt(item, PRIMARY_COLS.bankDeposit)),
    bankEftDate:           valueAt(item, PRIMARY_COLS.bankEftDate) || null,
    bankTraceNumber:       valueAt(item, PRIMARY_COLS.bankTrace) || null,
    bankPayerOriginatorId: valueAt(item, PRIMARY_COLS.bankOriginator) || null,
    enrollmentStatus:      parseEnrollmentStatus(valueAt(item, PRIMARY_COLS.enrollStatus)),
    submittedDate:         valueAt(item, PRIMARY_COLS.submittedDate) || null,
    notes:                 valueAt(item, PRIMARY_COLS.notes),
  };
}

function mapSecondaryItem(item: MondayItem): EftEnrollmentRow {
  // Prefer the raw payer name (from the 835 N1*PR loop) over the
  // Secondary Payer status column, which often reads "Medicare Suppl."
  // for Medicare crossovers. Falls back to the status column when raw
  // is blank — usually older rows that pre-date the raw-name writeback.
  const payerRaw    = valueAt(item, SECONDARY_COLS.payorRaw);
  const payerStatus = valueAt(item, SECONDARY_COLS.payor);
  const payer       = payerRaw || payerStatus;
  return {
    itemId:                item.id,
    board:                 "secondary",
    patientName:           item.name,
    payer,
    paidDate:              valueAt(item, SECONDARY_COLS.paidDate) || null,
    checkNumber:           valueAt(item, SECONDARY_COLS.checkNumber) || null,
    bankDepositTotal:      parseNumber(valueAt(item, SECONDARY_COLS.bankDeposit)),
    bankEftDate:           valueAt(item, SECONDARY_COLS.bankEftDate) || null,
    bankTraceNumber:       valueAt(item, SECONDARY_COLS.bankTrace) || null,
    bankPayerOriginatorId: valueAt(item, SECONDARY_COLS.bankOriginator) || null,
    enrollmentStatus:      parseEnrollmentStatus(valueAt(item, SECONDARY_COLS.enrollStatus)),
    submittedDate:         valueAt(item, SECONDARY_COLS.submittedDate) || null,
    notes:                 valueAt(item, SECONDARY_COLS.notes),
  };
}

export async function fetchEftEnrollmentRows(): Promise<EftEnrollmentRow[]> {
  const [pri, sec] = await Promise.all([
    mondayQuery<ItemsPageByColumnValuesResponse>(PRIMARY_QUERY, {}),
    mondayQuery<ItemsPageByColumnValuesResponse>(SECONDARY_QUERY, {}),
  ]);
  const primary   = (pri.items_page_by_column_values?.items ?? []).map(mapPrimaryItem);
  const secondary = (sec.items_page_by_column_values?.items ?? []).map(mapSecondaryItem);
  return [...primary, ...secondary];
}

export const EFT_ENROLLMENT_QUERY_KEY = ["eft-enrollment"] as const;

export function useEftEnrollmentRows() {
  return useQuery({
    queryKey: EFT_ENROLLMENT_QUERY_KEY,
    queryFn:  fetchEftEnrollmentRows,
    // 30s — operator may flip Payer EFT'd on Monday directly; this
    // keeps the page reasonably fresh without thrashing the API.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
