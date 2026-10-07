import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { contentHash } from '../hash';
import type { VaultPort } from '../ports';

function toVaultPath(path: string): string {
  return normalizePath(path).replace(/^\.\//, '').replace(/\/$/, '');
}

export class ObsidianVault implements VaultPort {
  constructor(private readonly app: App) {}

  async listFolders(): Promise<string[]> {
    const paths: string[] = [];
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file instanceof TFolder && file.path !== '/' && file.path.length > 0) paths.push(file.path);
    }
    return paths.sort();
  }

  async listMarkdownFiles(): Promise<string[]> {
    return this.app.vault.getMarkdownFiles().map((file) => file.path).sort();
  }

  async listFiles(): Promise<string[]> {
    const paths: string[] = [];
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file instanceof TFile) paths.push(file.path);
    }
    return paths.sort();
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(toVaultPath(path)) !== null;
  }

  async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(toVaultPath(path));
    if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
    return this.app.vault.cachedRead(file);
  }

  async write(path: string, data: string): Promise<void> {
    const normalized = toVaultPath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, data);
      return;
    }
    await this.ensureParentFolder(normalized);
    await this.app.vault.create(normalized, data);
  }

  async createFolder(path: string): Promise<void> {
    const normalized = toVaultPath(path);
    if (this.app.vault.getAbstractFileByPath(normalized) !== null) return;
    await this.ensureParentFolder(normalized);
    await this.app.vault.createFolder(normalized);
  }

  async rename(from: string, to: string): Promise<void> {
    const source = this.app.vault.getAbstractFileByPath(toVaultPath(from));
    if (source === null) throw new Error(`Source not found: ${from}`);
    await this.ensureParentFolder(toVaultPath(to));
    await this.app.fileManager.renameFile(source, toVaultPath(to));
  }

  async hash(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(toVaultPath(path));
    if (!(file instanceof TFile)) return null;
    return contentHash(await this.app.vault.cachedRead(file));
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const segments = path.split('/');
    segments.pop();
    let current = '';
    for (const segment of segments) {
      current = current.length === 0 ? segment : `${current}/${segment}`;
      if (this.app.vault.getAbstractFileByPath(current) === null) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}
