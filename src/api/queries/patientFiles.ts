/**
 * patientFiles.ts — the files on a Subscription Board item, with links that
 * open. The row query only reads a file column's `text`, which is Monday's
 * protected URL (it needs a Monday login and shows up as a raw link). This
 * reads the assets themselves: name, when it was added, and `public_url` — a
 * direct S3 link that works for an hour, which is why it is fetched when the
 * profile opens rather than with the whole board.
 */
import { mondayQuery } from "../monday";
import { SUB_COL } from "./subscriptionPatients";

export interface PatientFile {
  id: string;
  name: string;
  /** Direct link, valid ~1 hour from the fetch. */
  url: string;
  /** Monday's protected link — works for anyone signed in to Monday. */
  mondayUrl: string;
  createdAt: string;
  column: "mnDocs" | "insuranceCard";
}

const FILE_COLS = { mnDocs: SUB_COL.mn_docs, insuranceCard: SUB_COL.insurance_card } as const;

const QUERY = `
  query PatientFiles($id: [ID!], $cols: [String!]!) {
    items(ids: $id) {
      column_values(ids: $cols) {
        id
        ... on FileValue {
          files {
            ... on FileAssetValue { asset { id name public_url url created_at } }
            ... on FileLinkValue { name url }
          }
        }
      }
    }
  }
`;

interface Resp {
  items: Array<{
    column_values: Array<{
      id: string;
      files?: Array<{
        asset?: { id: string; name: string; public_url: string; url: string; created_at: string } | null;
        name?: string; url?: string;
      }>;
    }>;
  }>;
}

export async function fetchPatientFiles(mondayItemId: string): Promise<PatientFile[]> {
  const r = await mondayQuery<Resp>(QUERY, { id: [mondayItemId], cols: Object.values(FILE_COLS) });
  const out: PatientFile[] = [];
  for (const cv of r.items?.[0]?.column_values ?? []) {
    const column = cv.id === FILE_COLS.mnDocs ? "mnDocs" : "insuranceCard";
    for (const f of cv.files ?? []) {
      if (f.asset) {
        out.push({ id: f.asset.id, name: f.asset.name, url: f.asset.public_url || f.asset.url, mondayUrl: f.asset.url, createdAt: f.asset.created_at, column });
      } else if (f.url) {
        out.push({ id: f.url, name: f.name || f.url, url: f.url, mondayUrl: f.url, createdAt: "", column });
      }
    }
  }
  // Newest first — the latest clinicals are the ones being checked.
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
