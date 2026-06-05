// Monday.com GraphQL client — direct from browser.
// Token is read from VITE_MONDAY_API_TOKEN at build time.

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";

export const BOARD_ID = 18410601299;

export const GROUPS = {
  benefits: "group_mm1xr3q3",
  submitAuth: "group_mm1x1416",
  authOutstanding: "group_mm2v6d1z",
  complete: "group_mm2vw3c0",
} as const;

// Read columns
export const COL = {
  serving: "color_mm1w1cm9",
  primaryInsurance: "color_mm1x157j",
  diagnosis: "color_mm1wf7rv",
  secondaryInsurance: "color_mm241kqp",
  doctorName: "text_mm1x46et",
  doctorPhone: "phone_mm1xz8c0",
  doctorNpi: "text_mm1x7d91",
  doctorEmail: "email_mm1x6fq5",
  doctorFax: "email_mm1xdzcj",
  clinicalsMethod: "color_mm1xw7y5",
  clinicName: "dropdown_mm1xbvas",
  dob: "text_mm1xvxst",
  patientPhone: "phone_mm1x44yk",
  patientAddress: "location_mm1xhw17",
  pumpBrand: "color_mm1wjjtk",
  claimsStatus: "color_mm284z0b",
  memberId1: "text_mm1x2qk2",
  memberId2: "text_mm1xaccx",
  referralSource: "color_mm1w5wxr",

  // Universal write columns
  activeNetwork: "color_mm2vhwan",
  dmeBenefits: "color_mm2vt8xg",
  sos: "color_mm2vemyy",
  auth: "color_mm2vg3ew",

  // Trigger DVS (Medicaid supplies automation)
  triggerDvs: "color_mm26pk1a",

  // Follow Up
  followUp: "color_mm34jz1x",
  followUpDate: "date_mm34m2dz",

  // Escalation + stage flow
  escalation: "color_mm2vsh2f",
  escalationNotes: "long_text_mm3jrssp",
  stageAdvancer: "color_mm1ws96t",
  notClearProducts: "dropdown_mm2vez5a",
  /** Products whose SoS check was deferred at intake. Populated when an
   *  agent picks SoS = Skip on the Benefits page; products are removed
   *  from this dropdown when the recheck on Auth Outstanding resolves
   *  the SoS to Clear. Same option-id schema as notClearProducts. */
  skipSosProducts: "dropdown_mm31163t",

  callReferenceNotes: "long_text_mm2ffsme",
  carecentrixIntakeId: "text_mm2wnhx",
  callFaxNumber: "text_mm2yd7st",

  // File columns
  finalClinicals: "file_mm25m8c1",

  // Per-product auth result columns
  authResult: {
    monitor: "color_mm1wgjd1",
    sensors: "color_mm1x5c99",
    insulin_pump: "color_mm1xnzmn",
    infusion_set: "color_mm1xr2j1",
    cartridge: "color_mm1xybvt",
  },
  // Per-product auth write columns (×5 products)
  authMethod: {
    monitor: "dropdown_mm2wmhx9",
    sensors: "dropdown_mm2whrk7",
    insulin_pump: "dropdown_mm2w2k6y",
    infusion_set: "dropdown_mm2way9m",
    cartridge: "dropdown_mm2wj9ws",
  },
  authId: {
    monitor: "text_mm1w1d5p",
    sensors: "text_mm1x8tdp",
    insulin_pump: "text_mm1xmj8x",
    infusion_set: "text_mm1xf6ht",
    cartridge: "text_mm1xs6s8",
  },
  authSubmissionDate: {
    monitor: "text_mm2wmc1z",
    sensors: "text_mm2w85gd",
    insulin_pump: "text_mm2w72r6",
    infusion_set: "text_mm2wvnpx",
    cartridge: "text_mm2wth7t",
  },
  authStart: {
    monitor: "date_mm1wj1bz",
    sensors: "date_mm1x929",
    insulin_pump: "date_mm1xxbkz",
    infusion_set: "date_mm1xrk1c",
    cartridge: "date_mm1xp0vm",
  },
  authEnd: {
    monitor: "date_mm1whebp",
    sensors: "date_mm1xvnqb",
    insulin_pump: "date_mm1x2q3",
    infusion_set: "date_mm1xj3wp",
    cartridge: "date_mm1xznf9",
  },
  authUnits: {
    monitor: "numeric_mm2wjew6",
    sensors: "numeric_mm2wd6a1",
    insulin_pump: "numeric_mm2wxcjj",
    infusion_set: "numeric_mm2w2jhm",
    cartridge: "numeric_mm2w1df3",
  },

  // Per-product Last Bill Date columns (date — populated when SoS = Not Clear)
  lastBillDate: {
    monitor: "date_mm33h1qv",
    sensors: "date_mm332rhq",
    insulin_pump: "date_mm33qnew",
    infusion_set: "date_mm33gj86",
    cartridge: "date_mm33cd87",
  },

  // Calculated Next Order Date columns (date — computed from last bill + lookback)
  nextOrderDate: {
    insulin_pump: "date_mm35aknj",   // IP Next Order Date = last bill + 4 years
    sensors: "date_mm35f5j1",         // Sensors Next Order Date = last bill + 90 days
    supplies: "date_mm35da3j",        // Supplies Next Order Date = max(infusion, cartridge) + 90d (or 60d if Medicaid)
  },

  // Never Billed attestation columns (Medicare A&B special case)
  neverBilledIsCar: "color_mm3zjyya",  // "Never billed IS/Car"
  neverBilledCgm: "color_mm3zg2pn",    // "Never billed CGM"

  // Days Since Stage Started (status — used for Auth Outstanding sorting)
  daysSinceStage: "color_mm1wwm05",

  // Debug / error logging
  joshDebug: "text_mm2w1qn4",

  // Profile Send Off Notes (mirrored from Profile Send Off Board)
  profileSendOffNotes: "text_mm3xfw5a",
  // MN Workflow Notes
  mnWorkflowNotes: "text_mm3xbvss",
} as const;

export const READ_COLUMN_IDS = [
  COL.serving,
  COL.primaryInsurance,
  COL.diagnosis,
  COL.secondaryInsurance,
  COL.dob,
  COL.patientPhone,
  COL.patientAddress,
  COL.pumpBrand,
  COL.memberId1,
  COL.memberId2,
  COL.referralSource,
  COL.callReferenceNotes,
  COL.doctorName,
  COL.doctorPhone,
  COL.doctorNpi,
  COL.doctorEmail,
  COL.doctorFax,
  COL.clinicalsMethod,
  COL.clinicName,
  // Stage Advancer — needed to determine which view an escalated patient belongs to.
  COL.stageAdvancer,
  // Escalation column hydrates the Escalate-button toggle on all 3 pages.
  COL.escalation,
  COL.escalationNotes,
  // Per-product SoS state (read on every page so the agent sees what was
  // recorded on Benefits — Not Clear products and Skip-deferred products).
  COL.notClearProducts,
  COL.skipSosProducts,
  // Per-product Last Bill Date (populated when SoS = Not Clear on Benefits)
  COL.lastBillDate.monitor,
  COL.lastBillDate.sensors,
  COL.lastBillDate.insulin_pump,
  COL.lastBillDate.infusion_set,
  COL.lastBillDate.cartridge,
  // Follow Up
    COL.profileSendOffNotes,
    COL.mnWorkflowNotes,
  COL.followUp,
  COL.followUpDate,
  // Never Billed (Medicare A&B)
  COL.neverBilledIsCar,
  COL.neverBilledCgm,
];

/** Extended read columns for auth groups — includes auth results + universal statuses */
export const AUTH_READ_COLUMN_IDS = [
  ...READ_COLUMN_IDS,
  COL.activeNetwork,
  COL.dmeBenefits,
  COL.sos,
  COL.auth,
  // Per-product auth result (status)
  COL.authResult.monitor,
  COL.authResult.sensors,
  COL.authResult.insulin_pump,
  COL.authResult.infusion_set,
  COL.authResult.cartridge,
  // Per-product submission fields (read back for Auth Outstanding display)
  COL.authMethod.monitor,
  COL.authMethod.sensors,
  COL.authMethod.insulin_pump,
  COL.authMethod.infusion_set,
  COL.authMethod.cartridge,
  COL.authId.monitor,
  COL.authId.sensors,
  COL.authId.insulin_pump,
  COL.authId.infusion_set,
  COL.authId.cartridge,
  COL.authSubmissionDate.monitor,
  COL.authSubmissionDate.sensors,
  COL.authSubmissionDate.insulin_pump,
  COL.authSubmissionDate.infusion_set,
  COL.authSubmissionDate.cartridge,
  COL.authStart.monitor,
  COL.authStart.sensors,
  COL.authStart.insulin_pump,
  COL.authStart.infusion_set,
  COL.authStart.cartridge,
  COL.authEnd.monitor,
  COL.authEnd.sensors,
  COL.authEnd.insulin_pump,
  COL.authEnd.infusion_set,
  COL.authEnd.cartridge,
  COL.authUnits.monitor,
  COL.authUnits.sensors,
  COL.authUnits.insulin_pump,
  COL.authUnits.infusion_set,
  COL.authUnits.cartridge,
  COL.carecentrixIntakeId,
  COL.daysSinceStage,
  COL.triggerDvs,
  COL.claimsStatus,
];

const AUTH_GROUP_IDS = new Set([GROUPS.submitAuth, GROUPS.authOutstanding]);

export interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
}

export interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}

function getToken(): string {
  return (import.meta.env.VITE_MONDAY_API_TOKEN as string | undefined) ?? "";
}

export function hasToken(): boolean {
  return !!getToken();
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("VITE_MONDAY_API_TOKEN is not set");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("Monday API HTTP error", { status: res.status, body });
    throw new Error(`Monday request failed (${res.status})`);
  }
  const json = await res.json();
  if (json.errors) {
    console.error("Monday API GraphQL error", json.errors);
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

export async function fetchGroupItems(
  groupId: string = GROUPS.benefits,
  onMore?: (items: MondayItem[]) => void,
): Promise<MondayItem[]> {
  const PAGE = 200;
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
          cursor
          items {
            id
            name
            column_values(ids: $cols) { id text value }
          }
        }
      }
    }
  `;
  const cols = AUTH_GROUP_IDS.has(groupId as Parameters<typeof AUTH_GROUP_IDS.has>[0]) ? AUTH_READ_COLUMN_IDS : READ_COLUMN_IDS;
  const data = await gql<{ boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] }>(query, {
    boardId: BOARD_ID,
    cols,
  });
  const firstPage = data.boards?.[0]?.items_page?.items ?? [];
  let cursor = data.boards?.[0]?.items_page?.cursor ?? null;

  const allItems: MondayItem[] = [...firstPage];

  while (cursor) {
    try {
      const nextQuery = `
        query ($cursor: String!, $cols: [String!]) {
          next_items_page(limit: ${PAGE}, cursor: $cursor) {
            cursor
            items { id name column_values(ids: $cols) { id text value } }
          }
        }
      `;
      const next = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(nextQuery, { cursor, cols: READ_COLUMN_IDS });
      const items = next.next_items_page?.items ?? [];
      cursor = next.next_items_page?.cursor ?? null;
      if (items.length > 0) {
        allItems.push(...items);
        if (onMore) onMore(items);
      }
    } catch (e) { console.error("[fetchGroupItems] pagination error", e); break; }
  }

  return allItems;
}

/**
 * Write a status column by index. value is a JSON string like '{"index": 1}'.
 */
export async function writeStatusIndex(itemId: string, columnId: string, index: number): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ index }),
  });
}

/**
 * Write a long_text column.
 */
export async function writeLongText(itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ text }),
  });
}

/**
 * Write a dropdown column (multi-select) by option ids.
 */
export async function writeDropdownIds(itemId: string, columnId: string, ids: number[]): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify({ ids }),
  });
}

/**
 * Write a text column.
 */
export async function writeText(itemId: string, columnId: string, text: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(text),
  });
}

/**
 * Write a date column. value should be YYYY-MM-DD or empty string to clear.
 */
export async function writeDate(itemId: string, columnId: string, date: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  const val = date ? { date } : {};
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/**
 * Write a numeric column.
 */
export async function writeNumber(itemId: string, columnId: string, num: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(num || ""),
  });
}

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  public_url: string;
}

/**
 * Fetch file assets for a specific item (from the Final Clinicals file column).
 */
export async function fetchItemAssets(itemId: string): Promise<MondayAsset[]> {
  const query = `
    query ($boardId: ID!, $itemId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 1, query_params: { ids: [$itemId] }) {
          cursor
          items {
            assets(assets_source: all) { id name url public_url }
          }
        }
      }
    }
  `;
  const data = await gql<{
    boards: { items_page: { items: { assets: MondayAsset[] }[] } }[];
  }>(query, {
    boardId: BOARD_ID,
    itemId,
  });
  return data.boards?.[0]?.items_page?.items?.[0]?.assets ?? [];
}

/**
 * Upload a file (PDF, image, etc.) into a Monday file column. Routed
 * through the Cloudflare Worker proxy because Monday's /v2/file endpoint
 * doesn't return CORS headers — direct browser POST would be blocked.
 */
export async function uploadFileToColumn(
  itemId: string,
  columnId: string,
  bytes: Uint8Array,
  filename: string,
  mimeType = "application/pdf",
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("VITE_MONDAY_API_TOKEN is not set");

  const query = `mutation ($file: File!) { add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file) { id } }`;

  const fd = new FormData();
  fd.append("query", query);
  fd.append(
    "variables[file]",
    new Blob([bytes as BlobPart], { type: mimeType }),
    filename,
  );

  const proxyUrl =
    (import.meta.env.VITE_MONDAY_FILE_PROXY_URL as string | undefined) ||
    "https://monday-file-proxy.medicallymodern.workers.dev";

  let res: Response;
  try {
    res = await fetch(proxyUrl, {
      method: "POST",
      headers: { Authorization: token },
      body: fd,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[uploadFileToColumn] network error", { itemId, columnId, msg });
    throw new Error(
      `Upload network error (item ${itemId}, column ${columnId}): ${msg}`,
    );
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`File upload failed (${res.status}): ${txt}`);
  }
  let json: { errors?: unknown };
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (json.errors) {
    throw new Error(`Monday file upload error: ${JSON.stringify(json.errors)}`);
  }
}

/**
 * Rename an item (the item's "name" field, not a column).
 */
export async function writeItemName(itemId: string, name: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    value: JSON.stringify(name),
  });
}

/**
 * Write a phone column. Monday expects { phone, countryShortName }.
 */
export async function writePhone(itemId: string, columnId: string, phone: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  const val = phone ? { phone, countryShortName: "US" } : {};
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/**
 * Write an email column. Monday expects { email, text }.
 */
export async function writeEmail(itemId: string, columnId: string, email: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  const val = email ? { email, text: email } : {};
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/**
 * Write a simple column value by its display label (works for status
 * columns where you know the label text but not the index).
 */
/** Clear a status (or date) column back to its empty/default state. */
export async function clearStatusColumn(itemId: string, columnId: string): Promise<void> {
  const value = JSON.stringify("");
  await gql(
    `mutation { change_simple_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${value}) { id } }`,
  );
}

export async function writeSimpleValue(itemId: string, columnId: string, label: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: label,
  });
}

/**
 * Write a location column. Monday expects { address, lat, lng }.
 * We pass 0/0 for coords when we don't have geocode data — the
 * address text still lands.
 */
export async function writeLocation(
  itemId: string,
  columnId: string,
  address: string,
  lat: number = 0,
  lng: number = 0,
): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
    }
  `;
  if (!address) return; // no-op: writing {} to a location column creates a phantom
  const val = { address, lat, lng };
  await gql(query, {
    boardId: BOARD_ID,
    itemId,
    columnId,
    value: JSON.stringify(val),
  });
}

/** Fetch a single item by ID regardless of group (for cross-group deep-links). */
export async function fetchItemById(itemId: string, useAuthColumns?: boolean): Promise<MondayItem | null> {
  const query = `
    query ($itemId: [ID!]!, $cols: [String!]) {
      items(ids: $itemId) {
        id
        name
        column_values(ids: $cols) { id text value }
      }
    }
  `;
  const data = await gql<{
    items: MondayItem[];
  }>(query, { itemId: [itemId], cols: useAuthColumns ? AUTH_READ_COLUMN_IDS : READ_COLUMN_IDS });
  return data.items?.[0] ?? null;
}


/** Read arbitrary column text values for a single item (used by write verification). */
export async function readColumnTexts(
  itemId: string,
  columnIds: string[],
): Promise<{ id: string; text: string | null }[]> {
  const query = `
    query ($ids: [ID!]!, $cols: [String!]) {
      items(ids: $ids) { column_values(ids: $cols) { id text } }
    }
  `;
  const data = await gql<{ items: { column_values: { id: string; text: string | null }[] }[] }>(
    query,
    { ids: [itemId], cols: columnIds },
  );
  return data.items?.[0]?.column_values ?? [];
}
