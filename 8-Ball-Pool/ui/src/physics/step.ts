import type { Ball } from "./ball";
import { BALL_RADIUS, PHYSICS, POCKET_RADIUS } from "./constants";
import { CUSHIONS, POCKETS } from "./table";
import {
  add,
  clamp01,
  closestPointOnSegment,
  dot,
  length,
  normalize,
  scale,
  sub,
  type Vec2,
} from "./vec2";
import {
  applySideSpinOnCushion,
  applyTopBackSpin,
  resolveBallBallCollision,
  resolveCushionCollision,
} from "./collisions";
import type { ShotEvent } from "./events";

export interface SpinInput {
  top: number;
  side: number;
}

/** Mutable per-shot bookkeeping the substep loop needs across calls — never read outside this file. */
export interface ShotContext {
  cueBallId: string;
  shotDirection: Vec2;
  spin: SpinInput;
  /** Topspin/backspin fires once, on the cue ball's first object-ball contact (§20.1). */
  topSpinApplied: boolean;
  /** Cue ball's position when the shot was struck — the origin for the natural-roll distance below. */
  shotStartPos: Vec2;
  /** Cue ball's launch speed — the natural-roll transition distance scales with its square. */
  initialSpeed: number;
}

/**
 * How much of the dialed top/backspin survives to the cue ball's first contact, blended with the natural
 * forward roll the ball has picked up from cloth friction over the distance it's travelled since being
 * struck (see `naturalRoll` in constants.ts). At zero travel the dialed spin is untouched; by the
 * transition distance it's fully washed out into natural roll, whichever direction it originally was.
 */
function effectiveTopSpin(ctx: ShotContext, cueBall: Ball): number {
  const travel = length(sub(cueBall.pos, ctx.shotStartPos));
  const { transitionCoeff, bias } = PHYSICS.spin.naturalRoll;
  const transitionDistance = transitionCoeff * ctx.initialSpeed * ctx.initialSpeed;
  const rollProgress = transitionDistance < 1e-9 ? 1 : clamp01(travel / transitionDistance);
  return ctx.spin.top + (bias - ctx.spin.top) * rollProgress;
}

function integrate(balls: Ball[], dt: number): void {
  for (const ball of balls) {
    if (ball.pocketed) continue;
    ball.pos = add(ball.pos, scale(ball.vel, dt));
  }
}

function capturePockets(balls: Ball[], t: number, events: ShotEvent[]): void {
  for (const ball of balls) {
    if (ball.pocketed) continue;
    for (const pocket of POCKETS) {
      if (length(sub(ball.pos, pocket.pos)) <= POCKET_RADIUS) {
        ball.pocketed = true;
        ball.vel = { x: 0, y: 0 };
        events.push({ t, kind: "ballPocketed", ballId: ball.id, pocketId: pocket.id });
        break;
      }
    }
  }
}

function resolveBallCollisions(balls: Ball[], dt: number, t: number, events: ShotEvent[], ctx: ShotContext): void {
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.pocketed) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.pocketed) continue;
      const delta = sub(b.pos, a.pos);
      const dist = length(delta);
      if (dist >= 2 * BALL_RADIUS) continue;
      const relVel = sub(b.vel, a.vel);
      if (dot(relVel, delta) >= 0) continue; // already separating — don't re-resolve a grazing pair

      resolveBallBallCollision(a, b, dt);
      events.push({ t, kind: "ballBall", a: a.id, b: b.id });

      const cueInvolved = a.id === ctx.cueBallId ? a : b.id === ctx.cueBallId ? b : null;
      const other = cueInvolved === a ? b : a;
      if (cueInvolved && !ctx.topSpinApplied) {
        events.push({ t, kind: "cueContact", ballId: other.id });
        applyTopBackSpin(cueInvolved, ctx.shotDirection, effectiveTopSpin(ctx, cueInvolved));
        ctx.topSpinApplied = true;
      }
    }
  }
}

function resolveCushions(balls: Ball[], t: number, events: ShotEvent[], ctx: ShotContext): void {
  for (const ball of balls) {
    if (ball.pocketed) continue;
    for (const cushion of CUSHIONS) {
      const closest = closestPointOnSegment(ball.pos, cushion.a, cushion.b);
      const dist = length(sub(ball.pos, closest));
      if (dist >= BALL_RADIUS) continue;
      if (dot(ball.vel, cushion.normal) >= 0) continue;

      resolveCushionCollision(ball, cushion);
      events.push({ t, kind: "cushion", ballId: ball.id });

      if (ball.id === ctx.cueBallId && ctx.spin.side !== 0) {
        applySideSpinOnCushion(ball, cushion.normal, ctx.spin.side);
      }
    }
  }
}

function applyFriction(balls: Ball[], dt: number): boolean {
  let anyMoving = false;
  const decel = PHYSICS.friction.rollingDecel * dt;
  for (const ball of balls) {
    if (ball.pocketed) continue;
    const speed = length(ball.vel);
    if (speed <= PHYSICS.friction.restSpeed) {
      ball.vel = { x: 0, y: 0 };
      continue;
    }
    const nextSpeed = speed - decel;
    if (nextSpeed <= PHYSICS.friction.restSpeed) {
      ball.vel = { x: 0, y: 0 };
    } else {
      ball.vel = scale(normalize(ball.vel), nextSpeed);
      anyMoving = true;
    }
  }
  return anyMoving;
}

/** One fixed-timestep substep. Returns true while at least one ball is still moving. */
export function step(balls: Ball[], dt: number, t: number, events: ShotEvent[], ctx: ShotContext): boolean {
  integrate(balls, dt);
  capturePockets(balls, t, events);
  resolveBallCollisions(balls, dt, t, events, ctx);
  resolveCushions(balls, t, events, ctx);
  return applyFriction(balls, dt);
}
