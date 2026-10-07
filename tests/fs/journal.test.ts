import { describe, it, expect, beforeEach } from 'vitest';
import { Journal } from '../../src/fs/journal';
import { FakeStore, FakeClock } from '../helpers/fakes';

function makeJournal(opts?: { maxCompletedRuns?: number }) {
  const store = new FakeStore();
  const clock = new FakeClock(1_700_000_000_000);
  const journal = new Journal({ store, clock, ...opts });
  return { store, clock, journal };
}

describe('Journal', () => {
  describe('load', () => {
    it('tolerates missing key', async () => {
      const { journal } = makeJournal();
      await expect(journal.load()).resolves.not.toThrow();
      expect(journal.all()).toEqual([]);
    });

    it('throws on corrupt JSON', async () => {
      const { store, journal } = makeJournal();
      await store.set('jev-para:journal', { version: 1, records: 'not-an-array', holds: {} });
      await expect(journal.load()).rejects.toThrow();
    });

    it('restores records and holds', async () => {
      const { store, clock } = makeJournal();
      const j2 = new Journal({ store, clock });
      await j2.load();
      const rec = await j2.begin({ runId: 'r1', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/p/a.md', preHash: 'h1' });
      await j2.hold('0. Inbox/a.md', 'h1');

      // New journal instance loading from same store
      const j3 = new Journal({ store, clock });
      await j3.load();
      expect(j3.all()).toHaveLength(1);
      expect(j3.isHeld('0. Inbox/a.md', 'h1')).toBe(true);
    });
  });

  describe('begin / complete / fail / needsReview / markReverted', () => {
    it('MOV-01: begin creates a pending record persisted to store', async () => {
      const { store, journal } = makeJournal();
      await journal.load();
      const rec = await journal.begin({
        runId: 'run1',
        notePath: '0. Inbox/note.md',
        fromPath: '0. Inbox/note.md',
        toPath: '1. Projects/p1/note.md',
        preHash: 'abc123',
      });
      expect(rec.status).toBe('pending');
      expect(rec.runId).toBe('run1');
      expect(rec.preHash).toBe('abc123');
      expect(rec.postHash).toBeNull();
      // Persisted
      const raw = await store.get('jev-para:journal');
      expect(raw).not.toBeNull();
    });

    it('complete sets status and postHash', async () => {
      const { journal } = makeJournal();
      await journal.load();
      const rec = await journal.begin({ runId: 'r', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
      await journal.complete(rec.id, 'h2');
      const updated = journal.all().find((r) => r.id === rec.id);
      expect(updated?.status).toBe('completed');
      expect(updated?.postHash).toBe('h2');
    });

    it('fail sets status and reason', async () => {
      const { journal } = makeJournal();
      await journal.load();
      const rec = await journal.begin({ runId: 'r', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
      await journal.fail(rec.id, 'disk error');
      const updated = journal.all().find((r) => r.id === rec.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.reason).toBe('disk error');
    });

    it('needsReview sets status', async () => {
      const { journal } = makeJournal();
      await journal.load();
      const rec = await journal.begin({ runId: 'r', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
      await journal.needsReview(rec.id, 'ambiguous');
      const updated = journal.all().find((r) => r.id === rec.id);
      expect(updated?.status).toBe('needs-review');
    });

    it('markReverted sets status', async () => {
      const { journal } = makeJournal();
      await journal.load();
      const rec = await journal.begin({ runId: 'r', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
      await journal.complete(rec.id, 'h2');
      await journal.markReverted(rec.id);
      const updated = journal.all().find((r) => r.id === rec.id);
      expect(updated?.status).toBe('reverted');
    });
  });

  describe('byRun / pending / lastRunId', () => {
    it('byRun returns only records for that run', async () => {
      const { journal } = makeJournal();
      await journal.load();
      await journal.begin({ runId: 'r1', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
      await journal.begin({ runId: 'r2', notePath: '0. Inbox/b.md', fromPath: '0. Inbox/b.md', toPath: '1. Projects/x/b.md', preHash: 'h' });
      expect(journal.byRun('r1')).toHaveLength(1);
      expect(journal.byRun('r2')).toHaveLength(1);
    });

    it('pending returns only pending records', async () => {
      const { journal } = makeJournal();
      await journal.load();
      const rec = await journal.begin({ runId: 'r', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
      await journal.complete(rec.id, 'h2');
      await journal.begin({ runId: 'r', notePath: '0. Inbox/b.md', fromPath: '0. Inbox/b.md', toPath: '1. Projects/x/b.md', preHash: 'h' });
      expect(journal.pending()).toHaveLength(1);
    });

    it('lastRunId returns most recent runId', async () => {
      const { journal } = makeJournal();
      await journal.load();
      expect(journal.lastRunId()).toBeNull();
      await journal.begin({ runId: 'r1', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
      await journal.begin({ runId: 'r2', notePath: '0. Inbox/b.md', fromPath: '0. Inbox/b.md', toPath: '1. Projects/x/b.md', preHash: 'h' });
      expect(journal.lastRunId()).toBe('r2');
    });
  });

  describe('isHeld / hold / releaseHold', () => {
    it('UND-05: isHeld returns true only when hash matches', async () => {
      const { journal } = makeJournal();
      await journal.load();
      await journal.hold('0. Inbox/a.md', 'hash1');
      expect(journal.isHeld('0. Inbox/a.md', 'hash1')).toBe(true);
      expect(journal.isHeld('0. Inbox/a.md', 'hash2')).toBe(false);
      expect(journal.isHeld('0. Inbox/b.md', 'hash1')).toBe(false);
    });

    it('releaseHold removes hold', async () => {
      const { journal } = makeJournal();
      await journal.load();
      await journal.hold('0. Inbox/a.md', 'hash1');
      await journal.releaseHold('0. Inbox/a.md');
      expect(journal.isHeld('0. Inbox/a.md', 'hash1')).toBe(false);
    });
  });

  describe('prune - REC-04', () => {
    it('REC-04: keeps at most maxCompletedRuns runs, never drops pending', async () => {
      const { journal } = makeJournal({ maxCompletedRuns: 2 });
      await journal.load();

      // Add 3 completed runs
      for (let i = 1; i <= 3; i++) {
        const rec = await journal.begin({ runId: 'run' + i, notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' });
        await journal.complete(rec.id, 'h2');
      }

      // Add a pending record
      await journal.begin({ runId: 'run-pending', notePath: '0. Inbox/b.md', fromPath: '0. Inbox/b.md', toPath: '1. Projects/x/b.md', preHash: 'h' });

      await journal.prune();

      const all = journal.all();
      const pending = all.filter((r) => r.status === 'pending');
      const nonPending = all.filter((r) => r.status !== 'pending');
      const runIds = new Set(nonPending.map((r) => r.runId));

      expect(pending).toHaveLength(1);
      expect(runIds.size).toBeLessThanOrEqual(2);
      // Should keep most recent (run2, run3)
      expect(runIds.has('run3')).toBe(true);
      expect(runIds.has('run2')).toBe(true);
      expect(runIds.has('run1')).toBe(false);
    });

    it('MOV-05 / MOV-06 store setFailure propagates', async () => {
      const { store, journal } = makeJournal();
      await journal.load();
      store.setFailure = new Error('disk full');
      await expect(
        journal.begin({ runId: 'r', notePath: '0. Inbox/a.md', fromPath: '0. Inbox/a.md', toPath: '1. Projects/x/a.md', preHash: 'h' })
      ).rejects.toThrow('disk full');
    });
  });
});

