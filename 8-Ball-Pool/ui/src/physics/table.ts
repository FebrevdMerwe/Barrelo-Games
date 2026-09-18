import type { Vec2 } from "./vec2";
import { PHYSICS, POCKET_RADIUS } from "./constants";

export interface Pocket {
  id: string;
  pos: Vec2;
}

export interface CushionSegment {
  a: Vec2;
  b: Vec2;
  /** Precomputed, since every cushion here is axis-aligned — no need to derive it per collision. */
  normal: Vec2;
}

const { width: W, height: H } = PHYSICS.table;

/**
 * Six pockets: four corners plus the two side pockets at the midpoints of the long rails. Positions are
 * the geometric capture points cushions are cut away from (see `CUSHIONS` below).
 */
export const POCKETS: readonly Pocket[] = [
  { id: "topLeft", pos: { x: 0, y: H } },
  { id: "topMiddle", pos: { x: W / 2, y: H } },
  { id: "topRight", pos: { x: W, y: H } },
  { id: "bottomLeft", pos: { x: 0, y: 0 } },
  { id: "bottomMiddle", pos: { x: W / 2, y: 0 } },
  { id: "bottomRight", pos: { x: W, y: 0 } },
];

/**
 * Six straight rail segments — the table's perimeter minus a gap of `2×POCKET_RADIUS` centered on each
 * pocket, so a ball can pass through the mouth instead of bouncing off it. Real tables angle the cushion
 * jaws near each pocket; this MVP skips that (§19.3's "forgiving pocket geometry" doesn't need it) and
 * keeps every cushion axis-aligned, which keeps collision response exact and cheap.
 */
export const CUSHIONS: readonly CushionSegment[] = [
  // Left rail (behind the two left pockets)
  { a: { x: 0, y: POCKET_RADIUS }, b: { x: 0, y: H - POCKET_RADIUS }, normal: { x: 1, y: 0 } },
  // Right rail
  { a: { x: W, y: POCKET_RADIUS }, b: { x: W, y: H - POCKET_RADIUS }, normal: { x: -1, y: 0 } },
  // Bottom rail, left half and right half of the gap at the bottom-middle pocket
  { a: { x: POCKET_RADIUS, y: 0 }, b: { x: W / 2 - POCKET_RADIUS, y: 0 }, normal: { x: 0, y: 1 } },
  { a: { x: W / 2 + POCKET_RADIUS, y: 0 }, b: { x: W - POCKET_RADIUS, y: 0 }, normal: { x: 0, y: 1 } },
  // Top rail, left half and right half of the gap at the top-middle pocket
  { a: { x: POCKET_RADIUS, y: H }, b: { x: W / 2 - POCKET_RADIUS, y: H }, normal: { x: 0, y: -1 } },
  { a: { x: W / 2 + POCKET_RADIUS, y: H }, b: { x: W - POCKET_RADIUS, y: H }, normal: { x: 0, y: -1 } },
];

export const HEAD_SPOT: Vec2 = PHYSICS.spots.head;
export const FOOT_SPOT: Vec2 = PHYSICS.spots.foot;
export const TABLE_WIDTH = W;
export const TABLE_HEIGHT = H;
