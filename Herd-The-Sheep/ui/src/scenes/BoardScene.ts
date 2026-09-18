import Phaser from 'phaser';
import { GAME_STATE_EVENT, gameStateEvents, getLatestUpdate, type BoardUpdate } from '../bridge';
import { WORLD_H, WORLD_W } from '../paddock';
import type { GameEvent } from '../rules';
import { SCARE_R, createEngine, createSim, stepSim, type SimContext } from '../simulate';
import { diffEvents } from '../ui/eventTail';
import { PaddockView } from '../ui/PaddockView';
import { Scoreboard } from '../ui/Scoreboard';
import { colorOf } from '../ui/teams';

/**
 * The board.
 *
 * It does NOT tween the sheep along a recorded path. It re-runs the *same simulation* the rules ran,
 * on its own engine built by the same createEngine(), stepped one fixed step at a time — so what you
 * watch is real bodies shoving each other around, and it necessarily arrives where replay() said it
 * would. Each push event carries the flock as it stood before the dart plus that burst's seed, which
 * is everything the sim needs to reproduce it exactly.
 *
 * Note this deliberately does NOT use Phaser's Matter integration. Phaser's Matter runner smooths and
 * snaps frame deltas and takes its solver settings from the scene config, which is a second place for
 * the two sims to drift apart. Driving the same headless engine and drawing sprites from body
 * positions removes that whole class of problem: there is exactly one engine configuration in the
 * codebase, in simulate.ts.
 *
 * Playback is driven off the derived event stream rather than by diffing state, so an undo or a tab
 * opened mid-match snaps instead of replaying a match nobody is waiting for — see eventTail.ts.
 */
export class BoardScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Container;
  private view!: PaddockView;
  private scoreboard!: Scoreboard;

  private readonly engine = createEngine();
  private queue: GameEvent[] = [];
  private ctx: SimContext | null = null;
  private current: Extract<GameEvent, { type: 'push' }> | null = null;

  private lastEvents: GameEvent[] | null = null;
  private paddockKey = '';
  private pennedShown = 0;

  constructor() {
    super('board');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#243318');

    this.world = this.add.container(0, 0);
    this.view = new PaddockView(this, this.world);
    this.scoreboard = new Scoreboard(this);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    const onGameState = (update: BoardUpdate) => this.onState(update);
    gameStateEvents.on(GAME_STATE_EVENT, onGameState);

    // Barrelo pushes only when state changes, and the push on page load usually lands while Boot and
    // Preloader are still running — so catch up on whatever arrived before this scene existed.
    const missed = getLatestUpdate();
    if (missed) this.onState(missed);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameStateEvents.off(GAME_STATE_EVENT, onGameState);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.scoreboard.destroy();
    });
  }

  /** Fits the 1600x900 field into whatever the host gave us, letterboxing rather than stretching. */
  private layout(): void {
    const { width, height } = this.scale;
    const scale = Math.min(width / WORLD_W, height / WORLD_H);
    this.world.setScale(scale);
    this.world.setPosition((width - WORLD_W * scale) / 2, (height - WORLD_H * scale) / 2);
    const latest = getLatestUpdate();
    if (latest) this.scoreboard.render(latest.state, latest.playerNames);
  }

  private onState(update: BoardUpdate): void {
    const { state, playerNames } = update;

    // The paddock is a function of the seed and the flock size, so it only ever changes when the
    // match does — but a harness that resets mid-session does exactly that.
    const key = JSON.stringify([state.flockSize, state.paddock.obstacles]);
    if (key !== this.paddockKey) {
      this.paddockKey = key;
      this.view.buildStatic(state.paddock);
      this.lastEvents = null;
    }

    const delta = diffEvents(this.lastEvents, state.events);
    this.lastEvents = state.events;

    if (delta.kind === 'resync') {
      this.abort();
      this.pennedShown = this.totalPenned(state);
      this.view.setFlock(state.flock);
      this.view.setPenned(this.pennedShown);
      this.view.startGrazing();
    } else {
      this.queue.push(...delta.events);
    }

    this.scoreboard.render(state, playerNames);
  }

  private totalPenned(state: BoardUpdate['state']): number {
    return Object.values(state.pennedBy).reduce((sum, n) => sum + n, 0);
  }

  private abort(): void {
    this.queue = [];
    this.ctx = null;
    this.current = null;
    this.view.stopGrazing();
    this.view.clearEffects();
  }

  update(): void {
    if (!this.ctx) this.startNext();
    if (!this.ctx) return;

    // Catching up is done by taking MORE fixed steps per frame, never a bigger step. A variable
    // timestep would rescale Matter's integrator and the board would stop agreeing with the rules.
    const stepsThisFrame = this.queue.length > 0 ? 3 : 1;
    for (let i = 0; i < stepsThisFrame; i++) {
      if (!stepSim(this.ctx)) {
        this.finish();
        return;
      }
    }

    this.view.setFromBodies(
      this.ctx.sheep.map((s) => ({
        id: s.id,
        position: { x: s.body.position.x, y: s.body.position.y },
        velocity: { x: s.body.velocity.x, y: s.body.velocity.y },
      }))
    );
  }

  private startNext(): void {
    const latest = getLatestUpdate();
    if (!latest) return;

    while (this.queue.length > 0) {
      const event = this.queue.shift()!;

      if (event.type === 'suddenDeath') {
        this.view.setFlock([{ id: event.sheepId, at: event.at }]);
        this.view.startGrazing();
        continue;
      }
      if (event.type !== 'push') continue;

      this.view.stopGrazing();
      this.view.setFlock(event.before);

      const team = latest.state.teams.find((t) => t.id === event.teamId);
      const color = team ? colorOf(team) : 0xe9e4d6;

      if (event.scare.kind === 'scare') this.view.showScare(event.scare.at, SCARE_R, color);
      else if (event.scare.kind === 'whistle') this.view.showWhistle(event.scare.at, color);
      else this.view.showMiss();

      this.current = event;
      this.ctx = createSim(
        this.engine,
        latest.state.paddock,
        event.before,
        event.scare,
        event.seed
      );
      return;
    }
  }

  private finish(): void {
    const event = this.current;
    this.ctx = null;
    this.current = null;
    if (!event) return;

    // Snap to the rules' own answer rather than trusting the live bodies. They should be identical;
    // if they ever are not, the authoritative number is the one that was scored from.
    this.view.setFlock(event.after);
    this.pennedShown += event.penned.length;
    this.view.setPenned(this.pennedShown);

    if (this.queue.length === 0) this.view.startGrazing();
  }
}
