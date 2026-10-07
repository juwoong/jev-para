import type { StorePort, AnalysisResult, Candidate } from '../ports';
import { contentHash } from '../hash';

export const RULE_VERSION = '1';

const STORE_KEY = 'jev-para:cache';

type CacheMap = Record<string, { result: AnalysisResult; insertedAt: number }>;

export function computeCacheKey(input: {
  notePath: string;
  noteHash: string;
  noteTitle: string;
  noteBody: string;
  candidates: Candidate[];
  model: string;
}): string {
  const { notePath, noteHash, noteTitle, noteBody, candidates, model } = input;

  const sortedCandidates = [...candidates]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => [c.id, c.folderPath, c.description, c.include, c.exclude].join('\x00'));

  const parts = [
    'v:' + RULE_VERSION,
    'path:' + notePath,
    'hash:' + noteHash,
    'title:' + noteTitle,
    'body:' + noteBody,
    'model:' + model,
    'candidates:' + sortedCandidates.join('\x01'),
  ];

  return contentHash(parts.join('\x02'));
}

export class AnalysisCache {
  private readonly store: StorePort;
  private readonly maxEntries: number;
  private counter: number = 0;

  constructor(store: StorePort, maxEntries = 200) {
    this.store = store;
    this.maxEntries = maxEntries;
  }

  async get(key: string): Promise<AnalysisResult | null> {
    const map = await this.loadMap();
    const entry = map[key];
    if (!entry) return null;
    // Return a deep clone so callers cannot mutate cached state
    return JSON.parse(JSON.stringify(entry.result)) as AnalysisResult;
  }

  async set(key: string, result: AnalysisResult): Promise<void> {
    const map = await this.loadMap();
    this.counter += 1;
    map[key] = { result: JSON.parse(JSON.stringify(result)) as AnalysisResult, insertedAt: this.counter };

    // Evict oldest entries beyond maxEntries
    const keys = Object.keys(map);
    if (keys.length > this.maxEntries) {
      const sorted = keys.sort((a, b) => map[a].insertedAt - map[b].insertedAt);
      const toRemove = sorted.slice(0, keys.length - this.maxEntries);
      for (const k of toRemove) {
        delete map[k];
      }
    }

    // Propagate write failures to caller
    await this.store.set<CacheMap>(STORE_KEY, map);
  }

  async clear(): Promise<void> {
    await this.store.set<CacheMap>(STORE_KEY, {});
  }

  private async loadMap(): Promise<CacheMap> {
    const stored = await this.store.get<CacheMap>(STORE_KEY);
    return stored ?? {};
  }
}
