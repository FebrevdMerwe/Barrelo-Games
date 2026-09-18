import { type Ball, cloneBalls } from "./ball";
import { PHYSICS, SUBSTEP_DT } from "./constants";
import type { ShotEvent, TrajectoryFrame } from "./events";
import { step, type ShotContext, type SpinInput } from "./step";
import { length, normalize, type Vec2 } from "./vec2";

export interface SimulateOptions {
  /** Only the board's most recent shot needs a frame-by-frame trajectory to animate (see rules/types.ts). */
  recordTrajectory: boolean;
}

export interface ShotResult {
  finalBalls: Ball[];
  events: ShotEvent[];
  trajectory?: TrajectoryFrame[];
}

function snapshot(balls: readonly Ball[]): Record<string, Vec2> {
  const positions: Record<string, Vec2> = {};
  for (const ball of balls) positions[ball.id] = { ...ball.pos };
  return positions;
}

/**
 * Runs a full shot to rest. This is the ONLY simulation entry point in the codebase — `turnEngine.ts`
 * calls it once per shot while folding the visit log (headless replay), and the exact same call (with
 * `recordTrajectory: true`) is what `rules.ts` keeps as `GameState.lastShot.trajectory` for the board to
 * animate. Because both paths run identically the same function, they can never diverge (SCOPE.md §19.2's
 * "same code, run twice" without literally running the physics loop twice per state update).
 */
export function simulateShot(
  balls: readonly Ball[],
  cueBallId: string,
  cueVel: Vec2,
  spin: SpinInput,
  opts: SimulateOptions
): ShotResult {
  const working = cloneBalls(balls);
  const cue = working.find((b) => b.id === cueBallId);
  if (!cue) throw new Error(`simulateShot: no ball with id "${cueBallId}"`);
  const shotStartPos = { ...cue.pos };
  cue.vel = cueVel;

  const ctx: ShotContext = {
    cueBallId,
    shotDirection: normalize(cueVel, { x: 0, y: 1 }),
    spin,
    topSpinApplied: false,
    shotStartPos,
    initialSpeed: length(cueVel),
  };

  const events: ShotEvent[] = [];
  const trajectory: TrajectoryFrame[] | undefined = opts.recordTrajectory ? [] : undefined;

  let t = 0;
  if (trajectory) trajectory.push({ t, positions: snapshot(working) });

  for (let i = 0; i < PHYSICS.simulation.maxSubsteps; i++) {
    const moving = step(working, SUBSTEP_DT, t, events, ctx);
    t += SUBSTEP_DT;
    if (trajectory) trajectory.push({ t, positions: snapshot(working) });
    if (!moving) {
      events.push({ t, kind: "rest" });
      break;
    }
  }

  return { finalBalls: working, events, trajectory };
}
