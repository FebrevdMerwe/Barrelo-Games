/**
 * The SCOPE.md §19.4 validation gate. Standalone (not Vitest) because these are statistical/timing checks
 * over many simulated shots rather than fixed-input assertions. Run with `npm run validate-physics` from
 * `ui/` (or `npm run validate-physics` at the repo root, which forwards there).
 *
 * NOTE on the performance check: the <300ms figure in §19.4 is specified for "target TV hardware", which
 * this script can't know it's running on. The timing check here is a regression guard on whatever machine
 * runs it, not proof of the actual requirement — that needs a manual run on the real hardware before ship.
 */
import { performance } from "node:perf_hooks";
import { initialRack, type Ball } from "../ui/src/physics/ball";
import { PHYSICS, BALL_RADIUS } from "../ui/src/physics/constants";
import { POCKETS, TABLE_WIDTH, TABLE_HEIGHT } from "../ui/src/physics/table";
import { simulateShot } from "../ui/src/physics/simulate";
import { add, length, normalize, scale, sub, type Vec2 } from "../ui/src/physics/vec2";
import { evaluatePotCandidate } from "../ui/src/rules/geometry";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
function check(name: string, pass: boolean, detail?: string): void {
  if (pass) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Test A: 200 full-power breaks — no tunnelling through a ball, cushion, or pocket mouth.
// ---------------------------------------------------------------------------
function runBreakTest(): void {
  console.log("\n[break] 200 full-power breaks, checking for tunnelling...");
  const draw = rng(0xb1eac4);
  let worstMinPairDist = Infinity;
  let outOfBounds = 0;
  let interpenetrations = 0;

  for (let i = 0; i < 200; i++) {
    const balls = initialRack();
    const cue = balls.find((b) => b.id === "cue")!;
    // Small aim jitter so 200 breaks aren't 200 identical simulations — still deterministic per seed.
    const jitter = (draw() - 0.5) * 0.02;
    const dir = normalize({ x: 1, y: jitter });
    const cueVel = scale(dir, PHYSICS.cueSpeed.max);

    const result = simulateShot(balls, "cue", cueVel, { top: 0, side: 0 }, { recordTrajectory: true });

    for (const frame of result.trajectory ?? []) {
      const entries = Object.entries(frame.positions);
      for (let a = 0; a < entries.length; a++) {
        const [idA, posA] = entries[a];
        const ballA = result.finalBalls.find((b) => b.id === idA)!;
        if (ballA.pocketed) continue;
        if (
          posA.x < -BALL_RADIUS ||
          posA.x > TABLE_WIDTH + BALL_RADIUS ||
          posA.y < -BALL_RADIUS ||
          posA.y > TABLE_HEIGHT + BALL_RADIUS
        ) {
          outOfBounds++;
        }
        for (let b = a + 1; b < entries.length; b++) {
          const [idB, posB] = entries[b];
          const ballB = result.finalBalls.find((x) => x.id === idB)!;
          if (ballB.pocketed) continue;
          const dist = length(sub(posB, posA));
          worstMinPairDist = Math.min(worstMinPairDist, dist);
          // A ball genuinely passing through another would show as a deep overlap, not the brief
          // touching-distance contact normal resolution produces within the same substep.
          if (dist < BALL_RADIUS) interpenetrations++;
        }
      }
    }
  }

  check("no ball ever exits the table bounds mid-flight", outOfBounds === 0, `${outOfBounds} frame-ball violations`);
  check(
    "no ball ever deeply overlaps another (tunnelling)",
    interpenetrations === 0,
    `${interpenetrations} frame-pair violations, worst pairwise distance ${worstMinPairDist.toFixed(5)}`
  );
}

// ---------------------------------------------------------------------------
// Test B: 50 random makeable shots at the recommender's exact ghost-ball angle — >=95% pot rate.
// ---------------------------------------------------------------------------
function randomPointOnTable(draw: () => number, margin: number): Vec2 {
  return {
    x: margin + draw() * (TABLE_WIDTH - 2 * margin),
    y: margin + draw() * (TABLE_HEIGHT - 2 * margin),
  };
}

/**
 * Only the cue ball's velocity *component along the contact normal* transfers to the object ball on an
 * elastic centre-line collision — a thin cut (small `cutAngleCos`) hands off much less speed than a
 * straight-on hit, and the cue also loses some speed to rolling friction before it even arrives. Picking a
 * fixed launch speed regardless of geometry makes distant thin cuts fail for a reason that has nothing to
 * do with aim accuracy (they simply run out of speed before the object ball reaches the pocket) — so this
 * derives the minimum speed the shot actually needs, the same kinematics §6.6's automatic power will use
 * for real. `v² = v₀² − 2·decel·d` rearranged for the required launch speed, with a safety margin so the
 * object ball arrives with speed to spare rather than stopping exactly on the lip.
 */
function requiredCueSpeed(cueToGhostDist: number, objectToPocketDist: number, cutAngleCos: number): number {
  const decel = PHYSICS.friction.rollingDecel;
  const margin = 1.6;
  const neededObjectSpeedSq = margin * 2 * decel * objectToPocketDist;
  const neededCueSpeedAtContactSq = neededObjectSpeedSq / (cutAngleCos * cutAngleCos);
  const v0Sq = 2 * decel * cueToGhostDist + neededCueSpeedAtContactSq;
  return Math.min(PHYSICS.cueSpeed.max, Math.sqrt(v0Sq));
}

function runCutAccuracyTest(): void {
  console.log("\n[cut accuracy] 50 random makeable shots at the recommender's exact angle...");
  const draw = rng(0xc0ffee);
  let attempts = 0;
  let potted = 0;
  const trials = 50;
  const maxSampleAttempts = trials * 200;

  for (let sample = 0; attempts < trials && sample < maxSampleAttempts; sample++) {
    const cuePos = randomPointOnTable(draw, 0.15);
    const objectPos = randomPointOnTable(draw, 0.15);
    if (length(sub(objectPos, cuePos)) < 0.15) continue; // too close to be a meaningful test shot

    const pocket = POCKETS[Math.floor(draw() * POCKETS.length)];
    const objectBall: Ball = { id: "1", kind: "solid", number: 1, pos: objectPos, vel: { x: 0, y: 0 }, pocketed: false };
    const cueBall: Ball = { id: "cue", kind: "cue", number: 0, pos: cuePos, vel: { x: 0, y: 0 }, pocketed: false };

    const candidate = evaluatePotCandidate(cuePos, objectBall, pocket);
    if (!candidate) continue; // cut too steep — not a fair test shot, resample

    attempts++;
    const cueToGhostDist = length(sub(candidate.ghostPos, cuePos));
    const objectToPocketDist = length(sub(pocket.pos, objectPos));
    const speed = requiredCueSpeed(cueToGhostDist, objectToPocketDist, candidate.cutAngleCos);
    const cueVel = scale(candidate.cueToGhostUnit, speed);
    const result = simulateShot([cueBall, objectBall], "cue", cueVel, { top: 0, side: 0 }, { recordTrajectory: false });
    const wentIn = result.events.some(
      (e) => e.kind === "ballPocketed" && e.ballId === objectBall.id && e.pocketId === pocket.id
    );
    if (wentIn) potted++;
  }

  const rate = attempts === 0 ? 0 : potted / attempts;
  check(
    `pot rate >= 95% (${potted}/${attempts})`,
    attempts >= trials * 0.5 && rate >= 0.95,
    `${(rate * 100).toFixed(1)}%`
  );
}

// ---------------------------------------------------------------------------
// Test C: 100-shot replay timing (<300ms) — informational regression guard, not proof of the TV-hardware
// requirement.
// ---------------------------------------------------------------------------
function runPerformanceTest(): void {
  console.log("\n[perf] timing a 100-shot replay (informational — real target is TV hardware)...");
  const draw = rng(0x5ca1ab1e);
  const shots: { cueVel: Vec2 }[] = [];
  for (let i = 0; i < 100; i++) {
    const angle = draw() * 2 - 1;
    shots.push({ cueVel: scale(normalize({ x: 1, y: angle }), PHYSICS.cueSpeed.max * (0.3 + draw() * 0.7)) });
  }

  const start = performance.now();
  for (const shot of shots) {
    const balls = initialRack();
    simulateShot(balls, "cue", shot.cueVel, { top: 0, side: 0 }, { recordTrajectory: false });
  }
  const elapsed = performance.now() - start;

  console.log(`  elapsed: ${elapsed.toFixed(1)}ms for 100 shots`);
  if (elapsed >= 300) {
    console.log(`  WARN  exceeds the 300ms target on this machine — re-check on real TV hardware before ship`);
  } else {
    console.log(`  ok    under the 300ms target on this machine`);
  }
}

runBreakTest();
runCutAccuracyTest();
runPerformanceTest();

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
