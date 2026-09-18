import { describe, expect, it } from "vitest";
import type { Ball } from "./ball";
import { PHYSICS } from "./constants";
import { simulateShot } from "./simulate";
import { length, sub } from "./vec2";

function ball(id: string, x: number, y: number): Ball {
  return { id, kind: id === "cue" ? "cue" : "solid", number: id === "cue" ? 0 : Number(id), pos: { x, y }, vel: { x: 0, y: 0 }, pocketed: false };
}

describe("simulateShot", () => {
  it("head-on equal-mass collision: both balls come to rest on the shot's original line", () => {
    const cue = ball("cue", 0.5, 0.5);
    const obj = ball("1", 0.8, 0.5);
    const result = simulateShot([cue, obj], "cue", { x: 3, y: 0 }, { top: 0, side: 0 }, { recordTrajectory: false });

    const finalCue = result.finalBalls.find((b) => b.id === "cue")!;
    expect(length(finalCue.vel)).toBeCloseTo(0, 6);
    // Both balls should have come to rest somewhere along the shot's original line (y unchanged).
    expect(finalCue.pos.y).toBeCloseTo(0.5, 2);
  });

  it("a close-range full-power hit with no dialed spin stays close to a dead stun", () => {
    // Barely more than 2*BALL_RADIUS apart — almost no distance to pick up natural roll before contact.
    const cue = ball("cue", 0.5, 0.5);
    const obj = ball("1", 0.56, 0.5);
    const contactX = obj.pos.x - 2 * PHYSICS.ball.radius;
    const result = simulateShot([cue, obj], "cue", { x: 3, y: 0 }, { top: 0, side: 0 }, { recordTrajectory: false });

    const finalCue = result.finalBalls.find((b) => b.id === "cue")!;
    // Should settle almost exactly where it made contact, not drift meaningfully past it.
    expect(finalCue.pos.x).toBeCloseTo(contactX, 2);
  });

  it("a longer, no-spin shot naturally follows through past the contact point (natural roll)", () => {
    // Travel distance before contact (0.2) comfortably exceeds the natural-roll transition distance at
    // this launch speed (0.18 * 1.0^2 = 0.18), so the cue ball has fully picked up natural forward roll by
    // the time it arrives — while launch speed is tuned so it arrives with only a little speed left,
    // keeping substep position quantization small relative to the expected follow-through distance.
    const cue = ball("cue", 0.3, 0.5);
    const obj = ball("1", 0.556, 0.5);
    const contactX = obj.pos.x - 2 * PHYSICS.ball.radius;
    const result = simulateShot([cue, obj], "cue", { x: 1.0, y: 0 }, { top: 0, side: 0 }, { recordTrajectory: false });

    const finalCue = result.finalBalls.find((b) => b.id === "cue")!;
    // Unlike a dead stun, the cue ball should drift forward past where it struck the object ball.
    expect(finalCue.pos.x).toBeGreaterThan(contactX + 0.001);
    expect(finalCue.pos.x).toBeLessThan(contactX + 0.01);
    expect(finalCue.pos.y).toBeCloseTo(0.5, 2);
  });

  it("pockets a ball aimed directly into a corner pocket", () => {
    const cue = ball("cue", 0.3, 0.3);
    const obj = ball("1", 0.15, 0.15);
    // Corner pocket is at (0,0); aim the object ball's ghost point so it travels straight into it.
    const result = simulateShot([cue, obj], "cue", { x: -3, y: -3 }, { top: 0, side: 0 }, { recordTrajectory: false });
    const finalObj = result.finalBalls.find((b) => b.id === "1")!;
    expect(finalObj.pocketed).toBe(true);
  });

  it("reflects a ball off a rail without losing its axis-aligned line", () => {
    // Deliberately not the table's x-midpoint — that lines up with the bottom-middle pocket's gap.
    const cue = ball("cue", PHYSICS.table.width / 4, 0.15);
    // Straight shot at the bottom rail (y=0): should bounce back upward, x roughly unchanged initially.
    const result = simulateShot([cue], "cue", { x: 0, y: -2 }, { top: 0, side: 0 }, { recordTrajectory: true });
    const finalCue = result.finalBalls.find((b) => b.id === "cue")!;
    // Restitution < 1 and rolling friction bleed off speed, but the ball must have bounced (ended up above
    // its start) rather than punched through the rail.
    expect(finalCue.pos.y).toBeGreaterThan(0);
    const hitCushion = result.events.some((e) => e.kind === "cushion");
    expect(hitCushion).toBe(true);
  });

  it("a stationary ball never moves", () => {
    const cue = ball("cue", 0.5, 0.5);
    const untouched = ball("2", 1.8, 0.9);
    const result = simulateShot([cue, untouched], "cue", { x: 1, y: 0 }, { top: 0, side: 0 }, { recordTrajectory: false });
    const final = result.finalBalls.find((b) => b.id === "2")!;
    expect(final.pos).toEqual({ x: 1.8, y: 0.9 });
  });

  it("terminates within the substep cap for a full-power break-like shot", () => {
    const cue = ball("cue", 0.5, 0.5);
    const obj = ball("1", 1.5, 0.5);
    const result = simulateShot([cue, obj], "cue", { x: PHYSICS.cueSpeed.max, y: 0 }, { top: 0, side: 0 }, {
      recordTrajectory: false,
    });
    expect(result.events.some((e) => e.kind === "rest")).toBe(true);
  });
});
