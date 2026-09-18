import { describe, expect, it } from "vitest";
import {
  automaticPower,
  buildAdvancedShot,
  buildBeginnerShot,
  buildIntermediateShot,
  powerFromDartNumber,
  spinFromPosition,
} from "./dartInterpretation";
import type { RecommendedShot } from "./types";
import { makeThrow } from "./testUtils";

const recommended: RecommendedShot = {
  tier: "pot",
  targetBallNumber: 3,
  pocketId: "topLeft",
  aimUnitVector: { x: 0.6, y: 0.8 },
  recommendedSegment: 5,
  distance: 1.0,
};

describe("Beginner (§6)", () => {
  it("fires on the first hit, ignoring later darts (§6.4)", () => {
    const darts = [makeThrow({ segment: 5, ring: "OuterSingle" }), makeThrow({ segment: 8, ring: "OuterSingle" })];
    const result = buildBeginnerShot(darts, recommended, false, false);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.input.direction).toEqual(recommended.aimUnitVector); // snaps to exact angle
    }
  });

  it("uses the first hit even if it's dart 1 (§6.4 worked example)", () => {
    const darts = [makeThrow({ segment: 5, ring: "OuterSingle" })];
    const result = buildBeginnerShot(darts, recommended, false, false);
    expect(result.status).toBe("complete");
  });

  it("keeps collecting through two misses", () => {
    const darts = [makeThrow({ segment: 7, ring: "OuterSingle" }), makeThrow({ segment: 18, ring: "OuterSingle" })];
    expect(buildBeginnerShot(darts, recommended, false, false).status).toBe("collecting");
  });

  it("falls back to dart 3's actual position after three misses (§6.5)", () => {
    const dart3 = makeThrow({ segment: 12, ring: "OuterSingle", position: { x: 0.3, y: 0.4 } });
    const darts = [makeThrow({ segment: 7, ring: "OuterSingle" }), makeThrow({ segment: 18, ring: "OuterSingle" }), dart3];
    const result = buildBeginnerShot(darts, recommended, false, false);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.input.direction.x).toBeCloseTo(0.6, 5);
      expect(result.input.direction.y).toBeCloseTo(0.8, 5);
    }
  });

  it("uses the configured break power on the break, not the auto-power estimate", () => {
    const dart3 = makeThrow({ segment: 12, ring: "OuterSingle", position: { x: 0.3, y: 0.4 } });
    const darts = [makeThrow({ segment: 7, ring: "OuterSingle" }), makeThrow({ segment: 18, ring: "OuterSingle" }), dart3];
    const result = buildBeginnerShot(darts, recommended, false, true);
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.input.power).toBe(0.95);
  });
});

describe("Intermediate (§7, §8)", () => {
  it("locks direction on dart 1 and takes dart 2 as power", () => {
    const darts = [makeThrow({ segment: 5, ring: "OuterSingle" }), makeThrow({ segment: 14, ring: "OuterSingle" })];
    const result = buildIntermediateShot(darts, recommended, false, false);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.input.direction).toEqual(recommended.aimUnitVector);
      expect(result.input.power).toBeCloseTo(14 / 20, 10);
    }
  });

  it("falls back to dart 2's position when both direction attempts miss, and dart 3 is power", () => {
    const dart2 = makeThrow({ segment: 12, ring: "OuterSingle", position: { x: 0.1, y: 0.9 } });
    const darts = [makeThrow({ segment: 7, ring: "OuterSingle" }), dart2, makeThrow({ segment: 20, ring: "OuterSingle" })];
    const result = buildIntermediateShot(darts, recommended, false, false);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.input.direction.x).toBeCloseTo(0.1 / Math.hypot(0.1, 0.9), 5);
      expect(result.input.power).toBeCloseTo(1.0, 10);
    }
  });

  it("keeps collecting when direction is locked but the power dart hasn't landed", () => {
    const darts = [makeThrow({ segment: 5, ring: "OuterSingle" })];
    expect(buildIntermediateShot(darts, recommended, false, false).status).toBe("collecting");
  });
});

describe("§8 power mapping (shared by Intermediate + Advanced)", () => {
  it.each([
    [1, 0.15],
    [5, 0.25],
    [10, 0.5],
    [15, 0.75],
    [20, 1.0],
  ])("dart %i -> power %f", (segment, expected) => {
    expect(powerFromDartNumber(makeThrow({ segment, ring: "OuterSingle" }))).toBeCloseTo(expected, 10);
  });

  it("bull gives exactly the configured bull power", () => {
    expect(powerFromDartNumber(makeThrow({ segment: 25, ring: "Single" }))).toBe(0.5);
  });

  it("a miss gives exactly the power floor", () => {
    expect(powerFromDartNumber(makeThrow({ segment: 0, ring: "Miss" }))).toBe(0.15);
  });
});

describe("Advanced (§10-13)", () => {
  it("builds direction/power/spin from darts 1/2/3", () => {
    const darts = [
      makeThrow({ segment: 6, ring: "OuterSingle", position: { x: 1, y: 0 } }),
      makeThrow({ segment: 20, ring: "OuterSingle" }),
      makeThrow({ segment: 1, ring: "OuterSingle", position: { x: 0, y: 0.5 } }),
    ];
    const result = buildAdvancedShot(darts, 1.0, false, false);
    expect(result.status).toBe("complete");
    if (result.status === "complete") {
      expect(result.input.direction).toEqual({ x: 1, y: 0 });
      expect(result.input.power).toBe(1.0);
      expect(result.input.spin).toEqual({ top: 0.5, side: 0 });
      expect(result.input.recommended).toBeNull(); // §10.1: no recommended target in Advanced
    }
  });

  it("dead-centre bull direction shoots straight up (§11.2)", () => {
    const darts = [makeThrow({ segment: 25, ring: "Double", position: { x: 0, y: 0 } })];
    const result = buildAdvancedShot(darts, 1.0, true, false); // visit ended after dart 1 only
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.input.direction).toEqual({ x: 0, y: 1 });
  });

  it("spin missing at visit end falls back to no spin (§23.3)", () => {
    const darts = [
      makeThrow({ segment: 6, ring: "OuterSingle", position: { x: 1, y: 0 } }),
      makeThrow({ segment: 10, ring: "OuterSingle" }),
    ];
    const result = buildAdvancedShot(darts, 1.0, true, false);
    expect(result.status).toBe("complete");
    if (result.status === "complete") expect(result.input.spin).toEqual({ top: 0, side: 0 });
  });
});

describe("spinFromPosition (§13)", () => {
  it("dead centre is true zero spin", () => {
    expect(spinFromPosition({ x: 0, y: 0 })).toEqual({ top: 0, side: 0 });
  });

  it("above centre is topspin, clamped at the double ring", () => {
    expect(spinFromPosition({ x: 0, y: 2 })).toEqual({ top: 1, side: 0 }); // beyond the ring clamps to max
  });

  it("mixes top and side for an off-axis position", () => {
    const spin = spinFromPosition({ x: 0.3, y: 0.4 });
    expect(spin.top).toBeCloseTo(0.4, 5);
    expect(spin.side).toBeCloseTo(0.3, 5);
  });
});

describe("automaticPower (§6.6)", () => {
  it("is clamped to the power floor for a zero-distance shot", () => {
    expect(automaticPower(0)).toBe(0.15);
  });

  it("increases with distance but never exceeds the beginner max", () => {
    expect(automaticPower(0.5)).toBeGreaterThan(0.15);
    expect(automaticPower(1000)).toBe(0.7);
  });
});
