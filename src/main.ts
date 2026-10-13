import { App, Plugin, TFolder, WorkspaceLeaf } from 'obsidian';
import { KeyStore, type SecretStorageLike } from './adapters/keyStore';
import { ObsidianVault } from './adapters/obsidianVault';
import { PluginStore } from './adapters/pluginStore';
import { RequestUrlHttp } from './adapters/requestUrlHttp';
import { Orchestrator, type OrchestratorSnapshot } from './orchestrator';
import { DEFAULT_SETTINGS, type JevParaSettings } from './ports';
import { JevParaSettingTab } from './ui/settings';
import { JevParaView, VIEW_TYPE_JEV_PARA } from './ui/view';

export default class JevParaPlugin extends Plugin {
  paraSettings: JevParaSettings = { ...DEFAULT_SETTINGS };
  private orchestrator!: Orchestrator;

  override async onload(): Promise<void> {
    await this.loadSettings();

    const pluginStore = new PluginStore({
      load: () => this.loadData(),
      save: (data) => this.saveData(data),
    });
    const secretStorage =
      (this.app as unknown as { secretStorage?: SecretStorageLike | null }).secretStorage ?? null;

    this.orchestrator = new Orchestrator({
      vault: new ObsidianVault(this.app),
      http: new RequestUrlHttp(),
      store: pluginStore,
      keyStore: new KeyStore({ secretStorage, store: pluginStore }),
      clock: {
        now: () => Date.now(),
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle),
      },
      getSettings: () => this.paraSettings,
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      isActiveEditor: (path) => this.app.workspace.getActiveFile()?.path === path,
      logDebug: (message) => console.debug(`[jev-para] ${message}`),
      logError: (message) => console.error(`[jev-para] ${message}`),
    });

    this.registerView(VIEW_TYPE_JEV_PARA, (leaf: WorkspaceLeaf) => new JevParaView(leaf, this.orchestrator));
    this.addRibbonIcon('sparkles', 'Jev PARA organizer', () => void this.activateView());
    this.addCommand({
      id: 'open-organizer',
      name: 'Open Jev PARA organizer',
      callback: () => void this.activateView(),
    });
    this.addSettingTab(
      new JevParaSettingTab(this, {
        settings: this.paraSettings,
        orchestrator: this.orchestrator,
        saveSettings: () => this.saveSettings(),
        refreshSnapshot: async (): Promise<OrchestratorSnapshot> => {
          await this.orchestrator.refreshCandidates();
          return this.orchestrator.snapshot();
        },
      }),
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => this.orchestrator.onFileChange(file.path, 'create', file instanceof TFolder)),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => this.orchestrator.onFileChange(file.path, 'modify', file instanceof TFolder)),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => this.orchestrator.onFileChange(file.path, 'delete', file instanceof TFolder)),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => this.orchestrator.onFileRename(file.path, oldPath, file instanceof TFolder)),
    );

    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        await this.orchestrator.init();
        await this.orchestrator.start();
      })();
    });
  }

  override onunload(): void {
    this.orchestrator.dispose();
  }

  async saveSettings(): Promise<void> {
    const data = ((await this.loadData()) as Record<string, unknown> | null) ?? {};
    data.settings = this.paraSettings;
    await this.saveData(data);
  }

  private async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as { settings?: Partial<JevParaSettings> } | null;
    this.paraSettings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_JEV_PARA);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) return;
    await leaf.setViewState({ type: VIEW_TYPE_JEV_PARA, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
