/** Sort display rows without changing processing order or row identity. */
export function sortByConfidence<T extends { confidence: number | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
}
