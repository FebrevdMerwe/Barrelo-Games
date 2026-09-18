import type { FoulReason, Group } from "./types";

/**
 * The §16.5 result table for pocketing the 8-ball (other than on the break, which is handled separately
 * in turnEngine.ts — the 8 is just re-spotted there, never a win or loss). Only called when the 8-ball
 * was actually pocketed this shot.
 */
export function evaluateEightBall(params: {
  /** The shooter's team's assigned group, or `null` while the table is still open. */
  shooterGroup: Group;
  /** How many of the shooter's group balls (excluding the 8) remain on the table after this shot. */
  shooterGroupRemaining: number;
  foul: FoulReason | null;
}): "win" | "loss" {
  if (params.foul) return "loss";
  if (params.shooterGroup === null) return "loss";
  if (params.shooterGroupRemaining > 0) return "loss";
  return "win";
}
