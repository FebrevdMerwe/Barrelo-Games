import type { ClientGamePayload, DetectedThrow } from '../../shared/types';
import { courseFor, type Hole, type Vec } from './holes';
import { puttVectorFor, type PuttVector } from './putt';
import { createEngine, runPutt } from './simulate';

/**
 * Putt Putt's rules — a pure fold over the visit log, and the only place the game's decisions live.
 *
 * This file runs the physics itself, headlessly, rather than asking the board where the ball went.
 * That is deliberate: whose turn it is, whether a hole is finished and whether the match is over all
 * depend on ball position, and Barrelo needs those answers from replay(). If the ball only existed
 * in the renderer, the turn indicator, the dart slots and matchComplete would all have nothing to
 * read, and two screens would derive different matches from the same log.
 *
 * The unit that plays is a *team*, not a player: one ball, one stroke count, one line on the card,
 * with team-mates taking it in turns to strike it. A team of one is a solo player, which is why the
 * solo game needs no separate code path — it is the degenerate case of the team game, and a roster
 * with everyone in their own group replays exactly as it did before teams existed.
 *
 * The purity rules from the template still apply and are load-bearing here:
 *   - No Math.random(), no Date.now(), no crypto.randomUUID(), no module-level mutable state.
 *   - Anything random must come from rng(payload.seed). Nothing in this game currently needs it.
 *
 * There is deliberately no memoisation cache. Replaying a full 4-team round from scratch is on the
 * order of twenty thousand Matter steps over ten bodies, which is a few tens of milliseconds — far
 * cheaper than the risk of a subtly wrong cache reintroducing exactly the divergence the fold exists
 * to prevent. The one optimisation that does matter is reusing a single engine across every putt in
 * a replay: Engine.create() is the expensive call, stepping is not.
 */

export const MAX_STROKES = 6;
export const MAX_PLAYERS = 8;

/**
 * One ball's worth of players. Built from `payload.playerGroups`, which is Barrelo's team assignment
 * — the host's start screen fills it in because plugin.json declares a `playerGroup` setting.
 *
 * `index` is the position in team order, and therefore the seat the ball colour comes from. Everything
 * scored — strokes, cards, totals, ball position — is keyed by `id`, never by a player id.
 */
export interface Team {
  id: string;
  index: number;
  /** Members in roster order; the order they take strokes in. Never empty. */
  playerIds: string[];
}

export type GameEvent =
  | {
      key: string;
      type: 'putt';
      teamId: string;
      /** Which team-mate struck it — the rotation is a rule, so the replay decides this too. */
      playerId: string;
      holeIndex: number;
      from: Vec;
      vector: PuttVector;
      to: Vec;
      outcome: 'rest' | 'holed' | 'water';
      strokeNumber: number;
    }
  /** A dart thrown by a team already finished on this hole, or after the match ended. */
  | { key: string; type: 'spare'; teamId: string; playerId: string }
  | { key: string; type: 'pickedUp'; teamId: string; holeIndex: number }
  /** `scores` is per team, keyed by team id — the whole card is. */
  | { key: string; type: 'holeComplete'; holeIndex: number; scores: Record<string, number> }
  | { key: string; type: 'holeStart'; holeIndex: number }
  | { key: string; type: 'turnChanged'; teamId: string; playerId: string }
  | { key: string; type: 'victory'; winnerPlayerIds: string[] };

export interface GameState {
  /** The team at the board, and the team-mate whose stroke it is. Both null once the match is over. */
  currentTeamId: string | null;
  currentPlayerId: string | null;
  currentVisitThrows: DetectedThrow[];

  /** The sides in play, in team order. A solo match is simply a list of one-player teams. */
  teams: Team[];
  /** Team id by player id, for looking up who is on what without walking `teams`. */
  teamOf: Record<string, string>;

  /** The hole sequence being played, after the course option is applied. */
  course: Hole[];
  /** Index into `course` of the hole in play; equals course.length once the match is over. */
  holeIndex: number;

  /** Strokes taken on the hole in play, per team. */
  strokes: Record<string, number>;
  /** Finished this hole — holed out or picked up at the cap. Per team. */
  finished: Record<string, boolean>;
  /** Ball position on the hole in play, per team. One ball per side. */
  ballPos: Record<string, Vec>;
  /** Completed holes, in order, per team. */
  card: Record<string, number[]>;
  /** Sum of `card`, per team. */
  totals: Record<string, number>;

  events: GameEvent[];
  /** Teams that won, best-first ordering aside — usually one, more only on an exact tie. */
  winnerTeamIds: string[];
  /** The same result as player ids, which is what Barrelo validates and awards points from. */
  winnerPlayerIds: string[];
  /** Every player, best team first, team-mates consecutive — the shape the leaderboard chunks. */
  finalStandings: string[];
  /** The same order as team ids, which is what the final table on the rail is drawn from. */
  finalTeamStandings: string[];
  isComplete: boolean;
  /** Non-null when the roster can't be played; protocol v2 has no /create hook to reject it at. */
  configError: string | null;
}

/**
 * mulberry32, seeded from payload.seed. The only permitted source of randomness. Nothing in Putt
 * Putt uses it today — the course is authored and the physics is deterministic — but it is kept so
 * that anything added later reaches for this rather than Math.random().
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
 * with it every ball colour, is a function of the roster alone and identical on every screen.
 *
 * A player Barrelo has no group for plays alone. That is not a defensive nicety: it is what makes a
 * payload with no `playerGroups` at all — an older host, a harness, the dev preview — a solo match
 * rather than one enormous team, and it is why declaring teams costs the solo game nothing.
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
      team = { id: key, index: teams.length, playerIds: [] };
      byKey.set(key, team);
      teams.push(team);
    }
    team.playerIds.push(playerId);
  }

  return teams;
}

interface Fold {
  turnIndex: number;
  /** Per team, which member takes the next visit. Advances on every turn boundary. */
  memberIndex: Record<string, number>;
  holeIndex: number;
  strokes: Record<string, number>;
  finished: Record<string, boolean>;
  ballPos: Record<string, Vec>;
  card: Record<string, number[]>;
  complete: boolean;
}

/** The team-mate at the board for `team`, from its rotation cursor. */
function strikerOf(fold: Fold, team: Team): string {
  return team.playerIds[fold.memberIndex[team.id] % team.playerIds.length];
}

function startHole(fold: Fold, teams: Team[], hole: Hole): void {
  for (const team of teams) {
    fold.strokes[team.id] = 0;
    fold.finished[team.id] = false;
    fold.ballPos[team.id] = { x: hole.tee.x, y: hole.tee.y };
  }
}

/** Next team in order that still has the hole to finish; stays put if nobody does. */
function nextTurn(fold: Fold, teams: Team[]): number {
  for (let i = 1; i <= teams.length; i++) {
    const index = (fold.turnIndex + i) % teams.length;
    if (!fold.finished[teams[index].id]) return index;
  }
  return fold.turnIndex;
}

export function replay(payload: ClientGamePayload): GameState {
  // Defaulted rather than destructured: the board renders before the first real snapshot arrives,
  // and an exception here is a blank sandboxed iframe with a stack trace nobody is watching.
  const playerIds = payload?.playerIds ?? [];
  const visits = payload?.visits ?? [];
  const course = courseFor(payload?.options);

  const teams = teamsOf(playerIds, payload?.playerGroups);
  const teamOf: Record<string, string> = {};
  for (const team of teams) {
    for (const playerId of team.playerIds) teamOf[playerId] = team.id;
  }

  const strokes: Record<string, number> = {};
  const finished: Record<string, boolean> = {};
  const ballPos: Record<string, Vec> = {};
  const card: Record<string, number[]> = {};
  const memberIndex: Record<string, number> = {};
  for (const team of teams) {
    card[team.id] = [];
    memberIndex[team.id] = 0;
  }

  // An empty roster is the pre-match/dev-boot idle state, not a misconfiguration.
  const configError =
    playerIds.length > MAX_PLAYERS ? `Putt Putt supports at most ${MAX_PLAYERS} players.` : null;

  const idle = (): GameState => ({
    currentTeamId: null,
    currentPlayerId: null,
    currentVisitThrows: [],
    teams,
    teamOf,
    course,
    holeIndex: 0,
    strokes,
    finished,
    ballPos,
    card,
    totals: totalsOf(teams, card),
    events: [],
    winnerTeamIds: [],
    winnerPlayerIds: [],
    finalStandings: [],
    finalTeamStandings: [],
    isComplete: false,
    configError,
  });

  if (configError !== null || teams.length === 0 || course.length === 0) return idle();

  const fold: Fold = {
    turnIndex: 0,
    memberIndex,
    holeIndex: 0,
    strokes,
    finished,
    ballPos,
    card,
    complete: false,
  };
  startHole(fold, teams, course[0]);

  const events: GameEvent[] = [{ key: 'hole-start-0', type: 'holeStart', holeIndex: 0 }];
  const engine = createEngine();

  for (const visit of visits) {
    if (fold.complete) break;

    // Defensive: the turn should never be resting on a team that has already finished the hole,
    // but if it somehow is, hand it to whoever is actually still playing rather than eating darts.
    if (fold.finished[teams[fold.turnIndex].id]) fold.turnIndex = nextTurn(fold, teams);

    // Both are fixed for the whole visit. The darts in someone's hand stay theirs even if the hole
    // finishes underneath them — they keep putting their side's ball, on whatever hole it is on now.
    const team = teams[fold.turnIndex];
    const playerId = strikerOf(fold, team);
    let holeCompletedInVisit = false;

    for (const dart of visit.throws) {
      if (fold.complete || fold.finished[team.id]) {
        events.push({ key: `${dart.throwId}:spare`, type: 'spare', teamId: team.id, playerId });
        continue;
      }

      const hole = course[fold.holeIndex];
      const from = fold.ballPos[team.id];
      const vector = puttVectorFor(dart);
      const result = runPutt(engine, hole, from, vector);

      fold.strokes[team.id] += 1;
      // Water costs the putt and a penalty stroke, and puts the ball back where it was struck from.
      if (result.outcome === 'water') fold.strokes[team.id] += 1;
      fold.ballPos[team.id] = result.end;

      events.push({
        key: `${dart.throwId}:putt`,
        type: 'putt',
        teamId: team.id,
        playerId,
        holeIndex: fold.holeIndex,
        from: { x: from.x, y: from.y },
        vector,
        to: result.end,
        outcome: result.outcome,
        strokeNumber: fold.strokes[team.id],
      });

      if (result.outcome === 'holed') {
        fold.finished[team.id] = true;
        fold.card[team.id].push(fold.strokes[team.id]);
      } else if (fold.strokes[team.id] >= MAX_STROKES) {
        // Pick up at the cap and take it. A water penalty can push the count past MAX_STROKES, so
        // the recorded score is clamped — you can never score worse than picking up.
        fold.finished[team.id] = true;
        fold.card[team.id].push(MAX_STROKES);
        events.push({
          key: `${dart.throwId}:pickedUp`,
          type: 'pickedUp',
          teamId: team.id,
          holeIndex: fold.holeIndex,
        });
      }

      if (teams.every((side) => fold.finished[side.id])) {
        const scores: Record<string, number> = {};
        for (const side of teams) scores[side.id] = fold.card[side.id][fold.holeIndex];
        events.push({
          key: `${dart.throwId}:holeComplete`,
          type: 'holeComplete',
          holeIndex: fold.holeIndex,
          scores,
        });

        fold.holeIndex += 1;
        holeCompletedInVisit = true;

        if (fold.holeIndex >= course.length) {
          fold.complete = true;
        } else {
          // Every hole is teed off in team order, so the pointer goes back to the first team.
          startHole(fold, teams, course[fold.holeIndex]);
          fold.turnIndex = 0;
          events.push({
            key: `${dart.throwId}:hole-start-${fold.holeIndex}`,
            type: 'holeStart',
            holeIndex: fold.holeIndex,
          });
        }
      }
    }

    if (visit.ended && !fold.complete) {
      // Alternate shot: the next visit this side takes belongs to the next team-mate. The cursor is
      // deliberately not reset at a hole boundary — carrying it across the course is what shares the
      // tee shots out, instead of one member teeing off on all nine.
      fold.memberIndex[team.id] = (fold.memberIndex[team.id] + 1) % team.playerIds.length;

      // When a hole finished inside this visit the pointer was already reset to the first team of
      // the new hole; advancing again here would skip them.
      if (!holeCompletedInVisit) fold.turnIndex = nextTurn(fold, teams);

      const upNext = teams[fold.turnIndex];
      events.push({
        key: `${visit.throws[visit.throws.length - 1]?.throwId ?? `visit-${events.length}`}:turn`,
        type: 'turnChanged',
        teamId: upNext.id,
        playerId: strikerOf(fold, upNext),
      });
    }
  }

  const totals = totalsOf(teams, card);
  const lastVisit = visits[visits.length - 1];
  const currentVisitThrows = lastVisit && !lastVisit.ended ? lastVisit.throws : [];

  let winnerTeamIds: string[] = [];
  let winnerPlayerIds: string[] = [];
  let finalStandings: string[] = [];
  let finalTeamStandings: string[] = [];
  if (fold.complete) {
    const standings = rank(teams, card, totals);
    finalTeamStandings = standings.map((side) => side.id);
    // Team-mates are listed consecutively, which is exactly what Barrelo's leaderboard relies on: it
    // chunks finalStandings into runs sharing a group index to recover who tied for which placing.
    finalStandings = standings.flatMap((side) => side.playerIds);
    const best = standings[0];
    const winners = teams.filter((side) => compareScores(side.id, best.id, card, totals) === 0);
    winnerTeamIds = winners.map((side) => side.id);
    winnerPlayerIds = winners.flatMap((side) => side.playerIds);
    events.push({ key: 'victory', type: 'victory', winnerPlayerIds });
  }

  const current = fold.complete ? null : teams[fold.turnIndex];

  return {
    currentTeamId: current?.id ?? null,
    currentPlayerId: current ? strikerOf(fold, current) : null,
    currentVisitThrows,
    teams,
    teamOf,
    course,
    holeIndex: fold.holeIndex,
    strokes,
    finished,
    ballPos,
    card,
    totals,
    events,
    winnerTeamIds,
    winnerPlayerIds,
    finalStandings,
    finalTeamStandings,
    isComplete: fold.complete,
    configError,
  };
}

function totalsOf(teams: Team[], card: Record<string, number[]>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const team of teams) {
    totals[team.id] = (card[team.id] ?? []).reduce((sum, score) => sum + score, 0);
  }
  return totals;
}

/**
 * Stroke play: fewest strokes wins. Level totals are settled by countback — fewest strokes on the
 * last hole, then the hole before it, and so on back down the card. Returns 0 only for two teams
 * that scored identically on every single hole.
 */
function compareScores(
  a: string,
  b: string,
  card: Record<string, number[]>,
  totals: Record<string, number>
): number {
  if (totals[a] !== totals[b]) return totals[a] - totals[b];
  const cardA = card[a] ?? [];
  const cardB = card[b] ?? [];
  for (let hole = Math.max(cardA.length, cardB.length) - 1; hole >= 0; hole--) {
    const scoreA = cardA[hole] ?? 0;
    const scoreB = cardB[hole] ?? 0;
    if (scoreA !== scoreB) return scoreA - scoreB;
  }
  return 0;
}

/**
 * Best-first ordering of every side, which expanded into players is what Barrelo validates
 * finalStandings against. Team order is the last resort so that sides level on every hole still get
 * a stable, identical order on every screen.
 */
function rank(teams: Team[], card: Record<string, number[]>, totals: Record<string, number>): Team[] {
  return [...teams].sort((a, b) => {
    const byScore = compareScores(a.id, b.id, card, totals);
    return byScore !== 0 ? byScore : a.index - b.index;
  });
}

/** Total par for the course actually being played. */
export function parTotal(course: Hole[]): number {
  return course.reduce((sum, hole) => sum + hole.par, 0);
}

/** Par for the holes a team has actually completed — the basis for the running vs-par figure. */
export function parThrough(course: Hole[], holesPlayed: number): number {
  return course.slice(0, holesPlayed).reduce((sum, hole) => sum + hole.par, 0);
}

function hash(canonical: string): string {
  let value = 0;
  for (let i = 0; i < canonical.length; i++) {
    value = (Math.imul(31, value) + canonical.charCodeAt(i)) | 0;
  }
  return (value >>> 0).toString(16);
}

export function hashState(state: GameState): string {
  // Ball positions are rounded to whole course units before hashing. They are floating-point
  // results and the hash only exists to answer "did two screens derive the same match?" — a
  // sub-unit difference is not a disagreement worth reporting, and rounding costs nothing.
  const positions = Object.keys(state.ballPos)
    .sort()
    .map((id) => [id, Math.round(state.ballPos[id].x), Math.round(state.ballPos[id].y)]);

  return hash(
    JSON.stringify([
      state.currentTeamId,
      // Included because the rotation within a team is a rule too: two screens that disagreed about
      // which team-mate is up would be disagreeing about the match, not about presentation.
      state.currentPlayerId,
      state.holeIndex,
      state.strokes,
      state.finished,
      positions,
      state.card,
      state.winnerPlayerIds,
      state.isComplete,
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
