import Phaser from 'phaser';
import { BALL_RADIUS, type Vec } from '../holes';
import { cssColour } from './teams';

/**
 * The aim guide: a few dartboard numbers floating around the ball that is up, on the side the cup is
 * on, with the number whose wedge line points closest to the cup picked out.
 *
 * It only restates what the board already decides — direction is world-fixed, so 20 is up the screen
 * on every hole and the mapping never rotates — but restating it *at the ball* saves the player
 * holding a compass in their head while they stand at the oche. Power is deliberately not shown: the
 * ring you need is the part of the shot worth learning, and the geometry here cannot know it anyway.
 *
 * It is a straight line-of-sight hint, not a solver. Walls, water and the windmill are the player's
 * problem — the number shown is where the cup *is*, not necessarily the shot to play.
 */

/** The dartboard, clockwise from 20 at the top. Aim is quantised to these twenty directions. */
const WEDGE_ORDER: readonly number[] = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

const WEDGE_ARC = (Math.PI * 2) / WEDGE_ORDER.length;

/** Wedges drawn either side of the best line. Two is enough to show which way you are off. */
const SPREAD = 2;

/** Ring radius, in ball radii, and a pixel floor so it stays legible on a small board. */
const RING_RADII = 6.4;
const MIN_RING = 52;

/** Per-step-away-from-the-best-line ramps. Index 0 is the line at the cup. */
const ALPHA = [0.95, 0.4, 0.16];
const FONT_SCALE = [1, 0.82, 0.7];
const TICK_LENGTH = [0.16, 0.1, 0.08];

const BASE_FONT_PX = 15;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Neighbours are unowned scenery, so they stay off the team colour and sit back into the felt. */
const NEIGHBOUR_COLOUR = '#cfe0cc';
const TICK_COLOUR = 0xe9f0e6;

/** Below this the cup is under the ball and the direction is noise. */
const EPSILON = 1e-6;

/**
 * Which wedge points closest to (dx, dy), in course space — y-down, 20 up, increasing clockwise.
 * The same convention putt.ts reads a dart in, so the number here is the number to throw.
 */
function wedgeIndexTowards(dx: number, dy: number): number {
  const index = Math.round(Math.atan2(dx, -dy) / WEDGE_ARC);
  return ((index % WEDGE_ORDER.length) + WEDGE_ORDER.length) % WEDGE_ORDER.length;
}

export class AimGuide {
  private readonly ticks: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
    this.ticks = scene.add.graphics();
    layer.add(this.ticks);

    for (let i = 0; i < SPREAD * 2 + 1; i++) {
      const label = scene.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: `${BASE_FONT_PX}px`, color: NEIGHBOUR_COLOUR })
        .setOrigin(0.5);
      this.labels.push(label);
      layer.add(label);
    }

    this.hide();
  }

  /**
   * Places the guide around `at`, pointing at `cup`. Both are course-space; the transform is uniform
   * and y-down on both sides, so the on-screen direction is the course direction and no separate
   * bearing has to be carried through.
   */
  show(at: Vec, cup: Vec, toScreen: (v: Vec) => { x: number; y: number }, scale: number, colour: number): void {
    const dx = cup.x - at.x;
    const dy = cup.y - at.y;
    if (Math.hypot(dx, dy) < EPSILON) {
      this.hide();
      return;
    }

    const best = wedgeIndexTowards(dx, dy);
    const origin = toScreen(at);
    const radius = Math.max(MIN_RING, BALL_RADIUS * scale * RING_RADII);
    const fontPx = Math.max(10, BASE_FONT_PX * Math.min(1, scale));

    this.ticks.clear();
    this.ticks.setVisible(true);

    for (let i = 0; i < this.labels.length; i++) {
      const offset = i - SPREAD;
      const step = Math.abs(offset);
      const index = ((best + offset) % WEDGE_ORDER.length + WEDGE_ORDER.length) % WEDGE_ORDER.length;
      const angle = index * WEDGE_ARC;
      const ux = Math.sin(angle);
      const uy = -Math.cos(angle);

      const label = this.labels[i];
      label.setText(String(WEDGE_ORDER[index]));
      label.setFontSize(fontPx * FONT_SCALE[step]);
      label.setColor(step === 0 ? cssColour(colour) : NEIGHBOUR_COLOUR);
      label.setAlpha(ALPHA[step]);
      label.setPosition(origin.x + ux * radius, origin.y + uy * radius);
      label.setVisible(true);

      // A radial tick just inside each number, so the five read as one arc off the ball rather than
      // as digits scattered on the felt.
      const inner = radius * (1 - TICK_LENGTH[step]) - fontPx * 0.75;
      const outer = radius - fontPx * 0.75;
      this.ticks.lineStyle(Math.max(1, 1.5 * scale), step === 0 ? colour : TICK_COLOUR, ALPHA[step] * 0.8);
      this.ticks.lineBetween(
        origin.x + ux * inner,
        origin.y + uy * inner,
        origin.x + ux * outer,
        origin.y + uy * outer
      );
    }
  }

  hide(): void {
    this.ticks.clear();
    this.ticks.setVisible(false);
    for (const label of this.labels) label.setVisible(false);
  }

  destroy(): void {
    this.ticks.destroy();
    for (const label of this.labels) label.destroy();
    this.labels.length = 0;
  }
}
