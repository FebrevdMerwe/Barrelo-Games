/**
 * The paddock: fixed geometry, plus the seeded bits that make every match's field different.
 *
 * Everything here is a pure function of `payload.seed`, so the rules and the board build the *same*
 * paddock without either telling the other about it. Nothing in this file may read the clock or
 * Math.random — see the determinism note in GameDescription.md.
 *
 * COORDINATES
 * -----------
 * Field space is y-DOWN (screen convention), 1600 x 900 units. Board space — what Barrelo sends in
 * `throw.position` — is y-UP with the origin at the bull and magnitude 1.0 at the outer edge of the
 * double ring. The fence circle *is* that unit circle, so converting between them is a scale and a
 * single negation, and lives in scare.ts.
 *
 * THE FUNNEL, AND WHY IT IS SHAPED LIKE THIS
 * ------------------------------------------
 * The obvious construction — a funnel bolted onto the outside of a complete fence — leaves a
 * dead-end pocket on each side, between the funnel's outer wall and the fence it was bolted to.
 * Sheep pushed at the gate find the pocket instead and wedge there permanently, which is unherdable
 * and unwatchable.
 *
 * So the walls START on the fence circle — a corner exactly where the fence arc terminates, then a
 * straight run to the gate. The fence and the funnel share their endpoints, so there is no pocket
 * anywhere.
 *
 * Each wall is a long gentle taper and then a short PARALLEL neck. Both halves were learned the
 * hard way:
 *
 *  - The taper must not be steep. An earlier version put its intermediate point close in x, which
 *    made the first segment nearly PERPENDICULAR to the flow — not a wide mouth at all, but two
 *    baffles with a slot between them, against which a herded flock stalled dead.
 *  - The neck must be parallel, not tapering all the way to the gate. Wall segments are drawn
 *    overlong so their joints seal, and a still-narrowing wall that overshoots the gate pinches the
 *    opening shut just past the line a sheep has to cross.
 *
 *                    P0 (on the fence)
 *          fence ___/ \
 *               /      \____
 *              |           |__]  gate
 *               \      ____|
 *          fence \___ /
 *                    P0'
 *                          ^ neck runs straight
 *
 * The chord of the mouth lies on the fence circle, so the first stretch of the race is INSIDE the
 * throwable disc and the rest is outside it. That boundary is the commit line — see the note on the
 * drift in simulate.ts — and it needs no marking on the grass, because it is the fence, which is
 * drawn already.
 */

export interface Vec {
  x: number;
  y: number;
}

/** World size in field units. 16:9, so it maps to a TV without letterboxing. */
export const WORLD_W = 1600;
export const WORLD_H = 900;

/** The paddock circle. This is the unit circle of board space, scaled. */
export const CENTRE: Vec = { x: 620, y: 450 };
export const FENCE_R = 400;

export const SHEEP_R = 18;

/**
 * Half-angle of the fence gap, in radians. The fence arc runs the long way round between +/- this;
 * the funnel occupies the rest. 25 degrees gives a mouth ~338 units across — a wide, forgiving thing
 * to aim a flock at, per the funnel decision.
 */
const GAP_HALF_ANGLE = (25 * Math.PI) / 180;

/** x of the gate line. A sheep whose centre crosses this is penned. */
export const GATE_X = 1150;

/**
 * Gate opening, in y — and these are wall CENTRELINES, not the clear opening. The walls are
 * WALL_THICKNESS thick, so they eat half of it from each side: the gap a sheep actually has to fit
 * through is (GATE_BOTTOM - GATE_TOP) - WALL_THICKNESS.
 *
 * That distinction cost a debugging session. At 422/478 the clear opening was 22 units against a
 * 36-unit sheep, so sheep herded perfectly down the race simply stopped dead at the neck and no
 * flock could ever be penned. At 405/495 the clear opening is 56 — comfortably one sheep, and still
 * far too narrow for two abreast, which is what keeps it single file.
 */
export const GATE_TOP = 405;
export const GATE_BOTTOM = 495;

/** Where the taper stops and the neck runs straight. See the wall construction note above. */
const NECK_X = 1100;

/** The pen bay. Decoration only — penned sheep are removed from the simulation, not contained. */
export const PEN_RECT = { x: GATE_X, y: 320, w: 270, h: 260 };

/** Thick enough that nothing travelling at MAX_SPEED can tunnel through it between steps. */
export const WALL_THICKNESS = 34;

/**
 * How far the funnel reaches across at a given x, measured from the gate axis (y = 450). Zero
 * anywhere the funnel does not exist.
 *
 * This is what tells the simulation which sheep are actually *in* the race, and it has to be
 * derived from the wall polyline rather than guessed at, so that moving a wall point moves the
 * channel with it.
 */
export function funnelHalfWidthAt(x: number): number {
  const wall = FUNNEL_WALLS[0];
  if (x < wall[0].x || x > wall[wall.length - 1].x) return 0;

  for (let i = 0; i < wall.length - 1; i++) {
    const a = wall[i];
    const b = wall[i + 1];
    if (x < a.x || x > b.x) continue;
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
    return Math.abs(GATE_AXIS_Y - (a.y + (b.y - a.y) * t));
  }
  return 0;
}

/** The line the funnel tapers to, and the direction a sheep in the race is heading. */
export const GATE_AXIS_Y = (GATE_TOP + GATE_BOTTOM) / 2;

/**
 * Positions are rounded to this many units to stop floating-point drift compounding across a match.
 * Matter calls Math.sin/cos on every collision and those are only accurate to the last ulp, so two
 * JS engines can disagree in the final bit; truncating at every settle point means the disagreement
 * is discarded rather than accumulated. Putt Putt lists this as its someday-fix; there is a natural
 * settle point every dart here, so it is done from the start.
 */
export const QUANTUM = 1 / 4096;

export function quantise(value: number): number {
  return Math.round(value / QUANTUM) * QUANTUM;
}

export function quantiseVec(v: Vec): Vec {
  return { x: quantise(v.x), y: quantise(v.y) };
}

function onFence(angle: number): Vec {
  return quantiseVec({
    x: CENTRE.x + FENCE_R * Math.cos(angle),
    y: CENTRE.y + FENCE_R * Math.sin(angle),
  });
}

/**
 * The two funnel walls, upper first, each as a polyline from its fence corner to its gate corner.
 * Quantised at construction for the same reason positions are: static geometry built from Math.cos
 * would otherwise be the one thing left that could differ between two engines.
 */
export const FUNNEL_WALLS: Vec[][] = [
  [
    onFence(-GAP_HALF_ANGLE),
    quantiseVec({ x: NECK_X, y: GATE_TOP }),
    quantiseVec({ x: GATE_X, y: GATE_TOP }),
  ],
  [
    onFence(GAP_HALF_ANGLE),
    quantiseVec({ x: NECK_X, y: GATE_BOTTOM }),
    quantiseVec({ x: GATE_X, y: GATE_BOTTOM }),
  ],
];

/** Where the fence arc runs: from the lower gap corner, the long way round, to the upper one. */
export const FENCE_ARC = { from: GAP_HALF_ANGLE, to: 2 * Math.PI - GAP_HALF_ANGLE };

export type ObstacleKind = 'pond' | 'rocks' | 'copse';

export interface Obstacle {
  kind: ObstacleKind;
  at: Vec;
  r: number;
}

export interface Paddock {
  obstacles: Obstacle[];
  /** Where the flock starts. One entry per sheep. */
  starts: Vec[];
  /** Where a sudden-death sheep is released — far rim, so it is a real contest to fetch it. */
  suddenDeathStart: Vec;
}

/** mulberry32. The only permitted source of randomness; mirrors the helper in rules.ts. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OBSTACLE_KINDS: ObstacleKind[] = ['pond', 'rocks', 'copse'];

/**
 * Obstacles are kept out of the eastern approach entirely (x < 850). An obstacle parked in front of
 * the funnel would not be an interesting route problem, it would be a seed that made the match
 * unwinnable — and since the seed is fixed for the match, nobody could do anything about it.
 */
const OBSTACLE_MAX_X = 850;
const OBSTACLE_FENCE_MARGIN = 70;
const OBSTACLE_SEPARATION = 120;

/**
 * Rejection sampling with a hard attempt cap, so the loop terminates on every seed rather than on
 * most of them. Falling short of the requested count is fine and produces an emptier paddock; never
 * terminating would hang every screen in the match at once.
 */
function placeObstacles(next: () => number): Obstacle[] {
  const wanted = 2 + Math.floor(next() * 3); // 2..4
  const obstacles: Obstacle[] = [];

  for (let attempt = 0; attempt < 200 && obstacles.length < wanted; attempt++) {
    const kind = OBSTACLE_KINDS[Math.floor(next() * OBSTACLE_KINDS.length)];
    const r = 45 + next() * 35;

    const angle = next() * Math.PI * 2;
    const dist = next() * (FENCE_R - OBSTACLE_FENCE_MARGIN - r);
    const at = quantiseVec({
      x: CENTRE.x + dist * Math.cos(angle),
      y: CENTRE.y + dist * Math.sin(angle),
    });

    if (at.x + r > OBSTACLE_MAX_X) continue;
    if (
      obstacles.some(
        (o) => Math.hypot(o.at.x - at.x, o.at.y - at.y) < o.r + r + OBSTACLE_SEPARATION
      )
    ) {
      continue;
    }
    obstacles.push({ kind, at, r });
  }

  return obstacles;
}

/**
 * The flock starts in the western half — there has to be work to do — and starts as a FLOCK, in one
 * loose huddle, rather than scattered evenly across the paddock.
 *
 * That is not decoration. A scattered flock is this game's failure state: it has to be gathered
 * with the whistle before it can be pushed anywhere, so opening every match in the failure state
 * makes the first several darts a chore and teaches the wrong thing about what a dart does. Sheep
 * are also spaced far enough apart that Matter is not resolving a pile of overlaps on the first
 * step, which would fling them apart before anybody threw anything.
 */
const HUDDLE_RADIUS = 115;

function placeStarts(next: () => number, count: number, obstacles: Obstacle[]): Vec[] {
  const starts: Vec[] = [];

  // Where the huddle stands: western half, clear of the fence and of the funnel approach.
  const huddleAngle = next() * Math.PI * 2;
  const huddleDist = next() * (FENCE_R - HUDDLE_RADIUS - 90);
  const huddle = {
    x: Math.min(CENTRE.x + 40, CENTRE.x + huddleDist * Math.cos(huddleAngle)),
    y: CENTRE.y + huddleDist * Math.sin(huddleAngle),
  };

  for (let attempt = 0; attempt < 400 && starts.length < count; attempt++) {
    const angle = next() * Math.PI * 2;
    // sqrt keeps the huddle evenly filled instead of bunched at its centre.
    const dist = HUDDLE_RADIUS * Math.sqrt(next());
    const at = quantiseVec({
      x: huddle.x + dist * Math.cos(angle),
      y: huddle.y + dist * Math.sin(angle),
    });

    if (Math.hypot(at.x - CENTRE.x, at.y - CENTRE.y) > FENCE_R - 40) continue;
    if (obstacles.some((o) => Math.hypot(o.at.x - at.x, o.at.y - at.y) < o.r + SHEEP_R + 30)) {
      continue;
    }
    if (starts.some((s) => Math.hypot(s.x - at.x, s.y - at.y) < SHEEP_R * 3)) continue;
    starts.push(at);
  }

  // Cap exhausted on a pathological seed: pack the remainder on a ring rather than return short,
  // because the flock size is a rule and the two callers must agree on how many sheep exist.
  for (let i = starts.length; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    starts.push(
      quantiseVec({ x: CENTRE.x - 120 + 70 * Math.cos(angle), y: CENTRE.y + 70 * Math.sin(angle) })
    );
  }

  return starts;
}

/**
 * Builds the whole paddock for a match. Called by rules.ts and by BoardScene with the same seed and
 * flock size, and must return deeply equal results for both.
 */
export function buildPaddock(seed: number, flockSize: number): Paddock {
  const next = rng(seed);
  const obstacles = placeObstacles(next);
  const starts = placeStarts(next, flockSize, obstacles);

  // Far rim, west, away from the gate: a sudden-death sheep should have to be worked the whole way.
  const angle = Math.PI + (next() - 0.5) * 1.2;
  const suddenDeathStart = quantiseVec({
    x: CENTRE.x + (FENCE_R - 90) * Math.cos(angle),
    y: CENTRE.y + (FENCE_R - 90) * Math.sin(angle),
  });

  return { obstacles, starts, suddenDeathStart };
}

/** Flock size by mode. Sublinear in team count: see the table in GameDescription.md. */
export function flockSizeFor(mode: string, teamCount: number): number {
  const teams = Math.max(1, teamCount);
  if (mode === 'quick') return 2 + 2 * teams;
  if (mode === 'long') return 6 + 3 * teams;
  return 4 + 2 * teams;
}
