import Phaser from 'phaser';
import { colourForIndex } from './playerColours';

export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 96;

const NAME_COLOR = '#e8dcc0';
const ACTIVE_NAME_COLOR = '#facc15';
const HEART_SIZE = 30;
const HEART_GAP = 3;
const GOLD = 0xd4af37;

export type PlayerCardState = 'normal' | 'active' | 'killer' | 'dead';

function textureForState(state: PlayerCardState): string {
  switch (state) {
    case 'active':
      return 'player_card_active';
    case 'killer':
      return 'player_card_killer';
    case 'dead':
      return 'player_card_dead';
    default:
      return 'player_card';
  }
}

/**
 * One persistent card per player, created once for the whole match (roster never changes).
 * All visual state (background texture, colour accent, killer/eliminated decoration, hearts) is
 * updated in place — never destroyed/recreated — so tweens can safely animate any part of it.
 */
export class PlayerCard {
  readonly container: Phaser.GameObjects.Container;
  private background: Phaser.GameObjects.Image;
  private colourAccent: Phaser.GameObjects.Graphics;
  private personalGlow: Phaser.GameObjects.Image;
  private killerGlow: Phaser.GameObjects.Image;
  private nameText: Phaser.GameObjects.Text;
  private skull: Phaser.GameObjects.Image;
  private crown: Phaser.GameObjects.Image;
  private killerBurstEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private hearts: Phaser.GameObjects.Image[] = [];
  private colour: number;
  private state: PlayerCardState = 'normal';
  private lives: number;
  private isActive = false;
  private isKiller = false;
  private pendingResolve: (() => void) | null = null;

  constructor(private scene: Phaser.Scene, colourIndex: number, maxLives: number) {
    this.colour = colourForIndex(colourIndex);
    this.lives = maxLives;
    this.container = scene.add.container(0, 0);

    const cx = CARD_WIDTH / 2;
    const cy = CARD_HEIGHT / 2;

    const shadow = scene.add
      .image(cx + 4, cy + 8, 'player_card_shadow')
      .setDisplaySize(CARD_WIDTH * 1.2, CARD_HEIGHT * 1.5);
    this.container.add(shadow);

    this.killerGlow = scene.add
      .image(cx, cy, 'player_card_glow')
      .setDisplaySize(CARD_WIDTH * 1.5, CARD_HEIGHT * 1.9)
      .setTint(GOLD)
      .setAlpha(0.6)
      .setVisible(false);
    this.container.add(this.killerGlow);

    this.personalGlow = scene.add
      .image(cx, cy, 'player_card_glow')
      .setDisplaySize(CARD_WIDTH * 1.35, CARD_HEIGHT * 1.7)
      .setTint(this.colour)
      .setAlpha(0.35);
    this.container.add(this.personalGlow);

    // A plain scaled Image rather than a 9-slice: card size is fixed for this pass (no
    // per-player-count responsive resizing yet), so a single constant scale factor already
    // renders identically to a 9-slice at one size — 9-slicing only pays off once the display
    // size actually varies at runtime.
    this.background = scene.add.image(cx, cy, 'player_card').setDisplaySize(CARD_WIDTH, CARD_HEIGHT);
    this.container.add(this.background);

    // Thin rounded-rect accent line in the player's personal colour — always visible, drawn on top
    // of the card background, so colour-identity is never lost regardless of state.
    this.colourAccent = scene.add.graphics();
    this.colourAccent.lineStyle(3, this.colour, 0.9);
    this.colourAccent.strokeRoundedRect(6, 6, CARD_WIDTH - 12, CARD_HEIGHT - 12, 14);
    this.container.add(this.colourAccent);

    this.nameText = scene.add
      .text(16, 10, '', { fontFamily: 'Arial', fontSize: '16px', color: NAME_COLOR })
      .setOrigin(0, 0);
    this.container.add(this.nameText);

    this.skull = scene.add.image(0, 0, 'card_skull').setOrigin(0, 0.5).setVisible(false);
    this.skull.setDisplaySize(18, 18);
    this.container.add(this.skull);

    this.crown = scene.add.image(0, 0, 'killer_crown').setOrigin(0, 0.5).setVisible(false);
    this.crown.setDisplaySize(20, 20);
    this.container.add(this.crown);

    // Lives at the top level (not inside the container) so its world-space position math stays
    // simple — positioned explicitly via getCenter() whenever a burst fires.
    this.killerBurstEmitter = scene.add.particles(0, 0, 'spark_particle', {
      lifespan: 350,
      speed: { min: 20, max: 70 },
      scale: { start: 0.25, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: GOLD,
      emitting: false,
    });

    const heartsY = 40;
    for (let i = 0; i < maxLives; i++) {
      const heart = scene.add.image(16 + i * (HEART_SIZE + HEART_GAP), heartsY, 'heart_full').setOrigin(0, 0);
      heart.setDisplaySize(HEART_SIZE, HEART_SIZE);
      this.container.add(heart);
      this.hearts.push(heart);
    }
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
  }

  getCenter(): { x: number; y: number } {
    return { x: this.container.x + CARD_WIDTH / 2, y: this.container.y + CARD_HEIGHT / 2 };
  }

  setName(name: string, number: number) {
    this.nameText.setText(`${name} #${number}`);
    const iconX = this.nameText.width + 16 + 6;
    const iconY = this.nameText.height / 2 + 10;
    this.skull.setPosition(iconX, iconY);
    this.crown.setPosition(iconX, iconY);
  }

  setActive(active: boolean) {
    this.isActive = active;
    this.nameText.setColor(active ? ACTIVE_NAME_COLOR : NAME_COLOR);
    this.refreshState();
  }

  setKiller(isKiller: boolean) {
    this.isKiller = isKiller;
    this.refreshState();
  }

  /** Instant, non-animated sync (hardResync / initial state) — never used mid-animation. */
  setLives(lives: number) {
    this.lives = lives;
    this.applyHeartTextures(lives);
    this.skull.setVisible(lives <= 0);
    this.refreshState();
  }

  private applyHeartTextures(lives: number) {
    if (lives <= 0) {
      this.hearts.forEach((heart) => heart.setTexture('heart_dead').setAngle(0).setDisplaySize(HEART_SIZE, HEART_SIZE));
      return;
    }
    this.hearts.forEach((heart, i) => {
      heart.setTexture(i < lives ? 'heart_full' : 'heart_empty').setAngle(0).setDisplaySize(HEART_SIZE, HEART_SIZE);
    });
  }

  /** One-shot: a life was just lost (player still alive) — bounce, crack, settle to the empty state. */
  playLifeLost(livesRemaining: number): Promise<void> {
    const lostIndex = livesRemaining; // 0-indexed: the heart that was the last one filled before this loss
    const heart = this.hearts[lostIndex];
    if (!heart) {
      this.setLives(livesRemaining);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.scene.tweens.add({
        targets: heart,
        scaleX: (HEART_SIZE / heart.width) * 1.5,
        scaleY: (HEART_SIZE / heart.height) * 1.5,
        duration: 130,
        ease: 'Back.easeOut',
        onComplete: () => {
          // heart_break's native pixel size differs from heart_full/heart_empty, so the display
          // size must be re-applied explicitly after the texture swap rather than inheriting
          // whatever scale the bounce tween left behind.
          heart.setTexture('heart_break').setDisplaySize(HEART_SIZE * 1.3, HEART_SIZE * 1.3);
          this.scene.tweens.add({
            targets: heart,
            angle: { from: -10, to: 10 },
            duration: 55,
            yoyo: true,
            repeat: 4,
            onComplete: () => {
              heart.setAngle(0);
              this.lives = livesRemaining;
              this.applyHeartTextures(livesRemaining);
              this.skull.setVisible(false);
              this.refreshState();
              this.finishPending();
            },
          });
        },
      });
    });
  }

  /** One-shot: this player just became Killer — crown pops in, gold glow appears, a gold spark burst fires. */
  playBecameKillerBurst(): Promise<void> {
    this.isKiller = true;
    this.refreshState(); // shows the gold card glow immediately; crown pop is animated below

    const center = this.getCenter();
    this.killerBurstEmitter.setPosition(center.x, center.y);
    this.killerBurstEmitter.explode(16);

    const targetScale = 20 / this.crown.width;
    this.crown.setScale(0).setVisible(true);

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.scene.tweens.add({
        targets: this.crown,
        scale: targetScale,
        duration: 260,
        ease: 'Back.easeOut',
        onComplete: () => this.finishPending(),
      });
    });
  }

  /** One-shot: this player was just eliminated — all remaining hearts shatter to the dead state together. */
  playEliminated(): Promise<void> {
    const stillFilled = this.hearts.filter((h) => h.texture.key === 'heart_full');
    this.lives = 0;

    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      if (stillFilled.length === 0) {
        this.applyHeartTextures(0);
        this.skull.setVisible(true);
        this.refreshState();
        this.finishPending();
        return;
      }
      this.scene.tweens.add({
        targets: stillFilled,
        angle: { from: -12, to: 12 },
        duration: 60,
        yoyo: true,
        repeat: 4,
        onComplete: () => {
          this.applyHeartTextures(0);
          this.skull.setVisible(true);
          this.refreshState();
          this.finishPending();
        },
      });
    });
  }

  private finishPending() {
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve();
    }
  }

  /** Synchronously cancels any in-flight heart/crown animation (used by hard resync / undo) and resolves its promise. */
  abortAnimation() {
    this.scene.tweens.killTweensOf(this.hearts);
    this.scene.tweens.killTweensOf(this.crown);
    this.hearts.forEach((h) => h.setAngle(0));
    this.applyHeartTextures(this.lives);
    this.skull.setVisible(this.lives <= 0);
    if (this.isKiller && this.lives > 0) this.crown.setScale(20 / this.crown.width);
    this.refreshState();
    this.finishPending();
  }

  /** Precedence: eliminated (dead) > killer > active > normal — mirrors the board-number highlight rules. */
  private refreshState() {
    const eliminated = this.lives <= 0;
    this.killerGlow.setVisible(this.isKiller && !eliminated);
    if (this.isKiller && !eliminated) {
      // Only force it fully visible/full-scale when it isn't already mid pop-in animation —
      // playBecameKillerBurst() owns the scale tween and resets it to 0 itself when it starts.
      if (!this.crown.visible) this.crown.setVisible(true).setScale(20 / this.crown.width);
    } else {
      this.crown.setVisible(false);
    }
    this.personalGlow.setAlpha(eliminated ? 0.08 : 0.35);
    this.colourAccent.setAlpha(eliminated ? 0.3 : 1);

    const next: PlayerCardState = eliminated ? 'dead' : this.isKiller ? 'killer' : this.isActive ? 'active' : 'normal';
    if (next !== this.state) {
      this.state = next;
      this.background.setTexture(textureForState(next));
    }
  }
}
