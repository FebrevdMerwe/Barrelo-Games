# Herd The Sheep

A Barrelo **client-owned** game (protocol v2). The TV shows a flock of sheep in a fenced paddock. Every
dart is a **scare point** dropped on the grass exactly where it landed, and sheep flee directly away from
it. You use that, and nothing else, to work the flock through a funnel and into a pen.

Throw behind the flock and it runs away from you. Throw beyond it and it comes back toward you. Those are
not two rules — they are one rule seen from two sides, which is also how a real sheepdog works.

```
            20   1   18
        5   .-----------.   4
    12     /   o   o     \    13
     9    |  o    o   o   |    6   \____
    14     \      o      /    10    >---|  +-----+
        11  '-----------'   8      /____|  | PEN |
            16   7                          +-----+
             the fence IS the dartboard
```

Herd The Sheep is entirely a browser app — a [Phaser 4](https://phaser.io/) board built with TypeScript +
Vite. There is no server half, no process for Barrelo to spawn and no HTTP contract. Barrelo keeps the log
of what was thrown and pushes it to the board; the board works out what it means.

**`GameDescription.md` is the design document and the spec of record.** Read it before changing any rule.

## Rules

- The fence circle **is** the dartboard's unit circle: the bull is the middle of the field, the double ring
  is hard against the fence, and the 20 board numbers are painted faintly on the grass just inside it.
- Every dart is a scare point. Sheep within range flee away from it, hardest for those nearest — the
  falloff is quadratic, so you press the flock's near edge and the blob rolls.
- **The bull is a whistle.** It does not push; it pulls the whole flock in toward its own centre of mass.
  It is the only recovery from a scattered flock, and the hardest target on the board.
- **A miss does nothing.** The dart went over the fence. The flock still drifts on the wander; the dart is
  gone.
- **Time only passes when a dart lands.** Each dart runs a fixed burst of physics; between darts the sheep
  are animated but frozen in place. What you see at the oche is what you are throwing at.
- A sheep through the gate is banked to the team whose dart drove it there, and removed. Scores never drop.
  But the mouth of the funnel is inside the fence, so a dart between a sheep and the gate **flushes it back
  out**.
- Most sheep wins. The match ends when the field empties, or earlier the moment it is mathematically
  decided. A level finish releases a single **sudden-death sheep** for the tied teams to race for.
- **Solo** is the same game scored on darts used: clear the flock in as few as you can.
- Three darts a visit, one visit per team per round, each team rotating its own thrower.

Flock size scales with the roster, sublinearly, so a four-way match is longer than a heads-up without being
twice as long:

| mode | flock | 2 teams | 3 teams | 4 teams |
|---|---|---|---|---|
| Quick | `2 + 2 x teams` | 6 | 8 | 10 |
| Standard | `4 + 2 x teams` | 8 | 10 | 12 |
| Long | `6 + 3 x teams` | 12 | 15 | 18 |

## Getting started

```bash
cd ui && npm install
npm run dev          # Vite, on http://localhost:5173
```

That alone boots the board with a canned two-teams-of-two roster (see `ui/src/bridge.ts`), which is enough
for rendering work.

To actually play it, open **`dev/harness.html`** as well. It stands in for Barrelo: it keeps the visit log
the way the host does, posts the same `barrelo:gameState` into the board, and shows what the game sends
back. Chrome will not let a `file://` page drive the iframe, so serve the repo:

```bash
python -m http.server 5174        # from the repo root
#  then open http://localhost:5174/dev/harness.html
```

The harness offers both input paths, and they play very differently — both are worth trying:

- **Click the dartboard** — sends the exact point you clicked, the continuous coordinate a real autoscorer
  produces. Aim is fully analogue.
- **Segment + ring buttons** — the manual-entry path. Barrelo's `BoardGeometry.CenterOf` snaps a typed
  throw to the *centre* of the wedge, so there are only ever 80 scare points on the whole board.

It also has selectors for teams, players per team, flock mode and seed, and an **Enable second board**
toggle that runs a second copy on the same log and compares the state hash both report — the cheapest
possible check on the determinism contract.

## The determinism contract — read this one

Barrelo keeps the visit log; **every screen showing the match replays it independently** — the control
tablet, the TV on the wall, any tab refreshed mid-match. They only agree if replaying the same log always
produces the same state.

That is a sharp constraint here, because **where the sheep are is a rule**: it decides who scored, whose
turn it is and when the match ends. So `replay()` cannot ask the renderer — it runs the physics itself.

```
simulate.ts   Matter bodies, fixed 16.666ms step, 170-step burst cap
     |
     +-- rules.ts     headless engine -> the authoritative flock
     |                (drives scoring, turn order, sudden death, matchComplete)
     |
     +-- BoardScene   the same engine, stepped a frame at a time, with sprites
                      drawn from the body positions
```

Phaser's Matter integration is deliberately **not** used. Its runner smooths and snaps frame deltas and
takes solver settings from the scene config, which is a second place for the two sims to drift apart. There
is exactly one engine configuration in this codebase and it lives in `simulate.ts`.

Consequences to respect when changing anything:

- **Never** introduce a variable timestep. Catching up on a backlog of darts is done by taking *more fixed
  steps per frame*, never a bigger step.
- No `Math.random()` — randomness comes from `payload.seed`, via `buildPaddock` and `burstSeed`.
- No `Date.now()` / `new Date()`, no `crypto.randomUUID()`, no module-level mutable state, no `fetch`.
- A burst's wander is seeded from the match seed **and the dart's ordinal**, not from a generator threaded
  through the replay — so a board joining mid-match derives the same field as one that watched from the
  first dart.
- Positions are quantised at every burst boundary. `Math.sin`/`cos` are only accurate to the last ulp, so
  two JS engines can disagree in the final bit; truncating at each settle point discards the disagreement
  rather than compounding it. Static geometry is quantised at construction for the same reason.

## Layout

- **Rules** — `ui/src/rules.ts`. A pure fold over the visit log; the only place the game's decisions live.
  Undo needs no code — Barrelo shortens the log and the state is re-derived.
- **Physics** — `ui/src/simulate.ts`. Shared by the rules and the board, as above. Every tuning constant
  in the game is in here, with the reasoning attached.
- **The field** — `ui/src/paddock.ts`. Fixed geometry plus the seeded paddock. Read the header comment
  before moving a wall: the funnel's shape is load-bearing and two earlier versions of it were unplayable.
- **Input mapping** — `ui/src/scare.ts`. Dart coordinate to scare point, and nothing else.
- **Rendering** — `ui/src/scenes/BoardScene.ts` plus `ui/src/ui/`. Driven by the derived event stream, not
  by state diffing: `diffEvents` decides whether what arrived extends what is on screen (re-run the burst
  live) or not (an undo or a fresh tab — snap, animate nothing).
- **Art** — `ui/src/ui/textures.ts` generates every surface into the texture cache at boot. Nothing is
  loaded over the network. To use real art instead, drop PNGs into `ui/public/assets` and load them under
  the same keys in `PreloaderScene`; no drawing code changes.
- **Wire types** — `shared/types.ts`. Don't redeclare them locally.
- **The bridge** — `ui/src/bridge.ts`. The whole Barrelo contract in one short file.

## Verifying

```bash
npm run probe
```

There is no automated test suite; this stands in for one, and it is the thing to re-run after touching any
constant in `simulate.ts`. It bundles the real modules for Node with a shim that hands `simulate.ts`
Phaser's *own* Matter build, so what it measures is exactly what runs in the browser. It checks:

- **Playability** — 40 seeds x 3 modes x 3 roster shapes, over both input paths, with a deliberately naive
  herder. Reports median darts per sheep; asserts a 95% clear rate. See the table in `GameDescription.md`.
- **Geometry** — that no sheep ever ends up outside the paddock, and that none ends up where no legal dart
  can reach it. That second one is the real check that the field is sound; the herder's own failures are
  the herder's problem.
- **Settling** — that bursts finish under the step cap with the flock at rest, since the board freezes them
  between darts.
- **Determinism** — that the same payload replays to the same state hash, and that a log prefix yields an
  event-stream prefix, which is what the board's animation diffing depends on.
- **Rules** — solo completion and standings, a two-team race through to `matchComplete` including the
  sudden-death sheep, that a miss does not move the flock, and that the whistle gathers it.

The visual board is checked by eye through `dev/harness.html`.

## Deploy

```bash
cd ui && npm run build     # typechecks, then produces ui/dist/
cd .. && npm run deploy    # copies to Barrelo/external-plugins/herd-the-sheep
```

`npm run deploy` takes an optional destination argument. It refuses to write to a folder whose name is not
`herd-the-sheep`, because the host fetches the board from `/plugins/{gameId}/ui/` and a mismatch 404s
silently. It copies the *contents of* `ui/dist`, not `ui/` — copying `ui/` is the known failure mode, where
the board falls back to a raw JSON dump because the unbuilt `index.html` needs Vite behind it.
