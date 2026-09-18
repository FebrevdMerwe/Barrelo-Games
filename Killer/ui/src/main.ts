// Must attach its window message listener before Phaser's async asset preload delays create() —
// Barrelo posts the first snapshot as soon as the iframe's `load` event fires, and postMessage never
// redelivers. BoardScene's getLatestUpdate() catch-up covers the rest of the gap.
import './bridge';
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { PreloaderScene } from './scenes/PreloaderScene';
import { BoardScene } from './scenes/BoardScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
  },
  scene: [BootScene, PreloaderScene, BoardScene],
});
