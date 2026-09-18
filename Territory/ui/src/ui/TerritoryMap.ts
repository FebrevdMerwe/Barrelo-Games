import Phaser from 'phaser';
import {
  isBull,
  MAX_SHIELD,
  RING_FRACTIONS,
  TERRITORY_IDS,
  WEDGE_HALF_ANGLE,
  WEDGE_ORDER,
  wedgeAngle,
  wedgeIndexOf,
  type TerritoryId,
} from '../board.ts';
import { reachableFor, type GameState } from '../rules.ts';
import { colourForIndex, cssColour, GOLD, mix } from './teams.ts';
import { TEXTURE_KEYS } from './textures.ts';

/**
 * The map, drawn as a dartboard: twenty wedges in the wire's own order — 20 at the top, then 1, 18,
 * 4 clockwise — with the real board's ring proportions, its alternating black and cream singles, and
 * its red and green doubles and trebles.
 *
 * Ownership is painted *over* that rather than replacing it, so the board still reads as a dartboard
 * at a glance:
 *
 *   - the **collar** outside the wire, where the printed numbers sit, goes solid in the owner's
 *     colour. Twenty blocks around the rim is the whole ownership map in one glance, readable from
 *     across a room and unaffected by whatever is happening inside the wire.
 *   - the **wedge** itself takes a translucent wash of the same colour, so the rings underneath stay
 *     visible and a triple is still obviously a triple.
 *
 * Shield pips sit in the outer single band, the Home star in the inner single band, and the Bull
 * carries its own pips inside the enlarged bull (see RING_FRACTIONS).
 *
 * WHAT THIS LAYOUT SHOWS FOR FREE
 * -------------------------------
 * Adjacency. Territories touch on the wire, so a side's ground grows as a visible arc and its front
 * lines are the two wedges at either end of it — the drawn board *is* the rules map.
 *
 * The pulsing outline on every reachable territory therefore confirms what position already suggests
 * rather than being the only thing that can say it, which is what lets it step down in weight when
 * everything is in reach without the board becoming unreadable.
 *
 * Every territory is a handful of Graphics created once and updated in place. Each is drawn in
 * coordinates relative to its own centroid with its container placed there, so a capture can pop
 * *that wedge* rather than scaling the whole board.
 */

/** Classic board colours, alternating by wedge. */
const SINGLE_COLOURS = [0x111111, 0xe6d7b4];
const MIX_COLOURS = [0xc82333, 0x1a8f47];
const BULL_OUTER_COLOUR = 0x1a8f47;
const BULL_INNER_COLOUR = 0xc82333;
const WIRE = 0xb9c1cb;
const COLLAR_NEUTRAL = 0x101519;
const COLLAR_RIM = 0x05080b;

/**
 * Ownership is carried by the **collar** — the numbers ring outside the wire — and only hinted at
 * inside it.
 *
 * Washing the wedges was the obvious thing and it was wrong twice over. By the midgame nearly every
 * territory is owned, so a strong wash turns the whole board into a colour wheel; and the red and
 * green rings it buries are exactly what makes a dartboard read as a dartboard. Twenty solid blocks
 * around the rim say who owns what far more clearly than a tinted bed ever did, and they say it
 * without touching the board at all.
 *
 * What is left inside the wire is a hint: enough that a wedge doesn't look abandoned, not enough to
 * compete with the rings.
 */
const BED_TINT_ALPHA = 0.25;
/**
 * The Bull gets a collar of its own — a band drawn around it — rather than being painted over.
 *
 * Colouring the bull's green ring directly made a red owner's bull brown and a green owner's bull
 * indistinguishable from an unclaimed one. A ring outside it has neither problem, keeps the bull a
 * proper red-and-green bull, and makes the Bull work exactly like the other twenty territories:
 * board inside the wire, ownership in the collar.
 */
const BULL_COLLAR_SCALE = 1.34;

/**
 * The reachable outline — the confirmation of what a side can reach, spelled out.
 *
 * Its weight scales with how much it is actually saying. Early on, two or three territories are in
 * reach and the outline needs to carry the board; once someone holds the Bull *everything* is in
 * reach, twenty pulsing outlines say almost nothing, and the same weight would just be noise. So it
 * steps down once the count passes what a player would scan for.
 */
const HIGHLIGHT_STRONG = { width: 4.5, base: 0.4, swing: 0.55 };
const HIGHLIGHT_QUIET = { width: 2.5, base: 0.18, swing: 0.32 };
const HIGHLIGHT_BUSY_ABOVE = 7;

/** Where the wedge's container sits, as a fraction of the board radius — roughly its visual middle. */
const CENTROID_RADIUS = 0.62;

/** The two single beds, which are what ownership paints. The treble and double rings are left pure. */
const BED_BANDS: readonly [number, number][] = [
  [RING_FRACTIONS.bullOuter, RING_FRACTIONS.tripleInner],
  [RING_FRACTIONS.tripleOuter, RING_FRACTIONS.doubleInner],
];

interface CellGeometry {
  /** Centroid offset from the board centre, in pixels. */
  cx: number;
  cy: number;
  /** Wedges only, in radians. */
  mid: number;
  start: number;
  end: number;
  /** Bull only. */
  bullInner: number;
  bullOuter: number;
}

interface Cell {
  id: TerritoryId;
  bull: boolean;
  /** Wedge position on the wire, for the black/cream alternation. -1 for the Bull. */
  wedgeIndex: number;
  container: Phaser.GameObjects.Container;
  /** The dartboard underneath — repainted only on resize, never on a change of owner. */
  base: Phaser.GameObjects.Graphics;
  /** The owner's colour washed over the scoring area. */
  tint: Phaser.GameObjects.Graphics;
  /** The numbers ring outside the wire, solid in the owner's colour. */
  collar: Phaser.GameObjects.Graphics;
  /** The wire, drawn last so the wash can't dull it. */
  wire: Phaser.GameObjects.Graphics;
  flash: Phaser.GameObjects.Graphics;
  border: Phaser.GameObjects.Graphics;
  glow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  homeMark: Phaser.GameObjects.Text;
  pips: Phaser.GameObjects.Arc[];
  geometry: CellGeometry;
  /** What is currently *drawn*, which during an animation is deliberately behind the derived state. */
  ownerColour: number | null;
  shield: number;
  /** Whether this territory is somewhere the side at the board can act. Pulsed in phase by tick(). */
  highlight: 'none' | 'reachable';
  highlightColour: number;
}

export class TerritoryMap {
  private readonly scene: Phaser.Scene;
  private readonly root: Phaser.GameObjects.Container;
  /** The cabinet the board is mounted on. Created first so every wedge draws over it. */
  private readonly surround: Phaser.GameObjects.Graphics;
  private readonly cells = new Map<TerritoryId, Cell>();
  private readonly effects = new Set<Phaser.Tweens.Tween>();

  private centreX = 0;
  private centreY = 0;
  /** Emphasis for the reachable outline, chosen from how many are reachable at all. */
  private highlight = HIGHLIGHT_STRONG;
  /** The outer double-ring radius — every RING_FRACTIONS value is relative to this. */
  private boardRadius = 100;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.root = scene.add.container(0, 0);
    this.surround = scene.add.graphics();
    this.root.add(this.surround);
    for (const id of TERRITORY_IDS) this.cells.set(id, this.buildCell(id));
  }

  private buildCell(id: TerritoryId): Cell {
    const scene = this.scene;
    const bull = isBull(id);

    const base = scene.add.graphics();
    const tint = scene.add.graphics();
    const collar = scene.add.graphics();
    const wire = scene.add.graphics();
    const flash = scene.add.graphics().setAlpha(0);
    const border = scene.add.graphics().setAlpha(0);
    const glow = scene.add
      .image(0, 0, TEXTURE_KEYS.glow)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);

    // The Bull carries no number: a real board doesn't print one, and its colours say what it is.
    const label = scene.add
      .text(0, 0, bull ? '' : id, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setStroke('#05080b', 4);

    const homeMark = scene.add
      .text(0, 0, '★', { fontFamily: 'Arial', fontSize: '13px', color: cssColour(GOLD) })
      .setOrigin(0.5)
      .setStroke('#05080b', 3)
      .setVisible(false);

    const pips: Phaser.GameObjects.Arc[] = [];
    for (let i = 0; i < MAX_SHIELD; i++) {
      pips.push(
        scene.add.circle(0, 0, 4, 0xf4f7fb).setStrokeStyle(1.5, 0x05080b, 0.85).setVisible(false)
      );
    }

    const container = scene.add.container(0, 0, [
      base,
      tint,
      collar,
      wire,
      flash,
      border,
      glow,
      label,
      homeMark,
      ...pips,
    ]);
    this.root.add(container);

    return {
      id,
      bull,
      wedgeIndex: wedgeIndexOf(id),
      container,
      base,
      tint,
      collar,
      wire,
      flash,
      border,
      glow,
      label,
      homeMark,
      pips,
      geometry: { cx: 0, cy: 0, mid: 0, start: 0, end: 0, bullInner: 0, bullOuter: 0 },
      ownerColour: null,
      shield: 0,
      highlight: 'none',
      highlightColour: 0xffffff,
    };
  }

  /**
   * Recomputes every position and redraws. `radius` is the room available; the board is sized down
   * from it so the collar, which sits outside the wire, still fits.
   */
  layout(centreX: number, centreY: number, radius: number): void {
    this.centreX = centreX;
    this.centreY = centreY;
    this.boardRadius = radius / RING_FRACTIONS.collarOuter;

    const R = this.boardRadius;

    WEDGE_ORDER.forEach((id, index) => {
      const cell = this.cells.get(id)!;
      const mid = wedgeAngle(index);
      cell.geometry = {
        cx: Math.cos(mid) * R * CENTROID_RADIUS,
        cy: Math.sin(mid) * R * CENTROID_RADIUS,
        mid,
        start: mid - WEDGE_HALF_ANGLE,
        end: mid + WEDGE_HALF_ANGLE,
        bullInner: 0,
        bullOuter: 0,
      };
      cell.container.setPosition(centreX + cell.geometry.cx, centreY + cell.geometry.cy);
    });

    const bull = this.cells.get(TERRITORY_IDS[TERRITORY_IDS.length - 1])!;
    bull.geometry = {
      cx: 0,
      cy: 0,
      mid: 0,
      start: 0,
      end: 0,
      bullInner: R * RING_FRACTIONS.bullInner,
      bullOuter: R * RING_FRACTIONS.bullOuter,
    };
    bull.container.setPosition(centreX, centreY);

    this.drawSurround();

    const numberSize = Phaser.Math.Clamp(Math.round(R * 0.105), 11, 34);
    const pipRadius = Phaser.Math.Clamp(R * 0.019, 3, 7);

    for (const cell of this.cells.values()) {
      cell.label.setFontSize(numberSize);
      cell.homeMark.setFontSize(Phaser.Math.Clamp(Math.round(R * 0.062), 9, 22));
      cell.pips.forEach((pip) => pip.setRadius(pipRadius));
      this.drawBase(cell);
      this.placeMarkers(cell);
      this.paintOwner(cell);
      this.paintHighlight(cell);
    }
  }

  /**
   * The board's cabinet: the black disc the numbers ring sits on, and the steel band around its edge.
   * Drawn in root coordinates rather than a cell's, because it belongs to no territory.
   */
  private drawSurround(): void {
    const g = this.surround;
    const outer = this.boardRadius * RING_FRACTIONS.collarOuter;
    g.clear();

    g.fillStyle(0x05080b, 1);
    g.fillCircle(this.centreX, this.centreY, outer * 1.075);
    g.lineStyle(Math.max(2, outer * 0.022), 0x39414c, 1);
    g.strokeCircle(this.centreX, this.centreY, outer * 1.062);
    g.lineStyle(1.5, WIRE, 0.5);
    g.strokeCircle(this.centreX, this.centreY, outer);
    g.strokeCircle(this.centreX, this.centreY, this.boardRadius * RING_FRACTIONS.doubleOuter);
  }

  /** Local coordinates of a point at `r` pixels from the board centre along `angle`. */
  private local(cell: Cell, r: number, angle: number): { x: number; y: number } {
    return {
      x: Math.cos(angle) * r - cell.geometry.cx,
      y: Math.sin(angle) * r - cell.geometry.cy,
    };
  }

  /** Traces a full annulus into `g`'s current path. Used for the Bull, which has no wedge. */
  private ringPath(g: Phaser.GameObjects.Graphics, inner: number, outer: number): void {
    g.beginPath();
    g.arc(0, 0, outer, 0, Math.PI * 2, false);
    g.arc(0, 0, inner, Math.PI * 2, 0, true);
    g.closePath();
  }

  /** Traces one band of a wedge — an annular sector — into `g`'s current path. */
  private bandPath(
    g: Phaser.GameObjects.Graphics,
    cell: Cell,
    inner: number,
    outer: number,
    inset = 0
  ): void {
    const ox = -cell.geometry.cx;
    const oy = -cell.geometry.cy;
    g.beginPath();
    g.arc(ox, oy, outer - inset, cell.geometry.start, cell.geometry.end, false);
    g.arc(ox, oy, inner + inset, cell.geometry.end, cell.geometry.start, true);
    g.closePath();
  }

  private fillBand(
    g: Phaser.GameObjects.Graphics,
    cell: Cell,
    inner: number,
    outer: number,
    colour: number,
    alpha: number
  ): void {
    this.bandPath(g, cell, inner, outer);
    g.fillStyle(colour, alpha);
    g.fillPath();
  }

  /** The dartboard itself. Independent of ownership, so it is only redrawn on resize. */
  private drawBase(cell: Cell): void {
    const g = cell.base;
    const w = cell.wire;
    const R = this.boardRadius;
    g.clear();
    w.clear();

    if (cell.bull) {
      g.fillStyle(BULL_OUTER_COLOUR, 1);
      g.fillCircle(0, 0, cell.geometry.bullOuter);
      g.fillStyle(BULL_INNER_COLOUR, 1);
      g.fillCircle(0, 0, cell.geometry.bullInner);

      w.lineStyle(1.5, WIRE, 0.7);
      w.strokeCircle(0, 0, cell.geometry.bullOuter);
      w.strokeCircle(0, 0, cell.geometry.bullInner);
      return;
    }

    const parity = cell.wedgeIndex % 2;
    const bands: [number, number, number][] = [
      [RING_FRACTIONS.bullOuter, RING_FRACTIONS.tripleInner, SINGLE_COLOURS[parity]],
      [RING_FRACTIONS.tripleInner, RING_FRACTIONS.tripleOuter, MIX_COLOURS[parity]],
      [RING_FRACTIONS.tripleOuter, RING_FRACTIONS.doubleInner, SINGLE_COLOURS[parity]],
      [RING_FRACTIONS.doubleInner, RING_FRACTIONS.doubleOuter, MIX_COLOURS[parity]],
    ];
    for (const [inner, outer, colour] of bands) this.fillBand(g, cell, R * inner, R * outer, colour, 1);

    // The wire: every band boundary plus the two radial spokes, drawn over the wash.
    w.lineStyle(1.25, WIRE, 0.62);
    for (const [inner, outer] of bands) {
      this.bandPath(w, cell, R * inner, R * outer);
      w.strokePath();
    }
  }

  /** Number in the collar, Home star inside the trebles, shield pips out in the big single. */
  private placeMarkers(cell: Cell): void {
    const R = this.boardRadius;

    if (cell.bull) {
      // The Bull has no collar to put anything in, so its pips sit inside the (enlarged) outer bull,
      // low enough to clear the bullseye.
      const gap = cell.geometry.bullOuter * 0.46;
      const y = cell.geometry.bullOuter * 0.5;
      cell.pips.forEach((pip, i) => pip.setPosition((i - 1) * gap, y));
      cell.homeMark.setPosition(0, -cell.geometry.bullOuter * 0.52);
      cell.glow.setDisplaySize(cell.geometry.bullOuter * 5, cell.geometry.bullOuter * 5);
      cell.glow.setPosition(0, 0);
      return;
    }

    const { mid } = cell.geometry;

    const labelPoint = this.local(cell, R * (RING_FRACTIONS.collarInner + RING_FRACTIONS.collarOuter) * 0.5, mid);
    cell.label.setPosition(labelPoint.x, labelPoint.y);

    // Both markers sit well out from the hub: twenty wedges converge on the bull, and anything drawn
    // near it reads as belonging to the board rather than to a territory. The star goes in the inner
    // single, the pips out in the big outer single, so they never crowd each other either.
    const homePoint = this.local(cell, R * 0.47, mid);
    cell.homeMark.setPosition(homePoint.x, homePoint.y);

    // Pips fan across the wedge in the outer single band. The angular gap shrinks as the radius
    // grows so they stay the same distance apart on screen whatever size the board is.
    const pipRadius = R * 0.85;
    const pipGap = Math.atan2(R * 0.062, pipRadius);
    cell.pips.forEach((pip, i) => {
      const point = this.local(cell, pipRadius, mid + (i - 1) * pipGap);
      pip.setPosition(point.x, point.y);
    });

    const glowPoint = this.local(cell, R * 0.62, mid);
    cell.glow.setPosition(glowPoint.x, glowPoint.y);
    cell.glow.setDisplaySize(R * 1.15, R * 1.15);
  }

  /** Repaints the two things that carry ownership: the wash over the wedge and the collar. */
  private paintOwner(cell: Cell): void {
    const R = this.boardRadius;
    const colour = cell.ownerColour;

    cell.tint.clear();
    cell.collar.clear();

    if (cell.bull) {
      if (colour === null) return;
      const outer = cell.geometry.bullOuter * BULL_COLLAR_SCALE;
      this.ringPath(cell.collar, cell.geometry.bullOuter, outer);
      cell.collar.fillStyle(colour, 1);
      cell.collar.fillPath();
      // Stroked as two circles, not as the annulus path: that path has to join its outer and inner
      // arcs somewhere, and stroking it draws that join as a stray radial line across the board.
      cell.collar.lineStyle(1.5, COLLAR_RIM, 0.9);
      cell.collar.strokeCircle(0, 0, outer);
      cell.collar.strokeCircle(0, 0, cell.geometry.bullOuter);
      return;
    }

    if (colour !== null) {
      for (const [inner, outer] of BED_BANDS) {
        this.fillBand(cell.tint, cell, R * inner, R * outer, colour, BED_TINT_ALPHA);
      }
    }

    const collarInner = R * RING_FRACTIONS.collarInner;
    const collarOuter = R * RING_FRACTIONS.collarOuter;
    this.fillBand(cell.collar, cell, collarInner, collarOuter, colour ?? COLLAR_NEUTRAL, 1);
    this.bandPath(cell.collar, cell, collarInner, collarOuter);
    cell.collar.lineStyle(1.5, COLLAR_RIM, 0.9);
    cell.collar.strokePath();
  }

  /** The reachable/own outline, traced around the wedge including its collar. */
  private paintHighlight(cell: Cell): void {
    const R = this.boardRadius;
    const g = cell.border;
    g.clear();
    if (cell.highlight === 'none') return;

    g.lineStyle(this.highlight.width, cell.highlightColour, 1);
    if (cell.bull) {
      g.strokeCircle(0, 0, cell.geometry.bullOuter * BULL_COLLAR_SCALE - this.highlight.width / 2);
      return;
    }
    this.bandPath(
      g,
      cell,
      R * RING_FRACTIONS.bullOuter,
      R * RING_FRACTIONS.doubleOuter,
      this.highlight.width / 2
    );
    g.strokePath();
  }

  /** The white overlay a claim or capture flashes, covering the wedge and its collar together. */
  private paintFlash(cell: Cell): void {
    const R = this.boardRadius;
    cell.flash.clear();
    if (cell.bull) {
      cell.flash.fillStyle(0xffffff, 1);
      cell.flash.fillCircle(0, 0, cell.geometry.bullOuter * BULL_COLLAR_SCALE);
      return;
    }
    this.fillBand(
      cell.flash,
      cell,
      R * RING_FRACTIONS.bullOuter,
      R * RING_FRACTIONS.collarOuter,
      0xffffff,
      1
    );
  }

  private setOwnerColour(cell: Cell, colour: number | null): void {
    if (cell.ownerColour === colour) return;
    cell.ownerColour = colour;
    this.paintOwner(cell);
  }

  private setShield(cell: Cell, shield: number, animateFrom = -1): void {
    cell.shield = shield;
    cell.pips.forEach((pip, i) => {
      if (i >= shield) {
        pip.setVisible(false);
        return;
      }
      pip.setVisible(true);
      if (i >= animateFrom) return;
      pip.setScale(1).setAlpha(1);
    });
  }

  /** The colour a side's ground is drawn in, from its seat in team order. */
  private colourOf(state: GameState, ownerId: string | null): number | null {
    if (ownerId === null) return null;
    const team = state.teams.find((t) => t.id === ownerId);
    return team ? colourForIndex(team.index) : null;
  }

  /**
   * Snaps the whole map to the derived state. Called on first paint, on a resync, and whenever the
   * animation queue drains — never mid-animation, which would jump a wedge to its final owner while
   * the capture that took it is still playing.
   */
  render(state: GameState): void {
    const reachable = reachableFor(state.territories, state.currentTeamId);
    const currentColour = this.colourOf(state, state.currentTeamId) ?? 0xffffff;
    this.highlight = reachable.size > HIGHLIGHT_BUSY_ABOVE ? HIGHLIGHT_QUIET : HIGHLIGHT_STRONG;

    for (const id of TERRITORY_IDS) {
      const cell = this.cells.get(id)!;
      const territory = state.territories[id];

      this.setOwnerColour(cell, this.colourOf(state, territory.ownerId));
      this.setShield(cell, territory.shield);
      cell.homeMark.setVisible(territory.isHome);
      cell.container.setScale(1);
      cell.flash.setAlpha(0);
      cell.glow.setAlpha(0);

      // Only "you can act here" is highlighted. Whose a territory already is, is the collar's job.
      if (reachable.has(id)) {
        cell.highlight = 'reachable';
        cell.highlightColour = currentColour;
      } else {
        cell.highlight = 'none';
      }
      this.paintHighlight(cell);
      if (cell.highlight === 'none') cell.border.setAlpha(0);
    }
  }

  /**
   * Drives the highlight pulse from the scene clock rather than 21 separate tweens, so every
   * reachable territory breathes in phase — out of phase it reads as noise rather than as one hint.
   * On this layout that pulse is the *only* thing showing adjacency, so it is deliberately strong.
   */
  tick(time: number): void {
    const pulse = this.highlight.base + this.highlight.swing * (0.5 + 0.5 * Math.sin(time / 380));
    for (const cell of this.cells.values()) {
      cell.border.setAlpha(cell.highlight === 'reachable' ? pulse : 0);
    }
  }

  /** Screen position of a territory's centroid, for anything drawn outside this class. */
  positionOf(id: TerritoryId): { x: number; y: number } {
    const cell = this.cells.get(id);
    if (!cell) return { x: this.centreX, y: this.centreY };
    return { x: this.centreX + cell.geometry.cx, y: this.centreY + cell.geometry.cy };
  }

  // ------------------------------------------------------------------ effects
  //
  // Each returns how long it will take in ms; BoardScene turns that into the AbortableAnimation the
  // queue waits on. Every tween is registered so abortEffects() can stop the lot in one go.
  //
  // The pops are gentler than they would be on a ring of blocks: a wedge runs from the bull right out
  // to the collar, so scaling it about its middle throws the outer tip well past the rim.

  private track(tween: Phaser.Tweens.Tween | null): void {
    if (!tween) return;
    this.effects.add(tween);
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.effects.delete(tween));
  }

  /** Kills every running effect. The caller is expected to render() straight afterwards. */
  abortEffects(): void {
    for (const tween of this.effects) tween.stop();
    this.effects.clear();
    for (const cell of this.cells.values()) {
      cell.container.setScale(1);
      cell.flash.setAlpha(0);
      cell.glow.setAlpha(0);
      cell.pips.forEach((pip) => pip.setScale(1).setAlpha(1));
    }
  }

  private pop(cell: Cell, to: number, duration: number): void {
    this.track(
      this.scene.tweens.add({
        targets: cell.container,
        scale: { from: to, to: 1 },
        duration,
        ease: 'Back.Out',
      })
    );
  }

  private burst(cell: Cell, colour: number, duration: number): void {
    cell.glow.setTint(colour).setAlpha(0.85).setScale(0.5);
    this.track(
      this.scene.tweens.add({
        targets: cell.glow,
        alpha: 0,
        scale: 1.4,
        duration,
        ease: 'Cubic.Out',
      })
    );
  }

  /**
   * A territory changes hands: white flash, recolour underneath it, then the flash fades away.
   * `colour` is null for a wedge going back to unclaimed, which is the same beat with the colour
   * going out instead of changing.
   */
  private takeover(
    cell: Cell,
    colour: number | null,
    flashPeak: number,
    hold: number,
    fade: number
  ): void {
    this.paintFlash(cell);
    cell.flash.setAlpha(0);
    this.track(
      this.scene.tweens.add({
        targets: cell.flash,
        alpha: { from: 0, to: flashPeak },
        duration: hold,
        ease: 'Quad.Out',
        onComplete: () => {
          this.setOwnerColour(cell, colour);
          this.track(
            this.scene.tweens.add({ targets: cell.flash, alpha: 0, duration: fade, ease: 'Quad.In' })
          );
        },
      })
    );
  }

  claim(id: TerritoryId, colour: number, speed: number): number {
    const cell = this.cells.get(id);
    if (!cell) return 0;
    this.takeover(cell, colour, 0.7, 110 / speed, 260 / speed);
    this.pop(cell, 1.07, 340 / speed);
    this.burst(cell, colour, 380 / speed);
    this.setShield(cell, 0);
    return 420 / speed;
  }

  /**
   * A territory is knocked off its owner and back to unclaimed. The same beat a claim gets, but the
   * colour underneath goes out rather than changing: the attacker's colour appears only in the
   * burst, because the wedge is nobody's until the next hit claims it.
   */
  neutralise(id: TerritoryId, attackerColour: number, wasHome: boolean, speed: number): number {
    const cell = this.cells.get(id);
    if (!cell) return 0;
    this.takeover(cell, null, 0.95, 140 / speed, 340 / speed);
    this.pop(cell, wasHome ? 1.16 : 1.11, 460 / speed);
    this.burst(cell, attackerColour, 520 / speed);
    this.setShield(cell, 0);
    return (wasHome ? 700 : 560) / speed;
  }

  reinforce(id: TerritoryId, from: number, to: number, speed: number): number {
    const cell = this.cells.get(id);
    if (!cell) return 0;
    this.setShield(cell, to, from);
    for (let i = from; i < to; i++) {
      const pip = cell.pips[i];
      pip.setVisible(true).setAlpha(0).setScale(0.2);
      this.track(
        this.scene.tweens.add({
          targets: pip,
          alpha: 1,
          scale: { from: 0.2, to: 1 },
          delay: ((i - from) * 90) / speed,
          duration: 240 / speed,
          ease: 'Back.Out',
        })
      );
    }
    this.pop(cell, 1.04, 260 / speed);
    return (200 + (to - from) * 90) / speed;
  }

  /** Shields come off: the lost pips shatter outwards and the territory takes a hit. */
  breakShields(id: TerritoryId, from: number, to: number, speed: number): number {
    const cell = this.cells.get(id);
    if (!cell) return 0;
    for (let i = to; i < from; i++) {
      const pip = cell.pips[i];
      pip.setVisible(true).setAlpha(1).setScale(1);
      this.track(
        this.scene.tweens.add({
          targets: pip,
          alpha: 0,
          scale: 2.1,
          delay: ((from - 1 - i) * 70) / speed,
          duration: 260 / speed,
          ease: 'Quad.Out',
          onComplete: () => pip.setVisible(false).setScale(1).setAlpha(1),
        })
      );
    }
    cell.shield = to;

    const { x, y } = this.positionOf(id);
    this.track(
      this.scene.tweens.add({
        targets: cell.container,
        x: { from: x - 4, to: x },
        duration: 60 / speed,
        yoyo: true,
        repeat: 2,
        onComplete: () => cell.container.setPosition(x, y),
      })
    );
    return (300 + (from - to) * 70) / speed;
  }

  /** A dart that achieved nothing still gets a beat, so the board never looks like it missed one. */
  nudge(id: TerritoryId, speed: number): number {
    const cell = this.cells.get(id);
    if (!cell) return 0;
    this.burst(cell, 0x94a3b8, 300 / speed);
    this.pop(cell, 1.03, 220 / speed);
    return 240 / speed;
  }

  /** The winner's whole map glows at once. */
  victoryFlare(state: GameState, colour: number, speed: number): number {
    for (const id of TERRITORY_IDS) {
      const cell = this.cells.get(id)!;
      if (state.territories[id].ownerId !== state.winnerTeamId) continue;
      cell.glow.setTint(mix(colour, 0xffffff, 0.4)).setAlpha(0).setScale(0.8);
      this.track(
        this.scene.tweens.add({
          targets: cell.glow,
          alpha: { from: 0, to: 0.8 },
          scale: 1.25,
          duration: 420 / speed,
          yoyo: true,
          repeat: 1,
          ease: 'Sine.InOut',
        })
      );
    }
    return 1400 / speed;
  }

  destroy(): void {
    this.abortEffects();
    this.root.destroy(true);
    this.cells.clear();
  }
}
