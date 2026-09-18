import type { GameEvent } from '../rules.ts';

export type EventDelta = { kind: 'append'; events: GameEvent[] } | { kind: 'resync' };

/**
 * Above this many new events at once the board is catching up, not being watched — snap to the
 * current map instead of playing out a round of captures nobody is waiting for.
 *
 * A dart is worth up to four events now that a wedge changes hands one rung at a time: the throw,
 * the shields coming off, the wedge going neutral, and the attacker claiming it. Three of those plus
 * the turn hand-off is the worst a normal visit can produce, and a normal visit must always animate.
 */
const MAX_ANIMATED_TAIL = 13;

/**
 * Decides whether the newly derived event stream simply extends the one already on screen.
 *
 * Because replay() is a left fold, the events produced by a log prefix depend on that prefix alone,
 * and every key is derived from the dart that caused it. So appending darts can never rewrite an
 * earlier key, and "is this an extension?" is answered by comparing keys position by position.
 *
 * Undo produces either a strictly shorter stream (a dart was popped) or one missing its trailing
 * turnChanged (an ended visit was re-opened). Both fail the extension test and resync.
 *
 * `prev === null` is the first paint — or a TV switched on mid-match — and must resync rather than
 * animate the entire history.
 */
export function diffEvents(prev: GameEvent[] | null, next: GameEvent[]): EventDelta {
  if (prev === null || next.length < prev.length) return { kind: 'resync' };
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].key !== next[i].key) return { kind: 'resync' };
  }
  const tail = next.slice(prev.length);
  if (tail.length > MAX_ANIMATED_TAIL) return { kind: 'resync' };
  return { kind: 'append', events: tail };
}
