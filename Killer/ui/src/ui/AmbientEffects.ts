import Phaser from 'phaser';

/**
 * Always-on atmosphere: drifting dust motes plus a slow "breathing" pulse on the spotlight and
 * board glow layers. None of this reacts to game events — it starts once here and never stops
 * for the life of the scene.
 */
export class AmbientEffects {
  private dustZoneRect = new Phaser.Geom.Rectangle(0, 0, 10, 10);

  constructor(private scene: Phaser.Scene, spotlight: Phaser.GameObjects.Image) {
    // Wrapped in a plain getRandomPoint source (rather than passing the Rectangle directly) to
    // dodge a Phaser typings mismatch between Geom.Rectangle's generic getRandomPoint and the
    // simpler RandomZoneSource interface the emitter config expects.
    const zoneSource: Phaser.Types.GameObjects.Particles.RandomZoneSource = {
      getRandomPoint: (point) => Phaser.Geom.Rectangle.Random(this.dustZoneRect, point as Phaser.Math.Vector2),
    };

    scene.add.particles(0, 0, 'dust_particle', {
      lifespan: 9000,
      speedY: { min: -10, max: -22 },
      speedX: { min: -6, max: 6 },
      scale: { start: 0.12, end: 0.28 },
      alpha: { start: 0.3, end: 0 },
      frequency: 300,
      emitZone: { type: 'random', source: zoneSource },
    });

    scene.tweens.add({
      targets: spotlight,
      alpha: { from: 0.6, to: 0.42 },
      duration: 3400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Called once the board glow layer exists — it's built after this class, later in the scene's create(). */
  attachBoardGlowBreathing(boardGlow: Phaser.GameObjects.Image) {
    this.scene.tweens.add({
      targets: boardGlow,
      alpha: { from: 0.35, to: 0.5 },
      duration: 2800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** Keeps dust drifting across the full current canvas size. */
  layout(width: number, height: number) {
    this.dustZoneRect.setSize(width, height);
  }
}
