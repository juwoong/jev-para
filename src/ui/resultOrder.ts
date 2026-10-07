/** Sort display rows without changing processing order or row identity. */
export function sortByConfidence<T extends { confidence: number | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
}

const STATE_ORDER = { auto: 0, review: 1, error: 2, skipped: 3 };

export function sortResults<T extends { state: keyof typeof STATE_ORDER; confidence: number | null }>(rows: readonly T[]): T[] {
  return sortByConfidence(rows).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
}
