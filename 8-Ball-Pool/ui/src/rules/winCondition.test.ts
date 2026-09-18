import { describe, expect, it } from "vitest";
import { evaluateEightBall } from "./winCondition";

describe("evaluateEightBall (§16.5)", () => {
  it("wins when the shooter's group is fully cleared with no foul", () => {
    expect(evaluateEightBall({ shooterGroup: "solids", shooterGroupRemaining: 0, foul: null })).toBe("win");
  });

  it("loses when the shooter's group isn't fully cleared", () => {
    expect(evaluateEightBall({ shooterGroup: "solids", shooterGroupRemaining: 2, foul: null })).toBe("loss");
  });

  it("loses when the table is still open", () => {
    expect(evaluateEightBall({ shooterGroup: null, shooterGroupRemaining: 0, foul: null })).toBe("loss");
  });

  it("loses on a foul even with a cleared group", () => {
    expect(evaluateEightBall({ shooterGroup: "stripes", shooterGroupRemaining: 0, foul: "scratch" })).toBe("loss");
  });
});
