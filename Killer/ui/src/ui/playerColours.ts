/**
 * Fixed player -> colour table (redesign.md). Colour is assigned by slot index within the ordered
 * player id list, not by anything persistent per-id, so it only ever needs the ids in match order.
 */
export const PLAYER_COLOURS: readonly number[] = [
  0xfacc15, // Player 1 - Yellow
  0x3b82f6, // Player 2 - Blue
  0x22c55e, // Player 3 - Green
  0xa855f7, // Player 4 - Purple
  0xf97316, // Player 5 - Orange
  0xef4444, // Player 6 - Red
];

export function colourForIndex(index: number): number {
  return PLAYER_COLOURS[index % PLAYER_COLOURS.length];
}

export function colourForPlayer(orderedIds: string[], playerId: string): number {
  const index = orderedIds.indexOf(playerId);
  return colourForIndex(index < 0 ? 0 : index);
}
