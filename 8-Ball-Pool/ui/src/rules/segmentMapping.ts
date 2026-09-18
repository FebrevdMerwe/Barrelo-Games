import { WEDGE_UNIT_VECTORS } from "../physics/constants";
import { dot, type Vec2 } from "../physics/vec2";

/**
 * The dartboard segment whose direction is closest to `unit` (§6.2's recommended-number display: "the
 * segment whose direction is closest to the recommended shot's exact aim angle"). Dot product against
 * unit vectors is cosine similarity, monotonic with angular difference, so the largest dot product is the
 * nearest segment — no `atan2` needed (§19.2).
 */
export function vectorToNearestSegment(unit: Vec2): number {
  let best = WEDGE_UNIT_VECTORS[0];
  let bestDot = dot(unit, best.unit);
  for (let i = 1; i < WEDGE_UNIT_VECTORS.length; i++) {
    const candidate = WEDGE_UNIT_VECTORS[i];
    const d = dot(unit, candidate.unit);
    if (d > bestDot) {
      bestDot = d;
      best = candidate;
    }
  }
  return best.segment;
}

export function segmentToUnitVector(segment: number): Vec2 {
  const entry = WEDGE_UNIT_VECTORS.find((w) => w.segment === segment);
  if (!entry) throw new Error(`segmentToUnitVector: invalid segment ${segment}`);
  return entry.unit;
}
