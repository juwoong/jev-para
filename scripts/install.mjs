import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const targetVault = process.env.JEV_PARA_VAULT ?? '/Users/juwoong/vaults/testing';
const pluginDir = join(targetVault, '.obsidian', 'plugins', 'jev-para');

const artifacts = ['main.js', 'manifest.json', 'styles.css'];

await mkdir(pluginDir, { recursive: true });
for (const artifact of artifacts) {
  await copyFile(join(projectRoot, artifact), join(pluginDir, artifact));
  console.log(`copied ${artifact} -> ${pluginDir}`);
}
