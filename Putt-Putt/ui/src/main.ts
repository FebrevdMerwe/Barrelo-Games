import Phaser from 'phaser';
import './bridge';
import { SOLVER } from './simulate';
import { BootScene } from './scenes/BootScene';
import { PreloaderScene } from './scenes/PreloaderScene';
import { BoardScene } from './scenes/BoardScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d1710',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'matter',
    matter: {
      // Top-down mini golf: the only forces are the putt and drag.
      gravity: { x: 0, y: 0 },
      // BoardScene steps the world by hand at a fixed 1/60s. Left on, Phaser's Matter runner would
      // smooth and snap the frame delta, making the simulation frame-rate dependent and putting it
      // out of step with the identical world rules.ts runs headlessly.
      autoUpdate: false,
      enableSleeping: false,
      // Pinned from the same constants the headless engine is built with — if the two solvers ever
      // disagreed, the board and the rules would settle the ball in different places.
      ...SOLVER,
    },
  },
  scene: [BootScene, PreloaderScene, BoardScene],
});
