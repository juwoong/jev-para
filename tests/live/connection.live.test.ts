import { readFile, realpath } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { KeyStore } from '../../src/adapters/keyStore';
import { JevClient } from '../../src/jev/client';
import { loadApiKey } from '../../src/jev/env';
import { collectCandidates } from '../../src/para/index';
import { DEFAULT_SETTINGS, type HttpPort, type HttpRequest, type HttpResponse } from '../../src/ports';
import { FakeVault } from '../helpers/fakes';
import { FakeStore } from '../helpers/fakes';

const VAULT_ROOT = '/Users/juwoong/vaults/testing';

class NodeHttp implements HttpPort {
  async send(request: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return { status: response.status, headers, text: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}

describe('LIVE-01 Jev connection', () => {
  it('authenticates with the .env key and returns a valid typed answer', async () => {
    const loaded = await loadApiKey({
      vaultRoot: VAULT_ROOT,
      envPath: DEFAULT_SETTINGS.envPath,
      filePort: {
        readTextFile: (path) => readFile(path, 'utf8'),
        realPath: (path) => realpath(path),
      },
    });
    expect(loaded.ok, `key loading failed: ${loaded.message}`).toBe(true);
    if (!loaded.ok || loaded.key === null) throw new Error('no key');

    const client = new JevClient({
      http: new NodeHttp(),
      clock: { now: () => Date.now() },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    client.configure({
      baseUrl: DEFAULT_SETTINGS.baseUrl,
      model: DEFAULT_SETTINGS.model,
      apiKey: loaded.key,
    });

    const outcome = await client.testConnection();
    if (!outcome.ok) {
      throw new Error(`kind=${outcome.failure.kind} retriable=${outcome.failure.retriable} :: ${outcome.failure.message}`);
    }
    expect(outcome.ok).toBe(true);
  });
});

describe('LIVE-03 plugin-test vault settings', () => {
  it('round-trips the key through both key storage modes', async () => {
    const dataPath =
      '/Users/juwoong/vaults/testing/plugin-test/.obsidian/plugins/jev-para/data.json';
    const data = JSON.parse(await readFile(dataPath, 'utf8')) as { settings?: { envPath?: string } };
    const envPath = data.settings?.envPath;
    expect(typeof envPath, 'data.json must seed settings.envPath').toBe('string');
    if (typeof envPath !== 'string') return;

    const fromEnv = await loadApiKey({
      vaultRoot: '/Users/juwoong/vaults/testing/plugin-test',
      envPath,
      filePort: {
        readTextFile: (path) => readFile(path, 'utf8'),
        realPath: (path) => realpath(path),
      },
    });
    expect(fromEnv.ok, `env key loading failed: ${fromEnv.message}`).toBe(true);
    expect(fromEnv.key).not.toBeNull();
    if (fromEnv.key === null) return;

    const fallbackStore = new KeyStore({ secretStorage: null, store: new FakeStore() });
    expect(fallbackStore.secure).toBe(false);
    await fallbackStore.set(fromEnv.key);
    expect(await fallbackStore.get()).toBe(fromEnv.key);

    const secrets = new Map<string, string>();
    const secureStore = new KeyStore({
      secretStorage: {
        getSecret: (id) => secrets.get(id) ?? null,
        setSecret: (id, value) => {
          secrets.set(id, value);
        },
      },
      store: new FakeStore(),
    });
    expect(secureStore.secure).toBe(true);
    await secureStore.set(fromEnv.key);
    expect(await secureStore.get()).toBe(fromEnv.key);
    await secureStore.clear();
    expect(await secureStore.get()).toBeNull();
  });
});

async function liveClient(): Promise<JevClient> {
  const loaded = await loadApiKey({
    vaultRoot: VAULT_ROOT,
    envPath: DEFAULT_SETTINGS.envPath,
    filePort: {
      readTextFile: (path) => readFile(path, 'utf8'),
      realPath: (path) => realpath(path),
    },
  });
  if (!loaded.ok || loaded.key === null) throw new Error(`key loading failed: ${loaded.message}`);
  const client = new JevClient({
    http: new NodeHttp(),
    clock: { now: () => Date.now() },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  client.configure({
    baseUrl: DEFAULT_SETTINGS.baseUrl,
    model: DEFAULT_SETTINGS.model,
    apiKey: loaded.key,
  });
  return client;
}

describe('LIVE-02 semantic classification with synthetic notes', () => {
  it('reports the chosen folder for each synthetic note', async () => {
    const vault = new FakeVault(
      {
        '1. Projects/서비스 출시/INDEX.md':
          '# 서비스 출시\n\n## 설명\n새 서비스 베타 출시를 준비하는 프로젝트.\n\n## 포함할 내용\n베타 인터뷰, 출시 일정, 출시용 가격 정책\n\n## 제외할 내용\n일반 기술 참고, 상시 사업 운영 기록\n',
        '2. Areas/건강/INDEX.md':
          '# 건강\n\n## 설명\n지속적인 건강 관리.\n\n## 포함할 내용\n진료 기록, 내 운동 실천 기록\n\n## 제외할 내용\n일반적인 운동법 참고 자료\n',
        '3. Resources/AI 에이전트/INDEX.md':
          '# AI 에이전트\n\n## 설명\n범용 에이전트 설계 참고 자료.\n\n## 포함할 내용\n도구 호출 패턴, 설계 원칙\n\n## 제외할 내용\n서비스 출시의 구체적 산출물\n',
      },
      ['0. Inbox', '1. Projects', '2. Areas', '3. Resources', '4. Archives'],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates).toHaveLength(3);

    const client = await liveClient();
    const notes = [
      {
        path: '0. Inbox/베타 인터뷰 정리.md',
        title: '베타 인터뷰 정리',
        body: '베타 출시를 위한 사용자 인터뷰 일정과 질문, 인터뷰에서 나온 피드백을 정리한다.',
      },
      {
        path: '0. Inbox/운동 기록.md',
        title: '운동 기록',
        body: '오늘 스쿼트 3세트와 30분 조깅을 완료했다. 무릎 상태는 괜찮았다.',
      },
      {
        path: '0. Inbox/에이전트 설계 원칙.md',
        title: '에이전트 설계 원칙',
        body: '범용 에이전트의 도구 호출 패턴과 실패 복구 원칙에 대한 일반적인 정리.',
      },
    ];

    for (const note of notes) {
      const outcome = await client.classify(note, candidates);
      if (!outcome.ok) throw new Error(`classify failed: ${outcome.failure.kind} ${outcome.failure.message}`);
      const chosen = candidates.find((candidate) => candidate.id === outcome.answer.choice);
      const top = Object.entries(outcome.answer.probabilities)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([id, probability]) => `${candidates.find((c) => c.id === id)?.folderPath ?? id}=${probability.toFixed(2)}`)
        .join(' ');
      console.log(
        `LIVE-02 ${note.title} -> ${chosen?.folderPath ?? 'keep_in_inbox'} ` +
          `(confidence ${outcome.answer.confidence?.toFixed(2)}, ${top})`,
      );
    }
  });
});
