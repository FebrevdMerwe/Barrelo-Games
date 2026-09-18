import Phaser from 'phaser';
import { AnimationQueue, type AbortableAnimation } from '../ui/AnimationQueue';
import { diffEvents } from '../ui/eventTail';
import { DARTS_PER_TURN, STARTING_LIVES, type GameEvent } from '../rules';
import { PlayerCard, CARD_WIDTH, CARD_HEIGHT } from '../ui/PlayerCard';
import { DartboardView, type NumberOwnership } from '../ui/DartboardView';
import { Banner } from '../ui/Banner';
import { ThrowEffects } from '../ui/ThrowEffects';
import { SequenceEffects } from '../ui/SequenceEffects';
import { AmbientEffects } from '../ui/AmbientEffects';
import { GAME_STATE_EVENT, gameStateEvents, getLatestUpdate, type BoardUpdate } from '../bridge';

const PANEL_MARGIN = 16;
const PANEL_WIDTH = CARD_WIDTH; // horizontal space reserved per side so the board never overlaps a card
const BLOCK_SPACING = 22;
const DEFAULT_COLOR = '#e8dcc0';
const DART_ICON_SIZE = 28;
const DART_ICON_GAP = 10;

/**
 * Purely a renderer: Barrelo owns input (manual-entry dartboard or a real detector) and pushes the
 * visit log down, `bridge.ts` replays it through `rules.ts`, and this scene draws the derived state.
 * It never resolves clicks or applies rules itself.
 *
 * Every game object here is created once and updated in place (position/text/frame/visibility) —
 * never destroyed and rebuilt on an update — so tweens can safely animate any of them across pushes.
 */
export class BoardScene extends Phaser.Scene {
  private bgWall!: Phaser.GameObjects.Image;
  private bgVignette!: Phaser.GameObjects.Image;
  private bgLightSpot!: Phaser.GameObjects.Image;
  private bgNoise!: Phaser.GameObjects.Image;
  private dartboardShadow!: Phaser.GameObjects.Image;
  private dartboardCabinet!: Phaser.GameObjects.Image;
  private dartboardHighlight!: Phaser.GameObjects.Image;
  private dartboardView!: DartboardView;
  private panelLayer!: Phaser.GameObjects.Container;
  private playerCards = new Map<string, PlayerCard>();
  private leftIds: string[] = [];
  private rightIds: string[] = [];
  private turnText!: Phaser.GameObjects.Text;
  private banner!: Banner;
  private throwEffects!: ThrowEffects;
  private sequenceEffects!: SequenceEffects;
  private ambientEffects!: AmbientEffects;
  private dartIcons: Phaser.GameObjects.Image[] = [];
  private latest: BoardUpdate | null = null;
  private prevEvents: GameEvent[] | null = null;
  private animationQueue = new AnimationQueue((event) => this.handleEvent(event));

  constructor() {
    super('board');
  }

  create() {
    this.buildBackgroundLayers();
    this.ambientEffects = new AmbientEffects(this, this.bgLightSpot);
    this.buildDartboardMount();

    this.dartboardView = new DartboardView(this);

    this.buildDartboardSheen();
    this.ambientEffects.attachBoardGlowBreathing(this.dartboardHighlight);

    this.panelLayer = this.add.container();

    this.buildDartIcons();

    this.turnText = this.add
      .text(0, 10, '', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '20px',
        color: DEFAULT_COLOR,
      })
      .setOrigin(0.5, 0);

    this.banner = new Banner(this);
    this.throwEffects = new ThrowEffects(this, () => this.dartboardView.shake());
    this.sequenceEffects = new SequenceEffects(this, this.banner);

    const onResize = () => this.layout();
    const onUpdate = (update: BoardUpdate) => this.handleUpdate(update);
    this.scale.on('resize', onResize);
    gameStateEvents.on(GAME_STATE_EVENT, onUpdate);

    // Barrelo pushes only when state changes, and the push on page load usually lands while Boot and
    // Preloader are still running — so catch up on whatever arrived before this scene existed.
    const missed = getLatestUpdate();
    if (missed) this.handleUpdate(missed);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameStateEvents.off(GAME_STATE_EVENT, onUpdate);
      this.scale.off('resize', onResize);
    });

    this.layout();
    this.drawStatus();
  }

  private handleUpdate(update: BoardUpdate) {
    const delta = diffEvents(this.prevEvents, update.state.events);
    if (delta.kind === 'resync') {
      this.animationQueue.cancelAll();
    } else if (delta.events.length > 0) {
      this.animationQueue.enqueue(delta.events);
    }
    this.prevEvents = update.state.events;
    this.latest = update;

    // Content updates only — every persistent object (labels, markers, panels) is updated in
    // place here, never destroyed/recreated. The animations queued above deliberately play over
    // state that has already been snapped forward.
    this.ensurePlayerPanels();
    this.updatePlayerPanels();
    this.updateBoardOwnership();
    this.dartboardView.updateMarkers(update.state.currentVisitThrows);
    this.updateDartIcons();
    this.drawStatus();
  }

  private handleEvent(event: GameEvent): AbortableAnimation {
    if (event.type === 'turnChanged') {
      const name = this.latest?.playerNames[event.playerId] ?? 'Player';
      const promise = this.banner.show('turn', `${name.toUpperCase()}'S TURN`);
      return { done: promise, abort: () => this.banner.skip() };
    }
    if (event.type === 'throw') {
      // The thrower is now derived by replay() rather than guessed from the previous snapshot's
      // currentPlayerId, so the dart always flies from the right card.
      const throwerCard = this.playerCards.get(event.throwerId);
      const { centerX, centerY } = this.geometry();
      const origin = throwerCard ? throwerCard.getCenter() : { x: centerX, y: centerY };
      const impact = this.dartboardView.toScreenPosition(event.throw.position);
      return this.throwEffects.play({
        segment: event.throw.segment,
        ring: event.throw.ring,
        originX: origin.x,
        originY: origin.y,
        impactX: impact.x,
        impactY: impact.y,
      });
    }
    if (event.type === 'becameKiller') {
      const card = this.playerCards.get(event.playerId);
      if (card) return { done: card.playBecameKillerBurst(), abort: () => card.abortAnimation() };
    }
    if (event.type === 'lifeLost') {
      const card = this.playerCards.get(event.playerId);
      if (card) return { done: card.playLifeLost(event.livesRemaining), abort: () => card.abortAnimation() };
    }
    if (event.type === 'eliminated') {
      const card = this.playerCards.get(event.playerId);
      const name = this.latest?.playerNames[event.playerId] ?? 'Player';
      const { centerX, centerY } = this.geometry();
      const cardCenter = card ? card.getCenter() : { x: centerX, y: centerY };
      const cardDone = card ? card.playEliminated() : Promise.resolve();
      const bannerDone = this.sequenceEffects.playElimination(name, cardCenter);
      const done = Promise.all([cardDone, bannerDone]).then(() => {});
      return {
        done,
        abort: () => {
          card?.abortAnimation();
          this.sequenceEffects.skip();
        },
      };
    }
    if (event.type === 'victory') {
      const winnerId = event.winnerPlayerIds[0];
      const name = (winnerId && this.latest?.playerNames[winnerId]) ?? 'Player';
      const done = this.sequenceEffects.playVictory(name);
      return { done, abort: () => this.sequenceEffects.skip() };
    }
    console.debug('[animation-queue] unhandled (stub)', event);
    return { done: Promise.resolve(), abort: () => {} };
  }

  private geometry() {
    const width = this.scale.width;
    const height = this.scale.height;
    const centerX = width / 2;
    const centerY = height / 2 + 24;
    const radius = Math.max(60, Math.min(width - PANEL_WIDTH * 2, height - 48) * 0.42);
    return { centerX, centerY, radius };
  }

  /** Recomputes everything that depends on window size — never rebuilds a game object, only repositions/redraws in place. */
  private layout() {
    const { centerX, centerY, radius } = this.geometry();
    this.turnText.setPosition(centerX, 10);
    this.banner.setPosition(centerX, 90);
    this.sequenceEffects.layout(this.scale.width, this.scale.height);
    this.ambientEffects.layout(this.scale.width, this.scale.height);

    this.layoutBackgroundLayers();
    this.dartboardView.layout(centerX, centerY, radius);
    this.layoutDartboardMount();
    this.layoutPlayerPanels();
    this.layoutDartIcons(centerX, centerY, radius);
    if (this.latest) {
      this.dartboardView.updateMarkers(this.latest.state.currentVisitThrows);
    } else {
      this.dartboardView.hideMarkers();
    }
  }

  private buildBackgroundLayers() {
    this.bgWall = this.add.image(0, 0, 'bg_wall').setOrigin(0, 0);
    this.bgVignette = this.add.image(0, 0, 'bg_vignette').setOrigin(0, 0);
    this.bgLightSpot = this.add.image(0, 0, 'bg_light_spot').setOrigin(0, 0).setAlpha(0.6);
    this.bgNoise = this.add.image(0, 0, 'bg_noise').setOrigin(0, 0).setAlpha(0.05);
  }

  private layoutBackgroundLayers() {
    const width = this.scale.width;
    const height = this.scale.height;
    for (const img of [this.bgWall, this.bgVignette, this.bgLightSpot, this.bgNoise]) {
      img.setPosition(0, 0).setDisplaySize(width, height);
    }
  }

  private buildDartboardMount() {
    this.dartboardShadow = this.add.image(0, 0, 'dartboard_shadow');
    this.dartboardCabinet = this.add.image(0, 0, 'dartboard_cabinet');
  }

  private buildDartboardSheen() {
    this.dartboardHighlight = this.add.image(0, 0, 'dartboard_highlight').setAlpha(0.35);
  }

  private layoutDartboardMount() {
    const { centerX, centerY, radius } = this.geometry();
    const cabinetSize = radius * 2.3;
    const shadowSize = radius * 2.45;
    const highlightSize = radius * 2.05;

    this.dartboardShadow.setPosition(centerX, centerY + 10).setDisplaySize(shadowSize, shadowSize);
    this.dartboardCabinet.setPosition(centerX, centerY).setDisplaySize(cabinetSize, cabinetSize);
    this.dartboardHighlight.setPosition(centerX, centerY).setDisplaySize(highlightSize, highlightSize);
  }

  private buildDartIcons() {
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      const icon = this.add.image(0, 0, 'dart_full').setDisplaySize(DART_ICON_SIZE, DART_ICON_SIZE);
      this.dartIcons.push(icon);
    }
  }

  private layoutDartIcons(centerX: number, centerY: number, radius: number) {
    const totalWidth = DARTS_PER_TURN * DART_ICON_SIZE + (DARTS_PER_TURN - 1) * DART_ICON_GAP;
    const startX = centerX - totalWidth / 2 + DART_ICON_SIZE / 2;
    // The cabinet mount extends to radius * 1.15 (see layoutDartboardMount's cabinetSize), so the
    // icon row needs to clear that, not just the bare wedge-mesh radius.
    const y = centerY + radius * 1.15 + 26;
    this.dartIcons.forEach((icon, i) => icon.setPosition(startX + i * (DART_ICON_SIZE + DART_ICON_GAP), y));
  }

  private updateDartIcons() {
    const thrown = this.latest?.state.currentVisitThrows.length ?? 0;
    this.dartIcons.forEach((icon, i) => icon.setTexture(i < thrown ? 'dart_empty' : 'dart_full'));
  }

  private updateBoardOwnership() {
    if (!this.latest) return;
    const { state, payload } = this.latest;
    const ownership = new Map<number, NumberOwnership>();
    payload.playerIds.forEach((id, colourIndex) => {
      const number = state.numbers[id];
      if (number === undefined) return; // over-full roster: unassignable, drawn as unowned
      ownership.set(number, {
        colourIndex,
        lives: state.lives[id],
        isKiller: state.isKiller[id],
        isCurrentPlayer: state.currentPlayerId === id,
      });
    });
    this.dartboardView.updateOwnership(ownership);
  }

  private ensurePlayerPanels() {
    if (this.playerCards.size > 0 || !this.latest) return; // roster is fixed for the match, build once
    const ids = this.latest.payload.playerIds;
    if (ids.length === 0) return;

    ids.forEach((id, i) => {
      const side: 'left' | 'right' = i % 2 === 0 ? 'left' : 'right';
      (side === 'left' ? this.leftIds : this.rightIds).push(id);
      const card = new PlayerCard(this, i, STARTING_LIVES);
      this.panelLayer.add(card.container);
      this.playerCards.set(id, card);
    });
  }

  private updatePlayerPanels() {
    if (!this.latest) return;
    const { state, playerNames } = this.latest;

    for (const [id, card] of this.playerCards) {
      card.setName(playerNames[id] || 'Player', state.numbers[id]);
      card.setActive(state.currentPlayerId === id);
      card.setKiller(state.isKiller[id]);
      card.setLives(state.lives[id]);
    }

    this.layoutPlayerPanels();
  }

  private layoutPlayerPanels() {
    const { centerY } = this.geometry();
    const width = this.scale.width;

    this.layoutSide(this.leftIds, PANEL_MARGIN, centerY);
    this.layoutSide(this.rightIds, width - PANEL_MARGIN - CARD_WIDTH, centerY);
  }

  private layoutSide(ids: string[], x: number, centerY: number) {
    const cards = ids.map((id) => this.playerCards.get(id)).filter((c): c is PlayerCard => !!c);
    const totalHeight = cards.length * CARD_HEIGHT + BLOCK_SPACING * Math.max(0, cards.length - 1);
    let y = centerY - totalHeight / 2;

    for (const card of cards) {
      card.setPosition(x, y);
      y += CARD_HEIGHT + BLOCK_SPACING;
    }
  }

  private drawStatus() {
    if (!this.latest) {
      this.turnText.setText('Waiting for match...');
      return;
    }

    const { state, playerNames } = this.latest;
    const nameOf = (id: string) => playerNames[id] || 'Player';

    // Barrelo has no /create hook to reject an unplayable roster at, so the board is where the
    // operator finds out.
    if (state.configError) {
      this.turnText.setText(state.configError);
      return;
    }

    if (state.isComplete) {
      const winnerId = state.winnerPlayerIds[0];
      this.turnText.setText(winnerId ? `${nameOf(winnerId)} wins!` : 'Game complete');
    } else {
      const current = state.currentPlayerId;
      this.turnText.setText(
        current
          ? `${nameOf(current)}'s turn — dart ${state.currentVisitThrows.length + 1} of ${DARTS_PER_TURN}`
          : ''
      );
    }
  }
}
