import type { ClientGamePayload, DetectedThrow, Visit } from '../../shared/types';
import { buildPaddock, flockSizeFor, type Paddock, type Vec } from './paddock';
import { scareFor, type Scare } from './scare';
import { burstSeed, createEngine, runBurst, type SheepState } from './simulate';

/**
 * Herd The Sheep's rules — a pure fold over the visit log, and the only place the game's decisions
 * live.
 *
 * This file runs the physics itself, headlessly, rather than asking the board where the sheep went.
 * That is deliberate and load-bearing: who scored, whose turn it is and whether the match is over
 * all depend on sheep positions. If the flock only existed in the renderer, the turn indicator, the
 * dart slots and matchComplete would have nothing to read, and two screens would derive different
 * matches from the same log.
 *
 * The unit that plays is a *team*, not a player. A team of one is a solo player, which is why solo
 * needs no separate code path — it is the degenerate case, and a roster with everyone in their own
 * group replays through exactly this code.
 *
 * Purity rules, all load-bearing here:
 *   - No Math.random(). Randomness comes from payload.seed, via buildPaddock and burstSeed.
 *   - No Date.now(), no crypto.randomUUID(), no module-level mutable state.
 *
 * There is deliberately no memoisation. A full match is a few hundred bursts of at most 150 Matter
 * steps over a dozen bodies — tens of milliseconds — which is far cheaper than the risk of a subtly
 * wrong cache reintroducing exactly the divergence the fold exists to prevent. The one optimisation
 * that does matter is reusing a single engine across every burst: Engine.create() is the expensive
 * call, stepping is not.
 */

/** Matches plugin.json's maxGroups. Checked here because protocol v2 has no /create hook to reject at. */
export const MAX_TEAMS = 4;

export interface Team {
  id: string;
  index: number;
  /** Members in roster order; the order they take visits in. Never empty. */
  playerIds: string[];
}

export type GameEvent =
  | {
      key: string;
      type: 'push';
      teamId: string;
      /** Which team-mate threw it — the rotation is a rule, so the replay decides this too. */
      playerId: string;
      scare: Scare;
      /** The flock as it stood before this dart, and the seed for its burst: enough for the board
       *  to re-run the identical simulation live rather than tween a recorded path. */
      before: SheepState[];
      seed: number;
      after: SheepState[];
      penned: string[];
    }
  /** A dart thrown after the match ended, or into the dead tail of a visit when sudden death began. */
  | { key: string; type: 'spare'; teamId: string; playerId: string }
  | { key: string; type: 'suddenDeath'; teamIds: string[]; sheepId: string; at: Vec }
  | { key: string; type: 'turnChanged'; teamId: string; playerId: string }
  | { key: string; type: 'victory'; winnerPlayerIds: string[] };

export type Phase = 'main' | 'suddenDeath';

export interface GameState {
  currentTeamId: string | null;
  currentPlayerId: string | null;
  currentGroupIndex: number | null;
  currentVisitThrows: DetectedThrow[];

  teams: Team[];
  teamOf: Record<string, string>;

  /** The field, rebuilt from the seed. Identical on every screen. */
  paddock: Paddock;
  flockSize: number;
  /** Sheep still loose, in stable id order. */
  flock: SheepState[];
  /** Sheep banked, per team. The scoreboard. */
  pennedBy: Record<string, number>;
  /** Darts thrown, per team. The solo scoreboard, and a stat worth showing in a race too. */
  dartsBy: Record<string, number>;

  phase: Phase;
  /** Teams still contesting the sudden-death sheep. Empty outside that phase. */
  suddenDeathTeamIds: string[];

  events: GameEvent[];
  winnerTeamIds: string[];
  winnerPlayerIds: string[];
  /** Every player, best team first, team-mates consecutive — the shape the leaderboard chunks. */
  finalStandings: string[];
  finalTeamStandings: string[];
  isComplete: boolean;
  configError: string | null;
}

/** mulberry32, seeded from payload.seed. Mirrors the helpers in paddock.ts and simulate.ts. */
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
 * Resolves a player's team: their explicit assignment in `playerGroups` if present, otherwise their
 * own roster position — an implicit team of one. Mirrors the host's
 * `GameSetupExtensions.EffectiveGroupIndex` exactly.
 */
export function effectiveGroupIndex(payload: ClientGamePayload, playerId: string): number {
  const assigned = payload?.playerGroups?.[playerId];
  if (typeof assigned === 'number') return assigned;
  return (payload?.playerIds ?? []).indexOf(playerId);
}

/**
 * Splits the roster into sides, ordered by group index — so team order, and with it every team
 * colour, is a function of the roster alone and identical on every screen.
 *
 * A player Barrelo has no group for plays alone. That is not a defensive nicety: it is what makes a
 * payload with no `playerGroups` at all — an older host, the harness, the dev preview — a solo match
 * rather than one enormous team.
 */
export function teamsOf(payload: ClientGamePayload): Team[] {
  const playerIds = payload?.playerIds ?? [];
  const byGroup = new Map<number, string[]>();

  playerIds.forEach((playerId) => {
    const groupIndex = effectiveGroupIndex(payload, playerId);
    const members = byGroup.get(groupIndex);
    if (members) members.push(playerId);
    else byGroup.set(groupIndex, [playerId]);
  });

  return [...byGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([groupIndex, memberIds], index) => ({
      id: `t${groupIndex}`,
      index,
      playerIds: memberIds,
    }));
}

/** A visit is over when the turn boundary arrived, or when three darts have been thrown. */
function isVisitOver(visit: Visit): boolean {
  return visit.ended || visit.throws.length >= 3;
}

function emptyState(paddock: Paddock, configError: string | null): GameState {
  return {
    currentTeamId: null,
    currentPlayerId: null,
    currentGroupIndex: null,
    currentVisitThrows: [],
    teams: [],
    teamOf: {},
    paddock,
    flockSize: 0,
    flock: [],
    pennedBy: {},
    dartsBy: {},
    phase: 'main',
    suddenDeathTeamIds: [],
    events: [],
    winnerTeamIds: [],
    winnerPlayerIds: [],
    finalStandings: [],
    finalTeamStandings: [],
    isComplete: false,
    configError,
  };
}

/**
 * Ranks the sides, best first: most sheep banked, and a sudden-death winner promoted above the
 * team it was level with. Ties that were never contested (level teams below the lead) simply stay
 * adjacent, which is the shape Barrelo's leaderboard reads as a shared placing.
 */
function rankTeams(
  teams: Team[],
  pennedBy: Record<string, number>,
  suddenDeathWinner: string | null
): Team[] {
  return [...teams].sort((a, b) => {
    if (suddenDeathWinner === a.id) return -1;
    if (suddenDeathWinner === b.id) return 1;
    const byPenned = (pennedBy[b.id] ?? 0) - (pennedBy[a.id] ?? 0);
    if (byPenned !== 0) return byPenned;
    return a.index - b.index;
  });
}

export function replay(payload: ClientGamePayload): GameState {
  const visits = payload?.visits ?? [];
  const teams = teamsOf(payload);
  const seed = payload?.seed ?? 0;
  const mode = payload?.options?.flock ?? 'standard';

  if (teams.length === 0) return emptyState(buildPaddock(seed, 0), null);
  if (teams.length > MAX_TEAMS) {
    return emptyState(
      buildPaddock(seed, 0),
      `Herd The Sheep supports up to ${MAX_TEAMS} teams; this match has ${teams.length}.`
    );
  }

  const flockSize = flockSizeFor(mode, teams.length);
  const paddock = buildPaddock(seed, flockSize);

  const teamOf: Record<string, string> = {};
  const pennedBy: Record<string, number> = {};
  const dartsBy: Record<string, number> = {};
  const memberIndex: Record<string, number> = {};
  teams.forEach((team) => {
    pennedBy[team.id] = 0;
    dartsBy[team.id] = 0;
    memberIndex[team.id] = 0;
    team.playerIds.forEach((playerId) => {
      teamOf[playerId] = team.id;
    });
  });

  let flock: SheepState[] = paddock.starts.map((at, i) => ({ id: `s${i}`, at }));

  const events: GameEvent[] = [];
  const engine = createEngine();

  let phase: Phase = 'main';
  let suddenDeathTeamIds: string[] = [];
  let suddenDeathWinner: string | null = null;
  let isComplete = false;
  let winnerTeamIds: string[] = [];

  // Rotation walks `teams` in the main phase and only the tied teams once sudden death begins.
  let rotationIndex = 0;
  const rotation = (): Team[] =>
    phase === 'main' ? teams : teams.filter((t) => suddenDeathTeamIds.includes(t.id));

  let dartOrdinal = 0;
  let currentVisitThrows: DetectedThrow[] = [];
  // Set when sudden death opens mid-visit: the rest of that visit belongs to a team that may not
  // even be in the tie, so those darts are dead rather than a free shot at the deciding sheep.
  let visitDead = false;

  /**
   * Decides, after a dart, whether the match is over — or whether the field has emptied level and
   * a sudden-death sheep is owed. Returns nothing; mutates the fold's state, which is what the
   * enclosing loop reads on the next iteration.
   */
  const evaluate = (): void => {
    if (isComplete) return;

    if (phase === 'suddenDeath') {
      // Only the tied teams throw here, so whoever just banked it is the winner by construction.
      if (flock.length === 0) {
        const banked = rankTeams(teams, pennedBy, suddenDeathWinner)[0];
        winnerTeamIds = [suddenDeathWinner ?? banked.id];
        isComplete = true;
      }
      return;
    }

    const scores = teams.map((t) => pennedBy[t.id] ?? 0).sort((a, b) => b - a);

    if (flock.length === 0) {
      const top = scores[0];
      const tied = teams.filter((t) => (pennedBy[t.id] ?? 0) === top);

      // Solo has nobody to be level with: an empty field simply ends it, and the score that
      // mattered was darts used.
      if (tied.length === 1 || teams.length === 1) {
        winnerTeamIds = [tied[0].id];
        isComplete = true;
        return;
      }

      phase = 'suddenDeath';
      suddenDeathTeamIds = tied.map((t) => t.id);
      rotationIndex = 0;
      visitDead = true;
      flock = [{ id: 'sd', at: paddock.suddenDeathStart }];
      events.push({
        key: `sd:${dartOrdinal}`,
        type: 'suddenDeath',
        teamIds: [...suddenDeathTeamIds],
        sheepId: 'sd',
        at: paddock.suddenDeathStart,
      });
      return;
    }

    // Mathematically decided: nobody else can reach the leader even by banking every sheep left.
    // Requires a strict leader — two teams level at the top can both still win.
    if (teams.length > 1 && scores[0] - scores[1] > flock.length) {
      const top = scores[0];
      winnerTeamIds = teams.filter((t) => (pennedBy[t.id] ?? 0) === top).map((t) => t.id);
      isComplete = true;
    }
  };

  visits.forEach((visit) => {
    const currentRotation = rotation();
    const team = currentRotation[rotationIndex % currentRotation.length];
    const playerId = team.playerIds[memberIndex[team.id] % team.playerIds.length];

    visit.throws.forEach((dart) => {
      if (isComplete || visitDead) {
        events.push({ key: `sp:${dart.throwId}`, type: 'spare', teamId: team.id, playerId });
        return;
      }

      const scare = scareFor(dart);
      const before = flock;
      const seedForBurst = burstSeed(seed, dartOrdinal);
      const result = runBurst(engine, paddock, flock, scare, seedForBurst);

      dartOrdinal++;
      dartsBy[team.id] = (dartsBy[team.id] ?? 0) + 1;
      flock = result.flock;
      pennedBy[team.id] = (pennedBy[team.id] ?? 0) + result.penned.length;
      if (phase === 'suddenDeath' && result.penned.length > 0) suddenDeathWinner = team.id;

      events.push({
        key: `p:${dart.throwId}`,
        type: 'push',
        teamId: team.id,
        playerId,
        scare,
        before,
        seed: seedForBurst,
        after: result.flock,
        penned: result.penned,
      });

      evaluate();
    });

    if (isVisitOver(visit)) {
      memberIndex[team.id] = (memberIndex[team.id] + 1) % team.playerIds.length;
      visitDead = false;
      const nextRotation = rotation();
      rotationIndex = (rotationIndex + 1) % nextRotation.length;
      currentVisitThrows = [];

      if (!isComplete) {
        const nextTeam = nextRotation[rotationIndex % nextRotation.length];
        events.push({
          key: `t:${visit.throws[visit.throws.length - 1]?.throwId ?? rotationIndex}`,
          type: 'turnChanged',
          teamId: nextTeam.id,
          playerId: nextTeam.playerIds[memberIndex[nextTeam.id] % nextTeam.playerIds.length],
        });
      }
    } else {
      currentVisitThrows = visit.throws;
    }
  });

  const ranked = rankTeams(teams, pennedBy, suddenDeathWinner);
  const winnerPlayerIds = isComplete
    ? teams.filter((t) => winnerTeamIds.includes(t.id)).flatMap((t) => t.playerIds)
    : [];

  if (isComplete) {
    events.push({ key: `v:${dartOrdinal}`, type: 'victory', winnerPlayerIds });
  }

  const activeRotation = rotation();
  const currentTeam = isComplete ? null : activeRotation[rotationIndex % activeRotation.length];
  const currentPlayerId = currentTeam
    ? currentTeam.playerIds[memberIndex[currentTeam.id] % currentTeam.playerIds.length]
    : null;

  return {
    currentTeamId: currentTeam?.id ?? null,
    currentPlayerId,
    currentGroupIndex: currentTeam ? Number(currentTeam.id.slice(1)) : null,
    currentVisitThrows,
    teams,
    teamOf,
    paddock,
    flockSize,
    flock,
    pennedBy,
    dartsBy,
    phase,
    suddenDeathTeamIds,
    events,
    winnerTeamIds,
    winnerPlayerIds,
    finalStandings: isComplete ? ranked.flatMap((t) => t.playerIds) : [],
    finalTeamStandings: isComplete ? ranked.map((t) => t.id) : [],
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
 * Identifies a derived state so two screens can be compared. Sheep positions are in it because they
 * are rules output, not decoration — a divergence there is exactly the failure this exists to catch.
 */
export function hashState(state: GameState): string {
  return hash(
    JSON.stringify([
      state.currentPlayerId,
      state.pennedBy,
      state.phase,
      state.flock.map((s) => [s.id, s.at.x, s.at.y]),
      state.winnerPlayerIds,
      state.isComplete,
    ])
  );
}

/** Identifies the log a state was derived *from*, so screens a moment apart are not compared. */
export function hashLog(payload: ClientGamePayload): string {
  return hash(
    JSON.stringify(
      (payload?.visits ?? []).map((visit) => [visit.throws.map((t) => t.throwId), visit.ended])
    )
  );
}
