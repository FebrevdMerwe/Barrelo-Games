#!/usr/bin/env node
/*
 * Bundles the real game modules for Node and runs scripts/probe.ts.
 *
 * simulate.ts imports `phaser`, which cannot load in Node — but the only thing it reaches for is
 * Physics.Matter.Matter, which is the plain Matter library. The alias below swaps Phaser for a shim
 * that hands over Phaser's own Matter build, so the probe exercises exactly what the browser runs
 * rather than a lookalike from npm.
 *
 * Usage: npm run probe
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const bundle = join(here, 'probe.bundle.mjs');

const build = spawnSync(
  'npx',
  [
    '--yes',
    'esbuild',
    join(here, 'probe.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${bundle}`,
    `--alias:phaser=${join(here, 'phaser-shim.mjs')}`,
    '--log-level=warning',
  ],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }
);

if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(process.execPath, [bundle], { cwd: root, stdio: 'inherit' });
rmSync(bundle, { force: true });
process.exit(run.status ?? 1);
