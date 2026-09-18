/**
 * Vector math restricted to `+ − × ÷` and `Math.sqrt` (see SCOPE.md §19.2) — no `atan2`/`sin`/`cos` here.
 * Every physics and rules module composes shots and collisions from these primitives only, so the engine
 * stays IEEE-754-exact and identical across browsers.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const ZERO: Vec2 = { x: 0, y: 0 };

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function length(v: Vec2): number {
  return Math.sqrt(lengthSq(v));
}

/** Perpendicular (90° rotation), used to build a tangential axis from a normal without trigonometry. */
export function perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

const EPS = 1e-9;

/** A zero-length vector has no direction; callers supply what "no direction" means for them (§11.2). */
export function normalize(v: Vec2, fallback: Vec2 = { x: 0, y: 1 }): Vec2 {
  const len = length(v);
  if (len < EPS) return fallback;
  return { x: v.x / len, y: v.y / len };
}

/** Reflects `v` about a unit normal `n` (elastic wall bounce): v − 2·(v·n)·n. */
export function reflect(v: Vec2, n: Vec2): Vec2 {
  const d = 2 * dot(v, n);
  return { x: v.x - d * n.x, y: v.y - d * n.y };
}

export function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Closest point on segment [a,b] to point p, via clamped projection — no trig, just dot products. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const abLenSq = lengthSq(ab);
  if (abLenSq < EPS) return a;
  const t = clamp01(dot(sub(p, a), ab) / abLenSq);
  return add(a, scale(ab, t));
}
