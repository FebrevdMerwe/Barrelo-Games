import Phaser from 'phaser';

/**
 * Every surface in the game, generated into Phaser's texture cache at boot. Nothing is loaded over
 * the network, so there are no assets to lose and no load order to get wrong.
 *
 * To use real art instead, drop PNGs into ui/public/assets and load them under these same keys in
 * PreloaderScene. No drawing code anywhere else needs to change.
 *
 * The little PRNG below is decoration only — texture speckle never reaches the rules — but it is
 * seeded from a constant rather than Math.random so that two screens showing the same match are
 * speckled identically. A TV and a tablet with visibly different grass look like a bug.
 */

const SHEEP_TEX = 2; // supersampling factor: draw at 2x, display at 1x

export const TEX = {
  grass: 'grass',
  sheep: 'sheep',
  sheepPenned: 'sheep-penned',
  dart: 'dart',
} as const;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGrass(scene: Phaser.Scene): void {
  const size = 256;
  const g = scene.add.graphics();
  const next = seeded(0x5eed);

  g.fillStyle(0x4a7c3f, 1);
  g.fillRect(0, 0, size, size);

  // Two passes of speckle: broad tonal blotches, then short blades on top. Flat green reads as a
  // billiard table on a big screen; this reads as a field without costing a real texture.
  for (let i = 0; i < 90; i++) {
    g.fillStyle(next() > 0.5 ? 0x548a47 : 0x416f37, 0.5);
    g.fillCircle(next() * size, next() * size, 12 + next() * 26);
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle(next() > 0.5 ? 0x5d9650 : 0x3b6632, 0.7);
    const x = next() * size;
    const y = next() * size;
    g.fillRect(x, y, 1 + next() * 2, 2 + next() * 3);
  }

  g.generateTexture(TEX.grass, size, size);
  g.destroy();
}

/**
 * A sheep, from above: an oval fleece with a dark head poking out the front and four stub legs.
 * Drawn facing +x so the view can simply rotate it to its heading.
 */
function makeSheep(scene: Phaser.Scene, key: string, fleece: number, tired: boolean): void {
  const w = 52 * SHEEP_TEX;
  const h = 40 * SHEEP_TEX;
  const g = scene.add.graphics();
  const cx = w / 2;
  const cy = h / 2;
  const s = SHEEP_TEX;
  const next = seeded(0x5ee9);

  // Legs first, so the fleece sits on top of them.
  g.fillStyle(0x2e2722, 1);
  for (const [lx, ly] of [
    [-8, -11],
    [-8, 11],
    [7, -11],
    [7, 11],
  ]) {
    g.fillRoundedRect(cx + lx * s - 2 * s, cy + ly * s - 2 * s, 5 * s, 6 * s, 2 * s);
  }

  // Head, ahead of the body and slightly narrower.
  g.fillStyle(0x332d29, 1);
  g.fillEllipse(cx + 17 * s, cy, 15 * s, 12 * s);
  g.fillStyle(0x2a2521, 1);
  g.fillEllipse(cx + 14 * s, cy - 6 * s, 5 * s, 5 * s);
  g.fillEllipse(cx + 14 * s, cy + 6 * s, 5 * s, 5 * s);

  // Fleece: overlapping lobes rather than one clean oval, so the silhouette is bumpy like wool.
  g.fillStyle(fleece, 1);
  g.fillEllipse(cx - 1 * s, cy, 34 * s, 28 * s);
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    g.fillCircle(cx - 1 * s + Math.cos(angle) * 13 * s, cy + Math.sin(angle) * 10 * s, 7 * s);
  }

  // Curl shading, so the fleece is not a flat blob at distance.
  g.fillStyle(tired ? 0xc9c2b2 : 0xdad3c2, 0.85);
  for (let i = 0; i < 10; i++) {
    g.fillCircle(cx - 1 * s + (next() - 0.5) * 24 * s, cy + (next() - 0.5) * 18 * s, 3 * s);
  }

  g.generateTexture(key, w, h);
  g.destroy();
}

/** The dart, drawn as a scare marker: a stuck shaft with a flight, seen from above. */
function makeDart(scene: Phaser.Scene): void {
  const size = 40;
  const g = scene.add.graphics();

  g.fillStyle(0x1c1917, 0.35);
  g.fillCircle(size / 2 + 1, size / 2 + 2, 7);
  g.fillStyle(0xe8e2d4, 1);
  g.fillCircle(size / 2, size / 2, 6);
  g.fillStyle(0xb02f2f, 1);
  g.fillCircle(size / 2, size / 2, 3.5);

  g.generateTexture(TEX.dart, size, size);
  g.destroy();
}

/** Called once, from PreloaderScene. Safe to call again; Phaser overwrites the keys. */
export function generateTextures(scene: Phaser.Scene): void {
  makeGrass(scene);
  makeSheep(scene, TEX.sheep, 0xf2ede1, false);
  makeSheep(scene, TEX.sheepPenned, 0xded7c6, true);
  makeDart(scene);
}
