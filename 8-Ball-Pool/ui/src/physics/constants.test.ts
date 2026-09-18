import { describe, expect, it } from "vitest";
import { WEDGE_UNIT_VECTORS } from "./constants";
import { dot, length } from "./vec2";

describe("WEDGE_UNIT_VECTORS", () => {
  it("has 20 entries, each a unit vector", () => {
    expect(WEDGE_UNIT_VECTORS).toHaveLength(20);
    for (const { unit } of WEDGE_UNIT_VECTORS) {
      expect(length(unit)).toBeCloseTo(1, 10);
    }
  });

  it("matches the table-fixed frame convention: 20 up, 6 right, 3 down, 11 left (§11.1)", () => {
    const bysegment = new Map(WEDGE_UNIT_VECTORS.map((w) => [w.segment, w.unit]));
    expect(bysegment.get(20)).toEqual({ x: 0, y: 1 });
    expect(bysegment.get(6)).toEqual({ x: 1, y: 0 });
    expect(bysegment.get(3)).toEqual({ x: 0, y: -1 });
    expect(bysegment.get(11)).toEqual({ x: -1, y: 0 });
  });

  it("is ordered clockwise with 18 degrees between adjacent wedges", () => {
    const cos18 = 0.9510565162951535;
    for (let i = 0; i < 20; i++) {
      const a = WEDGE_UNIT_VECTORS[i].unit;
      const b = WEDGE_UNIT_VECTORS[(i + 1) % 20].unit;
      expect(dot(a, b)).toBeCloseTo(cos18, 10);
    }
  });
});
