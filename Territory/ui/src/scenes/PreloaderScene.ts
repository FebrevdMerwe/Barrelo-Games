import Phaser from 'phaser';
import { generateTextures } from '../ui/textures.ts';

const TRACK_COLOR = 0x1b2431;
const FILL_COLOR = 0x3b82f6;

/**
 * Territory loads nothing over the network — the map is Graphics and the two surfaces it sits on are
 * generated into the texture cache here. That takes a few milliseconds rather than a few hundred, so
 * the progress bar is really only a placeholder for the moment real art is dropped in behind the
 * same keys.
 */
export class PreloaderScene extends Phaser.Scene {
  constructor() {
    super('preloader');
  }

  preload(): void {
    const { width, height } = this.scale;
    const barWidth = Math.min(320, width * 0.6);
    const barHeight = 14;
    const barX = width / 2 - barWidth / 2;
    const barY = height / 2 - barHeight / 2;

    const track = this.add.rectangle(barX, barY, barWidth, barHeight, TRACK_COLOR).setOrigin(0, 0);
    const fill = this.add.rectangle(barX + 2, barY + 2, 1, barHeight - 4, FILL_COLOR).setOrigin(0, 0);

    this.load.on(Phaser.Loader.Events.PROGRESS, (progress: number) => {
      fill.width = Math.max(1, (barWidth - 4) * progress);
    });
    this.load.on(Phaser.Loader.Events.COMPLETE, () => {
      track.destroy();
      fill.destroy();
    });
  }

  create(): void {
    generateTextures(this);
    this.scene.start('board');
  }
}
