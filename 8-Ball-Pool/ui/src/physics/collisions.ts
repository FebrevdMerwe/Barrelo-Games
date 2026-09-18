import type { Ball } from "./ball";
import type { CushionSegment } from "./table";
import { BALL_RADIUS, PHYSICS } from "./constants";
import { add, closestPointOnSegment, dot, length, normalize, perp, reflect, scale, sub, type Vec2 } from "./vec2";

/**
 * The collision normal derived from *current* (already-overlapping) positions is biased: two balls are
 * only detected as touching after they've advanced up to one substep's worth of travel into each other,
 * so the position-derived normal can be a couple of degrees off the true contact line — enough to miss a
 * thin cut entirely, since a small angle error at the ghost-ball point becomes a large miss distance by
 * the time the object ball reaches the pocket. This rewinds both balls along their (constant-within-the-
 * substep) velocity to the exact moment they were `2×BALL_RADIUS` apart and derives the normal from that,
 * without changing either ball's actual position — only the contact geometry used to resolve velocities.
 * Solves `|(Δp₀ + Δv·s)|² = (2r)²` for the smaller root `s ∈ [0, dt]` (`+ − × ÷ sqrt` only, per §19.2).
 */
function contactNormal(a: Ball, b: Ball, dt: number): Vec2 {
  const dpEnd = sub(b.pos, a.pos);
  const dv = sub(b.vel, a.vel);
  const qa = dot(dv, dv);
  if (qa < 1e-12) return normalize(dpEnd);

  // a.pos/b.pos are positions at the END of this substep (local time dt); the quadratic below is
  // parametrized from the substep's START (local time 0), so the relative position must be rewound
  // there first — solving with dpEnd directly would parametrize from the wrong origin.
  const dp = sub(dpEnd, scale(dv, dt));
  const qb = 2 * dot(dp, dv);
  const qc = dot(dp, dp) - 4 * BALL_RADIUS * BALL_RADIUS;
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return normalize(dpEnd); // shouldn't happen given the caller already found overlap

  const sqrtDisc = Math.sqrt(discriminant);
  let s = (-qb - sqrtDisc) / (2 * qa);
  if (s < 0) s = 0;
  if (s > dt) s = dt;

  const pAContact = sub(a.pos, scale(a.vel, dt - s));
  const pBContact = sub(b.pos, scale(b.vel, dt - s));
  return normalize(sub(pBContact, pAContact), normalize(dp));
}

/**
 * Exact elastic exchange along the centre line for two equal-mass balls (§19.3): the normal-direction
 * velocity components swap, the tangential components are untouched. This is what sends the object ball
 * along the true centre-to-centre line for a recommender-snapped shot (§6.4) rather than approximating it
 * with an iterative contact solver. `dt` is the substep length, needed to reconstruct the exact contact
 * point (see `contactNormal` above).
 */
export function resolveBallBallCollision(a: Ball, b: Ball, dt: number): void {
  const normal = contactNormal(a, b, dt);
  const tangent = perp(normal);

  const aNormal = dot(a.vel, normal);
  const aTangent = dot(a.vel, tangent);
  const bNormal = dot(b.vel, normal);
  const bTangent = dot(b.vel, tangent);

  a.vel = add(scale(normal, bNormal), scale(tangent, aTangent));
  b.vel = add(scale(normal, aNormal), scale(tangent, bTangent));

  // Separate along the normal so the pair doesn't stay flagged as overlapping next substep.
  const overlap = 2 * BALL_RADIUS - length(sub(b.pos, a.pos));
  if (overlap > 0) {
    const push = scale(normal, overlap / 2);
    a.pos = sub(a.pos, push);
    b.pos = add(b.pos, push);
  }
}

/**
 * Reflects a ball off a straight cushion segment. `restitution` scales the outgoing speed (a rail hit
 * loses a little energy); the normal is a precomputed table constant, never derived from the ball's
 * approach angle, since every cushion here is axis-aligned (see table.ts).
 */
export function resolveCushionCollision(ball: Ball, cushion: CushionSegment): void {
  const reflected = reflect(ball.vel, cushion.normal);
  ball.vel = scale(reflected, PHYSICS.cushion.restitution);

  const closest = closestPointOnSegment(ball.pos, cushion.a, cushion.b);
  const penetration = BALL_RADIUS - length(sub(ball.pos, closest));
  if (penetration > 0) {
    ball.pos = add(ball.pos, scale(cushion.normal, penetration));
  }
}

/**
 * Arcade topspin/backspin (§20.1): applied once, on the cue ball's first object-ball contact, as a
 * velocity nudge along the original shot direction (forward for topspin, backward for backspin).
 * `spinTop` is in [-1, 1] (backspin .. topspin).
 */
export function applyTopBackSpin(ball: Ball, shotDirection: Vec2, spinTop: number): void {
  const boost = scale(shotDirection, spinTop * PHYSICS.spin.topspinCoeff);
  ball.vel = add(ball.vel, boost);
}

/**
 * Arcade sidespin (§20.1): after a cushion contact, nudges the rebound direction sideways and renormalizes
 * to the pre-nudge speed, so sidespin changes where the ball goes without changing how fast it's going.
 * `spinSide` is in [-1, 1] (left .. right, relative to the cushion normal via its perpendicular).
 */
export function applySideSpinOnCushion(ball: Ball, cushionNormal: Vec2, spinSide: number): void {
  const speed = length(ball.vel);
  if (speed < 1e-9) return;
  const tangent = perp(cushionNormal);
  const nudged = add(ball.vel, scale(tangent, spinSide * PHYSICS.spin.sidespinCoeff * speed));
  ball.vel = scale(normalize(nudged, ball.vel), speed);
}
