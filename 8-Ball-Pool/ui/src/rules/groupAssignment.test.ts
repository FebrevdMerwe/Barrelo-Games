import { describe, expect, it } from "vitest";
import type { Ball } from "../physics/ball";
import type { ShotEvent } from "../physics/events";
import { resolveGroupAssignment } from "./groupAssignment";

function ball(id: string, kind: Ball["kind"]): Ball {
  return { id, kind, number: kind === "eight" ? 8 : kind === "solid" ? Number(id) : Number(id), pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, pocketed: true };
}

describe("resolveGroupAssignment (§16.3)", () => {
  it("returns null when nothing was pocketed", () => {
    expect(resolveGroupAssignment([], [])).toBeNull();
  });

  it("returns null when only the 8-ball dropped", () => {
    expect(resolveGroupAssignment([ball("8", "eight")], [])).toBeNull();
  });

  it("assigns solids when only solids dropped", () => {
    expect(resolveGroupAssignment([ball("1", "solid"), ball("2", "solid")], [])).toBe("solids");
  });

  it("assigns the group with more balls pocketed on a mixed shot", () => {
    const pocketed = [ball("1", "solid"), ball("2", "solid"), ball("9", "stripe")];
    expect(resolveGroupAssignment(pocketed, [])).toBe("solids");
  });

  it("breaks a tie by whichever ball dropped first in the event log", () => {
    const pocketed = [ball("1", "solid"), ball("9", "stripe")];
    const events: ShotEvent[] = [
      { t: 0, kind: "ballPocketed", ballId: "9", pocketId: "topLeft" },
      { t: 0.1, kind: "ballPocketed", ballId: "1", pocketId: "bottomLeft" },
    ];
    expect(resolveGroupAssignment(pocketed, events)).toBe("stripes");
  });
});
