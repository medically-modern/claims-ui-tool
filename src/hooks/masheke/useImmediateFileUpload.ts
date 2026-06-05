/**
 * useImmediateFileUpload — uploads files to Monday the instant they're
 * dropped / selected, then polls the column to confirm the asset landed
 * server-side.  Returns per-file status so the UI can show spinners,
 * checkmarks, and — most importantly — block "Send to Monday" until every
 * file is confirmed.
 *
 * Drop-in for EvaluatePanel's pending-file-ref pattern.
 */

import { useCallback, useRef, useState } from "react";
import {
  uploadFileToColumn,
  fetchItemFileColumns,
  type ColumnFiles,
} from "@/lib/masheke/mondayApi";

export type FileStatus = "uploading" | "confirming" | "confirmed" | "error";

export interface TrackedFile {
  name: string;
  size: number;
  status: FileStatus;
  error?: string;
}

interface UseImmediateFileUploadReturn {
  /** Tracked files with their current status. */
  files: TrackedFile[];
  /** True while ANY file is still uploading or awaiting confirmation. */
  busy: boolean;
  /** True when every file has been confirmed server-side (or list is empty). */
  allConfirmed: boolean;
  /** Immediately upload new files to the given Monday column. */
  upload: (
    itemId: string,
    columnId: string,
    rawFiles: File[],
  ) => Promise<void>;
  /** Clear the tracked list (call when switching patients). */
  reset: () => void;
}

const POLL_INTERVAL_MS = 2_500;
const MAX_POLLS = 20; // ~50 s max wait

export function useImmediateFileUpload(): UseImmediateFileUploadReturn {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  // Keep a mutable mirror so the polling closure always sees the latest.
  const filesRef = useRef<TrackedFile[]>([]);

  const syncState = (next: TrackedFile[]) => {
    filesRef.current = next;
    setFiles([...next]);
  };

  const updateFile = (name: string, patch: Partial<TrackedFile>) => {
    const next = filesRef.current.map((f) =>
      f.name === name ? { ...f, ...patch } : f,
    );
    syncState(next);
  };

  /** Poll Monday until the file appears in the column's asset list. */
  const confirmFile = useCallback(
    async (itemId: string, columnId: string, fileName: string) => {
      updateFile(fileName, { status: "confirming" });
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const cols: ColumnFiles = await fetchItemFileColumns(itemId, [columnId]);
          const entries = cols[columnId] ?? [];
          if (entries.some((e) => e.name === fileName)) {
            updateFile(fileName, { status: "confirmed" });
            return;
          }
        } catch {
          // swallow — keep polling
        }
      }
      updateFile(fileName, {
        status: "error",
        error: "Timed out waiting for server confirmation",
      });
    },
    [],
  );

  const upload = useCallback(
    async (itemId: string, columnId: string, rawFiles: File[]) => {
      // Add entries immediately so UI reacts.
      const newEntries: TrackedFile[] = rawFiles.map((f) => ({
        name: f.name,
        size: f.size,
        status: "uploading" as const,
      }));
      syncState([...filesRef.current, ...newEntries]);

      // Fire all uploads concurrently.
      await Promise.all(
        rawFiles.map(async (file) => {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            await uploadFileToColumn(
              itemId,
              columnId,
              bytes,
              file.name,
              file.type || "application/octet-stream",
            );
            // Upload call returned — start polling for confirmation.
            confirmFile(itemId, columnId, file.name);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            updateFile(file.name, { status: "error", error: msg });
          }
        }),
      );
    },
    [confirmFile],
  );

  const reset = useCallback(() => syncState([]), []);

  const busy = files.some(
    (f) => f.status === "uploading" || f.status === "confirming",
  );
  const allConfirmed =
    files.length === 0 || files.every((f) => f.status === "confirmed");

  return { files, busy, upload, reset, allConfirmed };
}
