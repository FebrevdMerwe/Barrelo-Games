# Putt Putt — mini golf on a dartboard

A Barrelo client-owned game. Nine holes of mini golf played with darts: **the bull is your ball**, and
the dart you throw is where you aimed it. The vector from the bull to the dart is the putt — its
direction is where the ball goes, its length is how hard you hit it.

```
        20 (up)
         ^                 direction = compass angle from the bull to the dart
  11 <-  *  -> 6           power     = distance from the bull
         v
        3 (down)           world-fixed: 20 is up the screen on every hole, all match
```

The board runs a real [Matter](https://brm.io/matter-js/) physics simulation through Phaser 4 — rails,
bumpers, sand, water and a windmill — while the rules stay a pure function of the visit log.

## Prerequisites

- [Node.js](https://nodejs.org) — to build. Nothing needs Node at *runtime*, including on the machine
  running Barrelo: the build output is static files.

## Getting started

```bash
cd ui && npm install
npm run dev          # Vite, on http://localhost:5173
```

Then open **`dev/harness.html`**. It stands in for Barrelo: it keeps the visit log the same way the
host does and posts the same `barrelo:gameState` message into the board.

The harness offers both input paths, which behave very differently and are both worth testing:

- **Click the dartboard** — sends the exact point you clicked. This is the continuous coordinate a
  real autoscorer produces, so aim and power are fully analogue.
- **Segment + ring buttons** — the manual-entry path. Barrelo's `BoardGeometry.CenterOf` snaps a typed
  throw to the *centre* of the segment/ring wedge, so these give the four quantised power levels most
  matches actually see.

It also has selectors for 1–8 players, how they are split into teams — solo, pairs, or 2/3/4 sides,
written into `playerGroups` exactly as the host's start screen writes it — and the 3/9/18-hole course.

## How the game plays

**Power.** Only the distance from the bull matters, on one global scale, so "triple 6" covers the same
ground on every hole. Measured against the simulation:

| ring | radius | travels |
|---|---|---|
| inner bull (D25) | 0.03 | 22 units — a wasted stroke |
| outer bull (S25) | 0.105 | 106 units |
| inner single | 0.365 | 399 units |
| triple | 0.61 | 675 units |
| outer single | 0.79 | 878 units |
| double | 0.97 | 1081 units |
| miss | 1.05 | 1171 units, straight up under manual entry |

The bull is taken literally: it is the hardest target on the board and very nearly no power at all.
There is no special case rescuing it. A miss is taken literally too — a full-power shank.

**Turns.** One dart is one putt. Every *side* has its own ball on the same hole at once, and a visit
gives you up to three putts; if the ball is not in the cup after them, it stays where it is and the
side resumes next visit. Holing out makes the rest of that visit's darts dead no-ops and takes the
side out of the rotation until the hole finishes. Everyone advances together.

**Teams.** A side is a team, and a team is played **alternate shot**: one ball, one stroke count, one
line on the card, with team-mates taking the visits in turn. Whoever is at the board putts the team's
ball wherever their partner left it. The rotation carries across holes rather than resetting, so the
tee shots get shared out instead of one member teeing off on all nine.

Teams come from Barrelo. `plugin.json` declares a `playerGroup` setting, which is what puts the team
columns on the host's start screen, and the assignment arrives as `payload.playerGroups`. A player
with no group plays alone — so **a solo match is a field of one-player teams**, replayed by the same
code with no separate path. That is deliberate: it is why "solo" cannot rot while teams are the mode
being exercised.

**Hazards.** Water costs a penalty stroke and puts the ball back where the putt started — so it costs
two in total. Sand quadruples drag. The cup catches at any speed, so overshooting is free; difficulty
lives in the geometry instead.

**Scoring.** Stroke play, fewest strokes wins — per side, so a team's members all share its score and
all win or lose together. Level totals are settled by countback — fewest on the last hole, then the
one before, and so on. Six strokes on a hole is the cap: you pick up and take a 6.

`finalStandings` goes back up as players, best team first with team-mates consecutive, because that
is the shape Barrelo's leaderboard reads: it chunks the standings into runs sharing a group index to
recover who tied for which placing, and every member of a placed team gets the team's full points.

## The determinism contract — read this one

Barrelo keeps the visit log; **every screen showing the match replays it independently** — the control
tablet, the TV on the wall, any tab refreshed mid-match. They only agree if replaying the same log
always produces the same state.

That is a sharper constraint here than in most games, because **where the ball stopped is a rule**:
turn order skips sides that are in, holes end when everyone is done, and the match ends when the last
hole does. All three need ball positions, so `replay()` cannot ask the renderer — it has to work them
out itself. Which team-mate is at the board is derived the same way, from the same fold, and is part
of `stateHash` for the same reason.

So the physics lives in `ui/src/simulate.ts` and is **run twice**:

```
simulate.ts   Matter bodies, fixed 16.666ms step, 240-step settle cap
     |
     +-- rules.ts     headless engine -> the authoritative rest position
     |                (drives strokes, turn order, hole advance, matchComplete)
     |
     +-- BoardScene   the live Phaser Matter world -- real bodies you watch collide,
                      with autoUpdate:false and manual world.step() calls
```

Same engine, same bodies, same fixed step, same order of operations, so both land on the same number.
That is the only reason the board can run genuine physics while `replay()` stays pure.

Consequences to respect when changing anything:

- **Never** introduce a variable timestep. Phaser's Matter runner smooths and snaps frame deltas by
  default, which is exactly why `autoUpdate` is off and `main.ts` pins the solver iteration counts to
  the same constants the headless engine uses. Speeding playback up adds *more steps per frame*, never
  a bigger delta.
- No `Math.random()` — use the `rng(payload.seed)` helper in `ui/src/rules.ts`.
- No `Date.now()` / `new Date()` — use `throw.detectedAtUtc`. The windmill's blade phase is a function
  of the simulation's step counter, never of elapsed time, and resets at the start of every putt. The
  board does turn the blade off the frame clock *between* putts (`CourseView.spinBlade`), because a
  windmill that only moves while a ball is rolling looks broken — but that spin is decoration, it
  decides nothing, and `setBladeAngle` hands the phase straight back to the sim on the next strike.
- No `crypto.randomUUID()` — derive ids from the log (event keys come from `throw.throwId`).
- No module-level mutable state. In particular there is deliberately **no memoisation cache** in
  `replay()`: a full round is a few tens of milliseconds, which is cheaper than the risk of a subtly
  wrong cache reintroducing exactly the divergence the fold exists to prevent.

**Known limitation:** floating-point results are bit-identical within one JS engine but not guaranteed
across engines, since `Math.sin`/`cos` are only accurate to the last ulp and Matter calls them on every
collision. This is fine while every screen is Chromium — the deliberate assumption here — but a Safari
TV beside a Chrome tablet could eventually settle a ball a pixel apart and trip Barrelo's state-hash
warning. The fix, if it ever matters, is to quantise the rest position between putts so drift is
truncated each stroke instead of compounding.

## Layout

- **Rules** — `ui/src/rules.ts`. A pure fold over the visit log; the only place the game's decisions
  live. Undo needs no code — Barrelo shortens the log and the state is re-derived. Everything scored
  is keyed by team id, never by player id; `teamsOf()` is the one place `playerGroups` is read.
- **Physics** — `ui/src/simulate.ts`. Shared by the rules and the board, as above.
- **The course** — `ui/src/holes.ts`. Nine holes as data: outline polygon, tee, cup, par, obstacles.
  Adding a hole is adding a data literal. Read the header comment first — the two design rules in it
  (the cup catches at any speed; aim is quantised to 20 directions) shape every hole.
- **Input mapping** — `ui/src/putt.ts`. Dart coordinate to putt vector, and nothing else.
- **Rendering** — `ui/src/scenes/BoardScene.ts` plus `ui/src/ui/`. Driven by the derived event stream,
  not by state diffing: `diffEvents` decides whether what arrived extends what is on screen (animate
  the tail) or not (an undo or a fresh tab — snap, animate nothing).
- **Sides on screen** — `ui/src/ui/teams.ts`. A team's colour (by seat, so team-mates share one, as
  they share a ball) and its name (one member, "A & B", or "A +2"). Nothing else names a side.
- **Aim guide** — `ui/src/ui/AimGuide.ts`. Five dartboard numbers around the ball that is up, on the
  side the cup is on, with the wedge line closest to the cup picked out in the side's colour. It only
  restates the world-fixed map — 20 is up on every hole — but restating it at the ball saves doing
  the compass work at the oche. Direction only: the ring to throw is the part worth learning, and the
  line is drawn straight at the cup, so walls, water and the windmill stay the player's problem.
- **Art** — `ui/src/ui/textures.ts` generates every surface into the texture cache at boot. Nothing is
  loaded over the network. To use real art instead, drop PNGs into `ui/public/assets` and load them
  under the same keys in `PreloaderScene`; no drawing code needs to change.
- **Wire types** — `shared/types.ts`. Don't redeclare them locally.
- **The bridge** — `ui/src/bridge.ts`. The whole Barrelo contract in one short file.

## Deploy

```bash
cd ui && npm run build     # typechecks, then produces ui/dist/
cd .. && npm run deploy    # copies to Barrelo/external-plugins/putt-putt
```

`npm run deploy` takes an optional destination argument. It refuses to write to a folder whose name is
not `putt-putt`, because the host fetches the board from `/plugins/{gameId}/ui/` and a mismatch 404s
silently. It copies the *contents of* `ui/dist`, not `ui/` — copying `ui/` is the known failure mode,
where the board falls back to a raw JSON dump because the unbuilt `index.html` needs Vite behind it.

## Verifying

There is no automated test suite. What has been checked, and how, if you change something load-bearing:

- **Physics tuning** — travel distance per ring matches the table above; 1800 putts across all nine
  holes produce no ball still moving at the 4-second cap and none escaping through a rail.
- **Playability** — every hole is completable, and the pars are calibrated so that perfect darts
  played naively shoot level par over the nine.
- **Rules** — turn order, spare darts, the 6-stroke cap, water penalties, hole advance, countback,
  standings as a full roster permutation, and that a log prefix yields a prefix of the event stream
  (which `diffEvents` depends on).
- **Teams** — alternate shot rotates team-mates across visits and carries the rotation over a hole
  boundary; a team's members are consecutive in `finalStandings` and share its placing; and a roster
  with everyone in their own group replays identically to the pre-teams solo game.

Those were verified by bundling the real modules for Node with a stub for `phaser` — `simulate.ts`
only reaches `Phaser.Physics.Matter.Matter`, which is the plain Matter library and needs no DOM:

```bash
npx esbuild probe.mjs --bundle --platform=node --format=esm \
  --outfile=probe.bundle.mjs --alias:phaser=./phaser-shim.mjs
```

The visual board itself is checked by eye through `dev/harness.html`.
