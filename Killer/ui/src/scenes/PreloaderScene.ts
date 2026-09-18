import Phaser from 'phaser';

const TRACK_COLOR = 0x2a2a44;
const FILL_COLOR = 0xfacc15;

/**
 * Loads every asset the board needs, behind a visible progress bar. Killer pulls in ~34 textures, so
 * BoardScene.create() would otherwise sit on a blank canvas for a noticeable beat on a cold cache.
 * Phaser's texture cache is global, so the keys registered here are the ones BoardScene reads.
 */
export class PreloaderScene extends Phaser.Scene {
  constructor() {
    super('preloader');
  }

  preload(): void {
    this.buildProgressBar();

    this.load.image('heart_full', 'assets/hearts/heart_full.png');
    this.load.image('heart_empty', 'assets/hearts/heart_empty.png');
    this.load.image('heart_break', 'assets/hearts/heart_break.png');
    this.load.image('heart_dead', 'assets/hearts/heart_dead.png');

    this.load.image('bg_wall', 'assets/background/bg_wall.png');
    this.load.image('bg_vignette', 'assets/background/bg_vignette.png');
    this.load.image('bg_light_spot', 'assets/background/bg_light_spot.png');
    this.load.image('bg_noise', 'assets/background/bg_noise.png');
    this.load.image('dartboard_shadow', 'assets/dartboard/dartboard_shadow.png');
    this.load.image('dartboard_cabinet', 'assets/dartboard/dartboard_cabinet.png');
    this.load.image('dartboard_highlight', 'assets/dartboard/dartboard_highlight.png');
    this.load.image('board_number_glow', 'assets/dartboard/board_number_glow.png');
    this.load.image('board_number_ring', 'assets/dartboard/board_number_ring.png');

    this.load.image('player_card', 'assets/cards/player_card.png');
    this.load.image('player_card_active', 'assets/cards/player_card_active.png');
    this.load.image('player_card_killer', 'assets/cards/player_card_killer.png');
    this.load.image('player_card_dead', 'assets/cards/player_card_dead.png');
    this.load.image('player_card_shadow', 'assets/cards/player_card_shadow.png');
    this.load.image('player_card_glow', 'assets/cards/player_card_glow.png');
    this.load.image('card_skull', 'assets/cards/card_skull.png');
    this.load.image('killer_crown', 'assets/killer/killer_crown.png');

    this.load.image('banner_turn', 'assets/banners/banner_turn.png');
    this.load.image('banner_eliminated', 'assets/banners/banner_eliminated.png');
    this.load.image('banner_victory', 'assets/banners/banner_victory.png');
    this.load.image('dart_full', 'assets/darts/dart_full.png');
    this.load.image('dart_empty', 'assets/darts/dart_empty.png');

    this.load.image('dart', 'assets/darts/dart.png');
    this.load.image('dart_shadow', 'assets/darts/dart_shadow.png');
    this.load.image('trail_particle', 'assets/particles/trail_particle.png');
    this.load.image('spark_particle', 'assets/particles/spark_particle.png');
    this.load.image('popup_background', 'assets/ui/popup_background.png');
    this.load.image('popup_gold', 'assets/ui/popup_gold.png');
    this.load.image('popup_red', 'assets/ui/popup_red.png');

    this.load.image('smoke_particle', 'assets/particles/smoke_particle.png');
    this.load.image('confetti', 'assets/particles/confetti.png');
    this.load.image('gold_particle', 'assets/particles/gold_particle.png');
    this.load.image('dust_particle', 'assets/particles/dust_particle.png');
  }

  private buildProgressBar(): void {
    const { width, height } = this.scale;
    const barWidth = Math.min(320, width * 0.6);
    const barHeight = 18;
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
    this.scene.start('board');
  }
}
