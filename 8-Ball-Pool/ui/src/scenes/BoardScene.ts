import Phaser from "phaser";
import type { Ball } from "../physics/ball";
import { PHYSICS, SUBSTEP_DT } from "../physics/constants";
import { POCKETS } from "../physics/table";
import { length, sub, type Vec2 } from "../physics/vec2";
import type { TrajectoryFrame } from "../physics/events";
import { GAME_STATE_EVENT, gameStateEvents, getLatestUpdate, type BoardUpdate } from "../bridge";
import type { GameState } from "../rules";

const FELT_COLOR = 0x0b5c3a;
const RAIL_COLOR = 0x5c3a24;
const POCKET_COLOR = 0x0a0a0a;
const CUE_COLOR = 0xf5f0e6;
const EIGHT_COLOR = 0x111111;
const AIM_GUIDE_COLOR = 0xffd23d;
const AIM_LOCKED_COLOR = 0xffffff;
const AIM_TO_POCKET_COLOR = 0xffffff;

/** Shared with `drawSunkTray`, which anchors to the canvas edge the same way `computeProjection` does. */
const MARGIN_PX = 40;

/** Reserved band at the bottom of the canvas for the sunk-balls tray — mirrors the `- 120` reserved for
 *  the top HUD in `computeProjection`, so the table shrinks and never overlaps either. */
const TRAY_HEIGHT = 70;
const TRAY_MAX_BALLS = 15;

/** How long a pocketed ball keeps "rolling" (shrinking/fading/spinning into the pocket) during shot
 *  replay before it's fully gone. Also how much longer `ActiveAnimation` stays alive past the
 *  trajectory's last recorded instant, so a ball pocketed right at the end still finishes its drop. */
const DROP_DURATION_S = 0.3;

/** How long the turn banner (see `drawTurnBanner`) stays up after a turn change before auto-hiding, so
 *  the incoming player gets the board back to aim with even if their first dart takes a while to arrive —
 *  there's no protocol event for "darts have been cleared off the board" to wait for instead (only darts
 *  landing and visit-ended flags), so this timer is what stands in for that real-world clearing window. */
const TURN_BANNER_DURATION_S = 2.5;

/** Real-world 8-ball colour convention: solids 1-7, stripes 9-15 share their solid's base colour. */
const BALL_BASE_COLOR: Record<number, number> = {
  1: 0xf6c915,
  2: 0x1c3fc4,
  3: 0xd7263d,
  4: 0x7a3ca3,
  5: 0xf07d19,
  6: 0x1c8c4b,
  7: 0x7a1f2b,
};

function colorForBall(ball: Ball): number {
  if (ball.kind === "cue") return CUE_COLOR;
  if (ball.kind === "eight") return EIGHT_COLOR;
  const base = ball.number > 8 ? ball.number - 8 : ball.number;
  return BALL_BASE_COLOR[base] ?? 0x999999;
}

/**
 * Maps physics table units (§19: x in [0, width], y in [0, height], +y toward the foot rail) to screen
 * pixels. Physics/rules never flip Y — that would break the table-fixed direction convention shared with
 * the dartboard frame (§11.1) — so the flip lives here, in the one place that only ever draws.
 */
class TableProjection {
  constructor(
    private readonly originX: number,
    private readonly originY: number,
    private readonly scale: number,
    private readonly tableHeightPx: number
  ) {}

  point(x: number, y: number): { x: number; y: number } {
    return { x: this.originX + x * this.scale, y: this.originY + this.tableHeightPx - y * this.scale };
  }

  length(units: number): number {
    return units * this.scale;
  }
}

function computeProjection(scale: Phaser.Scale.ScaleManager): TableProjection {
  const availableW = Math.max(200, scale.width - MARGIN_PX * 2);
  const availableH = Math.max(100, scale.height - MARGIN_PX * 2 - 120 - TRAY_HEIGHT); // room for HUD/tray
  const pxPerUnit = Math.min(availableW / PHYSICS.table.width, availableH / PHYSICS.table.height);
  const tableWidthPx = PHYSICS.table.width * pxPerUnit;
  const tableHeightPx = PHYSICS.table.height * pxPerUnit;
  const originX = (scale.width - tableWidthPx) / 2;
  const originY = MARGIN_PX + 60;
  return new TableProjection(originX, originY, pxPerUnit, tableHeightPx);
}

/** Where a ray from `origin` in direction `dir` (assumed inside the table) exits the table rectangle. */
function clipToTableEdge(origin: Vec2, dir: Vec2): Vec2 {
  const w = PHYSICS.table.width;
  const h = PHYSICS.table.height;
  const EPS = 1e-9;
  let t = Infinity;
  if (dir.x > EPS) t = Math.min(t, (w - origin.x) / dir.x);
  else if (dir.x < -EPS) t = Math.min(t, (0 - origin.x) / dir.x);
  if (dir.y > EPS) t = Math.min(t, (h - origin.y) / dir.y);
  else if (dir.y < -EPS) t = Math.min(t, (0 - origin.y) / dir.y);
  if (!isFinite(t) || t < 0) t = 0;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
}

function strokeDashedLine(
  g: Phaser.GameObjects.Graphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
  dash: number,
  gap: number
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const ux = dx / dist;
  const uy = dy / dist;
  let travelled = 0;
  while (travelled < dist) {
    const segEnd = Math.min(travelled + dash, dist);
    g.beginPath();
    g.moveTo(from.x + ux * travelled, from.y + uy * travelled);
    g.lineTo(from.x + ux * segEnd, from.y + uy * segEnd);
    g.strokePath();
    travelled += dash + gap;
  }
}

/** A shot's frame-by-frame replay, driven off `GameState.lastShot.trajectory` in real time (1 physics
 *  second == 1 real second, since substeps are evenly spaced — see physics/simulate.ts). */
interface ActiveAnimation {
  trajectory: readonly TrajectoryFrame[];
  startMs: number;
  /** The shot's final ball list, for id/kind/number — only `pos` is replaced per frame. */
  ballMeta: readonly Ball[];
}

export class BoardScene extends Phaser.Scene {
  private root!: Phaser.GameObjects.Container;
  private lastUpdate: BoardUpdate | null = null;
  private animation: ActiveAnimation | null = null;
  /** `GameState.lastShotId` of the shot we've already started animating, so a later shot (even one
   *  folded into the same visit as the last — see `applyVisit`'s multi-shot-per-visit) is still detected
   *  as new. Comparing `lastShot` by reference doesn't work here: `replay()` rebuilds it from scratch on
   *  every state push, so an unrelated push (e.g. the next dart being thrown) would look like a "new" shot
   *  via `!==` even when it's the same one recomputed. `lastShotId` stays content-stable across those
   *  recomputes and only changes when the shot actually fired is a different one. */
  private lastAnimatedShotId: string | null = null;
  /** Animation-clock `elapsed` (seconds) at which each ball was first seen inside a pocket during the
   *  current `animation`, keyed by ball id — drives `drawFallingBall`'s drop progress. Reset whenever a
   *  new animation starts. */
  private pocketDropStart = new Map<string, number>();
  /** The player id last seen actively taking their turn — `shotPhase.kind !== "awaitingDarts"` at some
   *  point (collecting darts, or placing ball-in-hand). `awaitingDarts` alone doesn't mean a new player is
   *  up: the *same* shooter revisits it between shots within one continuing visit (e.g. after legally
   *  potting a ball — see `applyVisit`'s multi-shot-per-visit), and the board must stay visible then so
   *  they can aim their next shot. Comparing `currentPlayerId` against this is what tells a genuine turn
   *  change (show the banner) apart from that same-player pause (don't). */
  private lastActiveShooterId: string | null = null;
  /** `this.time.now` at the moment the turn banner started showing for the current turn change, or null
   *  when it isn't showing — drives its `TURN_BANNER_DURATION_S` auto-hide in `isTurnBannerActive`. Set
   *  once per turn change (not on every push while still `awaitingDarts`) so an unrelated re-push doesn't
   *  restart its clock. */
  private turnBannerShownAtMs: number | null = null;

  constructor() {
    super("board");
  }

  create(): void {
    this.root = this.add.container(0, 0);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.rerender, this);

    const onGameState = (update: BoardUpdate) => this.onGameState(update);
    gameStateEvents.on(GAME_STATE_EVENT, onGameState);

    const missed = getLatestUpdate();
    if (missed) this.onGameState(missed);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameStateEvents.off(GAME_STATE_EVENT, onGameState);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.rerender, this);
    });
  }

  /** Phaser's per-frame tick — the only thing driving redraws while a shot is mid-roll, or the turn banner
   *  is counting down to its auto-hide, and no new BoardUpdate has arrived to trigger one. */
  update(): void {
    if (this.animation || this.turnBannerShownAtMs !== null) this.redraw();
  }

  private onGameState(update: BoardUpdate): void {
    this.lastUpdate = update;
    const state = update.state;

    if (state.shotPhase.kind !== "awaitingDarts") {
      this.lastActiveShooterId = state.currentPlayerId;
    } else if (state.currentPlayerId !== this.lastActiveShooterId && this.turnBannerShownAtMs === null) {
      this.turnBannerShownAtMs = this.time.now;
    }

    const trajectory = update.state.lastShot?.trajectory;
    const shotId = update.state.lastShotId;
    if (trajectory && trajectory.length > 1 && shotId !== null && shotId !== this.lastAnimatedShotId) {
      this.lastAnimatedShotId = shotId;
      this.animation = { trajectory, startMs: this.time.now, ballMeta: update.state.table.balls };
      this.pocketDropStart = new Map();
    }

    this.redraw();
  }

  private rerender(): void {
    this.redraw();
  }

  /** Returns the trajectory frame for "now" plus the raw elapsed time, or null once the animation
   *  (including the extra `DROP_DURATION_S` grace window for any still-dropping pocketed ball) has
   *  fully finished (clearing `this.animation` as a side effect so the caller falls back to the resting
   *  board state). Elapsed keeps advancing past the trajectory's last recorded instant during that grace
   *  window, while `frame` freezes on the final trajectory frame — `drawFallingBall` uses elapsed for its
   *  own timing regardless of which frame is showing. */
  private currentAnimationFrame(): { frame: TrajectoryFrame; elapsed: number } | null {
    const anim = this.animation;
    if (!anim) return null;
    const elapsed = (this.time.now - anim.startMs) / 1000;
    const last = anim.trajectory[anim.trajectory.length - 1];
    if (elapsed >= last.t + DROP_DURATION_S) {
      this.animation = null;
      return null;
    }
    const clampedElapsed = Math.min(elapsed, last.t);
    const idx = Math.min(anim.trajectory.length - 1, Math.max(0, Math.floor(clampedElapsed / SUBSTEP_DT)));
    return { frame: anim.trajectory[idx], elapsed };
  }

  /** Whether the turn banner should still be up: only within `TURN_BANNER_DURATION_S` of the turn change
   *  that started it, and only for as long as the incoming player still hasn't thrown (`awaitingDarts`) —
   *  whichever ends it first. Clears `turnBannerShownAtMs` as a side effect once either condition lapses,
   *  mirroring `currentAnimationFrame`'s style, so `update()` stops re-rendering every frame once it's done. */
  private isTurnBannerActive(state: GameState): boolean {
    if (this.turnBannerShownAtMs === null) return false;
    if (state.shotPhase.kind !== "awaitingDarts" || this.time.now - this.turnBannerShownAtMs >= TURN_BANNER_DURATION_S * 1000) {
      this.turnBannerShownAtMs = null;
      return false;
    }
    return true;
  }

  private redraw(): void {
    if (!this.lastUpdate) return;
    const state = this.lastUpdate.state;
    this.root.removeAll(true);
    const proj = computeProjection(this.scale);

    this.drawTable(proj);

    const anim = this.currentAnimationFrame();
    // Shown for a fixed window right after the turn passes to a new player — standing in for the
    // real-world gap while the previous player's darts are pulled off the board, which the protocol has
    // no explicit event for (only darts landing and visit-ended flags — see `TURN_BANNER_DURATION_S`).
    // Held off while a shot's roll animation is still finishing, so ending a turn never cuts off the
    // outgoing player's own shot replay.
    const showTurnBanner = !anim && !state.isComplete && this.isTurnBannerActive(state);

    if (anim && this.animation) {
      this.drawBallsAtPositions(proj, this.animation.ballMeta, anim.frame.positions, anim.elapsed);
    } else {
      this.drawBalls(proj, state);
      // Only show the aim line once the balls from any prior shot have actually settled — drawing it
      // over a still-rolling table would point at positions the balls haven't reached yet. Also skipped
      // under the turn banner, which dims the table anyway.
      if (!showTurnBanner) this.drawAimIndicator(proj, state);
    }

    this.drawHud(state, this.lastUpdate.playerNames);
    this.drawSunkTray(state);

    if (showTurnBanner) this.drawTurnBanner(state, this.lastUpdate.playerNames);
    if (state.isComplete) this.drawWinner(state, this.lastUpdate.playerNames);
  }

  private drawTable(proj: TableProjection): void {
    const g = this.add.graphics();
    const topLeft = proj.point(0, PHYSICS.table.height);
    const w = proj.length(PHYSICS.table.width);
    const h = proj.length(PHYSICS.table.height);

    g.fillStyle(RAIL_COLOR, 1);
    g.fillRoundedRect(topLeft.x - 18, topLeft.y - 18, w + 36, h + 36, 12);
    g.fillStyle(FELT_COLOR, 1);
    g.fillRect(topLeft.x, topLeft.y, w, h);

    for (const pocket of POCKETS) {
      const p = proj.point(pocket.pos.x, pocket.pos.y);
      g.fillStyle(POCKET_COLOR, 1);
      g.fillCircle(p.x, p.y, proj.length(PHYSICS.pocket.radius));
    }
    this.root.add(g);
  }

  private nearestPocket(pos: Vec2): { id: string; pos: Vec2 } | null {
    for (const pocket of POCKETS) {
      if (length(sub(pos, pocket.pos)) <= PHYSICS.pocket.radius) return pocket;
    }
    return null;
  }

  private drawBalls(proj: TableProjection, state: GameState): void {
    for (const ball of state.table.balls) {
      if (ball.pocketed) continue;
      this.drawBall(proj, ball);
    }
  }

  /** Same as `drawBalls`, but positioned from a trajectory frame instead of final rest state. A ball
   *  that has entered a pocket mouth (mirroring physics/step.ts's `capturePockets` exactly, since
   *  `ballMeta.pocketed` is only true at the *end*) rolls into it via `drawFallingBall` instead of just
   *  vanishing, timed off `elapsed` (the animation clock, in seconds) rather than a per-frame tween, since
   *  `redraw()` rebuilds the whole display list from scratch every call. */
  private drawBallsAtPositions(
    proj: TableProjection,
    ballMeta: readonly Ball[],
    positions: Record<string, Vec2>,
    elapsed: number
  ): void {
    for (const meta of ballMeta) {
      const pos = positions[meta.id];
      if (!pos) continue;
      const pocket = this.nearestPocket(pos);
      if (pocket) {
        let dropStart = this.pocketDropStart.get(meta.id);
        if (dropStart === undefined) {
          dropStart = elapsed;
          this.pocketDropStart.set(meta.id, dropStart);
        }
        const progress = Math.min(1, (elapsed - dropStart) / DROP_DURATION_S);
        if (progress < 1) this.drawFallingBall(proj, { ...meta, pos }, pocket, progress);
        continue;
      }
      this.drawBall(proj, { ...meta, pos });
    }
  }

  private drawBall(proj: TableProjection, ball: Ball): void {
    const p = proj.point(ball.pos.x, ball.pos.y);
    const r = proj.length(PHYSICS.ball.radius);
    this.paintBallAt(p.x, p.y, r, ball);
  }

  /** Falling into a pocket during shot replay: lerps from the ball's frozen in-pocket position (positions
   *  of already-pocketed balls stop changing in the trajectory, since `step.ts`'s `integrate()` skips
   *  pocketed balls — so `ball.pos` here is exactly the capture point) toward the pocket's center, while
   *  shrinking, fading, and spinning it so it reads as rolling in rather than just disappearing. */
  private drawFallingBall(
    proj: TableProjection,
    ball: Ball,
    pocket: { pos: Vec2 },
    progress: number
  ): void {
    const start = proj.point(ball.pos.x, ball.pos.y);
    const end = proj.point(pocket.pos.x, pocket.pos.y);
    const x = start.x + (end.x - start.x) * progress;
    const y = start.y + (end.y - start.y) * progress;
    const r = proj.length(PHYSICS.ball.radius) * (1 - progress * 0.7);

    const container = this.add.container(x, y);
    container.setRotation(progress * Math.PI * 4);
    container.setAlpha(1 - progress);
    const g = this.add.graphics();
    this.paintBallShape(g, 0, 0, r, ball);
    container.add(g);
    this.root.add(container);
  }

  /** Draws a ball's number label at `(x, y)` — factored out of `paintBallAt` so the sunk-balls tray can
   *  skip it at its smaller size without duplicating the color/stripe logic. */
  private paintBallAt(x: number, y: number, r: number, ball: Ball): void {
    const g = this.add.graphics();
    this.paintBallShape(g, x, y, r, ball);
    this.root.add(g);

    if (ball.kind !== "cue") {
      const label = this.add
        .text(x, y, String(ball.number), {
          fontFamily: "sans-serif",
          fontSize: `${Math.max(8, r)}px`,
          color: ball.kind === "eight" || ball.number <= 7 || ball.kind === "stripe" ? "#ffffff" : "#000000",
        })
        .setOrigin(0.5, 0.5);
      this.root.add(label);
    }
  }

  /** The bare filled/stroked circle (plus stripe band) for `ball` at `(x, y)`, with no number label —
   *  usable both directly (screen coords) and inside a `Container` (local coords, e.g. for the falling-
   *  ball roll effect, where the container itself carries position/rotation/alpha). */
  private paintBallShape(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, ball: Ball): void {
    const color = colorForBall(ball);
    if (ball.kind === "stripe") {
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, r);
      g.fillStyle(color, 1);
      g.fillRect(x - r, y - r * 0.45, r * 2, r * 0.9);
    } else {
      g.fillStyle(color, 1);
      g.fillCircle(x, y, r);
    }
    g.lineStyle(1, 0x000000, 0.5);
    g.strokeCircle(x, y, r);
  }

  /** Sunk balls, left-to-right in the order they dropped, in the reserved band at the bottom of the
   *  canvas (`TRAY_HEIGHT`, carved out of `availableH` in `computeProjection`) — fixed screen space, like
   *  the HUD text, not table-projection space. */
  private drawSunkTray(state: GameState): void {
    const { width, height } = this.scale;
    const trayTop = height - MARGIN_PX - TRAY_HEIGHT;

    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.35);
    bg.fillRoundedRect(MARGIN_PX, trayTop, width - MARGIN_PX * 2, TRAY_HEIGHT, 8);
    this.root.add(bg);

    this.root.add(
      this.add.text(MARGIN_PX + 10, trayTop + 6, "Pocketed", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#e9e4d6",
      })
    );

    if (state.pocketedOrder.length === 0) return;

    const availableWidth = width - MARGIN_PX * 2 - 20;
    const spacing = Math.min(32, availableWidth / TRAY_MAX_BALLS);
    const r = Math.max(6, spacing / 2 - 3);
    const y = trayTop + TRAY_HEIGHT / 2 + 8;

    state.pocketedOrder.forEach((info, i) => {
      const x = MARGIN_PX + 10 + spacing / 2 + i * spacing;
      this.paintBallAt(x, y, r, { id: info.ballId, kind: info.kind, number: info.number, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, pocketed: true });
    });
  }

  /**
   * SCOPE.md §25.3: "a future version can provide an aiming line" — draws it from the cue ball toward
   * the recommended/locked aim direction. Yellow-dashed while it's only the recommender's suggestion
   * (Beginner/Intermediate, before a direction dart lands); solid white once a dart has actually locked
   * the fired direction (any difficulty, including Advanced, which has no recommendation to suggest).
   * On a "pot" tier shot it also draws the object ball's path to the intended pocket.
   */
  private drawAimIndicator(proj: TableProjection, state: GameState): void {
    // Same "game-ending foul" exception as drawHud's AIM FOR line — see the comment there.
    if (state.foulBanner && state.shotPhase.kind !== "ballInHand") return;
    const preview = state.shotPreview;
    if (!preview) return;

    // `preview.directionLocked` is also (ab)used, right after a shot fires and before the next dart
    // lands, to report *that finished shot's* own direction (see rules.ts's buildShotPreview) — not a
    // lock on the upcoming one. Only trust it as "locked" while actually mid-collection for this shot.
    const locked = state.shotPhase.kind === "collecting" ? preview.directionLocked : null;
    const aim = locked ?? (state.difficulty !== "advanced" ? preview.aimUnitVector : null);
    if (!aim) return;

    const cue = state.table.balls.find((b) => b.id === "cue");
    if (!cue || cue.pocketed) return;

    // Once a dart has locked the actual fired direction, the line must follow *that* direction to the
    // table edge — not snap to the recommender's target ball, which was picked for the "best" shot and
    // may not even lie along the direction the player actually threw.
    const targetBall =
      !locked && preview.targetBallNumber != null
        ? state.table.balls.find((b) => b.number === preview.targetBallNumber && !b.pocketed)
        : null;

    const endTable = targetBall ? targetBall.pos : clipToTableEdge(cue.pos, aim);
    const cueP = proj.point(cue.pos.x, cue.pos.y);
    const endP = proj.point(endTable.x, endTable.y);

    const g = this.add.graphics();
    if (locked) {
      g.lineStyle(2, AIM_LOCKED_COLOR, 0.9);
      g.beginPath();
      g.moveTo(cueP.x, cueP.y);
      g.lineTo(endP.x, endP.y);
      g.strokePath();
    } else {
      g.lineStyle(2, AIM_GUIDE_COLOR, 0.65);
      strokeDashedLine(g, cueP, endP, 8, 6);
    }
    this.root.add(g);

    if (targetBall && preview.tier === "pot" && preview.pocketId) {
      const pocket = POCKETS.find((p) => p.id === preview.pocketId);
      if (pocket) {
        const tP = proj.point(targetBall.pos.x, targetBall.pos.y);
        const pP = proj.point(pocket.pos.x, pocket.pos.y);
        const g2 = this.add.graphics();
        g2.lineStyle(2, AIM_TO_POCKET_COLOR, 0.45);
        strokeDashedLine(g2, tP, pP, 6, 5);
        this.root.add(g2);
      }
    }
  }

  private drawHud(state: GameState, playerNames: Record<string, string>): void {
    const lines: string[] = [];
    lines.push(`Difficulty: ${state.difficulty}`);

    for (const team of state.teams) {
      const names = team.playerIds.map((id) => playerNames[id] ?? "Player").join(" / ");
      const group = state.table.groupByTeam[team.groupIndex];
      const label = group === "solids" ? "Solids" : group === "stripes" ? "Stripes" : "Open";
      const marker = team.groupIndex === state.currentGroupIndex ? "> " : "  ";
      lines.push(`${marker}Team ${team.groupIndex + 1} (${label}): ${names}`);
    }

    if (state.shotPhase.kind === "ballInHand") {
      lines.push("BALL IN HAND — cue ball placed, aim your shot");
    } else if (state.foulBanner === "scratch") {
      lines.push("SCRATCH! Foul.");
    } else if (state.foulBanner === "noContact") {
      lines.push("NO CONTACT — Foul.");
    }

    // Suppressed only for the rare game-ending foul (banner shown above, no next shot to preview) — a
    // foul that instead leaves the game ongoing keeps `foulBanner` set through the whole ball-in-hand
    // wait, so gating on shotPhase too (rather than just `!foulBanner`) is what lets the placed cue
    // ball's aim guidance show up during that wait instead of staying hidden behind the banner.
    if (state.shotPreview && (!state.foulBanner || state.shotPhase.kind === "ballInHand")) {
      const preview = state.shotPreview;
      if (state.difficulty !== "advanced" && preview.recommendedSegment !== null) {
        lines.push(`AIM FOR ${preview.recommendedSegment}`);
      }
      if (state.shotPhase.kind === "collecting") {
        lines.push(`Step: ${state.shotPhase.step}`);
      }
      if (preview.power !== null) {
        const bars = Math.round(preview.power * 10);
        lines.push(`Power: ${"#".repeat(bars)}${".".repeat(10 - bars)}`);
      }
    }

    this.root.add(
      this.add.text(20, 20, lines.join("\n"), {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#e9e4d6",
        lineSpacing: 4,
      })
    );
  }

  /** Big centered "whose turn is it" card, dimming the (otherwise-settled) table behind it. Shown only
   *  across an actual turn change, for up to `TURN_BANNER_DURATION_S` — or less, if the incoming player's
   *  first dart lands sooner — see `isTurnBannerActive`. */
  private drawTurnBanner(state: GameState, playerNames: Record<string, string>): void {
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.72);
    this.root.add(overlay);

    const name = playerNames[state.currentPlayerId ?? ""] ?? "Player";
    const nameText = this.add
      .text(width / 2, height / 2 - 16, name, {
        fontFamily: "sans-serif",
        fontSize: "56px",
        fontStyle: "bold",
        color: "#e9e4d6",
        align: "center",
      })
      .setOrigin(0.5, 0.5);
    this.root.add(nameText);

    const subtitle = this.add
      .text(width / 2, height / 2 + 48, "GET READY — CLEARING THE BOARD", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#d9b23d",
        align: "center",
      })
      .setOrigin(0.5, 0.5);
    this.root.add(subtitle);
  }

  private drawWinner(state: GameState, playerNames: Record<string, string>): void {
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.6);
    const names = state.winnerPlayerIds.map((id) => playerNames[id] ?? "Player").join(" / ");
    const text = this.add
      .text(width / 2, height / 2, `${names} WINS!`, {
        fontFamily: "sans-serif",
        fontSize: "32px",
        color: "#d9b23d",
        align: "center",
      })
      .setOrigin(0.5, 0.5);
    this.root.add(overlay);
    this.root.add(text);
  }
}
