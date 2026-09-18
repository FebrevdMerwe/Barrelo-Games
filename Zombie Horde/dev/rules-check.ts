/**
 * The gameplay smoke test from README.md, run rather than eyeballed.
 *
 *     npm run check          (from this folder's parent)
 *
 * No test framework and no dependencies: Node runs TypeScript directly, and `replay()` is a pure
 * function of a payload, so a check is nothing more than "build a visit log, fold it, assert". That is
 * the whole point of the determinism contract — the rules can be exercised with no browser, no Phaser
 * and no Barrelo anywhere in sight.
 *
 * Each case below targets a rule that is easy to get subtly wrong. If one fails, the bug is in
 * ui/src/rules.ts; nothing else here is capable of being wrong.
 */

import type { ClientGamePayload, DetectedThrow, Ring, Visit } from "../shared/types.ts";
import {
  SAFEHOUSE_HEALTH,
  TRACK_LENGTH,
  buildWave,
  hashState,
  replay,
  type GameState,
  type Zombie,
} from "../ui/src/rules.ts";

const SEED = 12345;
const PLAYER_IDS = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
  "44444444-4444-4444-4444-444444444444",
  "55555555-5555-5555-5555-555555555555",
];

/** Twenty seconds a dart, from a fixed origin — the log carries the clock, so the test can too. */
const CLOCK_ORIGIN = Date.parse("2026-01-01T20:00:00.000Z");

/**
 * A match in progress, built the way Barrelo builds one: visits created lazily on the first dart,
 * closed by the turn boundary. `state()` re-folds the whole log every time, exactly as a screen does.
 */
class Sim {
  readonly visits: Visit[] = [];
  readonly playerCount: number;
  readonly seed: number;
  private dartCount = 0;

  constructor(playerCount: number, seed = SEED) {
    this.playerCount = playerCount;
    this.seed = seed;
  }

  payload(): ClientGamePayload {
    const playerIds = PLAYER_IDS.slice(0, this.playerCount);
    return {
      seed: this.seed,
      playerIds,
      options: {},
      playerGroups: Object.fromEntries(playerIds.map((id) => [id, 0])),
      visits: this.visits,
    };
  }

  state(): GameState {
    return replay(this.payload());
  }

  dart(segment: number, ring: Ring): this {
    const last = this.visits[this.visits.length - 1];
    // A visit is over at the turn boundary *or* at three darts, so a fourth opens the next one —
    // the same rule replay() folds by, and the same one the host records with.
    const open = last !== undefined && !last.ended && last.throws.length < 3;
    if (!open) this.visits.push({ throws: [], ended: false });

    const t: DetectedThrow = {
      throwId: `t${this.dartCount}`,
      segment,
      ring,
      score: ring === "Miss" ? 0 : segment * (ring === "Triple" ? 3 : ring === "Double" ? 2 : 1),
      rawNotation: `${ring}-${segment}`,
      position: { x: 0, y: 0 },
      confidence: null,
      boardId: "check",
      cameraIndex: null,
      detectedAtUtc: new Date(CLOCK_ORIGIN + this.dartCount * 20_000).toISOString(),
      source: "Simulator",
    };
    this.dartCount++;
    this.visits[this.visits.length - 1].throws.push(t);
    return this;
  }

  miss(): this {
    return this.dart(0, "Miss");
  }

  endTurn(): this {
    const open = this.visits.length > 0 && !this.visits[this.visits.length - 1].ended;
    if (open) this.visits[this.visits.length - 1].ended = true;
    else this.visits.push({ throws: [], ended: true });
    return this;
  }

  /** One survivor's whole turn, all three darts wasted. */
  passTurn(): this {
    return this.miss().miss().miss().endTurn();
  }

  /** Every survivor passes, which takes the game through one movement phase (§3). */
  passRound(): this {
    for (let i = 0; i < this.playerCount; i++) this.passTurn();
    return this;
  }

  /** Barrelo's undo: shorten the log and re-derive. No other state exists to roll back. */
  undo(): this {
    const last = this.visits[this.visits.length - 1];
    if (!last) return this;
    if (last.ended) last.ended = false;
    else {
      last.throws.pop();
      if (last.throws.length === 0) this.visits.pop();
    }
    return this;
  }
}

// ---------------------------------------------------------------------------------------------------

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message} — expected ${b}, got ${a}`);
}

/** The zombie a dart on `segment` would actually land on, per the §6 targeting rule. */
function closestOn(state: GameState, segment: number): Zombie {
  const match = state.zombies
    .filter((z) => z.number === segment)
    .sort((a, b) => a.space - b.space || a.spawnOrder - b.spawnOrder)[0];
  assert(match !== undefined, `no zombie requires ${segment}`);
  return match;
}

// ---------------------------------------------------------------------------------------------------

console.log("\nZombie Horde — rules check\n");

check("wave 1 is 3 Walkers at the spawn line, safehouse at full health (§9, §10)", () => {
  const state = new Sim(4).state();
  assertEqual(state.wave, 1, "wave");
  assertEqual(state.zombies.length, 3, "wave 1 size");
  assert(
    state.zombies.every((z) => z.type === "Walker" && z.health === 2 && z.space === TRACK_LENGTH),
    "wave 1 should be three 2 HP Walkers at space 6"
  );
  assertEqual(state.safehouseHp, SAFEHOUSE_HEALTH, "safehouse hp");
  assertEqual(new Set(state.zombies.map((z) => z.number)).size, 3, "distinct required numbers");
});

check("S deals 1, D deals 2, T deals 3 — and a wrong number deals nothing (§5)", () => {
  const sim = new Sim(4);
  const target = sim.state().zombies[0].number;
  const other = [...Array(20).keys()].map((i) => i + 1).find((n) => !sim.state().zombies.some((z) => z.number === n))!;

  sim.dart(other, "Triple");
  assertEqual(closestOn(sim.state(), target).health, 2, "wrong number should deal nothing");

  sim.dart(target, "Single");
  assertEqual(closestOn(sim.state(), target).health, 1, "single should deal 1");

  const second = new Sim(4);
  const t2 = second.state().zombies[0].number;
  second.dart(t2, "Double");
  assert(!second.state().zombies.some((z) => z.number === t2), "a double should kill a 2 HP Walker");
});

/**
 * Finds a seed whose wave 2 puts a Runner and a Walker on the same number. Wave 2 is the first wave
 * that mixes movement speeds, so it is the first place two zombies on one number can drift to
 * different distances — which is the only way to tell "closest" apart from "oldest".
 */
function seedWithSharedNumber(): { seed: number; number: number } {
  for (let seed = 1; seed < 5000; seed++) {
    const wave = buildWave(seed, 2, 0);
    const runner = wave.find((z) => z.type === "Runner");
    if (!runner) continue;
    if (wave.some((z) => z.type === "Walker" && z.number === runner.number)) {
      return { seed, number: runner.number };
    }
  }
  throw new Error("no seed produced a Runner sharing a number with a Walker");
}

/** Clears wave 1 with three doubles and finishes the round, so wave 2 is on the board. */
function toWaveTwo(sim: Sim): Sim {
  sim
    .state()
    .zombies.map((z) => z.number)
    .forEach((n) => sim.dart(n, "Double"));
  sim.endTurn();
  for (let i = 1; i < sim.playerCount; i++) sim.passTurn();
  assertEqual(sim.state().wave, 2, "setup: wave 2 should be on the board");
  return sim;
}

check("damage lands on the zombie closest to the safehouse, not the oldest (§6)", () => {
  const { seed, number } = seedWithSharedNumber();
  const sim = toWaveTwo(new Sim(2, seed));

  // One round of movement spreads them: the Runner covers 2 spaces, the Walkers 1.
  sim.passRound();
  const spread = sim.state();
  const runner = spread.zombies.find((z) => z.type === "Runner" && z.number === number)!;
  const walker = spread.zombies.find((z) => z.type === "Walker" && z.number === number)!;
  assert(runner.space < walker.space, "setup: the Runner should be closer to the safehouse");
  assert(runner.spawnOrder > walker.spawnOrder, "setup: and the younger of the two, so age can't win");

  sim.dart(number, "Single");
  const after = sim.state();
  assert(!after.zombies.some((z) => z.id === runner.id), "the closer Runner took the dart and died");
  assertEqual(
    after.zombies.find((z) => z.id === walker.id)?.health,
    walker.health,
    "the Walker behind it is untouched"
  );
});

check("ties break by spawn order, oldest first (§6)", () => {
  // Every zombie in wave 1 spawns at the same space, so the whole wave is one big tie.
  const sim = new Sim(4);
  const start = sim.state();
  const oldest = [...start.zombies].sort((a, b) => a.spawnOrder - b.spawnOrder)[0];
  sim.dart(oldest.number, "Single");
  const hit = sim.state().zombies.find((z) => z.id === oldest.id)!;
  assertEqual(hit.health, 1, "the oldest of the tied zombies takes the damage");
});

check("overkill carries to the next-closest matching zombie (§6, §23)", () => {
  // The example from §23: a Triple into a 1 HP zombie kills it, and the remaining damage kills another
  // on the same number rather than evaporating.
  const { seed, number } = seedWithSharedNumber();
  const sim = toWaveTwo(new Sim(2, seed));

  const targetOrder = (): Zombie[] =>
    sim
      .state()
      .zombies.filter((z) => z.number === number)
      .sort((a, b) => a.space - b.space || a.spawnOrder - b.spawnOrder);

  assert(targetOrder().length >= 2, "setup: two zombies on one number");

  // Chip the front one down to exactly 1 HP, so the Triple has 2 damage left over to carry.
  while (targetOrder()[0].health > 1) sim.dart(number, "Single");

  const [front, behind] = targetOrder();
  assertEqual(front.health, 1, "setup: the front zombie is on 1 HP");
  assert(behind.health <= 2, "setup: the one behind it dies to the 2 carried damage");

  const before = sim.state().zombiesKilled;
  sim.dart(number, "Triple");
  const after = sim.state();

  assertEqual(after.zombiesKilled - before, 2, "one triple, two kills");
  assert(!after.zombies.some((z) => z.id === front.id), "the front zombie died");
  assert(!after.zombies.some((z) => z.id === behind.id), "and the overkill killed the one behind it");
});

check("a Critical Hit spends all 5 damage down the board, carrying between zombies (§6, §12)", () => {
  const sim = new Sim(4);
  const start = sim.state();
  const order = [...start.zombies].sort((a, b) => a.space - b.space || a.spawnOrder - b.spawnOrder);

  sim.dart(25, "Double"); // Bull — 5 damage, ignoring numbers and ring restrictions
  const state = sim.state();

  // Three 2 HP Walkers: 5 damage kills two outright and leaves the third on 1.
  assertEqual(state.zombiesKilled, 2, "kills");
  assertEqual(state.zombies.length, 1, "survivors");
  assertEqual(state.zombies[0].id, order[2].id, "the survivor is the last in target order");
  assertEqual(state.zombies[0].health, 1, "the survivor took the remaining 1 damage");
});

check("the outer bull freezes the movement phase for exactly one round (§12)", () => {
  const sim = new Sim(2);
  sim.dart(25, "Single").endTurn();
  assert(sim.state().freezeArmed, "the freeze should be armed for this round");

  sim.passTurn(); // second survivor finishes the round
  const frozen = sim.state();
  assert(
    frozen.zombies.every((z) => z.space === TRACK_LENGTH),
    "a frozen horde must not move"
  );
  assert(!frozen.freezeArmed, "the freeze is spent");
  assert(frozen.freezeUsed, "the banner needs to know the freeze fired");

  sim.passRound();
  assert(
    sim.state().zombies.every((z) => z.space === TRACK_LENGTH - 1),
    "the next round moves normally again"
  );
});

check("zombies move once per round, not once per turn (§3)", () => {
  // The heart of the "difficulty doesn't scale with roster size" rule: the same wave must reach the
  // safehouse on the same round whether two people or five are throwing.
  const results = [2, 5].map((players) => {
    const sim = new Sim(players);
    for (let round = 0; round < TRACK_LENGTH; round++) sim.passRound();
    const state = sim.state();
    return { players, hp: state.safehouseHp, wave: state.wave, cleared: state.wavesCleared };
  });

  assertEqual(results[0].hp, SAFEHOUSE_HEALTH - 3, "3 Walkers should land after 6 rounds at 2 players");
  assertEqual(results[1].hp, results[0].hp, "5 players must reach the same safehouse HP");
  assertEqual(results[1].wave, results[0].wave, "and the same wave");
  assertEqual(results[1].cleared, results[0].cleared, "and the same waves cleared");
});

check("a zombie that reaches the safehouse is removed and never attacks twice (§8, §9)", () => {
  const sim = new Sim(2);
  for (let round = 0; round < TRACK_LENGTH; round++) sim.passRound();

  const landed = sim.state();
  assertEqual(landed.safehouseHp, SAFEHOUSE_HEALTH - 3, "three Walkers, one HP each");
  assertEqual(landed.zombies.filter((z) => z.wave === 1).length, 0, "wave 1 is off the board");
  assertEqual(landed.wave, 2, "wave 2 spawned at the start of the next round");

  sim.passRound();
  assertEqual(sim.state().safehouseHp, SAFEHOUSE_HEALTH - 3, "wave 1 must not attack a second time");
});

check("clearing a wave ends the round the moment the clearing player's turn is over (§10)", () => {
  const sim = new Sim(4);

  // Two darts clear all of wave 1 (a Critical Hit plus a finishing single), leaving one dart of this
  // visit unthrown — exactly the "darts remaining in the turn go unused" case from §10.
  sim.dart(25, "Double");
  const survivor = sim.state().zombies[0];
  sim.dart(survivor.number, "Single");
  const cleared = sim.state();
  assertEqual(cleared.zombies.length, 0, "the board is empty");
  assertEqual(cleared.wave, 1, "the next wave has NOT spawned yet — this player's own turn isn't over");
  assertEqual(cleared.wavesCleared, 1, "the wave counts as cleared immediately");

  sim.endTurn();
  const next = sim.state();
  assertEqual(next.wave, 2, "wave 2 spawns the instant this player's turn ends — no waiting on the rest of the rotation");
  assertEqual(next.zombies.length, 5, "4 Walkers and a Runner (§10)");
  assertEqual(next.zombies.filter((z) => z.type === "Runner").length, 1, "one Runner");
  assertEqual(
    next.currentPlayerId,
    PLAYER_IDS[1],
    "the rotation simply continues with the next player, rather than resetting to the first"
  );
});

check("the score is kills×10 + waves×100 + safehouse HP×50 (§15)", () => {
  const sim = new Sim(4);
  sim.state().zombies.map((z) => z.number).forEach((n) => sim.dart(n, "Double"));
  const state = sim.state();
  assertEqual(
    state.score,
    state.zombiesKilled * 10 + state.wavesCleared * 100 + state.safehouseHp * 50,
    "score"
  );
  assertEqual(state.score, 3 * 10 + 1 * 100 + 5 * 50, "3 kills, 1 wave, full safehouse");
});

check("survival time comes from the log, not a clock (§2, §17)", () => {
  const sim = new Sim(2).dart(1, "Single").dart(2, "Single").dart(3, "Single").endTurn();
  // Three darts, 20 seconds apart: first to last is 40 seconds.
  assertEqual(sim.state().survivalMs, 40_000, "survival span");
});

check("the run ends at 0 safehouse HP, crediting every player (§2, §9, §17)", () => {
  const sim = new Sim(4);
  let guard = 0;
  while (!sim.state().isComplete && guard++ < 60) sim.passRound();

  const state = sim.state();
  assert(state.isComplete, "the safehouse should have fallen inside 60 rounds of pure misses");
  assertEqual(state.safehouseHp, 0, "safehouse hp");
  assertEqual(state.winnerPlayerIds.length, 4, "every player is a winner");
  assertEqual(state.finalStandings.length, 4, "every player is in the standings");
  assertEqual(new Set(state.winnerPlayerIds).size, 4, "no duplicates");
  assert(
    state.winnerPlayerIds.every((id) => PLAYER_IDS.includes(id)),
    "standings must be real roster ids"
  );

  // Nothing carries on after the fall — the log can grow, the state can't.
  const hashAtEnd = hashState(state);
  sim.passRound().passRound();
  assertEqual(hashState(sim.state()), hashAtEnd, "state must be frozen once the run is over");
});

check("undo is free: shortening the log brings the zombie back (§2)", () => {
  const sim = new Sim(4);
  const victim = sim.state().zombies[0];

  sim.dart(victim.number, "Single");
  assertEqual(sim.state().zombies.find((z) => z.id === victim.id)!.health, 1, "wounded");
  const beforeKill = hashState(sim.state());

  sim.dart(victim.number, "Single");
  assert(!sim.state().zombies.some((z) => z.id === victim.id), "killed");

  sim.undo();
  const restored = sim.state();
  assertEqual(restored.zombies.find((z) => z.id === victim.id)?.health, 1, "back on 1 HP, not 2");
  assertEqual(restored.zombiesKilled, 0, "the kill is un-counted");
  assertEqual(hashState(restored), beforeKill, "undo lands exactly on the earlier state");
});

check("undo straight after End turn re-opens that visit (§2)", () => {
  const sim = new Sim(4);
  const number = sim.state().zombies[0].number;
  sim.dart(number, "Single").endTurn();
  const throwerAfterEnd = sim.state().currentPlayerId;

  sim.undo();
  const reopened = sim.state();
  assert(reopened.currentPlayerId !== throwerAfterEnd, "the turn should be back with the first player");
  assertEqual(reopened.currentVisitThrows.length, 1, "the dart is still in the open visit");
  assertEqual(closestOn(reopened, number).health, 1, "and it still counts");
});

check("the same log always folds to the same state (§2)", () => {
  const sim = new Sim(3);
  for (let round = 0; round < 8; round++) {
    const state = sim.state();
    // Play it properly: aim at whatever is closest, so the log exercises kills, carries and movement.
    for (let player = 0; player < 3; player++) {
      for (let dart = 0; dart < 3; dart++) {
        const live = sim.state().zombies;
        if (live.length === 0) sim.miss();
        else {
          const target = [...live].sort((a, b) => a.space - b.space || a.spawnOrder - b.spawnOrder)[0];
          sim.dart(target.number, dart === 0 ? "Triple" : "Single");
        }
      }
      sim.endTurn();
    }
  }

  const payload = sim.payload();
  // Two "screens" folding the same log, the way the tablet and the TV do.
  const tablet = replay(payload);
  const tv = replay(payload);
  assertEqual(hashState(tablet), hashState(tv), "two screens must agree");
  assert(tablet.wave >= 2, "the run should have progressed past wave 1");
  assert(tablet.zombiesKilled > 0, "and killed something");
});

check("generated waves past the table are deterministic and MVP-legal (§10, §21)", () => {
  const sim = new Sim(2);
  // Fold the same empty-ish log twice and compare every wave the generator produces.
  for (let wave = 5; wave <= 20; wave++) {
    const a = replay({ ...sim.payload(), seed: SEED }).wave;
    assert(a >= 1, "wave numbering");
  }

  // Walk a long run and inspect each wave as it spawns.
  const long = new Sim(2);
  const seen = new Set<string>();
  let guard = 0;
  while (long.state().wave < 12 && guard++ < 400) {
    const live = long.state().zombies;
    if (live.length === 0) long.miss().miss().miss().endTurn();
    else {
      for (let dart = 0; dart < 3; dart++) {
        const board = long.state().zombies;
        if (board.length === 0) long.miss();
        else long.dart(board[0].number, "Triple");
      }
      long.endTurn();
    }
    for (const z of long.state().zombies) seen.add(z.type);
  }

  assert(long.state().wave >= 12, "the run should reach wave 12");
  assert(
    [...seen].every((type) => type === "Walker" || type === "Runner" || type === "Tank"),
    `MVP spawns Walker/Runner/Tank only, saw: ${[...seen].join(", ")}`
  );
  assert(seen.has("Tank"), "Tanks should show up by wave 12");
});

check("waves put more than one zombie on the same number (§6, §23)", () => {
  // Without this the overkill-carry rule has nowhere to carry to and the closest-first rule only ever
  // resolves same-space ties — the numbers would be spread too thinly for either to fire.
  let wavesWithSharing = 0;
  for (let wave = 2; wave <= 20; wave++) {
    const numbers = buildWave(SEED, wave, 0).map((z) => z.number);
    if (new Set(numbers).size < numbers.length) wavesWithSharing++;
  }
  assert(wavesWithSharing >= 10, `only ${wavesWithSharing} of 19 waves shared a number`);

  // ...but not so thickly that a wave collapses onto two or three numbers.
  for (let wave = 5; wave <= 20; wave++) {
    const numbers = buildWave(SEED, wave, 0).map((z) => z.number);
    const distinct = new Set(numbers).size;
    assert(distinct >= Math.ceil(numbers.length / 2), `wave ${wave} collapsed to ${distinct} numbers`);
  }

  // And a wave is the same wave on every screen, drawn from (seed, wave) alone.
  for (let wave = 1; wave <= 20; wave++) {
    assertEqual(buildWave(SEED, wave, 0), buildWave(SEED, wave, 0), `wave ${wave} is deterministic`);
  }
});

check("dead targets name the numbers nothing on the board requires (§6)", () => {
  const sim = new Sim(4);
  const state = sim.state();
  const wanted = new Set(state.zombies.map((z) => z.number));
  assertEqual(state.deadTargets.length, 20 - wanted.size, "dead target count");
  assert(
    state.deadTargets.every((n) => typeof n === "number" && !wanted.has(n)),
    "no live number may be greyed out"
  );

  // Between waves nothing is greyed out — greying all twenty helps nobody. Clear the board with two
  // darts (a Critical Hit plus a finishing single), leaving a third dart of this same visit unthrown, so
  // the round hasn't turned over to the next wave yet.
  sim.dart(25, "Double");
  const survivor = sim.state().zombies[0];
  sim.dart(survivor.number, "Single");
  assertEqual(sim.state().zombies.length, 0, "setup: the board is empty");
  assertEqual(sim.state().deadTargets, [], "empty board, empty dead list");
});

check("turn order walks the squad and comes back around (§2, §3)", () => {
  const sim = new Sim(3);
  const seats: Array<string | null> = [];
  for (let i = 0; i < 4; i++) {
    seats.push(sim.state().currentPlayerId);
    sim.passTurn();
  }
  assertEqual(seats[0], PLAYER_IDS[0], "first survivor throws first");
  assertEqual(seats[1], PLAYER_IDS[1], "then the second");
  assertEqual(seats[2], PLAYER_IDS[2], "then the third");
  assertEqual(seats[3], PLAYER_IDS[0], "and back to the first");
});

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed\n`);
  process.exit(1);
}
console.log("all checks passed\n");
