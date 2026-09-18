import type { Ball, BallKind } from "../physics/ball";
import type { ShotEvent, TrajectoryFrame } from "../physics/events";
import type { Vec2 } from "../physics/vec2";
import type { DetectedThrow } from "../../../shared/types";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export type Group = "solids" | "stripes" | null;

export type FoulReason = "scratch" | "noContact";

/**
 * One side in the match. A solo player is a team of one — mirrors the template's `Team`, kept here so
 * every rules module (not just rules.ts) can reference it without a cycle back to the composition root.
 */
export interface Team {
  groupIndex: number;
  playerIds: string[];
}

export interface TableState {
  balls: Ball[];
  tableOpen: boolean;
  /** Team group index -> assigned ball group. Both entries are null while the table is open. */
  groupByTeam: Record<number, Group>;
}

export type ShotPhase =
  | { kind: "awaitingDarts" }
  | { kind: "collecting"; step: "direction" | "power" | "spin"; darts: DetectedThrow[] }
  | { kind: "ballInHand" };

export interface RecommendedShot {
  tier: "pot" | "contact" | "fallback";
  targetBallNumber: number;
  pocketId: string | null;
  /** The recommender's exact aim angle — what a successful Beginner/Intermediate hit snaps to (§6.4). */
  aimUnitVector: Vec2;
  recommendedSegment: number;
  /** Total travel distance the shot estimates (pot: cue→ghost + ball→pocket; otherwise cue→target) —
   *  feeds automatic power (§6.6) even outside Beginner mode, as the §23.3 "power missing" fallback. */
  distance: number;
}

export interface ShotPreview {
  recommendedSegment: number | null;
  aimUnitVector: Vec2 | null;
  targetBallNumber: number | null;
  pocketId: string | null;
  tier: "pot" | "contact" | "fallback" | null;
  directionLocked: Vec2 | null;
  power: number | null;
  spin: { top: number; side: number } | null;
}

export interface ShotInput {
  direction: Vec2;
  power: number;
  spin: { top: number; side: number };
  /** The recommender snapshot the direction dart was measured against, for shot-preview display. */
  recommended: RecommendedShot | null;
}

/** One entry in `GameState.pocketedOrder` — the ball as it was when it dropped, for tray rendering. */
export interface PocketedBallInfo {
  ballId: string;
  number: number;
  kind: BallKind;
}

export interface CompletedShot {
  shooterPlayerId: string;
  shooterGroupIndex: number;
  input: ShotInput;
  events: ShotEvent[];
  /** Present only on `GameState.lastShot` — see physics/simulate.ts's doc comment. */
  trajectory?: TrajectoryFrame[];
  foul: FoulReason | null;
  groupAssigned: boolean;
  turnContinues: boolean;
  isBreak: boolean;
  /** How many of the owning visit's darts had been consumed once this shot fired. `replay()` rebuilds an
   *  identical `CompletedShot` object (new reference, same content) on every unrelated state push, so this
   *  — combined with the visit's index, see `rules.ts`'s `lastShotId` — gives a stable per-shot identity
   *  the board can key its replay animation off, instead of reference equality. */
  dartsIntoVisit: number;
}

export interface TurnState {
  teamIndex: number;
  memberIndexByGroup: Record<number, number>;
  breakingTeamIndex: number;
  hasBroken: boolean;
  ballInHandPending: boolean;
  /** True when the pending ball-in-hand came from a scratch specifically — the cue ball respots to
   *  `HEAD_SPOT` rather than the auto-placement grid search (§18.1 covers non-scratch fouls only). */
  ballInHandIsScratch: boolean;
}

export interface GameState {
  teams: Team[];
  currentPlayerId: string | null;
  currentGroupIndex: number | null;
  currentVisitThrows: DetectedThrow[];
  difficulty: Difficulty;
  table: TableState;
  shotPhase: ShotPhase;
  shotPreview: ShotPreview | null;
  lastShot: CompletedShot | null;
  /** `${visitIndex}:${dartsIntoVisit}` for `lastShot`, or null when there is none yet — a stable identity
   *  for "which shot is this" that survives `lastShot` being a freshly-rebuilt object every replay. See
   *  `CompletedShot.dartsIntoVisit`. */
  lastShotId: string | null;
  /** Every non-cue ball ever pocketed, in the order it dropped. Survives across shots (unlike
   *  `lastShot`), for a "sunk balls" tray. Excludes the break's re-spotted 8-ball. */
  pocketedOrder: PocketedBallInfo[];
  ballInHandPending: boolean;
  foulBanner: FoulReason | null;
  winnerPlayerIds: string[];
  finalStandings: string[];
  isComplete: boolean;
}
