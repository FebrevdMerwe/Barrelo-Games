import Phaser from 'phaser';
import {
  BALL_RADIUS,
  CUP_RADIUS,
  type Hole,
  type Obstacle,
  type Vec,
  type Zone,
} from './holes';
import type { PuttVector } from './putt';

/**
 * The one simulation, used twice.
 *
 * rules.ts drives it on a bare headless Matter engine to get the authoritative answer — where the
 * ball stopped, whether it dropped, whether it got wet. BoardScene drives the identical code on the
 * *live* Phaser Matter world so you watch real bodies collide rather than a recorded animation.
 * Same engine, same bodies, same fixed step, same order of operations, so both land on the same
 * number. That is the only reason replay() can stay a pure function while the board still runs
 * genuine physics.
 *
 * Every entry point here takes the engine as an argument precisely so neither caller owns it.
 *
 * DO NOT introduce a variable timestep, Math.random, or wall-clock time anywhere in this file. The
 * headless and live paths would stop agreeing and the tablet and the TV would show different balls.
 */

// Phaser's own .d.ts declares Physics.Matter.Matter as an empty namespace, so it carries no type
// information and cannot be referenced as a value. The runtime object is the full Matter library
// (see phaser/src/physics/matter-js/CustomMain.js); the global MatterJS namespace is its real shape.
const M = (Phaser.Physics as unknown as { Matter: { Matter: typeof MatterJS } }).Matter.Matter;

type Engine = ReturnType<typeof MatterJS.Engine.create>;
type Body = MatterJS.BodyType;

/**
 * Matter's World *is* a Composite at runtime — World.add and friends are literally aliased to
 * Composite.add in CustomMain.js. Phaser's .d.ts models the two as unrelated types, so reaching the
 * world as what it actually is needs a cast rather than a redesign.
 */
function worldOf(engine: Engine): MatterJS.CompositeType {
  return engine.world as unknown as MatterJS.CompositeType;
}

/** Fixed physics step, in ms. Matter's own base delta — anything else rescales its integrator. */
export const STEP_MS = 1000 / 60;

/**
 * Hard cap on a single putt, in steps: 4 seconds. A ball squeezed between the windmill blade and a
 * wall can jitter forever, so the sim always terminates. Both callers must use the same cap or the
 * live board would settle somewhere the rules never agreed to.
 */
export const MAX_STEPS = 240;

/** Below this speed (course units per step) the ball is at rest. */
const REST_SPEED = 0.25;

/** Matter reports a nonsense velocity on the first step or two after setVelocity. */
const MIN_STEPS_BEFORE_REST = 4;

const BASE_FRICTION_AIR = 0.02;
const SAND_FRICTION_AIR = 0.08;

const RAIL_THICKNESS = 40;
const RAIL_RESTITUTION = 0.6;
const BUMPER_RESTITUTION = 1.2;

/**
 * Matter's defaults, pinned explicitly. Phaser's Matter world takes these from its own scene config
 * and Engine.create() takes them from Matter's defaults; if the two ever drifted apart the headless
 * and live sims would diverge silently, so both are set from this one object.
 */
export const SOLVER = {
  positionIterations: 6,
  velocityIterations: 4,
  constraintIterations: 2,
} as const;

export type PuttOutcome = 'rolling' | 'rest' | 'holed' | 'water';

export interface SimContext {
  readonly engine: Engine;
  readonly ball: Body;
  readonly hole: Hole;
  /** Where the putt was struck from — where the ball returns to if it finds water. */
  readonly from: Vec;
  readonly blades: { body: Body; startAngle: number; omega: number }[];
  steps: number;
  outcome: PuttOutcome;
}

/** Creates a headless engine configured identically to the scene's live Matter world. */
export function createEngine(): Engine {
  return M.Engine.create({
    gravity: { x: 0, y: 0, scale: 0 },
    enableSleeping: false,
    ...SOLVER,
  } as object);
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers. Sand and water are tested geometrically rather than as Matter sensor bodies:
// the test is then identical in both callers and does not depend on Matter's collision event
// ordering, and it keeps the body count down.
// ---------------------------------------------------------------------------------------------

function pointInZone(zone: Zone, x: number, y: number): boolean {
  if (zone.kind === 'circle') {
    return Math.hypot(x - zone.at.x, y - zone.at.y) <= zone.r;
  }
  const { x: rx, y: ry, w, h } = zone.rect;
  return x >= rx && x <= rx + w && y >= ry && y <= ry + h;
}

/** Samples the swept path so a fast ball cannot skip over a hazard between steps. */
function zoneCrossed(zone: Zone, ax: number, ay: number, bx: number, by: number): boolean {
  const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    if (pointInZone(zone, ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
  }
  return false;
}

/** Shortest distance from point c to segment ab — the cup capture test. */
function distanceToSegment(ax: number, ay: number, bx: number, by: number, c: Vec): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(c.x - ax, c.y - ay);
  let t = ((c.x - ax) * dx + (c.y - ay) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(c.x - (ax + dx * t), c.y - (ay + dy * t));
}

// ---------------------------------------------------------------------------------------------
// Course construction
// ---------------------------------------------------------------------------------------------

/**
 * Turns the outline polygon into a ring of thick static rectangles, one per edge.
 *
 * Thick (40 units) on purpose: the fastest putt covers ~24 units per step, so a thin rail could be
 * tunnelled straight through. Each rail is also overlong by its own thickness so corners overlap
 * and leave no gap to squeeze out of.
 *
 * Winding is worked out from the signed area rather than assumed, so holes can be authored either
 * way round: with a positive signed area the interior lies to the left of each edge, so the outward
 * normal is (dy, -dx).
 */
function buildRails(outline: Vec[]): Body[] {
  let area2 = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  const sign = area2 >= 0 ? 1 : -1;

  const rails: Body[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    const outX = (sign * dy) / length;
    const outY = (sign * -dx) / length;
    const cx = (a.x + b.x) / 2 + (outX * RAIL_THICKNESS) / 2;
    const cy = (a.y + b.y) / 2 + (outY * RAIL_THICKNESS) / 2;

    rails.push(
      M.Bodies.rectangle(cx, cy, length + RAIL_THICKNESS, RAIL_THICKNESS, {
        isStatic: true,
        angle: Math.atan2(dy, dx),
        restitution: RAIL_RESTITUTION,
        friction: 0,
        frictionStatic: 0,
      } as object)
    );
  }
  return rails;
}

function buildObstacle(obstacle: Obstacle): Body | null {
  switch (obstacle.kind) {
    case 'wall':
      return M.Bodies.rectangle(
        obstacle.rect.x + obstacle.rect.w / 2,
        obstacle.rect.y + obstacle.rect.h / 2,
        obstacle.rect.w,
        obstacle.rect.h,
        { isStatic: true, restitution: RAIL_RESTITUTION, friction: 0, frictionStatic: 0 } as object
      );
    case 'bumper':
      return M.Bodies.circle(obstacle.at.x, obstacle.at.y, obstacle.r, {
        isStatic: true,
        restitution: BUMPER_RESTITUTION,
        friction: 0,
        frictionStatic: 0,
      } as object);
    case 'windmill':
      return M.Bodies.rectangle(
        obstacle.at.x,
        obstacle.at.y,
        obstacle.length,
        obstacle.thickness,
        {
          isStatic: true,
          angle: obstacle.startAngle,
          restitution: RAIL_RESTITUTION,
          friction: 0,
          frictionStatic: 0,
        } as object
      );
    // Sand and water are zones, not bodies — see the note above pointInZone.
    case 'sand':
    case 'water':
      return null;
  }
}

/**
 * Wipes the world and rebuilds it for one putt. The live world is reused across putts, so clearing
 * is what keeps the two callers' worlds identical rather than one accumulating stale bodies.
 */
export function createSim(engine: Engine, hole: Hole, from: Vec, vector: PuttVector): SimContext {
  M.Composite.clear(worldOf(engine), false);

  const bodies: Body[] = buildRails(hole.outline);
  const blades: SimContext['blades'] = [];

  for (const obstacle of hole.obstacles) {
    const body = buildObstacle(obstacle);
    if (!body) continue;
    bodies.push(body);
    if (obstacle.kind === 'windmill') {
      blades.push({ body, startAngle: obstacle.startAngle, omega: obstacle.omega });
    }
  }

  const ball = M.Bodies.circle(from.x, from.y, BALL_RADIUS, {
    restitution: RAIL_RESTITUTION,
    friction: 0,
    frictionStatic: 0,
    frictionAir: BASE_FRICTION_AIR,
    // A putted ball is a rolling sphere, not a tumbling brick — letting Matter spin it up only
    // makes the resting orientation another thing that has to match between the two callers.
    inertia: Infinity,
  } as object);

  bodies.push(ball);
  M.Composite.add(worldOf(engine), bodies as never);

  M.Body.setVelocity(ball, { x: vector.dx * vector.speed, y: vector.dy * vector.speed });

  return { engine, ball, hole, from, blades, steps: 0, outcome: 'rolling' };
}

/**
 * Advances one fixed step and re-evaluates the putt. Returns the outcome so far; anything other
 * than 'rolling' means the putt is over and the caller must stop stepping.
 */
export function stepSim(ctx: SimContext): PuttOutcome {
  if (ctx.outcome !== 'rolling') return ctx.outcome;

  const previousX = ctx.ball.position.x;
  const previousY = ctx.ball.position.y;

  // Blade phase is a function of the step counter alone, never of elapsed time, and it restarts
  // from startAngle on every putt — so the gap arrives at the same moment every time and getting
  // through it is a skill rather than a coin flip.
  for (const blade of ctx.blades) {
    M.Body.setAngle(blade.body, blade.startAngle + blade.omega * ctx.steps);
  }

  // Sand is a drag field, so it is sampled at the ball's centre rather than swept.
  let frictionAir = BASE_FRICTION_AIR;
  for (const obstacle of ctx.hole.obstacles) {
    if (obstacle.kind === 'sand' && pointInZone(obstacle.zone, previousX, previousY)) {
      frictionAir = SAND_FRICTION_AIR;
      break;
    }
  }
  ctx.ball.frictionAir = frictionAir;

  M.Engine.update(ctx.engine, STEP_MS);
  ctx.steps++;

  const x = ctx.ball.position.x;
  const y = ctx.ball.position.y;

  // Capture is tested against the swept segment, not the end point: the cup catches at any speed,
  // so a ball crossing it at 24 units per step must still drop rather than straddle it.
  if (distanceToSegment(previousX, previousY, x, y, ctx.hole.cup) <= CUP_RADIUS) {
    ctx.outcome = 'holed';
    return ctx.outcome;
  }

  for (const obstacle of ctx.hole.obstacles) {
    if (obstacle.kind === 'water' && zoneCrossed(obstacle.zone, previousX, previousY, x, y)) {
      ctx.outcome = 'water';
      return ctx.outcome;
    }
  }

  const speed = Math.hypot(ctx.ball.velocity.x, ctx.ball.velocity.y);
  if (ctx.steps >= MIN_STEPS_BEFORE_REST && speed < REST_SPEED) {
    ctx.outcome = 'rest';
    return ctx.outcome;
  }

  if (ctx.steps >= MAX_STEPS) {
    ctx.outcome = 'rest';
    return ctx.outcome;
  }

  return ctx.outcome;
}

export interface PuttResult {
  outcome: Exclude<PuttOutcome, 'rolling'>;
  /** Where the ball ends up. For water this is `from` — the putt is replayed from where it began. */
  end: Vec;
  steps: number;
}

/** Reads the settled result out of a context whose outcome is no longer 'rolling'. */
export function resultOf(ctx: SimContext): PuttResult {
  const outcome = (ctx.outcome === 'rolling' ? 'rest' : ctx.outcome) as PuttResult['outcome'];
  if (outcome === 'water') {
    return { outcome, end: { x: ctx.from.x, y: ctx.from.y }, steps: ctx.steps };
  }
  if (outcome === 'holed') {
    return { outcome, end: { x: ctx.hole.cup.x, y: ctx.hole.cup.y }, steps: ctx.steps };
  }
  return {
    outcome,
    end: { x: ctx.ball.position.x, y: ctx.ball.position.y },
    steps: ctx.steps,
  };
}

/** Headless path: runs the whole putt to a conclusion. What rules.ts calls. */
export function runPutt(engine: Engine, hole: Hole, from: Vec, vector: PuttVector): PuttResult {
  // A bull is very nearly no power at all, and a dead-centre one is exactly none. Stepping a
  // motionless ball for 240 frames to discover it has not moved is pure waste.
  if (vector.speed === 0) {
    return { outcome: 'rest', end: { x: from.x, y: from.y }, steps: 0 };
  }

  const ctx = createSim(engine, hole, from, vector);
  while (stepSim(ctx) === 'rolling') {
    /* stepSim owns the termination conditions */
  }
  return resultOf(ctx);
}
