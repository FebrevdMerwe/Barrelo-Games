import type { GameEvent } from '../rules';

export type EventDelta = { kind: 'append'; events: GameEvent[] } | { kind: 'resync' };

/**
 * Above this many new events at once the board is catching up, not being watched — snap to the
 * current state instead of playing out a minutes-long backlog.
 */
const MAX_ANIMATED_TAIL = 10;

/**
 * Exact, where the protocol v1 version had to guess.
 *
 * A v1 snapshot carried no log, so the old eventDiff.ts inferred undo from lives going *up*, the
 * killer flag un-flipping, and `recentThrows` not being explainable as "prefix dropped, entries
 * appended". Protocol v2 pushes the whole visit log down, replay() derives the whole event stream
 * from it, and the only question left is whether the new stream extends the old one.
 *
 * Undo produces either a strictly shorter stream (a dart was popped) or a stream missing its
 * trailing turnChanged (an ended visit was re-opened). Both fail the extension test and resync.
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
