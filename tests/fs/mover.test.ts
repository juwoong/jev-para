import { describe, it, expect, beforeEach } from 'vitest';
import { moveNote, moveMany } from '../../src/fs/mover';
import type { MoveDeps, MovePlan } from '../../src/fs/mover';
import { Journal } from '../../src/fs/journal';
import { FakeVault, FakeStore, FakeClock, testHash } from '../helpers/fakes';

const INBOX = '0. Inbox';
const TARGET_FOLDER = '1. Projects/p1';

function makeNote(name: string) {
  return INBOX + '/' + name;
}

function makeSetup(opts?: { validCandidateIds?: readonly string[]; validFolderPaths?: readonly string[] }) {
  const noteContent = '베타 출시를 위한 노트';
  const notePath = makeNote('note.md');
  const vault = new FakeVault(
    { [notePath]: noteContent },
    [INBOX, TARGET_FOLDER]
  );
  const store = new FakeStore();
  const clock = new FakeClock();
  const journal = new Journal({ store, clock });
  const deps: MoveDeps = {
    vault,
    journal,
    clock,
    validCandidateIds: opts?.validCandidateIds ?? ['p1'],
    validFolderPaths: opts?.validFolderPaths ?? [TARGET_FOLDER],
  };
  return { vault, store, clock, journal, deps, notePath, noteContent };
}

async function loadedJournal(deps: MoveDeps) {
  await (deps.journal as Journal).load();
}

describe('moveNote', () => {
  it('MOV-01: moves note, writes journal pending before rename then completed', async () => {
    const { vault, journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const toPath = TARGET_FOLDER + '/note.md';
    expect(outcome.toPath).toBe(toPath);
    expect(vault.files.has(toPath)).toBe(true);
    expect(vault.files.has(notePath)).toBe(false);

    const records = journal.all();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('completed');
    expect(records[0].postHash).not.toBeNull();
    expect(records[0].fromPath).toBe(notePath);
    expect(records[0].toPath).toBe(toPath);
  });

  it('MOV-02: conflict - same name file exists at target', async () => {
    const { vault, journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();
    // Put conflicting file
    vault.files.set(TARGET_FOLDER + '/note.md', 'other content');

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('conflict');
    // Source preserved
    expect(vault.files.has(notePath)).toBe(true);
    expect(vault.files.get(TARGET_FOLDER + '/note.md')).toBe('other content');
  });

  it('MOV-02: case-insensitive conflict', async () => {
    const { vault, journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();
    // Put conflicting file with different case
    vault.files.set(TARGET_FOLDER + '/NOTE.md', 'other content');

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('conflict');
    expect(vault.files.has(notePath)).toBe(true);
  });

  it('MOV-03: source changed - hash mismatch', async () => {
    const { journal, deps, notePath } = makeSetup();
    await journal.load();

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: 'wrong-hash',
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('source-changed');
  });

  it('MOV-03: source missing - file deleted', async () => {
    const { vault, journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();
    vault.files.delete(notePath);

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('source-missing');
  });

  it('MOV-03: source not in Inbox (manually moved)', async () => {
    const noteContent = 'content';
    const notInInbox = '1. Projects/p1/already.md';
    const vault = new FakeVault({ [notInInbox]: noteContent }, [INBOX, TARGET_FOLDER]);
    const store = new FakeStore();
    const clock = new FakeClock();
    const journal = new Journal({ store, clock });
    await journal.load();
    const deps: MoveDeps = { vault, journal, clock, validCandidateIds: ['p1'], validFolderPaths: [TARGET_FOLDER] };

    const plan: MovePlan = {
      notePath: notInInbox,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('source-missing');
  });

  it('MOV-04: target folder deleted', async () => {
    const { vault, journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();
    // Remove target folder
    vault.folders.delete(TARGET_FOLDER);

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('target-missing');
    // Source preserved
    expect(vault.files.has(notePath)).toBe(true);
  });

  it('MOV-05: journal begin failure prevents rename', async () => {
    const { store, journal, deps, notePath, noteContent, vault } = makeSetup();
    await journal.load();
    store.setFailure = new Error('disk full');

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('journal');
    // No rename happened
    expect(vault.files.has(notePath)).toBe(true);
    expect(vault.log.filter((l) => l.startsWith('rename')).length).toBe(0);
  });

  it('MOV-06: rename failure marks journal failed', async () => {
    const { vault, journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();
    vault.renameFailure = new Error('permission denied');

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('rename');

    const records = journal.all();
    expect(records[0].status).toBe('failed');
  });

  it('invalid candidateId returns invalid-candidate', async () => {
    const { journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();

    const plan: MovePlan = {
      notePath,
      targetFolder: TARGET_FOLDER,
      expectedHash: testHash(noteContent),
      candidateId: 'unknown-id',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('invalid-candidate');
  });

  it('invalid targetFolder returns invalid-candidate', async () => {
    const { journal, deps, notePath, noteContent } = makeSetup();
    await journal.load();

    const plan: MovePlan = {
      notePath,
      targetFolder: '4. Archives/old',
      expectedHash: testHash(noteContent),
      candidateId: 'p1',
    };

    const outcome = await moveNote(deps, 'run1', plan);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('invalid-candidate');
  });
});

describe('moveMany - MOV-08', () => {
  it('MOV-08: two success one conflict - partial result, no unrelated changes', async () => {
    const content1 = 'note 1 content';
    const content2 = 'note 2 content';
    const content3 = 'note 3 content';
    const note1 = INBOX + '/n1.md';
    const note2 = INBOX + '/n2.md';
    const note3 = INBOX + '/n3.md';
    const folder1 = '1. Projects/p1';
    const folder2 = '2. Areas/a1';
    const folder3 = '3. Resources/r1';

    const vault = new FakeVault(
      { [note1]: content1, [note2]: content2, [note3]: content3 },
      [INBOX, folder1, folder2, folder3]
    );
    // Pre-place conflicting file for note3
    vault.files.set(folder3 + '/n3.md', 'existing');

    const store = new FakeStore();
    const clock = new FakeClock();
    const journal = new Journal({ store, clock });
    await journal.load();

    const deps: MoveDeps = {
      vault,
      journal,
      clock,
      validCandidateIds: ['p1', 'a1', 'r1'],
      validFolderPaths: [folder1, folder2, folder3],
    };

    const plans: MovePlan[] = [
      { notePath: note1, targetFolder: folder1, expectedHash: testHash(content1), candidateId: 'p1' },
      { notePath: note2, targetFolder: folder2, expectedHash: testHash(content2), candidateId: 'a1' },
      { notePath: note3, targetFolder: folder3, expectedHash: testHash(content3), candidateId: 'r1' },
    ];

    const results = await moveMany(deps, 'run-batch', plans);

    expect(results).toHaveLength(3);
    expect(results[0].outcome.ok).toBe(true);
    expect(results[1].outcome.ok).toBe(true);
    expect(results[2].outcome.ok).toBe(false);
    if (!results[2].outcome.ok) {
      expect(results[2].outcome.failure.kind).toBe('conflict');
    }

    // Success notes moved
    expect(vault.files.has(folder1 + '/n1.md')).toBe(true);
    expect(vault.files.has(folder2 + '/n2.md')).toBe(true);
    // Conflict: existing target preserved, source preserved
    expect(vault.files.get(folder3 + '/n3.md')).toBe('existing');
    expect(vault.files.has(note3)).toBe(true);
  });
});

