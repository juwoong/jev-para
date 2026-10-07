import type { StorePort } from '../ports';

export interface DataAdapter {
  load(): Promise<unknown>;
  save(data: unknown): Promise<void>;
}

/** Namespaced key/value view over the plugin data.json file. */
export class PluginStore implements StorePort {
  constructor(private readonly adapter: DataAdapter) {}

  async get<T>(key: string): Promise<T | null> {
    const data = await this.readAll();
    const value = data[key];
    return value === undefined ? null : (value as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    const data = await this.readAll();
    data[key] = value;
    await this.adapter.save(data);
  }

  private async readAll(): Promise<Record<string, unknown>> {
    const raw = await this.adapter.load();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return { ...(raw as Record<string, unknown>) };
  }
}
