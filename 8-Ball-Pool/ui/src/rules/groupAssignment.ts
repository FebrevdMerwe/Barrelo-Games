import type { Ball } from "../physics/ball";
import type { ShotEvent } from "../physics/events";
import type { Group } from "./types";

/**
 * The first legal shot after the break that pockets an object ball (not the 8) without a foul assigns
 * groups (§16.3). The shooter's team takes the group of the ball(s) it pocketed on that shot; if both
 * groups dropped on the same shot, it takes whichever group had more balls pocketed, tied by whichever
 * ball dropped first in the simulation (i.e. earliest `ballPocketed` event — the log order is already
 * deterministic, so no further tie-break is needed).
 */
export function resolveGroupAssignment(pocketedThisShot: readonly Ball[], events: readonly ShotEvent[]): Group {
  if (pocketedThisShot.length === 0) return null;

  const solids = pocketedThisShot.filter((b) => b.kind === "solid");
  const stripes = pocketedThisShot.filter((b) => b.kind === "stripe");
  if (solids.length === 0 && stripes.length === 0) return null; // only the 8-ball dropped — table stays open

  if (solids.length !== stripes.length) {
    return solids.length > stripes.length ? "solids" : "stripes";
  }

  // Tied count: whichever group's ball dropped first in the event log.
  for (const event of events) {
    if (event.kind !== "ballPocketed") continue;
    const ball = pocketedThisShot.find((b) => b.id === event.ballId);
    if (!ball) continue;
    if (ball.kind === "solid") return "solids";
    if (ball.kind === "stripe") return "stripes";
  }
  return null;
}
