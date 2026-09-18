/**
 * The course, as data.
 *
 * Every hole is authored inside one fixed coordinate box (COURSE_BOUNDS) and every hole is rendered
 * at the same scale. That is not cosmetic: putt power is a single global constant, so if holes were
 * fitted to the view individually, "triple 6" would cover a different visible distance on each one
 * and the map players are learning would silently change hole to hole.
 *
 * Outlines are simple closed polygons in course space, which is y-DOWN (screen convention). Winding
 * may be either direction — buildRails() works out which side is inside from the signed area.
 *
 * Design notes, because the two rules below shape every hole here:
 *
 *  - The cup catches at any speed, so ANY putt whose path crosses the cup drops. Overshooting is
 *    free. Difficulty therefore cannot come from pace control; it has to come from geometry —
 *    doglegs, interior walls, and hazards on the direct line.
 *  - Aim is quantised to 20 directions 18deg apart. At 700 units of range, neighbouring directions
 *    are ~216 units apart while the cup is only 40 wide, so a hole-out from distance needs the cup
 *    to sit almost exactly on a wedge line. Inside ~130 units every wedge line passes through the
 *    cup, so it always drops. That gives the natural golf shape for free: get it close, then sink it.
 *    Cups are therefore placed a few degrees OFF a wedge line from the tee, except on hole 4, where
 *    the ace is the whole point of the hole.
 *
 * Balls bounce, so a putt sweeps a long path rather than landing on a point, and holes are much
 * easier for someone with perfect knowledge than the geometry alone suggests. Pars here were set
 * against the simulation, not by eye: a player with perfect darts who always aims at the wedge
 * nearest the cup and picks the closest power shoots level par over the nine.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Zone = { kind: 'circle'; at: Vec; r: number } | { kind: 'rect'; rect: Rect };

export type Obstacle =
  /** Interior static wall the ball bounces off, same material as the rails. */
  | { kind: 'wall'; rect: Rect }
  /** Bouncy peg — restitution above 1, so the ball leaves faster than it arrived. */
  | { kind: 'bumper'; at: Vec; r: number }
  /** Sensor zone: quadruples air friction while the ball's centre is inside. Not a body. */
  | { kind: 'sand'; zone: Zone }
  /** Sensor zone: +1 stroke and the ball returns to where the putt started. Not a body. */
  | { kind: 'water'; zone: Zone }
  /**
   * Rotating blade, as a static body whose angle is set from the step counter. Phase resets to
   * `startAngle` at the beginning of every putt, so the gap always arrives the same number of steps
   * after the ball is struck and getting through it is learnable rather than luck.
   *
   * The board keeps the blade turning between putts as well, at this same omega, so the hole looks
   * alive rather than switched off — but that idle spin is decoration only and the sim takes the
   * phase back the moment a ball is struck. It cannot be anything else: the phase has to be a
   * function of the log alone, or the tablet and the TV would disagree about where the blade was.
   */
  | {
      kind: 'windmill';
      at: Vec;
      length: number;
      thickness: number;
      /** Radians per physics step. */
      omega: number;
      startAngle: number;
    };

export interface Hole {
  name: string;
  par: number;
  outline: Vec[];
  tee: Vec;
  cup: Vec;
  obstacles: Obstacle[];
}

/** Fixed for every hole — see the note above about a global power scale needing a global view scale. */
export const COURSE_BOUNDS: Rect = { x: 0, y: 0, w: 1000, h: 640 };

export const BALL_RADIUS = 11;
/** Generous relative to the ball, because capture is a path-crossing test, not an overlap test. */
export const CUP_RADIUS = 20;

const p = (x: number, y: number): Vec => ({ x, y });

/** The full playfield, used by the holes that are a plain rectangle. */
const ARENA: Vec[] = [p(60, 60), p(940, 60), p(940, 580), p(60, 580)];

export const COURSE: Hole[] = [
  {
    name: 'Opening Drive',
    par: 2,
    outline: ARENA,
    tee: p(160, 500),
    cup: p(830, 430),
    obstacles: [],
    // Cup sits 84deg from the tee; segment 6 is 90deg. Six degrees off at 673 units is a 70-unit
    // miss — close enough to leave a tap-in, far enough that the straight shot is not a free ace.
    // An ace does exist off the far rail (a double 10), which is a fair reward for finding it.
  },
  {
    name: 'The Sandbar',
    par: 3,
    outline: ARENA,
    tee: p(140, 540),
    cup: p(860, 140),
    obstacles: [
      { kind: 'sand', zone: { kind: 'circle', at: p(500, 340), r: 150 } },
      { kind: 'bumper', at: p(760, 430), r: 26 },
    ],
    // The direct line runs straight through the sand and dies in it. Going round the top or the
    // bottom costs a stroke but keeps the pace.
  },
  {
    name: 'The Dogleg',
    par: 3,
    outline: [p(60, 60), p(520, 60), p(520, 380), p(940, 380), p(940, 580), p(60, 580)],
    tee: p(200, 160),
    cup: p(840, 480),
    obstacles: [{ kind: 'bumper', at: p(520, 380), r: 30 }],
    // No line of sight at all: the wall at x=520 blocks everything above y=380. Come down the left
    // column first, or use the corner bumper to turn the ball.
  },
  {
    name: 'Windmill',
    par: 2,
    outline: ARENA,
    tee: p(160, 320),
    cup: p(840, 320),
    obstacles: [
      { kind: 'wall', rect: { x: 490, y: 60, w: 20, h: 180 } },
      { kind: 'wall', rect: { x: 490, y: 400, w: 20, h: 180 } },
      {
        kind: 'windmill',
        at: p(500, 200),
        length: 260,
        thickness: 16,
        omega: 0.022,
        startAngle: 0,
      },
    ],
    // Dead straight: the cup is exactly on segment 6 at 680 units, so a 6 is an ace — if the blade
    // is clear of the gap when the ball arrives. One revolution takes ~4.8s, and because the blade
    // is symmetric about its hub the gap comes round every ~2.4s, which is slow enough to watch and
    // slow enough to putt through. Swept against the simulation rather than set by eye: from the
    // strike the gap stays open for ~45 steps, so on segment 6 anything from about half power up
    // gets through and a 6 hit at treble depth or harder drops. Weak putts either die short of the
    // windmill or arrive late and get swatted, which is the thing the hole is actually asking.
    //
    // The pivot is deliberately ABOVE the gap, not in it. A blade pivoted at the centre of the gap
    // always occupies its own pivot, so a ball running along the line through it can never get
    // through at any phase — the hole would be unplayable however the timing was tuned. Mounted at
    // y=200 it sweeps DOWN across the gap instead, blocking the ball's line only while it is within
    // roughly 30deg of straight down. Which power you choose sets when you arrive, so it sets
    // whether you meet the blade or the gap.
  },
  {
    name: 'The Moat',
    par: 3,
    outline: ARENA,
    tee: p(140, 500),
    cup: p(860, 180),
    obstacles: [{ kind: 'water', zone: { kind: 'rect', rect: { x: 380, y: 60, w: 180, h: 400 } } }],
    // Water is water — there is no carrying it along the ground, so this is a routing puzzle. The
    // only dry line is the 120-unit gap along the bottom.
  },
  {
    name: 'Bumper Alley',
    par: 3,
    outline: ARENA,
    tee: p(500, 540),
    cup: p(500, 140),
    obstacles: [
      { kind: 'bumper', at: p(470, 260), r: 32 },
      { kind: 'bumper', at: p(420, 430), r: 30 },
      { kind: 'bumper', at: p(580, 360), r: 30 },
      { kind: 'bumper', at: p(630, 200), r: 28 },
      { kind: 'bumper', at: p(360, 170), r: 26 },
    ],
    // Tee and cup are on the same vertical line — a pure segment 20 hole — but the first bumper sits
    // 30 units off that line and swats the direct shot away. Softer putts survive the field better.
  },
  {
    name: 'The Chicane',
    par: 3,
    outline: [
      p(60, 60),
      p(400, 60),
      p(400, 240),
      p(640, 240),
      p(640, 60),
      p(940, 60),
      p(940, 580),
      p(600, 580),
      p(600, 400),
      p(360, 400),
      p(360, 580),
      p(60, 580),
    ],
    tee: p(180, 500),
    cup: p(830, 150),
    obstacles: [],
    // A block hangs down from the top and another rises from the bottom, leaving an S-shaped
    // corridor. There is a hairline direct channel at ~62deg, but the nearest wedge lines are 54deg
    // and 72deg, and both run into a notch. Two banks is the honest route.
  },
  {
    name: 'Island Green',
    par: 3,
    outline: ARENA,
    tee: p(160, 320),
    cup: p(690, 340),
    obstacles: [
      { kind: 'water', zone: { kind: 'rect', rect: { x: 520, y: 180, w: 340, h: 80 } } },
      { kind: 'water', zone: { kind: 'rect', rect: { x: 520, y: 420, w: 340, h: 80 } } },
      { kind: 'water', zone: { kind: 'rect', rect: { x: 520, y: 180, w: 80, h: 120 } } },
      { kind: 'water', zone: { kind: 'rect', rect: { x: 780, y: 180, w: 80, h: 320 } } },
    ],
    // Moat on all four sides bar a 120-unit dry channel at y 300-420 on the left. Wide enough that
    // the green is genuinely reachable — an earlier 40-unit version was unplayable, with every
    // approach ending wet — but everything long, high or low is in the water. The one hole where
    // the cup catching at any speed is no gift.
  },
  {
    name: 'The Finish',
    par: 4,
    outline: [p(60, 60), p(940, 60), p(940, 580), p(520, 580), p(520, 360), p(60, 360)],
    tee: p(760, 500),
    cup: p(160, 180),
    obstacles: [
      { kind: 'sand', zone: { kind: 'circle', at: p(400, 200), r: 110 } },
      { kind: 'bumper', at: p(620, 300), r: 28 },
      { kind: 'bumper', at: p(300, 120), r: 24 },
    ],
    // Everything at once: up out of the leg, round the corner at x=520, past a bumper, and over or
    // around the sand into the far corner. Four is a good score.
  },
];

/**
 * The hole sequence actually played, from the `holes` option merged in by the course gameMode
 * setting. 18 is the nine played twice — the back nine is the same course again, as on a real
 * short course.
 */
export function courseFor(options: Record<string, string> | undefined): Hole[] {
  const requested = Number.parseInt(options?.holes ?? '', 10);
  const count = requested === 3 || requested === 9 || requested === 18 ? requested : 9;
  if (count === 18) return [...COURSE, ...COURSE];
  return COURSE.slice(0, count);
}
