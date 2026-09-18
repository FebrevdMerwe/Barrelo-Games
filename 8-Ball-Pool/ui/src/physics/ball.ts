import type { Vec2 } from "./vec2";
import { BALL_RADIUS } from "./constants";
import { FOOT_SPOT, HEAD_SPOT } from "./table";

export type BallKind = "cue" | "solid" | "stripe" | "eight";

export interface Ball {
  id: string;
  kind: BallKind;
  /** 0 for the cue ball. */
  number: number;
  pos: Vec2;
  vel: Vec2;
  pocketed: boolean;
}

function kindFor(number: number): BallKind {
  if (number === 8) return "eight";
  return number < 8 ? "solid" : "stripe";
}

/**
 * MVP rack: a fixed, deterministic ball placement rather than a seed-shuffled one. The only placement
 * rule our ruleset (SCOPE.md §16) actually depends on is the 8-ball sitting at the center of the third
 * row — nothing in the rules cares which corner holds a stripe vs. a solid the way a tournament anchor
 * convention would, so shuffling the other 14 balls per match would add complexity with no rules payoff.
 */
const RACK_FILL_ORDER = [1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];

export function initialRack(): Ball[] {
  const balls: Ball[] = [
    { id: "cue", kind: "cue", number: 0, pos: { ...HEAD_SPOT }, vel: { x: 0, y: 0 }, pocketed: false },
  ];

  const rowSpacingX = BALL_RADIUS * Math.sqrt(3);
  let fillIndex = 0;
  let slot = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      const pos: Vec2 = {
        x: FOOT_SPOT.x + row * rowSpacingX,
        y: FOOT_SPOT.y + (j - row / 2) * 2 * BALL_RADIUS,
      };
      const number = slot === 4 ? 8 : RACK_FILL_ORDER[fillIndex++];
      balls.push({ id: String(number), kind: kindFor(number), number, pos, vel: { x: 0, y: 0 }, pocketed: false });
      slot++;
    }
  }

  return balls;
}

export function cloneBalls(balls: readonly Ball[]): Ball[] {
  return balls.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel } }));
}
