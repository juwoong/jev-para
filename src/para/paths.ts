
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

/**
 * Returns true if any component of the path starts with '_' or '.'.
 * A mid-name underscore (e.g. AI_agents) is allowed.
 */
export function isExcludedFolderPath(path: string): boolean {
  return splitPath(path).some((part) => part.startsWith('_') || part.startsWith('.'));
}

/**
 * Returns true if the filename is a case-insensitive match for INDEX.md.
 */
export function isReservedIndexFile(filename: string): boolean {
  return filename.toLowerCase() === 'index.md';
}

/**
 * Returns true iff folderPath is exactly one level below root.
 */
export function isDirectChildPath(folderPath: string, root: string): boolean {
  if (!folderPath.startsWith(root + '/')) return false;
  const rest = folderPath.slice(root.length + 1);
  return rest.length > 0 && !rest.includes('/');
}

/**
 * Returns the direct child folders of root from the full folder list.
 */
export function directChildFolders(allFolders: string[], root: string): string[] {
  return allFolders.filter((f) => isDirectChildPath(f, root));
}
