import Phaser from 'phaser';
import { GAME_STATE_EVENT, gameStateEvents, getLatestUpdate, type BoardUpdate } from '../bridge';
import { territoryName } from '../board.ts';
import type { GameEvent, GameState, Team } from '../rules.ts';
import { AnimationQueue, type AbortableAnimation } from '../ui/AnimationQueue.ts';
import { diffEvents } from '../ui/eventTail.ts';
import { Hud } from '../ui/Hud.ts';
import { TeamRail } from '../ui/TeamRail.ts';
import { TerritoryMap } from '../ui/TerritoryMap.ts';
import { colourForIndex, GOLD, MUTED, teamLabel } from '../ui/teams.ts';
import { TEXTURE_KEYS } from '../ui/textures.ts';

/**
 * The board.
 *
 * Rendering is driven by the derived *event stream* rather than by diffing state: diffEvents decides
 * whether what just arrived extends what is already on screen (animate the tail) or not (an undo, a
 * refresh, a TV switched on mid-match — snap, and animate nothing).
 *
 * The map is deliberately not repainted from the derived state while anything is animating. The
 * state that arrives is the state *after* all three darts, so painting it immediately would flip a
 * wedge to its final owner while the capture that took it is still playing. Events carry everything
 * needed to mutate the map a step at a time; the full repaint happens when the queue drains, which
 * also makes any drift self-correcting.
 */

const BACKDROP = 0x0b1017;

const PAD = 16;

export class BoardScene extends Phaser.Scene {
  private backdrop!: Phaser.GameObjects.Graphics;
  private vignette!: Phaser.GameObjects.Image;
  private grain!: Phaser.GameObjects.TileSprite;

  private map!: TerritoryMap;
  private rail!: TeamRail;
  private hud!: Hud;
  private queue!: AnimationQueue;

  private latest: BoardUpdate | null = null;
  private playedEvents: GameEvent[] | null = null;
  private victoryShown = false;

  constructor() {
    super('board');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKDROP);

    this.backdrop = this.add.graphics();
    // A cool pool of light under the map, so the ring sits on something rather than floating on a
    // flat fill. Additive would blow out the wedge colours, so it is a plain tinted glow underneath.
    this.vignette = this.add.image(0, 0, TEXTURE_KEYS.glow).setTint(0x1d3350).setAlpha(0.5);
    this.grain = this.add.tileSprite(0, 0, 10, 10, TEXTURE_KEYS.grain).setOrigin(0, 0).setAlpha(0.4);

    this.map = new TerritoryMap(this);
    this.rail = new TeamRail(this);
    this.hud = new Hud(this);

    // The HUD is held back until nothing is moving: the rail and the turn chip would otherwise
    // announce the new owner, or the next thrower, while the capture responsible is still playing.
    // Only the queue can tell when that is — an animation's own resolve runs while drain() is still
    // awaiting it, so it can never observe itself as idle.
    this.queue = new AnimationQueue(
      (event, pending) => this.animate(event, pending),
      () => this.paint()
    );

    this.handleResize();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    const onGameState = (update: BoardUpdate) => this.receive(update);
    gameStateEvents.on(GAME_STATE_EVENT, onGameState);

    // Barrelo pushes only when state changes, and the push on page load usually lands while Boot and
    // Preloader are still running — so catch up on whatever arrived before this scene existed.
    const missed = getLatestUpdate();
    if (missed) this.receive(missed);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameStateEvents.off(GAME_STATE_EVENT, onGameState);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.queue.cancelAll();
      this.map.destroy();
      this.rail.destroy();
      this.hud.destroy();
    });
  }

  update(time: number): void {
    this.map.tick(time);
  }

  private handleResize(): void {
    const { width, height } = this.scale;
    const headerHeight = Phaser.Math.Clamp(Math.round(height * 0.09), 46, 68);
    const footerHeight = Phaser.Math.Clamp(Math.round(height * 0.11), 58, 96);
    const railWidth = Phaser.Math.Clamp(Math.round(width * 0.23), 190, 300);

    const boardWidth = width - railWidth - PAD * 3;
    const boardHeight = height - headerHeight - footerHeight - PAD * 2;
    const radius = Math.max(40, Math.min(boardWidth, boardHeight) / 2 - 18);

    this.backdrop.clear();
    this.backdrop.fillStyle(BACKDROP, 1);
    this.backdrop.fillRect(0, 0, width, height);

    const centreX = PAD + boardWidth / 2;
    const centreY = headerHeight + PAD + boardHeight / 2;

    this.vignette
      .setPosition(centreX, centreY)
      .setDisplaySize(radius * 4.2, radius * 4.2);
    this.grain.setSize(width, height);

    this.map.layout(centreX, centreY, radius);
    this.rail.layout(
      width - railWidth - PAD,
      headerHeight + PAD,
      railWidth,
      height - headerHeight - footerHeight - PAD * 2
    );
    this.hud.layout(width, height, headerHeight, height - footerHeight / 2, {
      x: PAD,
      y: headerHeight + PAD,
      width: boardWidth,
      height: boardHeight,
    });

    this.paint();
  }

  private labelOf = (team: Team): string => teamLabel(team, this.latest?.playerNames ?? {});

  private teamById(state: GameState, teamId: string): Team | undefined {
    return state.teams.find((team) => team.id === teamId);
  }

  private colourOf(state: GameState, teamId: string | null): number {
    if (teamId === null) return MUTED;
    const team = this.teamById(state, teamId);
    return team ? colourForIndex(team.index) : MUTED;
  }

  private nameOf(state: GameState, teamId: string): string {
    const team = this.teamById(state, teamId);
    return team ? this.labelOf(team) : 'Someone';
  }

  private receive(update: BoardUpdate): void {
    this.latest = update;
    const { state } = update;

    if (state.configError !== null) {
      this.queue.cancelAll();
      this.map.abortEffects();
      this.hud.clearBanner();
      this.hud.showConfigError(state.configError);
      this.playedEvents = state.events;
      return;
    }

    const delta = diffEvents(this.playedEvents, state.events);
    this.playedEvents = state.events;

    if (delta.kind === 'resync') {
      this.queue.cancelAll();
      this.map.abortEffects();
      this.hud.clearBanner();
      // A resync is a board catching up, not a moment being watched — the victory card belongs on
      // screen immediately rather than after an animation nobody saw the build-up to.
      this.victoryShown = false;
      this.paint();
      return;
    }

    if (delta.events.length === 0) this.paint();
    else this.queue.enqueue(delta.events);
  }

  /** Snaps everything to the derived state. Safe to call at any idle moment. */
  private paint(): void {
    const update = this.latest;
    if (!update) return;
    const { state, playerNames } = update;

    this.map.render(state);
    this.rail.render(state, playerNames, this.labelOf);
    this.hud.render(state, playerNames, this.labelOf);

    if (state.isComplete && state.winnerTeamId !== null) {
      if (!this.victoryShown) {
        this.victoryShown = true;
        this.hud.showVictory(
          `${this.nameOf(state, state.winnerTeamId)} wins`,
          `Last side standing — ${state.territoryCount[state.winnerTeamId] ?? 0} of 21 territories`,
          this.colourOf(state, state.winnerTeamId)
        );
      }
    } else {
      this.victoryShown = false;
      this.hud.hideVictory();
    }
  }

  /**
   * Turns one derived event into something to look at, and reports how long it takes so the queue
   * can hold the next one back. Playback speeds up as darts stack up behind it.
   */
  private animate(event: GameEvent, pending: number): AbortableAnimation {
    const state = this.latest?.state;
    if (!state) return this.beat(0);

    const speed = pending >= 4 ? 2.4 : pending >= 2 ? 1.6 : 1;

    switch (event.type) {
      // The dart itself is silent — what it *did* is the next event, and announcing both would
      // double every beat for no extra information.
      case 'throw':
        return this.beat(0);

      case 'claimed': {
        const colour = this.colourOf(state, event.teamId);
        const duration = this.map.claim(event.territoryId, colour, speed);
        this.hud.announce(
          `${this.nameOf(state, event.teamId)} claims ${territoryName(event.territoryId)}`,
          'Neutral ground taken',
          colour,
          duration
        );
        return this.beat(duration);
      }

      case 'reinforced': {
        const colour = this.colourOf(state, event.teamId);
        const duration = this.map.reinforce(event.territoryId, event.from, event.to, speed);
        this.hud.announce(
          `${territoryName(event.territoryId)} reinforced`,
          `Shield ${event.from} → ${event.to}`,
          colour,
          duration
        );
        return this.beat(duration);
      }

      case 'shieldsBroken': {
        const colour = this.colourOf(state, event.attackerTeamId);
        const duration = this.map.breakShields(event.territoryId, event.from, event.to, speed);
        this.hud.announce(
          `${this.nameOf(state, event.attackerTeamId)} hits ${territoryName(event.territoryId)}`,
          event.to === 0
            ? `Shield ${event.from} → 0 — the next hit clears it`
            : `Shield ${event.from} → ${event.to}`,
          colour,
          duration
        );
        return this.beat(duration);
      }

      // The wedge changes hands in two beats, because it changes hands in two rungs: this one takes
      // it off its owner and leaves it neutral, and the `claimed` that may follow plants the
      // attacker's colour on it.
      case 'neutralised': {
        const colour = this.colourOf(state, event.attackerTeamId);
        const duration = this.map.neutralise(event.territoryId, colour, event.wasHome, speed);
        const attacker = this.nameOf(state, event.attackerTeamId);
        const defender = this.nameOf(state, event.defenderTeamId);
        this.hud.announce(
          event.wasHome
            ? `${attacker} clears ${defender}’s HOME`
            : `${attacker} clears ${territoryName(event.territoryId)}`,
          `Neutral ground — ${defender} lose it, nobody holds it`,
          colour,
          duration
        );
        return this.beat(duration);
      }

      case 'noEffect': {
        if (event.territoryId === null) {
          const duration = 420 / speed;
          this.hud.announce('Miss', 'No territory hit', MUTED, duration);
          return this.beat(duration);
        }
        const duration = this.map.nudge(event.territoryId, speed);
        const sub =
          event.reason === 'maxShield'
            ? 'Already at full shields'
            : `Not next to anything ${this.nameOf(state, state.currentTeamId ?? '')} holds`;
        this.hud.announce(`${territoryName(event.territoryId)} — no effect`, sub, MUTED, duration);
        return this.beat(duration);
      }

      case 'eliminated': {
        const duration = 1100 / speed;
        this.hud.announce(
          `${this.nameOf(state, event.teamId)} eliminated`,
          'No territories left',
          this.colourOf(state, event.teamId),
          duration
        );
        return this.beat(duration);
      }

      case 'turnChanged': {
        // The rail and the turn chip repaint when the queue drains a moment later; this is just the
        // pause that stops one side's darts running straight into the next side's.
        return this.beat(260 / speed);
      }

      case 'victory': {
        const colour = this.colourOf(state, event.teamId);
        const duration = this.map.victoryFlare(state, colour, speed);
        this.hud.announce(`${this.nameOf(state, event.teamId)} wins`, 'Last side standing', GOLD, duration);
        return this.beat(duration);
      }
    }
  }

  /**
   * An AbortableAnimation that is purely a wait. The visuals are already running as tweens on the
   * map and the HUD; this only holds the queue open for as long as they need, and abort() stops
   * them — the caller always repaints from the derived state straight afterwards.
   */
  private beat(duration: number): AbortableAnimation {
    if (duration <= 0) return { done: Promise.resolve(), abort: () => {} };

    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const timer = this.time.delayedCall(duration, () => settle());

    return {
      done,
      abort: () => {
        timer.remove(false);
        this.map.abortEffects();
        this.hud.clearBanner();
        settle();
      },
    };
  }
}
