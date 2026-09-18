import { describe, expect, it } from "vitest";
import { add, closestPointOnSegment, dot, length, normalize, perp, reflect, sub } from "./vec2";

describe("vec2", () => {
  it("normalizes to a unit vector", () => {
    const v = normalize({ x: 3, y: 4 });
    expect(length(v)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
  });

  it("falls back for a zero-length vector (§11.2 dead-centre bull)", () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(normalize({ x: 0, y: 0 }, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
  });

  it("reflects a velocity about a normal", () => {
    const v = { x: 1, y: -1 };
    const n = { x: 0, y: 1 };
    expect(reflect(v, n)).toEqual({ x: 1, y: 1 });
  });

  it("perp is a 90-degree rotation", () => {
    const p = perp({ x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBe(1);
    expect(dot({ x: 1, y: 0 }, perp({ x: 1, y: 0 }))).toBe(0);
  });

  it("finds the closest point on a segment via clamped projection", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(closestPointOnSegment({ x: 5, y: 3 }, a, b)).toEqual({ x: 5, y: 0 });
    expect(closestPointOnSegment({ x: -5, y: 3 }, a, b)).toEqual({ x: 0, y: 0 });
    expect(closestPointOnSegment({ x: 15, y: 3 }, a, b)).toEqual({ x: 10, y: 0 });
  });

  it("add/sub are inverses", () => {
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: -4 };
    expect(sub(add(a, b), b)).toEqual(a);
  });
});
