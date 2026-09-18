import Phaser from 'phaser';
import { notationFor } from '../board.ts';
import { DARTS_PER_TURN, type GameState, type Team } from '../rules.ts';
import { colourForIndex, cssColour, GOLD, INK, mix, MUTED } from './teams.ts';

/**
 * Everything around the map: the wordmark, the round counter, whose turn it is, the three dart
 * slots, the running commentary, and the victory card.
 *
 * The commentary line exists because Territory's rules are almost all invisible in a single frame —
 * a dart that broke two shields and a dart that did nothing at all both leave a wedge looking much
 * as it did. Saying what just happened, in words, is what makes the rules learnable in a minute.
 */

const HEADER_BG = 0x121820;

export class Hud {
  private readonly scene: Phaser.Scene;

  private readonly headerBar: Phaser.GameObjects.Graphics;
  private readonly wordmark: Phaser.GameObjects.Text;
  private readonly roundLabel: Phaser.GameObjects.Text;
  private readonly turnChip: Phaser.GameObjects.Graphics;
  private readonly turnText: Phaser.GameObjects.Text;
  private readonly slotBoxes: Phaser.GameObjects.Graphics;
  private readonly slotTexts: Phaser.GameObjects.Text[] = [];

  private readonly bannerBg: Phaser.GameObjects.Graphics;
  private readonly bannerText: Phaser.GameObjects.Text;
  private readonly bannerSub: Phaser.GameObjects.Text;
  private bannerTween: Phaser.Tweens.Tween | null = null;

  private readonly overlay: Phaser.GameObjects.Graphics;
  private readonly overlayPanel: Phaser.GameObjects.Graphics;
  private readonly overlayTitle: Phaser.GameObjects.Text;
  private readonly overlaySub: Phaser.GameObjects.Text;

  private width = 0;
  private headerHeight = 56;
  private bannerY = 0;
  /** The map's box. The victory scrim covers only this, leaving the rail's standings readable. */
  private board = { x: 0, y: 0, width: 0, height: 0 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    this.headerBar = scene.add.graphics();
    this.wordmark = scene.add
      .text(0, 0, 'TERRITORY', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '20px',
        color: cssColour(INK),
      })
      .setOrigin(0, 0.5);
    this.roundLabel = scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '11px', color: cssColour(MUTED) })
      .setOrigin(0, 0.5);

    this.turnChip = scene.add.graphics();
    this.turnText = scene.add
      .text(0, 0, '', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '15px',
        color: cssColour(INK),
      })
      .setOrigin(0.5);

    this.slotBoxes = scene.add.graphics();
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      this.slotTexts.push(
        scene.add
          .text(0, 0, '', {
            fontFamily: 'Arial Black, Arial, sans-serif',
            fontSize: '14px',
            color: cssColour(MUTED),
          })
          .setOrigin(0.5)
      );
    }

    this.bannerBg = scene.add.graphics().setAlpha(0);
    this.bannerText = scene.add
      .text(0, 0, '', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '26px',
        color: cssColour(INK),
        align: 'center',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.bannerSub = scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '13px', color: cssColour(MUTED), align: 'center' })
      .setOrigin(0.5)
      .setAlpha(0);

    this.overlay = scene.add.graphics().setVisible(false);
    this.overlayPanel = scene.add.graphics().setVisible(false);
    this.overlayTitle = scene.add
      .text(0, 0, '', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '46px',
        color: cssColour(GOLD),
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.overlaySub = scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '17px', color: cssColour(INK), align: 'center' })
      .setOrigin(0.5)
      .setVisible(false);
  }

  layout(
    width: number,
    height: number,
    headerHeight: number,
    bannerY: number,
    board: { x: number; y: number; width: number; height: number }
  ): void {
    this.width = width;
    this.headerHeight = headerHeight;
    this.bannerY = bannerY;
    this.board = board;

    this.headerBar.clear();
    this.headerBar.fillStyle(HEADER_BG, 1);
    this.headerBar.fillRect(0, 0, width, headerHeight);
    this.headerBar.lineStyle(1, 0x2b3644, 1);
    this.headerBar.lineBetween(0, headerHeight, width, headerHeight);

    const mid = headerHeight / 2;
    this.wordmark.setPosition(20, mid - 7);
    this.roundLabel.setPosition(20, mid + 12);
    this.turnText.setPosition(width / 2, mid);

    this.bannerText.setPosition(width / 2, bannerY);
    this.bannerSub.setPosition(width / 2, bannerY + 26);

    this.overlayTitle.setPosition(this.boardCentreX(), this.boardCentreY() - 20);
    this.overlaySub.setPosition(this.boardCentreX(), this.boardCentreY() + 30);
    this.overlay.clear();
    this.overlay.fillStyle(0x070b10, 0.86);
    this.overlay.fillRect(board.x, board.y, board.width, board.height);

    this.layoutSlots();
  }

  private boardCentreX(): number {
    return this.board.x + this.board.width / 2;
  }

  private boardCentreY(): number {
    return this.board.y + this.board.height / 2;
  }

  /**
   * The solid card the end-of-match text sits on. Without it the map's own labels read straight
   * through the scrim and collide with the headline.
   */
  private drawOverlayPanel(colour: number): void {
    const width = Math.max(this.overlayTitle.width, this.overlaySub.width) + 88;
    const height = 148;
    const x = this.boardCentreX() - width / 2;
    const y = this.boardCentreY() - height / 2;

    this.overlayPanel.clear();
    this.overlayPanel.fillStyle(0x0d141d, 0.98);
    this.overlayPanel.fillRoundedRect(x, y, width, height, 16);
    this.overlayPanel.lineStyle(3, colour, 0.9);
    this.overlayPanel.strokeRoundedRect(x, y, width, height, 16);
  }

  private layoutSlots(): void {
    const slotWidth = 54;
    const slotHeight = 28;
    const gap = 8;
    const total = DARTS_PER_TURN * slotWidth + (DARTS_PER_TURN - 1) * gap;
    const startX = this.width - 20 - total;
    const y = this.headerHeight / 2 - slotHeight / 2;

    this.slotTexts.forEach((text, i) => {
      text.setPosition(startX + i * (slotWidth + gap) + slotWidth / 2, this.headerHeight / 2);
    });

    this.slotBoxes.clear();
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      this.slotBoxes.lineStyle(1.5, 0x2b3644, 1);
      this.slotBoxes.strokeRoundedRect(startX + i * (slotWidth + gap), y, slotWidth, slotHeight, 6);
    }
  }

  render(state: GameState, playerNames: Record<string, string>, labelOf: (team: Team) => string): void {
    const roundText =
      state.maxRounds !== null ? `Round ${state.round} / ${state.maxRounds}` : `Round ${state.round}`;
    this.roundLabel.setText(state.isComplete ? 'Match over' : roundText);

    const team = state.teams.find((t) => t.id === state.currentTeamId);
    const colour = team ? colourForIndex(team.index) : MUTED;

    if (team) {
      const thrower = state.currentPlayerId ? (playerNames[state.currentPlayerId] ?? 'Player') : '';
      const side = labelOf(team);
      this.turnText.setText(side === thrower ? `${thrower} to throw` : `${side} — ${thrower}`);
    } else {
      this.turnText.setText(state.isComplete ? '' : 'Waiting for players');
    }

    // The chip is sized to the text so a four-name side and a solo player both sit in it neatly.
    this.turnChip.clear();
    if (this.turnText.text.length > 0) {
      const padX = 16;
      const w = this.turnText.width + padX * 2;
      const h = 30;
      const x = this.width / 2 - w / 2;
      const y = this.headerHeight / 2 - h / 2;
      this.turnChip.fillStyle(mix(HEADER_BG, colour, 0.32), 1);
      this.turnChip.fillRoundedRect(x, y, w, h, 15);
      this.turnChip.lineStyle(2, colour, 0.9);
      this.turnChip.strokeRoundedRect(x, y, w, h, 15);
    }
    this.slotTexts.forEach((text, i) => {
      const dart = state.currentVisitThrows[i];
      text.setText(dart ? notationFor(dart) : '·');
      text.setColor(cssColour(dart ? INK : MUTED));
    });
  }

  /**
   * Says what a dart just did. Returns how long the caller should wait — the queue paces the whole
   * board off the animation, and the words have to stay up at least as long as it runs.
   */
  announce(text: string, sub: string, colour: number, duration: number): number {
    this.bannerTween?.stop();

    this.bannerText.setText(text).setColor(cssColour(colour)).setAlpha(0).setScale(0.92);
    this.bannerSub.setText(sub).setAlpha(0);

    const width = Math.max(this.bannerText.width, this.bannerSub.width) + 56;
    const height = (sub ? 74 : 52) + 4;
    this.bannerBg.clear();
    this.bannerBg.fillStyle(0x0b111a, 0.86);
    this.bannerBg.fillRoundedRect(this.width / 2 - width / 2, this.bannerY - 30, width, height, 12);
    this.bannerBg.lineStyle(2, colour, 0.75);
    this.bannerBg.strokeRoundedRect(this.width / 2 - width / 2, this.bannerY - 30, width, height, 12);

    const targets = [this.bannerBg, this.bannerText, this.bannerSub];
    this.bannerTween = this.scene.tweens.add({
      targets,
      alpha: 1,
      duration: 130,
      ease: 'Quad.Out',
      onComplete: () => {
        this.bannerTween = this.scene.tweens.add({
          targets,
          alpha: 0,
          delay: Math.max(120, duration - 120),
          duration: 220,
          ease: 'Quad.In',
        });
      },
    });
    this.scene.tweens.add({
      targets: this.bannerText,
      scale: { from: 0.92, to: 1 },
      duration: 220,
      ease: 'Back.Out',
    });

    return duration;
  }

  clearBanner(): void {
    this.bannerTween?.stop();
    this.bannerTween = null;
    this.bannerBg.setAlpha(0);
    this.bannerText.setAlpha(0);
    this.bannerSub.setAlpha(0);
  }

  showVictory(title: string, sub: string, colour: number): void {
    this.overlay.setVisible(true).setAlpha(0);
    this.overlayTitle.setText(title).setColor(cssColour(colour)).setVisible(true).setAlpha(0).setFontSize(42);
    this.overlaySub.setText(sub).setVisible(true).setAlpha(0);
    this.drawOverlayPanel(colour);
    this.overlayPanel.setVisible(true).setAlpha(0);
    this.scene.tweens.add({
      targets: [this.overlay, this.overlayPanel, this.overlayTitle, this.overlaySub],
      alpha: 1,
      duration: 420,
      ease: 'Quad.Out',
    });
    this.scene.tweens.add({
      targets: this.overlayTitle,
      scale: { from: 0.7, to: 1 },
      duration: 520,
      ease: 'Back.Out',
    });
  }

  hideVictory(): void {
    this.overlay.setVisible(false);
    this.overlayPanel.setVisible(false);
    this.overlayTitle.setVisible(false);
    this.overlaySub.setVisible(false);
  }

  /** A roster this game can't be played with — said plainly rather than rendered as a broken board. */
  showConfigError(message: string): void {
    this.overlay.setVisible(true).setAlpha(1);
    this.overlayTitle.setText('Can’t start').setColor(cssColour(INK)).setVisible(true).setAlpha(1).setFontSize(30);
    this.overlaySub.setText(message).setVisible(true).setAlpha(1);
    this.drawOverlayPanel(MUTED);
    this.overlayPanel.setVisible(true).setAlpha(1);
  }

  destroy(): void {
    this.bannerTween?.stop();
    [
      this.headerBar,
      this.wordmark,
      this.roundLabel,
      this.turnChip,
      this.turnText,
      this.slotBoxes,
      this.bannerBg,
      this.bannerText,
      this.bannerSub,
      this.overlay,
      this.overlayPanel,
      this.overlayTitle,
      this.overlaySub,
      ...this.slotTexts,
    ].forEach((object) => object.destroy());
  }
}
