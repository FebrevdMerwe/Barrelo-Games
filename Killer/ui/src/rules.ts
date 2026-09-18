import type { ClientGamePayload, DetectedThrow } from '../../shared/types';

export const STARTING_LIVES = 3;
export const DARTS_PER_TURN = 3;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 20; // only the numbers 1-20 exist to assign
export const BULL_SEGMENT = 25;

/**
 * Every event carries a `key` derived from the log entry that caused it. Because replay() is a left
 * fold, the events emitted while processing a log prefix depend on that prefix alone — so appending
 * darts can never change an earlier key. That is what lets the renderer diff two event lists by
 * common prefix and know exactly what is new (see ui/eventTail.ts).
 */
export type GameEvent =
  | { key: string; type: 'throw'; throw: DetectedThrow; throwerId: string }
  | { key: string; type: 'becameKiller'; playerId: string }
  | { key: string; type: 'lifeLost'; playerId: string; livesRemaining: number }
  | { key: string; type: 'eliminated'; playerId: string }
  | { key: string; type: 'turnChanged'; playerId: string }
  | { key: string; type: 'victory'; winnerPlayerIds: string[] };

export interface GameState {
  currentPlayerId: string | null;
  currentVisitThrows: DetectedThrow[];
  numbers: Record<string, number>;
  lives: Record<string, number>;
  isKiller: Record<string, boolean>;
  eliminationOrder: string[];
  /** The whole match as an ordered event stream, not a delta — the renderer owns the diffing. */
  events: GameEvent[];
  /** Display hint: segments Barrelo should grey out on its manual-entry dartboard. */
  deadTargets: (number | 'BULL')[];
  winnerPlayerIds: string[];
  finalStandings: string[];
  isComplete: boolean;
  /**
   * Non-null when the roster can't be played. Protocol v2 has no /create hook to reject a bad
   * roster at, so an unplayable match has to render an explanation rather than a broken board.
   */
  configError: string | null;
}

/**
 * mulberry32. The only permitted source of randomness: seeded from payload.seed, which is fixed for
 * the match and identical on every screen showing it.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Assigns each player a unique number 1-20.
 *
 * The full 20-number pool is always shuffled regardless of roster size, so the draw count never
 * depends on how many people are playing — the same seed then produces the same first N numbers
 * whether 2 or 20 are at the board.
 */
export function assignNumbers(playerIds: string[], seed: number): Record<string, number> {
  const next = rng(seed);
  const pool: number[] = [];
  for (let n = 1; n <= MAX_PLAYERS; n++) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  const result: Record<string, number> = {};
  playerIds.forEach((id, i) => {
    if (i < pool.length) result[id] = pool[i];
  });
  return result;
}

/**
 * Recomputes lives, killer status, turn order and elimination order from the visit log — the only
 * place Killer's rules live, and a pure function of the payload.
 *
 * The fold is throw-by-throw rather than visit-by-visit because Barrelo does not cap a visit at
 * three darts (end-of-turn is externally driven, by the autoscorer or the operator's "next player"
 * button), so a four-dart visit is representable and its fourth dart belongs to the next player.
 */
export function replay(payload: ClientGamePayload): GameState {
  // Defaulted rather than destructured: the board renders before the first real snapshot arrives,
  // and an exception here is a blank sandboxed iframe with a stack trace nobody is watching.
  const playerIds = payload?.playerIds ?? [];
  const visits = payload?.visits ?? [];
  const numbers = assignNumbers(playerIds, payload?.seed ?? 0);

  const lives: Record<string, number> = {};
  const isKiller: Record<string, boolean> = {};
  playerIds.forEach((id) => {
    lives[id] = STARTING_LIVES;
    isKiller[id] = false;
  });

  // An empty roster is the pre-match/dev-boot idle state, not a misconfiguration.
  const configError =
    playerIds.length === 0
      ? null
      : playerIds.length < MIN_PLAYERS
        ? `Killer needs at least ${MIN_PLAYERS} players.`
        : playerIds.length > MAX_PLAYERS
          ? `Killer supports at most ${MAX_PLAYERS} players — one per number 1-20.`
          : null;

  if (configError !== null || playerIds.length === 0) {
    return {
      currentPlayerId: null,
      currentVisitThrows: [],
      numbers,
      lives,
      isKiller,
      eliminationOrder: [],
      events: [],
      deadTargets: ['BULL'],
      winnerPlayerIds: [],
      finalStandings: [],
      isComplete: false,
      configError,
    };
  }

  const events: GameEvent[] = [];
  const eliminationOrder: string[] = [];
  let turnIndex = 0;
  let currentVisitThrows: DetectedThrow[] = [];
  let turnOrdinal = 0;

  function advanceTurn(): void {
    const from = playerIds[turnIndex];
    for (let step = 1; step <= playerIds.length; step++) {
      const idx = (turnIndex + step) % playerIds.length;
      if (lives[playerIds[idx]] > 0) {
        turnIndex = idx;
        break;
      }
    }
    const to = playerIds[turnIndex];
    // Landing back on the same player (last one standing) is not a turn change. The ordinal keeps
    // keys unique so A->B->A in a two-player match can't collide on the prefix diff.
    if (to !== from) {
      turnOrdinal += 1;
      events.push({ key: `n:${turnOrdinal}:${to}`, type: 'turnChanged', playerId: to });
    }
  }

  visits.forEach((visit, visitIndex) => {
    // Whether the three-dart rule already advanced on this visit's last dart, so an `ended` flag on
    // the same visit doesn't advance a second time.
    let advancedByDartCount = false;

    visit.throws.forEach((detectedThrow, throwIndex) => {
      advancedByDartCount = false;
      const throwerId = playerIds[turnIndex];
      const tid = detectedThrow.throwId || `${visitIndex}#${throwIndex}`;
      const { segment, ring } = detectedThrow;

      events.push({ key: `t:${tid}`, type: 'throw', throw: detectedThrow, throwerId });

      // The bull is inert in Killer — it belongs to nobody and can't be a killer's target.
      if (segment !== BULL_SEGMENT) {
        if (segment === numbers[throwerId]) {
          if (ring === 'Double' && !isKiller[throwerId]) {
            isKiller[throwerId] = true;
            events.push({ key: `k:${tid}`, type: 'becameKiller', playerId: throwerId });
          }
        } else if (isKiller[throwerId]) {
          const targetId = playerIds.find(
            (id) => id !== throwerId && lives[id] > 0 && numbers[id] === segment
          );
          if (targetId) {
            lives[targetId] -= 1;
            if (lives[targetId] <= 0) {
              eliminationOrder.push(targetId);
              events.push({ key: `e:${tid}:${targetId}`, type: 'eliminated', playerId: targetId });
            } else {
              events.push({
                key: `l:${tid}:${targetId}`,
                type: 'lifeLost',
                playerId: targetId,
                livesRemaining: lives[targetId],
              });
            }
          }
        }
      }

      currentVisitThrows.push(detectedThrow);
      if (currentVisitThrows.length >= DARTS_PER_TURN) {
        currentVisitThrows = [];
        advanceTurn();
        advancedByDartCount = true;
      }
    });

    if (visit.ended && !advancedByDartCount) {
      currentVisitThrows = [];
      advanceTurn();
    }
  });

  const alive = playerIds.filter((id) => lives[id] > 0);
  const isComplete = playerIds.length >= MIN_PLAYERS && alive.length <= 1;
  const winnerPlayerIds = isComplete && alive.length === 1 ? [alive[0]] : [];

  let finalStandings: string[] = [];
  if (isComplete) {
    // The turn advance that follows the killing dart is meaningless once the match is over — the
    // victory sequence replaces it. Dropped here rather than suppressed inside advanceTurn(), which
    // can't know the fold is about to end.
    while (events.length > 0 && events[events.length - 1].type === 'turnChanged') events.pop();

    finalStandings = [...winnerPlayerIds, ...eliminationOrder.slice().reverse()];
    // Unreachable given the fold above: advanceTurn() only ever lands on a living player and a
    // killer's target search excludes themselves, so a thrower can never lose a life and exactly
    // one player is always left standing. Kept because Barrelo rejects an empty standings list
    // outright, and silently awards nothing to anyone missing from a partial one.
    for (const id of playerIds) if (!finalStandings.includes(id)) finalStandings.push(id);

    events.push({
      key: `v:${winnerPlayerIds[0] ?? 'none'}`,
      type: 'victory',
      winnerPlayerIds,
    });
  }

  // Bull is dead from the first dart, not just once someone is knocked out, and so is every number
  // nobody was dealt — hitting any of them can never do anything in Killer.
  const liveNumbers = new Set(playerIds.filter((id) => lives[id] > 0).map((id) => numbers[id]));
  const deadTargets: (number | 'BULL')[] = [];
  for (let n = 1; n <= MAX_PLAYERS; n++) if (!liveNumbers.has(n)) deadTargets.push(n);
  deadTargets.push('BULL');

  return {
    currentPlayerId: isComplete ? null : playerIds[turnIndex],
    currentVisitThrows,
    numbers,
    lives,
    isKiller,
    eliminationOrder,
    events,
    deadTargets,
    winnerPlayerIds,
    finalStandings,
    isComplete,
    configError: null,
  };
}

function hash(canonical: string): string {
  let value = 0;
  for (let i = 0; i < canonical.length; i++) {
    value = (Math.imul(31, value) + canonical.charCodeAt(i)) | 0;
  }
  return (value >>> 0).toString(16);
}

/**
 * Identifies the derived state, for Barrelo's cross-screen divergence check.
 *
 * The records are keyed by iterating payload.playerIds, so JSON.stringify emits them in the same
 * insertion order on every screen. `numbers` is included deliberately: it is the one field derived
 * from the RNG, so a determinism bug surfaces on the first snapshot rather than only once someone
 * gets hit. `events` is omitted — it is fully determined by these fields and would make the hash
 * grow without bound over a long match.
 */
export function hashState(state: GameState): string {
  return hash(
    JSON.stringify([
      state.currentPlayerId,
      state.numbers,
      state.lives,
      state.isKiller,
      state.eliminationOrder,
      state.isComplete,
      state.winnerPlayerIds,
      state.finalStandings,
    ])
  );
}

export function hashLog(payload: ClientGamePayload): string {
  return hash(
    JSON.stringify(
      (payload?.visits ?? []).map((visit) => [visit.throws.map((t) => t.throwId), visit.ended])
    )
  );
}
