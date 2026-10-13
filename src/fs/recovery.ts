import type { LoggerPort, VaultPort } from '../ports';
import type { Journal } from './journal';
import type { ClockPort } from '../ports';

export interface RecoveryDeps {
  vault: VaultPort;
  journal: Journal;
  clock: ClockPort;
  logger?: LoggerPort;
}

export async function recoverPending(deps: RecoveryDeps): Promise<{
  recoveredCompleted: string[];
  notStarted: string[];
  needsReview: string[];
}> {
  const { vault, journal } = deps;
  const pendingRecords = journal.pending();
  const recoveredCompleted: string[] = [];
  const notStarted: string[] = [];
  const needsReview: string[] = [];

  for (const record of pendingRecords) {
    const fromHash = await vault.hash(record.fromPath);
    const toHash = await vault.hash(record.toPath);

    const sourcePresent = fromHash !== null;
    const targetPresent = toHash !== null;
    const sourceHashMatch = fromHash === record.preHash;
    if (sourcePresent && !targetPresent && sourceHashMatch) {
      // Not started - source exists with correct hash, target absent
      notStarted.push(record.id);
    } else if (targetPresent && !sourcePresent) {
      // Completed - target present, source gone
      await journal.complete(record.id, toHash);
      recoveredCompleted.push(record.id);
    } else {
      // Ambiguous: both present, both absent, or hash mismatch
      await journal.needsReview(record.id, 'Cannot determine state during recovery.');
      needsReview.push(record.id);
    }
  }

  return { recoveredCompleted, notStarted, needsReview };
}

export async function undoRun(
  deps: RecoveryDeps,
  runId: string,
): Promise<{ undone: number; skipped: number; reasons: string[] }> {
  const { vault, journal } = deps;
  const records = journal.byRun(runId).filter((r) => r.status === 'completed');

  if (records.length === 0) {
    return { undone: 0, skipped: 0, reasons: [] };
  }

  let undone = 0;
  let skipped = 0;
  const reasons: string[] = [];

  for (const record of records) {
    // null postHash is not undoable
    if (record.postHash === null) {
      skipped++;
      reasons.push(record.notePath + ': Cannot undo: post-move hash is missing.');
      continue;
    }

    // Note must be at toPath with postHash
    const currentHash = await vault.hash(record.toPath);
    if (currentHash !== record.postHash) {
      skipped++;
      reasons.push(record.notePath + ': Cannot undo: the file was edited or moved again.');
      continue;
    }

    // Original fromPath must be empty
    const fromExists = await vault.exists(record.fromPath);
    if (fromExists) {
      skipped++;
      reasons.push(record.notePath + ': Cannot undo: another file occupies the original path.');
      continue;
    }

    // Rename back
    await vault.rename(record.toPath, record.fromPath);
    await journal.markReverted(record.id);

    // Hold to prevent auto re-move
    await journal.hold(record.fromPath, record.preHash);

    undone++;
  }

  skipped += 0; // already counted above
  return { undone, skipped, reasons };
}

