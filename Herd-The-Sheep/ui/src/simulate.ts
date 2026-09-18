import Phaser from 'phaser';
import {
  CENTRE,
  FENCE_ARC,
  FENCE_R,
  FUNNEL_WALLS,
  GATE_AXIS_Y,
  GATE_X,
  SHEEP_R,
  WALL_THICKNESS,
  funnelHalfWidthAt,
  quantise,
  type Obstacle,
  type Paddock,
  type Vec,
} from './paddock';
import type { Scare } from './scare';

/**
 * The one simulation, used twice.
 *
 * rules.ts drives it on a bare headless Matter engine to get the authoritative answer — where every
 * sheep ended up and which ones went through the gate. BoardScene drives the identical code on the
 * *live* Phaser Matter world, so you watch real bodies shove each other around rather than a
 * recorded animation. Same engine, same bodies, same fixed step, same order of operations, so both
 * land on the same numbers. That is the only reason replay() can stay a pure function while the
 * board runs genuine physics.
 *
 * Every entry point takes the engine as an argument precisely so neither caller owns it.
 *
 * DO NOT introduce a variable timestep, Math.random, or wall-clock time anywhere in this file. The
 * headless and live paths would stop agreeing and the tablet and the TV would show different flocks.
 *
 * THE SHAPE OF A BURST
 * --------------------
 * One dart is one burst. The scare is an impulse applied on step 0; after that the sheep are on
 * their own, steered by flocking and a seeded wander, with air friction bleeding the energy off.
 * Steering stops at WANDER_STEPS and the remaining steps are pure damping, which is what guarantees
 * the flock is genuinely at rest when the burst ends — and the flock being at rest is what makes it
 * honest to freeze them on screen between darts.
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

/** Hard cap on one burst: ~2.8 seconds. Both callers must use the same cap. */
export const MAX_STEPS = 170;

/**
 * Steering — wander and cohesion — is applied only for this many steps. The rest of the burst is
 * damping alone, so the flock always arrives at rest instead of being nudged forever by its own
 * wander. Freezing a still-moving flock on screen would be a visible lie.
 */
const WANDER_STEPS = 80;

/** Below this speed (field units per step) a sheep is standing still. */
const REST_SPEED = 0.15;

/** Matter reports a nonsense velocity for a step or two after setVelocity. */
const MIN_STEPS_BEFORE_REST = 6;

const FRICTION_AIR = 0.08;

/**
 * How far a scare carries, and how hard it shoves at point-blank range (units per step).
 *
 * The falloff is QUADRATIC, not linear, and that is a gameplay decision rather than a physical one.
 * A linear falloff shoves the whole flock nearly equally, so every dart detonates it outward in all
 * directions and the pieces have to be gathered up again. Squaring it concentrates the push on the
 * sheep nearest the dart, so a dart behind the flock presses its near edge and the whole blob rolls
 * forward — which is how herding actually works, and what the game claims to be about.
 */
export const SCARE_R = 260;
const SCARE_POWER = 16;

/**
 * THE RACE.
 *
 * A flock shoved at a narrowing funnel does not file through it, it arches across the neck and
 * stops dead — the same jamming that blocks a grain hopper, and measurable here: without this, a
 * naive herder walks the flock all the way to the mouth and then stalls there forever. Widening the
 * gate enough to beat the arch would take roughly six sheep-widths, which is not a pen.
 *
 * So the funnel channels actively: a sheep between the walls is drawn along them toward the gate,
 * which is what a real sheep in a real race does anyway. That converts the arch into single file.
 *
 * The consequence is deliberate and it is the best thing in the game: once the flock reaches the
 * mouth it starts trickling in on its own, and the first stretch of the race is still inside the
 * fence — so it is still throwable, and a rival can flush them back out. The denial play stops
 * being a niche trick and becomes the thing you have to watch for.
 */
const FUNNEL_DRIFT = 0.42;

/** The whistle reaches the whole paddock — it is a recall, not a bang. */
const WHISTLE_POWER = 5;
const WHISTLE_FULL_AT = 300;

/** Stragglers further than this from the flock's centre get pulled back toward it. */
const COHESION_AT = 120;
const COHESION = 0.06;

/**
 * Random walk applied per axis per step while steering is live. Kept small on purpose: the wander
 * exists so the flock is never quite where you left it, not so it can compete with a dart. At 0.11
 * a miss moved the flock nearly 60 units, which is a third of a real push — the signal was being
 * swamped by the noise.
 */
const WANDER = 0.05;

/** Nothing may exceed this, so no impulse can tunnel a sheep through a wall in one step. */
const MAX_SPEED = 24;

const FENCE_SEGMENTS = 64;

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

/** One sheep, as the rules carry it between bursts. */
export interface SheepState {
  /** Stable for the whole match, and the key every animation is tied to. */
  id: string;
  at: Vec;
}

export interface SimContext {
  readonly engine: Engine;
  readonly paddock: Paddock;
  /** Live sheep, in stable id order. Penned sheep are spliced out as they cross. */
  sheep: { id: string; body: Body }[];
  /** Ids that crossed the gate during this burst, in the order they crossed. */
  penned: string[];
  steps: number;
  done: boolean;
  readonly next: () => number;
}

/** Creates a headless engine configured identically to the scene's live Matter world. */
export function createEngine(): Engine {
  return M.Engine.create({
    gravity: { x: 0, y: 0, scale: 0 },
    enableSleeping: false,
    ...SOLVER,
  } as object);
}

/** mulberry32, matching the helper in rules.ts and paddock.ts. */
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

/**
 * The wander for a burst is seeded from the match seed and the dart's ordinal in the log, NOT from
 * a generator threaded through the whole replay. So a burst produces the same wander no matter how
 * much history preceded it, and a board that joins mid-match derives the same field as one that
 * watched from the first dart.
 */
export function burstSeed(matchSeed: number, dartOrdinal: number): number {
  return (matchSeed ^ Math.imul(dartOrdinal + 1, 0x9e3779b1)) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Paddock construction
// ---------------------------------------------------------------------------------------------

function wallBody(a: Vec, b: Vec): Body | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;

  // Overlong by its own thickness so consecutive segments overlap at the joints and leave no seam
  // for a sheep to squeeze through.
  return M.Bodies.rectangle(
    (a.x + b.x) / 2,
    (a.y + b.y) / 2,
    length + WALL_THICKNESS,
    WALL_THICKNESS,
    {
      isStatic: true,
      angle: Math.atan2(dy, dx),
      restitution: 0,
      friction: 0,
      frictionStatic: 0,
    } as object
  );
}

/**
 * The fence, as a ring of short static rectangles covering everything except the funnel mouth. The
 * arc deliberately stops exactly where the funnel walls begin (see the note in paddock.ts) so there
 * is no pocket between the two for sheep to wedge into.
 */
function buildFence(): Body[] {
  const bodies: Body[] = [];
  const span = FENCE_ARC.to - FENCE_ARC.from;

  for (let i = 0; i < FENCE_SEGMENTS; i++) {
    const a0 = FENCE_ARC.from + (span * i) / FENCE_SEGMENTS;
    const a1 = FENCE_ARC.from + (span * (i + 1)) / FENCE_SEGMENTS;
    const a: Vec = {
      x: quantise(CENTRE.x + FENCE_R * Math.cos(a0)),
      y: quantise(CENTRE.y + FENCE_R * Math.sin(a0)),
    };
    const b: Vec = {
      x: quantise(CENTRE.x + FENCE_R * Math.cos(a1)),
      y: quantise(CENTRE.y + FENCE_R * Math.sin(a1)),
    };
    const body = wallBody(a, b);
    if (body) bodies.push(body);
  }
  return bodies;
}

function buildFunnel(): Body[] {
  const bodies: Body[] = [];
  for (const wall of FUNNEL_WALLS) {
    for (let i = 0; i < wall.length - 1; i++) {
      const body = wallBody(wall[i], wall[i + 1]);
      if (body) bodies.push(body);
    }
  }
  return bodies;
}

function buildObstacle(obstacle: Obstacle): Body {
  // Pond, rocks and copse are all simply solid to sheep — they differ only in how they are drawn.
  // Line of sight is deliberately not modelled: see GameDescription.md.
  return M.Bodies.circle(obstacle.at.x, obstacle.at.y, obstacle.r, {
    isStatic: true,
    restitution: 0,
    friction: 0,
    frictionStatic: 0,
  } as object);
}

// ---------------------------------------------------------------------------------------------
// The burst
// ---------------------------------------------------------------------------------------------

function clampSpeed(body: Body): void {
  const speed = Math.hypot(body.velocity.x, body.velocity.y);
  if (speed <= MAX_SPEED) return;
  const scale = MAX_SPEED / speed;
  M.Body.setVelocity(body, { x: body.velocity.x * scale, y: body.velocity.y * scale });
}

function centroidOf(sheep: { body: Body }[]): Vec {
  if (sheep.length === 0) return { x: CENTRE.x, y: CENTRE.y };
  let x = 0;
  let y = 0;
  for (const s of sheep) {
    x += s.body.position.x;
    y += s.body.position.y;
  }
  return { x: x / sheep.length, y: y / sheep.length };
}

/**
 * The scare impulse, applied once on step 0.
 *
 * A scare pushes every sheep directly away from the point, with the force falling off linearly to
 * nothing at SCARE_R — so "throw behind them" and "throw in front of them" are one rule seen from
 * two sides. A whistle pushes nothing; it pulls the flock in toward its own centre of mass, which
 * is the only way back from a scattered flock. 'nothing' is a miss: the burst still runs, so the
 * wander still drifts them, but no impulse is applied.
 */
function applyScare(ctx: SimContext, scare: Scare): void {
  if (scare.kind === 'nothing') return;

  if (scare.kind === 'whistle') {
    const centre = centroidOf(ctx.sheep);
    for (const s of ctx.sheep) {
      const dx = centre.x - s.body.position.x;
      const dy = centre.y - s.body.position.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const strength = WHISTLE_POWER * Math.min(d / WHISTLE_FULL_AT, 1);
      M.Body.setVelocity(s.body, {
        x: s.body.velocity.x + (dx / d) * strength,
        y: s.body.velocity.y + (dy / d) * strength,
      });
      clampSpeed(s.body);
    }
    return;
  }

  for (const s of ctx.sheep) {
    const dx = s.body.position.x - scare.at.x;
    const dy = s.body.position.y - scare.at.y;
    const d = Math.hypot(dx, dy);
    if (d >= SCARE_R) continue;

    // A dart landing exactly on a sheep has no direction to flee in. Pick one from the burst's own
    // generator rather than skipping, so a dead-centre hit still scatters instead of doing nothing.
    let ux: number;
    let uy: number;
    if (d < 1e-6) {
      const angle = ctx.next() * Math.PI * 2;
      ux = Math.cos(angle);
      uy = Math.sin(angle);
    } else {
      ux = dx / d;
      uy = dy / d;
    }

    const falloff = 1 - d / SCARE_R;
    const strength = SCARE_POWER * falloff * falloff;
    M.Body.setVelocity(s.body, {
      x: s.body.velocity.x + ux * strength,
      y: s.body.velocity.y + uy * strength,
    });
    clampSpeed(s.body);
  }
}

/**
 * Wipes the world and rebuilds it for one burst. The live world is reused across darts, so clearing
 * is what keeps the two callers' worlds identical rather than one accumulating stale bodies.
 */
export function createSim(
  engine: Engine,
  paddock: Paddock,
  flock: SheepState[],
  scare: Scare,
  seed: number
): SimContext {
  M.Composite.clear(worldOf(engine), false);

  const statics: Body[] = [...buildFence(), ...buildFunnel()];
  for (const obstacle of paddock.obstacles) statics.push(buildObstacle(obstacle));

  const sheep = flock.map((s) => ({
    id: s.id,
    body: M.Bodies.circle(s.at.x, s.at.y, SHEEP_R, {
      restitution: 0,
      friction: 0,
      frictionStatic: 0,
      frictionAir: FRICTION_AIR,
      // A sheep is not a tumbling brick, and letting Matter spin it up would make the resting
      // orientation another thing that has to match between the two callers.
      inertia: Infinity,
    } as object),
  }));

  M.Composite.add(worldOf(engine), [...statics, ...sheep.map((s) => s.body)] as never);

  const ctx: SimContext = {
    engine,
    paddock,
    sheep,
    penned: [],
    steps: 0,
    done: false,
    next: rng(seed),
  };

  applyScare(ctx, scare);
  return ctx;
}

/**
 * Advances one fixed step. Returns true while the burst is still running; false means it is over
 * and the caller must stop stepping.
 */
export function stepSim(ctx: SimContext): boolean {
  if (ctx.done) return false;

  const centre = centroidOf(ctx.sheep);
  for (const s of ctx.sheep) {
    let vx = s.body.velocity.x;
    let vy = s.body.velocity.y;
    let steered = false;

    if (ctx.steps < WANDER_STEPS) {
      vx += (ctx.next() - 0.5) * 2 * WANDER;
      vy += (ctx.next() - 0.5) * 2 * WANDER;

      // Cohesion only reaches out to stragglers. Applying it to the whole flock all the time
      // collapses it into a jittering ball that no dart can break up.
      const dx = centre.x - s.body.position.x;
      const dy = centre.y - s.body.position.y;
      const d = Math.hypot(dx, dy);
      if (d > COHESION_AT) {
        vx += (dx / d) * COHESION;
        vy += (dy / d) * COHESION;
      }
      steered = true;
    }

    // The race. Applied for the WHOLE burst, not just the steered part — a sheep this far along is
    // going somewhere, and stopping the drift halfway would park it in the neck where no dart can
    // reach it and nothing can shift it.
    //
    // The commit line is the fence circle itself: inside it, a sheep in the mouth of the funnel
    // behaves like any other sheep and can be rested, herded or FLUSHED back out; outside it, the
    // race carries it to the gate. That boundary is exactly the edge of throwable space, so the
    // rule "if you can still hit it, you can still save it" holds without a line painted anywhere.
    const fromCentre = Math.hypot(s.body.position.x - CENTRE.x, s.body.position.y - CENTRE.y);
    const halfWidth = fromCentre > FENCE_R ? funnelHalfWidthAt(s.body.position.x) : 0;
    if (halfWidth > 0 && Math.abs(s.body.position.y - GATE_AXIS_Y) < halfWidth) {
      vx += FUNNEL_DRIFT;
      vy += (GATE_AXIS_Y - s.body.position.y) * (FUNNEL_DRIFT / Math.max(halfWidth, 1));
      steered = true;
    }

    if (!steered) continue;
    M.Body.setVelocity(s.body, { x: vx, y: vy });
    clampSpeed(s.body);
  }

  M.Engine.update(ctx.engine, STEP_MS);
  ctx.steps++;

  // The gate. Sheep cannot reach x >= GATE_X anywhere except through the funnel, because the fence
  // and funnel walls enclose everything else — so the crossing test needs no y bounds. Penned sheep
  // leave the simulation immediately, which is what makes a banked sheep unscatterable.
  for (let i = ctx.sheep.length - 1; i >= 0; i--) {
    if (ctx.sheep[i].body.position.x < GATE_X) continue;
    M.Composite.remove(worldOf(ctx.engine), ctx.sheep[i].body as never);
    ctx.penned.push(ctx.sheep[i].id);
    ctx.sheep.splice(i, 1);
  }
  // Recorded in a stable order regardless of which end of the array they were spliced from, so two
  // sheep crossing on the same step are always credited in the same order.
  ctx.penned.sort();

  if (ctx.steps >= MAX_STEPS) {
    ctx.done = true;
    return false;
  }

  // Rest is only tested once steering has stopped; before that the wander keeps nudging everything
  // above the threshold anyway, so testing early would only ever waste the comparison.
  if (ctx.steps >= WANDER_STEPS && ctx.steps >= MIN_STEPS_BEFORE_REST) {
    const moving = ctx.sheep.some(
      (s) => Math.hypot(s.body.velocity.x, s.body.velocity.y) >= REST_SPEED
    );
    if (!moving) {
      ctx.done = true;
      return false;
    }
  }

  return true;
}

export interface BurstResult {
  /** Every sheep still loose, in stable id order, quantised. */
  flock: SheepState[];
  /** Ids that went through the gate during this burst. */
  penned: string[];
  steps: number;
}

/**
 * Reads the settled result out of a finished context. Positions are quantised here — this is the
 * settle point the whole float-drift argument in GameDescription.md hangs on.
 */
export function resultOf(ctx: SimContext): BurstResult {
  return {
    flock: ctx.sheep.map((s) => ({
      id: s.id,
      at: { x: quantise(s.body.position.x), y: quantise(s.body.position.y) },
    })),
    penned: [...ctx.penned],
    steps: ctx.steps,
  };
}

/** Headless path: runs a whole burst to its conclusion. What rules.ts calls. */
export function runBurst(
  engine: Engine,
  paddock: Paddock,
  flock: SheepState[],
  scare: Scare,
  seed: number
): BurstResult {
  const ctx = createSim(engine, paddock, flock, scare, seed);
  while (stepSim(ctx)) {
    /* stepSim owns the termination conditions */
  }
  return resultOf(ctx);
}
