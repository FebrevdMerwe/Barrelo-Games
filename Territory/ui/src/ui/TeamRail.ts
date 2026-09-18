import Phaser from 'phaser';
import type { GameState, Team } from '../rules.ts';
import { colourForIndex, cssColour, DEAD_COLOUR, GOLD, INK, mix, MUTED } from './teams.ts';

/**
 * The side rail: one card per side, showing the only number that decides this game — how many
 * territories they still hold — plus whether their Home is still theirs.
 *
 * Territory count is what a player checks to know who is winning and who is one dart from being out,
 * so it is the biggest thing on the card. Home gets its own line because losing it is the moment
 * that changes how a side plays, even though it costs them no more than any other territory.
 */

const CARD_RADIUS = 10;
const CARD_GAP = 10;

interface Card {
  teamId: string;
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  thrower: Phaser.GameObjects.Text;
  count: Phaser.GameObjects.Text;
  countCaption: Phaser.GameObjects.Text;
  home: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  lastCount: number;
  width: number;
  height: number;
}

export class TeamRail {
  private readonly scene: Phaser.Scene;
  private readonly root: Phaser.GameObjects.Container;
  private readonly cards = new Map<string, Card>();
  /** The box the rail was last laid out into, kept so a card added later can be placed into it. */
  private area = { width: 240, height: 400 };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.root = scene.add.container(0, 0);
  }

  private buildCard(team: Team): Card {
    const scene = this.scene;
    const background = scene.add.graphics();

    const name = scene.add
      .text(0, 0, '', { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '15px', color: cssColour(INK) })
      .setOrigin(0, 0.5);
    const thrower = scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '11px', color: cssColour(MUTED) })
      .setOrigin(0, 0.5);
    const count = scene.add
      .text(0, 0, '0', { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '30px', color: cssColour(INK) })
      .setOrigin(1, 0.5);
    const countCaption = scene.add
      .text(0, 0, 'LAND', { fontFamily: 'Arial', fontSize: '9px', color: cssColour(MUTED) })
      .setOrigin(1, 0.5);
    const home = scene.add
      .text(0, 0, '', { fontFamily: 'Arial', fontSize: '11px', color: cssColour(GOLD) })
      .setOrigin(0, 0.5);
    const status = scene.add
      .text(0, 0, '', { fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '12px', color: cssColour(INK) })
      .setOrigin(1, 0.5);

    const container = scene.add.container(0, 0, [
      background,
      name,
      thrower,
      count,
      countCaption,
      home,
      status,
    ]);
    this.root.add(container);

    return {
      teamId: team.id,
      container,
      background,
      name,
      thrower,
      count,
      countCaption,
      home,
      status,
      lastCount: -1,
      width: this.area.width,
      height: 86,
    };
  }

  /** Positions the rail. The cards themselves are sized by arrange(), which also runs whenever a
   *  side is added — the first snapshot arrives after the first layout, so a card created later
   *  still has to be given somewhere to sit. */
  layout(x: number, y: number, width: number, height: number): void {
    this.area = { width, height };
    this.root.setPosition(x, y);
    this.arrange();
  }

  /** Stacks the cards down the rail, splitting the height available between however many there are. */
  private arrange(): void {
    const count = Math.max(1, this.cards.size);
    const cardHeight = Phaser.Math.Clamp(
      (this.area.height - CARD_GAP * (count - 1)) / count,
      66,
      132
    );

    let index = 0;
    for (const card of this.cards.values()) {
      card.width = this.area.width;
      card.height = cardHeight;
      card.container.setPosition(0, index * (cardHeight + CARD_GAP));
      this.placeCard(card);
      index++;
    }
  }

  private placeCard(card: Card): void {
    const { width, height } = card;
    const pad = 14;
    const bar = 6;

    card.name.setPosition(pad + bar, height * 0.28);
    card.thrower.setPosition(pad + bar, height * 0.28 + 17);
    card.count.setPosition(width - pad, height * 0.32);
    card.countCaption.setPosition(width - pad, height * 0.32 + 21);
    card.home.setPosition(pad + bar, height - pad - 6);
    card.status.setPosition(width - pad, height - pad - 6);

    card.count.setFontSize(Phaser.Math.Clamp(Math.round(height * 0.36), 20, 38));
    card.name.setFontSize(Phaser.Math.Clamp(Math.round(height * 0.18), 12, 18));
  }

  private drawCard(card: Card, colour: number, active: boolean, eliminated: boolean): void {
    const g = card.background;
    const { width, height } = card;
    g.clear();

    const base = eliminated ? 0x151b23 : mix(0x151b23, colour, active ? 0.3 : 0.18);
    g.fillStyle(base, 1);
    g.fillRoundedRect(0, 0, width, height, CARD_RADIUS);

    g.lineStyle(active ? 3 : 1.5, eliminated ? DEAD_COLOUR : colour, active ? 1 : 0.55);
    g.strokeRoundedRect(0, 0, width, height, CARD_RADIUS);

    // The colour bar is the card's tie to its ground on the map — same hue, no label needed.
    g.fillStyle(eliminated ? DEAD_COLOUR : colour, 1);
    g.fillRoundedRect(0, 0, 6, height, { tl: CARD_RADIUS, tr: 0, bl: CARD_RADIUS, br: 0 });
  }

  render(state: GameState, playerNames: Record<string, string>, labelOf: (team: Team) => string): void {
    // Cards are keyed by team id and inserted in team order, so the Map's iteration order — which is
    // what arrange() stacks them in — is the same order the map colours the sides in.
    let changed = false;
    for (const team of state.teams) {
      if (!this.cards.has(team.id)) {
        this.cards.set(team.id, this.buildCard(team));
        changed = true;
      }
    }

    // A side that is no longer on the roster loses its card. Barrelo never changes a roster
    // mid-match, but the dev harness switches between them, and a stale card left behind reads as a
    // phantom opponent that can never throw.
    const live = new Set(state.teams.map((team) => team.id));
    for (const [teamId, card] of this.cards) {
      if (live.has(teamId)) continue;
      card.container.destroy();
      this.cards.delete(teamId);
      changed = true;
    }

    if (changed) this.arrange();

    for (const team of state.teams) {
      const card = this.cards.get(team.id)!;

      const colour = colourForIndex(team.index);
      const eliminated = state.isEliminated[team.id] === true;
      const active = !eliminated && team.id === state.currentTeamId;
      const count = state.territoryCount[team.id] ?? 0;

      this.drawCard(card, colour, active, eliminated);
      card.name.setText(labelOf(team)).setColor(cssColour(eliminated ? MUTED : INK));

      const throwerId = active ? state.currentPlayerId : null;
      const showThrower = throwerId !== null && team.playerIds.length > 1;
      card.thrower
        .setText(showThrower ? `▶ ${playerNames[throwerId] ?? 'Player'} to throw` : '')
        .setVisible(showThrower);

      card.count.setText(String(count)).setColor(cssColour(eliminated ? MUTED : INK));
      card.countCaption.setText(count === 1 ? 'TERRITORY' : 'TERRITORIES').setColor(cssColour(MUTED));

      const home = state.territories[team.homeTerritoryId];
      const holdsHome = home?.ownerId === team.id;
      card.home
        .setText(holdsHome ? `★ Home ${team.homeTerritoryId}` : `Home ${team.homeTerritoryId} lost`)
        .setColor(cssColour(holdsHome ? GOLD : MUTED));

      if (eliminated) card.status.setText('OUT').setColor(cssColour(MUTED));
      else if (state.winnerTeamId === team.id) card.status.setText('WINNER').setColor(cssColour(GOLD));
      else card.status.setText('');

      card.container.setAlpha(eliminated ? 0.55 : 1);

      // A count that moved gets a beat of its own — it is the number the whole game is played on.
      if (card.lastCount !== -1 && card.lastCount !== count) {
        this.scene.tweens.add({
          targets: card.count,
          scale: { from: 1.45, to: 1 },
          duration: 320,
          ease: 'Back.Out',
        });
      }
      card.lastCount = count;
    }
  }

  destroy(): void {
    this.root.destroy(true);
    this.cards.clear();
  }
}
