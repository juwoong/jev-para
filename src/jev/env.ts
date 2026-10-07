import type { FilePort, KeyLoadResult } from '../ports';
import * as nodePath from 'path';

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Strip optional 'export ' prefix
    const stripped = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const eqIndex = stripped.indexOf('=');
    if (eqIndex < 0) continue;
    const key = stripped.slice(0, eqIndex).trim();
    if (!key) continue;
    let value = stripped.slice(eqIndex + 1);
    // Strip inline comment for unquoted values
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) value = value.slice(0, commentIdx);
      value = value.trim();
    }
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function isInside(target: string, root: string): boolean {
  const normalizedRoot = nodePath.resolve(root);
  const normalizedTarget = nodePath.resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + nodePath.sep);
}

export async function loadApiKey(input: {
  vaultRoot: string;
  envPath: string;
  filePort: FilePort;
}): Promise<KeyLoadResult> {
  const { vaultRoot, envPath, filePort } = input;

  // A relative path is resolved inside the vault and may not escape it. An absolute path is
  // allowed only because the user configured it explicitly in the plugin settings, which notes
  // cannot influence; it still has to resolve to a readable file.
  const explicitAbsolute = nodePath.isAbsolute(envPath);
  const resolved = explicitAbsolute ? nodePath.normalize(envPath) : nodePath.resolve(vaultRoot, envPath);

  if (!explicitAbsolute && !isInside(resolved, vaultRoot)) {
    return { ok: false, key: null, message: '.env path is outside the vault.' };
  }

  let realResolved: string;
  try {
    realResolved = await filePort.realPath(resolved);
  } catch {
    return { ok: false, key: null, message: 'Cannot resolve the .env path.' };
  }

  if (!explicitAbsolute && !isInside(realResolved, vaultRoot)) {
    return { ok: false, key: null, message: 'The resolved .env path is outside the vault. Check symlinks.' };
  }

  let content: string;
  try {
    content = await filePort.readTextFile(resolved);
  } catch {
    return { ok: false, key: null, message: 'Cannot find or read the .env file.' };
  }

  const parsed = parseEnvFile(content);
  const raw = parsed['JEV_API_KEY'];

  if (!raw || raw.trim() === '') {
    return { ok: false, key: null, message: 'JEV_API_KEY is missing or empty in .env.' };
  }

  return { ok: true, key: raw.trim(), message: 'API token loaded successfully.' };
}
