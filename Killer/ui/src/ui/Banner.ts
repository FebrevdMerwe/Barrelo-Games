import Phaser from 'phaser';

const BANNER_WIDTH = 520;
const BANNER_HEIGHT = 90;

export type BannerVariant = 'turn' | 'eliminated' | 'victory';

function textureForVariant(variant: BannerVariant): string {
  switch (variant) {
    case 'eliminated':
      return 'banner_eliminated';
    case 'victory':
      return 'banner_victory';
    default:
      return 'banner_turn';
  }
}

/**
 * One reusable slide-in / hold / fade-out banner, shared by turn/elimination/victory
 * announcements. Only one banner is ever showing at a time — show() always cancels and
 * resolves whatever was previously showing first.
 */
export class Banner {
  private container: Phaser.GameObjects.Container;
  private background: Phaser.GameObjects.Image;
  private text: Phaser.GameObjects.Text;
  private tween: Phaser.Tweens.Tween | null = null;
  private resolveCurrent: (() => void) | null = null;

  constructor(private scene: Phaser.Scene) {
    this.background = scene.add.image(0, 0, 'banner_turn').setDisplaySize(BANNER_WIDTH, BANNER_HEIGHT);
    this.text = scene.add
      .text(0, 0, '', { fontFamily: 'Arial Black, Arial', fontSize: '28px', color: '#fff8e7' })
      .setOrigin(0.5);
    this.container = scene.add.container(0, 0, [this.background, this.text]).setAlpha(0).setVisible(false);
  }

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
  }

  /** Slides in, holds, fades out. Resolves once fully hidden again. */
  show(variant: BannerVariant, text: string, holdMs = 1300): Promise<void> {
    this.skip();

    this.background.setTexture(textureForVariant(variant));
    this.text.setText(text);
    const maxTextWidth = BANNER_WIDTH * 0.82;
    this.text.setScale(this.text.width > maxTextWidth ? maxTextWidth / this.text.width : 1);

    return new Promise((resolve) => {
      this.resolveCurrent = resolve;
      this.container.setVisible(true).setAlpha(0).setScale(0.85);

      this.tween = this.scene.tweens.add({
        targets: this.container,
        alpha: 1,
        scale: 1,
        duration: 220,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.tween = this.scene.tweens.add({
            targets: this.container,
            alpha: 1,
            duration: holdMs,
            onComplete: () => {
              this.tween = this.scene.tweens.add({
                targets: this.container,
                alpha: 0,
                duration: 300,
                onComplete: () => this.finish(),
              });
            },
          });
        },
      });
    });
  }

  /** Synchronously cancels whatever is showing (used by hard resync / undo) and resolves its promise. */
  skip() {
    if (this.tween) {
      this.tween.stop();
      this.tween = null;
    }
    this.container.setVisible(false).setAlpha(0);
    this.finish();
  }

  private finish() {
    if (this.resolveCurrent) {
      const resolve = this.resolveCurrent;
      this.resolveCurrent = null;
      resolve();
    }
  }
}
