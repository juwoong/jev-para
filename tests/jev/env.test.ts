import { describe, it, expect } from 'vitest';
import { parseEnvFile, loadApiKey } from '../../src/jev/env';
import { FakeFilePort } from '../helpers/fakes';

const VAULT = '/vault';

describe('parseEnvFile', () => {
  it('KEY-03: parses a plain key=value', () => {
    expect(parseEnvFile('JEV_API_KEY=hello')).toEqual({ JEV_API_KEY: 'hello' });
  });

  it('KEY-03: ignores other variables', () => {
    const result = parseEnvFile('FOO=bar\nJEV_API_KEY=mykey\nBAZ=qux');
    expect(result['JEV_API_KEY']).toBe('mykey');
    expect(result['FOO']).toBe('bar');
  });

  it('KEY-03: strips double quotes', () => {
    expect(parseEnvFile('JEV_API_KEY="hello world"')).toEqual({ JEV_API_KEY: 'hello world' });
  });

  it('KEY-03: strips single quotes', () => {
    expect(parseEnvFile("JEV_API_KEY='hello world'")).toEqual({ JEV_API_KEY: 'hello world' });
  });

  it('KEY-03: handles export prefix', () => {
    expect(parseEnvFile('export JEV_API_KEY=exported')).toEqual({ JEV_API_KEY: 'exported' });
  });

  it('KEY-03: ignores hash comments', () => {
    const result = parseEnvFile('# this is a comment\nJEV_API_KEY=abc\n# another comment');
    expect(result['JEV_API_KEY']).toBe('abc');
  });

  it('KEY-03: ignores blank lines', () => {
    const result = parseEnvFile('\n\nJEV_API_KEY=abc\n\n');
    expect(result['JEV_API_KEY']).toBe('abc');
  });

  it('KEY-03: does not execute command-like strings', () => {
    const dangerous = 'JEV_API_KEY=\$(dangerous_command)';
    const result = parseEnvFile(dangerous);
    expect(result['JEV_API_KEY']).toBe('\$(dangerous_command)');
  });

  it('KEY-03: handles inline comments after unquoted value', () => {
    const result = parseEnvFile('JEV_API_KEY=mykey # comment here');
    expect(result['JEV_API_KEY']).toBe('mykey');
  });
});

describe('loadApiKey', () => {
  it('KEY-01: loads key from .env file', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/vault/_dev/jev-para/.env', 'JEV_API_KEY=sk-test-key');
    fp.realPaths.set('/vault/_dev/jev-para/.env', '/vault/_dev/jev-para/.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '_dev/jev-para/.env', filePort: fp });
    expect(result.ok).toBe(true);
    expect(result.key).toBe('sk-test-key');
  });

  it('KEY-02: file missing returns ok=false with English message', async () => {
    const fp = new FakeFilePort();
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '_dev/jev-para/.env', filePort: fp });
    expect(result.ok).toBe(false);
    expect(result.key).toBeNull();
    expect(result.message).toBe('Cannot find or read the .env file.');
  });

  it('KEY-02: empty key returns ok=false with English message', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/vault/_dev/jev-para/.env', 'JEV_API_KEY=');
    fp.realPaths.set('/vault/_dev/jev-para/.env', '/vault/_dev/jev-para/.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '_dev/jev-para/.env', filePort: fp });
    expect(result.ok).toBe(false);
    expect(result.message).toBe('JEV_API_KEY is missing or empty in .env.');
  });

  it('KEY-02: whitespace-only key returns ok=false', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/vault/_dev/jev-para/.env', 'JEV_API_KEY=   ');
    fp.realPaths.set('/vault/_dev/jev-para/.env', '/vault/_dev/jev-para/.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '_dev/jev-para/.env', filePort: fp });
    expect(result.ok).toBe(false);
  });

  it('KEY-02: missing JEV_API_KEY entry returns ok=false', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/vault/_dev/jev-para/.env', 'OTHER_KEY=something');
    fp.realPaths.set('/vault/_dev/jev-para/.env', '/vault/_dev/jev-para/.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '_dev/jev-para/.env', filePort: fp });
    expect(result.ok).toBe(false);
  });

  it('KEY-04: reads an explicitly configured absolute envPath outside the vault', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/projects/jev/.env', 'JEV_API_KEY=absolute-key');
    fp.realPaths.set('/projects/jev/.env', '/projects/jev/.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '/projects/jev/.env', filePort: fp });
    expect(result.ok).toBe(true);
    expect(result.key).toBe('absolute-key');
  });

  it('KEY-04: rejects an absolute envPath that does not exist', async () => {
    const fp = new FakeFilePort();
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '/missing/.env', filePort: fp });
    expect(result.ok).toBe(false);
  });

  it('KEY-04: rejects path traversal escaping vault', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/outside/secret.env', 'JEV_API_KEY=stolen');
    fp.realPaths.set('/vault/../outside/secret.env', '/outside/secret.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '../outside/secret.env', filePort: fp });
    expect(result.ok).toBe(false);
  });

  it('KEY-04: rejects symlink pointing outside vault', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/vault/link.env', 'JEV_API_KEY=stolen');
    fp.realPaths.set('/vault/link.env', '/outside/real.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: 'link.env', filePort: fp });
    expect(result.ok).toBe(false);
  });

  it('KEY-06: message does not include the key value', async () => {
    const fp = new FakeFilePort();
    fp.files.set('/vault/_dev/jev-para/.env', 'JEV_API_KEY=sk-super-secret-12345');
    fp.realPaths.set('/vault/_dev/jev-para/.env', '/vault/_dev/jev-para/.env');
    const result = await loadApiKey({ vaultRoot: VAULT, envPath: '_dev/jev-para/.env', filePort: fp });
    if (result.ok) {
      expect(result.message).not.toContain('sk-super-secret-12345');
    }
  });
});
