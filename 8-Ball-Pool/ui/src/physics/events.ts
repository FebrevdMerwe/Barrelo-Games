import type { Vec2 } from "./vec2";

export type ShotEvent =
  | { t: number; kind: "cueContact"; ballId: string }
  | { t: number; kind: "ballPocketed"; ballId: string; pocketId: string }
  | { t: number; kind: "ballBall"; a: string; b: string }
  | { t: number; kind: "cushion"; ballId: string }
  | { t: number; kind: "rest" };

export interface TrajectoryFrame {
  t: number;
  positions: Record<string, Vec2>;
}
