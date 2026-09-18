import Phaser from 'phaser';
import type { Rect } from '../holes';
import { formatVsPar } from './Scorecard';

const CARD_BG = 0x16241c;
const CARD_EDGE = 0x3c5a48;
const TEXT = '#e9f0e6';
const MUTED = '#8fa895';
const UNDER = '#8ddba0';
const OVER = '#e8a08f';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Above the header and the rail — this is a modal moment, however brief. */
const POPUP_DEPTH = 60;

const CARD_W = 300;
const CARD_H = 186;

const IN_MS = 220;
const OUT_MS = 200;

export interface ScoreCardResult {
  /** The side that finished — a team label, which for a team of one is just the player's name. */
  name: string;
  colour: number;
  /** Score taken on the hole — strokes for a hole-out, the cap for a pick-up. */
  score: number;
  par: number;
  /** 1-based, as players count them. */
  holeNumber: number;
  /** Strokes taken across every hole finished so far, including this one. */
  total: number;
  /** Those strokes measured against the par of the same holes. */
  vsPar: number;
  pickedUp: boolean;
}

/**
 * The name a golfer would give the score, which is the part people actually react to. Anything worse
 * than a triple is left as a bare number — there is no common word for it and "quadruple bogey" on a
 * par 3 is just a pick-up in waiting.
 */
export function scoreTerm(result: ScoreCardResult): string {
  if (result.pickedUp) return 'PICKED UP';
  if (result.score === 1) return 'HOLE IN ONE';

  switch (result.score - result.par) {
    case -3:
      return 'ALBATROSS';
    case -2:
      return 'EAGLE';
    case -1:
      return 'BIRDIE';
    case 0:
      return 'PAR';
    case 1:
      return 'BOGEY';
    case 2:
      return 'DOUBLE BOGEY';
    case 3:
      return 'TRIPLE BOGEY';
    default:
      return `+${result.score - result.par}`;
  }
}

function relativeColour(diff: number): string {
  return diff < 0 ? UNDER : diff > 0 ? OVER : TEXT;
}

export interface ScorePopupHandle {
  /** Resolves when the card has faded out, however it was taken down — never rejects. */
  done: Promise<void>;
  /** Fade the card out from wherever it is. The graceful exit, used when End Turn arrives. */
  dismiss: () => void;
  /** Kill it on the spot, no fade. The resync exit. */
  abort: () => void;
}

/**
 * The card that announces a side's score on a hole.
 *
 * It goes up once the player has thrown their last dart, not the instant the ball drops, and by
 * default it comes down on a cue rather than a timer — the darts being pulled. A resync can still
 * abort it cleanly, so it can never be left stranded over a board that has moved on.
 */
export class ScorePopup {
  private container: Phaser.GameObjects.Container | null = null;
  private tween: Phaser.Tweens.Tween | null = null;
  private timer: Phaser.Time.TimerEvent | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Shows the card over `area`, resolving once it has faded back out.
   *
   * `holdMs` is how long it sits there before fading on its own; pass null to hold it indefinitely,
   * in which case only dismiss() or abort() takes it down.
   */
  show(result: ScoreCardResult, area: Rect, holdMs: number | null): ScorePopupHandle {
    this.clear();

    const centreX = area.x + area.w / 2;
    const centreY = area.y + area.h / 2;
    const container = this.scene.add.container(centreX, centreY);
    container.setDepth(POPUP_DEPTH);
    this.container = container;

    const left = -CARD_W / 2;
    const top = -CARD_H / 2;

    const card = this.scene.add.graphics();
    card.fillStyle(0x000000, 0.45);
    card.fillRoundedRect(left + 4, top + 8, CARD_W, CARD_H, 16);
    card.fillStyle(CARD_BG, 0.97);
    card.fillRoundedRect(left, top, CARD_W, CARD_H, 16);
    card.lineStyle(2, CARD_EDGE, 1);
    card.strokeRoundedRect(left, top, CARD_W, CARD_H, 16);
    // A band in the side's colour, so whose card this is reads before any of the text does.
    card.fillStyle(result.colour, 1);
    card.fillRoundedRect(left, top, CARD_W, 6, { tl: 16, tr: 16, bl: 0, br: 0 });
    container.add(card);

    container.add(this.scene.add.circle(left + 22, top + 32, 7, result.colour));

    container.add(
      this.scene.add
        .text(left + 38, top + 32, result.name, {
          fontFamily: FONT,
          fontSize: '17px',
          color: TEXT,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5)
    );

    container.add(
      this.scene.add
        .text(CARD_W / 2 - 22, top + 32, `HOLE ${result.holeNumber}`, {
          fontFamily: FONT,
          fontSize: '12px',
          color: MUTED,
        })
        .setOrigin(1, 0.5)
    );

    container.add(
      this.scene.add
        .text(0, top + 82, `${result.score}`, {
          fontFamily: FONT,
          fontSize: '56px',
          color: relativeColour(result.score - result.par),
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0.5)
    );

    container.add(
      this.scene.add
        .text(0, top + 122, scoreTerm(result), {
          fontFamily: FONT,
          fontSize: '20px',
          color: relativeColour(result.score - result.par),
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0.5)
    );

    container.add(
      this.scene.add
        .text(0, top + 146, `par ${result.par}`, {
          fontFamily: FONT,
          fontSize: '12px',
          color: MUTED,
        })
        .setOrigin(0.5, 0.5)
    );

    const rule = this.scene.add.graphics();
    rule.lineStyle(1, CARD_EDGE, 1);
    rule.lineBetween(left + 18, top + 160, left + CARD_W - 18, top + 160);
    container.add(rule);

    // The running card, so finishing a hole is also when the total visibly moves.
    container.add(
      this.scene.add
        .text(left + 18, top + 172, `Total ${result.total}`, {
          fontFamily: FONT,
          fontSize: '13px',
          color: TEXT,
        })
        .setOrigin(0, 0.5)
    );

    container.add(
      this.scene.add
        .text(left + CARD_W - 18, top + 172, formatVsPar(result.vsPar), {
          fontFamily: FONT,
          fontSize: '13px',
          color: relativeColour(result.vsPar),
          fontStyle: 'bold',
        })
        .setOrigin(1, 0.5)
    );

    container.setScale(0.82);
    container.setAlpha(0);

    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = () => {
        // Only tear down if this card is still the one on screen — a later show() owns it by then.
        if (this.container === container) this.clear();
        resolve();
      };
    });

    // The fade-out, reached either by the hold expiring or by dismiss(). Whichever gets there first
    // wins; the second caller finds `leaving` already set and leaves the tween alone.
    let leaving = false;
    const leave = (): void => {
      if (leaving || this.container !== container) return;
      leaving = true;
      this.tween?.remove();
      this.timer?.remove(false);
      this.timer = null;
      this.tween = this.scene.tweens.add({
        targets: container,
        alpha: 0,
        scale: 0.94,
        duration: OUT_MS,
        ease: 'Sine.easeIn',
        onComplete: () => settle(),
      });
    };

    this.tween = this.scene.tweens.add({
      targets: container,
      scale: 1,
      alpha: 1,
      duration: IN_MS,
      ease: 'Back.easeOut',
      onComplete: () => {
        if (holdMs !== null) this.timer = this.scene.time.delayedCall(holdMs, leave);
      },
    });

    return {
      done,
      // A card already gone — cleared out from under us — has nothing left to fade, so settle it.
      dismiss: () => (this.container === container ? leave() : settle()),
      abort: () => settle(),
    };
  }

  /** Re-centres a card that is still up. Only matters for a held card, which outlives a resize. */
  reposition(area: Rect): void {
    this.container?.setPosition(area.x + area.w / 2, area.y + area.h / 2);
  }

  clear(): void {
    this.tween?.remove();
    this.tween = null;
    this.timer?.remove(false);
    this.timer = null;
    this.container?.destroy(true);
    this.container = null;
  }

  destroy(): void {
    this.clear();
  }
}
