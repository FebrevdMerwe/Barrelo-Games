#!/usr/bin/env node
/*
 * Scans the repo's top-level game folders for the one whose plugin.json declares the given gameId,
 * since folder names don't always match gameId (e.g. 8-Ball-Pool/plugin.json -> "dart-pool"). Prints
 * the matching folder name to stdout so CI can `cd` into it without a separately-maintained mapping
 * file that could drift from plugin.json.
 *
 * Usage: node scripts/find-game-dir.mjs <gameId>
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const gameId = process.argv[2];
if (!gameId) {
  console.error('Usage: node scripts/find-game-dir.mjs <gameId>');
  process.exit(1);
}

const root = process.cwd();
const SKIP = new Set(['node_modules', '.git', '.github', 'scripts', 'release']);

const entries = await readdir(root, { withFileTypes: true });
const matches = [];

for (const entry of entries) {
  if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
  try {
    const manifest = JSON.parse(await readFile(join(root, entry.name, 'plugin.json'), 'utf8'));
    if (manifest.gameId === gameId) matches.push(entry.name);
  } catch {
    // no plugin.json here (or invalid JSON) — not a game folder, skip
  }
}

if (matches.length === 0) {
  console.error(`No game folder found with gameId "${gameId}".`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(`Multiple folders declare gameId "${gameId}": ${matches.join(', ')}`);
  process.exit(1);
}

console.log(matches[0]);
