#!/usr/bin/env node
/*
 * Copies the built board into Barrelo's vendored-plugin folder.
 *
 * Barrelo serves plugins/{gameId}/ui/index.html as a static file with no build step, so it needs the
 * *contents of* ui/dist — not ui/ itself. Copying ui/ is the known failure mode: the board silently
 * falls back to a raw JSON dump, because the unbuilt index.html's module script can't load without
 * Vite's dev server behind it.
 *
 * The destination ui/ is removed rather than merged. Vite content-hashes the bundle filename, so a
 * merge would leave every previous build's index-*.js behind to be copied and published forever.
 *
 * Usage: node scripts/deploy.mjs [destination]
 */
import { cp, mkdir, rm, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DEST = 'C:/Projects/Darts/Barrelo/external-plugins/putt-putt';
const dest = resolve(process.argv[2] ?? DEFAULT_DEST);

const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));

// The host matches the folder name against the manifest's gameId and fetches the board from
// /plugins/{gameId}/ui/ — a mismatch loads nothing and 404s silently.
if (basename(dest) !== manifest.gameId) {
  console.error(`Destination folder "${basename(dest)}" must be named "${manifest.gameId}".`);
  process.exit(1);
}

const distDir = join(root, 'ui', 'dist');
try {
  await access(join(distDir, 'index.html'));
} catch {
  console.error('ui/dist/index.html not found — run `npm run build` first.');
  process.exit(1);
}

await mkdir(dest, { recursive: true });
await rm(join(dest, 'ui'), { recursive: true, force: true });

await mkdir(join(dest, 'ui'), { recursive: true });
await cp(distDir, join(dest, 'ui'), { recursive: true });
await cp(join(root, 'plugin.json'), join(dest, 'plugin.json'));

console.log(`Deployed putt-putt (protocolVersion ${manifest.protocolVersion}) to ${dest}`);
