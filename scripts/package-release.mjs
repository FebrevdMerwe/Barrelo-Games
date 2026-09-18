#!/usr/bin/env node
/*
 * Zips a built game into the same layout external-plugins/{gameId}/ and deploy.mjs already use:
 * plugin.json plus the *contents of* ui/dist at the zip root (as ui/). Extracting the zip straight
 * into a Barrelo plugins/{gameId}/ folder is the entire install step — same "copy dist's contents,
 * not the dist folder itself" rule as deploy.mjs, since the unbuilt index.html can't load without
 * Vite behind it.
 *
 * Usage: node scripts/package-release.mjs <gameDir> <version> [outDir=release]
 */
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [, , gameDirArg, version, outDirArg] = process.argv;
if (!gameDirArg || !version) {
  console.error('Usage: node scripts/package-release.mjs <gameDir> <version> [outDir=release]');
  process.exit(1);
}

const gameDir = resolve(gameDirArg);
const outDir = resolve(outDirArg ?? 'release');

const manifest = JSON.parse(await readFile(join(gameDir, 'plugin.json'), 'utf8'));

const distDir = join(gameDir, 'ui', 'dist');
try {
  await access(join(distDir, 'index.html'));
} catch {
  console.error(`${distDir}/index.html not found — run the game's build first.`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const zipPath = join(outDir, `${manifest.gameId}-${version}.zip`);

await new Promise((resolvePromise, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', resolvePromise);
  archive.on('error', reject);
  archive.pipe(output);
  archive.file(join(gameDir, 'plugin.json'), { name: 'plugin.json' });
  archive.directory(distDir, 'ui');
  archive.finalize();
});

console.log(zipPath);
