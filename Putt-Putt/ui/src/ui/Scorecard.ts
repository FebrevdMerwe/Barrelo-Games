import Phaser from 'phaser';
import { parThrough, type GameState, type Team } from '../rules';
import type { Rect } from '../holes';
import { colourForTeam, cssColour, teamLabel } from './teams';

const PANEL_BG = 0x14201a;
const PANEL_EDGE = 0x2e4436;
const TEXT = '#e9f0e6';
const MUTED = '#8fa895';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * The HUD sits above the course on its own depth band rather than relying on being added to the
 * display list last. Two levels, because the turn banner has to be measured before the pill behind
 * it can be sized — so its text is necessarily created before its background.
 */
const PANEL_DEPTH = 10;
const CONTENT_DEPTH = 11;

/** Running score against par, in the form golfers actually read it. */
export function formatVsPar(value: number): string {
  if (value === 0) return 'E';
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * The header strip and the team rail — everything on screen that isn't the course itself.
 *
 * A row is a side, not a player: one ball, one score, one line. In a solo match every side has one
 * member and the rail reads exactly as a player list, which is the point — there is no separate solo
 * layout to keep in step.
 *
 * Both are rebuilt wholesale on every render rather than diffed. There are at most eight rows and
 * renders only happen when Barrelo pushes a state change, so the simplicity is worth more than the
 * allocations it costs.
 */
export class Scorecard {
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  render(
    state: GameState,
    playerNames: Record<string, string>,
    header: Rect,
    rail: Rect
  ): void {
    this.clear();

    this.drawHeader(state, playerNames, header);
    this.drawRail(state, playerNames, rail);
  }

  clear(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }

  destroy(): void {
    this.clear();
  }

  // -------------------------------------------------------------------------------------------

  private track<T extends Phaser.GameObjects.GameObject>(object: T, depth = CONTENT_DEPTH): T {
    // Graphics and Text both carry setDepth; the generic is wider than that, hence the cast.
    (object as unknown as { setDepth(value: number): void }).setDepth(depth);
    this.objects.push(object);
    return object;
  }

  private text(
    x: number,
    y: number,
    content: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
    originX = 0,
    originY = 0.5
  ): Phaser.GameObjects.Text {
    return this.track(
      this.scene.add.text(x, y, content, { fontFamily: FONT, ...style }).setOrigin(originX, originY)
    );
  }

  private drawHeader(
    state: GameState,
    playerNames: Record<string, string>,
    header: Rect
  ): void {
    const panel = this.track(this.scene.add.graphics(), PANEL_DEPTH);
    panel.fillStyle(PANEL_BG, 1);
    panel.fillRect(header.x, header.y, header.w, header.h);
    panel.lineStyle(1, PANEL_EDGE, 1);
    panel.lineBetween(header.x, header.y + header.h, header.x + header.w, header.y + header.h);

    const hole = state.course[Math.min(state.holeIndex, state.course.length - 1)];
    const played = Math.min(state.holeIndex + 1, state.course.length);
    const midY = header.y + header.h / 2;

    this.text(
      header.x + 16,
      midY - 9,
      state.isComplete ? 'ROUND COMPLETE' : `HOLE ${played} / ${state.course.length}`,
      { fontSize: '17px', color: TEXT, fontStyle: 'bold' }
    );

    this.text(
      header.x + 16,
      midY + 11,
      state.isComplete
        ? `${state.course.length} holes  ·  par ${state.course.reduce((s, h) => s + h.par, 0)}`
        : `${hole?.name ?? ''}  ·  par ${hole?.par ?? 0}`,
      { fontSize: '12px', color: MUTED }
    );

    if (state.configError) {
      this.text(header.x + header.w - 16, midY, state.configError, {
        fontSize: '14px',
        color: '#f2a6a0',
      }, 1);
      return;
    }

    if (state.isComplete) {
      const winners = state.winnerTeamIds
        .map((id) => teamLabel(this.teamById(state, id), playerNames))
        .join(' & ');
      this.drawBanner(
        header,
        winners || 'Nobody',
        state.winnerTeamIds.length > 1 ? 'JOINT WINNERS' : 'WINNER',
        colourForTeam(this.teamById(state, state.winnerTeamIds[0]))
      );
      return;
    }

    if (state.currentTeamId) {
      const team = this.teamById(state, state.currentTeamId);
      const strokes = state.strokes[state.currentTeamId] ?? 0;
      const shot = strokes === 0 ? 'TO TEE OFF' : `TO PUTT  ·  SHOT ${strokes + 1}`;
      // Whose stroke it is only needs saying when a side has more than one member; on a solo row the
      // name in the pill already answers it.
      const striker = (playerNames[state.currentPlayerId ?? ''] ?? '').toUpperCase();
      const caption = (team?.playerIds.length ?? 1) > 1 && striker ? `${striker}  ${shot}` : shot;

      this.drawBanner(header, teamLabel(team, playerNames), caption, colourForTeam(team));
    }
  }

  /**
   * The turn indicator: a pill in the active side's ball colour, right-aligned in the header. It is
   * deliberately the loudest thing on the strip — on a board across a room, "are we up, and is it my
   * stroke?" are the two questions the HUD has to answer instantly.
   */
  private drawBanner(header: Rect, name: string, caption: string, colour: number): void {
    const midY = header.y + header.h / 2;
    const right = header.x + header.w - 16;

    // Created before the pill so their widths can size it; PANEL_DEPTH keeps the pill behind them.
    const nameText = this.text(0, midY - 8, name, {
      fontSize: '18px',
      color: TEXT,
      fontStyle: 'bold',
    });
    const captionText = this.text(0, midY + 11, caption, {
      fontSize: '11px',
      color: cssColour(colour),
      fontStyle: 'bold',
    });

    const dotRadius = 8;
    const padding = 14;
    const gap = 12;
    const textWidth = Math.max(nameText.width, captionText.width);
    const pillWidth = padding + dotRadius * 2 + gap + textWidth + padding;
    const pillHeight = header.h - 12;
    const pillX = right - pillWidth;
    const pillY = midY - pillHeight / 2;

    const pill = this.track(this.scene.add.graphics(), PANEL_DEPTH);
    pill.fillStyle(colour, 0.2);
    pill.fillRoundedRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
    pill.lineStyle(2, colour, 0.95);
    pill.strokeRoundedRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2);

    this.track(
      this.scene.add.circle(pillX + padding + dotRadius, midY, dotRadius, colour),
      CONTENT_DEPTH
    );

    const textX = pillX + padding + dotRadius * 2 + gap;
    nameText.setX(textX);
    captionText.setX(textX);
  }

  private drawRail(
    state: GameState,
    playerNames: Record<string, string>,
    rail: Rect
  ): void {
    const panel = this.track(this.scene.add.graphics(), PANEL_DEPTH);
    panel.fillStyle(PANEL_BG, 1);
    panel.fillRect(rail.x, rail.y, rail.w, rail.h);
    panel.lineStyle(1, PANEL_EDGE, 1);
    panel.lineBetween(rail.x, rail.y, rail.x, rail.y + rail.h);

    if (state.teams.length === 0) return;

    const rowHeight = Math.min(72, Math.max(46, rail.h / state.teams.length));
    const isFinalTable = state.isComplete;
    const ordered =
      isFinalTable && state.finalTeamStandings.length > 0
        ? state.finalTeamStandings.map((id) => this.teamById(state, id))
        : state.teams;

    ordered.forEach((team, row) => {
      if (!team) return;
      const y = rail.y + 10 + row * rowHeight;
      const colour = colourForTeam(team);
      const isCurrent = team.id === state.currentTeamId;

      if (isCurrent) {
        const highlight = this.track(this.scene.add.graphics(), PANEL_DEPTH);
        highlight.fillStyle(colour, 0.22);
        highlight.fillRect(rail.x + 1, y - 6, rail.w - 2, rowHeight - 6);
        highlight.fillStyle(colour, 1);
        highlight.fillRect(rail.x + 1, y - 6, 4, rowHeight - 6);
      }

      this.track(this.scene.add.circle(rail.x + 22, y + 12, 7, colour));

      const name = teamLabel(team, playerNames);
      this.text(rail.x + 38, y + 12, isFinalTable ? `${row + 1}. ${name}` : name, {
        fontSize: '14px',
        color: TEXT,
        fontStyle: isCurrent ? 'bold' : 'normal',
      });

      // Holes on the card, not holeIndex: a side that has holed out is scored through this hole
      // while the field is still playing it, and their vs-par should say so straight away.
      const holesPlayed = (state.card[team.id] ?? []).length;
      const total = state.totals[team.id] ?? 0;
      const vsPar = total - parThrough(state.course, holesPlayed);

      this.text(
        rail.x + rail.w - 14,
        y + 12,
        formatVsPar(vsPar),
        {
          fontSize: '16px',
          color: vsPar < 0 ? '#8ddba0' : vsPar > 0 ? '#e8a08f' : TEXT,
          fontStyle: 'bold',
        },
        1
      );

      // Second line: what is happening on the hole in play, or the finished total. For a side with
      // more than one member the name of whoever is at the board replaces the word "putting" — the
      // row above already says which side it is.
      const strokes = state.strokes[team.id] ?? 0;
      const striker = playerNames[state.currentPlayerId ?? ''] ?? '';
      const puttingLabel =
        team.playerIds.length > 1 && striker ? `▸ ${striker}  ·  ${strokes}` : `▸ putting  ·  ${strokes}`;
      const detail = state.isComplete
        ? `${total} strokes`
        : isCurrent
          ? puttingLabel
          : state.finished[team.id]
            ? // Finished the hole in play, so their score for it is the last entry on the card —
              // holeIndex has not advanced yet, because it only does once everyone is in.
              `in — ${(state.card[team.id] ?? []).at(-1) ?? strokes}`
            : `${strokes} stroke${strokes === 1 ? '' : 's'}`;

      this.text(rail.x + 38, y + 30, detail, {
        fontSize: '12px',
        color: isCurrent && !state.isComplete ? cssColour(colour) : MUTED,
      });

      // Running strokes, so the total visibly moves as holes are completed.
      if (!state.isComplete && holesPlayed > 0) {
        this.text(rail.x + rail.w - 14, y + 30, `${total}`, { fontSize: '12px', color: MUTED }, 1);
      }
    });

    // Course par, so the vs-par column has something to be relative to.
    this.text(
      rail.x + rail.w / 2,
      rail.y + rail.h - 14,
      `${state.course.length} holes  ·  par ${state.course.reduce((s, h) => s + h.par, 0)}`,
      { fontSize: '11px', color: cssColour(0x6d8478) },
      0.5
    );
  }

  private teamById(state: GameState, teamId: string | undefined): Team | undefined {
    return state.teams.find((team) => team.id === teamId);
  }
}
