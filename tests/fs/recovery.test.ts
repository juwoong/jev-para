import { describe, it, expect } from 'vitest';
import { recoverPending, undoRun } from '../../src/fs/recovery';
import type { RecoveryDeps } from '../../src/fs/recovery';
import { Journal } from '../../src/fs/journal';
import { FakeVault, FakeStore, FakeClock, testHash } from '../helpers/fakes';

function makeRec() {
  const store = new FakeStore();
  const clock = new FakeClock();
  const journal = new Journal({ store, clock });
  return { store, clock, journal };
}

describe('recoverPending', () => {
  it('REC-01: source present with matching preHash, target absent -> notStarted', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    const vault = new FakeVault({ [from]: content }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'r', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await recoverPending(deps);

    expect(result.notStarted).toContain(rec.id);
    expect(result.recoveredCompleted).toHaveLength(0);
    expect(result.needsReview).toHaveLength(0);
    // Status still pending
    expect(journal.all().find((r) => r.id === rec.id)?.status).toBe('pending');
    // No rename
    expect(vault.files.has(from)).toBe(true);
    expect(vault.files.has(to)).toBe(false);
  });

  it('REC-02: target present, source absent -> recoveredCompleted', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    // Target exists, source gone
    const vault = new FakeVault({ [to]: content }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'r', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await recoverPending(deps);

    expect(result.recoveredCompleted).toContain(rec.id);
    expect(result.notStarted).toHaveLength(0);
    expect(journal.all().find((r) => r.id === rec.id)?.status).toBe('completed');
    // No rename
    expect(vault.files.has(to)).toBe(true);
  });

  it('REC-03: both present -> needsReview', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    const vault = new FakeVault({ [from]: content, [to]: content }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'r', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await recoverPending(deps);

    expect(result.needsReview).toContain(rec.id);
    expect(vault.files.has(from)).toBe(true);
    expect(vault.files.has(to)).toBe(true);
  });

  it('REC-03: both absent -> needsReview', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    const vault = new FakeVault({}, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'r', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await recoverPending(deps);

    expect(result.needsReview).toContain(rec.id);
  });

  it('REC-03: hash mismatch -> needsReview', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    // Source has different content
    const vault = new FakeVault({ [from]: 'different content' }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'r', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await recoverPending(deps);

    expect(result.needsReview).toContain(rec.id);
  });

  it('REC-05: corrupt journal throws', async () => {
    const { store, clock } = makeRec();
    await store.set('jev-para:journal', { version: 1, records: 'bad', holds: {} });
    const journal = new Journal({ store, clock });
    await expect(journal.load()).rejects.toThrow();
  });
});

describe('undoRun', () => {
  it('UND-01: successful undo - moves back and marks reverted, holds path', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    // File is at toPath after move
    const vault = new FakeVault({ [to]: content }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    // Simulate a completed move record
    const rec = await journal.begin({ runId: 'run1', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });
    await journal.complete(rec.id, testHash(content));

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await undoRun(deps, 'run1');

    expect(result.undone).toBe(1);
    expect(result.skipped).toBe(0);
    expect(vault.files.has(from)).toBe(true);
    expect(vault.files.has(to)).toBe(false);

    const updated = journal.all().find((r) => r.id === rec.id);
    expect(updated?.status).toBe('reverted');

    // Hold applied
    expect(journal.isHeld(from, testHash(content))).toBe(true);
  });

  it('UND-02: content modified after move -> skip', async () => {
    const content = 'note content';
    const modifiedContent = 'modified after move';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    const vault = new FakeVault({ [to]: modifiedContent }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'run1', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });
    await journal.complete(rec.id, testHash(content)); // postHash is original content hash

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await undoRun(deps, 'run1');

    expect(result.undone).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.reasons.length).toBeGreaterThan(0);
    // File preserved at toPath
    expect(vault.files.has(to)).toBe(true);
  });

  it('UND-02: original fromPath occupied -> skip', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    // Both exist
    const vault = new FakeVault({ [to]: content, [from]: 'different file' }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'run1', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });
    await journal.complete(rec.id, testHash(content));

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await undoRun(deps, 'run1');

    expect(result.undone).toBe(0);
    expect(result.skipped).toBe(1);
    // Both files preserved
    expect(vault.files.has(to)).toBe(true);
    expect(vault.files.has(from)).toBe(true);
  });

  it('UND-03: partial undo - one valid, one with modified content', async () => {
    const content1 = 'note 1';
    const content2 = 'note 2';
    const from1 = '0. Inbox/n1.md';
    const to1 = '1. Projects/p1/n1.md';
    const from2 = '0. Inbox/n2.md';
    const to2 = '2. Areas/a1/n2.md';

    const vault = new FakeVault({ [to1]: content1, [to2]: 'modified' }, ['0. Inbox', '1. Projects/p1', '2. Areas/a1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec1 = await journal.begin({ runId: 'run1', notePath: from1, fromPath: from1, toPath: to1, preHash: testHash(content1) });
    await journal.complete(rec1.id, testHash(content1));
    const rec2 = await journal.begin({ runId: 'run1', notePath: from2, fromPath: from2, toPath: to2, preHash: testHash(content2) });
    await journal.complete(rec2.id, testHash(content2)); // postHash is original content2 hash

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await undoRun(deps, 'run1');

    expect(result.undone).toBe(1);
    expect(result.skipped).toBe(1);
    expect(vault.files.has(from1)).toBe(true);
    expect(vault.files.has(to2)).toBe(true); // not moved back (modified)
  });

  it('UND-04: already reverted run returns undone 0', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    const vault = new FakeVault({ [from]: content }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'run1', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });
    await journal.complete(rec.id, testHash(content));
    await journal.markReverted(rec.id);

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await undoRun(deps, 'run1');

    // completed records for run1 = 0 (it's reverted)
    expect(result.undone).toBe(0);
  });

  it('UND-05: held note is not re-moved (isHeld check)', async () => {
    const content = 'note content';
    const notePath = '0. Inbox/note.md';
    const { journal } = makeRec();
    await journal.load();

    // After undo, hold is set
    await journal.hold(notePath, testHash(content));
    expect(journal.isHeld(notePath, testHash(content))).toBe(true);
    // Content changed - hold should not apply anymore
    expect(journal.isHeld(notePath, testHash('changed content'))).toBe(false);
  });

  it('null postHash is not undoable', async () => {
    const content = 'note content';
    const from = '0. Inbox/note.md';
    const to = '1. Projects/p1/note.md';
    const vault = new FakeVault({ [to]: content }, ['0. Inbox', '1. Projects/p1']);
    const { clock, journal } = makeRec();
    await journal.load();

    const rec = await journal.begin({ runId: 'run1', notePath: from, fromPath: from, toPath: to, preHash: testHash(content) });
    // Complete with null postHash
    await journal.complete(rec.id, null);

    const deps: RecoveryDeps = { vault, journal, clock };
    const result = await undoRun(deps, 'run1');

    expect(result.undone).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

