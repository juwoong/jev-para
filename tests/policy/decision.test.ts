import { describe, it, expect } from 'vitest';
import {
  validateThresholds,
  collectEvidence,
  decideMove,
  type Thresholds,
} from '../../src/policy/decision';
import { REFUSAL_ID } from '../../src/ports';

const BASE: Thresholds = { minConfidence: 0.80, minProbability: 0.80, minMargin: 0.20 };

const idToFolderPath: Record<string, string | null> = {
  p1: '1. Projects/서비스 출시',
  a1: '2. Areas/건강',
  r1: '3. Resources/AI 에이전트',
  [REFUSAL_ID]: null,
};

const H_PROBS = { p1: 0.90, a1: 0.03, r1: 0.02, [REFUSAL_ID]: 0.05 };
const H_CHOICE = 'p1';
const H_CONFIDENCE = 0.90;

describe('validateThresholds', () => {
  it('DEC-08 accepts valid thresholds on boundary', () => {
    expect(validateThresholds({ minConfidence: 0, minProbability: 0, minMargin: 0 })).toEqual({ ok: true });
    expect(validateThresholds({ minConfidence: 1, minProbability: 1, minMargin: 1 })).toEqual({ ok: true });
    expect(validateThresholds(BASE)).toEqual({ ok: true });
  });

  it('DEC-08 rejects NaN in minConfidence', () => {
    const r = validateThresholds({ minConfidence: NaN, minProbability: 0.8, minMargin: 0.2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/confidence/i);
  });

  it('DEC-08 rejects Infinity in minProbability', () => {
    const r = validateThresholds({ minConfidence: 0.8, minProbability: Infinity, minMargin: 0.2 });
    expect(r.ok).toBe(false);
  });

  it('DEC-08 rejects negative minConfidence', () => {
    const r = validateThresholds({ minConfidence: -0.1, minProbability: 0.8, minMargin: 0.2 });
    expect(r.ok).toBe(false);
  });

  it('DEC-08 rejects minMargin above 1', () => {
    const r = validateThresholds({ minConfidence: 0.8, minProbability: 0.8, minMargin: 1.1 });
    expect(r.ok).toBe(false);
  });

  it('DEC-08 rejects string cast as number', () => {
    const r = validateThresholds({ minConfidence: '0.8' as unknown as number, minProbability: 0.8, minMargin: 0.2 });
    expect(r.ok).toBe(false);
  });
});

describe('collectEvidence', () => {
  it('top is sorted descending by probability', () => {
    const ev = collectEvidence({ probabilities: H_PROBS, idToFolderPath });
    expect(ev.top[0].id).toBe('p1');
    expect(ev.top[0].probability).toBe(0.90);
    const probs = ev.top.map((c) => c.probability);
    expect(probs[0]).toBeGreaterThanOrEqual(probs[1]);
  });

  it('default limit is 3', () => {
    const probs = { p1: 0.5, a1: 0.3, r1: 0.1, [REFUSAL_ID]: 0.1 };
    const ev = collectEvidence({ probabilities: probs, idToFolderPath });
    expect(ev.top.length).toBe(3);
  });

  it('respects custom limit', () => {
    const ev = collectEvidence({ probabilities: H_PROBS, idToFolderPath, limit: 2 });
    expect(ev.top.length).toBe(2);
  });

  it('folds folderPath from idToFolderPath for known id', () => {
    const ev = collectEvidence({ probabilities: H_PROBS, idToFolderPath });
    const p1Entry = ev.top.find((c) => c.id === 'p1');
    expect(p1Entry?.folderPath).toBe('1. Projects/서비스 출시');
  });

  it('folderPath is null for REFUSAL_ID', () => {
    const probs = { [REFUSAL_ID]: 0.99, p1: 0.01 };
    const ev = collectEvidence({ probabilities: probs, idToFolderPath, limit: 1 });
    expect(ev.top[0].folderPath).toBeNull();
  });

  it('folderPath is null for unknown id', () => {
    const ev = collectEvidence({ probabilities: { unknown_id: 0.99, p1: 0.01 }, idToFolderPath, limit: 1 });
    expect(ev.top[0].folderPath).toBeNull();
  });

  it('probability field equals top[0].probability', () => {
    const ev = collectEvidence({ probabilities: H_PROBS, idToFolderPath });
    expect(ev.probability).toBe(ev.top[0].probability);
  });

  it('probability is null when probabilities is empty', () => {
    const ev = collectEvidence({ probabilities: {}, idToFolderPath });
    expect(ev.probability).toBeNull();
    expect(ev.top).toHaveLength(0);
  });
});

describe('decideMove', () => {
  it('DEC-01 H response with default thresholds auto', () => {
    const result = decideMove({ choice: H_CHOICE, confidence: H_CONFIDENCE, probabilities: H_PROBS, thresholds: BASE });
    expect(result.state).toBe('auto');
  });

  it('DEC-02 boundary confidence=0.80 probability=0.80 auto inclusive', () => {
    const result = decideMove({
      choice: 'p1', confidence: 0.80,
      probabilities: { p1: 0.80, a1: 0.10, r1: 0.05, [REFUSAL_ID]: 0.05 },
      thresholds: BASE,
    });
    expect(result.state).toBe('auto');
  });

  it('DEC-03 confidence 0.7999 review mentions confidence', () => {
    const result = decideMove({ choice: H_CHOICE, confidence: 0.7999, probabilities: H_PROBS, thresholds: BASE });
    expect(result.state).toBe('review');
    expect(result.reason).toMatch(/confidence/i);
  });

  it('DEC-04 probability 0.7999 review mentions probability', () => {
    const result = decideMove({
      choice: 'p1', confidence: 0.90,
      probabilities: { p1: 0.7999, a1: 0.1001, r1: 0.05, [REFUSAL_ID]: 0.05 },
      thresholds: BASE,
    });
    expect(result.state).toBe('review');
    expect(result.reason).toMatch(/probability/i);
  });

  it('DEC-05 equal top probabilities review even when thresholds are 0', () => {
    const result = decideMove({
      choice: 'p1', confidence: 0.50,
      probabilities: { p1: 0.50, a1: 0.50 },
      thresholds: { minConfidence: 0, minProbability: 0, minMargin: 0 },
    });
    expect(result.state).toBe('review');
    expect(result.reason).toMatch(/margin|tied/i);
  });

  it('DEC-06a p1=0.60 a1=0.40 prob=0.50 margin=0.20 auto', () => {
    const result = decideMove({
      choice: 'p1', confidence: 0.90,
      probabilities: { p1: 0.60, a1: 0.40 },
      thresholds: { minConfidence: 0.80, minProbability: 0.50, minMargin: 0.20 },
    });
    expect(result.state).toBe('auto');
  });

  it('DEC-06b p1=0.5999 a1=0.4001 margin 0.1998 review no rounding', () => {
    const result = decideMove({
      choice: 'p1', confidence: 0.90,
      probabilities: { p1: 0.5999, a1: 0.4001 },
      thresholds: { minConfidence: 0.80, minProbability: 0.50, minMargin: 0.20 },
    });
    expect(result.state).toBe('review');
    expect(result.reason).toMatch(/margin|tied/i);
  });

  it('DEC-07 REFUSAL_ID choice always review', () => {
    const result = decideMove({
      choice: REFUSAL_ID, confidence: 1.0,
      probabilities: { [REFUSAL_ID]: 1.0, p1: 0.0 },
      thresholds: BASE,
    });
    expect(result.state).toBe('review');
  });

  it('null confidence review mentions confidence', () => {
    const result = decideMove({ choice: 'p1', confidence: null, probabilities: H_PROBS, thresholds: BASE });
    expect(result.state).toBe('review');
    expect(result.reason).toMatch(/confidence/i);
  });

  it('NaN confidence review', () => {
    const result = decideMove({ choice: 'p1', confidence: NaN, probabilities: H_PROBS, thresholds: BASE });
    expect(result.state).toBe('review');
  });

  it('single candidate margin vs 0 passes when p1=0.90 minMargin=0.20', () => {
    const result = decideMove({
      choice: 'p1', confidence: 0.90,
      probabilities: { p1: 0.90 },
      thresholds: BASE,
    });
    expect(result.state).toBe('auto');
  });
});
