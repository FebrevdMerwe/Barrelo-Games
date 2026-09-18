import Phaser from 'phaser';

/**
 * Every texture the board uses, generated into the texture cache at boot rather than loaded.
 *
 * The course is data-driven polygons, so its shape has to be drawn with Graphics whatever happens;
 * what these add is the surface — felt weave, sand stipple, water shimmer — that stops the board
 * looking like a wireframe. Nothing here is loaded over the network, so there is no asset pipeline
 * to keep in step and no cold-cache flash.
 *
 * The keys are the seam for real art later: drop a PNG into public/assets, load it under the same
 * key in PreloaderScene, and none of the drawing code below needs to change.
 */
export const TEXTURE_KEYS = {
  felt: 'felt',
  sand: 'sand',
  water: 'water',
} as const;

const TILE = 128;

/**
 * A tiny LCG rather than Math.random. This is renderer-only code, so determinism is not required
 * for correctness — but a texture that is subtly different every reload makes two screens side by
 * side look like they are showing different things, which is exactly the confusion to avoid.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function paint(
  scene: Phaser.Scene,
  key: string,
  draw: (ctx: CanvasRenderingContext2D, rand: () => number) => void
): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, TILE, TILE);
  if (!texture) return;
  const ctx = texture.getContext();
  draw(ctx, lcg(0x5eed));
  texture.refresh();
}

export function generateTextures(scene: Phaser.Scene): void {
  // Felt: a flat base with a fine two-tone speckle and a faint mow-stripe, so large fills read as
  // a surface rather than a block of colour.
  paint(scene, TEXTURE_KEYS.felt, (ctx, rand) => {
    ctx.fillStyle = '#2f7d44';
    ctx.fillRect(0, 0, TILE, TILE);

    for (let stripe = 0; stripe < TILE; stripe += 16) {
      ctx.fillStyle = stripe % 32 === 0 ? 'rgba(255,255,255,0.030)' : 'rgba(0,0,0,0.030)';
      ctx.fillRect(0, stripe, TILE, 16);
    }

    for (let i = 0; i < 2600; i++) {
      const shade = rand();
      ctx.fillStyle =
        shade > 0.5 ? `rgba(160,220,160,${0.05 + rand() * 0.09})` : `rgba(10,50,25,${0.05 + rand() * 0.10})`;
      ctx.fillRect(Math.floor(rand() * TILE), Math.floor(rand() * TILE), 1, 1);
    }
  });

  // Sand: warm ochre with a coarser, higher-contrast grain than the felt.
  paint(scene, TEXTURE_KEYS.sand, (ctx, rand) => {
    ctx.fillStyle = '#d9c185';
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 3400; i++) {
      ctx.fillStyle =
        rand() > 0.5 ? `rgba(255,246,214,${0.10 + rand() * 0.18})` : `rgba(120,92,44,${0.08 + rand() * 0.16})`;
      const size = rand() > 0.85 ? 2 : 1;
      ctx.fillRect(Math.floor(rand() * TILE), Math.floor(rand() * TILE), size, size);
    }
  });

  // Water: deep blue with pale caustic arcs. Tinted and scrolled at draw time to suggest movement.
  paint(scene, TEXTURE_KEYS.water, (ctx, rand) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, TILE);
    gradient.addColorStop(0, '#12415f');
    gradient.addColorStop(1, '#1b6389');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, TILE, TILE);

    ctx.strokeStyle = 'rgba(190,235,255,0.20)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) {
      const x = rand() * TILE;
      const y = rand() * TILE;
      const radius = 6 + rand() * 16;
      const start = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x, y, radius, start, start + 0.6 + rand() * 0.9);
      ctx.stroke();
    }
  });
}
