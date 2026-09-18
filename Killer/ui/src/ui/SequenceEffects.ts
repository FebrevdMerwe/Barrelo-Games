import Phaser from 'phaser';
import type { Banner } from './Banner';

/**
 * Owns the "big moment" sequences that go beyond a single card or a single throw: elimination
 * (banner only — the card's own fade/heart-shatter is driven separately by PlayerCard) and victory
 * (permanent background darken + banner + confetti/gold particles that outlive the sequence itself,
 * since nothing more will ever be enqueued once the match is complete).
 */
export class SequenceEffects {
  private darkOverlay: Phaser.GameObjects.Rectangle;
  private confettiEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private goldEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private smokeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private scene: Phaser.Scene, private banner: Banner) {
    this.darkOverlay = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.55).setOrigin(0, 0).setVisible(false).setDepth(40);

    this.smokeEmitter = scene.add.particles(0, 0, 'smoke_particle', {
      lifespan: 700,
      speed: { min: 10, max: 30 },
      scale: { start: 0.3, end: 0.55 },
      alpha: { start: 0.7, end: 0 },
      emitting: false,
    });
    this.smokeEmitter.setDepth(43);

    this.confettiEmitter = scene.add.particles(0, 0, 'confetti', {
      lifespan: 3200,
      speedY: { min: 60, max: 140 },
      speedX: { min: -40, max: 40 },
      rotate: { min: 0, max: 360 },
      scale: { start: 0.4, end: 0.4 },
      alpha: { start: 1, end: 0 },
      frequency: 40,
      emitting: false,
    });
    this.confettiEmitter.setDepth(41);

    // No tint here — gold_particle.png already has its warm gold colour baked in.
    this.goldEmitter = scene.add.particles(0, 0, 'gold_particle', {
      lifespan: 2600,
      speedY: { min: 30, max: 90 },
      speedX: { min: -20, max: 20 },
      scale: { start: 0.3, end: 0 },
      alpha: { start: 0.9, end: 0 },
      frequency: 90,
      emitting: false,
    });
    this.goldEmitter.setDepth(42);
  }

  /** Keeps the darken overlay covering the full canvas across resizes. */
  layout(width: number, height: number) {
    this.darkOverlay.setSize(width, height);
    this.confettiEmitter.setPosition(width / 2, -20);
    this.goldEmitter.setPosition(width / 2, -20);
  }

  playElimination(playerName: string, cardCenter: { x: number; y: number }): Promise<void> {
    this.smokeEmitter.setPosition(cardCenter.x, cardCenter.y);
    this.smokeEmitter.explode(8);
    return this.banner.show('eliminated', `${playerName.toUpperCase()} ELIMINATED`, 1400);
  }

  /** Confetti/gold particles keep falling indefinitely — the match is over, nothing else will play. */
  playVictory(playerName: string): Promise<void> {
    this.darkOverlay.setAlpha(0).setVisible(true);
    this.scene.tweens.add({ targets: this.darkOverlay, alpha: 1, duration: 600 });
    this.confettiEmitter.start();
    this.goldEmitter.start();
    return this.banner.show('victory', `${playerName.toUpperCase()} WINS`, 2200);
  }

  /** Synchronously cancels whatever is showing (used by hard resync / undo). */
  skip() {
    this.banner.skip();
    this.confettiEmitter.stop();
    this.goldEmitter.stop();
    this.smokeEmitter.stop();
    this.darkOverlay.setVisible(false).setAlpha(0);
  }
}
