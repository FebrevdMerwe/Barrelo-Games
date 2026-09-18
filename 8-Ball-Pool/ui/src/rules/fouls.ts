import type { Ball } from "../physics/ball";
import type { ShotEvent } from "../physics/events";
import type { FoulReason } from "./types";

/**
 * A foul occurs when the cue ball is pocketed, or it never contacts an object ball (§17). Scratch is
 * checked first since a scratch shot may also happen to have made contact — either is enough on its own,
 * and SCOPE.md doesn't distinguish "both" as a different case.
 */
export function detectFoul(finalCueBall: Ball, events: readonly ShotEvent[]): FoulReason | null {
  if (finalCueBall.pocketed) return "scratch";
  const madeContact = events.some((e) => e.kind === "cueContact");
  if (!madeContact) return "noContact";
  return null;
}
