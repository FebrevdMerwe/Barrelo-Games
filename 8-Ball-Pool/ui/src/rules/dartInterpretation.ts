import { PHYSICS } from "../physics/constants";
import { clamp01, length, normalize, type Vec2 } from "../physics/vec2";
import type { DetectedThrow } from "../../../shared/types";
import type { Difficulty, RecommendedShot, ShotInput } from "./types";

const ZERO_SPIN = { top: 0, side: 0 };

export type DartInterpretationResult =
  | { status: "collecting" }
  | { status: "complete"; input: ShotInput; consumed: number };

function collecting(): DartInterpretationResult {
  return { status: "collecting" };
}

/** `consumed` is how many darts (from the front of the array passed in) this shot actually used — the
 *  caller needs it to know where the next shot's darts start (§23.1: a visit can hold more than one shot
 *  when the same shooter keeps their turn). Any darts beyond `consumed` are ignored for this shot (§23.2). */
function complete(
  direction: Vec2,
  power: number,
  spin: { top: number; side: number },
  recommended: RecommendedShot | null,
  consumed: number
): DartInterpretationResult {
  return { status: "complete", input: { direction, power, spin, recommended }, consumed };
}

/** A dart "hits" a target number if its segment matches, regardless of ring (§6.3's worked examples never
 *  distinguish single/double/triple — a Miss never matches since it carries no real segment). */
export function classifyHit(dart: DetectedThrow, targetSegment: number): boolean {
  return dart.ring !== "Miss" && dart.segment === targetSegment;
}

/**
 * The §8 power mapping, shared by Intermediate's power dart and Advanced's power dart (§12 says
 * explicitly "Bull, miss and power floor values are the same as Intermediate"): `max(floor, number/20)`,
 * with the bull and a miss each pinned to their own configured values.
 */
export function powerFromDartNumber(dart: DetectedThrow): number {
  if (dart.ring === "Miss") return PHYSICS.power.floor;
  if (dart.segment === 25) return PHYSICS.power.bull;
  return Math.max(PHYSICS.power.floor, dart.segment / 20);
}

/**
 * §6.6's automatic power, solved from kinematics rather than a lookup table: the launch speed (as a
 * fraction of max cue speed) that gets an object ball to the pocket with `autoPowerSafetyMargin` to
 * spare, given constant rolling deceleration (`v² = v₀² − 2·decel·d`). Clamped into Beginner's configured
 * range. Also used as the "power missing" fallback for every difficulty (§23.3).
 */
export function automaticPower(distance: number): number {
  const decel = PHYSICS.friction.rollingDecel;
  const neededSpeedSq = PHYSICS.power.autoPowerSafetyMargin * 2 * decel * Math.max(distance, 0);
  const fraction = Math.sqrt(neededSpeedSq) / PHYSICS.cueSpeed.max;
  return Math.min(PHYSICS.power.beginnerMax, Math.max(PHYSICS.power.floor, fraction));
}

/**
 * Advanced spin (§13): the dart's position relative to the board centre gives both direction (above =
 * topspin, below = backspin; left/right = sidespin) and strength (distance from centre, maxing out at the
 * outer edge of the double ring — `BoardPosition` magnitude 1.0 — and clamped there for anything beyond,
 * e.g. a miss). Dead centre is true zero spin, not "no direction" the way a direction dart treats it.
 */
export function spinFromPosition(pos: Vec2): { top: number; side: number } {
  const dist = length(pos);
  if (dist < 1e-9) return { top: 0, side: 0 };
  const strength = clamp01(dist);
  const unit = normalize(pos);
  return { top: unit.y * strength, side: unit.x * strength };
}

function power(isBreak: boolean, dartPower: number): number {
  return isBreak ? PHYSICS.cueSpeed.breakPower : dartPower;
}

/** §6, §23.4: up to 3 direction attempts; the first hit fires immediately and snaps to the recommender's
 *  exact aim angle (§6.4); missing all three falls back to the third dart's actual position (§6.5). */
export function buildBeginnerShot(
  darts: readonly DetectedThrow[],
  recommended: RecommendedShot,
  visitEnded: boolean,
  isBreak: boolean
): DartInterpretationResult {
  if (darts.length === 0) return collecting();

  // Only the first 3 darts belong to this shot — anything thrown after it fires belongs to the next one
  // (§23.1/§23.2), which may already be sitting in the same still-open visit.
  for (let i = 0; i < darts.length && i < 3; i++) {
    if (classifyHit(darts[i], recommended.recommendedSegment)) {
      return complete(recommended.aimUnitVector, power(isBreak, automaticPower(recommended.distance)), ZERO_SPIN, recommended, i + 1);
    }
  }

  if (darts.length >= 3) {
    const third = darts[2];
    return complete(normalize(third.position), power(isBreak, automaticPower(recommended.distance)), ZERO_SPIN, recommended, 3);
  }
  if (visitEnded) {
    const last = darts[darts.length - 1];
    return complete(normalize(last.position), power(isBreak, automaticPower(recommended.distance)), ZERO_SPIN, recommended, darts.length);
  }
  return collecting();
}

/** §7, §8, §23.5: up to 2 direction attempts (first hit locks direction and snaps, §6.4), then the very
 *  next dart is power (§8's shared mapping); missing both locks direction from the 2nd dart's position. */
export function buildIntermediateShot(
  darts: readonly DetectedThrow[],
  recommended: RecommendedShot,
  visitEnded: boolean,
  isBreak: boolean
): DartInterpretationResult {
  if (darts.length === 0) return collecting();

  let direction: Vec2;
  let powerDartIndex: number;

  if (classifyHit(darts[0], recommended.recommendedSegment)) {
    direction = recommended.aimUnitVector;
    powerDartIndex = 1;
  } else if (darts.length >= 2) {
    direction = classifyHit(darts[1], recommended.recommendedSegment)
      ? recommended.aimUnitVector
      : normalize(darts[1].position);
    powerDartIndex = 2;
  } else if (visitEnded) {
    direction = normalize(darts[0].position);
    powerDartIndex = 1;
  } else {
    return collecting();
  }

  if (darts.length > powerDartIndex) {
    return complete(direction, power(isBreak, powerFromDartNumber(darts[powerDartIndex])), ZERO_SPIN, recommended, powerDartIndex + 1);
  }
  if (visitEnded) {
    return complete(direction, power(isBreak, automaticPower(recommended.distance)), ZERO_SPIN, recommended, darts.length);
  }
  return collecting();
}

/**
 * §10-13, §23.6: Dart 1 direction (table-fixed frame position, §11), Dart 2 power (§12, same mapping as
 * Intermediate), Dart 3 spin (§13). No recommended target is shown, but `distanceEstimate` is still needed
 * to size the automatic-power fallback if the visit ends before the power dart arrives (§23.3) — it comes
 * from the same recommender used to display Beginner/Intermediate's target, just not surfaced to the UI.
 */
export function buildAdvancedShot(
  darts: readonly DetectedThrow[],
  distanceEstimate: number,
  visitEnded: boolean,
  isBreak: boolean
): DartInterpretationResult {
  if (darts.length === 0) return collecting();

  const direction = normalize(darts[0].position);

  if (darts.length < 2) {
    if (!visitEnded) return collecting();
    return complete(direction, power(isBreak, automaticPower(distanceEstimate)), ZERO_SPIN, null, darts.length);
  }

  const shotPower = power(isBreak, powerFromDartNumber(darts[1]));

  if (darts.length < 3) {
    if (!visitEnded) return collecting();
    return complete(direction, shotPower, ZERO_SPIN, null, darts.length); // spin missing -> no spin (§23.3)
  }

  return complete(direction, shotPower, spinFromPosition(darts[2].position), null, 3);
}

/**
 * A lightweight, display-only projection of "how far through the shot are we" — mirrors the real
 * builders' branching without needing a completed `ShotInput`, so the board can show the direction arrow
 * the moment it locks and the step label (§24) before all darts have landed.
 */
export interface ShotProgress {
  step: "direction" | "power" | "spin";
  directionLocked: { x: number; y: number } | null;
}

export function deriveShotProgress(
  difficulty: Difficulty,
  darts: readonly DetectedThrow[],
  recommended: RecommendedShot
): ShotProgress {
  if (difficulty === "beginner") {
    for (const dart of darts) {
      if (classifyHit(dart, recommended.recommendedSegment)) return { step: "direction", directionLocked: recommended.aimUnitVector };
    }
    if (darts.length >= 3) return { step: "direction", directionLocked: normalize(darts[darts.length - 1].position) };
    return { step: "direction", directionLocked: null };
  }

  if (difficulty === "intermediate") {
    if (darts.length === 0) return { step: "direction", directionLocked: null };
    if (classifyHit(darts[0], recommended.recommendedSegment)) {
      return { step: "power", directionLocked: recommended.aimUnitVector };
    }
    if (darts.length >= 2) {
      const direction = classifyHit(darts[1], recommended.recommendedSegment)
        ? recommended.aimUnitVector
        : normalize(darts[1].position);
      return { step: "power", directionLocked: direction };
    }
    return { step: "direction", directionLocked: null };
  }

  // advanced
  if (darts.length === 0) return { step: "direction", directionLocked: null };
  if (darts.length === 1) return { step: "power", directionLocked: normalize(darts[0].position) };
  return { step: "spin", directionLocked: normalize(darts[0].position) };
}

export function buildShotInput(
  difficulty: Difficulty,
  darts: readonly DetectedThrow[],
  recommended: RecommendedShot,
  visitEnded: boolean,
  isBreak: boolean
): DartInterpretationResult {
  switch (difficulty) {
    case "beginner":
      return buildBeginnerShot(darts, recommended, visitEnded, isBreak);
    case "intermediate":
      return buildIntermediateShot(darts, recommended, visitEnded, isBreak);
    case "advanced":
      return buildAdvancedShot(darts, recommended.distance, visitEnded, isBreak);
  }
}
