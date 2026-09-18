import type { ClientGamePayload, DetectedThrow, Ring, Visit } from "../../shared/types";

/**
 * ZOMBIE HORDE — the whole game, as a pure fold over Barrelo's visit log.
 *
 * See "Zombie Horde — Game Scope.md" for the rules this implements; section references (§n) throughout
 * point at it. The scope is the authority — if the two disagree, the scope is right and this is a bug.
 *
 * WHY IT MUST BE PURE
 * -------------------
 * Barrelo keeps the log; every screen showing this match (the control tablet, the TV) replays it
 * independently. They only agree if replaying the same log always produces the same state. So:
 *
 *   - No `Math.random()` — use `rng(payload.seed)` below.
 *   - No `Date.now()` / `new Date()` — use `throw.detectedAtUtc` from the log.
 *   - No `crypto.randomUUID()` — derive ids from the log, or from the wave that spawned them.
 *   - No reading or writing anything outside this function (no module-level mutable state, no
 *     localStorage, no fetch).
 *
 * This bites Zombie Horde harder than a scoring game, because so much of its state *looks* like
 * something you would accumulate. It isn't: the wave number, every zombie's position and health, the
 * safehouse HP, the score and the survival time are all recomputed from the whole log on every push,
 * which is also what makes undo free (§2).
 */

// ---------------------------------------------------------------------------------------------------
// Constants (§20). Every tunable value lives here; none of them can change mid-match, because a
// mid-match toggle is not in the log.
// ---------------------------------------------------------------------------------------------------

/** The safehouse starts here and the run ends when it hits zero (§9). */
export const SAFEHOUSE_HEALTH = 5;
/** Zombies spawn at this space; the safehouse sits at space 0 (§8). */
export const TRACK_LENGTH = 6;
/** Traditional darts format (§4). Also the visit length Barrelo's turn boundary agrees with. */
export const DARTS_PER_TURN = 3;
/** Bull (segment 25, `Double`) — ignores required number and ring restriction (§12). */
export const CRITICAL_HIT_DAMAGE = 5;
/** Score weights (§15). */
export const SCORE_PER_KILL = 10;
export const SCORE_PER_WAVE = 100;
export const SCORE_PER_SAFEHOUSE_HP = 50;
/** Every 5th wave is a boss wave (§11) — a horde surge until bosses ship (see BOSSES_ENABLED). */
export const BOSS_INTERVAL = 5;
/**
 * Hard cap on a generated wave's size. Past this the difficulty curve buys health instead of bodies —
 * a track of six spaces stops being readable long before it stops being spawnable (§14).
 */
export const MAX_ZOMBIES_PER_WAVE = 12;

export type Difficulty = "beginner" | "intermediate" | "advanced";

export const DEFAULT_DIFFICULTY: Difficulty = "intermediate";

/**
 * The wave the team must clear to win outright (§17, §19). In the MVP this is the *only* thing
 * difficulty changes — every difficulty plays the same wave table and zombie stats from §10, so the
 * curve only needs tuning once.
 */
export const WIN_TARGET_WAVE: Record<Difficulty, number> = {
  beginner: 10,
  intermediate: 20,
  advanced: 30,
};

/** Anything that isn't a known difficulty (missing, stale, or a bad setting) falls back to the default. */
function parseDifficulty(value: string | undefined): Difficulty {
  if (value === "beginner" || value === "intermediate" || value === "advanced") return value;
  return DEFAULT_DIFFICULTY;
}

export type ZombieTypeName = "Walker" | "Runner" | "Tank" | "Swarm" | "Armoured" | "Mutant" | "Boss";

/** A ring a zombie can be restricted to. Restricted zombies take damage from that ring only (§7). */
export type RingRestriction = "Double" | "Triple";

interface ZombieTypeDef {
  health: number;
  movement: number;
  ring: RingRestriction | null;
  /** Damage this type deals to the safehouse when it lands (§9). */
  safehouseDamage: number;
  label: string;
}

/** The full table from §7 + §9. Which of these actually *spawn* is ENABLED_TYPES, below. */
export const ZOMBIE_TYPES: Record<ZombieTypeName, ZombieTypeDef> = {
  Walker: { health: 2, movement: 1, ring: null, safehouseDamage: 1, label: "WALKER" },
  Runner: { health: 1, movement: 2, ring: null, safehouseDamage: 1, label: "RUNNER" },
  Tank: { health: 5, movement: 1, ring: null, safehouseDamage: 2, label: "TANK" },
  Swarm: { health: 1, movement: 3, ring: null, safehouseDamage: 1, label: "SWARM" },
  Armoured: { health: 4, movement: 1, ring: "Double", safehouseDamage: 1, label: "ARMOURED" },
  Mutant: { health: 3, movement: 1, ring: "Triple", safehouseDamage: 1, label: "MUTANT" },
  Boss: { health: 10, movement: 1, ring: null, safehouseDamage: 3, label: "BOSS" },
};

/**
 * MVP ships Walker, Runner and Tank only (§21). The other four are defined above so the tables stay in
 * one place and turning one on after playtesting is a one-line change here — not a rewrite of the
 * generator, which already handles ring restrictions and per-type movement.
 */
export const ENABLED_TYPES: ZombieTypeName[] = ["Walker", "Runner", "Tank"];

/**
 * Bosses are post-MVP (§11, §21). Until they ship, a boss wave spawns an oversized, tougher generated
 * wave instead, so the every-fifth-wave rhythm the pacing is built around still lands.
 */
export const BOSSES_ENABLED = false;

// ---------------------------------------------------------------------------------------------------
// Derived state — what a screen renders
// ---------------------------------------------------------------------------------------------------

export interface Zombie {
  /** Derived from the wave that spawned it, so it is stable across replays (never a random uuid). */
  id: string;
  type: ZombieTypeName;
  /** The segment that damages it. Hits on any other number deal nothing (§6). */
  number: number;
  /** Non-null for Armoured/Mutant: only this ring damages it, at its normal multiplier (§7). */
  ring: RingRestriction | null;
  health: number;
  maxHealth: number;
  /** Spaces from the safehouse: TRACK_LENGTH on spawn, 0 is the safehouse (§8). */
  space: number;
  movement: number;
  safehouseDamage: number;
  /** Global spawn counter — the tie-break when two zombies are the same distance away (§6). */
  spawnOrder: number;
  wave: number;
  /** True when this round's movement phase would land it on the safehouse — the §16 warning. */
  imminent: boolean;
}

/** What one dart did, for the turn readout in §13. */
export interface DartOutcome {
  throwId: string;
  /** Short form: "T18", "D20", "S5", "BULL", "25", "MISS". */
  notation: string;
  kind: "damage" | "critical" | "freeze" | "miss" | "nothing";
  damage: number;
  kills: number;
}

/** One side in the match. Zombie Horde is a single team of 2–6 survivors (§2). */
export interface Team {
  /** The group index from `payload.playerGroups`, or the player's own roster position when ungrouped. */
  groupIndex: number;
  /** Members in roster order. The order the team takes its turns in. */
  playerIds: string[];
}

export interface GameState {
  teams: Team[];
  /** Whose turn it is. Barrelo can't know this — turn order is a rule — so the board reports it back up. */
  currentPlayerId: string | null;
  currentGroupIndex: number | null;
  /** Where in the team's rotation the current thrower sits, for the "PLAYER n" caption. */
  currentPlayerIndex: number;
  /** Darts thrown in the visit currently in progress, for the shell's 1/2/3 slots. */
  currentVisitThrows: DetectedThrow[];

  /**
   * Round number, counting from 1. A round is one visit per survivor, then a movement phase — cut short
   * the moment the wave clears, so the rest of the rotation isn't spent throwing at an empty board (§3).
   */
  round: number;
  wave: number;
  zombies: Zombie[];
  safehouseHp: number;
  maxSafehouseHp: number;
  difficulty: Difficulty;
  /** The wave the team must clear to win (§17, §19) — set from `difficulty`. */
  winTargetWave: number;
  /** True only when the win condition ended the match. False on defeat, even though both set `isComplete`. */
  victory: boolean;
  /** Outer bull thrown this round — the horde does not move at the end of it (§12). */
  freezeArmed: boolean;
  /** The freeze was spent on the *previous* movement phase, for the banner. */
  freezeUsed: boolean;

  zombiesKilled: number;
  wavesCleared: number;
  score: number;
  /** Last dart minus first dart, from `detectedAtUtc` — never a running clock (§2, §17). */
  survivalMs: number;
  dartsThrown: number;

  /** The most recent visit's darts, whether it is still open or has just ended. */
  visitOutcomes: DartOutcome[];
  visitPlayerId: string | null;
  /** What the last movement phase did — safehouse hits, freezes, the new wave. */
  roundEvents: string[];

  /** Segments no living zombie requires, so Barrelo can grey them out. Empty between waves. */
  deadTargets: (number | "BULL")[];

  winnerPlayerIds: string[];
  /** Best-first ranking, reported to Barrelo when the match ends so it can award leaderboard points. */
  finalStandings: string[];
  isComplete: boolean;
}

// ---------------------------------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------------------------------

/**
 * A tiny deterministic PRNG (mulberry32), seeded from the payload. Call it for anything random — the same
 * seed reaches every screen, so they all draw the same sequence.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A wave's own generator, seeded from (match seed, wave number). Deliberately *not* one long stream
 * shared by every wave: a wave then depends only on its number, so it cannot drift if the fold ever
 * draws a different count of values earlier in the run (§2, §10).
 */
function waveRng(seed: number, wave: number): () => number {
  return rng((seed ^ Math.imul(wave, 0x9e3779b1)) >>> 0);
}

/**
 * Resolves a player's team: their explicit assignment in `playerGroups` if present, otherwise their own
 * roster position — an implicit team of one. Mirrors the host's `GameSetupExtensions.EffectiveGroupIndex`
 * exactly, which is what makes a game written against teams still play correctly when Barrelo hands it an
 * ungrouped roster.
 */
export function effectiveGroupIndex(payload: ClientGamePayload, playerId: string): number {
  const assigned = payload?.playerGroups?.[playerId];
  if (typeof assigned === "number") return assigned;
  return (payload?.playerIds ?? []).indexOf(playerId);
}

/**
 * Folds the roster into teams, ordered by group index and each holding its members in roster order.
 * Zombie Horde declares `maxGroups: 1`, so in practice this is one team of 2–6 survivors — but going
 * through the same helper is what keeps the game booting if it is ever handed an ungrouped roster.
 */
export function buildTeams(payload: ClientGamePayload): Team[] {
  const playerIds = payload?.playerIds ?? [];
  const byGroup = new Map<number, string[]>();

  playerIds.forEach((playerId) => {
    const groupIndex = effectiveGroupIndex(payload, playerId);
    const members = byGroup.get(groupIndex);
    if (members) members.push(playerId);
    else byGroup.set(groupIndex, [playerId]);
  });

  return [...byGroup.entries()]
    .sort(([a], [b]) => a - b)
    .map(([groupIndex, memberIds]) => ({ groupIndex, playerIds: memberIds }));
}

/** A visit is over when the turn boundary arrived, or when three darts have been thrown. */
function isVisitOver(visit: Visit): boolean {
  return visit.ended || visit.throws.length >= DARTS_PER_TURN;
}

// ---------------------------------------------------------------------------------------------------
// Darts
// ---------------------------------------------------------------------------------------------------

/**
 * Damage multiplier for a ring (§5). All three single-ish wire values mean one damage — Barrelo splits
 * the single band into inner and outer for position, which the rules do not care about.
 */
export function ringDamage(ring: Ring): number {
  switch (ring) {
    case "Double":
      return 2;
    case "Triple":
      return 3;
    case "Single":
    case "InnerSingle":
    case "OuterSingle":
      return 1;
    default:
      return 0;
  }
}

/** Short form for the turn readout: "T18", "D20", "S5", "BULL", "25", "MISS". */
export function notationFor(t: DetectedThrow): string {
  if (t.ring === "Miss" || t.segment === 0) return "MISS";
  if (t.segment === 25) return t.ring === "Double" ? "BULL" : "25";
  switch (t.ring) {
    case "Double":
      return `D${t.segment}`;
    case "Triple":
      return `T${t.segment}`;
    default:
      return `S${t.segment}`;
  }
}

/** `2x18`, or `4xD12` for a restricted zombie — the ring prefix is the restriction, not the damage (§7). */
export function zombieRequirement(zombie: Zombie): string {
  const prefix = zombie.ring === "Double" ? "D" : zombie.ring === "Triple" ? "T" : "";
  return `${zombie.health}×${prefix}${zombie.number}`;
}

/** mm:ss from the log-derived survival span (§17). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------------------------------

/** The hand-authored opening (§10). Waves past these are generated. */
const SCRIPTED_WAVES: Record<number, ZombieTypeName[]> = {
  1: ["Walker", "Walker", "Walker"],
  2: ["Walker", "Walker", "Walker", "Walker", "Runner"],
  3: ["Walker", "Walker", "Walker", "Walker", "Walker", "Runner", "Runner"],
  4: ["Walker", "Walker", "Walker", "Walker", "Walker", "Runner", "Runner", "Tank"],
};

/** How far past the scripted opening a wave is — the single knob every generated value scales off. */
function surgeOf(wave: number): number {
  return Math.max(0, wave - 4);
}

/**
 * Extra health on every zombie in a generated wave. Rises slowly, and boss waves carry one more —
 * "health rises" from §19, without turning wave 30 into an unkillable wall.
 */
function bonusHealth(wave: number): number {
  if (SCRIPTED_WAVES[wave]) return 0;
  const boss = wave % BOSS_INTERVAL === 0 ? 1 : 0;
  return Math.floor(surgeOf(wave) / 5) + boss;
}

function pickType(next: () => number, weights: Array<[ZombieTypeName, number]>): ZombieTypeName {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = next() * total;
  for (const [type, weight] of weights) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return weights[weights.length - 1][0];
}

/**
 * Composition for wave 5 and up (§10). More bodies and a nastier mix as the number climbs: the Walker
 * weight is flat while the others climb, so early generated waves still read like wave 4 and late ones
 * are mostly the things that hurt.
 *
 * Wave 5 is a boss wave (§11), but bosses are post-MVP — so it spawns an oversized wave instead, which
 * keeps the every-fifth-wave spike the pacing is built around. Flip BOSSES_ENABLED when they land.
 */
function generateWave(wave: number, next: () => number): ZombieTypeName[] {
  const surge = surgeOf(wave);
  const isBossWave = wave % BOSS_INTERVAL === 0;

  if (isBossWave && BOSSES_ENABLED) return ["Boss"];

  let count = 7 + Math.floor(surge * 0.6);
  if (isBossWave) count += 3;
  count = Math.min(MAX_ZOMBIES_PER_WAVE, count);

  const weights = ([
    ["Walker", 6],
    ["Runner", 1 + surge * 0.5],
    ["Tank", 0.5 + surge * 0.35],
    ["Swarm", 0.4 + surge * 0.3],
    ["Armoured", 0.3 + surge * 0.25],
    ["Mutant", 0.3 + surge * 0.25],
  ] as Array<[ZombieTypeName, number]>).filter(([type]) => ENABLED_TYPES.includes(type));

  const picks: ZombieTypeName[] = [];
  for (let i = 0; i < count; i++) picks.push(pickType(next, weights));
  return picks;
}

/**
 * From this position in a wave onward, a zombie may double up on a number already in the wave.
 * Everything before it takes a fresh number, so small waves stay spread across the board — three
 * Walkers all needing 13 is a legal but miserable opening.
 */
const NUMBER_SHARE_FROM = 3;
/** How often a zombie past that point shares rather than taking a fresh number. */
const NUMBER_SHARE_CHANCE = 0.35;

/** The 20 wedges in a deterministic shuffle — the pool fresh numbers are drawn from. */
function shuffledNumbers(next: () => number): number[] {
  const bag = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const swap = bag[i];
    bag[i] = bag[j];
    bag[j] = swap;
  }
  return bag;
}

/**
 * The required number for every zombie in a wave.
 *
 * Deliberately *not* a straight deal from the bag: a wave caps at MAX_ZOMBIES_PER_WAVE and the bag
 * holds 20, so dealing without replacement would mean no two living zombies ever share a number — and
 * that quietly deletes most of §6. Overkill would never have anywhere to carry to, the closest-first
 * targeting rule would only ever resolve same-space ties, and the §23 example (a T18 killing two
 * zombies on one dart) would be unreachable. The best dart in darts has to have somewhere to spill.
 *
 * So: a spread of fresh numbers first, then a real chance of doubling up, which grows with wave size
 * because bigger waves draw more times.
 */
function assignNumbers(count: number, next: () => number): number[] {
  const bag = shuffledNumbers(next);
  const assigned: number[] = [];
  let fresh = 0;

  for (let i = 0; i < count; i++) {
    const canShare = i >= NUMBER_SHARE_FROM && assigned.length > 0;
    if (canShare && next() < NUMBER_SHARE_CHANCE) {
      assigned.push(assigned[Math.floor(next() * assigned.length)]);
    } else {
      assigned.push(bag[fresh++ % bag.length]);
    }
  }
  return assigned;
}

/** Everything a wave spawns, at space TRACK_LENGTH, from (seed, wave) alone. */
export function buildWave(seed: number, wave: number, firstSpawnOrder: number): Zombie[] {
  const next = waveRng(seed, wave);
  const types = SCRIPTED_WAVES[wave] ?? generateWave(wave, next);
  const numbers = assignNumbers(types.length, next);
  const bonus = bonusHealth(wave);

  return types.map((type, index) => {
    const def = ZOMBIE_TYPES[type];
    const health = def.health + bonus;
    return {
      id: `w${wave}-z${index}`,
      type,
      number: numbers[index],
      ring: def.ring,
      health,
      maxHealth: health,
      space: TRACK_LENGTH,
      movement: def.movement,
      safehouseDamage: def.safehouseDamage,
      spawnOrder: firstSpawnOrder + index,
      wave,
      imminent: false,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// The horde — the mutable working state of one replay. Never escapes this module.
// ---------------------------------------------------------------------------------------------------

interface Horde {
  wave: number;
  zombies: Zombie[];
  safehouseHp: number;
  spawnCounter: number;
  freezeArmed: boolean;
  freezeUsed: boolean;
  kills: number;
  wavesCleared: number;
  /** A wave is on the board and has not been cleared yet — what stops the next one spawning early. */
  waveActive: boolean;
  round: number;
  events: string[];
  /** Set once `wavesCleared` reaches `winTargetWave` — ends the match on the spot (§17). */
  victory: boolean;
  winTargetWave: number;
}

/**
 * Targets for a dart, closest to the safehouse first, oldest first on a tie (§6). A `segment` of null
 * means "everything" — that is the Critical Hit, which ignores both the required number and any ring
 * restriction (§12).
 */
function orderedTargets(horde: Horde, segment: number | null, ring: Ring | null): Zombie[] {
  return horde.zombies
    .filter((zombie) => {
      if (segment === null) return true;
      if (zombie.number !== segment) return false;
      // A restricted zombie is skipped entirely when the ring doesn't match, so the dart passes
      // straight over it to any unrestricted zombie behind it (§7).
      if (zombie.ring !== null && zombie.ring !== ring) return false;
      return true;
    })
    .sort((a, b) => a.space - b.space || a.spawnOrder - b.spawnOrder);
}

/**
 * Spends `amount` damage down the target list. Overkill carries to the next-closest matching zombie and
 * keeps carrying until it runs out (§6) — the single most important rule in the game, because the
 * alternative makes the best dart in darts feel bad.
 */
function dealDamage(horde: Horde, targets: Zombie[], amount: number): { damage: number; kills: number } {
  let remaining = amount;
  let dealt = 0;
  let kills = 0;

  for (const zombie of targets) {
    if (remaining <= 0) break;
    const hit = Math.min(remaining, zombie.health);
    zombie.health -= hit;
    remaining -= hit;
    dealt += hit;
    if (zombie.health <= 0) kills++;
  }

  if (kills > 0) {
    horde.zombies = horde.zombies.filter((zombie) => zombie.health > 0);
    horde.kills += kills;
  }
  return { damage: dealt, kills };
}

/**
 * A wave is cleared the moment its last zombie leaves the board (§10). "Leaves" covers reaching the
 * safehouse as well as dying — either way there is nothing left to fight, and the next wave is due at
 * the start of the next round.
 */
function noteBoardCleared(horde: Horde): void {
  if (horde.waveActive && horde.zombies.length === 0) {
    horde.waveActive = false;
    horde.wavesCleared++;
    if (horde.wavesCleared >= horde.winTargetWave) horde.victory = true;
  }
}

function applyThrow(horde: Horde, t: DetectedThrow): DartOutcome {
  const notation = notationFor(t);
  const base: DartOutcome = { throwId: t.throwId, notation, kind: "nothing", damage: 0, kills: 0 };

  if (t.ring === "Miss" || t.segment === 0) return { ...base, kind: "miss" };

  // The bullseye is not a normal number, and it is the only owner of the two bull targets (§12).
  if (t.segment === 25) {
    if (t.ring === "Single" || t.ring === "InnerSingle" || t.ring === "OuterSingle") {
      horde.freezeArmed = true;
      return { ...base, kind: "freeze" };
    }
    if (t.ring === "Double") {
      const result = dealDamage(horde, orderedTargets(horde, null, null), CRITICAL_HIT_DAMAGE);
      noteBoardCleared(horde);
      return { ...base, kind: "critical", ...result };
    }
    return { ...base, kind: "miss" };
  }

  const damage = ringDamage(t.ring);
  if (damage === 0) return { ...base, kind: "miss" };

  const result = dealDamage(horde, orderedTargets(horde, t.segment, t.ring), damage);
  noteBoardCleared(horde);
  // Damage on a segment no living zombie requires is simply lost — no partial credit (§6).
  return { ...base, kind: result.damage > 0 ? "damage" : "nothing", ...result };
}

/**
 * The movement phase: once per round — either after every survivor has thrown, or immediately once the
 * wave is cleared, whichever comes first (§3, §10). Doing it per visit instead of per round is the bug
 * that makes a 6-player game three times harder than a 2-player one against the same wave; the
 * early-clear path never conflicts with that, because a cleared board has no zombies left to move.
 */
function endRound(horde: Horde): void {
  horde.events = [];
  horde.freezeUsed = false;

  if (horde.freezeArmed) {
    horde.freezeArmed = false;
    horde.freezeUsed = true;
    horde.events.push("FREEZE — the horde is held in place");
    return;
  }

  for (const zombie of horde.zombies) zombie.space -= zombie.movement;

  // A zombie reaching space 0 attacks and is then removed — it does not linger and does not attack
  // twice (§8). Oldest first, so the order safehouse HP comes off in is deterministic.
  const landed = horde.zombies
    .filter((zombie) => zombie.space <= 0)
    .sort((a, b) => a.spawnOrder - b.spawnOrder);

  for (const zombie of landed) {
    horde.safehouseHp = Math.max(0, horde.safehouseHp - zombie.safehouseDamage);
    horde.events.push(
      `${ZOMBIE_TYPES[zombie.type].label} reached the safehouse −${zombie.safehouseDamage} HP`
    );
  }

  if (landed.length > 0) horde.zombies = horde.zombies.filter((zombie) => zombie.space > 0);
  noteBoardCleared(horde);
}

/**
 * The start of a round. Reached either once the whole rotation has taken its turn, or right after the
 * wave that just cleared — never mid-visit, so a player's own turn always finishes out normally (§10).
 */
function startRound(horde: Horde, seed: number): void {
  horde.round++;
  if (horde.waveActive || horde.safehouseHp <= 0) return;

  horde.wave++;
  horde.zombies = buildWave(seed, horde.wave, horde.spawnCounter);
  horde.spawnCounter += horde.zombies.length;
  horde.waveActive = true;
  horde.events.push(`WAVE ${horde.wave}`);
}

/** Flags the zombies this round's movement phase would land on the safehouse — the §16 warning. */
function markImminent(horde: Horde): void {
  for (const zombie of horde.zombies) {
    zombie.imminent = !horde.freezeArmed && zombie.space - zombie.movement <= 0;
  }
}

/** Segments with no living zombie requiring them. Empty between waves — greying out all 20 helps nobody. */
function deadTargetsFor(zombies: Zombie[]): number[] {
  if (zombies.length === 0) return [];
  const wanted = new Set(zombies.map((zombie) => zombie.number));
  const dead: number[] = [];
  for (let segment = 1; segment <= 20; segment++) if (!wanted.has(segment)) dead.push(segment);
  return dead;
}

// ---------------------------------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------------------------------

/**
 * Replays the whole log into the board's state. Pure: same payload in, same state out, on every screen
 * and after every undo.
 */
export function replay(payload: ClientGamePayload): GameState {
  // Defaulted rather than destructured straight out: a board can be rendered before the first real
  // snapshot arrives (and the dev harness starts with an empty match), and a crash here is a blank
  // screen with a stack trace in a sandboxed iframe nobody is watching.
  const visits = payload?.visits ?? [];
  const playerIds = payload?.playerIds ?? [];
  const teams = buildTeams(payload);
  const seed = payload?.seed ?? 0;
  const difficulty = parseDifficulty(payload?.options?.difficulty);
  const winTargetWave = WIN_TARGET_WAVE[difficulty];

  if (teams.length === 0) {
    return {
      teams,
      currentPlayerId: null,
      currentGroupIndex: null,
      currentPlayerIndex: 0,
      currentVisitThrows: [],
      round: 0,
      wave: 0,
      zombies: [],
      safehouseHp: SAFEHOUSE_HEALTH,
      maxSafehouseHp: SAFEHOUSE_HEALTH,
      difficulty,
      winTargetWave,
      victory: false,
      freezeArmed: false,
      freezeUsed: false,
      zombiesKilled: 0,
      wavesCleared: 0,
      score: 0,
      survivalMs: 0,
      dartsThrown: 0,
      visitOutcomes: [],
      visitPlayerId: null,
      roundEvents: [],
      deadTargets: [],
      winnerPlayerIds: [],
      finalStandings: [],
      isComplete: false,
    };
  }

  const horde: Horde = {
    wave: 0,
    zombies: [],
    safehouseHp: SAFEHOUSE_HEALTH,
    spawnCounter: 0,
    freezeArmed: false,
    freezeUsed: false,
    kills: 0,
    wavesCleared: 0,
    waveActive: false,
    round: 0,
    events: [],
    victory: false,
    winTargetWave,
  };

  // Round 1 opens with wave 1 already on the board, so the first survivor has something to shoot at.
  startRound(horde, seed);

  let teamIndex = 0;
  // Which member each team throws next — a team's own rotation, so it survives the other teams' visits.
  const memberIndexByGroup: Record<number, number> = {};
  teams.forEach((team) => {
    memberIndexByGroup[team.groupIndex] = 0;
  });

  let currentVisitThrows: DetectedThrow[] = [];
  let visitOutcomes: DartOutcome[] = [];
  let visitPlayerId: string | null = null;
  let firstDartAt: string | null = null;
  let lastDartAt: string | null = null;
  let dartsThrown = 0;

  for (const visit of visits) {
    // Once the run is over — safehouse down, or the win target already cleared — later darts in the log
    // (a stray detection landing after the final push) must not carry on playing it.
    if (horde.safehouseHp <= 0 || horde.victory) break;

    const team = teams[teamIndex];
    const thrower = team.playerIds[memberIndexByGroup[team.groupIndex]];
    const outcomes: DartOutcome[] = [];

    for (const t of visit.throws) {
      dartsThrown++;
      if (firstDartAt === null) firstDartAt = t.detectedAtUtc;
      lastDartAt = t.detectedAtUtc;
      outcomes.push(applyThrow(horde, t));
    }

    visitOutcomes = outcomes;
    visitPlayerId = thrower;
    currentVisitThrows = isVisitOver(visit) ? [] : visit.throws;

    // Clearing the win-target wave ends the match immediately, the same way an early wave clear ends
    // the round early (§10): the thrower's own turn finishes out normally above, but nothing moves and
    // no further wave spawns after this (§17).
    if (horde.victory) break;
    if (!isVisitOver(visit)) break;

    memberIndexByGroup[team.groupIndex] =
      (memberIndexByGroup[team.groupIndex] + 1) % team.playerIds.length;
    teamIndex = (teamIndex + 1) % teams.length;

    // The round is over when either the rotation has come all the way back around to the first thrower
    // of the first team (everyone has had their three darts, §3), OR the wave was just cleared — a
    // cleared board has nothing left for the remaining players to shoot at, so the team doesn't sit
    // through empty turns waiting for the rotation to lap (§10). Either way, movement happens here and
    // nowhere else; on the early-clear path there is nothing left to move, so it is a no-op that just
    // starts the next wave. The rotation itself is untouched — it simply continues from whichever player
    // is up next, rather than resetting to the first.
    const fullRotation = teamIndex === 0 && teams.every((t) => memberIndexByGroup[t.groupIndex] === 0);
    const roundComplete = fullRotation || !horde.waveActive;
    if (!roundComplete) continue;

    endRound(horde);
    if (horde.safehouseHp <= 0) break;
    startRound(horde, seed);
  }

  markImminent(horde);

  const isComplete = horde.safehouseHp <= 0 || horde.victory;
  const score =
    horde.kills * SCORE_PER_KILL +
    horde.wavesCleared * SCORE_PER_WAVE +
    horde.safehouseHp * SCORE_PER_SAFEHOUSE_HP;

  const survivalMs =
    firstDartAt && lastDartAt ? Math.max(0, Date.parse(lastDartAt) - Date.parse(firstDartAt)) : 0;

  const currentTeam = teams[teamIndex];
  const currentPlayerIndex = memberIndexByGroup[currentTeam.groupIndex];

  // The run ends in victory or defeat, and either way the whole team is credited with it — every player
  // in both lists, so each member earns session-leaderboard points (§2, §17).
  const everyone = isComplete ? [...playerIds] : [];

  return {
    teams,
    currentPlayerId: currentTeam.playerIds[currentPlayerIndex],
    currentGroupIndex: currentTeam.groupIndex,
    currentPlayerIndex,
    currentVisitThrows,
    round: horde.round,
    wave: horde.wave,
    zombies: horde.zombies,
    safehouseHp: horde.safehouseHp,
    maxSafehouseHp: SAFEHOUSE_HEALTH,
    difficulty,
    winTargetWave,
    victory: horde.victory,
    freezeArmed: horde.freezeArmed,
    freezeUsed: horde.freezeUsed,
    zombiesKilled: horde.kills,
    wavesCleared: horde.wavesCleared,
    score,
    survivalMs,
    dartsThrown,
    visitOutcomes,
    visitPlayerId,
    roundEvents: horde.events,
    deadTargets: deadTargetsFor(horde.zombies),
    winnerPlayerIds: everyone,
    finalStandings: everyone,
    isComplete,
  };
}

// ---------------------------------------------------------------------------------------------------
// Hashes — how Barrelo notices two screens disagreeing
// ---------------------------------------------------------------------------------------------------

function hash(canonical: string): string {
  let value = 0;
  for (let i = 0; i < canonical.length; i++) {
    value = (Math.imul(31, value) + canonical.charCodeAt(i)) | 0;
  }
  return (value >>> 0).toString(16);
}

/**
 * Identifies a derived state so two screens can be compared. Covers everything the board draws that
 * could differ: the horde itself, the safehouse, the wave and whose turn it is.
 */
export function hashState(state: GameState): string {
  return hash(
    JSON.stringify([
      state.currentPlayerId,
      state.round,
      state.wave,
      state.safehouseHp,
      state.zombiesKilled,
      state.wavesCleared,
      state.zombies.map((z) => [z.id, z.health, z.space]),
      state.isComplete,
      state.victory,
    ])
  );
}

/**
 * Identifies the log a state was derived *from*. Barrelo compares screens by pairing this with
 * hashState: two screens observing the match a moment apart hold different logs and aren't compared,
 * so only a genuine same-input/different-output disagreement is reported.
 */
export function hashLog(payload: ClientGamePayload): string {
  return hash(
    JSON.stringify(
      (payload?.visits ?? []).map((visit) => [visit.throws.map((t) => t.throwId), visit.ended])
    )
  );
}
