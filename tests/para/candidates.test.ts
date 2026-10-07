import { describe, it, expect } from 'vitest';
import { FakeVault } from '../helpers/fakes';
import { collectCandidates, listInboxScope } from '../../src/para/index';

const ACTIVE_INDEX = `---
para: projects
---

# 서비스 출시

## 설명
새 서비스 베타 출시 준비

## 포함할 내용
베타 인터뷰, 출시 일정

## 제외할 내용
상시 사업 운영
`;

const AREA_ACTIVE_INDEX = `---
para: areas
---

# 건강

## 설명
지속적인 건강 관리

## 포함할 내용
진료 기록
`;

const RESOURCE_ACTIVE_INDEX = `---
para: resources
---

# AI 에이전트

## 설명
범용 에이전트 설계 참고

## 포함할 내용
도구 호출 패턴
`;

const EMPTY_TEMPLATE_INDEX = `---
para: projects
---

# 빈 폴더

## 설명
<!-- 이 폴더에 모을 내용과 목적을 적어주세요. -->

## 포함할 내용
<!-- 여기에 속하는 자료의 특징이나 예시를 적어주세요. -->
`;

const ARCHIVES_ACTIVE_INDEX = `---
para: archives
---

# 완료한 프로젝트

## 설명
이미 완료된 프로젝트들

## 포함할 내용
완료 보고서
`;

const MISMATCH_INDEX = `---
para: areas
---

# 서비스 출시

## 설명
실제로는 Projects에 있지만 frontmatter는 areas
`;

describe('collectCandidates - CAT-01 through CAT-06', () => {
  it('CAT-01: produces candidates for folders with active descriptions', async () => {
    const vault = new FakeVault(
      {
        '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX,
        '2. Areas/건강/INDEX.md': AREA_ACTIVE_INDEX,
        '3. Resources/AI_에이전트/INDEX.md': RESOURCE_ACTIVE_INDEX,
      },
      [
        '1. Projects', '1. Projects/서비스 출시',
        '2. Areas', '2. Areas/건강',
        '3. Resources', '3. Resources/AI_에이전트',
      ],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates).toHaveLength(3);
  });

  it('CAT-02: does not include folder with only template comments as description', async () => {
    const vault = new FakeVault(
      {
        '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX,
        '1. Projects/빈 폴더/INDEX.md': EMPTY_TEMPLATE_INDEX,
      },
      [
        '1. Projects', '1. Projects/서비스 출시', '1. Projects/빈 폴더',
      ],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].folderPath).toBe('1. Projects/서비스 출시');
  });

  it('CAT-03: excludes Archives folders from candidates', async () => {
    const vault = new FakeVault(
      {
        '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX,
        '4. Archives/완료한 프로젝트/INDEX.md': ARCHIVES_ACTIVE_INDEX,
      },
      [
        '1. Projects', '1. Projects/서비스 출시',
        '4. Archives', '4. Archives/완료한 프로젝트',
      ],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].category).toBe('projects');
    expect(candidates.find(c => c.category === 'archives')).toBeUndefined();
  });

  it('CAT-04: candidate id is deterministic from category and folderPath', async () => {
    const vault = new FakeVault(
      { '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX },
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const first = await collectCandidates(vault);
    const second = await collectCandidates(vault);
    expect(first[0].id).toBe(second[0].id);
  });

  it('CAT-04: candidate id does not contain the folder path or path separator', async () => {
    const vault = new FakeVault(
      { '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX },
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates[0].id).not.toContain('/');
    expect(candidates[0].id).not.toContain('서비스 출시');
    expect(candidates[0].id).not.toContain('1. Projects');
  });

  it('CAT-04: ids are unique across candidates', async () => {
    const vault = new FakeVault(
      {
        '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX,
        '2. Areas/건강/INDEX.md': AREA_ACTIVE_INDEX,
        '3. Resources/AI_에이전트/INDEX.md': RESOURCE_ACTIVE_INDEX,
      },
      [
        '1. Projects', '1. Projects/서비스 출시',
        '2. Areas', '2. Areas/건강',
        '3. Resources', '3. Resources/AI_에이전트',
      ],
    );
    const candidates = await collectCandidates(vault);
    const ids = candidates.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('CAT-05: sets mismatchWarning when frontmatter para disagrees with real parent', async () => {
    const vault = new FakeVault(
      { '1. Projects/서비스 출시/INDEX.md': MISMATCH_INDEX },
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].mismatchWarning).toBe(true);
    expect(candidates[0].category).toBe('projects');
  });

  it('CAT-05: no mismatchWarning when frontmatter matches real parent', async () => {
    const vault = new FakeVault(
      { '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX },
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates[0].mismatchWarning).toBe(false);
  });

  it('CAT-06: candidate fields are populated from INDEX content', async () => {
    const vault = new FakeVault(
      { '1. Projects/서비스 출시/INDEX.md': ACTIVE_INDEX },
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const candidates = await collectCandidates(vault);
    const c = candidates[0];
    expect(c.folderPath).toBe('1. Projects/서비스 출시');
    expect(c.name).toBe('서비스 출시');
    expect(c.description).toBe('새 서비스 베타 출시 준비');
    expect(c.include).toBe('베타 인터뷰, 출시 일정');
    expect(c.exclude).toBe('상시 사업 운영');
    expect(c.category).toBe('projects');
  });

  it('does not include folders without INDEX file', async () => {
    const vault = new FakeVault(
      {},
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const candidates = await collectCandidates(vault);
    expect(candidates).toHaveLength(0);
  });
});

describe('listInboxScope - SET-04', () => {
  it('returns direct .md children as notes (excluding reserved)', async () => {
    const vault = new FakeVault(
      {
        '0. Inbox/베타 인터뷰.md': '본문',
        '0. Inbox/다른 노트.md': '다른 본문',
      },
      ['0. Inbox'],
    );
    const scope = await listInboxScope(vault);
    expect(scope.notes).toContain('0. Inbox/베타 인터뷰.md');
    expect(scope.notes).toContain('0. Inbox/다른 노트.md');
    expect(scope.unsupported).toHaveLength(0);
    expect(scope.nested).toHaveLength(0);
    expect(scope.reserved).toHaveLength(0);
  });

  it('classifies reserved INDEX files', async () => {
    const vault = new FakeVault(
      {
        '0. Inbox/INDEX.md': 'index content',
        '0. Inbox/index.MD': 'index variant',
        '0. Inbox/베타 인터뷰.md': '본문',
      },
      ['0. Inbox'],
    );
    const scope = await listInboxScope(vault);
    expect(scope.reserved).toContain('0. Inbox/INDEX.md');
    expect(scope.reserved).toContain('0. Inbox/index.MD');
    expect(scope.notes).toContain('0. Inbox/베타 인터뷰.md');
    expect(scope.notes).not.toContain('0. Inbox/INDEX.md');
  });

  it('classifies nested .md files separately', async () => {
    const vault = new FakeVault(
      {
        '0. Inbox/베타 인터뷰.md': '본문',
        '0. Inbox/하위/메모.md': '중첩 본문',
      },
      ['0. Inbox', '0. Inbox/하위'],
    );
    const scope = await listInboxScope(vault);
    expect(scope.notes).toContain('0. Inbox/베타 인터뷰.md');
    expect(scope.nested).toContain('0. Inbox/하위/메모.md');
    expect(scope.notes).not.toContain('0. Inbox/하위/메모.md');
  });

  it('classifies non-.md files as unsupported', async () => {
    const vault = new FakeVault(
      {
        '0. Inbox/베타 인터뷰.md': '본문',
        '0. Inbox/이미지.png': 'binary',
        '0. Inbox/문서.pdf': 'binary',
      },
      ['0. Inbox'],
    );
    const scope = await listInboxScope(vault);
    expect(scope.unsupported).toContain('0. Inbox/이미지.png');
    expect(scope.unsupported).toContain('0. Inbox/문서.pdf');
    expect(scope.notes).not.toContain('0. Inbox/이미지.png');
  });

  it('SET-06: notes in Projects are not in Inbox scope', async () => {
    const vault = new FakeVault(
      {
        '0. Inbox/베타 인터뷰.md': '본문',
        '1. Projects/서비스 출시/출시 체크.md': '체크리스트',
      },
      ['0. Inbox', '1. Projects', '1. Projects/서비스 출시'],
    );
    const scope = await listInboxScope(vault);
    expect(scope.notes).toHaveLength(1);
    expect(scope.notes).toContain('0. Inbox/베타 인터뷰.md');
  });
});

