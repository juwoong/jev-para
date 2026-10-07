import { describe, it, expect } from 'vitest';
import {
  splitPath,
  joinPath,
  parentPath,
  baseName,
  isExcludedFolderPath,
  isReservedIndexFile,
  directChildFolders,
  isDirectChildPath,
} from '../../src/para/paths';

describe('splitPath', () => {
  it('splits a simple path', () => {
    expect(splitPath('1. Projects/서비스 출시')).toEqual(['1. Projects', '서비스 출시']);
  });
  it('handles leading slash', () => {
    expect(splitPath('/foo/bar')).toEqual(['foo', 'bar']);
  });
  it('handles empty string', () => {
    expect(splitPath('')).toEqual([]);
  });
});

describe('joinPath', () => {
  it('joins parts with slash', () => {
    expect(joinPath('1. Projects', '서비스 출시')).toBe('1. Projects/서비스 출시');
  });
  it('filters empty parts', () => {
    expect(joinPath('', 'a', '', 'b')).toBe('a/b');
  });
});

describe('parentPath', () => {
  it('returns parent of a nested path', () => {
    expect(parentPath('1. Projects/서비스 출시')).toBe('1. Projects');
  });
  it('returns empty string for top-level', () => {
    expect(parentPath('0. Inbox')).toBe('');
  });
  it('returns parent for deeply nested', () => {
    expect(parentPath('1. Projects/sub/deep')).toBe('1. Projects/sub');
  });
});

describe('baseName', () => {
  it('returns last segment', () => {
    expect(baseName('1. Projects/서비스 출시')).toBe('서비스 출시');
  });
  it('returns single segment', () => {
    expect(baseName('0. Inbox')).toBe('0. Inbox');
  });
});

describe('isExcludedFolderPath - SET-05', () => {
  it.each([
    ['_임시', true],
    ['_dev/something', true],
    ['1. Projects/_private', true],
    ['.숨김', true],
    ['.obsidian/plugins', true],
    ['1. Projects/AI_에이전트', false],
    ['1. Projects/서비스 출시', false],
    ['2. Areas/건강', false],
    ['3. Resources/AI_에이전트', false],
    ['0. Inbox', false],
  ])('isExcludedFolderPath(%s) === %s', (path, expected) => {
    expect(isExcludedFolderPath(path)).toBe(expected);
  });
});

describe('isReservedIndexFile - SET-04', () => {
  it.each([
    ['INDEX.md', true],
    ['index.md', true],
    ['Index.md', true],
    ['INDEX.MD', true],
    ['index.MD', true],
    ['iNdEx.mD', true],
    ['readme.md', false],
    ['some-note.md', false],
    ['INDEX.txt', false],
  ])('isReservedIndexFile(%s) === %s', (filename, expected) => {
    expect(isReservedIndexFile(filename)).toBe(expected);
  });
});

describe('isDirectChildPath - IDX-02', () => {
  it('detects direct child', () => {
    expect(isDirectChildPath('1. Projects/서비스 출시', '1. Projects')).toBe(true);
  });
  it('rejects deeper nesting', () => {
    expect(isDirectChildPath('1. Projects/서비스 출시/sub', '1. Projects')).toBe(false);
  });
  it('rejects the root itself', () => {
    expect(isDirectChildPath('1. Projects', '1. Projects')).toBe(false);
  });
  it('rejects paths under different root', () => {
    expect(isDirectChildPath('2. Areas/건강', '1. Projects')).toBe(false);
  });
});

describe('directChildFolders', () => {
  const allFolders = [
    '1. Projects',
    '1. Projects/서비스 출시',
    '1. Projects/서비스 출시/sub',
    '1. Projects/다른 프로젝트',
    '2. Areas',
    '2. Areas/건강',
  ];

  it('returns only direct children of root', () => {
    const result = directChildFolders(allFolders, '1. Projects');
    expect(result.sort()).toEqual(
      ['1. Projects/서비스 출시', '1. Projects/다른 프로젝트'].sort(),
    );
  });

  it('returns direct children of areas', () => {
    expect(directChildFolders(allFolders, '2. Areas')).toEqual(['2. Areas/건강']);
  });

  it('returns empty for leaf folder', () => {
    expect(directChildFolders(allFolders, '2. Areas/건강')).toEqual([]);
  });
});
