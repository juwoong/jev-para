import type {
  HttpPort,
  ClockPort,
  LoggerPort,
  NoteInput,
  Candidate,
  ClassifyOutcome,
  JevFailure,
} from '../ports';
import { LIMITS } from '../ports';
import { buildClassificationRequest, buildConnectionCheckRequest } from './request';
import { validateAnswer } from './validate';

export interface JevClientDeps {
  http: HttpPort;
  clock: ClockPort;
  sleep: (ms: number) => Promise<void>;
  logger?: LoggerPort;
}

export interface JevClientConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

function parseRetryAfterMs(header: string | undefined, nowMs: number): number | null {
  if (!header) return null;
  // Try as integer seconds
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds.toString() === header.trim()) {
    return seconds * 1000;
  }
  // Try as HTTP date
  const dateMs = Date.parse(header);
  if (!isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }
  return null;
}

function backoffMs(attempt: number): number {
  // Exponential: 1s, 2s base - deterministic and finite
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export class JevClient {
  private readonly http: HttpPort;
  private readonly clock: ClockPort;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger?: LoggerPort;
  private config: JevClientConfig | null = null;

  constructor(deps: JevClientDeps) {
    this.http = deps.http;
    this.clock = deps.clock;
    this.sleep = deps.sleep;
    this.logger = deps.logger;
  }

  configure(config: JevClientConfig | null): void {
    this.config = config;
  }

  async classify(note: NoteInput, candidates: Candidate[]): Promise<ClassifyOutcome> {
    if (!this.config) {
      return {
        ok: false,
        failure: {
          kind: 'key',
          message: 'API client is not configured.',
          retriable: false,
          pauseAuto: false,
        },
      };
    }

    const buildResult = buildClassificationRequest({ note, candidates, model: this.config.model });
    if (!buildResult.ok) {
      return { ok: false, failure: buildResult.failure };
    }

    return this._send(buildResult.body, buildResult.validIds);
  }

  async testConnection(): Promise<ClassifyOutcome> {
    if (!this.config) {
      return {
        ok: false,
        failure: {
          kind: 'key',
          message: 'API client is not configured.',
          retriable: false,
          pauseAuto: false,
        },
      };
    }

    const buildResult = buildConnectionCheckRequest({ model: this.config.model });
    if (!buildResult.ok) {
      return { ok: false, failure: buildResult.failure };
    }

    return this._send(buildResult.body, buildResult.validIds);
  }

  private async _send(body: string, validIds: string[]): Promise<ClassifyOutcome> {
    const config = this.config!;
    let attempt = 0;

    while (attempt <= LIMITS.maxRetries) {
      let responseText: string;
      let status: number;
      let headers: Record<string, string>;

      try {
        const response = await this.http.send({
          url: config.baseUrl,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          timeoutMs: LIMITS.requestTimeoutMs,
        });
        status = response.status;
        headers = response.headers;
        responseText = response.text;
      } catch {
        const failure: JevFailure = {
          kind: 'transport',
          message: 'A network error occurred.',
          retriable: true,
          pauseAuto: false,
        };
        if (attempt < LIMITS.maxRetries) {
          this.logger?.warn('transport error, retrying', { attempt });
          await this.sleep(backoffMs(attempt));
          attempt++;
          continue;
        }
        return { ok: false, failure };
      }

      // Handle auth errors - no retry
      if (status === 401 || status === 403) {
        this.logger?.warn('auth failure', { status });
        return {
          ok: false,
          failure: {
            kind: 'auth',
            message: 'Authentication failed. Check your API token.',
            retriable: false,
            pauseAuto: true,
          },
        };
      }

      // Handle client errors - no retry
      if (status === 400 || status === 422) {
        this.logger?.warn('input error', { status });
        return {
          ok: false,
          failure: {
            kind: 'input',
            message: 'Invalid request format.',
            retriable: false,
            pauseAuto: false,
          },
        };
      }

      // Handle 429 - retry with Retry-After
      if (status === 429) {
        const retryAfterMs = parseRetryAfterMs(
          headers['retry-after'] ?? headers['Retry-After'],
          this.clock.now(),
        ) ?? backoffMs(attempt);

        const failure: JevFailure = {
          kind: 'transport',
          message: 'Rate limit exceeded. Retrying shortly.',
          retriable: true,
          pauseAuto: false,
          retryAfterMs,
        };

        if (attempt < LIMITS.maxRetries) {
          this.logger?.warn('rate limited', { attempt });
          await this.sleep(retryAfterMs);
          attempt++;
          continue;
        }
        return { ok: false, failure };
      }

      // Handle retriable server/timeout errors
      if (status === 408 || status === 409 || status === 425 || status >= 500) {
        const failure: JevFailure = {
          kind: 'transport',
          message: 'A server error occurred.',
          retriable: true,
          pauseAuto: false,
        };
        if (attempt < LIMITS.maxRetries) {
          this.logger?.warn('server error, retrying', { status, attempt });
          await this.sleep(backoffMs(attempt));
          attempt++;
          continue;
        }
        return { ok: false, failure };
      }

      // Parse response body
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        this.logger?.warn('non-JSON response', { status });
        return {
          ok: false,
          failure: {
            kind: 'contract',
            message: 'Response is not valid JSON.',
            retriable: false,
            pauseAuto: false,
          },
        };
      }

      // Validate
      const validated = validateAnswer(parsed, { validIds });
      if (!validated.ok) {
        this.logger?.warn('contract violation', { kind: validated.failure.kind });
        return validated;
      }

      return { ok: true, answer: validated.answer };
    }

    // Should not reach here
    return {
      ok: false,
      failure: {
        kind: 'transport',
        message: 'Maximum retry attempts exceeded.',
        retriable: false,
        pauseAuto: false,
      },
    };
  }
}

