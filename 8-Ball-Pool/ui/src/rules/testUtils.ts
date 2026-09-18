import type { Ring } from "../../../shared/types";
import type { DetectedThrow } from "../../../shared/types";

let counter = 0;

export function makeThrow(overrides: Partial<DetectedThrow> & { segment: number; ring: Ring }): DetectedThrow {
  counter++;
  return {
    throwId: `throw-${counter}`,
    segment: overrides.segment,
    ring: overrides.ring,
    score: overrides.score ?? overrides.segment,
    rawNotation: overrides.rawNotation ?? `${overrides.ring}-${overrides.segment}`,
    position: overrides.position ?? { x: 0, y: 0 },
    confidence: overrides.confidence ?? null,
    boardId: overrides.boardId ?? "test-board",
    cameraIndex: overrides.cameraIndex ?? null,
    detectedAtUtc: overrides.detectedAtUtc ?? new Date(counter * 1000).toISOString(),
    source: overrides.source ?? "Simulator",
  };
}
