import {
  PARA_ROOTS,
  INBOX_ROOT,
  SORTABLE_CATEGORIES,
  INDEX_FILENAME,
  type VaultPort,
  type ParaCategory,
  type Candidate,
} from '../ports';
import { contentHash } from '../hash';
import {
  joinPath,
  parentPath,
  baseName,
  isExcludedFolderPath,
  isReservedIndexFile,
  isDirectChildPath,
  directChildFolders,
} from './paths';

export interface IndexFields {
  para: string | null;
  title: string | null;
  description: string;
  include: string;
  exclude: string;
}

// ---------------------------------------------------------------------------
// parseIndex
// ---------------------------------------------------------------------------

function parseFrontmatter(markdown: string): { para: string | null; title: string | null; rest: string } {
  const fmMatch = markdown.match(/^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) return { para: null, title: null, rest: markdown };
  const yaml = fmMatch[1];
  const rest = fmMatch[2] ?? '';
  let para: string | null = null;
  let title: string | null = null;
  for (const line of yaml.split('\n')) {
    const paraMatch = line.match(/^para:\s*(.+)$/);
    if (paraMatch) para = paraMatch[1].trim().replace(/^["']|["']$/g, '');
    const titleMatch = line.match(/^title:\s*(.+)$/);
    if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  return { para, title, rest };
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function extractSection(markdown: string, sectionTitle: string): string {
  const lines = markdown.split('\n');
  let sectionLevel = -1;
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const hMatch = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (hMatch && hMatch[2].trim() === sectionTitle) {
      sectionLevel = hMatch[1].length;
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart === -1) return '';

  const bodyLines: string[] = [];
  for (let i = sectionStart; i < lines.length; i++) {
    const hMatch = lines[i].match(/^(#{1,6})\s+/);
    if (hMatch && hMatch[1].length <= sectionLevel) break;
    bodyLines.push(lines[i]);
  }
  return stripHtmlComments(bodyLines.join('\n').trim());
}

export function parseIndex(markdown: string): IndexFields {
  const { para, title, rest } = parseFrontmatter(markdown);
  const description = extractSection(rest, 'Description') || extractSection(rest, '설명');
  const include = extractSection(rest, 'Include') || extractSection(rest, '포함할 내용');
  const exclude = extractSection(rest, 'Exclude') || extractSection(rest, '제외할 내용');
  return { para, title, description, include, exclude };
}

export function isDescriptionActive(fields: IndexFields): boolean {
  return fields.description.length > 0;
}

// ---------------------------------------------------------------------------
// buildIndexTemplate
// ---------------------------------------------------------------------------


function markdownSafeFolderName(name: string): string {
  return name.replace(/\r?\n/g, ' ').trim();
}

export function buildIndexTemplate(category: ParaCategory, folderName: string): string {
  const mdName = markdownSafeFolderName(folderName);
  return `---
para: ${category}
---

# ${mdName}

## Description
<!-- Describe the purpose of this folder and what belongs here. -->

## Include
<!-- List characteristics or examples of notes to include. -->

## Exclude
<!-- Describe notes that belong in other folders. -->
`;
}

// ---------------------------------------------------------------------------
// ensureParaRoots
// ---------------------------------------------------------------------------

export async function ensureParaRoots(
  vault: VaultPort,
): Promise<{ created: string[]; conflicts: string[] }> {
  const roots = [
    INBOX_ROOT,
    PARA_ROOTS.projects,
    PARA_ROOTS.areas,
    PARA_ROOTS.resources,
    PARA_ROOTS.archives,
  ];
  const created: string[] = [];
  const conflicts: string[] = [];

  for (const root of roots) {
    const exists = await vault.exists(root);
    if (!exists) {
      await vault.createFolder(root);
      created.push(root);
    } else {
      const folders = await vault.listFolders();
      if (!folders.includes(root)) {
        conflicts.push(root);
      }
    }
  }
  return { created, conflicts };
}

// ---------------------------------------------------------------------------
// ensureIndex
// ---------------------------------------------------------------------------

async function hasIndexFile(vault: VaultPort, folderPath: string): Promise<boolean> {
  const files = await vault.listMarkdownFiles();
  return files.some((f) => {
    const parent = parentPath(f);
    const base = baseName(f);
    return parent === folderPath && isReservedIndexFile(base);
  });
}

function inferCategory(folderPath: string): ParaCategory | null {
  for (const [cat, root] of Object.entries(PARA_ROOTS) as [ParaCategory, string][]) {
    if (isDirectChildPath(folderPath, root)) return cat;
  }
  return null;
}

export async function ensureIndex(
  vault: VaultPort,
  category: ParaCategory,
  folderPath: string,
): Promise<'created' | 'preserved' | 'skipped'> {
  const realCategory = inferCategory(folderPath);
  if (realCategory === null) return 'skipped';

  if (isExcludedFolderPath(folderPath)) return 'skipped';

  if (await hasIndexFile(vault, folderPath)) return 'preserved';

  const folderName = baseName(folderPath);
  const template = buildIndexTemplate(category, folderName);
  const indexPath = joinPath(folderPath, INDEX_FILENAME);
  await vault.write(indexPath, template);
  return 'created';
}

// ---------------------------------------------------------------------------
// ensureIndexesForVault
// ---------------------------------------------------------------------------

export async function ensureIndexesForVault(
  vault: VaultPort,
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  const allFolders = await vault.listFolders();

  for (const [cat, root] of Object.entries(PARA_ROOTS) as [ParaCategory, string][]) {
    const children = directChildFolders(allFolders, root);
    for (const child of children) {
      const result = await ensureIndex(vault, cat, child);
      if (result === 'created') {
        created.push(child);
      } else if (result === 'skipped') {
        skipped.push(child);
      }
    }
  }
  return { created, skipped };
}

// ---------------------------------------------------------------------------
// collectCandidates
// ---------------------------------------------------------------------------

function makeCandidateId(category: ParaCategory, folderPath: string): string {
  return contentHash(`${category}:${folderPath}`);
}

export async function collectCandidates(vault: VaultPort): Promise<Candidate[]> {
  const allFiles = await vault.listMarkdownFiles();
  const allFolders = await vault.listFolders();
  const candidates: Candidate[] = [];

  for (const cat of SORTABLE_CATEGORIES) {
    const root = PARA_ROOTS[cat];
    const children = directChildFolders(allFolders, root);

    for (const folderPath of children) {
      if (isExcludedFolderPath(folderPath)) continue;

      const indexFile = allFiles.find((f) => {
        const parent = parentPath(f);
        const base = baseName(f);
        return parent === folderPath && isReservedIndexFile(base);
      });
      if (!indexFile) continue;

      let content: string;
      try {
        content = await vault.read(indexFile);
      } catch {
        continue;
      }

      const fields = parseIndex(content);
      if (!isDescriptionActive(fields)) continue;

      const mismatchWarning = fields.para !== null && fields.para !== cat;

      candidates.push({
        id: makeCandidateId(cat, folderPath),
        folderPath,
        category: cat,
        name: baseName(folderPath),
        description: fields.description,
        include: fields.include,
        exclude: fields.exclude,
        mismatchWarning,
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// listInboxScope
// ---------------------------------------------------------------------------

export async function listInboxScope(
  vault: VaultPort,
): Promise<{ notes: string[]; unsupported: string[]; nested: string[]; reserved: string[] }> {
  const allMarkdown = await vault.listMarkdownFiles();

  const notes: string[] = [];
  const nested: string[] = [];
  const reserved: string[] = [];
  const unsupported: string[] = [];

  for (const filePath of allMarkdown) {
    if (!filePath.startsWith(INBOX_ROOT + '/')) continue;
    const rel = filePath.slice(INBOX_ROOT.length + 1);
    const base = baseName(filePath);
    const isNested = rel.includes('/');
    const isReserved = isReservedIndexFile(base);

    if (isReserved) {
      reserved.push(filePath);
    } else if (isNested) {
      nested.push(filePath);
    } else {
      notes.push(filePath);
    }
  }

  for (const filePath of await vault.listFiles()) {
    if (!filePath.startsWith(INBOX_ROOT + '/')) continue;
    if (filePath.toLowerCase().endsWith('.md')) continue;
    const rel = filePath.slice(INBOX_ROOT.length + 1);
    if (!rel.includes('/')) unsupported.push(filePath);
  }

  return { notes, unsupported, nested, reserved };
}


// Re-export path utilities so orchestrator and other modules can import them
// from a single './para/index' entry point.
export {
  joinPath,
  parentPath,
  baseName,
  isExcludedFolderPath,
  isReservedIndexFile,
  directChildFolders,
  isDirectChildPath,
} from './paths';
