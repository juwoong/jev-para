import { AnalysisCache, computeCacheKey } from './policy/cache';
import { decideMove, type Thresholds } from './policy/decision';
import { JevClient } from './jev/client';
import { Journal } from './fs/journal';
import { moveMany, type MovePlan } from './fs/mover';
import { recoverPending, undoRun } from './fs/recovery';
import {
  baseName,
  collectCandidates,
  ensureIndex,
  ensureIndexesForVault,
  ensureParaRoots,
  isDirectChildPath,
  isExcludedFolderPath,
  isReservedIndexFile,
  listInboxScope,
  parentPath,
} from './para/index';
import {
  INBOX_ROOT,
  PARA_CATEGORIES,
  PARA_ROOTS,
  REFUSAL_ID,
  errorMessage,
  type ApiKeyStorePort,
  type AnalysisResult,
  type Candidate,
  type ClockPort,
  type HttpPort,
  type JevParaSettings,
  type KeyLoadResult,
  type ParaCategory,
  type StorePort,
  type TimerPort,
  type VaultPort,
} from './ports';

export interface OrchestratorDeps {
  vault: VaultPort;
  http: HttpPort;
  store: StorePort;
  clock: ClockPort & TimerPort;
  keyStore: ApiKeyStorePort;
  getSettings: () => JevParaSettings;
  sleep: (ms: number) => Promise<void>;
  isActiveEditor?: (path: string) => boolean;
  logDebug?: (message: string) => void;
  logError?: (message: string) => void;
}

export interface OrchestratorSnapshot {
  results: AnalysisResult[];
  candidates: Candidate[];
  key: KeyLoadResult;
  keySecure: boolean;
  keyTest: { ok: boolean; message: string; at: number } | null;
  autoPaused: boolean;
  running: boolean;
  lastRunId: string | null;
  canUndo: boolean;
  inbox: { notes: number; unsupported: number; nested: number };
  pending: number;
}

export interface MoveSummary {
  moved: number;
  failed: number;
  runId: string | null;
}

export class Orchestrator {
  private readonly deps: OrchestratorDeps;
  private readonly journal: Journal;
  private readonly cache: AnalysisCache;
  private readonly client: JevClient;
  private readonly listeners = new Set<(snapshot: OrchestratorSnapshot) => void>();
  private readonly results = new Map<string, AnalysisResult>();
  private readonly settleTimers = new Map<string, number>();
  private readonly queued = new Set<string>();
  private candidates: Candidate[] = [];
  private key: KeyLoadResult = { ok: false, key: null, message: 'Token has not been loaded yet.' };
  private inbox = { notes: 0, unsupported: 0, nested: 0 };
  private autoPaused = false;
  private keyTest: { ok: boolean; message: string; at: number } | null = null;
  private running = false;
  private lastRunId: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private session = 0;
  private runCounter = 0;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
    this.journal = new Journal({ store: deps.store, clock: deps.clock });
    this.cache = new AnalysisCache(deps.store);
    this.client = new JevClient({
      http: deps.http,
      clock: deps.clock,
      sleep: deps.sleep,
      logger: {
        debug: (message) => deps.logDebug?.(message),
        warn: (message) => deps.logDebug?.(message),
        error: (message) => deps.logError?.(message),
      },
    });
  }

  async init(): Promise<void> {
    await this.journal.load();
    await recoverPending({ vault: this.deps.vault, journal: this.journal, clock: this.deps.clock });
    await this.reloadKey();
    await this.refreshInboxScope();
    await this.ensureIndexes();
    this.notify();
  }

  async start(): Promise<void> {
    this.lastRunId = this.journal.lastRunId();
    if (this.deps.getSettings().mode === 'auto') {
      for (const note of await this.inboxNotes()) this.scheduleNote(note);
    }
    this.notify();
  }

  dispose(): void {
    this.session += 1;
    for (const handle of this.settleTimers.values()) this.deps.clock.clearTimeout(handle);
    this.settleTimers.clear();
    this.queued.clear();
  }

  subscribe(listener: (snapshot: OrchestratorSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): OrchestratorSnapshot {
    return {
      results: [...this.results.values()].sort((left, right) => left.notePath.localeCompare(right.notePath)),
      candidates: [...this.candidates],
      key: { ...this.key },
      keySecure: this.deps.keyStore.secure,
      keyTest: this.keyTest === null ? null : { ...this.keyTest },
      autoPaused: this.autoPaused,
      running: this.running,
      lastRunId: this.lastRunId,
      canUndo: this.canUndo(),
      inbox: { ...this.inbox },
      pending: this.settleTimers.size + this.queued.size,
    };
  }

  async reloadKey(): Promise<KeyLoadResult> {
    const settings = this.deps.getSettings();
    const stored = await this.deps.keyStore.get();
    this.key = stored === null
      ? { ok: false, key: null, message: 'Enter an API token in settings.' }
      : {
          ok: true,
          key: stored,
          message: this.deps.keyStore.secure
            ? 'Using the token saved in secret storage.'
            : 'Using the saved token (stored in data.json on this Obsidian version).',
        };
    this.client.configure(
      this.key.ok && this.key.key !== null
        ? { baseUrl: settings.baseUrl, model: settings.model, apiKey: this.key.key }
        : null,
    );
    if (this.key.ok) this.autoPaused = false;
    this.notify();
    return this.key;
  }

  /** Stores a user-typed key in the configured key store and reloads it. */
  async saveApiKey(value: string): Promise<KeyLoadResult> {
    const trimmed = value.trim();
    if (trimmed === '') return { ok: false, key: null, message: 'API token is empty.' };
    await this.deps.keyStore.set(trimmed);
    return this.reloadKey();
  }

  async clearApiKey(): Promise<KeyLoadResult> {
    await this.deps.keyStore.clear();
    return this.reloadKey();
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.key.ok) {
      const result = { ok: false, message: this.key.message };
      this.keyTest = { ...result, at: this.deps.clock.now() };
      this.notify();
      return result;
    }
    let result: { ok: boolean; message: string } = { ok: false, message: 'Cannot test the connection.' };
    await this.enqueueExclusive(async () => {
      const outcome = await this.client.testConnection();
      result = outcome.ok
        ? { ok: true, message: 'Connected to Jev successfully.' }
        : { ok: false, message: outcome.failure.message };
      this.keyTest = { ...result, at: this.deps.clock.now() };
    });
    this.notify();
    return result;
  }

  async createParaRoots(): Promise<{ created: string[]; conflicts: string[] }> {
    const outcome = await ensureParaRoots(this.deps.vault);
    const indexes = await ensureIndexesForVault(this.deps.vault);
    await this.refreshCandidates();
    this.notify();
    return { created: [...outcome.created, ...indexes.created], conflicts: outcome.conflicts };
  }

  async refreshCandidates(): Promise<void> {
    this.candidates = await collectCandidates(this.deps.vault);
  }

  async refreshInboxScope(): Promise<void> {
    const scope = await listInboxScope(this.deps.vault);
    this.inbox = { notes: scope.notes.length, unsupported: scope.unsupported.length, nested: scope.nested.length };
    this.notify();
  }

  async ensureIndexes(): Promise<string[]> {
    const outcome = await ensureIndexesForVault(this.deps.vault);
    await this.refreshCandidates();
    return outcome.created;
  }

  async analyzeAll(options: { bypassCache?: boolean } = {}): Promise<{ analyzed: number; failed: number }> {
    const notes = await this.inboxNotes();
    await this.refreshInboxScope();
    if (notes.length === 0) return { analyzed: 0, failed: 0 };
    return this.analyzeNotes(notes, options);
  }

  /** Analyzes a specific note set; used for targeted retries of failed rows. */
  async analyzeNotes(
    notePaths: string[],
    options: { bypassCache?: boolean } = {},
  ): Promise<{ analyzed: number; failed: number }> {
    if (!this.key.ok) {
      this.notify();
      return { analyzed: 0, failed: 0 };
    }
    if (notePaths.length === 0) return { analyzed: 0, failed: 0 };
    await this.refreshCandidates();
    let analyzed = 0;
    let failed = 0;
    await this.enqueueExclusive(async () => {
      for (const note of notePaths) {
        const result = await this.runAnalysis(note, { bypassCache: options.bypassCache === true });
        if (result === null) continue;
        if (result.state === 'error') failed += 1;
        else analyzed += 1;
      }
    });
    this.notify();
    return { analyzed, failed };
  }

  /** Explicit re-analysis that ignores cached results, per TEST_SCENARIOS CAC-03. */
  async reanalyzeAll(): Promise<{ analyzed: number; failed: number }> {
    return this.analyzeAll({ bypassCache: true });
  }

  async moveAllReady(): Promise<MoveSummary> {
    return this.applyMoves([...this.results.values()]
      .filter((result) => result.state === 'auto' && result.folderPath !== null)
      .map((result) => result.notePath));
  }

  async applyMoves(notePaths: string[]): Promise<MoveSummary> {
    const plans: MovePlan[] = [];
    for (const notePath of notePaths) {
      const result = this.results.get(notePath);
      if (result === undefined || result.folderPath === null) continue;
      plans.push({
        notePath,
        targetFolder: result.folderPath,
        expectedHash: result.noteHash,
        candidateId: result.candidateId,
      });
    }
    if (plans.length === 0) return { moved: 0, failed: 0, runId: null };

    let summary: MoveSummary = { moved: 0, failed: 0, runId: null };
    await this.enqueueExclusive(async () => {
      summary = await this.executeMoves(plans);
    });
    return summary;
  }

  private async executeMoves(plans: MovePlan[]): Promise<MoveSummary> {
    this.runCounter += 1;
    const runId = `run-${this.deps.clock.now()}-${this.runCounter}`;
    this.running = true;
    this.notify();
    try {
      const outcomes = await moveMany(
        {
          vault: this.deps.vault,
          journal: this.journal,
          clock: this.deps.clock,
          validCandidateIds: this.candidates.map((candidate) => candidate.id),
          validFolderPaths: this.candidates.map((candidate) => candidate.folderPath),
        },
        runId,
        plans,
      );
      let moved = 0;
      let failed = 0;
      outcomes.forEach(({ plan, outcome }, index) => {
        if (outcome.ok) {
          moved += 1;
          this.results.delete(plan.notePath);
          return;
        }
        failed += 1;
        const previous = this.results.get(plan.notePath);
        if (previous !== undefined) {
          this.results.set(plan.notePath, {
            ...previous,
            state: 'review',
            reason: outcome.failure.message,
            createdAt: this.deps.clock.now() + index,
          });
        }
      });
      this.lastRunId = moved > 0 ? runId : this.lastRunId;
      await this.refreshInboxScope();
      await this.journal.prune();
      return { moved, failed, runId: moved > 0 ? runId : null };
    } finally {
      this.running = false;
      this.notify();
    }
  }

  async undoLastRun(): Promise<{ undone: number; skipped: number; reasons: string[] }> {
    const runId = this.lastRunId;
    if (runId === null) return { undone: 0, skipped: 0, reasons: ['No run to undo.'] };
    let outcome: { undone: number; skipped: number; reasons: string[] } = { undone: 0, skipped: 0, reasons: [] };
    await this.enqueueExclusive(async () => {
      outcome = await undoRun(
        { vault: this.deps.vault, journal: this.journal, clock: this.deps.clock },
        runId,
      );
      if (outcome.undone > 0) this.lastRunId = null;
      await this.refreshInboxScope();
      this.notify();
    });
    return outcome;
  }

  setAutoPaused(paused: boolean): void {
    this.autoPaused = paused;
    this.notify();
  }

  isAutoPaused(): boolean {
    return this.autoPaused;
  }

  /** Resolves when every queued analysis task has settled; used by callers and tests. */
  async waitForIdle(): Promise<void> {
    await this.chain;
  }

  onFileChange(path: string, kind: 'create' | 'modify' | 'delete', isFolder: boolean): void {
    if (isFolder) {
      if (kind === 'create' || kind === 'modify') this.scheduleIndexFor(path);
      else void this.handleStructuralChange();
      return;
    }
    if (isReservedIndexFile(path)) {
      if (kind !== 'delete') void this.handleIndexChange(path);
      else void this.handleStructuralChange();
      return;
    }
    if (kind === 'delete') {
      this.cancel(path);
      this.results.delete(path);
      this.notify();
      return;
    }
    if (parentPath(path) === INBOX_ROOT) this.scheduleNote(path);
  }

  onFileRename(path: string, oldPath: string, isFolder: boolean): void {
    if (isFolder) {
      this.scheduleIndexFor(path);
      void this.handleStructuralChange();
      return;
    }
    this.cancel(oldPath);
    if (isReservedIndexFile(oldPath) || isReservedIndexFile(path)) {
      void this.handleIndexChange(path);
      return;
    }
    this.results.delete(oldPath);
    if (parentPath(path) === INBOX_ROOT) this.scheduleNote(path);
    this.notify();
  }

  private scheduleIndexFor(folderPath: string): void {
    const category = this.categoryForFolder(folderPath);
    if (category === null) return;
    if (isExcludedFolderPath(folderPath) || !isDirectChildPath(folderPath, PARA_ROOTS[category])) return;
    const handle = this.deps.clock.setTimeout(() => {
      this.settleTimers.delete(`idx:${folderPath}`);
      void (async () => {
        await ensureIndex(this.deps.vault, category, folderPath);
        await this.handleStructuralChange();
      })();
    }, 1000);
    const previous = this.settleTimers.get(`idx:${folderPath}`);
    if (previous !== undefined) this.deps.clock.clearTimeout(previous);
    this.settleTimers.set(`idx:${folderPath}`, handle);
  }

  private categoryForFolder(folderPath: string): ParaCategory | null {
    for (const category of PARA_CATEGORIES) {
      if (isDirectChildPath(folderPath, PARA_ROOTS[category])) return category;
    }
    return null;
  }

  private async handleIndexChange(path: string): Promise<void> {
    void path;
    await this.handleStructuralChange();
  }

  private async handleStructuralChange(): Promise<void> {
    const previous = this.candidates;
    await this.refreshCandidates();
    if (JSON.stringify(previous) === JSON.stringify(this.candidates)) return;
    this.results.clear();
    if (this.deps.getSettings().mode === 'auto' && !this.autoPaused) {
      for (const note of await this.inboxNotes()) this.scheduleNote(note);
    }
    this.notify();
  }

  private scheduleNote(path: string): void {
    const settings = this.deps.getSettings();
    if (settings.mode !== 'auto' || this.autoPaused || !this.key.ok) return;
    if (this.queued.has(path) || this.settleTimers.has(`note:${path}`)) return;
    const waitMs = Math.max(0, settings.settleSeconds) * 1000;
    const handle = this.deps.clock.setTimeout(() => {
      this.settleTimers.delete(`note:${path}`);
      if (this.deps.isActiveEditor?.(path)) {
        this.scheduleNote(path);
        return;
      }
      this.enqueue(path);
    }, waitMs);
    this.settleTimers.set(`note:${path}`, handle);
    this.notify();
  }

  private cancel(path: string): void {
    const handle = this.settleTimers.get(`note:${path}`);
    if (handle !== undefined) {
      this.deps.clock.clearTimeout(handle);
      this.settleTimers.delete(`note:${path}`);
    }
    this.queued.delete(path);
  }

  private enqueue(path: string): void {
    if (this.queued.has(path)) return;
    this.queued.add(path);
    const session = this.session;
    void this.enqueueExclusive(async () => {
      if (session !== this.session) {
        this.queued.delete(path);
        return;
      }
      this.queued.delete(path);
      const result = await this.runAnalysis(path, { bypassCache: false });
      if (result !== null && result.state === 'auto' && !this.autoPaused && session === this.session) {
        const currentHash = await this.deps.vault.hash(path);
        if (currentHash === result.noteHash) await this.executeMoves([
          {
            notePath: path,
            targetFolder: result.folderPath as string,
            expectedHash: result.noteHash,
            candidateId: result.candidateId,
          },
        ]);
        else this.results.delete(path);
      }
      await this.refreshInboxScope();
    }).catch(() => {
      this.queued.delete(path);
    });
    this.notify();
  }

  /** Appends a task to the single serial queue shared by automatic and manual work. */
  private enqueueExclusive(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task);
    this.chain = run.catch((error: unknown) => {
      this.deps.logError?.(`Jev PARA task failed: ${errorMessage(error)}`);
    });
    return run;
  }

  private async runAnalysis(path: string, options: { bypassCache: boolean }): Promise<AnalysisResult | null> {
    const session = this.session;
    let body: string;
    try {
      body = await this.deps.vault.read(path);
    } catch {
      this.results.delete(path);
      this.notify();
      return null;
    }
    const noteHash = await this.deps.vault.hash(path);
    if (noteHash === null) return null;
    if (this.journal.isHeld(path, noteHash)) {
      const held: AnalysisResult = {
        notePath: path,
        noteHash,
        candidateId: REFUSAL_ID,
        folderPath: null,
        confidence: null,
        probability: null,
        top: [],
        state: 'skipped',
        reason: 'Automatic move paused for an undone note. Edit the note to analyze it again.',
        createdAt: this.deps.clock.now(),
      };
      this.results.set(path, held);
      this.notify();
      return held;
    }

    const title = baseName(path).replace(/\.md$/i, '');
    const settings = this.deps.getSettings();
    const cacheKey = computeCacheKey({
      notePath: path,
      noteHash,
      noteTitle: title,
      noteBody: body,
      candidates: this.candidates,
      model: settings.model,
    });
    if (!options.bypassCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached !== null) {
        const refreshed = this.withDecision(cached, settings);
        this.results.set(path, refreshed);
        this.notify();
        return refreshed;
      }
    }

    if (this.candidates.length === 0) {
      const skipped: AnalysisResult = {
        notePath: path,
        noteHash,
        candidateId: REFUSAL_ID,
        folderPath: null,
        confidence: null,
        probability: null,
        top: [],
        state: 'skipped',
        reason: 'Skipped: no destination folders have descriptions.',
        createdAt: this.deps.clock.now(),
      };
      this.results.set(path, skipped);
      this.notify();
      return skipped;
    }

    const outcome = await this.client.classify({ path, title, body }, this.candidates);
    if (session !== this.session) return null;
    if (!outcome.ok) {
      if (outcome.failure.pauseAuto) this.autoPaused = true;
      const failed: AnalysisResult = {
        notePath: path,
        noteHash,
        candidateId: REFUSAL_ID,
        folderPath: null,
        confidence: null,
        probability: null,
        top: [],
        state: 'error',
        reason: outcome.failure.message,
        createdAt: this.deps.clock.now(),
      };
      this.results.set(path, failed);
      this.notify();
      return failed;
    }

    const answer = outcome.answer;
    const idToFolderPath: Record<string, string | null> = { [REFUSAL_ID]: null };
    for (const candidate of this.candidates) idToFolderPath[candidate.id] = candidate.folderPath;
    const top = Object.entries(answer.probabilities)
      .slice()
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([id, probability]) => ({ id, folderPath: idToFolderPath[id] ?? null, probability }));
    const decision = decideMove({
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      thresholds: thresholdsFrom(settings),
    });
    const result: AnalysisResult = {
      notePath: path,
      noteHash,
      candidateId: answer.choice,
      folderPath: answer.choice === REFUSAL_ID ? null : idToFolderPath[answer.choice] ?? null,
      confidence: answer.confidence,
      probability: answer.probabilities[answer.choice] ?? null,
      top,
      state: decision.state === 'auto' && answer.choice !== REFUSAL_ID ? 'auto' : 'review',
      reason: decision.reason,
      createdAt: this.deps.clock.now(),
      probabilities: { ...answer.probabilities },
    };
    this.results.set(path, result);
    await this.cache.set(cacheKey, result);
    this.notify();
    return result;
  }

  private withDecision(result: AnalysisResult, settings: JevParaSettings): AnalysisResult {
    const probabilities = result.probabilities;
    if (probabilities === undefined || result.confidence === null) return result;
    const decision = decideMove({
      choice: result.candidateId,
      confidence: result.confidence,
      probabilities,
      thresholds: thresholdsFrom(settings),
    });
    return {
      ...result,
      state: decision.state === 'auto' && result.candidateId !== REFUSAL_ID ? 'auto' : 'review',
      reason: decision.reason,
      createdAt: this.deps.clock.now(),
    };
  }

  private canUndo(): boolean {
    return this.lastRunId !== null && this.journal.byRun(this.lastRunId).some((record) => record.status === 'completed');
  }

  private async inboxNotes(): Promise<string[]> {
    const scope = await listInboxScope(this.deps.vault);
    return scope.notes;
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function thresholdsFrom(settings: JevParaSettings): Thresholds {
  return {
    minConfidence: settings.minConfidence,
    minProbability: settings.minProbability,
    minMargin: settings.minMargin,
  };
}
