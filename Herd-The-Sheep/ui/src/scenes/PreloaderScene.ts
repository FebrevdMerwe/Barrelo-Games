import Phaser from 'phaser';
import { generateTextures } from '../ui/textures';

/**
 * Standard Phaser boot structure, with nothing to boot: every surface in this game is generated
 * into the texture cache rather than fetched, so there is no network load and no progress bar to
 * show. The scene is kept because that is where a real asset list would go — drop PNGs into
 * ui/public/assets, load them here under the keys in ui/src/ui/textures.ts, and no drawing code
 * anywhere else has to change.
 */
export class PreloaderScene extends Phaser.Scene {
  constructor() {
    super('preloader');
  }

  create(): void {
    generateTextures(this);
    this.scene.start('board');
  }
}
