import type { ApiKeyStorePort, StorePort } from '../ports';

export interface SecretStorageLike {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

const SECRET_ID = 'jev-para-api-key';
const FALLBACK_KEY = 'jev-para:apiKey';

/**
 * Stores the API key in Obsidian's encrypted secret storage when the running version provides it
 * (app.secretStorage). Older versions fall back to the plugin data.json and the settings UI says so.
 */
export class KeyStore implements ApiKeyStorePort {
  constructor(
    private readonly options: { secretStorage?: SecretStorageLike | null; store: StorePort },
  ) {}

  get secure(): boolean {
    return this.options.secretStorage !== null && this.options.secretStorage !== undefined;
  }

  async get(): Promise<string | null> {
    const secret = this.options.secretStorage?.getSecret(SECRET_ID);
    if (typeof secret === 'string' && secret.trim() !== '') return secret.trim();
    const stored = await this.options.store.get<string>(FALLBACK_KEY);
    return typeof stored === 'string' && stored.trim() !== '' ? stored.trim() : null;
  }

  async set(value: string): Promise<void> {
    if (this.secure) {
      this.options.secretStorage?.setSecret(SECRET_ID, value);
      await this.options.store.set<string | null>(FALLBACK_KEY, null);
      return;
    }
    await this.options.store.set(FALLBACK_KEY, value);
  }

  async clear(): Promise<void> {
    if (this.secure) this.options.secretStorage?.setSecret(SECRET_ID, '');
    await this.options.store.set<string | null>(FALLBACK_KEY, null);
  }
}
