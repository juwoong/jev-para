import type { ClockPort, LoggerPort, VaultPort } from '../ports';
import type { Journal } from './journal';

export type MoveFailureKind = 'conflict' | 'source-changed' | 'source-missing' | 'target-missing' | 'invalid-candidate' | 'journal' | 'rename';

export interface MovePlan {
  notePath: string;
  targetFolder: string;
  expectedHash: string;
  candidateId: string;
}

export interface MoveDeps {
  vault: VaultPort;
  journal: Journal;
  clock: ClockPort;
  validCandidateIds: readonly string[];
  validFolderPaths: readonly string[];
  logger?: LoggerPort;
}

export type MoveOutcome =
  | { ok: true; toPath: string; recordId: string }
  | { ok: false; failure: { kind: MoveFailureKind; message: string } };

function fileBaseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? '';
}

function parentFolder(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

export async function moveNote(deps: MoveDeps, runId: string, plan: MovePlan): Promise<MoveOutcome> {
  const { vault, journal, validCandidateIds, validFolderPaths } = deps;

  // 1. Validate candidate and folder
  if (!validCandidateIds.includes(plan.candidateId) || !validFolderPaths.includes(plan.targetFolder)) {
    return { ok: false, failure: { kind: 'invalid-candidate', message: 'invalid candidate or folder' } };
  }

  // 2. Source must exist and live directly inside 0. Inbox
  const sourceExists = await vault.exists(plan.notePath);
  const sourceParent = parentFolder(plan.notePath);
  if (!sourceExists || sourceParent !== '0. Inbox') {
    return { ok: false, failure: { kind: 'source-missing', message: 'source not in Inbox' } };
  }

  // 3. Hash check
  const currentHash = await vault.hash(plan.notePath);
  if (currentHash !== plan.expectedHash) {
    return { ok: false, failure: { kind: 'source-changed', message: 'source has changed' } };
  }

  // 4. Target folder must exist
  const targetFolderExists = await vault.exists(plan.targetFolder);
  if (!targetFolderExists) {
    return { ok: false, failure: { kind: 'target-missing', message: 'target folder not found' } };
  }

  // 5. Conflict check (case-insensitive)
  const fileName = fileBaseName(plan.notePath);
  const toPath = plan.targetFolder + '/' + fileName;
  const allFiles = await vault.listMarkdownFiles();
  const allFolders = await vault.listFolders();
  const allPaths = [...allFiles, ...allFolders];
  const toLower = toPath.toLowerCase();
  const conflict = allPaths.some((p) => p.toLowerCase() === toLower);
  if (conflict) {
    return { ok: false, failure: { kind: 'conflict', message: 'conflict at target path' } };
  }

  // 6. Journal begin BEFORE rename
  let record;
  try {
    record = await journal.begin({
      runId,
      notePath: plan.notePath,
      fromPath: plan.notePath,
      toPath,
      preHash: plan.expectedHash,
    });
  } catch {
    return { ok: false, failure: { kind: 'journal', message: 'journal write failed' } };
  }

  // 7. Rename
  try {
    await vault.rename(plan.notePath, toPath);
  } catch (err) {
    await journal.fail(record.id, err instanceof Error ? err.message : String(err));
    return { ok: false, failure: { kind: 'rename', message: 'rename failed' } };
  }

  // 8. Complete
  const postHash = await vault.hash(toPath);
  await journal.complete(record.id, postHash);

  return { ok: true, toPath, recordId: record.id };
}

export async function moveMany(
  deps: MoveDeps,
  runId: string,
  plans: MovePlan[],
): Promise<Array<{ plan: MovePlan; outcome: MoveOutcome }>> {
  const results: Array<{ plan: MovePlan; outcome: MoveOutcome }> = [];
  for (const plan of plans) {
    const outcome = await moveNote(deps, runId, plan);
    results.push({ plan, outcome });
  }
  return results;
}

