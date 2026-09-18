import Phaser from 'phaser';
import {
  CENTRE,
  FENCE_ARC,
  FENCE_R,
  FUNNEL_WALLS,
  GATE_BOTTOM,
  GATE_TOP,
  GATE_X,
  PEN_RECT,
  SHEEP_R,
  WORLD_H,
  WORLD_W,
  type Obstacle,
  type Paddock,
  type Vec,
} from '../paddock';
import type { SheepState } from '../simulate';
import { TEX } from './textures';

/**
 * Draws the paddock and everything standing in it. Knows nothing about rules, turns or scoring —
 * it is handed positions and draws them.
 *
 * The 20 board numbers are painted on the grass just INSIDE the fence rather than on a ring outside
 * it. Outside, the funnel would sit on top of two of them; inside, the funnel is simply another
 * landmark on the same field, and the numbers read as what they are — the paddock and the dartboard
 * being the same circle.
 */

/** Clockwise from the top, which is how the board is laid out and how the coordinates arrive. */
const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

const NUMBER_RADIUS = FENCE_R * 0.93;

export class PaddockView {
  private readonly sheepSprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly pennedSprites: Phaser.GameObjects.Image[] = [];
  private readonly sheepLayer: Phaser.GameObjects.Container;
  private readonly fxLayer: Phaser.GameObjects.Container;
  private staticLayer: Phaser.GameObjects.Container | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: Phaser.GameObjects.Container
  ) {
    this.sheepLayer = scene.add.container(0, 0);
    this.fxLayer = scene.add.container(0, 0);
    this.world.add([this.sheepLayer, this.fxLayer]);
  }

  /** Rebuilds every fixed thing on the field. Called once per match layout. */
  buildStatic(paddock: Paddock): void {
    this.staticLayer?.destroy();
    const layer = this.scene.add.container(0, 0);
    this.staticLayer = layer;
    this.world.addAt(layer, 0);

    // Grass, tiled across the whole world rather than clipped to the paddock: the pen and the
    // margins are in the same field, and a hard edge at the fence would look like a cut-out.
    layer.add(this.scene.add.tileSprite(0, 0, WORLD_W, WORLD_H, TEX.grass).setOrigin(0, 0));

    // A slightly lighter disc inside the fence, so the throwable circle is legible at a glance.
    const disc = this.scene.add.graphics();
    disc.fillStyle(0xffffff, 0.05);
    disc.fillCircle(CENTRE.x, CENTRE.y, FENCE_R);
    layer.add(disc);

    layer.add(this.drawPen());
    for (const obstacle of paddock.obstacles) layer.add(this.drawObstacle(obstacle));
    layer.add(this.drawFence());
    for (const label of this.drawNumbers()) layer.add(label);
  }

  private drawFence(): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();

    // The arc stops where the funnel walls start, which is exactly why there is no pocket for sheep
    // to wedge into — see the construction note in paddock.ts.
    g.lineStyle(7, 0x6b4f31, 1);
    g.beginPath();
    g.arc(CENTRE.x, CENTRE.y, FENCE_R, FENCE_ARC.from, FENCE_ARC.to, false);
    g.strokePath();

    // Posts, spaced along the same arc.
    g.fillStyle(0x543d26, 1);
    const span = FENCE_ARC.to - FENCE_ARC.from;
    for (let i = 0; i <= 40; i++) {
      const a = FENCE_ARC.from + (span * i) / 40;
      g.fillCircle(CENTRE.x + FENCE_R * Math.cos(a), CENTRE.y + FENCE_R * Math.sin(a), 5);
    }

    for (const wall of FUNNEL_WALLS) {
      g.lineStyle(9, 0x7a5a38, 1);
      g.beginPath();
      g.moveTo(wall[0].x, wall[0].y);
      for (let i = 1; i < wall.length; i++) g.lineTo(wall[i].x, wall[i].y);
      g.strokePath();
      g.fillStyle(0x543d26, 1);
      for (const point of wall) g.fillCircle(point.x, point.y, 6);
    }

    return g;
  }

  /**
   * The pen bay. Purely decorative — penned sheep are removed from the simulation rather than
   * contained by anything, which is what makes a banked sheep unscatterable.
   */
  private drawPen(): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();

    g.fillStyle(0x3c2f21, 0.55);
    g.fillRoundedRect(PEN_RECT.x, PEN_RECT.y, PEN_RECT.w, PEN_RECT.h, 10);
    g.lineStyle(7, 0x6b4f31, 1);
    g.strokeRoundedRect(PEN_RECT.x, PEN_RECT.y, PEN_RECT.w, PEN_RECT.h, 10);

    // The gate itself: a gap in the pen's near wall, painted so the target is unmistakable.
    g.fillStyle(0x3c2f21, 0.55);
    g.fillRect(PEN_RECT.x - 6, GATE_TOP, 12, GATE_BOTTOM - GATE_TOP);
    g.lineStyle(3, 0xd9b23d, 0.85);
    g.beginPath();
    g.moveTo(GATE_X, GATE_TOP);
    g.lineTo(GATE_X, GATE_BOTTOM);
    g.strokePath();

    return g;
  }

  private drawObstacle(obstacle: Obstacle): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const { x, y } = obstacle.at;
    const r = obstacle.r;

    if (obstacle.kind === 'pond') {
      g.fillStyle(0x24506b, 1);
      g.fillCircle(x, y, r);
      g.fillStyle(0x2f6a8c, 1);
      g.fillCircle(x, y, r * 0.82);
      g.lineStyle(3, 0x8fc4d9, 0.5);
      g.strokeCircle(x - r * 0.15, y - r * 0.15, r * 0.45);
    } else if (obstacle.kind === 'rocks') {
      g.fillStyle(0x3d3a35, 0.5);
      g.fillCircle(x, y, r);
      g.fillStyle(0x7a736a, 1);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.fillCircle(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.4);
      }
      g.fillStyle(0x968d82, 1);
      g.fillCircle(x, y, r * 0.42);
    } else {
      g.fillStyle(0x1f3a1c, 0.45);
      g.fillCircle(x + 4, y + 6, r);
      g.fillStyle(0x2f5c2a, 1);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        g.fillCircle(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, r * 0.52);
      }
      g.fillStyle(0x3d7535, 1);
      g.fillCircle(x, y, r * 0.5);
    }

    return g;
  }

  /**
   * Board space puts segment 20 straight up and runs clockwise, and that convention is already
   * baked into the coordinates the host sends — so the labels only have to restate it, never
   * translate it.
   */
  private drawNumbers(): Phaser.GameObjects.Text[] {
    return SEGMENTS.map((segment, i) => {
      const angle = (i / SEGMENTS.length) * Math.PI * 2;
      const x = CENTRE.x + NUMBER_RADIUS * Math.sin(angle);
      const y = CENTRE.y - NUMBER_RADIUS * Math.cos(angle);
      return this.scene.add
        .text(x, y, String(segment), {
          fontFamily: 'Georgia, serif',
          fontSize: '34px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setAlpha(0.28);
    });
  }

  // -------------------------------------------------------------------------------------------
  // The flock
  // -------------------------------------------------------------------------------------------

  private spriteFor(id: string): Phaser.GameObjects.Image {
    let sprite = this.sheepSprites.get(id);
    if (!sprite) {
      sprite = this.scene.add.image(0, 0, TEX.sheep).setDisplaySize(SHEEP_R * 2.9, SHEEP_R * 2.2);
      this.sheepLayer.add(sprite);
      this.sheepSprites.set(id, sprite);
    }
    return sprite;
  }

  /** Snaps every sheep to a given set of positions and drops any that are no longer loose. */
  setFlock(flock: SheepState[]): void {
    const live = new Set(flock.map((s) => s.id));
    for (const [id, sprite] of this.sheepSprites) {
      if (!live.has(id)) {
        sprite.destroy();
        this.sheepSprites.delete(id);
      }
    }
    for (const sheep of flock) {
      const sprite = this.spriteFor(sheep.id);
      sprite.setPosition(sheep.at.x, sheep.at.y);
    }
  }

  /**
   * Positions from live Matter bodies, mid-burst. Sheep are turned to face the way they are
   * actually travelling and stretched a little along it, which is most of what sells a panicked
   * animal — below a threshold they keep their last heading rather than spinning on the spot.
   */
  setFromBodies(bodies: { id: string; position: Vec; velocity: Vec }[]): void {
    const live = new Set(bodies.map((b) => b.id));
    for (const [id, sprite] of this.sheepSprites) {
      if (!live.has(id)) {
        sprite.destroy();
        this.sheepSprites.delete(id);
      }
    }
    for (const body of bodies) {
      const sprite = this.spriteFor(body.id);
      sprite.setPosition(body.position.x, body.position.y);
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > 0.4) {
        sprite.setRotation(Math.atan2(body.velocity.y, body.velocity.x));
        const stretch = 1 + Math.min(speed / 26, 0.35);
        sprite.setDisplaySize(SHEEP_R * 2.9 * stretch, (SHEEP_R * 2.2) / stretch);
      }
    }
  }

  /** Idle life between darts: heads dipping. Positions never change — that would be a lie. */
  startGrazing(): void {
    for (const sprite of this.sheepSprites.values()) {
      this.scene.tweens.killTweensOf(sprite);
      sprite.setDisplaySize(SHEEP_R * 2.9, SHEEP_R * 2.2);
      this.scene.tweens.add({
        targets: sprite,
        scaleX: sprite.scaleX * 0.94,
        duration: 900 + ((sprite.x * 37) % 700),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
    }
  }

  stopGrazing(): void {
    for (const sprite of this.sheepSprites.values()) this.scene.tweens.killTweensOf(sprite);
  }

  /** Draws the banked flock milling about in the bay. Count only — they are out of the game. */
  setPenned(count: number): void {
    while (this.pennedSprites.length > count) this.pennedSprites.pop()?.destroy();
    while (this.pennedSprites.length < count) {
      const i = this.pennedSprites.length;
      const cols = 4;
      const sprite = this.scene.add
        .image(
          PEN_RECT.x + 46 + (i % cols) * 58,
          PEN_RECT.y + 52 + Math.floor(i / cols) * 56,
          TEX.sheepPenned
        )
        .setDisplaySize(SHEEP_R * 2.5, SHEEP_R * 1.9)
        .setRotation(((i * 47) % 100) / 100 - 0.5);
      this.sheepLayer.add(sprite);
      this.pennedSprites.push(sprite);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------------------------

  /** The dart landing: a thunk and an expanding ring showing how far the scare actually carried. */
  showScare(at: Vec, radius: number, color: number): void {
    const dart = this.scene.add.image(at.x, at.y, TEX.dart).setDisplaySize(26, 26);
    this.fxLayer.add(dart);

    const ring = this.scene.add.circle(at.x, at.y, 10).setStrokeStyle(5, color, 0.9);
    this.fxLayer.add(ring);
    this.scene.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 620,
      ease: 'Cubic.Out',
      onUpdate: () => ring.setStrokeStyle(5, color, ring.alpha),
      onComplete: () => ring.destroy(),
    });

    this.scene.tweens.add({ targets: dart, alpha: 0, delay: 1400, duration: 500 });
    // Destruction is a timer rather than the tween's onComplete. A tween whose target is removed
    // out from under it — which is what an undo or a resync does — never completes, and the sprite
    // is then left on the grass for the rest of the match. Over forty darts that is forty of them.
    this.scene.time.delayedCall(1950, () => dart.destroy());
  }

  /** Drops every transient marker. Called on a resync, when what is on screen is being abandoned. */
  clearEffects(): void {
    this.fxLayer.removeAll(true);
  }

  /** The whistle: rings travelling inward, because it gathers rather than scatters. */
  showWhistle(at: Vec, color: number): void {
    for (let i = 0; i < 3; i++) {
      const ring = this.scene.add.circle(at.x, at.y, 300).setStrokeStyle(4, color, 0.8);
      this.fxLayer.add(ring);
      this.scene.tweens.add({
        targets: ring,
        radius: 12,
        alpha: 0,
        delay: i * 130,
        duration: 700,
        ease: 'Cubic.In',
        onUpdate: () => ring.setStrokeStyle(4, color, ring.alpha),
        onComplete: () => ring.destroy(),
      });
    }
  }

  /** A dart that never reached the paddock. Says so, briefly, where the flock is. */
  showMiss(): void {
    const label = this.scene.add
      .text(CENTRE.x, CENTRE.y - FENCE_R - 34, 'over the fence', {
        fontFamily: 'Georgia, serif',
        fontSize: '30px',
        color: '#e9e4d6',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.fxLayer.add(label);
    this.scene.tweens.add({
      targets: label,
      alpha: { from: 0, to: 0.9 },
      y: label.y - 24,
      duration: 400,
      yoyo: true,
      hold: 500,
      onComplete: () => label.destroy(),
    });
  }
}
