import type { ClientGamePayload, DetectedThrow } from "../../shared/types";
import { initialRack } from "./physics/ball";
import { HEAD_SPOT } from "./physics/table";
import { placeCueBall } from "./rules/ballInHand";
import { deriveShotProgress } from "./rules/dartInterpretation";
import { applyVisit, computeRecommendation, currentShooter, initialTurnState, legalTargetsFor } from "./rules/turnEngine";
import type {
  CompletedShot,
  Difficulty,
  FoulReason,
  GameState,
  PocketedBallInfo,
  RecommendedShot,
  ShotPhase,
  ShotPreview,
  Team,
  TableState,
  TurnState,
} from "./rules/types";

export type { Team, GameState } from "./rules/types";

/**
 * A tiny deterministic PRNG (mulberry32), seeded from the payload. `turnEngine.initialTurnState` calls it
 * exactly once, to pick who breaks — every other draw of randomness in this game (there isn't one; the
 * physics engine is fully deterministic given its inputs) must go through the same seed.
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
 * Resolves a player's team: their explicit assignment in `playerGroups` if present, otherwise their own
 * roster position — an implicit team of one. Mirrors the host's `GameSetupExtensions.EffectiveGroupIndex`
 * exactly, which is what makes a game written against teams still play correctly when Barrelo hands it an
 * ungrouped roster.
 */
export function effectiveGroupIndex(payload: ClientGamePayload, playerId: string): number {
  const assigned = payload?.playerGroups?.[playerId];
  if (typeof assigned === "number") return assigned;
  return (payload?.playerIds ?? []).indexOf(playerId);
}

/**
 * Folds the roster into teams, ordered by group index and each holding its members in roster order.
 * Only teams with at least one member exist — Barrelo's start screen hands over contiguous group
 * indices, but an empty bucket would otherwise become a phantom side that can never throw.
 */
export function buildTeams(payload: ClientGamePayload): Team[] {
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
    .map(([groupIndex, memberIds]) => ({ groupIndex, playerIds: memberIds }));
}

function parseDifficulty(value: string | undefined): Difficulty {
  return value === "intermediate" || value === "advanced" ? value : "beginner";
}

function emptyState(difficulty: Difficulty): GameState {
  return {
    teams: [],
    currentPlayerId: null,
    currentGroupIndex: null,
    currentVisitThrows: [],
    difficulty,
    table: { balls: initialRack(), tableOpen: true, groupByTeam: {} },
    shotPhase: { kind: "awaitingDarts" },
    shotPreview: null,
    lastShot: null,
    lastShotId: null,
    pocketedOrder: [],
    ballInHandPending: false,
    foulBanner: null,
    winnerPlayerIds: [],
    finalStandings: [],
    isComplete: false,
  };
}

function buildShotPreview(
  recommended: RecommendedShot,
  difficulty: Difficulty,
  darts: readonly DetectedThrow[],
  lastShot: CompletedShot | null,
  shotJustFired: boolean
): ShotPreview {
  if (shotJustFired && lastShot) {
    return {
      recommendedSegment: difficulty === "advanced" ? null : recommended.recommendedSegment,
      aimUnitVector: recommended.aimUnitVector,
      targetBallNumber: recommended.targetBallNumber,
      pocketId: recommended.pocketId,
      tier: recommended.tier,
      directionLocked: lastShot.input.direction,
      power: lastShot.input.power,
      spin: lastShot.input.spin,
    };
  }
  const progress = deriveShotProgress(difficulty, darts, recommended);
  return {
    recommendedSegment: difficulty === "advanced" ? null : recommended.recommendedSegment,
    aimUnitVector: recommended.aimUnitVector,
    targetBallNumber: recommended.targetBallNumber,
    pocketId: recommended.pocketId,
    tier: recommended.tier,
    directionLocked: progress.directionLocked,
    power: null,
    spin: null,
  };
}

function shotPhaseFor(turn: TurnState, difficulty: Difficulty, darts: readonly DetectedThrow[], recommended: RecommendedShot): ShotPhase {
  if (turn.ballInHandPending) return { kind: "ballInHand" };
  if (darts.length === 0) return { kind: "awaitingDarts" };
  return { kind: "collecting", step: deriveShotProgress(difficulty, darts, recommended).step, darts: [...darts] };
}

/**
 * The only rules entry point. A pure fold over `payload.visits` (§19.1-19.2's determinism contract — see
 * the README) that composes the physics engine (`physics/`) and the pool rules (`rules/`) into the state
 * Barrelo's board renders. Every module it calls is itself pure, so this function is too.
 */
export function replay(payload: ClientGamePayload): GameState {
  const visits = payload?.visits ?? [];
  const teams = buildTeams(payload);
  const difficulty = parseDifficulty(payload?.options?.["difficulty"]);

  if (teams.length === 0) return emptyState(difficulty);

  let table: TableState = { balls: initialRack(), tableOpen: true, groupByTeam: {} };
  let turn = initialTurnState(teams, payload?.seed ?? 0);
  let lastShot: CompletedShot | null = null;
  let lastShotId: string | null = null;
  let currentVisitThrows: DetectedThrow[] = [];
  let winningGroupIndex: number | null = null;
  let shotJustFired = false;
  let pocketedOrder: PocketedBallInfo[] = [];

  for (let i = 0; i < visits.length; i++) {
    const visit = visits[i];
    const isLastVisit = i === visits.length - 1;
    const result = applyVisit(table, turn, teams, difficulty, visit, isLastVisit);
    table = result.table;
    turn = result.turnState;
    shotJustFired = result.shot !== null && result.currentVisitThrows.length === 0;
    if (result.shot) {
      lastShot = result.shot;
      lastShotId = `${i}:${result.shot.dartsIntoVisit}`;
    }
    currentVisitThrows = result.currentVisitThrows;
    if (result.pocketedThisVisit.length > 0) pocketedOrder = [...pocketedOrder, ...result.pocketedThisVisit];

    if (result.outcome) {
      winningGroupIndex = result.outcome.winningGroupIndex;
      break;
    }
  }

  const isComplete = winningGroupIndex !== null;
  const winningTeam = isComplete ? teams.find((t) => t.groupIndex === winningGroupIndex) ?? null : null;
  const losingTeams = teams.filter((t) => t !== winningTeam);

  // §18.1's placement is deterministic given the frozen board it's fired from (nothing moves between the
  // fouling shot and the next visit's darts), so previewing it here — before that visit even exists — is
  // exactly the position `applyVisit` will later commit. Without this, the cue ball stays hidden mid-pocket
  // (or wherever the foul left it) for the whole "BALL IN HAND" phase, with nothing on the table to aim at.
  if (!isComplete && turn.ballInHandPending) {
    let pos;
    if (turn.ballInHandIsScratch) {
      pos = { ...HEAD_SPOT };
    } else {
      const { team } = currentShooter(teams, turn);
      const others = table.balls.filter((b) => b.id !== "cue");
      const targets = legalTargetsFor(table, team.groupIndex);
      pos = placeCueBall(others, targets);
    }
    const cue = table.balls.find((b) => b.id === "cue")!;
    table = { ...table, balls: table.balls.map((b) => (b.id === "cue" ? { ...cue, pos, pocketed: false, vel: { x: 0, y: 0 } } : b)) };
  }

  const { team: shooterTeam, playerId: currentPlayerId } = currentShooter(teams, turn);
  const recommended = computeRecommendation(table, teams, turn);

  const shotPreview = isComplete ? null : buildShotPreview(recommended, difficulty, currentVisitThrows, lastShot, shotJustFired);
  const shotPhase = isComplete ? { kind: "awaitingDarts" as const } : shotPhaseFor(turn, difficulty, currentVisitThrows, recommended);

  const foulBanner: FoulReason | null = shotJustFired && lastShot ? lastShot.foul : null;

  return {
    teams,
    currentPlayerId,
    currentGroupIndex: shooterTeam.groupIndex,
    currentVisitThrows,
    difficulty,
    table,
    shotPhase,
    shotPreview,
    lastShot,
    lastShotId,
    pocketedOrder,
    ballInHandPending: turn.ballInHandPending,
    foulBanner,
    winnerPlayerIds: winningTeam ? winningTeam.playerIds : [],
    finalStandings: winningTeam ? [...winningTeam.playerIds, ...losingTeams.flatMap((t) => t.playerIds)] : [],
    isComplete,
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
 * Identifies a derived state so two screens can be compared. Covers every field a rules bug could get
 * wrong (ball positions/pocketed flags, groups, whose turn, win state) without needing to serialize the
 * (potentially large) `lastShot.trajectory`, which is animation-only and never affects correctness.
 */
export function hashState(state: GameState): string {
  return hash(
    JSON.stringify([
      state.currentPlayerId,
      state.difficulty,
      state.table.balls.map((b) => [b.id, b.pos.x, b.pos.y, b.pocketed]),
      state.pocketedOrder.map((b) => b.ballId),
      state.table.tableOpen,
      state.table.groupByTeam,
      state.shotPhase,
      state.winnerPlayerIds,
      state.isComplete,
    ])
  );
}

/**
 * Identifies the log a state was derived *from*. Barrelo compares screens by pairing this with
 * hashState: two screens observing the match a moment apart hold different logs and aren't compared,
 * so only a genuine same-input/different-output disagreement is reported.
 *
 * Hashed over each dart's identity and the visit boundaries — the whole of the input replay() reads.
 */
export function hashLog(payload: ClientGamePayload): string {
  return hash(
    JSON.stringify(
      (payload?.visits ?? []).map((visit) => [visit.throws.map((t) => t.throwId), visit.ended])
    )
  );
}
