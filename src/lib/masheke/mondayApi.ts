// Monday API layer for Medical Necessity board (18406060017)

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2024-10";
const BOARD_ID = "18406060017";

export const GROUPS = {
  medicalNecessity: "group_mm1xf2jb",
} as const;

export const COL = {
  // Demographics (read)
  gender: "color_mm1x1bdg",
  dob: "text_mm1xvxst",
  phone: "phone_mm1x44yk",
  address: "location_mm1xhw17",
  primaryInsurance: "color_mm1x157j",
  memberId1: "text_mm1x2qk2",
  memberId2: "text_mm1xaccx",
  serving: "color_mm1w1cm9",
  referralType: "color_mm1wm4n4",
  referralSource: "color_mm1w5wxr",
  pumpType: "color_mm1wjjtk",
  cgmType: "color_mm1w7pmf",
  requestType: "color_mm1w1978",

  // Coverage paths
  ipCoveragePath: "color_mm1w5xn1",
  cgmCoveragePath: "color_mm1w7e5q",

  // Doctor
  doctorName: "text_mm1x46et",
  doctorPhone: "phone_mm1xz8c0",
  doctorNpi: "text_mm1x7d91",
  clinicalsMethod: "color_mm1xw7y5",
  doctorEmail: "email_mm1x6fq5",
  doctorFax: "email_mm1xdzcj",
  clinicName: "dropdown_mm1xbvas",

  // Pipeline tracking
  masterStage: "color_mm1ws96t",
  subStage: "color_mm1wyr92",
  daysSinceIntake: "color_mm1xwabn",
  daysSinceStageStart: "color_mm1wwm05",
  dateOfIntake: "date_mm1wf43j",
  dateOfStageStart: "date_mm1w6jeq",

  // Clinical eval checklist
  cgmScript: "color_mm1w8mp1",
  hypoLanguage: "color_mm1whggs",
  insulinLanguage: "color_mm1wgrst",
  ipScript: "color_mm1wsbk5",
  diabetesEducation: "color_mm1wjsyq",
  threeInjections: "color_mm1wj1v8",
  cgmUse: "color_mm1wgpek",
  bloodSugarIssues: "color_mm1wpcrd",
  lmn: "color_mm1wdcsf",
  oowDate: "color_mm1wmv5c",
  malfunction: "color_mm1wp4e9",
  diagnosis: "color_mm1wf7rv",

  // MRs / Clinicals
  mrsClinicals: "color_mm1y8rv8",
  lastVisit: "date_mm1wb9br",
  mrExpiryDate: "date_mm1ymthz",
  clinicalFiles: "file_mm1w5vwp",
  finalClinicals: "file_mm25m8c1",
  medicalNecessity: "color_mm1y6qrf",
  mnEvalNotes: "long_text_mm27zjt2",
  generalMnInvalidReasons: "dropdown_mm2xppn8",
  cgmMnInvalidReasons: "dropdown_mm2xncfh",
  ipMnInvalidReasons: "dropdown_mm2xgg2y",
  /** Doctor-facing rolled-up ask list (replaces the 3 raw dropdowns above
   *  in the Send Request UI + the MN Request Letter PDF). */
  mnRequestConsolidated: "dropdown_mm2yd3a2",
  requestSentAt: "date_mm2yg8x8",

  // Script generation
  generateCgmScript: "color_mm1w2ey",
  cgmTemplate: "file_mm1wf720",
  generateIpScript: "color_mm1w4wd8",
  ipTemplate: "file_mm1wft5h",

  // Send Request → Supermail
  mnRequestLetter: "file_mm2yydbc",
  sendRequestTrigger: "color_mm2y7t2x",

  // Confirm Receipt / Chase
  confirmChaseNotes: "long_text_mm2ytsxp",
  confirmReceiptNotes: "text_mm1wbe5y",
  // Per-attempt columns — each holds "Name — M/D/YY" for one
  // unsuccessful confirm-receipt attempt.
  confirmAttempt1: "text_mm2yd068",
  confirmAttempt2: "text_mm2y9h4a",
  confirmAttempt3: "text_mm2ymtsk",
  receiptConfirmedDate: "date_mm1wxpdk",
  receiptConfirmedName: "text_mm1wj9at",
  // Per-attempt columns for the Chase Clinicals stage — same shape as
  // the confirm-receipt attempts.
  chaseAttempt1: "text_mm2yhpjt",
  chaseAttempt2: "text_mm2yb3rv",
  chaseAttempt3: "text_mm2ybk06",
  chaseRecipientName: "text_mm1wabj9",
  mnAttempts: "color_mm1wz0vg",
  nextActionDate: "date_mm1wadgs",
  escalation: "color_mm1x7997",
  escalationNotes: "long_text_mm3j43qk",

  // Advancers
  advancer2a: "color_mm1w73jx",
  advancer2b: "color_mm1wfbkz",
  advancer2c: "color_mm1wf98t",
  advancer2d: "color_mm1wcsbv",

  // Blocked
  blocked: "color_mm33ppgw",
  blockedDate: "date_mm33vqkm",

  // Follow Up
  followUp: "color_mm35v6a0",
  followUpDate: "date_mm35kbkj",

  // Debug
  joshDebug: "text_mm356n2y",

  // Profile Send Off Notes (mirrored from Profile Send Off Board)
  profileSendOffNotes: "text_mm3xdze1",
} as const;

// Columns to read on load — keep small to avoid 503
export const READ_COLUMN_IDS: string[] = [
  COL.gender, COL.dob, COL.phone, COL.address, COL.primaryInsurance, COL.memberId1, COL.memberId2,
  COL.serving, COL.referralType, COL.referralSource,
  COL.pumpType, COL.cgmType, COL.requestType,
  COL.ipCoveragePath, COL.cgmCoveragePath,
  COL.doctorName, COL.doctorNpi, COL.clinicalsMethod,
  COL.doctorPhone, COL.doctorEmail, COL.doctorFax, COL.clinicName,
  COL.masterStage, COL.subStage,
  COL.daysSinceIntake, COL.daysSinceStageStart,
  COL.dateOfIntake, COL.dateOfStageStart,
  // Eval checklist
  COL.cgmScript, COL.hypoLanguage, COL.insulinLanguage, COL.ipScript,
  COL.diabetesEducation, COL.threeInjections, COL.cgmUse, COL.bloodSugarIssues,
  COL.lmn, COL.oowDate, COL.malfunction, COL.diagnosis,
  // MRs
  COL.mrsClinicals, COL.lastVisit, COL.mrExpiryDate, COL.medicalNecessity, COL.mnEvalNotes,
  COL.generalMnInvalidReasons, COL.cgmMnInvalidReasons, COL.ipMnInvalidReasons,
  COL.mnRequestConsolidated,
  COL.requestSentAt,
  // Scripts
  COL.generateCgmScript, COL.generateIpScript,
  // Receipt / Chase
  COL.confirmChaseNotes, COL.confirmReceiptNotes,
  COL.confirmAttempt1, COL.confirmAttempt2, COL.confirmAttempt3,
  COL.chaseAttempt1, COL.chaseAttempt2, COL.chaseAttempt3,
  COL.receiptConfirmedName, COL.receiptConfirmedDate, COL.chaseRecipientName,
  COL.mnAttempts, COL.nextActionDate,
  COL.escalation,
  COL.escalationNotes,
  // Advancers
  COL.advancer2a, COL.advancer2b, COL.advancer2c, COL.advancer2d,
  // Blocked
  COL.blocked, COL.blockedDate,
  // Follow Up
  COL.followUp, COL.followUpDate,
  COL.profileSendOffNotes,
];

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
  groupId: string = GROUPS.medicalNecessity,
  onMore?: (items: MondayItem[]) => void,
): Promise<MondayItem[]> {
  const PAGE = 200;
  const query = `
    query ($boardId: ID!, $cols: [String!]) {
      boards(ids: [$boardId]) {
        groups(ids: ["${groupId}"]) {
          items_page(limit: ${PAGE}) {
            cursor
            items {
              id
              name
              column_values(ids: $cols) { id text value }
            }
          }
        }
      }
    }
  `;
  const data = await gql<{
    boards: { groups: { items_page: { cursor: string | null; items: MondayItem[] } }[] }[];
  }>(query, { boardId: BOARD_ID, cols: READ_COLUMN_IDS });

  const firstPage = data.boards?.[0]?.groups?.[0]?.items_page?.items ?? [];
  let cursor = data.boards?.[0]?.groups?.[0]?.items_page?.cursor ?? null;

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


/** Fetch a single item by ID regardless of group (for cross-group deep-links). */
export async function fetchItemById(itemId: string): Promise<MondayItem | null> {
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
  }>(query, { itemId: [itemId], cols: READ_COLUMN_IDS });
  return data.items?.[0] ?? null;
}

// ---- Read helpers ----

/**
 * Fetch all status labels from a status column's settings_str in Monday.
 * Returns an array of label strings (e.g. ["E10.65", "E11.9", ...]).
 * Excludes internal placeholders like "Evaluate" and "Collect".
 */
export async function fetchStatusLabels(columnId: string): Promise<string[]> {
  const query = `
    query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        columns(ids: ["${columnId}"]) {
          settings_str
        }
      }
    }
  `;
  const data = await gql<{
    boards: { columns: { settings_str: string }[] }[];
  }>(query, { boardId: BOARD_ID });

  const settingsStr = data.boards?.[0]?.columns?.[0]?.settings_str;
  if (!settingsStr) return [];

  try {
    const settings = JSON.parse(settingsStr);
    const labels: Record<string, { label: string }> = settings.labels ?? {};
    return Object.values(labels)
      .map((v) => v.label)
      .filter((l) => l !== "Evaluate" && l !== "Collect")
      .sort();
  } catch {
    return [];
  }
}

/**
 * Fetch every {index, label} pair currently defined on a status column.
 * Returns the full mapping so the UI can resolve indexes without a hardcoded list.
 */
export async function fetchStatusOptions(
  columnId: string,
): Promise<{ index: number; label: string }[]> {
  const query = `
    query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        columns(ids: ["${columnId}"]) {
          settings_str
        }
      }
    }
  `;
  const data = await gql<{
    boards: { columns: { settings_str: string }[] }[];
  }>(query, { boardId: BOARD_ID });
  const settingsStr = data.boards?.[0]?.columns?.[0]?.settings_str;
  if (!settingsStr) return [];
  try {
    const settings = JSON.parse(settingsStr);
    const labels: Record<string, string | { label?: string }> =
      settings.labels ?? {};
    return Object.entries(labels)
      .map(([key, v]) => ({
        index: Number(key),
        label: typeof v === "string" ? v : v.label ?? "",
      }))
      .filter((o) => o.label && !Number.isNaN(o.index));
  } catch {
    return [];
  }
}

// ---- Write primitives ----

export async function writeStatusIndex(itemId: string, columnId: string, index: number): Promise<void> {
  const value = JSON.stringify({ index });
  await gql(`mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}) { id } }`);
}

/** Clear a status column (sets it to no value / blank). */
export async function clearDateColumn(itemId: string, columnId: string): Promise<void> {
  await gql(`mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: "{}") { id } }`);
}

export async function clearStatusColumn(itemId: string, columnId: string): Promise<void> {
  // Empty JSON object clears the status column
  const value = JSON.stringify("");
  await gql(`mutation { change_simple_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${value}) { id } }`);
}

/** Set a status column by label (auto-creates the label if missing). */
export async function writeStatusLabel(
  itemId: string,
  columnId: string,
  label: string,
): Promise<void> {
  const value = JSON.stringify({ label });
  await gql(
    `mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}, create_labels_if_missing: true) { id } }`,
  );
}

/** Set a multi-select dropdown column by an array of labels. */
export async function writeDropdownLabels(
  itemId: string,
  columnId: string,
  labels: string[],
): Promise<void> {
  const value = JSON.stringify({ labels });
  await gql(
    `mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}, create_labels_if_missing: true) { id } }`,
  );
}

/** Read raw text values for a list of columns. */
export async function fetchItemColumnTexts(
  itemId: string,
  columnIds: string[],
): Promise<Record<string, string>> {
  if (columnIds.length === 0) return {};
  const query = `
    query ($itemId: [ID!]!, $columnIds: [String!]!) {
      items(ids: $itemId) {
        column_values(ids: $columnIds) {
          id
          text
        }
      }
    }
  `;
  const data = await gql<{
    items: { column_values: { id: string; text: string | null }[] }[];
  }>(query, { itemId: [itemId], columnIds });
  const out: Record<string, string> = {};
  for (const cv of data.items?.[0]?.column_values ?? []) {
    if (cv.text != null) out[cv.id] = cv.text;
  }
  return out;
}

export async function writeText(itemId: string, columnId: string, text: string): Promise<void> {
  const value = JSON.stringify(text);
  await gql(`mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}) { id } }`);
}

export async function writeLongText(itemId: string, columnId: string, text: string): Promise<void> {
  const value = JSON.stringify({ text });
  await gql(`mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}) { id } }`);
}

export async function writeDate(itemId: string, columnId: string, dateStr: string): Promise<void> {
  const value = JSON.stringify({ date: dateStr });
  await gql(`mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}) { id } }`);
}

/** Write a Monday date column with both date AND time (UTC). */
export async function writeDateTime(
  itemId: string,
  columnId: string,
  date: Date = new Date(),
): Promise<void> {
  const iso = date.toISOString(); // 2026-04-30T14:30:00.000Z
  const [datePart, timePartFull] = iso.split("T");
  const time = timePartFull.slice(0, 8); // 14:30:00
  const value = JSON.stringify({ date: datePart, time });
  await gql(
    `mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}) { id } }`,
  );
}

// ---- File asset helpers ----

export interface MondayAsset {
  id: string;
  name: string;
  url: string;
  public_url: string;
}

export async function fetchItemAssets(itemId: string): Promise<MondayAsset[]> {
  const query = `
    query ($itemId: [ID!]!) {
      items(ids: $itemId) {
        assets(assets_source: all) {
          id
          name
          url
          public_url
        }
      }
    }
  `;
  const data = await gql<{
    items: { assets: MondayAsset[] }[];
  }>(query, { itemId: [itemId] });
  return data.items?.[0]?.assets ?? [];
}

// ---- Per-column file fetcher ----
// Each Monday file column stores a JSON value like:
//   {"files":[{"name":"doc.pdf","assetId":12345,"isImage":false,...}]}
// We cross-reference the assetId with the item's full assets list to get
// public_url for each file in each requested column.

export interface MondayFileEntry {
  assetId: string;
  name: string;
  url?: string;
  public_url?: string;
}

export type ColumnFiles = Record<string, MondayFileEntry[]>;

/** Upload a file (PDF, image, etc.) into a Monday file column. */
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
  fd.append("variables[file]", new Blob([bytes as BlobPart], { type: mimeType }), filename);

  // Monday's /v2/file endpoint doesn't return CORS headers, so we relay
  // through our Cloudflare Worker (worker/src/index.js).
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
    throw new Error(`Upload network error (item ${itemId}, column ${columnId}): ${msg}`);
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

/** Removes ALL files from a single file column on a single item. */
export async function deleteFileFromColumn(
  itemId: string,
  columnId: string,
): Promise<void> {
  const query = `
    mutation ($itemId: ID!, $columnId: String!) {
      change_column_value(
        item_id: $itemId,
        column_id: $columnId,
        board_id: ${BOARD_ID},
        value: "{\\"clear_all\\": true}"
      ) {
        id
      }
    }
  `;
  await gql(query, { itemId, columnId });
}

/**
 * Remove a single file from a Monday file column by asset id.
 *
 * Monday's API only exposes "clear all" for file columns, so this is
 * implemented as: download every file we want to keep, clear the
 * column, then re-upload the kept files. Slow if the column has many
 * files but it's the only path that doesn't take down the whole column.
 */
export async function deleteSingleFileFromColumn(
  itemId: string,
  columnId: string,
  keepFiles: { name: string; url: string }[],
): Promise<void> {
  // 1) Pull the bytes of every file we want to keep before clearing.
  //    public_url is preferred but private url works too — both serve
  //    Monday-CDN-hosted assets with permissive CORS.
  const kept: { name: string; bytes: Uint8Array }[] = [];
  for (const f of keepFiles) {
    const res = await fetch(f.url);
    if (!res.ok) {
      throw new Error(
        `Failed to download "${f.name}" before delete (${res.status}). Aborted.`,
      );
    }
    const buf = await res.arrayBuffer();
    kept.push({ name: f.name, bytes: new Uint8Array(buf) });
  }

  // 2) Clear the column.
  await deleteFileFromColumn(itemId, columnId);

  // 3) Re-upload the kept files in order.
  for (const k of kept) {
    await uploadFileToColumn(itemId, columnId, k.bytes, k.name);
  }
}

export async function fetchItemFileColumns(
  itemId: string,
  columnIds: string[],
): Promise<ColumnFiles> {
  if (columnIds.length === 0) return {};
  const query = `
    query ($itemId: [ID!]!, $columnIds: [String!]!) {
      items(ids: $itemId) {
        assets(assets_source: all) {
          id
          name
          url
          public_url
        }
        column_values(ids: $columnIds) {
          id
          value
        }
      }
    }
  `;
  const data = await gql<{
    items: {
      assets: MondayAsset[];
      column_values: { id: string; value: string | null }[];
    }[];
  }>(query, { itemId: [itemId], columnIds });
  const item = data.items?.[0];
  if (!item) return {};
  const assetById = new Map<string, MondayAsset>();
  for (const a of item.assets ?? []) assetById.set(String(a.id), a);

  const out: ColumnFiles = {};
  for (const cv of item.column_values ?? []) {
    out[cv.id] = [];
    if (!cv.value) continue;
    try {
      const parsed = JSON.parse(cv.value) as { files?: { name?: string; assetId?: number | string }[] };
      for (const f of parsed.files ?? []) {
        const assetId = String(f.assetId ?? "");
        if (!assetId) continue;
        const a = assetById.get(assetId);
        out[cv.id].push({
          assetId,
          name: f.name ?? a?.name ?? "(unnamed)",
          url: a?.url,
          public_url: a?.public_url,
        });
      }
    } catch {
      // ignore malformed value
    }
  }
  return out;
}

// ---- Doctor-field write helpers ----
// Phone and email columns need specific JSON shapes.

export async function writePhone(itemId: string, columnId: string, phone: string): Promise<void> {
  const value = JSON.stringify({ phone, countryShortName: "US" });
  await gql(`mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}) { id } }`);
}

export async function writeEmail(itemId: string, columnId: string, email: string): Promise<void> {
  const value = JSON.stringify({ email, text: email });
  await gql(`mutation { change_column_value(item_id: ${itemId}, board_id: ${BOARD_ID}, column_id: "${columnId}", value: ${JSON.stringify(value)}) { id } }`);
}

/**
 * Write all doctor fields to Monday using the correct column-type format.
 * Phone → { phone, countryShortName }
 * Email/Fax → { email, text }
 * Clinic → dropdown labels (creates label if missing)
 * Name/NPI → plain text
 *
 * Collects into a { label, run } task array for batching with other writes.
 */
export function buildDoctorWriteTasks(
  patient: { id: string; doctorName?: string; doctorNpi?: string; doctorPhone?: string; doctorEmail?: string; doctorFax?: string; clinicName?: string },
): { label: string; run: () => Promise<void> }[] {
  const tasks: { label: string; run: () => Promise<void> }[] = [];
  if (patient.doctorName != null)
    tasks.push({ label: "Doctor Name", run: () => writeText(patient.id, COL.doctorName, patient.doctorName ?? "") });
  if (patient.doctorNpi != null)
    tasks.push({ label: "Doctor NPI", run: () => writeText(patient.id, COL.doctorNpi, patient.doctorNpi ?? "") });
  if (patient.doctorPhone != null)
    tasks.push({ label: "Doctor Phone", run: () => writePhone(patient.id, COL.doctorPhone, patient.doctorPhone ?? "") });
  if (patient.doctorEmail != null)
    tasks.push({ label: "Doctor Email", run: () => writeEmail(patient.id, COL.doctorEmail, patient.doctorEmail ?? "") });
  if (patient.doctorFax != null)
    tasks.push({ label: "Doctor Fax", run: () => writeEmail(patient.id, COL.doctorFax, patient.doctorFax ?? "") });
  if (patient.clinicName != null)
    tasks.push({ label: "Clinic Name", run: () => writeDropdownLabels(patient.id, COL.clinicName, [patient.clinicName ?? ""]) });
  return tasks;
}

// ---- Updates (referral email / item updates) ----

export interface MondayUpdate {
  id: string;
  body: string;
  created_at: string;
  creator: { name: string } | null;
}

/** Fetch all updates for a Monday item, newest first. */
export async function fetchUpdates(itemId: string): Promise<MondayUpdate[]> {
  const query = `
    query ($itemIds: [ID!]) {
      items(ids: $itemIds) {
        updates {
          id
          body
          created_at
          creator { name }
        }
      }
    }
  `;
  const data = await gql<{ items: { updates: MondayUpdate[] }[] }>(query, {
    itemIds: [itemId],
  });
  return data.items?.[0]?.updates ?? [];
}

/** Post a new update on a Monday item. */
export async function createUpdate(itemId: string, body: string): Promise<void> {
  const query = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) { id }
    }
  `;
  await gql(query, { itemId, body });
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
