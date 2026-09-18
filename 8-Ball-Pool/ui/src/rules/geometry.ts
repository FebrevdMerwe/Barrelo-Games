import type { Ball } from "../physics/ball";
import { BALL_RADIUS } from "../physics/constants";
import type { Pocket } from "../physics/table";
import { closestPointOnSegment, dot, length, normalize, scale, sub, type Vec2 } from "../physics/vec2";

/**
 * Precomputed `cos(60°)` (see constants.ts's WEDGE_UNIT_VECTORS comment for why this is a literal, not a
 * runtime `Math.cos` call). A cut steeper than 60° is rejected as unmakeable by the recommender (§25.2) —
 * tuned empirically against the physics engine's own cut-accuracy validation gate (§19.4): beyond ~65°
 * the power a shot needs to reach the pocket scales as 1/cos²(angle), which both pushes many shots past
 * the cue's max speed and amplifies any residual aim error into a much larger miss distance, so an MVP
 * value here trades away extreme-thin-cut recommendations for a reliably makeable "pot" tier.
 */
export const COS_MAX_CUT_ANGLE = 0.5000000000000001;

/** The aim point behind the object ball a ghost cue ball must occupy to send it toward `pocket` (§25.2). */
export function ghostBallPosition(objectBallPos: Vec2, pocketPos: Vec2): Vec2 {
  const toPocket = normalize(sub(pocketPos, objectBallPos));
  return sub(objectBallPos, scale(toPocket, 2 * BALL_RADIUS));
}

/**
 * True if any ball in `obstacles` (other than the ones in `excludeIds`) lies close enough to segment
 * [from,to] to intercept a ball travelling along it. Used for both the cue→ghost path and the
 * object-ball→pocket path (§25.2).
 */
export function pathBlocked(
  from: Vec2,
  to: Vec2,
  obstacles: readonly Ball[],
  excludeIds: ReadonlySet<string>
): boolean {
  for (const obstacle of obstacles) {
    if (obstacle.pocketed || excludeIds.has(obstacle.id)) continue;
    const closest = closestPointOnSegment(obstacle.pos, from, to);
    if (length(sub(obstacle.pos, closest)) < 2 * BALL_RADIUS) return true;
  }
  return false;
}

/**
 * A cosine-threshold test standing in for "is the cut angle under the configured maximum" — dot product
 * of two unit vectors is monotonic in the angle between them, so this needs no `arccos` (§19.2).
 */
export function cutAngleOk(cueToGhostUnit: Vec2, ballToPocketUnit: Vec2): boolean {
  return dot(cueToGhostUnit, ballToPocketUnit) >= COS_MAX_CUT_ANGLE;
}

export interface PotCandidate {
  ball: Ball;
  pocket: Pocket;
  ghostPos: Vec2;
  cueToGhostUnit: Vec2;
  ballToPocketUnit: Vec2;
  cutAngleCos: number;
  distance: number;
}

/**
 * Builds the full geometry for a candidate pot (cue at `cuePos`, sinking `ball` in `pocket`), or `null`
 * when the cut is steeper than the configured maximum — the one piece of the "is this pot makeable"
 * question that doesn't depend on what else is on the table (path blocking is checked separately, since
 * it needs the full ball list).
 */
export function evaluatePotCandidate(cuePos: Vec2, ball: Ball, pocket: Pocket): PotCandidate | null {
  const ballToPocketUnit = normalize(sub(pocket.pos, ball.pos));
  const ghostPos = ghostBallPosition(ball.pos, pocket.pos);
  const cueToGhostUnit = normalize(sub(ghostPos, cuePos));
  const cutAngleCos = dot(cueToGhostUnit, ballToPocketUnit);
  if (cutAngleCos < COS_MAX_CUT_ANGLE) return null;

  const distance = length(sub(ghostPos, cuePos)) + length(sub(pocket.pos, ball.pos));
  return { ball, pocket, ghostPos, cueToGhostUnit, ballToPocketUnit, cutAngleCos, distance };
}
