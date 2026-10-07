import type { ClockPort, StorePort } from '../ports';

export type MoveStatus = 'pending' | 'completed' | 'failed' | 'reverted' | 'needs-review';

export interface MoveRecord {
  id: string;
  runId: string;
  notePath: string;
  fromPath: string;
  toPath: string;
  preHash: string;
  postHash: string | null;
  status: MoveStatus;
  createdAt: number;
  updatedAt: number;
  reason?: string;
}

const STORE_KEY = 'jev-para:journal';
const STORE_VERSION = 1;

interface StoredJournal {
  version: number;
  records: MoveRecord[];
  holds: Record<string, string>;
}

export class Journal {
  private records: MoveRecord[] = [];
  private holds = new Map<string, string>();
  private readonly maxCompletedRuns: number;

  constructor(private readonly input: { store: StorePort; clock: ClockPort; maxCompletedRuns?: number }) {
    this.maxCompletedRuns = input.maxCompletedRuns ?? 100;
  }

  async load(): Promise<void> {
    const raw = await this.input.store.get<StoredJournal>(STORE_KEY);
    if (raw === null) {
      this.records = [];
      this.holds = new Map();
      return;
    }
    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as StoredJournal).records)) {
      throw new Error('stored journal is corrupt');
    }
    const stored = raw as StoredJournal;
    this.records = stored.records;
    this.holds = new Map(Object.entries(stored.holds ?? {}));
  }

  private async save(): Promise<void> {
    const data: StoredJournal = {
      version: STORE_VERSION,
      records: this.records,
      holds: Object.fromEntries(this.holds),
    };
    await this.input.store.set(STORE_KEY, data);
  }

  all(): MoveRecord[] {
    return [...this.records];
  }

  byRun(runId: string): MoveRecord[] {
    return this.records.filter((r) => r.runId === runId);
  }

  pending(): MoveRecord[] {
    return this.records.filter((r) => r.status === 'pending');
  }

  lastRunId(): string | null {
    if (this.records.length === 0) return null;
    return this.records[this.records.length - 1].runId;
  }

  async begin(input: { runId: string; notePath: string; fromPath: string; toPath: string; preHash: string }): Promise<MoveRecord> {
    const now = this.input.clock.now();
    const id = input.runId + '-' + now + '-' + Math.random().toString(36).slice(2, 8);
    const record: MoveRecord = {
      id,
      runId: input.runId,
      notePath: input.notePath,
      fromPath: input.fromPath,
      toPath: input.toPath,
      preHash: input.preHash,
      postHash: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.records.push(record);
    await this.save();
    return record;
  }

  async complete(id: string, postHash: string | null): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error('record not found: ' + id);
    record.postHash = postHash;
    record.status = 'completed';
    record.updatedAt = this.input.clock.now();
    await this.save();
  }

  async fail(id: string, reason: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error('record not found: ' + id);
    record.status = 'failed';
    record.reason = reason;
    record.updatedAt = this.input.clock.now();
    await this.save();
  }

  async needsReview(id: string, reason: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error('record not found: ' + id);
    record.status = 'needs-review';
    record.reason = reason;
    record.updatedAt = this.input.clock.now();
    await this.save();
  }

  async markReverted(id: string): Promise<void> {
    const record = this.records.find((r) => r.id === id);
    if (!record) throw new Error('record not found: ' + id);
    record.status = 'reverted';
    record.updatedAt = this.input.clock.now();
    await this.save();
  }

  isHeld(notePath: string, noteHash: string): boolean {
    return this.holds.get(notePath) === noteHash;
  }

  async hold(notePath: string, noteHash: string): Promise<void> {
    this.holds.set(notePath, noteHash);
    await this.save();
  }

  async releaseHold(notePath: string): Promise<void> {
    this.holds.delete(notePath);
    await this.save();
  }

  async prune(): Promise<void> {
    const pending = this.records.filter((r) => r.status === 'pending');
    const nonPending = this.records.filter((r) => r.status !== 'pending');

    const runOrder: string[] = [];
    const seen = new Set<string>();
    for (const r of [...nonPending].reverse()) {
      if (!seen.has(r.runId)) {
        runOrder.push(r.runId);
        seen.add(r.runId);
      }
    }
    const keepRunIds = new Set(runOrder.slice(0, this.maxCompletedRuns));
    const keptNonPending = nonPending.filter((r) => keepRunIds.has(r.runId));

    this.records = [...pending, ...keptNonPending];
    await this.save();
  }
}

