import Phaser from 'phaser';
import { BALL_RADIUS, COURSE_BOUNDS, CUP_RADIUS, type Hole, type Rect, type Vec, type Zone } from '../holes';
import { STEP_MS } from '../simulate';
import { AimGuide } from './AimGuide';
import { TEXTURE_KEYS } from './textures';

const RAIL_COLOUR = 0x6b4a2f;
const RAIL_EDGE_COLOUR = 0x8f6a45;
const RAIL_WIDTH = 14;
const CUP_COLOUR = 0x10160f;
const WINDMILL_COLOUR = 0xc8503c;

/**
 * Longest frame the idle spin will honour, in ms. A backgrounded tab hands back one enormous delta
 * when it wakes, and a blade that teleports on the way back reads as a bug.
 */
const MAX_IDLE_DELTA = 100;

/** Radians per frame the drawn blade may close on the simulated one — a quarter turn in four. */
const BLADE_CATCHUP = Math.PI / 8;

/** A blade turned by half a turn is the same blade, so phase differences only matter mod PI. */
function wrapHalfTurn(angle: number): number {
  const wrapped = (((angle + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI;
  return wrapped - Math.PI / 2;
}

/**
 * Draws one hole and the balls on it.
 *
 * Every hole is fitted from the same fixed COURSE_BOUNDS rather than from its own extents, so the
 * on-screen scale is identical on all nine. That matters because putt power is a single global
 * constant: per-hole fitting would make the same dart cover a different visible distance each hole
 * and quietly break the mental map players are building.
 *
 * Textured surfaces are tile sprites clipped to a mask cut to the shape, which is how felt, sand and
 * water get a surface while the shapes themselves stay pure data.
 */
export class CourseView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly ballLayer: Phaser.GameObjects.Container;
  private readonly owned: Phaser.GameObjects.GameObject[] = [];
  private blade: Phaser.GameObjects.Rectangle | null = null;
  /** Drawn blade phase, in radians. Survives a redraw so a resize does not jerk the windmill. */
  private bladeAngle = 0;
  private bladeOmega = 0;
  /** Identifies the windmill the phase belongs to, so changing holes starts a new one cleanly. */
  private bladeKey = '';
  private balls = new Map<string, { body: Phaser.GameObjects.Arc; shine: Phaser.GameObjects.Arc }>();
  private turnRing: Phaser.GameObjects.Arc | null = null;
  private turnTween: Phaser.Tweens.Tween | null = null;
  private readonly aimGuide: AimGuide;
  /** Where the drawn hole's cup is, so the aim guide has something to point at. */
  private cup: Vec | null = null;

  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0);
    this.ballLayer = scene.add.container(0, 0);
    // Lives in the ball layer rather than the geometry: it belongs to whoever is up, not to the hole,
    // so a redraw must leave it alone.
    this.aimGuide = new AimGuide(scene, this.ballLayer);
  }

  /** Recomputes the course-to-screen transform for a playfield rectangle, preserving aspect. */
  setViewport(playfield: Rect): void {
    this.scale = Math.min(playfield.w / COURSE_BOUNDS.w, playfield.h / COURSE_BOUNDS.h);
    this.offsetX = playfield.x + (playfield.w - COURSE_BOUNDS.w * this.scale) / 2;
    this.offsetY = playfield.y + (playfield.h - COURSE_BOUNDS.h * this.scale) / 2;
  }

  toScreenX(x: number): number {
    return this.offsetX + x * this.scale;
  }

  toScreenY(y: number): number {
    return this.offsetY + y * this.scale;
  }

  toScreen(v: Vec): { x: number; y: number } {
    return { x: this.toScreenX(v.x), y: this.toScreenY(v.y) };
  }

  get viewScale(): number {
    return this.scale;
  }

  /** Rebuilds all static geometry. Cheap enough to call on every hole change and every resize. */
  drawHole(hole: Hole): void {
    this.clearGeometry();
    this.cup = hole.cup;

    const points = hole.outline.map((v) => this.toScreen(v));

    this.addSurface(TEXTURE_KEYS.felt, (mask) => {
      mask.fillStyle(0xffffff, 1);
      mask.beginPath();
      mask.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) mask.lineTo(points[i].x, points[i].y);
      mask.closePath();
      mask.fillPath();
    });

    const sandZones = hole.obstacles.filter((o) => o.kind === 'sand').map((o) => o.zone);
    if (sandZones.length > 0) {
      this.addSurface(TEXTURE_KEYS.sand, (mask) => this.fillZones(mask, sandZones));
    }

    const waterZones = hole.obstacles.filter((o) => o.kind === 'water').map((o) => o.zone);
    if (waterZones.length > 0) {
      const water = this.addSurface(TEXTURE_KEYS.water, (mask) => this.fillZones(mask, waterZones));
      // Drifting the tile keeps the caustics alive without another texture or a shader.
      this.scene.tweens.add({
        targets: water,
        tilePositionY: { from: 0, to: 128 },
        duration: 9000,
        repeat: -1,
      });
    }

    const decoration = this.scene.add.graphics();
    this.attach(decoration);

    // Cup first, so a ball sitting in it draws on top.
    const cup = this.toScreen(hole.cup);
    decoration.fillStyle(0x000000, 0.25);
    decoration.fillCircle(cup.x, cup.y + 2 * this.scale, CUP_RADIUS * this.scale * 1.05);
    decoration.fillStyle(CUP_COLOUR, 1);
    decoration.fillCircle(cup.x, cup.y, CUP_RADIUS * this.scale);
    decoration.lineStyle(Math.max(1, 2 * this.scale), 0xe8f0e2, 0.5);
    decoration.strokeCircle(cup.x, cup.y, CUP_RADIUS * this.scale);

    // Tee marker.
    const tee = this.toScreen(hole.tee);
    decoration.lineStyle(Math.max(1, 2 * this.scale), 0xffffff, 0.28);
    decoration.strokeCircle(tee.x, tee.y, BALL_RADIUS * this.scale * 1.7);

    for (const obstacle of hole.obstacles) {
      if (obstacle.kind === 'wall') {
        this.drawRailRect(decoration, obstacle.rect);
      } else if (obstacle.kind === 'bumper') {
        const at = this.toScreen(obstacle.at);
        const r = obstacle.r * this.scale;
        decoration.fillStyle(0x000000, 0.28);
        decoration.fillCircle(at.x, at.y + 3 * this.scale, r);
        decoration.fillStyle(0xe2554d, 1);
        decoration.fillCircle(at.x, at.y, r);
        decoration.fillStyle(0xffffff, 0.30);
        decoration.fillCircle(at.x - r * 0.28, at.y - r * 0.3, r * 0.34);
        decoration.lineStyle(Math.max(1, 2 * this.scale), 0x7d221d, 0.85);
        decoration.strokeCircle(at.x, at.y, r);
      }
    }

    // Rails last: they sit proud of the surface and should overlap everything inside.
    const rails = this.scene.add.graphics();
    this.attach(rails);
    rails.lineStyle(RAIL_WIDTH * this.scale, RAIL_COLOUR, 1);
    rails.beginPath();
    rails.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) rails.lineTo(points[i].x, points[i].y);
    rails.closePath();
    rails.strokePath();
    rails.lineStyle(Math.max(1, 3 * this.scale), RAIL_EDGE_COLOUR, 0.9);
    rails.beginPath();
    rails.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) rails.lineTo(points[i].x, points[i].y);
    rails.closePath();
    rails.strokePath();

    const windmill = hole.obstacles.find((o) => o.kind === 'windmill');
    if (windmill && windmill.kind === 'windmill') {
      const at = this.toScreen(windmill.at);
      const key = `${windmill.at.x},${windmill.at.y},${windmill.length},${windmill.omega}`;
      if (key !== this.bladeKey) {
        this.bladeKey = key;
        this.bladeAngle = windmill.startAngle;
      }
      this.bladeOmega = windmill.omega;

      this.blade = this.scene.add.rectangle(
        at.x,
        at.y,
        windmill.length * this.scale,
        windmill.thickness * this.scale,
        WINDMILL_COLOUR
      );
      this.blade.setStrokeStyle(Math.max(1, 2 * this.scale), 0x7d221d, 0.9);
      this.blade.setRotation(this.bladeAngle);
      this.attach(this.blade);

      const hub = this.scene.add.circle(at.x, at.y, 9 * this.scale, 0x3a2a1c);
      this.attach(hub);
    } else {
      this.blade = null;
      this.bladeOmega = 0;
      this.bladeKey = '';
    }
  }

  /**
   * Idle spin, driven by the frame clock at the windmill's own omega so it turns at exactly the rate
   * it turns at during a putt. Decoration only — the phase that decides where a ball goes belongs to
   * the sim, and the sim takes it back the moment one is struck.
   */
  spinBlade(deltaMs: number): void {
    if (!this.blade || this.bladeOmega === 0) return;
    this.bladeAngle += this.bladeOmega * (Math.min(deltaMs, MAX_IDLE_DELTA) / STEP_MS);
    this.blade.setRotation(this.bladeAngle);
  }

  /**
   * Live blade angle during a putt; the sim owns the phase, this only mirrors it.
   *
   * Mirrors it by closing on it rather than by snapping: the sim restarts the phase at `startAngle`
   * on every putt while the idle spin is wherever real time left it, so the two are almost never in
   * the same place when a ball is struck. The blade is symmetric about its hub, so the gap to close
   * is never more than a quarter turn and is gone within four frames — long before a ball struck
   * from any tee is near the windmill, and exact from then on.
   */
  setBladeAngle(angle: number): void {
    if (!this.blade) return;
    const lag = wrapHalfTurn(angle - this.bladeAngle);
    this.bladeAngle += Math.max(-BLADE_CATCHUP, Math.min(BLADE_CATCHUP, lag));
    this.blade.setRotation(this.bladeAngle);
  }

  /**
   * Positions one ball. There is one per side, so `ballId` is a team id — team-mates share a ball
   * and a colour. `ghost` is every side that is not the one currently putting — drawn translucent
   * because other balls are deliberately not solid: a stroke can only ever move its own side's ball,
   * so the field is information, not an obstacle.
   */
  setBall(ballId: string, at: Vec, colour: number, ghost: boolean, visible = true): void {
    let ball = this.balls.get(ballId);
    if (!ball) {
      const body = this.scene.add.circle(0, 0, 1, colour);
      const shine = this.scene.add.circle(0, 0, 1, 0xffffff, 0.55);
      this.ballLayer.add([body, shine]);
      ball = { body, shine };
      this.balls.set(ballId, ball);
    }

    const screen = this.toScreen(at);
    const r = BALL_RADIUS * this.scale;

    ball.body.setPosition(screen.x, screen.y);
    ball.body.setRadius(r);
    ball.body.setFillStyle(colour);
    ball.body.setAlpha(ghost ? 0.42 : 1);
    ball.body.setVisible(visible);
    ball.body.setStrokeStyle(Math.max(1, 1.5 * this.scale), 0x0d1a10, ghost ? 0.3 : 0.7);

    ball.shine.setPosition(screen.x - r * 0.3, screen.y - r * 0.32);
    ball.shine.setRadius(Math.max(1, r * 0.32));
    ball.shine.setAlpha(ghost ? 0.18 : 0.55);
    ball.shine.setVisible(visible);
  }

  /**
   * A pulsing ring around the ball whose turn it is — the on-course half of the turn indicator, so
   * "are we up?" is answerable from the playfield without reading the rail. Pass null while a putt
   * is in flight or the match is over.
   */
  setTurnMarker(at: Vec | null, colour = 0xffffff): void {
    if (!at) {
      this.turnRing?.setVisible(false);
      return;
    }

    const radius = BALL_RADIUS * this.scale * 1.9;

    if (!this.turnRing) {
      this.turnRing = this.scene.add.circle(0, 0, radius);
      // Outline only: a filled disc would just hide the ball it is pointing at.
      this.turnRing.setFillStyle();
      this.ballLayer.add(this.turnRing);
      this.ballLayer.sendToBack(this.turnRing);
      this.turnTween = this.scene.tweens.add({
        targets: this.turnRing,
        scale: { from: 0.85, to: 1.2 },
        alpha: { from: 1, to: 0.25 },
        duration: 780,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this.turnRing.setRadius(radius);
    this.turnRing.setStrokeStyle(Math.max(2, 2.5 * this.scale), colour, 1);
    this.turnRing.setPosition(this.toScreenX(at.x), this.toScreenY(at.y));
    this.turnRing.setVisible(true);
  }

  /**
   * The dartboard numbers around the ball that is up, pointing at the cup — see AimGuide. Takes the
   * same null as setTurnMarker, and for the same reason: once a putt is away, there is nothing left
   * to aim.
   */
  setAimGuide(at: Vec | null, colour = 0xffffff): void {
    if (!at || !this.cup) {
      this.aimGuide.hide();
      return;
    }
    this.aimGuide.show(at, this.cup, (v) => this.toScreen(v), this.scale, colour);
  }

  removeBallsExcept(ballIds: string[]): void {
    for (const [id, ball] of this.balls) {
      if (ballIds.includes(id)) continue;
      ball.body.destroy();
      ball.shine.destroy();
      this.balls.delete(id);
    }
  }

  destroy(): void {
    this.clearGeometry();
    this.aimGuide.destroy();
    this.turnTween?.remove();
    this.turnTween = null;
    this.turnRing = null;
    for (const ball of this.balls.values()) {
      ball.body.destroy();
      ball.shine.destroy();
    }
    this.balls.clear();
    this.root.destroy();
    this.ballLayer.destroy();
  }

  // -------------------------------------------------------------------------------------------

  private attach(object: Phaser.GameObjects.GameObject): void {
    this.root.add(object);
    this.owned.push(object);
  }

  /** A tile sprite covering the whole playfield, clipped to whatever `shape` draws. */
  private addSurface(
    textureKey: string,
    shape: (mask: Phaser.GameObjects.Graphics) => void
  ): Phaser.GameObjects.TileSprite {
    const surface = this.scene.add.tileSprite(
      this.offsetX,
      this.offsetY,
      COURSE_BOUNDS.w * this.scale,
      COURSE_BOUNDS.h * this.scale,
      textureKey
    );
    surface.setOrigin(0, 0);

    const maskShape = this.scene.make.graphics({}, false);
    shape(maskShape);

    // Phaser 4 splits masking by renderer, and getting only half of it right is why an unclipped
    // hazard paints the whole playfield: a GeometryMask is Canvas-only and is silently ignored under
    // WebGL, where a mask is a filter fed by a Game Object instead. Set both — whichever renderer
    // Phaser.AUTO picked, the other is a no-op.
    surface.setMask(maskShape.createGeometryMask());
    surface.enableFilters();
    surface.filters?.external.addMask(maskShape);

    this.attach(surface);
    // Not attached to the container: a mask shape is geometry, never rendered, and adding it to the
    // display list would paint a white blob over the hole.
    this.owned.push(maskShape);

    return surface;
  }

  private fillZones(mask: Phaser.GameObjects.Graphics, zones: Zone[]): void {
    mask.fillStyle(0xffffff, 1);
    for (const zone of zones) {
      if (zone.kind === 'circle') {
        const at = this.toScreen(zone.at);
        mask.fillCircle(at.x, at.y, zone.r * this.scale);
      } else {
        const at = this.toScreen({ x: zone.rect.x, y: zone.rect.y });
        mask.fillRect(at.x, at.y, zone.rect.w * this.scale, zone.rect.h * this.scale);
      }
    }
  }

  private drawRailRect(graphics: Phaser.GameObjects.Graphics, rect: Rect): void {
    const at = this.toScreen({ x: rect.x, y: rect.y });
    const w = rect.w * this.scale;
    const h = rect.h * this.scale;
    graphics.fillStyle(0x000000, 0.25);
    graphics.fillRect(at.x, at.y + 3 * this.scale, w, h);
    graphics.fillStyle(RAIL_COLOUR, 1);
    graphics.fillRect(at.x, at.y, w, h);
    graphics.lineStyle(Math.max(1, 2 * this.scale), RAIL_EDGE_COLOUR, 0.9);
    graphics.strokeRect(at.x, at.y, w, h);
  }

  private clearGeometry(): void {
    for (const object of this.owned) object.destroy();
    this.owned.length = 0;
    this.blade = null;
  }
}
