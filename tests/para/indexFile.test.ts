import { describe, it, expect } from 'vitest';
import { FakeVault } from '../helpers/fakes';
import {
  parseIndex,
  isDescriptionActive,
  buildIndexTemplate,
  ensureParaRoots,
  ensureIndex,
  ensureIndexesForVault,
} from '../../src/para/index';

// IDX-01 through IDX-10

describe('parseIndex - IDX-05, IDX-06', () => {
  it('parses all three sections', () => {
    const md = `---
para: projects
title: 서비스 출시
---

# 서비스 출시

## 설명
새 서비스 베타 출시 준비

## 포함할 내용
베타 인터뷰, 출시 일정

## 제외할 내용
상시 사업 운영, 일반 기술 참고
`;
    const fields = parseIndex(md);
    expect(fields.para).toBe('projects');
    expect(fields.title).toBe('서비스 출시');
    expect(fields.description).toBe('새 서비스 베타 출시 준비');
    expect(fields.include).toBe('베타 인터뷰, 출시 일정');
    expect(fields.exclude).toBe('상시 사업 운영, 일반 기술 참고');
  });

  it('returns null for missing frontmatter', () => {
    const md = `# No Frontmatter

## 설명
some text
`;
    const fields = parseIndex(md);
    expect(fields.para).toBeNull();
    expect(fields.title).toBeNull();
  });

  it('returns empty strings for missing sections', () => {
    const md = `---
para: areas
---

# 건강
`;
    const fields = parseIndex(md);
    expect(fields.description).toBe('');
    expect(fields.include).toBe('');
    expect(fields.exclude).toBe('');
  });

  it('strips HTML comments from description', () => {
    const md = `---
para: projects
---

# 서비스 출시

## 설명
<!-- 이 폴더에 모을 내용과 목적을 적어주세요. -->

## 포함할 내용
<!-- 여기에 속하는 자료의 특징이나 예시를 적어주세요. -->
`;
    const fields = parseIndex(md);
    expect(fields.description).toBe('');
    expect(fields.include).toBe('');
  });

  it('strips HTML comments but preserves surrounding real text', () => {
    const md = `---
para: projects
---

# 서비스 출시

## 설명
<!-- 주석 -->실제 설명 텍스트<!-- 끝 주석 -->
`;
    const fields = parseIndex(md);
    expect(fields.description).toBe('실제 설명 텍스트');
  });
});

describe('isDescriptionActive - IDX-06, CAT-02', () => {
  it('is false when description is empty', () => {
    const fields = { para: 'projects', title: '서비스 출시', description: '', include: 'some', exclude: 'other' };
    expect(isDescriptionActive(fields)).toBe(false);
  });

  it('is true when description has real text', () => {
    const fields = { para: 'projects', title: '서비스', description: '새 서비스 베타 출시 준비', include: '', exclude: '' };
    expect(isDescriptionActive(fields)).toBe(true);
  });

  it('is false even when include/exclude have text but description is empty', () => {
    const fields = { para: 'projects', title: '서비스', description: '', include: '베타', exclude: '운영' };
    expect(isDescriptionActive(fields)).toBe(false);
  });
});

describe('buildIndexTemplate - IDX-01, IDX-07', () => {
  it('produces valid YAML frontmatter with para key', () => {
    const tmpl = buildIndexTemplate('projects', '서비스 출시');
    expect(tmpl).toContain('para: projects');
  });

  it('contains exactly one h1 heading with folder name', () => {
    const tmpl = buildIndexTemplate('areas', '건강');
    const h1Matches = tmpl.match(/^# .+$/gm);
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches![0]).toBe('# 건강');
  });

  it('contains the three Korean section headings', () => {
    const tmpl = buildIndexTemplate('resources', 'AI 에이전트');
    expect(tmpl).toContain('## 설명');
    expect(tmpl).toContain('## 포함할 내용');
    expect(tmpl).toContain('## 제외할 내용');
  });

  it('does not inject extra frontmatter keys for folder name with colon', () => {
    const tmpl = buildIndexTemplate('projects', 'Name: with colon');
    const paraMatches = tmpl.match(/^para:/gm);
    expect(paraMatches).toHaveLength(1);
    expect(tmpl).toContain('Name: with colon');
  });

  it('handles folder name with double quotes safely', () => {
    const tmpl = buildIndexTemplate('projects', 'Name "quoted"');
    const paraMatches = tmpl.match(/^para:/gm);
    expect(paraMatches).toHaveLength(1);
  });

  it('strips newlines from folder name', () => {
    const withNewline = 'Name\nWith Newline';
    const tmpl = buildIndexTemplate('projects', withNewline);
    const h1Matches = tmpl.match(/^# .+$/gm);
    expect(h1Matches).toHaveLength(1);
  });

  it('handles folder name with three dashes', () => {
    const tmpl = buildIndexTemplate('areas', '--- separator ---');
    const yamlBlocks = tmpl.match(/^---$/gm);
    expect(yamlBlocks).toHaveLength(2);
  });

  it('uses archives category', () => {
    const tmpl = buildIndexTemplate('archives', '완료한 프로젝트');
    expect(tmpl).toContain('para: archives');
  });
});

describe('ensureParaRoots - SET-02', () => {
  it('creates all five roots when vault is empty', async () => {
    const vault = new FakeVault();
    const result = await ensureParaRoots(vault);
    expect(result.created).toHaveLength(5);
    expect(result.conflicts).toHaveLength(0);
    const folders = await vault.listFolders();
    expect(folders).toContain('0. Inbox');
    expect(folders).toContain('1. Projects');
    expect(folders).toContain('2. Areas');
    expect(folders).toContain('3. Resources');
    expect(folders).toContain('4. Archives');
  });

  it('skips already existing roots', async () => {
    const vault = new FakeVault({}, ['0. Inbox', '1. Projects', '2. Areas', '3. Resources', '4. Archives']);
    const result = await ensureParaRoots(vault);
    expect(result.created).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('is idempotent - calling twice creates roots only once', async () => {
    const vault = new FakeVault();
    await ensureParaRoots(vault);
    const logBefore = vault.log.filter(l => l.startsWith('createFolder')).length;
    await ensureParaRoots(vault);
    const logAfter = vault.log.filter(l => l.startsWith('createFolder')).length;
    expect(logAfter).toBe(logBefore);
  });

  it('SET-03: reports conflict when a root path exists as file', async () => {
    const vault = new FakeVault({ '1. Projects': 'file content' });
    const result = await ensureParaRoots(vault);
    expect(result.conflicts).toContain('1. Projects');
    expect(await vault.read('1. Projects')).toBe('file content');
    expect(result.created).toContain('0. Inbox');
    expect(result.created).not.toContain('1. Projects');
  });

  it('does not create example subfolders or sample notes', async () => {
    const vault = new FakeVault();
    await ensureParaRoots(vault);
    const allFiles = await vault.listMarkdownFiles();
    expect(allFiles).toHaveLength(0);
    const allFolders = await vault.listFolders();
    expect(allFolders).toHaveLength(5);
  });
});

describe('ensureIndex - IDX-01, IDX-02, IDX-03, IDX-04', () => {
  it('IDX-01: creates INDEX for a direct child of Projects', async () => {
    const vault = new FakeVault({}, ['1. Projects', '1. Projects/서비스 출시']);
    const result = await ensureIndex(vault, 'projects', '1. Projects/서비스 출시');
    expect(result).toBe('created');
    const content = await vault.read('1. Projects/서비스 출시/INDEX.md');
    expect(content).toContain('para: projects');
    expect(content).toContain('# 서비스 출시');
  });

  it('IDX-03: returns preserved when INDEX already exists with same casing', async () => {
    const vault = new FakeVault(
      { '1. Projects/서비스 출시/INDEX.md': '---\npara: projects\n---\n# 서비스 출시\n' },
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const result = await ensureIndex(vault, 'projects', '1. Projects/서비스 출시');
    expect(result).toBe('preserved');
  });

  it('IDX-03: returns preserved when case-variant INDEX exists (index.md)', async () => {
    const vault = new FakeVault(
      { '1. Projects/서비스 출시/index.md': 'some content' },
      ['1. Projects', '1. Projects/서비스 출시'],
    );
    const result = await ensureIndex(vault, 'projects', '1. Projects/서비스 출시');
    expect(result).toBe('preserved');
  });

  it('IDX-02: skips when folder is not a direct child of a PARA root', async () => {
    const vault = new FakeVault({}, ['1. Projects', '1. Projects/서비스 출시', '1. Projects/서비스 출시/sub']);
    const result = await ensureIndex(vault, 'projects', '1. Projects/서비스 출시/sub');
    expect(result).toBe('skipped');
  });

  it('IDX-02: skips excluded folders (underscore prefix)', async () => {
    const vault = new FakeVault({}, ['1. Projects', '1. Projects/_임시']);
    const result = await ensureIndex(vault, 'projects', '1. Projects/_임시');
    expect(result).toBe('skipped');
  });

  it('IDX-02: skips hidden folders (dot prefix)', async () => {
    const vault = new FakeVault({}, ['1. Projects', '1. Projects/.숨김']);
    const result = await ensureIndex(vault, 'projects', '1. Projects/.숨김');
    expect(result).toBe('skipped');
  });

  it('IDX-04: does not overwrite an existing empty INDEX file', async () => {
    const vault = new FakeVault(
      { '2. Areas/건강/INDEX.md': '' },
      ['2. Areas', '2. Areas/건강'],
    );
    const result = await ensureIndex(vault, 'areas', '2. Areas/건강');
    expect(result).toBe('preserved');
    expect(await vault.read('2. Areas/건강/INDEX.md')).toBe('');
  });

  it('IDX-01: archives folders get INDEX created', async () => {
    const vault = new FakeVault({}, ['4. Archives', '4. Archives/완료한 프로젝트']);
    const result = await ensureIndex(vault, 'archives', '4. Archives/완료한 프로젝트');
    expect(result).toBe('created');
  });
});

describe('ensureIndexesForVault - IDX-08, IDX-09, IDX-10', () => {
  it('IDX-08: creates indexes for all eligible folders on first call', async () => {
    const vault = new FakeVault(
      {},
      [
        '1. Projects', '1. Projects/서비스 출시',
        '2. Areas', '2. Areas/건강',
        '3. Resources', '3. Resources/AI_에이전트',
        '4. Archives',
      ],
    );
    const result = await ensureIndexesForVault(vault);
    expect(result.created).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
  });

  it('IDX-09: idempotent - calling twice produces no extra creates', async () => {
    const vault = new FakeVault(
      {},
      [
        '1. Projects', '1. Projects/서비스 출시',
        '2. Areas', '2. Areas/건강',
      ],
    );
    const first = await ensureIndexesForVault(vault);
    const second = await ensureIndexesForVault(vault);
    expect(second.created).toHaveLength(0);
    expect(first.created.length).toBeGreaterThan(0);
  });

  it('IDX-10: skips excluded and deep folders', async () => {
    const vault = new FakeVault(
      {},
      [
        '1. Projects',
        '1. Projects/_임시',
        '1. Projects/서비스 출시',
        '1. Projects/서비스 출시/sub',
      ],
    );
    const result = await ensureIndexesForVault(vault);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toBe('1. Projects/서비스 출시');
  });
});

