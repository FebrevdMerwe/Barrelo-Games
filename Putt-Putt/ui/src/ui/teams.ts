import type { Team } from '../rules';

/**
 * How a side is presented: its colour and its name. Both are functions of the team alone, so every
 * screen showing the match labels and colours the field identically.
 */

/**
 * Ball colour by slot index in team order, not by anything persistent per id — so it only ever needs
 * the roster in match order, and the same seat is the same colour on every screen. Team-mates share
 * a colour because they share a ball.
 */
export const TEAM_COLOURS: readonly number[] = [
  0xfacc15, // 1 - Yellow
  0x3b82f6, // 2 - Blue
  0x22c55e, // 3 - Green
  0xa855f7, // 4 - Purple
  0xf97316, // 5 - Orange
  0xef4444, // 6 - Red
  0x14b8a6, // 7 - Teal
  0xec4899, // 8 - Pink
];

export function colourForIndex(index: number): number {
  return TEAM_COLOURS[index % TEAM_COLOURS.length];
}

export function colourForTeam(team: Team | undefined): number {
  return colourForIndex(team?.index ?? 0);
}

export function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/**
 * What to call a side. A team of one is just that player, which is what keeps a solo match reading
 * exactly as it did before teams existed. A pair gets both names; beyond that the names stop fitting
 * in a rail row, so it becomes the first member and a count.
 */
export function teamLabel(team: Team | undefined, playerNames: Record<string, string>): string {
  if (!team || team.playerIds.length === 0) return 'Player';

  const names = team.playerIds.map((id) => playerNames[id] ?? 'Player');
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}
