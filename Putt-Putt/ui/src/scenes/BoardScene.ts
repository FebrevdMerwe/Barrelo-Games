import Phaser from 'phaser';
import { GAME_STATE_EVENT, gameStateEvents, getLatestUpdate, type BoardUpdate } from '../bridge';
import { MAX_STROKES, parThrough, type GameEvent, type Team } from '../rules';
import type { Hole, Rect } from '../holes';
import { createSim, stepSim, type SimContext } from '../simulate';
import { AnimationQueue, type AbortableAnimation } from '../ui/AnimationQueue';
import { CourseView } from '../ui/CourseView';
import { diffEvents } from '../ui/eventTail';
import { colourForTeam, teamLabel } from '../ui/teams';
import { Scorecard } from '../ui/Scorecard';
import { ScorePopup, type ScoreCardResult, type ScorePopupHandle } from '../ui/ScorePopup';

const HEADER_HEIGHT = 52;
const MIN_RAIL = 150;
const MAX_RAIL = 210;

/** Steps per rendered frame. One is real time; three is the catch-up rate when darts stack up. */
const NORMAL_RATE = 1;
const CATCHUP_RATE = 3;
const CATCHUP_THRESHOLD = 2;

/** Beats for the events that aren't a rolling ball, in ms. */
const BEAT_BULL = 260;
const BEAT_HOLE_START = 380;
const BEAT_HOLE_COMPLETE = 700;

/**
 * How long the score card stays up when there is no End Turn left to wait for — a card reached after
 * the visit had already closed, or the very last card of a finished match.
 */
const HOLD_SCORE = 1500;

type PuttEvent = Extract<GameEvent, { type: 'putt' }>;

/**
 * The board.
 *
 * The physics here is a genuinely live Phaser Matter world — real bodies, real collisions — not a
 * recording being played back. What keeps it honest is that it is driven by the same simulate.ts
 * that rules.ts runs headlessly, at the same fixed step, with autoUpdate switched off so Phaser's
 * frame-delta smoothing can never touch it. Both arrive at the same rest position, so the board can
 * show real physics while replay() stays a pure function of the log.
 *
 * Rendering is driven by the derived event stream rather than by state diffing: diffEvents decides
 * whether what just arrived extends what is already on screen (animate the tail) or not (an undo, a
 * refresh, a TV switched on mid-match — snap, and animate nothing).
 */
export class BoardScene extends Phaser.Scene {
  private courseView!: CourseView;
  private scorecard!: Scorecard;
  private scorePopup!: ScorePopup;
  private queue!: AnimationQueue;

  private latest: BoardUpdate | null = null;
  private playedEvents: GameEvent[] | null = null;
  private drawnHoleIndex = -1;

  private activePutt: {
    ctx: SimContext;
    event: PuttEvent;
    rate: number;
    settle: () => void;
  } | null = null;

  /** Holes finished but not yet announced. They wait for the player to run out of darts. */
  private pendingScores: ScoreCardResult[] = [];
  /** The card currently on screen, kept so End Turn has something to take down. */
  private showingScore: ScorePopupHandle | null = null;
  private announcing = false;

  constructor() {
    super('board');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0d1710');

    this.courseView = new CourseView(this);
    this.scorecard = new Scorecard(this);
    this.scorePopup = new ScorePopup(this);
    // The HUD is deliberately held back until nothing is moving: the scorecard and the header would
    // otherwise announce a new hole, or a stroke count, while the ball responsible is still rolling.
    // Only the queue can tell when that is — an animation's own settle() runs while the queue is
    // still awaiting it, so it can never observe itself as idle.
    this.queue = new AnimationQueue(
      (event, pending) => this.animate(event, pending),
      () => this.onQueueIdle()
    );

    // Phaser's Matter runner smooths and snaps frame deltas, which would make the simulation
    // frame-rate dependent and put this world out of step with the one rules.ts runs. Everything
    // here is stepped by hand instead, from update().
    this.matter.world.autoUpdate = false;

    const onGameState = (update: BoardUpdate) => this.receive(update);
    gameStateEvents.on(GAME_STATE_EVENT, onGameState);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    // Barrelo pushes only when state changes, and the push on page load usually lands while Boot and
    // Preloader are still running — so catch up on whatever arrived before this scene existed.
    const missed = getLatestUpdate();
    if (missed) this.receive(missed);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameStateEvents.off(GAME_STATE_EVENT, onGameState);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.queue.cancelAll();
      this.abortScores();
      this.courseView.destroy();
      this.scorecard.destroy();
      this.scorePopup.destroy();
    });
  }

  update(_time: number, delta: number): void {
    const active = this.activePutt;
    if (!active) {
      // The windmill turns whether or not anyone is putting. A blade that only moves while a ball is
      // rolling reads as a broken hole, and it is the one thing on the course that is supposed to be
      // running on its own. Purely cosmetic — see CourseView.spinBlade.
      this.courseView.spinBlade(delta);
      return;
    }

    for (let i = 0; i < active.rate; i++) {
      if (stepSim(active.ctx) !== 'rolling') break;
    }

    this.paintRollingBall(active);

    if (active.ctx.outcome !== 'rolling') active.settle();
  }

  // -------------------------------------------------------------------------------------------
  // State in
  // -------------------------------------------------------------------------------------------

  private receive(update: BoardUpdate): void {
    this.latest = update;
    const delta = diffEvents(this.playedEvents, update.state.events);
    this.playedEvents = update.state.events;

    if (delta.kind === 'resync') {
      this.queue.cancelAll();
      this.activePutt = null;
      this.abortScores();
      this.redrawAll();
      return;
    }

    if (delta.events.length === 0) {
      // A state push that produced no new events — a visit closing with no darts, say. Nothing to
      // play, but the turn indicator may have moved.
      if (this.queue.isIdle) this.renderHud();
      return;
    }

    this.queue.enqueue(delta.events);
  }

  /** Snap: no animation, everything straight to the state replay() derived. */
  private redrawAll(): void {
    const update = this.latest;
    if (!update) return;

    this.layoutAndDrawHole(this.currentHole(update), update.state.holeIndex);
    this.refreshBalls();
    this.renderHud();
  }

  // -------------------------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------------------------

  private animate(event: GameEvent, pending: number): AbortableAnimation {
    switch (event.type) {
      case 'putt':
        // Holing out ends that side's hole, but the card is only banked here — announceScores puts
        // it up once nothing is animating. A pick-up at the cap arrives as its own event below.
        if (event.outcome === 'holed') {
          this.recordScore(event.teamId, event.holeIndex, event.strokeNumber, false);
        }
        // A card can still be up here: finishing a hole mid-visit starts the next one, and the player
        // putts on it with the darts they have left. This putt needs the board, so the card goes —
        // fading alongside the ball setting off rather than making it wait.
        this.showingScore?.dismiss();
        return this.animatePutt(event, pending);
      case 'pickedUp':
        this.recordScore(event.teamId, event.holeIndex, MAX_STROKES, true);
        return this.beat(0);
      case 'turnChanged':
        // Barrelo only closes a visit once the darts are out of the board, so this event is the cue
        // a held card has been waiting for.
        return this.dismissScore();
      case 'holeStart':
        return this.beat(BEAT_HOLE_START, () => {
          const update = this.latest;
          if (update) this.layoutAndDrawHole(update.state.course[event.holeIndex], event.holeIndex);
          this.refreshBalls();
        });
      case 'holeComplete':
        return this.beat(BEAT_HOLE_COMPLETE);
      case 'victory':
        return this.beat(BEAT_HOLE_COMPLETE, () => this.renderHud());
      // Spare darts have no motion of their own; the HUD render that follows the queue going idle is
      // the whole of their effect.
      default:
        return this.beat(0);
    }
  }

  /**
   * Banks the score card for a side that has just finished a hole. Built now rather than at display
   * time because the figures are settled the moment the hole is over, and by the time the card goes
   * up the board may already be on the next hole.
   */
  private recordScore(
    teamId: string,
    holeIndex: number,
    fallbackScore: number,
    pickedUp: boolean
  ): void {
    const update = this.latest;
    const hole = update?.state.course[holeIndex];
    if (!update || !hole) return;

    const { state } = update;
    const card = state.card[teamId] ?? [];
    // The card entry is the authority: a water penalty can push the raw stroke count past the cap,
    // and what the side is scored is the clamped figure.
    const score = card[holeIndex] ?? fallbackScore;
    const total = card.slice(0, holeIndex + 1).reduce((sum, value) => sum + value, 0);

    const team = this.teamById(teamId);

    this.pendingScores.push({
      name: teamLabel(team, update.playerNames),
      colour: colourForTeam(team),
      score,
      par: hole.par,
      holeNumber: holeIndex + 1,
      total,
      vsPar: total - parThrough(state.course, holeIndex + 1),
      pickedUp,
    });
  }

  /**
   * Puts up the cards banked since the last announcement, once the player has no darts left to
   * throw — a card raised mid-visit would cover the board while they are still putting.
   *
   * The final card of a live visit is shown with no timer at all: it comes down when the turnChanged
   * event arrives, which is Barrelo saying the darts have been pulled and End Turn pressed. Anything
   * that gets here with the visit already closed, and the last card of a finished match, have no End
   * Turn left to wait for and fall back to a timed hold.
   *
   * Runs outside the animation queue. Nothing else can happen during the wait — the next dart cannot
   * land until the visit ends — and keeping it out of the queue means a card that is waiting on a
   * human can never stall playback.
   */
  private async announceScores(): Promise<void> {
    if (this.announcing || this.pendingScores.length === 0) return;

    this.announcing = true;
    try {
      // The idle check is re-read every time round. A putt arriving takes the card down and wants the
      // board to itself, so anything still banked waits for the next lull rather than talking over it.
      while (this.pendingScores.length > 0 && this.queue.isIdle) {
        const result = this.pendingScores.shift()!;
        // Only the newest card waits on End Turn; any backlog behind it is just a beat each.
        const held = this.pendingScores.length === 0 && this.endTurnStillToCome();
        const showing = this.scorePopup.show(result, this.playfieldRect(), held ? null : HOLD_SCORE);
        this.showingScore = showing;
        await showing.done;
        if (this.showingScore === showing) this.showingScore = null;
      }
    } finally {
      this.announcing = false;
    }
  }

  /**
   * Whether a card put up right now still has an End Turn coming to take it down.
   *
   * An open visit always does: Barrelo closes a visit when the darts come out, and that is the only
   * thing that closes one. A visit that has already closed obviously doesn't, and neither does a
   * finished match — replay() stops emitting turnChanged once it is complete, so a card held for one
   * would sit on the board forever. Both of those fall back to a timed hold.
   */
  private endTurnStillToCome(): boolean {
    const state = this.latest?.state;
    if (!state) return false;
    return state.currentVisitThrows.length > 0 && !state.isComplete;
  }

  /** Fades out a held card, as the animation for the End Turn that released it. */
  private dismissScore(): AbortableAnimation {
    const showing = this.showingScore;
    if (!showing) return this.beat(0);
    showing.dismiss();
    return { done: showing.done, abort: () => showing.abort() };
  }

  /** Drops the card on screen and everything queued behind it. The resync and shutdown exit. */
  private abortScores(): void {
    this.pendingScores.length = 0;
    this.showingScore?.abort();
    this.showingScore = null;
    this.scorePopup.clear();
  }

  /** A fixed pause, used for everything that isn't a ball rolling. */
  private beat(duration: number, onStart?: () => void): AbortableAnimation {
    onStart?.();

    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = () => {
        timer?.remove(false);
        resolve();
      };
    });

    const timer = duration > 0 ? this.time.delayedCall(duration, () => settle()) : null;
    if (!timer) settle();

    return { done, abort: () => settle() };
  }

  private animatePutt(event: PuttEvent, pending: number): AbortableAnimation {
    const update = this.latest;
    const hole = update?.state.course[event.holeIndex];

    // A bull is very nearly no power at all. Stepping a motionless ball for four seconds would be a
    // dead screen, so it gets a short beat instead — the stroke still counted.
    if (!hole || event.vector.speed === 0) {
      return this.beat(BEAT_BULL, () => this.snapBall(event));
    }

    if (event.holeIndex !== this.drawnHoleIndex) {
      this.layoutAndDrawHole(hole, event.holeIndex);
      this.refreshBalls();
    }

    // The ball is about to leave the spot the marker is sitting on, and whose turn it is stops being
    // the question the moment the putt is struck.
    this.courseView.setTurnMarker(null);
    this.courseView.setAimGuide(null);

    // The live world. Same builder, same fixed step, same bodies as the headless run in rules.ts.
    const ctx = createSim(this.matter.world.engine, hole, event.from, event.vector);

    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = () => {
        if (this.activePutt?.ctx === ctx) this.activePutt = null;
        // The authoritative rest position is the one rules.ts derived; the live world agrees, but
        // this is what makes that a guarantee rather than a hope.
        this.snapBall(event);
        resolve();
      };
    });

    this.activePutt = {
      ctx,
      event,
      rate: pending > CATCHUP_THRESHOLD ? CATCHUP_RATE : NORMAL_RATE,
      settle,
    };

    return { done, abort: () => settle() };
  }

  private paintRollingBall(active: NonNullable<BoardScene['activePutt']>): void {
    if (!this.latest) return;

    this.courseView.setBall(
      active.event.teamId,
      { x: active.ctx.ball.position.x, y: active.ctx.ball.position.y },
      colourForTeam(this.teamById(active.event.teamId)),
      false,
      true
    );

    const blade = active.ctx.blades[0];
    if (blade) this.courseView.setBladeAngle(blade.body.angle);
  }

  private snapBall(event: PuttEvent): void {
    if (!this.latest) return;

    // A ball that dropped is out of play — showing it parked in the cup just stacks discs on top of
    // each other as the rest of the field finishes.
    const visible = event.outcome !== 'holed';
    this.courseView.setBall(
      event.teamId,
      event.to,
      colourForTeam(this.teamById(event.teamId)),
      false,
      visible
    );
  }

  /** Everything queued has played out, so the HUD can safely catch up with the derived state. */
  private onQueueIdle(): void {
    this.refreshBalls();
    this.renderHud();
    void this.announceScores();
  }

  // -------------------------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------------------------

  private currentHole(update: BoardUpdate): Hole | undefined {
    const { course, holeIndex } = update.state;
    return course[Math.min(holeIndex, course.length - 1)];
  }

  private layoutAndDrawHole(hole: Hole | undefined, holeIndex: number): void {
    if (!hole) return;
    this.courseView.setViewport(this.playfieldRect());
    this.courseView.drawHole(hole);
    this.drawnHoleIndex = holeIndex;
  }

  private refreshBalls(): void {
    const update = this.latest;
    if (!update) return;

    const { teams, ballPos, finished, currentTeamId } = update.state;

    for (const team of teams) {
      const at = ballPos[team.id];
      if (!at) continue;
      this.courseView.setBall(
        team.id,
        at,
        colourForTeam(team),
        team.id !== currentTeamId,
        !finished[team.id]
      );
    }

    this.courseView.removeBallsExcept(teams.map((team) => team.id));

    const upNext = currentTeamId && !finished[currentTeamId] ? ballPos[currentTeamId] : null;
    const colour = colourForTeam(this.teamById(currentTeamId));
    this.courseView.setTurnMarker(upNext ?? null, colour);
    // Same ball, same moment: the aim guide is only ever drawn around the one that is about to be
    // struck.
    this.courseView.setAimGuide(upNext ?? null, colour);
  }

  private teamById(teamId: string | null | undefined): Team | undefined {
    return this.latest?.state.teams.find((team) => team.id === teamId);
  }

  private renderHud(): void {
    const update = this.latest;
    if (!update) return;
    this.scorecard.render(
      update.state,
      update.playerNames,
      this.headerRect(),
      this.railRect()
    );
  }

  private handleResize(): void {
    if (!this.latest) return;
    // Course space is independent of pixels, so a resize mid-putt only changes the transform — the
    // simulation in flight is untouched.
    this.layoutAndDrawHole(this.currentHole(this.latest), this.latest.state.holeIndex);
    this.refreshBalls();
    this.renderHud();
    // A card waiting on End Turn can easily outlive a resize, so it has to be re-centred with the
    // playfield it is sitting over.
    this.scorePopup.reposition(this.playfieldRect());
  }

  private railWidth(): number {
    return Phaser.Math.Clamp(this.scale.width * 0.22, MIN_RAIL, MAX_RAIL);
  }

  private headerRect(): Rect {
    return { x: 0, y: 0, w: this.scale.width, h: HEADER_HEIGHT };
  }

  private railRect(): Rect {
    const w = this.railWidth();
    return { x: this.scale.width - w, y: HEADER_HEIGHT, w, h: this.scale.height - HEADER_HEIGHT };
  }

  private playfieldRect(): Rect {
    return {
      x: 0,
      y: HEADER_HEIGHT,
      w: Math.max(1, this.scale.width - this.railWidth()),
      h: Math.max(1, this.scale.height - HEADER_HEIGHT),
    };
  }
}
