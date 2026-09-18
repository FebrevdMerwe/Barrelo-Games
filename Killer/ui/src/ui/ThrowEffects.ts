import Phaser from 'phaser';
import type { AbortableAnimation } from './AnimationQueue';

const DART_FLIGHT_MS = 480;
const STICK_HOLD_MS = 350;
const STICK_FADE_MS = 450;
const POPUP_IN_MS = 250;
const POPUP_HOLD_MS = 500;
const POPUP_OUT_MS = 650;

export interface ThrowVisual {
  segment: number;
  ring: string;
  originX: number;
  originY: number;
  impactX: number;
  impactY: number;
}

type PopupVariant = 'plain' | 'gold' | 'red';

function textureForPopup(variant: PopupVariant): string {
  switch (variant) {
    case 'gold':
      return 'popup_gold';
    case 'red':
      return 'popup_red';
    default:
      return 'popup_background';
  }
}

function describeThrow(segment: number, ring: string): { label: string; variant: PopupVariant } {
  if (segment === 25 || ring === 'Bull') return { label: 'BULL', variant: 'gold' };
  const upperRing = ring.toUpperCase();
  if (ring === 'Double' || ring === 'Triple') return { label: `${upperRing} ${segment}`, variant: 'gold' };
  return { label: `${upperRing} ${segment}`, variant: 'plain' };
}

/**
 * Plays one throw's full visual sequence: dart flies from the thrower's card to the impact point,
 * trailing a particle; on arrival the board jitters, a burst fires, and a score popup floats up
 * and fades. Owns no game-state — BoardScene supplies screen-space origin/impact coordinates and
 * a callback to trigger the board's own jitter.
 */
export class ThrowEffects {
  private dart: Phaser.GameObjects.Image;
  private dartShadow: Phaser.GameObjects.Image;
  private trailEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private burstEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private popupContainer: Phaser.GameObjects.Container;
  private popupBg: Phaser.GameObjects.Image;
  private popupText: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene, private onImpactShake: () => void) {
    this.dart = scene.add.image(0, 0, 'dart').setDisplaySize(28, 28).setVisible(false).setDepth(50);
    this.dartShadow = scene.add.image(0, 0, 'dart_shadow').setDisplaySize(22, 12).setVisible(false).setDepth(48);

    // trail_particle/spark_particle source files are pre-downscaled to ~160px (see scratchpad
    // downscale.mjs) specifically so Phaser never has to minify+rotate a huge (~1400px) texture
    // down to a tiny on-screen size — that combination produced a stray WebGL sampling artifact
    // (a thin diagonal line) that no amount of alpha/scale tuning fixed, only shrinking the
    // source texture itself did. `scale` here is a fraction of that ~160px native size.
    this.trailEmitter = scene.add.particles(0, 0, 'trail_particle', {
      lifespan: 200,
      speed: { min: 0, max: 6 },
      scale: { start: 0.125, end: 0 },
      alpha: { start: 0.8, end: 0 },
      frequency: 18,
      tint: 0xfacc15,
      emitting: false,
    });
    this.trailEmitter.setDepth(49);

    this.burstEmitter = scene.add.particles(0, 0, 'spark_particle', {
      lifespan: 300,
      speed: { min: 15, max: 60 },
      scale: { start: 0.3, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: 0xfff2c2,
      emitting: false,
    });
    this.burstEmitter.setDepth(51);

    this.popupBg = scene.add.image(0, 0, 'popup_background').setDisplaySize(140, 46);
    this.popupText = scene.add
      .text(0, 0, '', { fontFamily: 'Arial Black, Arial', fontSize: '18px', color: '#fff8e7' })
      .setOrigin(0.5);
    this.popupContainer = scene.add
      .container(0, 0, [this.popupBg, this.popupText])
      .setVisible(false)
      .setDepth(52);
  }

  /** Starts the sequence and returns an AbortableAnimation for the AnimationQueue. */
  play(visual: ThrowVisual): AbortableAnimation {
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const activeTweens: Phaser.Tweens.Tween[] = [];
    const cleanupAndResolve = () => {
      this.trailEmitter.stop();
      this.trailEmitter.killAll();
      this.burstEmitter.killAll();
      this.dart.setVisible(false);
      this.dartShadow.setVisible(false);
      this.popupContainer.setVisible(false);
      resolveDone();
    };

    const angle = Phaser.Math.Angle.Between(visual.originX, visual.originY, visual.impactX, visual.impactY);
    this.dart.setPosition(visual.originX, visual.originY).setRotation(angle).setVisible(true).setAlpha(1).setScale(1);
    // Both emitters are shared/reused across every throw — killAll() clears any particle still
    // alive from a previous throw before this one starts, so nothing stray carries over.
    this.trailEmitter.killAll();
    this.burstEmitter.killAll();
    this.trailEmitter.setPosition(visual.originX, visual.originY);
    this.trailEmitter.start();

    const flight = this.scene.tweens.add({
      targets: this.dart,
      x: visual.impactX,
      y: visual.impactY,
      duration: DART_FLIGHT_MS,
      ease: 'Quad.easeIn',
      onUpdate: () => this.trailEmitter.setPosition(this.dart.x, this.dart.y),
      onComplete: () => {
        this.trailEmitter.stop();
        this.onImpact(visual, activeTweens, cleanupAndResolve);
      },
    });
    activeTweens.push(flight);

    return {
      done,
      abort: () => {
        activeTweens.forEach((t) => t.stop());
        this.scene.tweens.killTweensOf([this.dart, this.dartShadow, this.popupContainer]);
        cleanupAndResolve();
      },
    };
  }

  private onImpact(visual: ThrowVisual, activeTweens: Phaser.Tweens.Tween[], finish: () => void) {
    this.onImpactShake();

    this.burstEmitter.setPosition(visual.impactX, visual.impactY);
    this.burstEmitter.explode(14);

    this.dartShadow.setPosition(visual.impactX + 2, visual.impactY + 5).setAlpha(0.6).setVisible(true);

    const stickFade = this.scene.tweens.add({
      targets: [this.dart, this.dartShadow],
      alpha: 0,
      duration: STICK_FADE_MS,
      delay: STICK_HOLD_MS,
      onComplete: () => {
        this.dart.setVisible(false);
        this.dartShadow.setVisible(false);
      },
    });
    activeTweens.push(stickFade);

    const { label, variant } = describeThrow(visual.segment, visual.ring);
    this.showPopup(visual.impactX, visual.impactY - 30, label, variant, activeTweens, finish);
  }

  private showPopup(
    x: number,
    y: number,
    text: string,
    variant: PopupVariant,
    activeTweens: Phaser.Tweens.Tween[],
    finish: () => void
  ) {
    this.popupBg.setTexture(textureForPopup(variant));
    this.popupText.setText(text);
    const padding = 28;
    this.popupBg.setDisplaySize(Math.max(140, this.popupText.width + padding * 2), 46);

    this.popupContainer.setPosition(x, y).setScale(0.6).setAlpha(0).setVisible(true);

    const riseIn = this.scene.tweens.add({
      targets: this.popupContainer,
      y: y - 36,
      alpha: 1,
      scale: 1,
      duration: POPUP_IN_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        const riseOut = this.scene.tweens.add({
          targets: this.popupContainer,
          y: y - 70,
          alpha: 0,
          duration: POPUP_OUT_MS,
          delay: POPUP_HOLD_MS,
          onComplete: finish,
        });
        activeTweens.push(riseOut);
      },
    });
    activeTweens.push(riseIn);
  }
}
