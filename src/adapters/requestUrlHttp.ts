import { requestUrl } from 'obsidian';
import type { HttpPort, HttpRequest, HttpResponse } from '../ports';

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) result[key.toLowerCase()] = String(value);
  return result;
}

export class RequestUrlHttp implements HttpPort {
  async send(request: HttpRequest): Promise<HttpResponse> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Jev request timed out')), request.timeoutMs);
    });
    try {
      const response = await Promise.race([
        requestUrl({
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.body,
          throw: false,
        }),
        timeout,
      ]);
      return { status: response.status, headers: normalizeHeaders(response.headers), text: response.text };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
