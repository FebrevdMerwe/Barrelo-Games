import type { Ball } from "../physics/ball";
import { POCKETS } from "../physics/table";
import { length, normalize, sub, type Vec2 } from "../physics/vec2";
import { evaluatePotCandidate, pathBlocked, type PotCandidate } from "./geometry";
import { vectorToNearestSegment } from "./segmentMapping";
import type { RecommendedShot } from "./types";

function byBallNumber(a: Ball, b: Ball): number {
  return a.number - b.number;
}

function toRecommendedShot(
  tier: RecommendedShot["tier"],
  targetBall: Ball,
  pocketId: string | null,
  aimUnitVector: Vec2,
  distance: number
): RecommendedShot {
  return {
    tier,
    targetBallNumber: targetBall.number,
    pocketId,
    aimUnitVector,
    recommendedSegment: vectorToNearestSegment(aimUnitVector),
    distance,
  };
}

function excludeCueAndTarget(targetId: string): Set<string> {
  return new Set(["cue", targetId]);
}

/** Tier 1 of §25.2: the best clear-path pot, or `null` if none exists. Shared with `ballInHand.ts`. */
export function bestPot(
  cuePos: Vec2,
  targets: readonly Ball[],
  allBalls: readonly Ball[]
): { candidate: PotCandidate; target: Ball } | null {
  let best: PotCandidate | null = null;
  let bestTarget: Ball | null = null;
  for (const target of targets) {
    for (const pocket of POCKETS) {
      const candidate = evaluatePotCandidate(cuePos, target, pocket);
      if (!candidate) continue;
      const exclude = excludeCueAndTarget(target.id);
      if (pathBlocked(cuePos, candidate.ghostPos, allBalls, exclude)) continue;
      if (pathBlocked(target.pos, pocket.pos, allBalls, exclude)) continue;

      const better =
        !best ||
        candidate.cutAngleCos > best.cutAngleCos ||
        (candidate.cutAngleCos === best.cutAngleCos && candidate.distance < best.distance);
      if (better) {
        best = candidate;
        bestTarget = target;
      }
    }
  }
  return best && bestTarget ? { candidate: best, target: bestTarget } : null;
}

/** Tier 2 of §25.2: nearest legal target with a clear straight-line path. Shared with `ballInHand.ts`. */
export function nearestClearTarget(
  cuePos: Vec2,
  targets: readonly Ball[],
  allBalls: readonly Ball[]
): { target: Ball; dist: number; dir: Vec2 } | null {
  let nearest: { target: Ball; dist: number; dir: Vec2 } | null = null;
  for (const target of targets) {
    if (pathBlocked(cuePos, target.pos, allBalls, excludeCueAndTarget(target.id))) continue;
    const dist = length(sub(target.pos, cuePos));
    if (!nearest || dist < nearest.dist) nearest = { target, dist, dir: normalize(sub(target.pos, cuePos)) };
  }
  return nearest;
}

/** Tier 3 of §25.2: nearest legal target regardless of blocking. Shared with `ballInHand.ts`. */
export function nearestTarget(
  cuePos: Vec2,
  targets: readonly Ball[]
): { target: Ball; dist: number; dir: Vec2 } | null {
  let nearest: { target: Ball; dist: number; dir: Vec2 } | null = null;
  for (const target of targets) {
    const dist = length(sub(target.pos, cuePos));
    if (!nearest || dist < nearest.dist) nearest = { target, dist, dir: normalize(sub(target.pos, cuePos)) };
  }
  return nearest;
}

/**
 * The §25.2 tiered recommender: the first tier that produces a shot wins. Deterministic by construction —
 * `legalTargets` is walked in ball-number order and `POCKETS` is a fixed array, so "better beats existing
 * best, strictly" ties are broken by ball number then pocket order without any extra bookkeeping.
 */
export function recommendShot(cuePos: Vec2, legalTargets: readonly Ball[], allBalls: readonly Ball[]): RecommendedShot {
  const targets = [...legalTargets].sort(byBallNumber);

  const pot = bestPot(cuePos, targets, allBalls);
  if (pot) {
    return toRecommendedShot("pot", pot.target, pot.candidate.pocket.id, pot.candidate.cueToGhostUnit, pot.candidate.distance);
  }

  const contact = nearestClearTarget(cuePos, targets, allBalls);
  if (contact) return toRecommendedShot("contact", contact.target, null, contact.dir, contact.dist);

  const fallback = nearestTarget(cuePos, targets);
  if (!fallback) throw new Error("recommendShot: no legal targets provided");
  return toRecommendedShot("fallback", fallback.target, null, fallback.dir, fallback.dist);
}
