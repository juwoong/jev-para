import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import type { Orchestrator, OrchestratorSnapshot } from '../orchestrator';
import { REFUSAL_ID, type AnalysisResult, type Candidate } from '../ports';

import { sortResults } from './resultOrder';

export const VIEW_TYPE_JEV_PARA = 'jev-para-view';

const STATE_LABEL: Record<AnalysisResult['state'], string> = {
  auto: 'Ready to move',
  review: 'Needs review',
  error: 'Errors',
  skipped: 'Skipped',
};

export class JevParaView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private readonly selected = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private readonly orchestrator: Orchestrator) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_JEV_PARA;
  }

  override getDisplayText(): string {
    return 'Jev PARA organizer';
  }

  override getIcon(): string {
    return 'sparkles';
  }

  override async onOpen(): Promise<void> {
    this.unsubscribe = this.orchestrator.subscribe((snapshot) => this.render(snapshot));
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(snapshot: OrchestratorSnapshot): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('jev-para-view');

    const summary = container.createDiv({ cls: 'jev-para-summary' });
    const counts = countStates(snapshot.results);
    summary.createSpan({ text: `Ready ${counts.auto}` });
    summary.createSpan({ text: `Review ${counts.review}` });
    summary.createSpan({ text: `Errors ${counts.error}` });
    summary.createSpan({ text: `Skipped ${counts.skipped}` });
    summary.createSpan({ text: `Pending ${snapshot.pending}` });
    summary.createSpan({ text: `Inbox notes ${snapshot.inbox.notes}` });
    summary.createSpan({ text: `Unsupported ${snapshot.inbox.unsupported}` });
    summary.createSpan({ text: `Nested notes excluded ${snapshot.inbox.nested}` });
    summary.createSpan({ text: `Destination folders ${snapshot.candidates.length}` });

    const status = container.createDiv({ cls: 'jev-para-meta' });
    const modeText = snapshot.autoPaused
      ? 'Automatic sorting paused'
      : snapshot.key.ok
        ? 'Automatic sorting ready'
        : 'Token required';
    const testText = snapshot.keyTest === null
      ? ''
      : ` · Test connection ${snapshot.keyTest.ok ? 'Success' : 'Failed'}`;
    status.setText(`Status: ${modeText} · ${snapshot.key.message}${testText}`);

    const actions = container.createDiv({ cls: 'jev-para-actions' });
    this.action(actions, 'Analyze', 'search', async () => {
      if (!snapshot.key.ok) {
        new Notice(snapshot.key.message);
        return;
      }
      const outcome = await this.orchestrator.analyzeAll();
      new Notice(`Analysis complete: ${outcome.analyzed} analyzed, ${outcome.failed} failed`);
    });
    const moveReady = this.action(actions, `Move all ready (${counts.auto})`, 'folder-input', async () => {
      const outcome = await this.orchestrator.moveAllReady();
      new Notice(`Moved ${outcome.moved}, failed ${outcome.failed}`);
    });
    moveReady.disabled = snapshot.running || counts.auto === 0;
    this.action(actions, 'Move selected', 'folder-input', async () => {
      const targets = [...this.selected].filter((path) => snapshot.results.some((result) => result.notePath === path));
      if (targets.length === 0) {
        new Notice('Select notes to move.');
        return;
      }
      const outcome = await this.orchestrator.applyMoves(targets);
      for (const path of targets) if (outcome.moved > 0) this.selected.delete(path);
      new Notice(`Moved ${outcome.moved}, failed ${outcome.failed}`);
    });
    this.action(actions, 'Retry failed', 'refresh-cw', async () => {
      const failed = snapshot.results.filter((result) => result.state === 'error').map((result) => result.notePath);
      if (failed.length === 0) {
        new Notice('No failed notes to retry.');
        return;
      }
      const outcome = await this.orchestrator.analyzeNotes(failed, { bypassCache: true });
      new Notice(`Retry complete: ${outcome.analyzed} analyzed, ${outcome.failed} failed`);
    });
    this.action(actions, 'Reanalyze without cache', 'refresh-ccw', async () => {
      if (!snapshot.key.ok) {
        new Notice(snapshot.key.message);
        return;
      }
      const outcome = await this.orchestrator.reanalyzeAll();
      new Notice(`Reanalysis complete: ${outcome.analyzed} analyzed, ${outcome.failed} failed`);
    });
    this.action(actions, 'Test connection', 'plug-zap', async () => {
      const result = await this.orchestrator.testConnection();
      new Notice(result.message);
    });
    this.action(actions, snapshot.autoPaused ? 'Resume automatic sorting' : 'Pause automatic sorting', 'pause', () => {
      this.orchestrator.setAutoPaused(!snapshot.autoPaused);
    });
    this.action(actions, 'Undo last run', 'undo-2', async () => {
      const outcome = await this.orchestrator.undoLastRun();
      new Notice(`Undone ${outcome.undone}, skipped ${outcome.skipped}`);
      if (outcome.reasons.length > 0) new Notice(outcome.reasons.slice(0, 3).join(' / '));
    });

    if (snapshot.results.length === 0) {
      container.createDiv({ cls: 'jev-para-meta', text: 'No results yet. Add notes to Inbox and click Analyze.' });
      return;
    }

    container.createDiv({ cls: 'jev-para-meta', text: 'Ready to move → Needs review → Errors → Skipped · Highest confidence first' });
    for (const result of sortResults(snapshot.results)) this.renderRow(container, result, snapshot.candidates);
  }

  private renderRow(container: HTMLElement, result: AnalysisResult, candidates: Candidate[]): void {
    const row = container.createDiv({ cls: 'jev-para-row' });
    const header = row.createDiv({ cls: 'jev-para-summary' });
    const toggle = header.createEl('input', { type: 'checkbox' });
    toggle.checked = this.selected.has(result.notePath);
    toggle.onchange = () => {
      if (toggle.checked) this.selected.add(result.notePath);
      else this.selected.delete(result.notePath);
    };
    header.createSpan({ cls: 'jev-para-row-title', text: result.notePath });

    const target = candidates.find((candidate) => candidate.id === result.candidateId);
    const destination = result.candidateId === REFUSAL_ID
      ? 'Keep in Inbox'
      : result.folderPath ?? 'Undetermined';
    header.createSpan({ text: `→ ${destination}` });
    header.createSpan({ text: `confidence ${formatNumber(result.confidence)}` });
    header.createSpan({ text: `Probability ${formatNumber(result.probability)}` });
    const stateClass = result.state === 'auto'
      ? 'jev-para-state-auto'
      : result.state === 'error'
        ? 'jev-para-state-error'
        : 'jev-para-state-review';
    header.createSpan({ cls: `jev-para-state ${stateClass}`, text: STATE_LABEL[result.state] });

    const detail = row.createDiv({ cls: 'jev-para-detail' });
    detail.createDiv({ text: `Reason: ${result.reason}` });
    if (target !== undefined) {
      detail.createDiv({ text: `Folder description: ${target.description !== '' ? target.description : '(No description)'}` });
      if (target.include !== '') detail.createDiv({ text: `Include: ${target.include}` });
      if (target.exclude !== '') detail.createDiv({ text: `Exclude: ${target.exclude}` });
    }
    if (result.top.length > 0) {
      const topText = result.top
        .map((entry) => `${entry.folderPath ?? 'Keep in Inbox'} ${formatNumber(entry.probability)}`)
        .join(' · ');
      detail.createDiv({ text: `Top candidates: ${topText}` });
    }

    const override = detail.createEl('select');
    const keep = override.createEl('option', { text: 'Keep in Inbox', value: REFUSAL_ID });
    keep.selected = result.candidateId === REFUSAL_ID;
    for (const candidate of candidates) {
      const option = override.createEl('option', { text: candidate.folderPath, value: candidate.id });
      option.selected = candidate.id === result.candidateId;
    }
    override.onchange = () => {
      const candidate = candidates.find((entry) => entry.id === override.value);
      result.candidateId = override.value;
      result.folderPath = candidate?.folderPath ?? null;
      result.state = 'review';
      result.reason = 'Destination selected manually.';
    };
  }

  private action(container: HTMLElement, label: string, icon: string, handler: () => void | Promise<void>): HTMLButtonElement {
    const button = container.createEl('button');
    const iconEl = button.createSpan();
    setIcon(iconEl, icon);
    button.createSpan({ text: label });
    button.onclick = () => void handler();
    return button;
  }
}

function countStates(results: AnalysisResult[]): Record<AnalysisResult['state'], number> {
  const counts: Record<AnalysisResult['state'], number> = { auto: 0, review: 0, error: 0, skipped: 0 };
  for (const result of results) counts[result.state] += 1;
  return counts;
}

function formatNumber(value: number | null): string {
  return value === null ? '-' : value.toFixed(2);
}
