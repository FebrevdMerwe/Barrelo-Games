#!/usr/bin/env node
/*
 * Upserts one game's entry into the repo-root catalog.json that a Barrelo catalog source reads
 * directly, with no second fetch per game. Each release's CI run calls this once after publishing
 * that release's zip asset, so catalog.json always reflects the latest published version per game —
 * older releases stay on GitHub but drop out of the catalog once a newer one lands.
 *
 * Usage: node scripts/update-catalog.mjs <gameDir> <version> <downloadUrl>
 */
import { execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [, , gameDirArg, version, downloadUrl] = process.argv;
if (!gameDirArg || !version || !downloadUrl) {
  console.error('Usage: node scripts/update-catalog.mjs <gameDir> <version> <downloadUrl>');
  process.exit(1);
}

const gameDir = resolve(gameDirArg);
const manifest = JSON.parse(await readFile(join(gameDir, 'plugin.json'), 'utf8'));

function repoSlug() {
  const url = execSync('git config --get remote.origin.url').toString().trim();
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error(`Can't parse a GitHub owner/repo from remote "${url}".`);
  return `${match[1]}/${match[2]}`;
}

const catalogPath = resolve('catalog.json');
let catalog;
try {
  catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
} catch {
  catalog = { catalogVersion: 1, games: [] };
}

const entry = {
  gameId: manifest.gameId,
  displayName: manifest.displayName,
  description: manifest.description,
  protocolVersion: manifest.protocolVersion,
  latestVersion: version,
  downloadUrl,
  homepage: `https://github.com/${repoSlug()}/tree/master/${gameDirArg.replace(/\\/g, '/')}`,
};

const others = catalog.games.filter((g) => g.gameId !== entry.gameId);
catalog.games = [...others, entry].sort((a, b) => a.gameId.localeCompare(b.gameId));

await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Updated catalog.json: ${entry.gameId} -> ${version}`);
