// Denial Playbook resource locations.
//
// These power the "open the source of truth" links surfaced in the
// Denial Analysis card on ClaimDetail. Same identifiers the backend
// uses on Railway (DRIVE_ERA_FOLDER_ID + DENIAL_PLAYBOOK_SHEET_ID).
//
// Why hardcoded here instead of read from import.meta.env: these IDs
// are stable across deploys and shared across the team — there's no
// per-environment override worth the build-time complexity. If we
// ever need per-env IDs (e.g. a staging Sheet), promote these to
// VITE_* env vars and add the fallback in this file.

/** Google Drive folder where the hourly cron archives raw 835 JSONs
 *  as `stedi-{transaction_id}.edi`. Backend default in
 *  services/playbook_refresh_service.py:DEFAULT_DRIVE_ERA_FOLDER_ID. */
export const DRIVE_ERA_FOLDER_ID = "1lrq93N6f-rdM8MQnk0ZqT-GCDhvK62is";

/** "Denial Playbook" Google Sheet — source of truth for CARC/RARC →
 *  bucket mapping. The "Unique Combos" tab is what the hourly cron
 *  reads/appends to; the backend's denial_playbook_data.json is a
 *  snapshot of the verified rows. */
export const DENIAL_PLAYBOOK_SHEET_ID =
  "1xqqLEw6T3gIzpd2YHskp7joaLEmxr7y17c6BmeuI3lA";

export const DRIVE_ERA_FOLDER_URL =
  `https://drive.google.com/drive/folders/${DRIVE_ERA_FOLDER_ID}`;

export const DENIAL_PLAYBOOK_SHEET_URL =
  `https://docs.google.com/spreadsheets/d/${DENIAL_PLAYBOOK_SHEET_ID}/edit`;
