import type { ClientGamePayload, DetectedThrow } from '../../shared/types';
import {
  adjacentTo,
  hitsFor,
  homeTerritoryIds,
  MAX_SHIELD,
  targetFor,
  territoryFor,
  TERRITORY_IDS,
  type TerritoryId,
} from './board.ts';

/**
 * Territory's rules — a pure fold over the visit log, and the only place the game's decisions live.
 *
 * The unit that plays is a *team*: one colour on the map, one set of territories, team-mates taking
 * it in turns to throw for it. A team of one is a solo player, which is why there is no separate
 * solo path — it is the degenerate case of the team game.
 *
 * The purity rules from the template are load-bearing here, because every screen showing the match
 * derives the map from the same log independently:
 *   - No Math.random() — rng(payload.seed) is the only permitted source, and nothing uses it: the
 *     Home territories are computed from the ring, so even the setup needs no randomness.
 *   - No Date.now(), no crypto.randomUUID(), no module-level mutable state.
 *
 * The fold walks *darts*, not visits. Barrelo does not cap a visit at three darts — end of turn is
 * externally driven — so a four-dart visit is representable, and its fourth dart belongs to the
 * next side. Which side is holding the darts is therefore recomputed per dart, not per visit.
 */

export const DARTS_PER_TURN = 3;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;

/**
 * The optional round cap from the `matchLength` setting (see plugin.json), read the same way
 * Putt Putt reads its `holes` option. Anything other than a positive integer — unset, blank, `0`,
 * negative, non-numeric — means unlimited, which is the scope's MVP default (§27).
 */
export function maxRoundsFor(options: Record<string, string> | undefined): number | null {
  const requested = Number.parseInt(options?.maxRounds ?? '', 10);
  return Number.isInteger(requested) && requested > 0 ? requested : null;
}

export { MAX_SHIELD };

/** One side. `index` is its seat in team order, and therefore where its colour comes from. */
export interface Team {
  id: string;
  index: number;
  /** Members in roster order — the order they take turns throwing for the side. Never empty. */
  playerIds: string[];
  homeTerritoryId: TerritoryId;
}

/** A square on the map. Mirrors the shape in the scope; `isHome` is a label, never protection. */
export interface Territory {
  id: TerritoryId;
  ownerId: string | null;
  shield: number;
  isHome: boolean;
}

/** Why a dart did nothing, so the board can say so rather than looking broken. */
export type NoEffectReason =
  /** Off the board entirely. */
  | 'miss'
  /** Neither owned by the thrower nor touching anything they own. */
  | 'unreachable'
  /** Their own territory, already at three shields. */
  | 'maxShield';

/**
 * Every event carries a `key` derived from the dart that caused it. Because replay() is a left fold,
 * the events emitted for a log prefix depend on that prefix alone — appending darts can never
 * rewrite an earlier key, which is what lets the renderer diff two streams by common prefix and know
 * exactly what is new (see ui/eventTail.ts).
 */
export type GameEvent =
  | { key: string; type: 'throw'; throw: DetectedThrow; teamId: string; playerId: string }
  | { key: string; type: 'claimed'; territoryId: TerritoryId; teamId: string }
  | {
      key: string;
      type: 'reinforced';
      territoryId: TerritoryId;
      teamId: string;
      from: number;
      to: number;
    }
  | {
      key: string;
      type: 'shieldsBroken';
      territoryId: TerritoryId;
      attackerTeamId: string;
      defenderTeamId: string;
      from: number;
      to: number;
    }
  | {
      key: string;
      type: 'neutralised';
      territoryId: TerritoryId;
      attackerTeamId: string;
      defenderTeamId: string;
      wasHome: boolean;
    }
  | { key: string; type: 'noEffect'; territoryId: TerritoryId | null; reason: NoEffectReason }
  | { key: string; type: 'eliminated'; teamId: string }
  | { key: string; type: 'turnChanged'; teamId: string; playerId: string }
  | { key: string; type: 'victory'; teamId: string; winnerPlayerIds: string[] };

export interface GameState {
  /** The side at the board and the team-mate throwing for it. Both null once the match is over. */
  currentTeamId: string | null;
  currentPlayerId: string | null;
  currentVisitThrows: DetectedThrow[];

  /** The sides in play, in team order. A solo match is simply a list of one-player teams. */
  teams: Team[];
  /** Team id by player id, for looking a side up without walking `teams`. */
  teamOf: Record<string, string>;

  /** The whole map, keyed by territory id. Every one of the 21 is always present. */
  territories: Record<TerritoryId, Territory>;
  /** How many territories each side holds. Zero means eliminated. */
  territoryCount: Record<string, number>;
  isEliminated: Record<string, boolean>;
  /** Sides knocked out, in the order they went — reversed, this is the bottom of the standings. */
  eliminationOrder: string[];

  /** Completed rotations plus one; purely for the HUD. */
  round: number;
  /** The `matchLength` setting's round cap, or null for the MVP default of unlimited rounds. */
  maxRounds: number | null;

  /** The match as an ordered event stream, not a delta — the renderer owns the diffing. */
  events: GameEvent[];
  /** Display hint: targets Barrelo should grey out, because they can do nothing for this side. */
  deadTargets: (number | 'BULL')[];

  winnerTeamId: string | null;
  winnerPlayerIds: string[];
  /** Every player, best side first, team-mates consecutive — the shape the leaderboard chunks. */
  finalStandings: string[];
  isComplete: boolean;
  /**
   * Non-null when the roster can't be played. Protocol v2 has no /create hook to reject a bad roster
   * at, so an unplayable match has to render an explanation rather than a broken board.
   */
  configError: string | null;
}

/**
 * mulberry32, seeded from payload.seed. The only permitted source of randomness. Territory uses none
 * — Home territories are computed from the ring so that every side gets equal room — but it is kept
 * so anything added later reaches for this rather than Math.random().
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
 * Splits the roster into sides, in the order their first member appears on it — so team order, and
 * with it every colour and every Home, is a function of the roster alone and identical everywhere.
 *
 * A player Barrelo has no group for plays alone. That is what makes a payload with no `playerGroups`
 * at all — an older host, the dev preview — a set of solo sides rather than one enormous team.
 *
 * Homes are dealt here because they depend on the *count* of sides, which isn't known until the
 * split is done.
 */
export function teamsOf(
  playerIds: string[],
  playerGroups: Record<string, number> | undefined
): Team[] {
  const teams: Team[] = [];
  const byKey = new Map<string, Team>();

  for (const playerId of playerIds) {
    const group = playerGroups?.[playerId];
    const key = typeof group === 'number' ? `group:${group}` : `solo:${playerId}`;

    let team = byKey.get(key);
    if (!team) {
      team = { id: key, index: teams.length, playerIds: [], homeTerritoryId: '' };
      byKey.set(key, team);
      teams.push(team);
    }
    team.playerIds.push(playerId);
  }

  const homes = homeTerritoryIds(teams.length);
  teams.forEach((team, index) => {
    team.homeTerritoryId = homes[index];
  });

  return teams;
}

/** A fresh map: every territory neutral and unshielded, except each side's Home. */
function initialTerritories(teams: Team[]): Record<TerritoryId, Territory> {
  const territories: Record<TerritoryId, Territory> = {};
  for (const id of TERRITORY_IDS) {
    territories[id] = { id, ownerId: null, shield: 0, isHome: false };
  }
  // Home is owned from the first dart and shielded from none of them — it is an ordinary territory
  // wearing a label, and the scope is emphatic that it carries no protection.
  for (const team of teams) {
    const home = territories[team.homeTerritoryId];
    if (home) {
      home.ownerId = team.id;
      home.isHome = true;
    }
  }
  return territories;
}

function countTerritories(
  teams: Team[],
  territories: Record<TerritoryId, Territory>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const team of teams) counts[team.id] = 0;
  for (const id of TERRITORY_IDS) {
    const owner = territories[id].ownerId;
    if (owner !== null && owner in counts) counts[owner] += 1;
  }
  return counts;
}

/** Shields banked across every territory a side holds — the round cap's first tie-break. */
function totalShields(territories: Record<TerritoryId, Territory>, teamId: string): number {
  let sum = 0;
  for (const id of TERRITORY_IDS) {
    if (territories[id].ownerId === teamId) sum += territories[id].shield;
  }
  return sum;
}

/**
 * Ranks the sides still standing when the match ends, best first. The usual ending is elimination
 * down to one survivor, which sorts to itself untouched. A round cap can end the match with several
 * sides still holding ground, so the scope's §27 tie-break applies: most territory, then most
 * shields banked across it, then seat order. Seat order is an arbitrary last resort, but it is fixed
 * by the roster, so a genuine tie still resolves identically on every replay.
 */
function rankSurvivors(
  survivors: Team[],
  territoryCount: Record<string, number>,
  territories: Record<TerritoryId, Territory>
): Team[] {
  return [...survivors].sort((a, b) => {
    const byTerritory = territoryCount[b.id] - territoryCount[a.id];
    if (byTerritory !== 0) return byTerritory;
    const byShields = totalShields(territories, b.id) - totalShields(territories, a.id);
    if (byShields !== 0) return byShields;
    return a.index - b.index;
  });
}

/** True when `teamId` holds something touching `id` — the precondition for claiming or attacking. */
function canReach(
  territories: Record<TerritoryId, Territory>,
  id: TerritoryId,
  teamId: string
): boolean {
  return adjacentTo(id).some((neighbour) => territories[neighbour].ownerId === teamId);
}

interface Fold {
  turnIndex: number;
  /** Per side, which member throws the next visit. Advances on every turn boundary. */
  memberIndex: Record<string, number>;
  dartsThisTurn: number;
  /** The darts thrown so far in the turn in progress, for the shell's 1/2/3 slots. */
  turnThrows: DetectedThrow[];
  territories: Record<TerritoryId, Territory>;
  eliminated: Set<string>;
  eliminationOrder: string[];
  round: number;
  complete: boolean;
}

/** The team-mate at the board for `team`, from its rotation cursor. */
function throwerOf(fold: Fold, team: Team): string {
  return team.playerIds[fold.memberIndex[team.id] % team.playerIds.length];
}

export function replay(payload: ClientGamePayload): GameState {
  // Defaulted rather than destructured: the board renders before the first real snapshot arrives,
  // and an exception here is a blank sandboxed iframe with a stack trace nobody is watching.
  const playerIds = payload?.playerIds ?? [];
  const visits = payload?.visits ?? [];
  const maxRounds = maxRoundsFor(payload?.options);

  const teams = teamsOf(playerIds, payload?.playerGroups);
  const teamOf: Record<string, string> = {};
  for (const team of teams) {
    for (const playerId of team.playerIds) teamOf[playerId] = team.id;
  }

  const territories = initialTerritories(teams);

  // An empty roster is the pre-match/dev-boot idle state, not a misconfiguration.
  const configError =
    teams.length === 0
      ? null
      : teams.length < MIN_TEAMS
        ? `Territory needs at least ${MIN_TEAMS} teams — someone has to be worth attacking.`
        : teams.length > MAX_TEAMS
          ? `Territory supports at most ${MAX_TEAMS} teams.`
          : null;

  if (configError !== null || teams.length === 0) {
    return {
      currentTeamId: null,
      currentPlayerId: null,
      currentVisitThrows: [],
      teams,
      teamOf,
      territories,
      territoryCount: countTerritories(teams, territories),
      isEliminated: Object.fromEntries(teams.map((team) => [team.id, false])),
      eliminationOrder: [],
      round: 1,
      maxRounds,
      events: [],
      deadTargets: [],
      winnerTeamId: null,
      winnerPlayerIds: [],
      finalStandings: [],
      isComplete: false,
      configError,
    };
  }

  const memberIndex: Record<string, number> = {};
  for (const team of teams) memberIndex[team.id] = 0;

  const fold: Fold = {
    turnIndex: 0,
    memberIndex,
    dartsThisTurn: 0,
    turnThrows: [],
    territories,
    eliminated: new Set<string>(),
    eliminationOrder: [],
    round: 1,
    complete: false,
  };

  const events: GameEvent[] = [];

  /**
   * Hands the darts to the next side still holding ground, rotating the side that just threw onto
   * its next member. Landing back on the same side (the last one standing) is not a turn change.
   */
  function advanceTurn(): void {
    const from = teams[fold.turnIndex];
    fold.memberIndex[from.id] = (fold.memberIndex[from.id] + 1) % from.playerIds.length;
    fold.dartsThisTurn = 0;
    fold.turnThrows = [];

    const fromIndex = fold.turnIndex;
    for (let step = 1; step <= teams.length; step++) {
      const index = (fromIndex + step) % teams.length;
      if (!fold.eliminated.has(teams[index].id)) {
        fold.turnIndex = index;
        break;
      }
    }

    // Wrapping past the end of the rotation is a completed round. Counted on the wrap rather than
    // from a turn tally so that eliminations, which shorten the rotation, don't skew it.
    if (fold.turnIndex <= fromIndex) {
      fold.round += 1;
      // A round cap (the `matchLength` setting) ends the match once that many rounds have been
      // played out in full, rather than waiting for elimination — see rankSurvivors() for how the
      // winner is picked when more than one side is still standing.
      if (maxRounds !== null && fold.round > maxRounds) fold.complete = true;
    }

    const to = teams[fold.turnIndex];
    if (!fold.complete && to.id !== from.id) {
      events.push({
        key: `turn:${fold.round}:${to.id}:${fold.memberIndex[to.id]}`,
        type: 'turnChanged',
        teamId: to.id,
        playerId: throwerOf(fold, to),
      });
    }
  }

  /**
   * Applies one dart for `team`. This is the whole rulebook, and it is a single ladder:
   *
   *     -1 unclaimed -> 0 held -> 1 shield -> 2 shields -> 3 shields
   *
   * Every hit moves the target exactly one rung, and a dart carries one hit per multiplier: a single
   * is one, a double two, a triple three. Which way it moves is the only question the dart asks:
   *
   *   the thrower's own ground -> up the ladder, capped at three shields
   *   unclaimed and reachable  -> up the ladder, so the first hit claims it and the rest shield it
   *   enemy ground, reachable  -> down the ladder, shields first, then the territory itself
   *   anything else            -> nothing
   *
   * Ground never changes hands directly. An enemy territory stripped of its shields falls to
   * *unclaimed* on the next hit, and only a further hit claims it — so a single into an unshielded
   * enemy takes it off them without taking it for you, and it is the double or the triple that both
   * clears the wedge and plants your colour on it. The same ladder read upwards is why a double into
   * neutral ground lands on one shield and a triple on two.
   *
   * Hits are spent one rung at a time, in that order, and whatever is left at the top of the ladder
   * is discarded.
   */
  function resolveDart(dart: DetectedThrow, team: Team, key: string): void {
    const targetId = territoryFor(dart);
    if (targetId === null) {
      events.push({ key: `${key}:none`, type: 'noEffect', territoryId: null, reason: 'miss' });
      return;
    }

    let hits = hitsFor(dart);
    const territory = fold.territories[targetId];

    if (territory.ownerId !== team.id && !canReach(fold.territories, targetId, team.id)) {
      events.push({
        key: `${key}:none`,
        type: 'noEffect',
        territoryId: targetId,
        reason: 'unreachable',
      });
      return;
    }

    // Anything that moved the target at all. The only dart that can move nothing from here is one
    // into the thrower's own territory already at the top of the ladder.
    let moved = false;

    // Down the ladder, while the target belongs to somebody else.
    if (territory.ownerId !== null && territory.ownerId !== team.id) {
      const defenderTeamId = territory.ownerId;

      const removed = Math.min(territory.shield, hits);
      if (removed > 0) {
        const from = territory.shield;
        territory.shield -= removed;
        hits -= removed;
        moved = true;
        events.push({
          key: `${key}:break`,
          type: 'shieldsBroken',
          territoryId: targetId,
          attackerTeamId: team.id,
          defenderTeamId,
          from,
          to: territory.shield,
        });
      }

      // The rung below zero shields is unclaimed, not captured — the attacker spends a hit to take
      // the wedge off its owner and has to spend another to take it for themselves.
      if (hits > 0) {
        const wasHome = territory.isHome;
        territory.ownerId = null;
        territory.shield = 0;
        hits -= 1;
        moved = true;
        events.push({
          key: `${key}:neutralise`,
          type: 'neutralised',
          territoryId: targetId,
          attackerTeamId: team.id,
          defenderTeamId,
          wasHome,
        });
      }
    }

    // Up the ladder: unclaimed ground costs one hit to plant a colour on, and lands on no shields.
    if (territory.ownerId === null && hits > 0) {
      territory.ownerId = team.id;
      territory.shield = 0;
      hits -= 1;
      moved = true;
      events.push({ key: `${key}:claim`, type: 'claimed', territoryId: targetId, teamId: team.id });
    }

    // Whatever hits survived the climb become shields, capped at three; the rest are discarded.
    if (territory.ownerId === team.id && hits > 0) {
      const from = territory.shield;
      const to = Math.min(MAX_SHIELD, from + hits);
      if (to > from) {
        territory.shield = to;
        moved = true;
        events.push({
          key: `${key}:reinforce`,
          type: 'reinforced',
          territoryId: targetId,
          teamId: team.id,
          from,
          to,
        });
      }
    }

    if (!moved) {
      events.push({
        key: `${key}:none`,
        type: 'noEffect',
        territoryId: targetId,
        reason: 'maxShield',
      });
    }
  }

  /** Knocks out every side left holding nothing, and decides the match when one is left. */
  function settleEliminations(): void {
    const counts = countTerritories(teams, fold.territories);
    for (const team of teams) {
      if (counts[team.id] === 0 && !fold.eliminated.has(team.id)) {
        fold.eliminated.add(team.id);
        fold.eliminationOrder.push(team.id);
        events.push({ key: `out:${team.id}`, type: 'eliminated', teamId: team.id });
      }
    }
    if (teams.length - fold.eliminated.size <= 1) fold.complete = true;
  }

  for (const visit of visits) {
    if (fold.complete) break;

    // Whether the three-dart rule already moved the turn on this visit's last dart, so an `ended`
    // flag on the same visit doesn't move it a second time.
    let advancedByDartCount = false;

    for (let throwIndex = 0; throwIndex < visit.throws.length; throwIndex++) {
      if (fold.complete) break;
      advancedByDartCount = false;

      const dart = visit.throws[throwIndex];
      const team = teams[fold.turnIndex];
      const playerId = throwerOf(fold, team);
      const key = dart.throwId || `${events.length}#${throwIndex}`;

      events.push({ key: `t:${key}`, type: 'throw', throw: dart, teamId: team.id, playerId });
      resolveDart(dart, team, key);
      settleEliminations();

      fold.dartsThisTurn += 1;
      fold.turnThrows.push(dart);
      if (fold.complete) break;

      // A side eliminated mid-turn stops throwing at once. Unreachable under the rules above — a
      // dart can only cost the *defender* ground — but the scope asks for it, and a future card or
      // power-up that can backfire would land here.
      if (fold.dartsThisTurn >= DARTS_PER_TURN || fold.eliminated.has(team.id)) {
        advanceTurn();
        advancedByDartCount = true;
      }
    }

    if (visit.ended && !advancedByDartCount && !fold.complete) advanceTurn();
  }

  const territoryCount = countTerritories(teams, fold.territories);
  const isEliminated: Record<string, boolean> = {};
  for (const team of teams) isEliminated[team.id] = fold.eliminated.has(team.id);

  const survivors = teams.filter((team) => !fold.eliminated.has(team.id));
  let winnerTeamId: string | null = null;
  let winnerPlayerIds: string[] = [];
  let finalStandings: string[] = [];

  if (fold.complete) {
    // The turn hand-off that follows the deciding dart is meaningless once the match is over — the
    // victory event replaces it. Dropped here rather than suppressed inside advanceTurn(), which
    // can't know the fold is about to end.
    while (events.length > 0 && events[events.length - 1].type === 'turnChanged') events.pop();

    const rankedSurvivors = rankSurvivors(survivors, territoryCount, fold.territories);
    const winner = rankedSurvivors[0];
    winnerTeamId = winner?.id ?? null;
    winnerPlayerIds = winner ? [...winner.playerIds] : [];

    // Ranked survivors first — one when elimination decided it, more when a round cap did — then
    // the fallen, last out ranking highest among them so the elimination order runs backwards below
    // the survivors. Team-mates stay consecutive: Barrelo's leaderboard chunks runs sharing a side.
    const ranked = [
      ...rankedSurvivors,
      ...fold.eliminationOrder
        .slice()
        .reverse()
        .map((id) => teams.find((team) => team.id === id))
        .filter((team): team is Team => team !== undefined),
    ];
    finalStandings = ranked.flatMap((team) => team.playerIds);
    // Unreachable given the fold: every side is either a survivor or in the elimination order.
    // Kept because Barrelo rejects an empty standings list outright and silently awards nothing to
    // anyone missing from a partial one.
    for (const playerId of playerIds) {
      if (!finalStandings.includes(playerId)) finalStandings.push(playerId);
    }

    if (winnerTeamId !== null) {
      events.push({
        key: `v:${winnerTeamId}`,
        type: 'victory',
        teamId: winnerTeamId,
        winnerPlayerIds,
      });
    }
  }

  const current = fold.complete ? null : teams[fold.turnIndex];

  return {
    currentTeamId: current?.id ?? null,
    currentPlayerId: current ? throwerOf(fold, current) : null,
    // Tracked through the fold rather than read off the log's last open visit: three darts end a
    // turn whether or not the host has flagged the visit ended, so an open visit can already belong
    // to the side that has finished throwing. Reading it from the log would leave the previous
    // side's darts sitting in the next side's slots.
    currentVisitThrows: fold.complete ? [] : fold.turnThrows,
    teams,
    teamOf,
    territories: fold.territories,
    territoryCount,
    isEliminated,
    eliminationOrder: fold.eliminationOrder,
    round: fold.round,
    maxRounds,
    events,
    deadTargets: deadTargetsFor(fold.territories, current?.id ?? null),
    winnerTeamId,
    winnerPlayerIds,
    finalStandings,
    isComplete: fold.complete,
    configError: null,
  };
}

/**
 * Targets that can do nothing for the side at the board: not theirs, and touching nothing of theirs.
 * Own territories stay live even at three shields — the dart is wasted, but it is a legal move, and
 * greying it out would misread as "you can't throw there".
 *
 * Everything is dead once the match is over.
 */
export function deadTargetsFor(
  territories: Record<TerritoryId, Territory>,
  teamId: string | null
): (number | 'BULL')[] {
  if (teamId === null) return TERRITORY_IDS.map(targetFor);
  return TERRITORY_IDS.filter(
    (id) => territories[id].ownerId !== teamId && !canReach(territories, id, teamId)
  ).map(targetFor);
}

/** The territories a side could claim or attack right now — the board's "you can go here" hint. */
export function reachableFor(
  territories: Record<TerritoryId, Territory>,
  teamId: string | null
): Set<TerritoryId> {
  const reachable = new Set<TerritoryId>();
  if (teamId === null) return reachable;
  for (const id of TERRITORY_IDS) {
    if (territories[id].ownerId !== teamId && canReach(territories, id, teamId)) reachable.add(id);
  }
  return reachable;
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
 * The map is serialised by walking TERRITORY_IDS rather than Object.keys, so field order is fixed by
 * this module and not by however each screen happened to build the record. `events` is omitted: it
 * is fully determined by the fields below and would grow without bound over a long match.
 */
export function hashState(state: GameState): string {
  return hash(
    JSON.stringify([
      state.currentTeamId,
      state.currentPlayerId,
      TERRITORY_IDS.map((id) => {
        const territory = state.territories[id];
        return [territory.ownerId, territory.shield];
      }),
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
