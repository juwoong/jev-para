import { describe, it, expect } from 'vitest';
import { validateAnswer } from '../../src/jev/validate';
import { QUESTION_ID, REFUSAL_ID } from '../../src/ports';

const VALID_IDS = ['p1', 'a1', 'r1', REFUSAL_ID];

function makeRaw(overrides: Record<string, unknown> = {}): unknown {
  return {
    model: 'jev-latest',
    answers: {
      [QUESTION_ID]: {
        type: 'choice',
        choice: 'p1',
        confidence: 0.9,
        probabilities: { p1: 0.9, a1: 0.03, r1: 0.02, [REFUSAL_ID]: 0.05 },
      },
    },
    usage: {},
    ...overrides,
  };
}

describe('validateAnswer', () => {
  it('API-05: accepts a valid response', () => {
    const result = validateAnswer(makeRaw(), { validIds: VALID_IDS });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answer.choice).toBe('p1');
      expect(result.answer.confidence).toBe(0.9);
      expect(result.answer.probabilities['p1']).toBe(0.9);
    }
  });

  it('API-05: fails when not an object', () => {
    const result = validateAnswer('string', { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-05: fails when answers is missing', () => {
    const result = validateAnswer({ model: 'x' }, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-05: fails when QUESTION_ID entry is missing', () => {
    const raw = makeRaw({ answers: {} });
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-05: fails when type is not choice', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].type = 'numeric';
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-04: fails when choice is not in validIds', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].choice = 'unknown_id';
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-04: fails when choice is an absolute path', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].choice = '/absolute/path';
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-04: fails when choice contains path traversal', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].choice = '../escape';
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-05: fails when confidence is missing for selected option', () => {
    const raw = makeRaw();
    delete (raw as any).answers[QUESTION_ID].confidence;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('contract');
  });

  it('API-05: fails when confidence is NaN', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].confidence = NaN;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: fails when confidence is below 0', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].confidence = -0.1;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: fails when confidence is above 1', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].confidence = 1.1;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: fails when a probability is missing', () => {
    const raw = makeRaw();
    delete (raw as any).answers[QUESTION_ID].probabilities['a1'];
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: fails when a probability is negative', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].probabilities['a1'] = -0.01;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: fails when a probability is greater than 1', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].probabilities['p1'] = 1.1;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: fails when probabilities sum deviates from 1 by more than 1e-6', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].probabilities = { p1: 0.5, a1: 0.3, r1: 0.1, [REFUSAL_ID]: 0.05 }; // sum=0.95
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: accepts probabilities summing exactly to 1', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].probabilities = { p1: 0.25, a1: 0.25, r1: 0.25, [REFUSAL_ID]: 0.25 };
    (raw as any).answers[QUESTION_ID].choice = 'p1'; // tie allowed at this layer
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(true);
  });

  it('API-05: fails when a probability key is not in validIds', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].probabilities['unknown_candidate'] = 0.01;
    // adjust sum
    (raw as any).answers[QUESTION_ID].probabilities['p1'] = 0.89;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });

  it('API-05: allows tied max probabilities (policy layer concern)', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].probabilities = { p1: 0.5, a1: 0.5, r1: 0, [REFUSAL_ID]: 0 };
    (raw as any).answers[QUESTION_ID].choice = 'p1';
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(true);
  });

  it('API-05: fails when confidence is non-finite (Infinity)', () => {
    const raw = makeRaw();
    (raw as any).answers[QUESTION_ID].confidence = Infinity;
    const result = validateAnswer(raw, { validIds: VALID_IDS });
    expect(result.ok).toBe(false);
  });
});

