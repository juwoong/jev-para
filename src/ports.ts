/** Shared contracts for the Jev PARA plugin. Frozen by the integrator; slices implement against these. */

export type ParaCategory = 'projects' | 'areas' | 'resources' | 'archives';

export const PARA_CATEGORIES: readonly ParaCategory[] = ['projects', 'areas', 'resources', 'archives'];

export const PARA_ROOTS: Readonly<Record<ParaCategory, string>> = {
  projects: '1. Projects',
  areas: '2. Areas',
  resources: '3. Resources',
  archives: '4. Archives',
};

export const INBOX_ROOT = '0. Inbox';
export const INDEX_FILENAME = 'INDEX.md';
export const REFUSAL_ID = 'keep_in_inbox';
/** Categories that may receive automatically sorted notes. Archives is deliberately excluded. */
export const SORTABLE_CATEGORIES: readonly ParaCategory[] = ['projects', 'areas', 'resources'];

export interface VaultPort {
  /** Vault-relative folder paths, no trailing slash. */
  listFolders(): Promise<string[]>;
  /** Vault-relative markdown file paths. */
  listMarkdownFiles(): Promise<string[]>;
  /** Every vault-relative file path, including non-markdown attachments. */
  listFiles(): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Content hash of a file, or null when missing. */
  hash(path: string): Promise<string | null>;
}

export interface FilePort {
  readTextFile(absPath: string): Promise<string>;
  /** Resolves symlinks; used to keep .env reads inside the vault. */
  realPath(absPath: string): Promise<string>;
}

export interface ClockPort {
  now(): number;
}

export interface TimerPort {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface HttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface HttpPort {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export interface StorePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface LoggerPort {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** A sortable destination folder, derived from INDEX.md beside it. */
export interface Candidate {
  id: string;
  folderPath: string;
  category: ParaCategory;
  name: string;
  description: string;
  include: string;
  exclude: string;
  /** INDEX frontmatter disagrees with the real parent category. */
  mismatchWarning: boolean;
}

export interface NoteInput {
  path: string;
  title: string;
  body: string;
}

/** Choice question id used for the single classification question. */
export const QUESTION_ID = 'destination';

export interface ClassifyAnswer {
  choice: string;
  confidence: number | null;
  probabilities: Record<string, number>;
}

export type JevFailureKind = 'key' | 'auth' | 'input' | 'transport' | 'contract' | 'limit';

export interface JevFailure {
  kind: JevFailureKind;
  message: string;
  retriable: boolean;
  /** Auth failures must stop unattended runs until the key is fixed. */
  pauseAuto: boolean;
  retryAfterMs?: number;
}

export type ClassifyOutcome = { ok: true; answer: ClassifyAnswer } | { ok: false; failure: JevFailure };

export interface KeyLoadResult {
  ok: boolean;
  key: string | null;
  message: string;
}

/** Where the API key comes from. Obsidian's encrypted secret storage is used when available. */
export interface ApiKeyStorePort {
  readonly secure: boolean;
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export type AnalysisState = 'auto' | 'review' | 'error' | 'skipped';

export interface RankedCandidate {
  id: string;
  folderPath: string | null;
  probability: number;
}

export interface AnalysisResult {
  notePath: string;
  noteHash: string;
  /** Selected candidate id, or REFUSAL_ID when the note should stay in the Inbox. */
  candidateId: string;
  folderPath: string | null;
  confidence: number | null;
  probability: number | null;
  top: RankedCandidate[];
  state: AnalysisState;
  reason: string;
  createdAt: number;
  /** Full probability distribution from the model, kept so thresholds can be re-applied without a new request. */
  probabilities?: Record<string, number>;
}

export interface JevParaSettings {
  keySource: 'settings' | 'env';
  envPath: string;
  baseUrl: string;
  model: string;
  mode: 'manual' | 'auto';
  settleSeconds: number;
  minConfidence: number;
  minProbability: number;
  minMargin: number;
}

export const DEFAULT_SETTINGS: JevParaSettings = {
  keySource: 'settings',
  envPath: '_dev/jev-para/.env',
  baseUrl: 'https://api.typesafe.ai/v1/systemone',
  model: 'jev-latest',
  mode: 'manual',
  settleSeconds: 30,
  minConfidence: 0.8,
  minProbability: 0.8,
  minMargin: 0.2,
};

/** Product limits from IMPLEMENTATION_PROMPT.md; not provider guarantees. */
export const LIMITS = {
  maxNoteBytes: 32 * 1024,
  maxRequestBytes: 128 * 1024,
  /** Provider documents 255 Choice options; one slot is reserved for keep_in_inbox. */
  maxCandidates: 254,
  requestTimeoutMs: 30_000,
  maxRetries: 2,
} as const;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
