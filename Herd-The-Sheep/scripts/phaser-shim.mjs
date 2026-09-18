/*
 * Stands in for `phaser` when the probe bundles the real game modules for Node.
 *
 * simulate.ts reaches exactly one thing out of Phaser — Physics.Matter.Matter — which at runtime is
 * the plain Matter library, no DOM required. Pointing the shim at Phaser's own CustomMain.js means
 * the probe exercises the *same* Matter build the browser does, not a lookalike from npm.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Matter = require('../ui/node_modules/phaser/src/physics/matter-js/CustomMain.js');

export default { Physics: { Matter: { Matter } } };
