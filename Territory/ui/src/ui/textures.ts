import Phaser from 'phaser';

/**
 * Every texture the board uses, generated into the texture cache at boot rather than loaded.
 *
 * The map itself is drawn with Graphics — it has to be, since a wedge changes colour whenever it
 * changes hands — so what these add is the light: the glow behind a territory that just fell, and a
 * grain over the backdrop that stops a full-screen dark fill looking like a blank canvas.
 *
 * The keys are the seam for real art later: drop a PNG into public/assets, load it under the same
 * key in PreloaderScene, and none of the drawing code needs to change.
 */
export const TEXTURE_KEYS = {
  glow: 'glow',
  grain: 'grain',
} as const;

/**
 * A tiny LCG rather than Math.random. This is renderer-only code, so determinism is not required for
 * correctness — but a backdrop that is subtly different every reload makes two screens side by side
 * look like they are showing different things, which is exactly the confusion to avoid.
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
  size: number,
  draw: (ctx: CanvasRenderingContext2D, rand: () => number) => void
): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, size, size);
  if (!texture) return;
  draw(texture.getContext(), lcg(0x7e881));
  texture.refresh();
}

export function generateTextures(scene: Phaser.Scene): void {
  // A soft white disc, tinted and scaled wherever a flash is needed. White so a tint can take it to
  // any side's colour without the underlying hue fighting it.
  paint(scene, TEXTURE_KEYS.glow, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.42)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });

  // Backdrop grain, tiled at low alpha. Pure speckle: the vignette behind it is a Graphics fill, so
  // this only has to break up the flatness.
  paint(scene, TEXTURE_KEYS.grain, 128, (ctx, rand) => {
    ctx.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 2200; i++) {
      const bright = rand() > 0.5;
      ctx.fillStyle = bright
        ? `rgba(190,215,255,${0.03 + rand() * 0.05})`
        : `rgba(0,0,0,${0.04 + rand() * 0.07})`;
      ctx.fillRect(Math.floor(rand() * 128), Math.floor(rand() * 128), 1, 1);
    }
  });
}
