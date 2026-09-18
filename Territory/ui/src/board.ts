import type { DetectedThrow } from '../../shared/types';

/**
 * The Territory map: 21 territories — the numbers 1-20 and the Bull.
 *
 * ONE RING DECIDES EVERYTHING, AND IT IS THE WIRE
 * -----------------------------------------------
 * `WEDGE_ORDER` is the dartboard's own ring: 20 at the top, then 1, 18, 4 clockwise, exactly as the
 * numbers sit on a real board. It decides both where TerritoryMap draws each territory *and* what
 * touches what. 11's neighbours are 8 and 14 because that is what a player sees when they look at
 * the board — adjacency you can point at beats adjacency you have to work out.
 *
 * `RING_IDS` is the twenty numbers in numeric order. That is iteration order and nothing more: the
 * canonical order territories are walked in for counting and hashing, so every screen serialises the
 * map identically. It carries no adjacency.
 *
 * `buildAdjacency()` below is the single place the ring is chosen. Walking RING_IDS there would put
 * the game back on a numeric ring, where a side's ground scatters around the drawn board.
 */

export const BULL: TerritoryId = 'BULL';
export const BULL_SEGMENT = 25;
export const NUMBER_COUNT = 20;
export const MAX_SHIELD = 3;

/** `'1'`..`'20'` or `'BULL'`. Strings because the Bull shares the space with the numbers. */
export type TerritoryId = string;

/** Every territory, in ring order, with the Bull last. */
export const TERRITORY_IDS: readonly TerritoryId[] = [
  ...Array.from({ length: NUMBER_COUNT }, (_, i) => String(i + 1)),
  BULL,
];

/** The twenty numbers in numeric order — canonical iteration order, not adjacency. */
export const RING_IDS: readonly TerritoryId[] = TERRITORY_IDS.slice(0, NUMBER_COUNT);

export function isBull(id: TerritoryId): boolean {
  return id === BULL;
}

/** Position of a numbered territory in numeric order, or -1 for the Bull. */
export function ringIndexOf(id: TerritoryId): number {
  return RING_IDS.indexOf(id);
}

/**
 * The numbers in the order they physically sit on a dartboard, clockwise from the top.
 *
 * This is the adjacency ring as well as the drawn one: neighbours on this list are neighbours in the
 * rules, and Homes are spaced around it. See the note at the top of the file.
 */
export const WEDGE_ORDER: readonly TerritoryId[] = [
  '20', '1', '18', '4', '13', '6', '10', '15', '2', '17',
  '3', '19', '7', '16', '8', '11', '14', '9', '12', '5',
];

/** Which wedge a territory occupies on the drawn board, or -1 for the Bull. */
export function wedgeIndexOf(id: TerritoryId): number {
  return WEDGE_ORDER.indexOf(id);
}

/**
 * The dartboard's ring boundaries as fractions of the outer double-ring radius, from the real
 * board's millimetre dimensions — the proportions that make a drawn board read as a dartboard rather
 * than as a pie chart.
 *
 * The bull is the one deliberate exaggeration. At its true size (15.9/170) it is a fifth of a wedge's
 * width and cannot carry the three shield pips every other territory shows. It is opened up here
 * until it can, which costs a little realism dead in the centre and buys the Bull the same readout
 * as the other twenty territories.
 *
 * `collar` is the numbers ring outside the wire — not part of a scoring board's geometry, but it is
 * where the printed numbers live, and it is what this game paints to show who owns each wedge.
 */
export const RING_FRACTIONS = {
  bullInner: 0.075,
  bullOuter: 0.16,
  tripleInner: 99 / 170,
  tripleOuter: 107 / 170,
  doubleInner: 162 / 170,
  doubleOuter: 1,
  collarInner: 1.035,
  collarOuter: 1.2,
} as const;

/** Half a wedge, in radians. Twenty wedges of 18 degrees each. */
export const WEDGE_HALF_ANGLE = Math.PI / 20;

/**
 * The angle from the board's centre to the middle of a wedge, in radians, in screen space (y down).
 * Wedge 0 sits at twelve o'clock, which is why the quarter turn comes off it.
 */
export function wedgeAngle(wedgeIndex: number): number {
  return (wedgeIndex * Math.PI) / 10 - Math.PI / 2;
}

const ADJACENCY: Record<TerritoryId, TerritoryId[]> = buildAdjacency();

function buildAdjacency(): Record<TerritoryId, TerritoryId[]> {
  const map: Record<TerritoryId, TerritoryId[]> = {};

  // Adjacency follows the wire, so a territory's neighbours are the wedges either side of it on the
  // drawn board: 11 touches 8 and 14, 20 touches 5 and 1.
  WEDGE_ORDER.forEach((id, index) => {
    const before = WEDGE_ORDER[(index - 1 + NUMBER_COUNT) % NUMBER_COUNT];
    const after = WEDGE_ORDER[(index + 1) % NUMBER_COUNT];
    // The Bull touches every number, so every number touches the Bull.
    map[id] = [before, after, BULL];
  });

  map[BULL] = [...RING_IDS];
  return map;
}

/** The territories touching `id`. Never mutate the returned array — it is shared. */
export function adjacentTo(id: TerritoryId): readonly TerritoryId[] {
  return ADJACENCY[id] ?? [];
}

/**
 * Which territory a dart landed in, or null when it landed in none.
 *
 * Both bull rings are the one Bull territory, per the scope. A miss is null rather than a territory
 * with zero hits so the renderer can tell "nothing was aimed at" from "nothing happened".
 */
export function territoryFor(dart: Pick<DetectedThrow, 'segment' | 'ring'>): TerritoryId | null {
  if (dart.ring === 'Miss') return null;
  if (dart.segment === BULL_SEGMENT) return BULL;
  if (dart.segment >= 1 && dart.segment <= NUMBER_COUNT) return String(dart.segment);
  return null;
}

/**
 * How many hits a dart carries: single 1, double 2, triple 3.
 *
 * The Bull is 1 hit from either ring — the outer bull and the bullseye are the same territory and
 * the scope caps both at one, so the D25 that Barrelo reports for a bullseye must not read as 2.
 */
export function hitsFor(dart: Pick<DetectedThrow, 'segment' | 'ring'>): number {
  if (dart.ring === 'Miss') return 0;
  if (dart.segment === BULL_SEGMENT) return 1;
  if (dart.ring === 'Triple') return 3;
  if (dart.ring === 'Double') return 2;
  return 1;
}

/**
 * The Home territory for each side, evenly spaced around the drawn board.
 *
 * Spaced on WEDGE_ORDER, so "opposite" means opposite where the players are actually looking: two
 * sides open on 6 and 11, which sit at three and nine o'clock on a real board. Spacing them on the
 * numbers instead gave 6 and 16 — dead opposite on paper, two wedges apart on the wire, which is
 * what "the sides don't start across from each other" looked like on screen.
 *
 * Computed rather than drawn at random, so every screen agrees without consulting the seed and every
 * side starts with the same room to expand into: the ring is cut into `teamCount` equal arcs and each
 * side takes the wedge nearest its arc's centre. Three sides open on 4/3/14 (120 degrees apart), four
 * on 18/15/7/9 (exactly 90).
 *
 * The Bull is nobody's Home. It starts neutral and — being adjacent to all twenty — is in reach of
 * every side from the first dart, which is the opening gambit the scope wants it to be.
 */
export function homeTerritoryIds(teamCount: number): TerritoryId[] {
  if (teamCount <= 0) return [];

  const homes: TerritoryId[] = [];
  for (let k = 0; k < teamCount; k++) {
    const index = Math.floor(((k + 0.5) * NUMBER_COUNT) / teamCount);
    homes.push(WEDGE_ORDER[index % NUMBER_COUNT]);
  }
  return homes;
}

/**
 * The dartboard target that owns a territory, in the form Barrelo greys out: a segment number, or
 * the string 'BULL' for the bull.
 */
export function targetFor(id: TerritoryId): number | 'BULL' {
  return isBull(id) ? 'BULL' : Number(id);
}

/**
 * How a dart reads on screen: `T20`, `D5`, `19`, `BULL`, `MISS`. Display only — the rules never look
 * at this — but it belongs here with the rest of what a dart means.
 */
export function notationFor(dart: Pick<DetectedThrow, 'segment' | 'ring'>): string {
  if (dart.ring === 'Miss') return 'MISS';
  if (dart.segment === BULL_SEGMENT) return 'BULL';
  if (dart.ring === 'Triple') return `T${dart.segment}`;
  if (dart.ring === 'Double') return `D${dart.segment}`;
  return String(dart.segment);
}

/** What to call a territory in a sentence: the number, or "the Bull". */
export function territoryName(id: TerritoryId): string {
  return isBull(id) ? 'the Bull' : id;
}
