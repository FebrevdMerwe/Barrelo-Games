import type { Vec2 } from "./vec2";

/**
 * The 20 dartboard wedge unit vectors, one per segment, in the table-fixed frame (§11.1): segment 20 is
 * up (`{0,1}`), segment 6 is right, 3 is down, 11 is left, going clockwise. These are literal doubles
 * computed once offline (`Math.sin`/`Math.cos` of segment-order × 18°) and pasted in — never computed with
 * a trig function at runtime, so every browser reads the exact same bits (§19.2). The x/y convention
 * (x = sin, y = cos of the clockwise angle from up) matches Barrelo's own dev harness `computePosition()`,
 * which is the source of truth for how a real `DetectedThrow.position` is laid out.
 */
export const WEDGE_UNIT_VECTORS: ReadonlyArray<{ segment: number; unit: Vec2 }> = [
  { segment: 20, unit: { x: 0, y: 1 } },
  { segment: 1, unit: { x: 0.3090169943749474, y: 0.9510565162951535 } },
  { segment: 18, unit: { x: 0.5877852522924731, y: 0.8090169943749475 } },
  { segment: 4, unit: { x: 0.8090169943749475, y: 0.5877852522924731 } },
  { segment: 13, unit: { x: 0.9510565162951535, y: 0.30901699437494745 } },
  { segment: 6, unit: { x: 1, y: 0 } },
  { segment: 10, unit: { x: 0.9510565162951536, y: -0.30901699437494734 } },
  { segment: 15, unit: { x: 0.8090169943749475, y: -0.587785252292473 } },
  { segment: 2, unit: { x: 0.5877852522924732, y: -0.8090169943749473 } },
  { segment: 17, unit: { x: 0.3090169943749475, y: -0.9510565162951535 } },
  { segment: 3, unit: { x: 0, y: -1 } },
  { segment: 19, unit: { x: -0.30901699437494773, y: -0.9510565162951535 } },
  { segment: 7, unit: { x: -0.587785252292473, y: -0.8090169943749475 } },
  { segment: 16, unit: { x: -0.8090169943749473, y: -0.5877852522924732 } },
  { segment: 8, unit: { x: -0.9510565162951535, y: -0.30901699437494756 } },
  { segment: 11, unit: { x: -1, y: 0 } },
  { segment: 14, unit: { x: -0.9510565162951536, y: 0.30901699437494723 } },
  { segment: 9, unit: { x: -0.8090169943749476, y: 0.5877852522924729 } },
  { segment: 12, unit: { x: -0.5877852522924734, y: 0.8090169943749473 } },
  { segment: 5, unit: { x: -0.3090169943749476, y: 0.9510565162951535 } },
];

/**
 * Every tunable physics number in one place (SCOPE.md §19.3: "physics parameters must be configurable").
 * Table units are arbitrary but self-consistent — a "unit" is roughly a table-width fraction; only the
 * ratios between these numbers matter for how the sim plays.
 */
export const PHYSICS = {
  table: {
    width: 2.0,
    height: 1.0,
  },
  ball: {
    radius: 0.028,
  },
  pocket: {
    // Deliberately generous — SCOPE.md §19.3 calls for "forgiving pocket geometry".
    radius: 0.08,
  },
  spots: {
    head: { x: 0.5, y: 0.5 } as Vec2,
    foot: { x: 1.5, y: 0.5 } as Vec2,
  },
  cueSpeed: {
    // 100% power == this speed (§8: "tuned so that 100% is a full-strength break").
    max: 6.0,
    // Beginner's automatic break power (§6.6) and the recommended-shot default break strength.
    breakPower: 0.95,
  },
  power: {
    floor: 0.15,
    bull: 0.5,
    // Beginner's automatic power (§6.6) is solved from the shot's distance rather than read off a dart,
    // then clamped into this range so it's never punishingly soft or a runaway break-speed shot.
    beginnerMax: 0.7,
    // How much faster than the bare minimum the automatic-power solve aims for, so the object ball
    // reaches the pocket with speed to spare instead of dying right on the lip (§6.6's "safety margin").
    autoPowerSafetyMargin: 1.6,
  },
  friction: {
    // Constant deceleration (units/s^2), not a velocity multiplier — real rolling resistance slows a
    // ball at roughly a constant rate until it stops, not exponentially.
    rollingDecel: 2.4,
    restSpeed: 0.01,
  },
  cushion: {
    restitution: 0.92,
  },
  spin: {
    topspinCoeff: 0.6,
    sidespinCoeff: 0.5,
    // Natural roll (§20.1 addendum): a cue ball hit with no deliberate spin isn't actually spin-free by
    // the time it reaches an object ball — cloth friction spins it up from a pure slide toward natural
    // forward roll, and the same friction washes out deliberate top/backspin the same way. Real transition
    // distance scales with the square of launch speed (d = (2/49)·v²/(μg) for a center-ball hit), so a
    // fixed distance threshold would make break-speed shots roll up unrealistically fast; scaling by v²
    // here keeps soft shots rolling almost immediately while hard shots (including the break) stay
    // slide-like for most of their travel, matching the real table. `bias` is the effective topspin of a
    // fully-rolled ball — modest on purpose, since natural follow is a gentle drift, not a deliberate stroke.
    naturalRoll: {
      transitionCoeff: 0.18,
      bias: 0.2,
    },
  },
  simulation: {
    // 480 substeps/sec: at max cue speed (6 units/s) a ball moves ~0.0125 units per substep, well under
    // both the ball radius and the pocket radius, so a fast ball can never tunnel through a ball, a
    // cushion, or hop clean over a pocket mouth between two substep samples (§19.3's tunnelling
    // requirement at break speed).
    substepsPerSecond: 480,
    // Hard cap so a shot always terminates (§19.2) even if a bug ever produced a ball that won't settle.
    maxSubsteps: 20000,
  },
} as const;

export const BALL_RADIUS = PHYSICS.ball.radius;
export const POCKET_RADIUS = PHYSICS.pocket.radius;
export const SUBSTEP_DT = 1 / PHYSICS.simulation.substepsPerSecond;
