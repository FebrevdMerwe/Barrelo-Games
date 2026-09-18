import { describe, expect, it } from "vitest";
import type { Ball } from "../physics/ball";
import type { ShotEvent } from "../physics/events";
import { detectFoul } from "./fouls";

function cueBall(pocketed: boolean): Ball {
  return { id: "cue", kind: "cue", number: 0, pos: { x: 0.5, y: 0.5 }, vel: { x: 0, y: 0 }, pocketed };
}

describe("detectFoul (§17)", () => {
  it("scratch when the cue ball is pocketed", () => {
    expect(detectFoul(cueBall(true), [])).toBe("scratch");
  });

  it("no-contact when the cue never touches an object ball", () => {
    const events: ShotEvent[] = [{ t: 0.1, kind: "cushion", ballId: "cue" }];
    expect(detectFoul(cueBall(false), events)).toBe("noContact");
  });

  it("no foul once the cue makes contact and stays on the table", () => {
    const events: ShotEvent[] = [{ t: 0.05, kind: "cueContact", ballId: "1" }];
    expect(detectFoul(cueBall(false), events)).toBeNull();
  });
});
