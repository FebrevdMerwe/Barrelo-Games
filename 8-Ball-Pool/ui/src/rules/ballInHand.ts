import type { Ball } from "../physics/ball";
import { BALL_RADIUS, POCKET_RADIUS } from "../physics/constants";
import { CUSHIONS, POCKETS, TABLE_HEIGHT, TABLE_WIDTH } from "../physics/table";
import { closestPointOnSegment, length, sub, type Vec2 } from "../physics/vec2";
import { bestPot, nearestClearTarget, nearestTarget } from "./recommender";

const GRID_COLUMNS = 20;
const GRID_ROWS = 10;
const MARGIN = BALL_RADIUS * 1.5;

function candidateGrid(): Vec2[] {
  const points: Vec2[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLUMNS; col++) {
      const x = MARGIN + (col / (GRID_COLUMNS - 1)) * (TABLE_WIDTH - 2 * MARGIN);
      const y = MARGIN + (row / (GRID_ROWS - 1)) * (TABLE_HEIGHT - 2 * MARGIN);
      points.push({ x, y });
    }
  }
  return points;
}

/** Fixed once — grid order is part of the deterministic tie-break (§18.1). */
const CANDIDATE_GRID = candidateGrid();

function overlapsBallOrCushion(pos: Vec2, balls: readonly Ball[]): boolean {
  for (const ball of balls) {
    if (ball.pocketed) continue;
    if (length(sub(pos, ball.pos)) < 2 * BALL_RADIUS) return true;
  }
  for (const cushion of CUSHIONS) {
    const closest = closestPointOnSegment(pos, cushion.a, cushion.b);
    if (length(sub(pos, closest)) < BALL_RADIUS) return true;
  }
  for (const pocket of POCKETS) {
    if (length(sub(pos, pocket.pos)) < POCKET_RADIUS + BALL_RADIUS) return true;
  }
  return false;
}

function scoreCandidate(pos: Vec2, legalTargets: readonly Ball[], otherBalls: readonly Ball[]): number {
  const pot = bestPot(pos, legalTargets, otherBalls);
  if (pot) return 2_000_000 + pot.candidate.cutAngleCos * 1000 - pot.candidate.distance;

  const contact = nearestClearTarget(pos, legalTargets, otherBalls);
  if (contact) return 1_000_000 - contact.dist;

  const fallback = nearestTarget(pos, legalTargets);
  return fallback ? -fallback.dist : -Infinity;
}

/**
 * Automatic ball-in-hand placement (§18.1): score every candidate in a fixed grid with the shot
 * recommender for the team about to shoot, and take the highest score. Ties keep the first (grid-order)
 * winner, since the scan below only replaces the best on a strictly-greater score.
 */
export function placeCueBall(otherBalls: readonly Ball[], legalTargets: readonly Ball[]): Vec2 {
  let best: Vec2 = CANDIDATE_GRID[0];
  let bestScore = -Infinity;

  for (const candidate of CANDIDATE_GRID) {
    if (overlapsBallOrCushion(candidate, otherBalls)) continue;
    const score = scoreCandidate(candidate, legalTargets, otherBalls);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}
