import { describe, expect, it } from 'vitest';
import { sortByConfidence, sortResults } from '../../src/ui/resultOrder';

describe('result display order', () => {
  it('sorts by raw confidence, keeps ties stable, and places missing confidence after zero', () => {
    const rows = [
      { id: 'missing', confidence: null },
      { id: 'lower', confidence: 0.901 },
      { id: 'zero', confidence: 0 },
      { id: 'higher', confidence: 0.904 },
      { id: 'tie', confidence: 0.904 },
    ];
    const original = [...rows];
    const sorted = sortByConfidence(rows);
    expect(sorted.map(row => row.id)).toEqual(['higher', 'tie', 'lower', 'zero', 'missing']);
    expect(rows).toEqual(original);
    expect(sorted[0]).toBe(rows[3]);
  });
});

it('groups ready, review, error, skipped before sorting confidence within each group', () => {
  const rows = [
    { state: 'error' as const, confidence: null },
    { state: 'review' as const, confidence: 1 },
    { state: 'skipped' as const, confidence: null },
    { state: 'auto' as const, confidence: 0.8 },
    { state: 'auto' as const, confidence: 0.99 },
  ];
  expect(sortResults(rows)).toEqual([rows[4], rows[3], rows[1], rows[0], rows[2]]);
});
