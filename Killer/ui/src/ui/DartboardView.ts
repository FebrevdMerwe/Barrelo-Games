import Phaser from 'phaser';
import { getRingRadii, WEDGE_ORDER } from '../dartboard';
import { colourForIndex } from './playerColours';
import type { DetectedThrow } from '../../../shared/types';

const SINGLE_COLORS = [0x1a1a1a, 0xe8dcc0];
const DOUBLE_TRIPLE_COLORS = [0xdc2626, 0x16a34a];
const DEFAULT_COLOR = 0xe8dcc0;
const GREY_COLOR = 0x6b7280;
const GOLD = 0xd4af37;
const MARKER_COLOR = 0xfacc15;
const DARTS_PER_TURN = 3;

function toCss(colour: number): string {
  return '#' + colour.toString(16).padStart(6, '0');
}

export interface NumberOwnership {
  colourIndex: number;
  lives: number;
  isKiller: boolean;
  isCurrentPlayer: boolean;
}

interface NumberVisualState {
  labelColor: number;
  glowVisible: boolean;
  glowColor: number;
  glowAlpha: number;
  ringVisible: boolean;
  pulsing: boolean;
}

/** Precedence: eliminated (grey) > killer-gold ring > active pulse > normal personal colour. */
function computeNumberVisualState(owner: NumberOwnership | undefined): NumberVisualState {
  if (!owner) {
    return { labelColor: DEFAULT_COLOR, glowVisible: false, glowColor: DEFAULT_COLOR, glowAlpha: 0, ringVisible: false, pulsing: false };
  }
  if (owner.lives <= 0) {
    return { labelColor: GREY_COLOR, glowVisible: true, glowColor: GREY_COLOR, glowAlpha: 0.15, ringVisible: false, pulsing: false };
  }
  const colour = colourForIndex(owner.colourIndex);
  return {
    labelColor: colour,
    glowVisible: true,
    glowColor: colour,
    glowAlpha: owner.isCurrentPlayer ? 0.55 : 0.35,
    ringVisible: owner.isKiller,
    pulsing: owner.isCurrentPlayer,
  };
}

interface NumberHighlight {
  wedgeValue: number;
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  glow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  pulseTween: Phaser.Tweens.Tween | null;
}

/**
 * Owns the dartboard's procedural wedge mesh, the 20 persistent per-number highlight handles
 * (colour-coded glow + killer gold ring + active pulse), and the recent-throw marker pool.
 * Everything here is created once and updated in place — never destroyed/rebuilt.
 */
export class DartboardView {
  private scene: Phaser.Scene;
  private boardContainer: Phaser.GameObjects.Container;
  private boardGraphics: Phaser.GameObjects.Graphics;
  private highlights: NumberHighlight[] = [];
  private markers: Phaser.GameObjects.Arc[] = [];
  private geo = { centerX: 0, centerY: 0, radius: 60 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Tweening a Graphics object's x/y directly leaves a rendering artifact in this Phaser
    // version (a stray line persists across frames) — wrapping it in a Container and tweening
    // the container's position instead avoids that, same as every other animated element here.
    this.boardGraphics = scene.add.graphics();
    this.boardContainer = scene.add.container(0, 0, [this.boardGraphics]);
    this.buildNumberHighlights();
    this.buildMarkerPool();
  }

  private buildNumberHighlights() {
    for (let i = 0; i < WEDGE_ORDER.length; i++) {
      const container = this.scene.add.container(0, 0);
      const glow = this.scene.add.image(0, 0, 'board_number_glow').setDisplaySize(46, 46).setVisible(false);
      const ring = this.scene.add.image(0, 0, 'board_number_ring').setDisplaySize(52, 52).setTint(GOLD).setVisible(false);
      const label = this.scene.add
        .text(0, 0, String(WEDGE_ORDER[i]), { fontFamily: 'Arial', fontSize: '16px', color: toCss(DEFAULT_COLOR) })
        .setOrigin(0.5);
      container.add([glow, ring, label]);
      this.highlights.push({ wedgeValue: WEDGE_ORDER[i], container, label, glow, ring, pulseTween: null });
    }
  }

  private buildMarkerPool() {
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      const marker = this.scene.add.circle(0, 0, 4, MARKER_COLOR).setStrokeStyle(1, 0x000000).setVisible(false);
      this.markers.push(marker);
    }
  }

  /** Recomputes everything that depends on window size: redraws the wedge mesh, repositions highlights/markers. */
  layout(centerX: number, centerY: number, radius: number) {
    this.geo = { centerX, centerY, radius };
    this.drawBoard(centerX, centerY, radius);

    for (let i = 0; i < this.highlights.length; i++) {
      const thetaRad = Phaser.Math.DegToRad(i * 18);
      const labelRadius = radius + 22;
      const x = centerX + labelRadius * Math.sin(thetaRad);
      const y = centerY - labelRadius * Math.cos(thetaRad);
      this.highlights[i].container.setPosition(x, y);
    }
  }

  private drawBoard(centerX: number, centerY: number, radius: number) {
    const g = this.boardGraphics;
    g.clear();
    const radii = getRingRadii(radius);

    for (let i = 0; i < WEDGE_ORDER.length; i++) {
      const startDeg = i * 18 - 9 - 90;
      const endDeg = i * 18 + 9 - 90;
      const start = Phaser.Math.DegToRad(startDeg);
      const end = Phaser.Math.DegToRad(endDeg);
      const parity = i % 2;

      this.drawRingSegment(g, 0, radii.tripleInner, start, end, SINGLE_COLORS[parity]);
      this.drawRingSegment(g, radii.tripleInner, radii.tripleOuter, start, end, DOUBLE_TRIPLE_COLORS[parity]);
      this.drawRingSegment(g, radii.tripleOuter, radii.doubleInner, start, end, SINGLE_COLORS[parity]);
      this.drawRingSegment(g, radii.doubleInner, radii.doubleOuter, start, end, DOUBLE_TRIPLE_COLORS[parity]);
    }

    g.fillStyle(0x16a34a, 1);
    g.fillCircle(0, 0, radii.bullOuter);
    g.fillStyle(0xdc2626, 1);
    g.fillCircle(0, 0, radii.bullInner);

    g.lineStyle(3, 0x3f3f46, 1);
    g.strokeCircle(0, 0, radii.doubleOuter);

    this.boardContainer.setPosition(centerX, centerY);
  }

  private drawRingSegment(
    g: Phaser.GameObjects.Graphics,
    innerR: number,
    outerR: number,
    startRad: number,
    endRad: number,
    color: number
  ) {
    g.fillStyle(color, 1);
    g.beginPath();
    if (innerR <= 0) {
      g.moveTo(0, 0);
      g.arc(0, 0, outerR, startRad, endRad, false);
    } else {
      g.arc(0, 0, outerR, startRad, endRad, false);
      g.arc(0, 0, innerR, endRad, startRad, true);
    }
    g.closePath();
    g.fillPath();
  }

  /** ownership maps a wedge value (1-20) to the player who owns it, for the up-to-6 assigned numbers. */
  updateOwnership(ownership: Map<number, NumberOwnership>) {
    for (const h of this.highlights) {
      const state = computeNumberVisualState(ownership.get(h.wedgeValue));
      h.label.setColor(toCss(state.labelColor));
      h.glow.setVisible(state.glowVisible).setTint(state.glowColor).setAlpha(state.glowAlpha);
      h.ring.setVisible(state.ringVisible);
      this.setPulsing(h, state.pulsing);
    }
  }

  private setPulsing(h: NumberHighlight, pulsing: boolean) {
    if (pulsing && !h.pulseTween) {
      h.pulseTween = this.scene.tweens.add({
        targets: h.container,
        scale: 1.18,
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else if (!pulsing && h.pulseTween) {
      h.pulseTween.stop();
      h.pulseTween = null;
      h.container.setScale(1);
    }
  }

  /** Marks where the current visit's darts landed. The pool holds DARTS_PER_TURN markers, so a visit
   *  that ran long (Barrelo does not cap one at three) shows only its first three. */
  updateMarkers(currentVisitThrows: DetectedThrow[]) {
    const { centerX, centerY, radius } = this.geo;

    for (let i = 0; i < this.markers.length; i++) {
      const t = currentVisitThrows[i];
      const marker = this.markers[i];
      if (!t) {
        marker.setVisible(false);
        continue;
      }
      // BoardPosition is normalized board-space: origin at the bullseye, +Y up, magnitude 1.0 is
      // the outer edge of the double ring — independent of this scene's pixel scale.
      const x = centerX + t.position.x * radius;
      const y = centerY - t.position.y * radius;
      marker.setPosition(x, y).setVisible(true);
    }
  }

  hideMarkers() {
    this.markers.forEach((m) => m.setVisible(false));
  }

  /** Converts normalized board-space (origin at the bullseye, +Y up, 1.0 = outer double edge) to screen pixels. */
  toScreenPosition(pos: { x: number; y: number }): { x: number; y: number } {
    const { centerX, centerY, radius } = this.geo;
    return { x: centerX + pos.x * radius, y: centerY - pos.y * radius };
  }

  /** A brief jitter on just the wedge mesh (not the cabinet/cards) so a throw impact feels physical. */
  shake() {
    const { centerX, centerY } = this.geo;
    this.scene.tweens.add({
      targets: this.boardContainer,
      x: centerX + Phaser.Math.Between(-4, 4),
      y: centerY + Phaser.Math.Between(-3, 3),
      duration: 35,
      yoyo: true,
      repeat: 3,
      onComplete: () => this.boardContainer.setPosition(centerX, centerY),
    });
  }
}
