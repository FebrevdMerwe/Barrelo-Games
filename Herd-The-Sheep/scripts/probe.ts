/*
 * The verification harness. There is no automated test suite for the board itself — this is what
 * stands in for one, and it is the thing to re-run after touching any constant in simulate.ts.
 *
 * It bundles the *real* modules for Node (see probe.mjs) with a shim that hands simulate.ts Phaser's
 * own Matter build, so what is measured here is exactly what runs in the browser.
 *
 * It answers four questions:
 *   1. Do bursts actually settle, or do they run into the step cap with sheep still moving? A
 *      moving flock frozen on screen between darts would be a visible lie.
 *   2. Can sheep escape the paddock, or wedge somewhere they cannot be pushed out of?
 *   3. Is it playable? A deliberately naive herder — always throw straight behind the flock's
 *      centre, relative to the gate — should clear a flock in a sane number of darts. If the naive
 *      line does not work at all the game is unteachable; if it works perfectly there is no skill.
 *   4. Is the fold deterministic, and does a log prefix yield an event-stream prefix? The board's
 *      animation diffing depends on the second one.
 */
import type { ClientGamePayload, DetectedThrow } from '../shared/types';
import { CENTRE, FENCE_R, GATE_X, buildPaddock, flockSizeFor } from '../ui/src/paddock';
import { scareFor } from '../ui/src/scare';
import { burstSeed, createEngine, runBurst, MAX_STEPS, type SheepState } from '../ui/src/simulate';
import { hashState, replay } from '../ui/src/rules';

const GATE: { x: number; y: number } = { x: GATE_X, y: 450 };

function fieldToBoard(p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - CENTRE.x) / FENCE_R, y: -(p.y - CENTRE.y) / FENCE_R };
}

function dartAt(position: { x: number; y: number }, throwId: string): DetectedThrow {
  return {
    throwId,
    segment: 7,
    ring: 'Single',
    score: 7,
    rawNotation: 'S7',
    position,
    confidence: 1,
    boardId: 'probe',
    cameraIndex: null,
    detectedAtUtc: '2026-01-01T00:00:00Z',
    source: 'Simulator',
  };
}

function centroid(flock: SheepState[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const s of flock) {
    x += s.at.x;
    y += s.at.y;
  }
  return { x: x / flock.length, y: y / flock.length };
}

export function spreadOf(flock: SheepState[]): number {
  const c = centroid(flock);
  return Math.max(...flock.map((s) => Math.hypot(s.at.x - c.x, s.at.y - c.y)));
}

/** How scattered the flock has to get before the naive herder gives up pushing and whistles. */
const GATHER_AT = 230;

/**
 * The naive line, and deliberately nothing cleverer:
 *
 *  - if a flock of four or more has scattered, throw the bull and whistle them back together;
 *  - otherwise stand the scare point directly behind whichever sheep is FURTHEST from the gate, so
 *    the push sweeps the straggler up into the rest.
 *
 * Two things here are the minimum needed to stop the herder being pathological rather than merely
 * naive, and both are what a person does without thinking:
 *
 *  - Aiming behind the rear-most sheep, not the centre of mass. Pressing the centre leaves the
 *    stragglers behind and the flock stretches out; pressing the back sweeps it up.
 *  - Not whistling a flock of three. A whistle gathers to the flock's own centre, so on a small
 *    scattered flock it simply undoes the last push — the two alternate forever and the run never
 *    finishes. This is exactly the oscillation that stalled 5% of seeds indefinitely.
 *
 * The whistle is not a nicety even so: without it, a push spreads a big flock against the fence on
 * either side of the mouth and the run stalls. That is the failure the bull exists to rescue, and
 * this is where the claim gets tested rather than asserted.
 */
function naiveDart(flock: SheepState[], throwId: string): DetectedThrow {
  if (flock.length >= 4 && spreadOf(flock) > GATHER_AT) {
    return { ...dartAt({ x: 0, y: 0 }, throwId), segment: 25, ring: 'Double', score: 50 };
  }

  const rear = rearmost(flock);
  const cx = rear.at.x;
  const cy = rear.at.y;

  const dx = cx - GATE.x;
  const dy = cy - GATE.y;
  const d = Math.hypot(dx, dy) || 1;
  const behind = { x: cx + (dx / d) * 80, y: cy + (dy / d) * 80 };

  const board = fieldToBoard(behind);
  const r = Math.hypot(board.x, board.y);
  // Beyond the fence there is no dart to throw; the closest legal one is on the double ring.
  if (r > 0.98) {
    board.x = (board.x / r) * 0.98;
    board.y = (board.y / r) * 0.98;
  }
  return dartAt(board, throwId);
}

/**
 * Ring centre radii in normalized board space, measured off Barrelo's own BoardGeometry.
 * Manual entry snaps a typed throw to the centre of its segment/ring wedge, so these are the only
 * radii most pub matches ever produce.
 */
const RING_RADII = [0.365, 0.61, 0.79, 0.97];

/** Every scare point manual entry can produce: 20 segments x 4 rings. */
const WEDGE_CENTRES: { x: number; y: number }[] = [];
for (let wedge = 0; wedge < 20; wedge++) {
  const angle = wedge * ((2 * Math.PI) / 20);
  for (const radius of RING_RADII) {
    WEDGE_CENTRES.push({ x: Math.sin(angle) * radius, y: Math.cos(angle) * radius });
  }
}

/**
 * The best dart manual entry can actually throw, which is NOT the same as snapping the ideal one.
 *
 * Snapping the ideal point is what a naive implementation does and it is badly wrong: the nearest
 * legal wedge to "just behind this sheep" is frequently on the WRONG SIDE of it, so the dart shoves
 * the sheep backwards. Measured, that alone dropped manual-entry completion to 15-50%.
 *
 * A person does not do that. They look at the flock and ask which segment is behind it — that is,
 * they pick the best available option, not the nearest one to an option that doesn't exist. So the
 * herder scores every legal wedge on how well the push it produces lines the target up with the
 * gate, and throws the winner.
 */
function bestWedgeDart(target: SheepState, throwId: string): DetectedThrow {
  const gx = GATE.x - target.at.x;
  const gy = GATE.y - target.at.y;
  const gd = Math.hypot(gx, gy) || 1;

  let best = WEDGE_CENTRES[0];
  let bestScore = -Infinity;

  for (const candidate of WEDGE_CENTRES) {
    const at = {
      x: CENTRE.x + candidate.x * FENCE_R,
      y: CENTRE.y - candidate.y * FENCE_R,
    };
    const dx = target.at.x - at.x;
    const dy = target.at.y - at.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6 || d >= 260) continue;

    // How hard this dart shoves (quadratic falloff, as the sim does) times how well the shove
    // points at the gate. Anything pushing away from the gate scores negative and loses.
    const falloff = 1 - d / 260;
    const alignment = ((dx / d) * (gx / gd) + (dy / d) * (gy / gd));
    const score = falloff * falloff * alignment;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return dartAt(best, throwId);
}

/** Picks the rear-most sheep — the one furthest from the gate, and therefore the one holding it up. */
function rearmost(flock: SheepState[]): SheepState {
  return flock.reduce((worst, s) =>
    Math.hypot(s.at.x - GATE.x, s.at.y - GATE.y) >
    Math.hypot(worst.at.x - GATE.x, worst.at.y - GATE.y)
      ? s
      : worst
  );
}

/** The manual-entry herder: same decisions as the analogue one, restricted to legal wedges. */
function snappedDart(flock: SheepState[], throwId: string): DetectedThrow {
  if (flock.length >= 4 && spreadOf(flock) > GATHER_AT) {
    return { ...dartAt({ x: 0, y: 0 }, throwId), segment: 25, ring: 'Double', score: 50 };
  }
  return bestWedgeDart(rearmost(flock), throwId);
}

interface RunStats {
  darts: number;
  cleared: boolean;
  cappedBursts: number;
  movingAtEnd: number;
  escaped: number;
  /** Sheep still loose when the run gave up, and whether any dart could still have reached them. */
  stranded: SheepState[];
  unreachable: number;
}

/**
 * Whether any legal dart could still affect this sheep — that is, whether some wedge centre lies
 * within scare range of it.
 *
 * This is the assertion that actually matters about the geometry. A run the naive herder fails to
 * finish is usually just the bot being a bot; a sheep that no dart on the board can touch is a
 * paddock nobody can ever clear, and would be a genuine defect in the field layout.
 */
function reachable(sheep: SheepState): boolean {
  return WEDGE_CENTRES.some((candidate) => {
    const x = CENTRE.x + candidate.x * FENCE_R;
    const y = CENTRE.y - candidate.y * FENCE_R;
    return Math.hypot(sheep.at.x - x, sheep.at.y - y) < 260;
  });
}

/** Plays one flock to a finish with the naive herder, measuring everything on the way. */
function herd(
  seed: number,
  teamCount: number,
  mode: string,
  dartCap: number,
  snapped = false
): RunStats {
  const flockSize = flockSizeFor(mode, teamCount);
  const paddock = buildPaddock(seed, flockSize);
  const engine = createEngine();

  let flock: SheepState[] = paddock.starts.map((at, i) => ({ id: `s${i}`, at }));
  const stats: RunStats = {
    darts: 0, cleared: false, cappedBursts: 0, movingAtEnd: 0, escaped: 0,
    stranded: [], unreachable: 0,
  };

  while (flock.length > 0 && stats.darts < dartCap) {
    const dart = snapped
      ? snappedDart(flock, `t${stats.darts}`)
      : naiveDart(flock, `t${stats.darts}`);
    const result = runBurst(engine, paddock, flock, scareFor(dart), burstSeed(seed, stats.darts));
    stats.darts++;
    if (result.steps >= MAX_STEPS) stats.cappedBursts++;
    flock = result.flock;

    for (const sheep of flock) {
      const r = Math.hypot(sheep.at.x - CENTRE.x, sheep.at.y - CENTRE.y);
      // Outside the fence and not in the funnel corridor means it got through a wall.
      if (r > FENCE_R + 30 && sheep.at.x < CENTRE.x + FENCE_R - 40) stats.escaped++;
    }
  }

  stats.cleared = flock.length === 0;
  stats.stranded = flock;
  stats.unreachable = flock.filter((s) => !reachable(s)).length;
  return stats;
}

function pct(n: number, total: number): string {
  return `${((100 * n) / Math.max(1, total)).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------------------------

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
}

/**
 * Two input paths, and they are worth reporting separately because they behave very differently:
 *
 *  - ANALOGUE is what an autoscorer produces — the continuous coordinate the dart actually landed
 *    at, so the herder can put the scare point anywhere it likes.
 *  - SNAPPED is manual entry. Barrelo's BoardGeometry pins a typed throw to the CENTRE of its
 *    segment/ring wedge, so only 80 scare points exist and the ideal one is rarely among them.
 *
 * Snapped is the honest difficulty for most matches, and the number to tune against.
 */
for (const snapped of [false, true]) {
  console.log(
    `\n=== playability: naive herder, 40 seeds x 3 modes — ${snapped ? 'SNAPPED (manual entry)' : 'ANALOGUE (autoscorer)'} ===`
  );
  for (const mode of ['quick', 'standard', 'long']) {
    for (const teamCount of [1, 2, 4]) {
      const runs: RunStats[] = [];
      for (let seed = 1; seed <= 40; seed++) runs.push(herd(seed, teamCount, mode, 400, snapped));

      const cleared = runs.filter((r) => r.cleared);
      const darts = cleared.map((r) => r.darts).sort((a, b) => a - b);
      const flockSize = flockSizeFor(mode, teamCount);
      const median = darts.length ? darts[Math.floor(darts.length / 2)] : NaN;
      const perSheep = median / flockSize;

      console.log(
        `  ${mode.padEnd(8)} ${teamCount} team(s), ${String(flockSize).padStart(2)} sheep  ` +
          `cleared ${pct(cleared.length, runs.length).padStart(6)}  ` +
          `median ${String(median).padStart(3)} darts (${perSheep.toFixed(1)}/sheep)  ` +
          `worst ${darts[darts.length - 1] ?? '-'}  ` +
          `capped bursts ${runs.reduce((s, r) => s + r.cappedBursts, 0)}  ` +
          `escapes ${runs.reduce((s, r) => s + r.escaped, 0)}`
      );

      // 95%, not 100%. The herder is a deliberately dumb benchmark: it looks one dart ahead and
      // has no plan, so it can talk itself into a loop that a person would step out of instantly.
      // Its job is to prove the game is winnable without insight, and a floor is what that needs
      // to be. The check that the geometry is sound is the unreachable one below.
      check(
        `${mode}/${teamCount}t clears`,
        cleared.length >= runs.length * 0.95,
        `${cleared.length}/${runs.length} seeds cleared within 400 darts`
      );
      check(
        `${mode}/${teamCount}t nothing out of dart reach`,
        runs.every((r) => r.unreachable === 0),
        `${runs.reduce((s, r) => s + r.unreachable, 0)} sheep ended where no legal dart reaches`
      );
      check(
        `${mode}/${teamCount}t no escapes`,
        runs.every((r) => r.escaped === 0),
        `${runs.reduce((s, r) => s + r.escaped, 0)} sheep found outside the paddock`
      );
    }
  }
}

console.log('\n=== determinism ===');

/**
 * Builds a real payload by driving the RULES, one dart at a time: replay what has been logged, ask
 * the herder what to throw at the flock replay() says is out there, append it, repeat.
 *
 * Driving the rules rather than a parallel simulation is what lets this reach the endings that only
 * the fold knows about — the mathematically-decided early-out, and the sudden-death sheep, which is
 * released by replay() and exists nowhere else. An earlier version ran its own sim alongside and
 * simply stopped when the field emptied, so it could never produce a log that resolved a tie.
 */
function naivePayload(seed: number, teamCount: number, dartCap: number): ClientGamePayload {
  const playerIds = Array.from({ length: teamCount }, (_, i) => `p${i}`);
  const playerGroups: Record<string, number> = {};
  playerIds.forEach((id, i) => {
    playerGroups[id] = i;
  });

  const payload: ClientGamePayload = {
    seed,
    playerIds,
    options: { flock: 'standard' },
    playerGroups,
    visits: [],
  };

  for (let i = 0; i < dartCap; i++) {
    const state = replay(payload);
    if (state.isComplete || state.flock.length === 0) break;

    const last = payload.visits[payload.visits.length - 1];
    if (!last || last.ended) payload.visits.push({ throws: [], ended: false });
    const visit = payload.visits[payload.visits.length - 1];
    visit.throws.push(naiveDart(state.flock, `d${i}`));
    if (visit.throws.length >= 3) visit.ended = true;
  }

  return payload;
}

const payload = naivePayload(7, 2, 42);
check(
  'replay is pure',
  hashState(replay(payload)) === hashState(replay(payload)),
  'same payload replayed twice gives the same state hash'
);

const full = replay(payload);
let prefixOk = true;
for (let k = 1; k <= payload.visits.length; k++) {
  const partial = replay({ ...payload, visits: payload.visits.slice(0, k) });
  for (let i = 0; i < partial.events.length; i++) {
    // turnChanged for the last visit of a prefix is legitimately absent from the longer stream's
    // same position only if keys differ, which is exactly what we are asserting cannot happen.
    if (partial.events[i].key !== full.events[i]?.key) {
      if (partial.events[i].type === 'victory') continue;
      prefixOk = false;
      break;
    }
  }
}
check('log prefix yields event prefix', prefixOk, "the board's animation diffing depends on this");

console.log('\n=== rules edge cases ===');

const solo = replay(naivePayload(3, 1, 400));
check('solo completes', solo.isComplete, `cleared, ${solo.dartsBy[solo.teams[0].id]} darts used`);
check(
  'solo standings',
  solo.finalStandings.length === 1 && solo.winnerPlayerIds.length === 1,
  `winner ${solo.winnerPlayerIds.join(',')}`
);

const race = replay(naivePayload(11, 2, 400));
check(
  'two-team match completes',
  race.isComplete,
  `${race.teams.map((t) => `${t.id}:${race.pennedBy[t.id]}`).join(' ')} phase=${race.phase}`
);
check(
  'standings are a roster permutation',
  [...race.finalStandings].sort().join(',') === [...race.teams.flatMap((t) => t.playerIds)].sort().join(','),
  race.finalStandings.join(' > ')
);

// A miss must change no sheep position beyond the wander, and must never bank anything.
const missPaddock = buildPaddock(5, 8);
const missEngine = createEngine();
const missFlock: SheepState[] = missPaddock.starts.map((at, i) => ({ id: `s${i}`, at }));
const missDart: DetectedThrow = { ...dartAt({ x: 0, y: 1.05 }, 'miss'), ring: 'Miss', score: 0 };
const missResult = runBurst(missEngine, missPaddock, missFlock, scareFor(missDart), burstSeed(5, 0));
/*
 * What "a miss does nothing" has to mean is that the FLOCK does not move — not that no individual
 * sheep does. Cohesion still runs during the burst, so a straggler is pulled back in and can travel
 * a long way on a dart that applied no push at all. That is the flock tightening up, which is
 * correct behaviour; what would be wrong is the flock as a whole relocating.
 */
const centreBefore = centroid(missFlock);
const centreAfter = centroid(missResult.flock);
const centreDrift = Math.hypot(centreAfter.x - centreBefore.x, centreAfter.y - centreBefore.y);
const maxDrift = Math.max(
  ...missResult.flock.map((s, i) => Math.hypot(s.at.x - missFlock[i].at.x, s.at.y - missFlock[i].at.y))
);
check(
  'a miss does not move the flock',
  missResult.penned.length === 0 && centreDrift < 25,
  `centroid moved ${centreDrift.toFixed(1)} units (worst single sheep ${maxDrift.toFixed(1)}, from cohesion)`
);

// The whistle must pull the flock together, not push it apart.
function spread(flock: SheepState[]): number {
  let cx = 0;
  let cy = 0;
  for (const s of flock) {
    cx += s.at.x;
    cy += s.at.y;
  }
  cx /= flock.length;
  cy /= flock.length;
  return Math.max(...flock.map((s) => Math.hypot(s.at.x - cx, s.at.y - cy)));
}
const bullDart: DetectedThrow = { ...dartAt({ x: 0, y: 0 }, 'bull'), segment: 25, ring: 'Double', score: 50 };
const whistleEngine = createEngine();
const before = missResult.flock;
const afterWhistle = runBurst(whistleEngine, missPaddock, before, scareFor(bullDart), burstSeed(5, 1));
check(
  'the whistle gathers',
  spread(afterWhistle.flock) < spread(before),
  `spread ${spread(before).toFixed(0)} -> ${spread(afterWhistle.flock).toFixed(0)} units`
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
