import type { DetectedThrow } from '../../shared/types';

/**
 * Turns a dart into a putt.
 *
 * The bull *is* the ball. Barrelo's BoardPosition is normalized board space — origin at the bull
 * centre, magnitude 1.0 at the outer edge of the double ring, +X right and +Y **up** (standard maths
 * orientation, not screen y-down). So the vector from the bull to where the dart landed is exactly
 * the putt: its direction is where the ball goes, its length is how hard it was hit.
 *
 * That mapping needs no trigonometry at all. The board's angle convention (0deg = segment 20 at the
 * top, increasing clockwise) is already baked into the x/y the host sends, so normalising the vector
 * and flipping y into course space is the whole conversion.
 *
 *      20 (up)                     course space is y-DOWN (screen convention),
 *       ^                          board space is y-UP, hence the single negation.
 * 11 <- * -> 6
 *       v
 *      3 (down)
 *
 * Direction is world-fixed for the entire match: 20 is always up the screen, on every hole. Players
 * learn one map and it never rotates.
 */

/** Course units per physics step imparted by a putt at the outer edge of the double ring. */
export const MAX_SPEED = 23;

/**
 * Guards against a wildly out-of-band coordinate. A genuine miss is ~1.05 and is deliberately NOT
 * clamped away — it is taken literally, as a full-power shank. This only catches a detection
 * artefact that would otherwise fire the ball through a wall.
 */
const MAX_RADIUS = 1.05;

/** Below this the vector has no meaningful direction; a dead-centre inner bull can land here. */
const EPSILON = 1e-6;

export interface PuttVector {
  /** Unit direction in course space (y-down). Zero-length only for an exactly-centred bull. */
  dx: number;
  dy: number;
  /** Course units per physics step. */
  speed: number;
  /** Normalized board radius the speed came from, kept for display and debugging. */
  radius: number;
}

/**
 * Notable consequences of taking the coordinate literally, both deliberate:
 *
 *  - A bull is radius ~0.03 (inner) or ~0.105 (outer), so it is very nearly no power at all. The
 *    stroke still counts. The hardest target on the board is the worst thing to hit; there is no
 *    special case rescuing it.
 *  - A Miss is radius 1.05. Under manual entry BoardGeometry pins every miss to exactly (0, 1.05),
 *    so a typed-in miss is always a full-power putt straight up the screen. With a real autoscorer
 *    the dart has a real position and the shank goes wherever it actually went.
 */
export function puttVectorFor(dart: DetectedThrow): PuttVector {
  const x = dart.position?.x ?? 0;
  const y = dart.position?.y ?? 0;

  const length = Math.hypot(x, y);
  if (length < EPSILON) {
    return { dx: 0, dy: 0, speed: 0, radius: 0 };
  }

  const radius = Math.min(length, MAX_RADIUS);
  return {
    dx: x / length,
    dy: -y / length,
    speed: radius * MAX_SPEED,
    radius,
  };
}
