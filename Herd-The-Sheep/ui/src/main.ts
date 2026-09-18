import Phaser from 'phaser';
import './bridge';
import { BootScene } from './scenes/BootScene';
import { PreloaderScene } from './scenes/PreloaderScene';
import { BoardScene } from './scenes/BoardScene';

/**
 * No `physics` block, deliberately.
 *
 * The board runs Matter directly, on an engine built by simulate.ts's own createEngine() — the same
 * call the rules use. Enabling Phaser's Matter integration here would create a *second* engine with
 * its own solver settings and its own delta-smoothing runner, which is a place for the live board
 * and the authoritative replay to drift apart. There is exactly one engine configuration in this
 * codebase and it lives in simulate.ts.
 */
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#243318',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PreloaderScene, BoardScene],
});
