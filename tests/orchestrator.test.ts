import { describe, expect, it } from 'vitest';
import { Orchestrator, type OrchestratorSnapshot } from '../src/orchestrator';
import {
  DEFAULT_SETTINGS,
  REFUSAL_ID,
  type ApiKeyStorePort,
  type Candidate,
  type JevParaSettings,
} from '../src/ports';
import { FakeClock, FakeFilePort, FakeHttp, FakeStore, FakeVault, deferred, jsonResponse } from './helpers/fakes';

const VAULT_ROOT = '/vault';
const PROJECT = '1. Projects/서비스 출시';
const AREA = '2. Areas/건강';
const NOTE = '0. Inbox/베타 인터뷰.md';

function fixtureVault(): FakeVault {
  return new FakeVault(
    {
      [NOTE]: '베타 출시를 위한 사용자 인터뷰 일정과 질문을 정리한다.',
      [`${PROJECT}/INDEX.md`]: '# 서비스 출시\n\n## 설명\n새 서비스 베타 출시 준비.\n\n## 포함할 내용\n베타 인터뷰, 출시 일정\n\n## 제외할 내용\n일반 기술 참고\n',
      [`${AREA}/INDEX.md`]: '# 건강\n\n## 설명\n지속적인 건강 관리.\n\n## 포함할 내용\n진료 기록\n',
    },
    ['0. Inbox', '1. Projects', '2. Areas', '3. Resources', '4. Archives'],
  );
}

class FakeKeyStore implements ApiKeyStorePort {
  constructor(readonly secure = false, private value: string | null = null) {}

  async get(): Promise<string | null> {
    return this.value;
  }

  async set(next: string): Promise<void> {
    this.value = next;
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

interface Harness {
  orchestrator: Orchestrator;
  vault: FakeVault;
  http: FakeHttp;
  clock: FakeClock;
  store: FakeStore;
  keyStore: FakeKeyStore;
  candidates: Candidate[];
  settings: JevParaSettings;
  snapshot(): OrchestratorSnapshot;
}

async function harness(overrides: Partial<JevParaSettings> = {}): Promise<Harness> {
  const vault = fixtureVault();
  const http = new FakeHttp();
  const clock = new FakeClock();
  const store = new FakeStore();
  const filePort = new FakeFilePort();
  const envFile = `${VAULT_ROOT}/_dev/jev-para/.env`;
  filePort.files.set(envFile, 'JEV_API_KEY=test-key\n');
  const settings: JevParaSettings = { ...DEFAULT_SETTINGS, keySource: 'env', ...overrides };
  const keyStore = new FakeKeyStore(false);

  const orchestrator = new Orchestrator({
    vault,
    filePort,
    http,
    store,
    clock,
    keyStore,
    vaultRoot: VAULT_ROOT,
    getSettings: () => settings,
    sleep: async () => undefined,
    logDebug: () => undefined,
    logError: () => undefined,
  });
  await orchestrator.init();
  await orchestrator.refreshCandidates();
  const candidates = orchestrator.snapshot().candidates;
  return {
    orchestrator,
    vault,
    http,
    clock,
    store,
    keyStore,
    candidates,
    settings,
    snapshot: () => orchestrator.snapshot(),
  };
}

function idFor(candidates: Candidate[], folderPath: string): string {
  const candidate = candidates.find((entry) => entry.folderPath === folderPath);
  if (candidate === undefined) throw new Error(`No candidate for ${folderPath}`);
  return candidate.id;
}

function answer(harnessRef: Harness, chosen: string | null, confidence = 0.9, runnerUpShare = 0.05) {
  const chosenId = chosen === null ? REFUSAL_ID : idFor(harnessRef.candidates, chosen);
  const ordered = [
    chosenId,
    ...harnessRef.candidates.map((candidate) => candidate.id).filter((id) => id !== chosenId),
    REFUSAL_ID,
  ].filter((id, index, all) => all.indexOf(id) === index);
  const probabilities: Record<string, number> = {};
  ordered.forEach((id, index) => {
    if (index === 0) probabilities[id] = 0.9;
    else if (index === 1) probabilities[id] = runnerUpShare;
    else if (index === 2) probabilities[id] = Math.max(0, 1 - 0.9 - runnerUpShare);
    else probabilities[id] = 0;
  });
  return jsonResponse(200, {
    model: 'jev-1.13.0',
    answers: {
      destination: { type: 'choice', choice: chosenId, confidence, probabilities },
    },
  });
}

describe('orchestrator settle scheduling', () => {
  it('QUE-01 waits for the settle delay before calling the API', async () => {
    const h = await harness({ mode: 'auto' });
    h.http.enqueue(answer(h, PROJECT));

    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(29_999);
    expect(h.http.callCount).toBe(0);

    await h.clock.advance(1);
    await h.orchestrator.waitForIdle();
    expect(h.http.callCount).toBe(1);
  });

  it('QUE-02 restarts the settle delay when the note changes again', async () => {
    const h = await harness({ mode: 'auto' });
    h.http.enqueue(answer(h, PROJECT));

    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(20_000);
    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(29_999);
    expect(h.http.callCount).toBe(0);

    await h.clock.advance(1);
    await h.orchestrator.waitForIdle();
    expect(h.http.callCount).toBe(1);
  });

  it('QUE-02b does not call the API while automatic sorting is not enabled', async () => {
    const h = await harness({ mode: 'manual' });
    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(600_000);
    await h.orchestrator.waitForIdle();
    expect(h.http.callCount).toBe(0);
  });
});

describe('orchestrator analysis', () => {
  it('CAC-01 reuses the cache instead of paying for a second identical call', async () => {
    const h = await harness({ mode: 'manual' });
    h.http.enqueue(answer(h, PROJECT));

    await h.orchestrator.analyzeAll();
    expect(h.http.callCount).toBe(1);
    await h.orchestrator.analyzeAll();
    expect(h.http.callCount).toBe(1);
  });

  it('marks a confident result as automatically movable', async () => {
    const h = await harness({ mode: 'manual' });
    h.http.enqueue(answer(h, PROJECT));

    const outcome = await h.orchestrator.analyzeAll();
    expect(outcome.analyzed).toBe(1);
    const [result] = h.snapshot().results;
    expect(result.state).toBe('auto');
    expect(result.folderPath).toBe(PROJECT);
  });

  it('ERR-01 pauses automatic sorting after an authentication failure', async () => {
    const h = await harness({ mode: 'auto' });
    h.http.enqueue(jsonResponse(401, { error: 'invalid key' }));

    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(30_000);
    await h.orchestrator.waitForIdle();

    expect(h.snapshot().autoPaused).toBe(true);
    expect(h.vault.files.has(NOTE)).toBe(true);
  });

  it('skips notes without calling the API when no folder has a description', async () => {
    const h = await harness({ mode: 'manual' });
    h.vault.files.delete(`${PROJECT}/INDEX.md`);
    h.vault.files.delete(`${AREA}/INDEX.md`);
    await h.orchestrator.analyzeAll();
    expect(h.http.callCount).toBe(0);
    expect(h.snapshot().results[0]?.state).toBe('skipped');
  });
});

describe('orchestrator moves', () => {
  it('MOV-01 moves a confident note and clears its analysis row', async () => {
    const h = await harness({ mode: 'manual' });
    h.http.enqueue(answer(h, PROJECT));

    await h.orchestrator.analyzeAll();
    const outcome = await h.orchestrator.applyMoves([NOTE]);

    expect(outcome.moved).toBe(1);
    expect(h.vault.files.has(`${PROJECT}/베타 인터뷰.md`)).toBe(true);
    expect(h.vault.files.has(NOTE)).toBe(false);
    expect(h.snapshot().results).toHaveLength(0);
  });

  it('UND-01 restores the note and blocks automatic re-move', async () => {
    const h = await harness({ mode: 'auto' });
    h.http.enqueue(answer(h, PROJECT));

    await h.orchestrator.analyzeAll();
    await h.orchestrator.applyMoves([NOTE]);
    const undone = await h.orchestrator.undoLastRun();

    expect(undone.undone).toBe(1);
    expect(h.vault.files.has(NOTE)).toBe(true);

    const callsBefore = h.http.callCount;
    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(60_000);
    await h.orchestrator.waitForIdle();
    expect(h.http.callCount).toBe(callsBefore);
  });

  it('MOV-02 keeps both files when the destination name already exists', async () => {
    const h = await harness({ mode: 'manual' });
    h.vault.files.set(`${PROJECT}/베타 인터뷰.md`, '기존 파일');
    h.http.enqueue(answer(h, PROJECT));

    await h.orchestrator.analyzeAll();
    const outcome = await h.orchestrator.applyMoves([NOTE]);

    expect(outcome.moved).toBe(0);
    expect(outcome.failed).toBe(1);
    expect(h.vault.files.get(`${PROJECT}/베타 인터뷰.md`)).toBe('기존 파일');
    expect(h.vault.files.has(NOTE)).toBe(true);
  });

  it('QUE-06 discards a result when the note changed while the request was in flight', async () => {
    const h = await harness({ mode: 'auto' });
    const pending = deferred<ReturnType<typeof jsonResponse>>();
    h.http.enqueue(pending.promise);

    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(30_000);

    h.vault.files.set(NOTE, '베타 출시를 위한 사용자 인터뷰 일정과 질문을 정리한다. 수정됨');
    h.orchestrator.onFileChange(NOTE, 'modify', false);
    pending.resolve(answer(h, PROJECT));
    await h.orchestrator.waitForIdle();

    expect(h.vault.files.has(NOTE)).toBe(true);
  });
});

describe('settings-based API key', () => {
  it('KEY-08 uses a key typed in settings without reading .env', async () => {
    const h = await harness({ keySource: 'settings' });
    const saved = await h.orchestrator.saveApiKey('typed-key-from-settings');
    expect(saved.ok).toBe(true);
    expect(h.snapshot().key.ok).toBe(true);

    h.http.enqueue(answer(h, PROJECT));
    await h.orchestrator.analyzeAll();
    expect(h.http.callCount).toBe(1);
    expect(h.http.requests[0]?.headers.Authorization).toBe('Bearer typed-key-from-settings');
  });

  it('KEY-09 reports a missing settings key and schedules no work', async () => {
    const h = await harness({ keySource: 'settings', mode: 'auto' });
    await h.orchestrator.reloadKey();

    expect(h.snapshot().key.ok).toBe(false);
    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(600_000);
    await h.orchestrator.waitForIdle();
    expect(h.http.callCount).toBe(0);
  });

  it('KEY-10 clears the stored key and stops using it', async () => {
    const h = await harness({ keySource: 'settings' });
    await h.orchestrator.saveApiKey('typed-key');
    expect(h.snapshot().key.ok).toBe(true);

    const cleared = await h.orchestrator.clearApiKey();
    expect(cleared.ok).toBe(false);
    expect(cleared.key).toBeNull();
  });

  it('KEY-11 rejects an empty typed key', async () => {
    const h = await harness({ keySource: 'settings' });
    const result = await h.orchestrator.saveApiKey('   ');
    expect(result.ok).toBe(false);
  });

  it('KEY-12 records a connection test result for the settings UI', async () => {
    const h = await harness({ keySource: 'settings' });
    expect(h.snapshot().keyTest).toBeNull();

    const withoutKey = await h.orchestrator.testConnection();
    expect(withoutKey.ok).toBe(false);
    expect(h.snapshot().keyTest?.ok).toBe(false);
    expect(h.http.callCount).toBe(0);

    await h.orchestrator.saveApiKey('typed-key');
    h.http.enqueue(
      jsonResponse(200, {
        model: 'jev-1.13.0',
        answers: {
          destination: {
            type: 'choice',
            choice: 'test_a',
            confidence: 1,
            probabilities: { test_a: 1, keep_in_inbox: 0 },
          },
        },
      }),
    );
    const withKey = await h.orchestrator.testConnection();
    expect(withKey.ok).toBe(true);
    expect(h.snapshot().keyTest?.ok).toBe(true);
    expect(h.http.callCount).toBe(1);
  });
});

describe('orchestrator lifecycle', () => {
  it('QUE-07 stops applying work after dispose', async () => {
    const h = await harness({ mode: 'auto' });
    const pending = deferred<ReturnType<typeof jsonResponse>>();
    h.http.enqueue(pending.promise);

    h.orchestrator.onFileChange(NOTE, 'modify', false);
    await h.clock.advance(30_000);
    h.orchestrator.dispose();
    pending.resolve(answer(h, PROJECT));
    await h.orchestrator.waitForIdle();

    expect(h.vault.files.has(NOTE)).toBe(true);
    expect(h.vault.log.filter((entry) => entry.startsWith('rename:'))).toHaveLength(0);
  });
});
