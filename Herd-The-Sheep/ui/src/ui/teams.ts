import type { Team } from '../rules';

/**
 * How a side is coloured and named on screen. The one place either is decided.
 *
 * Colour comes from the team's seat, not from any player, so team-mates share one — they share a
 * tally, so they share a colour. A solo player is a team of one and gets a seat colour like anybody
 * else, which is what makes the two modes look like the same game.
 */

export const TEAM_COLORS = [0xd9633d, 0x4f9dc4, 0x8bbf5a, 0xc9a227];

export function colorOf(team: Team): number {
  return TEAM_COLORS[team.index % TEAM_COLORS.length];
}

export function cssColorOf(team: Team): string {
  return `#${colorOf(team).toString(16).padStart(6, '0')}`;
}

/**
 * "Alex" for a solo side, "Alex & Sam" for a pair, "Alex +2" beyond that — a four-name label is
 * unreadable at TV distance and the tally is what people are actually looking at.
 */
export function nameOf(team: Team, playerNames: Record<string, string>): string {
  const names = team.playerIds.map((id) => playerNames[id] ?? 'Player');
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}
