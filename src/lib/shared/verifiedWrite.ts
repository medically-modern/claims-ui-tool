/**
 * Shared write-then-verify-then-advance utility.
 *
 * Monday's API returns 200 on a column write before the value is fully
 * indexed. If an automation triggers on a status change (e.g. Stage
 * Advancer = "Complete"), it can read stale pre-write values from other
 * columns. This utility prevents that race condition by:
 *
 *   1. Snapshotting all data columns BEFORE writing (Phase 0)
 *   2. Writing all data columns in parallel (Phase 1)
 *   3. Polling until every written column has been indexed (Phase 2)
 *   4. Only then writing the stage advancer column(s) (Phase 3)
 *
 * Verification logic (Phase 2):
 *   - If a task has `expectedText`: column must match it exactly
 *   - Otherwise: column must differ from the pre-write snapshot
 *   - Edge case — writing the same value that was already there:
 *     after 3 consecutive stable reads, assume the write landed
 *     (the automation will read the correct value either way)
 *
 * If verification times out, the stage advancer is NOT written and the
 * function throws — surfacing the problem instead of silently shipping
 * stale data downstream.
 */

// ── Types ──────────────────────────────────────────────────────

export interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
  /** Optional: expected `text` value after the write. When provided,
   *  takes priority over snapshot-diff verification. */
  expectedText?: string;
}

interface ColumnSnapshot {
  id: string;
  text: string | null;
}

/** A function that reads column values for an item. Each mondayApi module
 *  has its own `gql` wrapper, so callers pass a thin adapter. */
export type ReadColumnsFn = (
  itemId: string,
  columnIds: string[],
) => Promise<ColumnSnapshot[]>;

interface VerifiedWriteOpts {
  itemId: string;
  /** All write tasks including the stage advancer. */
  tasks: WriteTask[];
  /** Column ID(s) of the stage advancer (or equivalent trigger columns).
   *  These columns are written LAST, after all other columns are verified.
   *  Accepts a single string or an array. */
  stageColumnId: string | string[];
  /** Retry wrapper — typically the same `executeWithRetry` each module
   *  already has. */
  executeWithRetry: (task: WriteTask) => Promise<string | null>;
  /** Adapter for reading columns back from Monday. */
  readColumns: ReadColumnsFn;
  /** Max read-back attempts before giving up. Default 8 (~12s). */
  maxVerifyAttempts?: number;
  /** Delay between read-back attempts in ms. Default 1500. */
  verifyIntervalMs?: number;
  /** Consecutive stable reads before assuming a same-value write landed.
   *  Default 3. */
  stableReadsThreshold?: number;
  /** Optional: write a debug message on failure. */
  writeDebug?: (itemId: string, msg: string) => Promise<void>;
}

// ── Core ───────────────────────────────────────────────────────

export async function executeWritesWithVerification(
  opts: VerifiedWriteOpts,
): Promise<string[]> {
  const {
    itemId,
    tasks,
    stageColumnId,
    executeWithRetry,
    readColumns,
    maxVerifyAttempts = 8,
    verifyIntervalMs = 1500,
    stableReadsThreshold = 3,
    writeDebug,
  } = opts;

  // Split tasks — stage column(s) run last
  const stageIds = new Set(
    Array.isArray(stageColumnId) ? stageColumnId : [stageColumnId],
  );
  const stageTasks = tasks.filter((t) => stageIds.has(t.columnId));
  const dataTasks = tasks.filter((t) => !stageIds.has(t.columnId));

  // Collect column IDs we need to verify
  const verifyColIds = dataTasks.map((t) => t.columnId);

  // ── Phase 0: snapshot BEFORE writing ─────────────────────
  let beforeSnapshot = new Map<string, string>();
  if (verifyColIds.length > 0) {
    try {
      const snap = await readColumns(itemId, verifyColIds);
      beforeSnapshot = new Map(snap.map((c) => [c.id, c.text ?? ""]));
    } catch (err) {
      console.warn("[verifiedWrite] Pre-write snapshot failed, falling back to no-snapshot mode:", err);
    }
  }

  // ── Phase 1: write all data columns in parallel ──────────
  const dataResults = await Promise.all(dataTasks.map(executeWithRetry));
  const dataFailures = dataResults.filter((r): r is string => r !== null);

  if (dataFailures.length > 0) {
    if (writeDebug) {
      const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      const msg = `[${ts}] ${dataFailures.length} write(s) failed (stage NOT advanced):\n${dataFailures.join("\n")}`;
      try { await writeDebug(itemId, msg); } catch { /* best-effort */ }
    }
    return dataFailures;
  }

  // ── Phase 2: read-back verification ──────────────────────
  if (verifyColIds.length > 0) {
    // Track how many consecutive reads each column has been "stable"
    // (unchanged from snapshot). Once a column hits the threshold,
    // we assume a same-value write and stop waiting.
    const stableCount = new Map<string, number>();
    let verified = false;

    for (let attempt = 1; attempt <= maxVerifyAttempts; attempt++) {
      const snapshot = await readColumns(itemId, verifyColIds);
      const actual = new Map(snapshot.map((c) => [c.id, c.text ?? ""]));

      const pending: string[] = [];

      for (const task of dataTasks) {
        const colId = task.columnId;
        const currentVal = actual.get(colId) ?? "";
        const beforeVal = beforeSnapshot.get(colId) ?? "";

        // Method 1: expectedText provided — exact match
        if (task.expectedText !== undefined) {
          if (currentVal === task.expectedText) continue; // verified
          pending.push(`${task.label}: expected "${task.expectedText}", got "${currentVal}"`);
          continue;
        }

        // Method 2: snapshot diff — value changed from before
        if (currentVal !== beforeVal) continue; // verified — value changed

        // Value hasn't changed from snapshot. Could be:
        //   (a) same-value write — already correct, automation safe
        //   (b) write not indexed yet — stale value
        // Track consecutive stable reads to distinguish.
        const prevStable = stableCount.get(colId) ?? 0;
        const newStable = prevStable + 1;
        stableCount.set(colId, newStable);

        if (newStable >= stableReadsThreshold) {
          // Assume same-value write — the automation will read the
          // correct value regardless.
          continue;
        }

        pending.push(`${task.label}: unchanged from snapshot "${beforeVal}" (stable read ${newStable}/${stableReadsThreshold})`);
      }

      if (pending.length === 0) {
        console.log(
          `[verifiedWrite] All ${dataTasks.length} columns verified on attempt ${attempt}`,
        );
        verified = true;
        break;
      }

      console.warn(
        `[verifiedWrite] Attempt ${attempt}/${maxVerifyAttempts}: ${pending.length} column(s) pending`,
        pending,
      );

      if (attempt < maxVerifyAttempts) {
        await new Promise((r) => setTimeout(r, verifyIntervalMs));
      }
    }

    if (!verified) {
      const msg = `Stage advancer NOT written: column(s) failed read-back verification after ${maxVerifyAttempts} attempts (~${Math.round((maxVerifyAttempts * verifyIntervalMs) / 1000)}s). Monday may be unusually slow — retry the send.`;
      console.error(`[verifiedWrite] ${msg}`);
      if (writeDebug) {
        try { await writeDebug(itemId, `[${new Date().toISOString().slice(0, 19)}] ${msg}`); } catch { /* best-effort */ }
      }
      throw new Error(msg);
    }
  }

  // ── Phase 3: write stage advancer(s) ───────────────────
  for (const st of stageTasks) {
    const stageErr = await executeWithRetry(st);
    if (stageErr) {
      throw new Error(`${st.label} failed after retries: ${stageErr}`);
    }
  }

  return []; // all succeeded
}
