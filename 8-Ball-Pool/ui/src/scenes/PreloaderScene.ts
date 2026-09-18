import Phaser from "phaser";

/**
 * The board is drawn procedurally (table, balls, pockets are all `Phaser.GameObjects.Arc`/`Rectangle`),
 * so there are no external art assets to load — this scene is a placeholder for when there are.
 */
export class PreloaderScene extends Phaser.Scene {
  constructor() {
    super("preloader");
  }

  create(): void {
    this.scene.start("board");
  }
}
