import type { DetectedThrow } from '../../shared/types';
import { CENTRE, FENCE_R, quantiseVec, type Vec } from './paddock';

/**
 * Dart to scare point, and nothing else.
 *
 * Barrelo's BoardPosition is normalized board space — origin at the bull, magnitude 1.0 at the outer
 * edge of the double ring, +X right and +Y **up** (maths orientation, not screen y-down). The fence
 * circle *is* that unit circle, so the conversion is a scale and one negation. No trigonometry: the
 * board's angle convention (0deg = segment 20 at the top, increasing clockwise) is already baked
 * into the x/y the host sends.
 *
 *      20 (up)                field space is y-DOWN (screen convention),
 *       ^                     board space is y-UP, hence the single negation.
 * 11 <- * -> 6
 *       v
 *      3 (down)
 *
 * Ring and score are ignored. There are exactly two exceptions, and they are the whole of the game's
 * special-casing:
 *
 *  - The BULL is a whistle. It does not push anything; it pulls the flock in toward its own centre
 *    of mass. It is the only recovery from a scattered flock, and it is the hardest target on the
 *    board — that pairing is deliberate.
 *  - A MISS is nothing at all. Radius 1.05 is over the fence and into the next field. The burst
 *    still runs, so the flock drifts on the wander, but no push is applied.
 */

export type ScareKind = 'scare' | 'whistle' | 'nothing';

export interface Scare {
  kind: ScareKind;
  /** Field-space point the scare acts from. Meaningless when kind is 'nothing'. */
  at: Vec;
  /** Normalized board radius it came from, kept for display and debugging. */
  radius: number;
}

/** Barrelo's segment number for the bull, inner and outer alike. */
const BULL_SEGMENT = 25;

export function boardToField(position: { x: number; y: number }): Vec {
  return quantiseVec({
    x: CENTRE.x + position.x * FENCE_R,
    y: CENTRE.y - position.y * FENCE_R,
  });
}

export function scareFor(dart: DetectedThrow): Scare {
  const x = dart.position?.x ?? 0;
  const y = dart.position?.y ?? 0;
  const radius = Math.hypot(x, y);

  // Checked before the radius guard: a bull is by definition near the origin, but reading the
  // segment the detector reported is more honest than inferring the bull back out of a coordinate.
  if (dart.segment === BULL_SEGMENT) {
    return { kind: 'whistle', at: boardToField({ x, y }), radius };
  }

  // `ring` is what the host calls a miss; the radius test catches a detection artefact that reports
  // some other ring at an impossible distance. Either way the dart never reached the paddock.
  if (dart.ring === 'Miss' || radius > 1) {
    return { kind: 'nothing', at: CENTRE, radius };
  }

  return { kind: 'scare', at: boardToField({ x, y }), radius };
}
