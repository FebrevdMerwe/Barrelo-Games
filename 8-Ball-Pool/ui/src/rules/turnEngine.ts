import type { Ball } from "../physics/ball";
import { PHYSICS } from "../physics/constants";
import { simulateShot } from "../physics/simulate";
import { FOOT_SPOT, HEAD_SPOT } from "../physics/table";
import { normalize, scale, sub, length, type Vec2 } from "../physics/vec2";
import type { DetectedThrow, Visit } from "../../../shared/types";
import { placeCueBall } from "./ballInHand";
import { buildShotInput } from "./dartInterpretation";
import { detectFoul } from "./fouls";
import { resolveGroupAssignment } from "./groupAssignment";
import { recommendShot } from "./recommender";
import { vectorToNearestSegment } from "./segmentMapping";
import type { CompletedShot, Difficulty, Group, PocketedBallInfo, RecommendedShot, Team, TableState, TurnState } from "./types";
import { evaluateEightBall } from "./winCondition";

export function initialTurnState(teams: readonly Team[], seed: number): TurnState {
  // The match seed is the only source of randomness (§19.2) — used once, here, to pick who breaks.
  const breakingTeamIndex = teams.length > 0 ? seed % teams.length : 0;
  const memberIndexByGroup: Record<number, number> = {};
  for (const team of teams) memberIndexByGroup[team.groupIndex] = 0;
  return {
    teamIndex: breakingTeamIndex,
    memberIndexByGroup,
    breakingTeamIndex,
    hasBroken: false,
    ballInHandPending: false,
    ballInHandIsScratch: false,
  };
}

function currentShooter(teams: readonly Team[], turn: TurnState): { team: Team; playerId: string } {
  const team = teams[turn.teamIndex];
  const memberIndex = turn.memberIndexByGroup[team.groupIndex] % team.playerIds.length;
  return { team, playerId: team.playerIds[memberIndex] };
}

export function legalTargetsFor(table: TableState, teamGroupIndex: number): Ball[] {
  const remaining = table.balls.filter((b) => !b.pocketed && b.kind !== "cue");
  if (table.tableOpen) return remaining.filter((b) => b.kind !== "eight");

  const group = table.groupByTeam[teamGroupIndex] ?? null;
  const groupKind = group === "solids" ? "solid" : group === "stripes" ? "stripe" : null;
  if (!groupKind) return remaining.filter((b) => b.kind !== "eight"); // defensive: shouldn't happen once assigned

  const mine = remaining.filter((b) => b.kind === groupKind);
  if (mine.length > 0) return mine;
  const eight = remaining.filter((b) => b.kind === "eight");
  return eight.length > 0 ? eight : remaining; // defensive fallback, never returns empty mid-match
}

/** The break has no recommender tier — every difficulty aims straight at the apex ball (§16.2), shown as
 *  the recommended number exactly like any other Beginner/Intermediate target. */
function breakRecommendation(cuePos: { x: number; y: number }, apexBall: Ball): RecommendedShot {
  const dir = normalize(sub(FOOT_SPOT, cuePos));
  return {
    tier: "contact",
    targetBallNumber: apexBall.number,
    pocketId: null,
    aimUnitVector: dir,
    recommendedSegment: vectorToNearestSegment(dir),
    distance: length(sub(FOOT_SPOT, cuePos)),
  };
}

/** For display: the recommendation the current shooter is aiming at, independent of `applyVisit`'s fold —
 *  used to render the shot preview outside of processing an actual visit. */
export function computeRecommendation(
  table: TableState,
  teams: readonly Team[],
  turn: TurnState
): RecommendedShot {
  const { team } = currentShooter(teams, turn);
  const cueBall = table.balls.find((b) => b.id === "cue")!;
  if (!turn.hasBroken) {
    return breakRecommendation(cueBall.pos, table.balls.find((b) => b.number === 1)!);
  }
  const targets = legalTargetsFor(table, team.groupIndex);
  return recommendShot(cueBall.pos, targets, table.balls);
}

export { currentShooter };

function otherGroup(group: Group): Group {
  if (group === "solids") return "stripes";
  if (group === "stripes") return "solids";
  return null;
}

export interface ApplyVisitResult {
  table: TableState;
  turnState: TurnState;
  /** The last shot fired within this visit, if any (§23.1: a visit can hold more than one, when the same
   *  shooter's turn keeps continuing). */
  shot: CompletedShot | null;
  /** Set only when one of this visit's shots ends the match. */
  outcome: { winningGroupIndex: number } | null;
  /** Darts collected so far toward the shot still in progress at the end of this visit — empty once
   *  nothing is pending (every dart thrown was folded into a fired shot). */
  currentVisitThrows: DetectedThrow[];
  /** Every non-cue ball newly pocketed across all shots folded into this visit, in the order it dropped —
   *  unlike `shot`, which only reports the last one. Excludes any ball whose pocketed state was reversed
   *  later in the same visit (the break's re-spotted 8-ball, see below). */
  pocketedThisVisit: PocketedBallInfo[];
}

/**
 * Folds one visit (§23): interprets its darts for the shooting team into a shot, runs the physics, and
 * applies fouls/group-assignment/turn-continuation/win rules (§16-18).
 *
 * §23.1: a visit is one player's turn *at the board*, not one shot — as long as the same shooter's turn
 * keeps continuing (§16.4), their next shot's darts land in this same still-open visit, with no "End Turn"
 * in between. So this folds shots out of `visit.throws` one after another, only stopping (leaving the rest
 * as `currentVisitThrows`, still waiting to be interpreted) once there aren't enough darts yet for the shot
 * in progress, or once the turn passes to someone else — that's the one case that genuinely needs the next
 * "End Turn" to open a new visit before more darts can be attributed to the new shooter.
 */
export function applyVisit(
  table: TableState,
  turnState: TurnState,
  teams: readonly Team[],
  difficulty: Difficulty,
  visit: Visit,
  recordTrajectory: boolean
): ApplyVisitResult {
  let working: TableState = table;
  let turn = turnState;

  if (turn.ballInHandPending) {
    let pos: Vec2;
    if (turn.ballInHandIsScratch) {
      // Normal pool rules: a scratch respots the cue ball at its break position, rather than the
      // auto-placement grid search used for other fouls.
      pos = { ...HEAD_SPOT };
    } else {
      const { team } = currentShooter(teams, turn);
      const others = working.balls.filter((b) => b.id !== "cue");
      const targets = legalTargetsFor(working, team.groupIndex);
      pos = placeCueBall(others, targets);
    }
    const cue = working.balls.find((b) => b.id === "cue")!;
    working = {
      ...working,
      balls: working.balls.map((b) => (b.id === "cue" ? { ...cue, pos, pocketed: false, vel: { x: 0, y: 0 } } : b)),
    };
    turn = { ...turn, ballInHandPending: false, ballInHandIsScratch: false };
  }

  let shot: CompletedShot | null = null;
  let outcome: { winningGroupIndex: number } | null = null;
  let cursor = 0;
  const pocketedThisVisit: PocketedBallInfo[] = [];

  for (;;) {
    const darts = visit.throws.slice(cursor);
    if (darts.length === 0) break;

    const { team, playerId } = currentShooter(teams, turn);
    const isBreak = !turn.hasBroken;
    const cueBall = working.balls.find((b) => b.id === "cue")!;
    const targets = legalTargetsFor(working, team.groupIndex);

    const recommended = isBreak
      ? breakRecommendation(cueBall.pos, working.balls.find((b) => b.number === 1)!)
      : recommendShot(cueBall.pos, targets, working.balls);

    const built = buildShotInput(difficulty, darts, recommended, visit.ended, isBreak);
    if (built.status === "collecting") break;

    const { direction, power, spin } = built.input;
    const cueVel = scale(direction, power * PHYSICS.cueSpeed.max);
    const sim = simulateShot(working.balls, "cue", cueVel, spin, { recordTrajectory });

    const pocketedThisShot = sim.finalBalls.filter((b) => {
      const before = working.balls.find((orig) => orig.id === b.id)!;
      return b.pocketed && !before.pocketed;
    });

    let newBalls = sim.finalBalls;
    const foul = detectFoul(newBalls.find((b) => b.id === "cue")!, sim.events);

    let tableOpen = working.tableOpen;
    let groupByTeam = working.groupByTeam;
    let groupAssigned = false;
    let shotOutcome: { winningGroupIndex: number } | null = null;

    const eightPocketed = pocketedThisShot.some((b) => b.kind === "eight");

    if (isBreak) {
      // §16.2: the table stays open no matter what, and the 8-ball is re-spotted rather than ending anything.
      if (eightPocketed) {
        newBalls = newBalls.map((b) => (b.kind === "eight" ? { ...b, pocketed: false, pos: { ...FOOT_SPOT } } : b));
      }
    } else if (eightPocketed) {
      const shooterGroup = working.groupByTeam[team.groupIndex] ?? null;
      const groupKind = shooterGroup === "solids" ? "solid" : shooterGroup === "stripes" ? "stripe" : null;
      const shooterGroupRemaining = groupKind
        ? newBalls.filter((b) => b.kind === groupKind && !b.pocketed).length
        : 0;
      const result = evaluateEightBall({ shooterGroup, shooterGroupRemaining, foul });
      const winningGroupIndex = result === "win" ? team.groupIndex : teams.find((t) => t !== team)!.groupIndex;
      shotOutcome = { winningGroupIndex };
    } else if (!foul) {
      const objectBallsPocketed = pocketedThisShot.filter((b) => b.kind === "solid" || b.kind === "stripe");
      if (working.tableOpen && objectBallsPocketed.length > 0) {
        const assigned = resolveGroupAssignment(objectBallsPocketed, sim.events);
        if (assigned) {
          const opponent = teams.find((t) => t !== team)!;
          groupByTeam = { ...groupByTeam, [team.groupIndex]: assigned, [opponent.groupIndex]: otherGroup(assigned) };
          tableOpen = false;
          groupAssigned = true;
        }
      }
    }

    const wasOpen = working.tableOpen;
    const myGroupKind =
      working.groupByTeam[team.groupIndex] === "solids"
        ? "solid"
        : working.groupByTeam[team.groupIndex] === "stripes"
          ? "stripe"
          : null;
    const turnContinues =
      !shotOutcome &&
      !foul &&
      (wasOpen
        ? pocketedThisShot.some((b) => b.kind === "solid" || b.kind === "stripe")
        : pocketedThisShot.some((b) => myGroupKind !== null && b.kind === myGroupKind));

    working = { balls: newBalls, tableOpen, groupByTeam };

    for (const b of pocketedThisShot) {
      if (b.kind === "cue") continue;
      if (!newBalls.find((nb) => nb.id === b.id)?.pocketed) continue; // e.g. the break's re-spotted 8-ball
      pocketedThisVisit.push({ ballId: b.id, number: b.number, kind: b.kind });
    }

    turn = { ...turn, hasBroken: true };
    if (foul) turn = { ...turn, ballInHandPending: true, ballInHandIsScratch: foul === "scratch" };
    if (!turnContinues && !shotOutcome) {
      const advancedMember = (turn.memberIndexByGroup[team.groupIndex] + 1) % team.playerIds.length;
      turn = {
        ...turn,
        memberIndexByGroup: { ...turn.memberIndexByGroup, [team.groupIndex]: advancedMember },
        teamIndex: (turn.teamIndex + 1) % teams.length,
      };
    }

    cursor += built.consumed;

    shot = {
      shooterPlayerId: playerId,
      shooterGroupIndex: team.groupIndex,
      input: built.input,
      events: sim.events,
      trajectory: sim.trajectory,
      foul,
      groupAssigned,
      turnContinues,
      isBreak,
      dartsIntoVisit: cursor,
    };

    if (shotOutcome) {
      outcome = shotOutcome;
      break;
    }
    if (!turnContinues) break; // turn passes — the next shooter's darts wait for an actual new visit
  }

  return {
    table: working,
    turnState: turn,
    shot,
    outcome,
    currentVisitThrows: visit.throws.slice(cursor),
    pocketedThisVisit,
  };
}
