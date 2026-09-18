import Phaser from 'phaser';

/**
 * First scene in the boot sequence. Phaser convention: Boot loads only what the *next* scene
 * (Preloader) needs to render itself — usually nothing more than a loading-bar frame — then hands
 * off immediately. Killer's bar is drawn from plain rectangles, so there is nothing to load here.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    this.scene.start('preloader');
  }
}
