import { App, Plugin, PluginSettingTab, Setting, TFile, Notice } from 'obsidian';
import type { Orchestrator, OrchestratorSnapshot } from '../orchestrator';
import type { JevParaSettings } from '../ports';

export interface SettingsHost {
  settings: JevParaSettings;
  orchestrator: Orchestrator;
  saveSettings(): Promise<void>;
  refreshSnapshot(): Promise<OrchestratorSnapshot>;
}

export class JevParaSettingTab extends PluginSettingTab {
  private readonly hostApp: App;

  constructor(plugin: Plugin, private readonly host: SettingsHost) {
    super(plugin.app, plugin);
    this.hostApp = plugin.app;
  }

  override display(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();
    const snapshot = await this.host.refreshSnapshot();

    new Setting(containerEl)
      .setName('PARA folders')
      .setDesc('Create any missing PARA root folders: 0. Inbox, 1. Projects, 2. Areas, 3. Resources, and 4. Archives.')
      .addButton((button) =>
        button.setButtonText('Create folders').onClick(async () => {
          const outcome = await this.host.orchestrator.createParaRoots();
          const conflict = outcome.conflicts.length > 0 ? ` (${outcome.conflicts.length} conflicts)` : '';
          new Notice(`Created ${outcome.created.length} folders${conflict}`);
          this.display();
        }),
      );

    let pendingKey = '';
    {
      const keySetting = new Setting(containerEl)
        .setName('API token')
        .setDesc(
          snapshot.keySecure
            ? 'Stored in Obsidian secret storage. Saved tokens are never shown again.'
            : 'This Obsidian version has no secret storage. The token is stored in the plugin data.json file.',
        );
      keySetting.addText((text) => {
        text.inputEl.type = 'password';
        text.setPlaceholder('Paste your token and save');
        text.onChange((value) => {
          pendingKey = value;
        });
      });
      keySetting.addButton((button) =>
        button.setButtonText('Save').setCta().onClick(async () => {
          const result = await this.host.orchestrator.saveApiKey(pendingKey);
          if (!result.ok) {
            new Notice(result.message);
            this.display();
            return;
          }
          new Notice('Token saved. Testing connection...');
          const test = await this.host.orchestrator.testConnection();
          new Notice(test.ok ? `Token saved · ${test.message}` : `Token saved, but connection failed · ${test.message}`);
          this.display();
        }),
      );
      keySetting.addButton((button) =>
        button.setButtonText('Delete').onClick(async () => {
          const result = await this.host.orchestrator.clearApiKey();
          new Notice(result.message);
          this.display();
        }),
      );
    }

    const keySetting = new Setting(containerEl).setName('Token status');
    const testLine = snapshot.keyTest === null
      ? ''
      : `\nLast connection test: ${snapshot.keyTest.ok ? 'Success' : 'Failed'} · ${snapshot.keyTest.message}`;
    keySetting.setDesc(`${snapshot.key.message}${testLine}`);
    keySetting.addButton((button) =>
      button.setButtonText('Reload token').onClick(async () => {
        const result = await this.host.orchestrator.reloadKey();
        new Notice(result.message);
        this.display();
      }),
    );
    keySetting.addButton((button) =>
      button
        .setButtonText('Test connection')
        .setTooltip('Make one Jev API request with synthetic input. No note content is sent.')
        .onClick(async () => {
          const result = await this.host.orchestrator.testConnection();
          new Notice(result.message);
          this.display();
        }),
    );

    new Setting(containerEl)
      .setName('Model')
      .addText((text) => text.setValue(this.host.settings.model).onChange(async (value) => {
        this.host.settings.model = value.trim() || 'jev-latest';
        await this.host.saveSettings();
      }));

    new Setting(containerEl)
      .setName('API URL')
      .addText((text) => text.setValue(this.host.settings.baseUrl).onChange(async (value) => {
        this.host.settings.baseUrl = value.trim();
        await this.host.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Sorting mode')
      .setDesc('Automatic sorting moves high-confidence notes. Analysis sends note titles, content, and folder criteria to TypeSafe.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('manual', 'Manual preview')
          .addOption('auto', 'Automatic sorting')
          .setValue(this.host.settings.mode)
          .onChange(async (value) => {
            this.host.settings.mode = value === 'auto' ? 'auto' : 'manual';
            await this.host.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Settle time (seconds)')
      .setDesc('Wait this long after the last edit before processing a note.')
      .addText((text) =>
        text.setValue(String(this.host.settings.settleSeconds)).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 0) {
            this.host.settings.settleSeconds = parsed;
            await this.host.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Confidence threshold')
      .addText((text) => text.setValue(String(this.host.settings.minConfidence)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          this.host.settings.minConfidence = parsed;
          await this.host.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName('Probability threshold')
      .addText((text) => text.setValue(String(this.host.settings.minProbability)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          this.host.settings.minProbability = parsed;
          await this.host.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName('Top-two probability margin')
      .addText((text) => text.setValue(String(this.host.settings.minMargin)).onChange(async (value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          this.host.settings.minMargin = parsed;
          await this.host.saveSettings();
        }
      }));

    new Setting(containerEl).setName('Destination folders').setHeading();
    if (snapshot.candidates.length === 0) {
      containerEl.createEl('p', {
        text: 'No destination folders have descriptions. Add a description to each folder’s INDEX.md.',
      });
    }
    for (const candidate of snapshot.candidates) {
      const setting = new Setting(containerEl)
        .setName(candidate.folderPath)
        .setDesc(`${candidate.description}${candidate.mismatchWarning ? ' (frontmatter para value does not match the folder location)' : ''}`);
      setting.addButton((button) =>
        button.setButtonText('Open INDEX').onClick(async () => {
          const path = `${candidate.folderPath}/INDEX.md`;
          const file = this.hostApp.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) await this.hostApp.workspace.getLeaf(true).openFile(file);
          else new Notice(`INDEX.md not found: ${path}`);
        }),
      );
    }
  }
}
