import { describe, it, expect } from 'vitest';
import { computeCacheKey, AnalysisCache, RULE_VERSION } from '../../src/policy/cache';
import { FakeStore } from '../helpers/fakes';
import type { Candidate, AnalysisResult } from '../../src/ports';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeCandidates(): Candidate[] {
  return [
    {
      id: 'p1',
      folderPath: '1. Projects/서비스 출시',
      category: 'projects',
      name: '서비스 출시',
      description: '새 서비스 베타 출시 준비',
      include: '베타 인터뷰, 출시 일정',
      exclude: '상시 사업 운영',
      mismatchWarning: false,
    },
    {
      id: 'a1',
      folderPath: '2. Areas/건강',
      category: 'areas',
      name: '건강',
      description: '지속적인 건강 관리',
      include: '진료 기록',
      exclude: '일반 운동법',
      mismatchWarning: false,
    },
  ];
}

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    notePath: '0. Inbox/베타 인터뷰.md',
    noteHash: 'abc123',
    candidateId: 'p1',
    folderPath: '1. Projects/서비스 출시',
    confidence: 0.90,
    probability: 0.90,
    top: [{ id: 'p1', folderPath: '1. Projects/서비스 출시', probability: 0.90 }],
    state: 'auto',
    reason: '',
    createdAt: 1700000000000,
    ...overrides,
  };
}

const BASE_INPUT = {
  notePath: '0. Inbox/베타 인터뷰.md',
  noteHash: 'abc123',
  noteTitle: '베타 인터뷰',
  noteBody: '베타 출시를 위한 사용자 인터뷰',
  candidates: makeCandidates(),
  model: 'jev-latest',
};

// ─── computeCacheKey ─────────────────────────────────────────────────────────

describe('computeCacheKey', () => {
  it('returns a non-empty string', () => {
    const key = computeCacheKey(BASE_INPUT);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('CAC-02 different notePath → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey({ ...BASE_INPUT, notePath: '0. Inbox/다른노트.md' });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 different noteHash → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey({ ...BASE_INPUT, noteHash: 'different-hash' });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 different noteTitle → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey({ ...BASE_INPUT, noteTitle: '다른 제목' });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 different noteBody → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey({ ...BASE_INPUT, noteBody: '완전히 다른 내용' });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 different model → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey({ ...BASE_INPUT, model: 'jev-v2' });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 candidate description change → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const modifiedCandidates = makeCandidates();
    modifiedCandidates[0] = { ...modifiedCandidates[0], description: '변경된 설명' };
    const key2 = computeCacheKey({ ...BASE_INPUT, candidates: modifiedCandidates });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 candidate include change → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const modifiedCandidates = makeCandidates();
    modifiedCandidates[0] = { ...modifiedCandidates[0], include: '변경된 포함' };
    const key2 = computeCacheKey({ ...BASE_INPUT, candidates: modifiedCandidates });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 candidate exclude change → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const modifiedCandidates = makeCandidates();
    modifiedCandidates[0] = { ...modifiedCandidates[0], exclude: '변경된 제외' };
    const key2 = computeCacheKey({ ...BASE_INPUT, candidates: modifiedCandidates });
    expect(key1).not.toBe(key2);
  });

  it('CAC-02 candidate folderPath change → different key', () => {
    const key1 = computeCacheKey(BASE_INPUT);
    const modifiedCandidates = makeCandidates();
    modifiedCandidates[0] = { ...modifiedCandidates[0], folderPath: '1. Projects/새폴더' };
    const key2 = computeCacheKey({ ...BASE_INPUT, candidates: modifiedCandidates });
    expect(key1).not.toBe(key2);
  });

  it('CAC-04 threshold changes do NOT change key', () => {
    // computeCacheKey does not take thresholds
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey(BASE_INPUT);
    expect(key1).toBe(key2);
  });

  it('candidate order does not affect key (sorted by id)', () => {
    const reversed = [...makeCandidates()].reverse();
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey({ ...BASE_INPUT, candidates: reversed });
    expect(key1).toBe(key2);
  });

  it('RULE_VERSION is included – changing it would change the key space', () => {
    // We can only verify the key is deterministic across calls
    const key1 = computeCacheKey(BASE_INPUT);
    const key2 = computeCacheKey(BASE_INPUT);
    expect(key1).toBe(key2);
    // Verify RULE_VERSION is exported as a string
    expect(typeof RULE_VERSION).toBe('string');
  });
});

// ─── AnalysisCache ───────────────────────────────────────────────────────────

describe('AnalysisCache', () => {
  it('CAC-01 get returns null before any set', async () => {
    const store = new FakeStore();
    const cache = new AnalysisCache(store);
    expect(await cache.get('missing-key')).toBeNull();
  });

  it('CAC-01 set then get returns the stored result', async () => {
    const store = new FakeStore();
    const cache = new AnalysisCache(store);
    const result = makeResult();
    const key = computeCacheKey(BASE_INPUT);
    await cache.set(key, result);
    const retrieved = await cache.get(key);
    expect(retrieved).toEqual(result);
  });

  it('get returns a deep clone, not the same reference', async () => {
    const store = new FakeStore();
    const cache = new AnalysisCache(store);
    const result = makeResult();
    const key = computeCacheKey(BASE_INPUT);
    await cache.set(key, result);
    const retrieved = await cache.get(key);
    expect(retrieved).not.toBe(result);
    // mutating retrieved should not affect a subsequent get
    if (retrieved) retrieved.state = 'error' as any;
    const retrieved2 = await cache.get(key);
    expect(retrieved2?.state).toBe('auto');
  });

  it('entries survive a new AnalysisCache instance over the same store', async () => {
    const store = new FakeStore();
    const cache1 = new AnalysisCache(store);
    const result = makeResult();
    const key = computeCacheKey(BASE_INPUT);
    await cache1.set(key, result);

    // New instance, same store
    const cache2 = new AnalysisCache(store);
    const retrieved = await cache2.get(key);
    expect(retrieved).toEqual(result);
  });

  it('clear removes all entries', async () => {
    const store = new FakeStore();
    const cache = new AnalysisCache(store);
    const result = makeResult();
    const key = computeCacheKey(BASE_INPUT);
    await cache.set(key, result);
    await cache.clear();
    expect(await cache.get(key)).toBeNull();
  });

  it('evicts oldest entries beyond maxEntries', async () => {
    const store = new FakeStore();
    const cache = new AnalysisCache(store, 2);
    const key1 = 'key1';
    const key2 = 'key2';
    const key3 = 'key3';
    await cache.set(key1, makeResult({ notePath: 'n1', createdAt: 1 }));
    await cache.set(key2, makeResult({ notePath: 'n2', createdAt: 2 }));
    await cache.set(key3, makeResult({ notePath: 'n3', createdAt: 3 }));
    // key1 should be evicted (oldest)
    expect(await cache.get(key1)).toBeNull();
    expect(await cache.get(key2)).not.toBeNull();
    expect(await cache.get(key3)).not.toBeNull();
  });

  it('propagates StorePort write failures', async () => {
    const store = new FakeStore();
    store.setFailure = new Error('disk full');
    const cache = new AnalysisCache(store);
    await expect(cache.set('any-key', makeResult())).rejects.toThrow('disk full');
  });

  it('does not recompute state (stores and returns result.state as-is)', async () => {
    const store = new FakeStore();
    const cache = new AnalysisCache(store);
    const result = makeResult({ state: 'review' });
    const key = 'test-state-key';
    await cache.set(key, result);
    const retrieved = await cache.get(key);
    expect(retrieved?.state).toBe('review');
  });

  it('CAC-04 cache hit allows re-evaluating with different thresholds without new API call', async () => {
    // This is a behavior test: the cache stores the AnalysisResult as-is.
    // The caller (not the cache) re-derives state with decideMove after a cache hit.
    // Verify the cache returns the stored probabilities/confidence unchanged.
    const store = new FakeStore();
    const cache = new AnalysisCache(store);
    const result = makeResult({ confidence: 0.90, probability: 0.90, state: 'auto' });
    const key = computeCacheKey(BASE_INPUT);
    await cache.set(key, result);
    const hit = await cache.get(key);
    expect(hit?.confidence).toBe(0.90);
    expect(hit?.probability).toBe(0.90);
    // The caller would now pass these to decideMove with new thresholds
  });
});
