import Phaser from "phaser";
import { GAME_STATE_EVENT, gameStateEvents, getLatestUpdate, type BoardUpdate } from "../bridge";
import { playSfx, unlockAudio, type SfxName } from "../sfx";
import {
  DARTS_PER_TURN,
  TRACK_LENGTH,
  ZOMBIE_TYPES,
  formatDuration,
  zombieRequirement,
  type GameState,
  type Zombie,
  type ZombieTypeName,
} from "../rules";

/**
 * The TV. Draws the state `replay()` derived — never the raw payload, because Barrelo's snapshot
 * deliberately doesn't say whose turn it is or what the horde looks like; those are rules this game owns.
 *
 * The layout is the approach track from §8 read left to right: zombies spawn at space 6 on the far left
 * and the safehouse sits on the right, so "closer to the safehouse" is literally "further right". That
 * matters more than it sounds — damage lands on the closest matching zombie automatically (§6), so
 * players have to be able to see at a glance which zombie their number is going to hit.
 *
 * Everything is vector: rounded-rect cards, a drawn safehouse, drawn health pips. Nothing here depends
 * on an emoji font rendering the same way on the machine driving the TV as it did on a laptop.
 */

const HEADER_H = 78;
const FOOTER_H = 132;
const LANE_GAP = 10;
const CARD_MIN_H = 38;
const CARD_MAX_H = 108;
const CARD_MAX_W = 200;
const SLOT_W = 148;
const SLOT_H = 62;
const SLOT_GAP = 10;

const INK = "#e9e4d6";
const DIM = "#9a917f";
const ALERT = "#ff5a4a";
const SUCCESS = "#8fd67f";

const TITLE_FONT = "Impact, 'Arial Black', 'Segoe UI', sans-serif";
const UI_FONT = "'Consolas', 'SF Mono', monospace";

interface TypeStyle {
  fill: number;
  border: number;
}

/** One palette entry per type in §7, so a Tank reads as a Tank across the room. */
const TYPE_STYLES: Record<ZombieTypeName, TypeStyle> = {
  Walker: { fill: 0x2c3d31, border: 0x6fae6a },
  Runner: { fill: 0x453718, border: 0xd9b23d },
  Tank: { fill: 0x47201f, border: 0xc0546e },
  Swarm: { fill: 0x243a44, border: 0x4fa3c4 },
  Armoured: { fill: 0x2f3541, border: 0x9aa7bd },
  Mutant: { fill: 0x38264a, border: 0xa88bc4 },
  Boss: { fill: 0x4d1119, border: 0xff5555 },
};

interface Geometry {
  width: number;
  height: number;
  trackTop: number;
  trackBottom: number;
  lanesLeft: number;
  laneWidth: number;
  safehouseX: number;
}

interface ZombieCard {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  alert: Phaser.GameObjects.Graphics;
  alertTween: Phaser.Tweens.Tween | null;
  title: Phaser.GameObjects.Text;
  requirement: Phaser.GameObjects.Text;
  pips: Phaser.GameObjects.Graphics;
  health: number;
  /**
   * Where this card is heading, which is not the same as where it is: a card is usually mid-tween. Held
   * so a redraw can tell "the layout moved" from "the layout is unchanged and a tween is still playing"
   * — without it, a resize during the spawn tween leaves the card stranded at the old geometry, because
   * the running tween writes the stale position back over the new one every frame.
   */
  targetX: number;
  targetY: number;
  moveTween: Phaser.Tweens.Tween | null;
  /**
   * Kept separate from moveTween on purpose. Retargeting a move has to stop whatever tween is in
   * flight, and a single tween doing both would take the fade down with it — leaving a card that is
   * in the right place and permanently invisible, because nothing else ever writes alpha.
   */
  fadeTween: Phaser.Tweens.Tween | null;
  width: number;
  height: number;
}

/** The slice of state a redraw compares against, to decide which sounds to fire. */
interface SoundMarker {
  darts: number;
  safehouseHp: number;
  wave: number;
  isComplete: boolean;
  victory: boolean;
}

export class BoardScene extends Phaser.Scene {
  private geo!: Geometry;
  private latest: BoardUpdate | null = null;
  private marker: SoundMarker | null = null;
  private cards = new Map<string, ZombieCard>();

  private backdrop!: Phaser.GameObjects.Image;
  private chrome!: Phaser.GameObjects.Graphics;
  private safehouse!: Phaser.GameObjects.Graphics;

  private waveText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private lullText!: Phaser.GameObjects.Text;
  private playerText!: Phaser.GameObjects.Text;
  private turnText!: Phaser.GameObjects.Text;
  private dartTexts: Phaser.GameObjects.Text[] = [];
  private dartDetails: Phaser.GameObjects.Text[] = [];
  private eventText!: Phaser.GameObjects.Text;
  private laneLabels: Phaser.GameObjects.Text[] = [];

  private gameOver: Phaser.GameObjects.Container | null = null;

  constructor() {
    super("board");
  }

  create(): void {
    unlockAudio();

    this.backdrop = this.add.image(0, 0, "board-bg").setAlpha(0.18).setOrigin(0.5);
    this.chrome = this.add.graphics();
    this.safehouse = this.add.graphics();

    this.waveText = this.text(TITLE_FONT, 40, INK).setOrigin(0, 0.5);
    this.roundText = this.text(UI_FONT, 13, DIM).setOrigin(0.5, 0.5);
    this.scoreText = this.text(TITLE_FONT, 32, INK).setOrigin(1, 0.5);
    this.killsText = this.text(UI_FONT, 13, DIM).setOrigin(1, 0.5);

    this.bannerText = this.text(TITLE_FONT, 22, ALERT).setOrigin(0.5, 0.5).setVisible(false);
    this.lullText = this.text(TITLE_FONT, 30, DIM).setOrigin(0.5, 0.5).setVisible(false);

    this.playerText = this.text(TITLE_FONT, 34, INK).setOrigin(0, 0.5);
    this.turnText = this.text(UI_FONT, 14, DIM).setOrigin(0, 0.5);
    this.eventText = this.text(UI_FONT, 14, DIM).setOrigin(1, 0.5).setAlign("right");

    for (let i = 0; i < DARTS_PER_TURN; i++) {
      // Two objects a slot, so the dart reads from across the room and the outcome sits under it in
      // small type rather than competing with it.
      this.dartTexts.push(this.text(TITLE_FONT, 24, DIM).setOrigin(0.5, 0.5));
      this.dartDetails.push(this.text(UI_FONT, 12, DIM).setOrigin(0.5, 0.5));
    }
    for (let i = 0; i < TRACK_LENGTH; i++) {
      this.laneLabels.push(this.text(UI_FONT, 12, DIM).setOrigin(0.5, 1));
    }

    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    const onGameState = (update: BoardUpdate) => this.receive(update);
    gameStateEvents.on(GAME_STATE_EVENT, onGameState);

    // Barrelo pushes only when state changes, and the push on page load usually lands while Boot and
    // Preloader are still running — so catch up on whatever arrived before this scene existed.
    const missed = getLatestUpdate();
    this.layout();
    if (missed) this.receive(missed);
    else this.draw();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      gameStateEvents.off(GAME_STATE_EVENT, onGameState);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  private text(fontFamily: string, fontSize: number, color: string): Phaser.GameObjects.Text {
    return this.add.text(0, 0, "", { fontFamily, fontSize: `${fontSize}px`, color });
  }

  private handleResize(): void {
    this.layout();
    this.draw();
  }

  private layout(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const safehouseWidth = Phaser.Math.Clamp(width * 0.15, 130, 210);

    this.geo = {
      width,
      height,
      trackTop: HEADER_H + 34,
      trackBottom: height - FOOTER_H - 22,
      lanesLeft: 16,
      laneWidth: Math.max(48, (width - 32 - safehouseWidth - 16) / TRACK_LENGTH),
      safehouseX: width - safehouseWidth / 2 - 16,
    };

    this.backdrop.setPosition(width / 2, height / 2).setDisplaySize(width, height);

    // The game-over panel is built once at the size it was created at; drop it here so a resize
    // rebuilds it rather than leaving a stale panel floating off-centre.
    this.gameOver?.destroy(true);
    this.gameOver = null;
  }

  /** Centre of dart slot `index`, counting from the left of the three. */
  private slotX(index: number): number {
    const right = this.geo.width - 20;
    return right - (DARTS_PER_TURN - index - 0.5) * (SLOT_W + SLOT_GAP) + SLOT_GAP / 2;
  }

  /** Space 6 sits on the far left, space 1 next to the safehouse (§8). */
  private laneX(space: number): number {
    const index = TRACK_LENGTH - Phaser.Math.Clamp(space, 1, TRACK_LENGTH);
    return this.geo.lanesLeft + (index + 0.5) * this.geo.laneWidth;
  }

  private receive(update: BoardUpdate): void {
    const previous = this.marker;
    this.latest = update;
    this.draw();

    const state = update.state;
    this.marker = {
      darts: state.dartsThrown,
      safehouseHp: state.safehouseHp,
      wave: state.wave,
      isComplete: state.isComplete,
      victory: state.victory,
    };

    // Sound is driven by the *difference* between two rendered states, never by the fold. A refresh
    // mid-match has no previous state and stays silent rather than replaying the whole run's audio,
    // and an undo shortens the log so nothing fires on the way back either.
    if (!previous) return;
    if (state.dartsThrown > previous.darts) this.playDartSound(state);
    if (state.safehouseHp < previous.safehouseHp) this.delayedSfx("breach", 220);
    if (state.wave > previous.wave) this.delayedSfx("wave", 420);
    if (state.isComplete && !previous.isComplete) this.delayedSfx(state.victory ? "victory" : "gameOver", 700);
  }

  private delayedSfx(name: SfxName, delay: number): void {
    this.time.delayedCall(delay, () => playSfx(name));
  }

  private playDartSound(state: GameState): void {
    const outcome = state.visitOutcomes[state.visitOutcomes.length - 1];
    if (!outcome) return;

    if (outcome.kind === "freeze") playSfx("freeze");
    else if (outcome.kind === "critical") {
      playSfx("critical");
      if (outcome.kills > 0) this.delayedSfx("kill", 180);
    } else if (outcome.kills > 0) playSfx("kill");
    else if (outcome.damage > 0) playSfx("hit");
    else playSfx("miss");
  }

  // -------------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------------

  private draw(): void {
    if (!this.latest) return;
    const { state, playerNames } = this.latest;

    this.drawChrome();
    this.drawHeader(state);
    this.drawSafehouse(state);
    this.drawHorde(state);
    this.drawBanner(state);
    this.drawFooter(state, playerNames);
    this.drawGameOver(state, playerNames);
  }

  private drawChrome(): void {
    const { width, height, trackTop, trackBottom, laneWidth, lanesLeft } = this.geo;
    const g = this.chrome;
    g.clear();

    g.fillStyle(0x0d1310, 1).fillRect(0, 0, width, height);
    g.fillStyle(0x141d17, 1).fillRect(0, 0, width, HEADER_H);
    g.fillStyle(0x141d17, 1).fillRect(0, height - FOOTER_H, width, FOOTER_H);
    g.lineStyle(2, 0x2a3a30, 1);
    g.lineBetween(0, HEADER_H, width, HEADER_H);
    g.lineBetween(0, height - FOOTER_H, width, height - FOOTER_H);

    // The three dart slots, drawn as slots rather than implied by floating text — the turn readout in
    // §13 is one of the few things a player looks at *while* walking to the oche.
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      const x = this.slotX(i) - SLOT_W / 2;
      const y = height - FOOTER_H + 22;
      g.fillStyle(0x0f1712, 1).fillRoundedRect(x, y, SLOT_W, SLOT_H, 6);
      g.lineStyle(1, 0x2a3a30, 1).strokeRoundedRect(x, y, SLOT_W, SLOT_H, 6);
    }

    // One panel per space, darkening toward the safehouse so the danger end of the track is obvious
    // without reading the numbers.
    for (let i = 0; i < TRACK_LENGTH; i++) {
      const x = lanesLeft + i * laneWidth;
      const nearness = i / (TRACK_LENGTH - 1);
      g.fillStyle(0x16211a, 0.35 + nearness * 0.45);
      g.fillRect(x + 3, trackTop, laneWidth - 6, trackBottom - trackTop);
    }

    const labelY = trackBottom + 18;
    for (let i = 0; i < TRACK_LENGTH; i++) {
      const space = TRACK_LENGTH - i;
      this.laneLabels[i].setText(String(space)).setPosition(this.laneX(space), labelY);
    }
  }

  private drawHeader(state: GameState): void {
    const { width } = this.geo;
    const mid = HEADER_H / 2;

    this.waveText.setText(`WAVE ${Math.max(1, state.wave)}`).setPosition(20, mid);
    this.roundText
      .setText(`ROUND ${Math.max(1, state.round)}   ·   ZOMBIE HORDE`)
      .setPosition(width / 2, mid);
    this.scoreText.setText(state.score.toLocaleString("en-US")).setPosition(width - 20, mid - 10);
    this.killsText
      .setText(`${state.zombiesKilled} KILLED  ·  ${state.wavesCleared} / ${state.winTargetWave} WAVES CLEARED`)
      .setPosition(width - 20, mid + 18);
  }

  private drawSafehouse(state: GameState): void {
    const { trackTop, trackBottom, safehouseX } = this.geo;
    const g = this.safehouse;
    g.clear();

    const centreY = (trackTop + trackBottom) / 2;
    const bodyW = Phaser.Math.Clamp(this.geo.laneWidth * 1.6, 96, 160);
    const bodyH = Math.min(112, (trackBottom - trackTop) * 0.36);
    const left = safehouseX - bodyW / 2;
    const top = centreY - bodyH / 2;
    const hurt = state.safehouseHp <= 2;

    g.fillStyle(0x101a14, 0.9).fillRoundedRect(
      safehouseX - bodyW / 2 - 14,
      trackTop,
      bodyW + 28,
      trackBottom - trackTop,
      10
    );
    g.lineStyle(2, hurt ? 0x7a2b26 : 0x2a3a30, 1).strokeRoundedRect(
      safehouseX - bodyW / 2 - 14,
      trackTop,
      bodyW + 28,
      trackBottom - trackTop,
      10
    );

    // Roof, walls, door — a house at a glance, and it takes on a red cast as the HP drops.
    const walls = hurt ? 0x4a2b26 : 0x3a4a3c;
    g.fillStyle(hurt ? 0x6b332c : 0x55684f, 1);
    g.fillTriangle(left - 12, top, safehouseX, top - bodyH * 0.45, left + bodyW + 12, top);
    g.fillStyle(walls, 1).fillRect(left, top, bodyW, bodyH);
    g.fillStyle(0x1b2419, 1).fillRect(safehouseX - bodyW * 0.14, top + bodyH * 0.4, bodyW * 0.28, bodyH * 0.6);
    g.lineStyle(2, 0x1b2419, 1).strokeRect(left, top, bodyW, bodyH);

    // HP pips (§9): filled for health remaining, hollow for health lost.
    const pipR = 9;
    const pipGap = 26;
    const pipY = top + bodyH + 38;
    const pipStart = safehouseX - ((state.maxSafehouseHp - 1) * pipGap) / 2;
    for (let i = 0; i < state.maxSafehouseHp; i++) {
      const x = pipStart + i * pipGap;
      if (i < state.safehouseHp) g.fillStyle(0xd6453c, 1).fillCircle(x, pipY, pipR);
      else g.lineStyle(2, 0x4a3a36, 1).strokeCircle(x, pipY, pipR);
    }
  }

  private drawHorde(state: GameState): void {
    const { trackTop, trackBottom, laneWidth } = this.geo;

    // Stack the zombies sharing a space, and size every card off the busiest lane so the whole horde
    // fits without any lane overflowing the track.
    const byLane = new Map<number, Zombie[]>();
    for (const zombie of state.zombies) {
      const space = Phaser.Math.Clamp(zombie.space, 1, TRACK_LENGTH);
      const lane = byLane.get(space);
      if (lane) lane.push(zombie);
      else byLane.set(space, [zombie]);
    }

    const trackH = trackBottom - trackTop;
    const tallest = Math.max(1, ...[...byLane.values()].map((lane) => lane.length));
    const cardH = Phaser.Math.Clamp(
      (trackH - (tallest + 1) * LANE_GAP) / tallest,
      CARD_MIN_H,
      CARD_MAX_H
    );
    // Capped as well as fitted: on a wide TV a full-lane card is a letterbox, and the requirement is
    // easier to read on something closer to a playing card.
    const cardW = Math.min(laneWidth - 14, CARD_MAX_W);

    const seen = new Set<string>();
    for (const [space, lane] of byLane) {
      // Everything in a lane is the same distance away, so the stack is ordered by the §6 tie-break —
      // oldest first. The card on top is the one a matching dart will actually hit.
      lane.sort((a, b) => a.spawnOrder - b.spawnOrder);
      const stackH = lane.length * cardH + (lane.length - 1) * LANE_GAP;
      const top = trackTop + (trackH - stackH) / 2;

      lane.forEach((zombie, index) => {
        seen.add(zombie.id);
        const x = this.laneX(space);
        const y = top + index * (cardH + LANE_GAP) + cardH / 2;
        this.placeCard(zombie, x, y, cardW, cardH);
      });
    }

    for (const [id, card] of this.cards) {
      if (!seen.has(id)) this.killCard(id, card);
    }

    const lull = state.zombies.length === 0 && !state.isComplete;
    this.lullText
      .setVisible(lull)
      .setText(`WAVE ${state.wave} CLEARED — BRACE FOR ${state.wave + 1}`)
      .setPosition((this.geo.lanesLeft + this.geo.safehouseX) / 2, (trackTop + trackBottom) / 2);
  }

  private placeCard(zombie: Zombie, x: number, y: number, w: number, h: number): void {
    let card = this.cards.get(zombie.id);
    const spawning = card === undefined;

    if (!card) {
      const bg = this.add.graphics();
      const alert = this.add.graphics();
      const title = this.add
        .text(0, 0, "", { fontFamily: UI_FONT, fontSize: "11px", color: INK })
        .setOrigin(0.5, 0.5);
      const requirement = this.add
        .text(0, 0, "", { fontFamily: TITLE_FONT, fontSize: "30px", color: INK })
        .setOrigin(0.5, 0.5);
      const pips = this.add.graphics();
      const container = this.add.container(x, y, [bg, alert, pips, title, requirement]);

      card = {
        container,
        bg,
        alert,
        alertTween: null,
        title,
        requirement,
        pips,
        health: zombie.health,
        targetX: x,
        targetY: y,
        moveTween: null,
        fadeTween: null,
        width: w,
        height: h,
      };
      this.cards.set(zombie.id, card);

      // Shambles in from off the spawn end of the track: a slide that a retarget may interrupt, and a
      // fade that nothing may.
      const spawned = card;
      container.setAlpha(0);
      spawned.fadeTween = this.tweens.add({
        targets: container,
        alpha: 1,
        duration: 320,
        onComplete: () => {
          spawned.fadeTween = null;
        },
      });
      spawned.moveTween = this.tweens.add({
        targets: container,
        x: { from: x - 60, to: x },
        duration: 320,
        ease: "Quad.Out",
      });
    } else if (card.targetX !== x || card.targetY !== y) {
      // The card is going somewhere new: the movement phase stepping it toward the safehouse (§3), a
      // restack after the zombie in front of it died, or a resize. Whatever the reason, the tween
      // already in flight is aiming at a stale spot, so it loses.
      card.moveTween?.stop();
      card.targetX = x;
      card.targetY = y;

      // Animate a step; snap anything further. Phaser stops ticking while the page is hidden, so a
      // board that was in a background tab (or was refreshed mid-match) can come back several rounds
      // of movement behind — and it should show where the horde *is*, not spend a second sliding there.
      const stride = Math.abs(card.container.x - x);
      if (stride > this.geo.laneWidth * 1.5) {
        card.moveTween = null;
        card.container.setPosition(x, y);
      } else {
        card.moveTween = this.tweens.add({ targets: card.container, x, y, duration: 380, ease: "Quad.InOut" });
      }
    }

    if (!spawning && zombie.health < card.health) {
      this.tweens.add({
        targets: card.container,
        scale: { from: 1.18, to: 1 },
        duration: 220,
        ease: "Back.Out",
      });
    }

    card.health = zombie.health;
    card.width = w;
    card.height = h;
    // Belt and braces: once the spawn fade is done (or was never able to run), the card is opaque.
    // A zombie the rules say is on the board must be visible, whatever happened to its tweens.
    if (!card.fadeTween) card.container.setAlpha(1);
    this.drawCard(card, zombie);
  }

  private drawCard(card: ZombieCard, zombie: Zombie): void {
    const { width: w, height: h } = card;
    const style = TYPE_STYLES[zombie.type];
    const left = -w / 2;
    const top = -h / 2;

    card.bg.clear();
    card.bg.fillStyle(style.fill, 0.96).fillRoundedRect(left, top, w, h, 8);
    card.bg.lineStyle(2, zombie.imminent ? 0xff4a3a : style.border, 1).strokeRoundedRect(left, top, w, h, 8);

    const showTitle = h >= 62;
    const showPips = h >= 50;

    card.title
      .setVisible(showTitle)
      .setText(ZOMBIE_TYPES[zombie.type].label)
      .setPosition(0, top + 12);

    // `health × number` — current health, so the card counts down as it is chipped (§6, §14).
    card.requirement
      .setText(zombieRequirement(zombie))
      .setFontSize(Math.round(Phaser.Math.Clamp(h * 0.4, 17, 34)))
      .setPosition(0, showTitle ? 2 : showPips ? -4 : 0);

    card.pips.clear();
    if (showPips) {
      const pipY = h / 2 - 12;
      // Beyond eight pips the row stops being countable at TV distance, so it becomes a bar instead.
      if (zombie.maxHealth <= 8) {
        const gap = Math.min(13, (w - 16) / zombie.maxHealth);
        const startX = -((zombie.maxHealth - 1) * gap) / 2;
        for (let i = 0; i < zombie.maxHealth; i++) {
          const x = startX + i * gap;
          if (i < zombie.health) card.pips.fillStyle(0xd6453c, 1).fillCircle(x, pipY, 4);
          else card.pips.fillStyle(0x000000, 0.35).fillCircle(x, pipY, 4);
        }
      } else {
        const barW = w - 22;
        card.pips.fillStyle(0x000000, 0.4).fillRect(-barW / 2, pipY - 4, barW, 8);
        card.pips
          .fillStyle(0xd6453c, 1)
          .fillRect(-barW / 2, pipY - 4, (barW * zombie.health) / zombie.maxHealth, 8);
      }
    }

    this.setAlert(card, zombie.imminent);
  }

  /** The pulsing red outline on anything that lands this round — the §16 warning, per zombie. */
  private setAlert(card: ZombieCard, imminent: boolean): void {
    if (!imminent) {
      card.alertTween?.remove();
      card.alertTween = null;
      card.alert.clear().setAlpha(0);
      return;
    }

    const { width: w, height: h } = card;
    card.alert
      .clear()
      .lineStyle(4, 0xff4a3a, 1)
      .strokeRoundedRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 10);

    if (!card.alertTween) {
      card.alertTween = this.tweens.add({
        targets: card.alert,
        alpha: { from: 0.15, to: 0.95 },
        duration: 620,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private killCard(id: string, card: ZombieCard): void {
    this.cards.delete(id);
    card.alertTween?.remove();
    this.tweens.add({
      targets: card.container,
      alpha: 0,
      scale: 0.4,
      angle: 14,
      duration: 260,
      ease: "Quad.In",
      onComplete: () => card.container.destroy(),
    });
  }

  private drawBanner(state: GameState): void {
    const y = HEADER_H + 18;
    this.bannerText.setPosition(this.geo.width / 2, y);

    if (state.isComplete) {
      this.bannerText.setVisible(false);
      return;
    }

    if (state.freezeArmed) {
      this.bannerText.setVisible(true).setColor("#7fd8ff").setText("FREEZE — THE HORDE HOLDS THIS ROUND");
      return;
    }

    const imminent = state.zombies.filter((zombie) => zombie.imminent);
    if (imminent.length === 0) {
      this.bannerText.setVisible(false);
      return;
    }

    const text =
      imminent.length === 1
        ? `${ZOMBIE_TYPES[imminent[0].type].label} WILL REACH THE SAFEHOUSE — ${zombieRequirement(imminent[0])}`
        : `${imminent.length} ZOMBIES WILL REACH THE SAFEHOUSE`;
    this.bannerText.setVisible(true).setColor(ALERT).setText(text);
  }

  private drawFooter(state: GameState, playerNames: Record<string, string>): void {
    const { width, height } = this.geo;
    const top = height - FOOTER_H;

    const thrower = state.currentPlayerId;
    const name = thrower ? playerNames[thrower] ?? "Player" : "—";
    const seat = state.currentPlayerIndex + 1;
    const roster = state.teams[0]?.playerIds.length ?? 0;

    this.playerText.setText(name.toUpperCase()).setPosition(20, top + 40);
    this.turnText
      .setText(`SURVIVOR ${seat} OF ${roster}   ·   THROW ${state.currentVisitThrows.length + 1} OF ${DARTS_PER_TURN}`)
      .setPosition(20, top + 72);

    // The dart slots belong to whichever visit the outcomes came from — the open one while a player is
    // throwing, and the one that just closed while the next player walks up.
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      const outcome = state.visitOutcomes[i];
      const slot = this.dartTexts[i];
      const note = this.dartDetails[i];
      const centre = top + 22 + SLOT_H / 2;
      slot.setPosition(this.slotX(i), centre - 11);
      note.setPosition(this.slotX(i), centre + 15);

      if (!outcome) {
        slot.setColor(DIM).setText("—");
        note.setColor(DIM).setText(`DART ${i + 1}`);
        continue;
      }

      const detail =
        outcome.kind === "freeze"
          ? "FREEZE"
          : outcome.kills > 0
            ? `${outcome.damage} DMG · ${outcome.kills} KILL${outcome.kills > 1 ? "S" : ""}`
            : outcome.damage > 0
              ? `${outcome.damage} DMG`
              : outcome.kind === "miss"
                ? "MISS"
                : "NO EFFECT";

      const color =
        outcome.kind === "critical"
          ? "#ffd75e"
          : outcome.kind === "freeze"
            ? "#7fd8ff"
            : outcome.kills > 0
              ? "#8fd67f"
              : outcome.damage > 0
                ? INK
                : DIM;
      slot.setColor(color).setText(outcome.notation);
      note.setColor(color).setText(detail);
    }

    this.eventText
      .setText(state.roundEvents.slice(-2).join("\n"))
      .setPosition(width - 20, top + 104);
  }

  private drawGameOver(state: GameState, playerNames: Record<string, string>): void {
    if (!state.isComplete) {
      this.gameOver?.destroy(true);
      this.gameOver = null;
      return;
    }
    if (this.gameOver) return;

    const { width, height } = this.geo;
    const panelW = Math.min(620, width - 80);
    const panelH = Math.min(430, height - 80);

    const shade = this.add.rectangle(0, 0, width, height, 0x000000, 0.78);
    const panel = this.add.graphics();
    panel
      .fillStyle(0x16110f, 0.98)
      .fillRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14)
      .lineStyle(3, state.victory ? 0x2f6b3a : 0x7a2b26, 1)
      .strokeRoundedRect(-panelW / 2, -panelH / 2, panelW, panelH, 14);

    const survivors = (state.teams[0]?.playerIds ?? [])
      .map((id) => playerNames[id] ?? "Player")
      .join(" · ");

    const heading = this.add
      .text(0, -panelH / 2 + 52, state.victory ? "SAFEHOUSE HELD" : "SAFEHOUSE DESTROYED", {
        fontFamily: TITLE_FONT,
        fontSize: "40px",
        color: state.victory ? SUCCESS : ALERT,
      })
      .setOrigin(0.5);

    const stats = this.add
      .text(
        0,
        14,
        [
          `WAVE                 ${state.wave} OF ${state.winTargetWave}`,
          `SURVIVAL TIME        ${formatDuration(state.survivalMs)}`,
          `ZOMBIES KILLED       ${state.zombiesKilled}`,
          `WAVES CLEARED        ${state.wavesCleared}`,
          `DARTS THROWN         ${state.dartsThrown}`,
          "",
          `TEAM SCORE           ${state.score.toLocaleString("en-US")}`,
        ].join("\n"),
        { fontFamily: UI_FONT, fontSize: "20px", color: INK, align: "left", lineSpacing: 8 }
      )
      .setOrigin(0.5);

    const footer = this.add
      .text(0, panelH / 2 - 44, survivors, {
        fontFamily: UI_FONT,
        fontSize: "15px",
        color: DIM,
        align: "center",
        wordWrap: { width: panelW - 60 },
      })
      .setOrigin(0.5);

    this.gameOver = this.add.container(width / 2, height / 2, [shade, panel, heading, stats, footer]);
    this.gameOver.setAlpha(0);
    this.tweens.add({ targets: this.gameOver, alpha: 1, duration: 480, ease: "Quad.Out" });
  }
}
