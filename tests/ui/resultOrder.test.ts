import { describe, expect, it } from 'vitest';
import { sortByConfidence } from '../../src/ui/resultOrder';

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
