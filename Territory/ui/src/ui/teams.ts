import type { Team } from '../rules.ts';

/**
 * How a side is presented: its colour and its name. Both are functions of the team alone, so every
 * screen showing the match colours the map identically.
 */

/**
 * Colour by seat in team order, not by anything persistent per id — so it only ever needs the roster
 * in match order. The four are the flag colours a territory map is read with: strongly separated in
 * hue so a front line between two sides is obvious at TV distance, and none of them close to the
 * neutral slate that unclaimed ground is drawn in.
 */
export const TEAM_COLOURS: readonly number[] = [
  0xe4453a, // 1 - Red
  0x3b82f6, // 2 - Blue
  0x22c55e, // 3 - Green
  0xf5a524, // 4 - Amber
];

/** Unclaimed ground. Deliberately desaturated so no side's colour can be mistaken for it. */
export const NEUTRAL_COLOUR = 0x36404b;
/** Ground belonging to a side that has been knocked out — only ever seen on their rail card. */
export const DEAD_COLOUR = 0x4b5563;

export const INK = 0xf2ece0;
export const MUTED = 0x94a3b8;
export const GOLD = 0xe8c05a;

export function colourForIndex(index: number): number {
  return TEAM_COLOURS[index % TEAM_COLOURS.length];
}

export function colourForTeam(team: Team | undefined): number {
  return colourForIndex(team?.index ?? 0);
}

export function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/** Mixes two packed RGB colours, `t` from 0 (a) to 1 (b). */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * What to call a side. A team of one is just that player, which is what keeps a solo match reading
 * exactly as it did before teams existed. A pair gets both names; beyond that the names stop fitting
 * on a rail card, so it becomes the first member and a count.
 */
export function teamLabel(team: Team | undefined, playerNames: Record<string, string>): string {
  if (!team || team.playerIds.length === 0) return 'Player';

  const names = team.playerIds.map((id) => playerNames[id] ?? 'Player');
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}

/** The single name to put next to the turn indicator — who is actually holding the darts. */
export function throwerName(
  playerId: string | null,
  playerNames: Record<string, string>
): string {
  if (playerId === null) return '';
  return playerNames[playerId] ?? 'Player';
}
