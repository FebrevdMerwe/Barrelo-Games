import Phaser from 'phaser';
import type { GameState, Team } from '../rules';
import { colorOf, cssColorOf, nameOf } from './teams';

/**
 * The rail down the left of the screen: who is playing, how many each has banked, how many are
 * still loose, and whose turn it is.
 *
 * Drawn in SCREEN space, not field space, so it stays legible whatever the paddock is scaled to.
 * It is rebuilt wholesale on every state change rather than diffed — it is a dozen text objects,
 * and a rebuild cannot drift out of step with the state the way a partial update can.
 */

const PANEL_W = 300;

export class Scoreboard {
  private readonly layer: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    this.layer = scene.add.container(0, 0).setScrollFactor(0).setDepth(1000);
  }

  destroy(): void {
    this.layer.destroy();
  }

  render(state: GameState, playerNames: Record<string, string>): void {
    this.layer.removeAll(true);

    const panel = this.scene.add.graphics();
    panel.fillStyle(0x14110e, 0.72);
    panel.fillRoundedRect(16, 16, PANEL_W, 92 + state.teams.length * 74, 12);
    this.layer.add(panel);

    const solo = state.teams.length === 1;
    const heading = solo
      ? `${state.flock.length} loose  ·  ${state.dartsBy[state.teams[0].id] ?? 0} darts`
      : `${state.flock.length} sheep still loose`;

    this.layer.add(
      this.scene.add
        .text(36, 36, state.phase === 'suddenDeath' ? 'SUDDEN DEATH' : 'HERD THE SHEEP', {
          fontFamily: 'Georgia, serif',
          fontSize: '20px',
          color: state.phase === 'suddenDeath' ? '#d9b23d' : '#e9e4d6',
        })
        .setOrigin(0, 0)
    );
    this.layer.add(
      this.scene.add
        .text(36, 62, heading, { fontFamily: 'monospace', fontSize: '14px', color: '#9a917f' })
        .setOrigin(0, 0)
    );

    state.teams.forEach((team, i) => {
      const y = 104 + i * 74;
      const throwing = team.id === state.currentTeamId;
      // A team knocked out of the tie-break is still on the board, just visibly out of it.
      const contesting =
        state.phase !== 'suddenDeath' || state.suddenDeathTeamIds.includes(team.id);

      const row = this.scene.add.graphics();
      row.fillStyle(colorOf(team), throwing ? 0.28 : 0.12);
      row.fillRoundedRect(30, y - 8, PANEL_W - 28, 62, 8);
      if (throwing) {
        row.lineStyle(3, colorOf(team), 1);
        row.strokeRoundedRect(30, y - 8, PANEL_W - 28, 62, 8);
      }
      this.layer.add(row);

      this.layer.add(
        this.scene.add.text(46, y, nameOf(team, playerNames), {
          fontFamily: 'Georgia, serif',
          fontSize: '19px',
          color: contesting ? cssColorOf(team) : '#6d675c',
        })
      );

      this.layer.add(
        this.scene.add
          .text(PANEL_W - 4, y - 4, String(state.pennedBy[team.id] ?? 0), {
            fontFamily: 'Georgia, serif',
            fontSize: '34px',
            color: contesting ? '#e9e4d6' : '#6d675c',
          })
          .setOrigin(1, 0)
      );

      this.layer.add(
        this.scene.add.text(46, y + 26, this.subtitle(state, team, playerNames), {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#9a917f',
        })
      );
    });

    if (state.configError) this.banner(state.configError, '#d97a3d');
    else if (state.isComplete) this.banner(this.victoryText(state, playerNames), '#d9b23d');
  }

  /** The thrower within a team, or the team's darts-used once there is nothing left to say. */
  private subtitle(state: GameState, team: Team, playerNames: Record<string, string>): string {
    if (team.id === state.currentTeamId && team.playerIds.length > 1) {
      return `throwing: ${playerNames[state.currentPlayerId ?? ''] ?? 'Player'}`;
    }
    return `${state.dartsBy[team.id] ?? 0} darts`;
  }

  private victoryText(state: GameState, playerNames: Record<string, string>): string {
    const winners = state.teams.filter((t) => state.winnerTeamIds.includes(t.id));
    if (winners.length === 0) return 'Match over';
    const label = winners.map((t) => nameOf(t, playerNames)).join(' & ');
    if (state.teams.length === 1) {
      return `Flock cleared in ${state.dartsBy[state.teams[0].id] ?? 0} darts`;
    }
    return `${label} wins`;
  }

  private banner(text: string, color: string): void {
    const { width } = this.scene.scale;
    const label = this.scene.add
      .text(width / 2, 46, text, {
        fontFamily: 'Georgia, serif',
        fontSize: '30px',
        color,
        backgroundColor: '#14110ecc',
        padding: { x: 22, y: 12 },
      })
      .setOrigin(0.5, 0);
    this.layer.add(label);
  }
}
