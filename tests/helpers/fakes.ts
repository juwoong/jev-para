import type {
  ClockPort,
  FilePort,
  HttpPort,
  HttpRequest,
  HttpResponse,
  LoggerPort,
  StorePort,
  TimerPort,
  VaultPort,
} from '../../src/ports';

import { contentHash } from '../../src/hash';

/** Deterministic, non-cryptographic content hash for tests; mirrors production behavior. */
export function testHash(value: string): string {
  return contentHash(value);
}

export function splitPath(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0);
}

export function joinPath(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('/');
}

export function parentPath(path: string): string {
  const parts = splitPath(path);
  parts.pop();
  return parts.join('/');
}

export function baseName(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? '';
}

export class FakeVault implements VaultPort {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly log: string[] = [];
  renameFailure: Error | null = null;

  constructor(initial: Record<string, string> = {}, folders: string[] = []) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
    for (const folder of folders) this.addFolder(folder);
    for (const path of this.files.keys()) this.registerParents(path);
  }

  private registerParents(path: string): void {
    const parts = splitPath(path);
    parts.pop();
    for (let index = 1; index <= parts.length; index += 1) {
      this.folders.add(parts.slice(0, index).join('/'));
    }
  }

  addFolder(path: string): void {
    const parts = splitPath(path);
    for (let index = 1; index <= parts.length; index += 1) {
      this.folders.add(parts.slice(0, index).join('/'));
    }
  }

  async listFolders(): Promise<string[]> {
    return [...this.folders].sort();
  }

  async listMarkdownFiles(): Promise<string[]> {
    return [...this.files.keys()].filter((path) => path.toLowerCase().endsWith('.md')).sort();
  }

  async listFiles(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`File not found: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    this.registerParents(path);
    this.log.push(`write:${path}`);
  }

  async createFolder(path: string): Promise<void> {
    this.addFolder(path);
    this.log.push(`createFolder:${path}`);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.renameFailure) throw this.renameFailure;
    if (this.files.has(to) || this.folders.has(to)) throw new Error(`Destination exists: ${to}`);
    if (this.files.has(from)) {
      const content = this.files.get(from) as string;
      this.files.delete(from);
      this.files.set(to, content);
      this.registerParents(to);
      this.log.push(`rename:${from}->${to}`);
      return;
    }
    if (this.folders.has(from)) {
      const prefix = `${from}/`;
      for (const path of [...this.files.keys()]) {
        if (path.startsWith(prefix)) {
          const content = this.files.get(path) as string;
          this.files.delete(path);
          this.files.set(`${to}/${path.slice(prefix.length)}`, content);
        }
      }
      for (const folder of [...this.folders]) {
        if (folder === from || folder.startsWith(prefix)) {
          this.folders.delete(folder);
          this.folders.add(`${to}${folder.slice(from.length)}`);
        }
      }
      this.folders.add(to);
      this.log.push(`rename:${from}->${to}`);
      return;
    }
    throw new Error(`Source not found: ${from}`);
  }

  async hash(path: string): Promise<string | null> {
    const value = this.files.get(path);
    return value === undefined ? null : testHash(value);
  }
}

export class FakeHttp implements HttpPort {
  readonly requests: HttpRequest[] = [];
  private queue: Array<HttpResponse | Error | Promise<HttpResponse>> = [];
  defaultResponse: HttpResponse = jsonResponse(200, {});

  enqueue(...responses: Array<HttpResponse | Error | Promise<HttpResponse>>): void {
    this.queue.push(...responses);
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (next === undefined) return this.defaultResponse;
    if (next instanceof Error) throw next;
    return next;
  }

  get callCount(): number {
    return this.requests.length;
  }
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, text: JSON.stringify(body) };
}

export class FakeClock implements ClockPort, TimerPort {
  private current: number;
  private nextHandle = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  constructor(start = 1_700_000_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number): number {
    const handle = this.nextHandle += 1;
    this.timers.set(handle, { at: this.current + ms, callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  /** Advances time, running due timers in chronological order. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      const [handle, timer] = due;
      this.timers.delete(handle);
      this.current = timer.at;
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.current = target;
  }
}

export class FakeStore implements StorePort {
  readonly map = new Map<string, unknown>();
  setFailure: Error | null = null;

  async get<T>(key: string): Promise<T | null> {
    const value = this.map.get(key);
    return value === undefined ? null : (value as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (this.setFailure) throw this.setFailure;
    this.map.set(key, value);
  }
}

export class FakeFilePort implements FilePort {
  readonly files = new Map<string, string>();
  readonly realPaths = new Map<string, string>();

  async readTextFile(absPath: string): Promise<string> {
    const value = this.files.get(absPath);
    if (value === undefined) throw new Error(`ENOENT: ${absPath}`);
    return value;
  }

  async realPath(absPath: string): Promise<string> {
    return this.realPaths.get(absPath) ?? absPath;
  }
}

export class FakeLogger implements LoggerPort {
  readonly messages: Array<{ level: string; message: string }> = [];

  debug(message: string): void {
    this.messages.push({ level: 'debug', message });
  }

  warn(message: string): void {
    this.messages.push({ level: 'warn', message });
  }

  error(message: string): void {
    this.messages.push({ level: 'error', message });
  }
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
