import esbuild from 'esbuild';

const production = process.argv[2] === 'production';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  format: 'cjs',
  target: 'es2020',
  platform: 'node',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  logLevel: 'info',
  external: ['obsidian', 'electron', 'fs', 'path', 'os', 'node:fs', 'node:path', 'node:os'],
});
