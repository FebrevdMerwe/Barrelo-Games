# Herd The Sheep — design

A Barrelo **client-owned** game (protocol v2). The TV shows a flock of sheep in a fenced paddock. Every
dart is a **scare point** dropped on the grass at the exact spot it landed, and sheep flee directly away
from it. You use that, and nothing else, to work the flock through a funnel and into a pen.

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

## The board is the paddock

`throw.position` is normalized board space — origin at the bull, magnitude 1.0 at the outer edge of the
double ring, +X right and +Y **up**. That coordinate is read literally: the fence is the unit circle, the
bull is the middle of the field, and a dart in the double ring lands hard against the fence. The 20 board
numbers are painted faintly on the grass just inside the fence, so the mapping from "I want a scare point
there" to "so I throw that segment" is visible but never solved for you.

Ring and score are otherwise ignored. There are exactly two exceptions:

- **The bull is a whistle.** It does not scare. It pulls the whole flock in toward its own centre of mass.
  It is the only way to recover a flock scattered across the field, and it is the hardest target on the
  board, which is the point.
- **A miss does nothing.** Radius 1.05 is over the fence and into the next field; the sheep never heard it.
  The burst still runs, so the flock drifts a little on the wander, and the dart is gone.

## The flock

Sheep are Matter bodies with soft flocking on top: they flee radially from a scare point, cohere loosely to
the flock's centre, keep out of each other's way, and wander. They start each match as one loose huddle in
the western half, not scattered — a scattered flock is the game's failure state, and opening every match in
it would teach the wrong thing about what a dart does.

The flee force falls off **quadratically** with distance, which is a gameplay decision rather than a
physical one. A linear falloff shoves the whole flock nearly equally, so every dart detonates it outward
and the pieces have to be gathered up again. Squaring it concentrates the push on the sheep nearest the
dart, so a dart behind the flock presses its near edge and the whole blob rolls — the skill a real handler
uses, and what this game claims to be about.

One consequence falls out of the geometry and is worth knowing before you play: **the middle of the paddock
cannot be scared, because the middle is the bull, and the bull is a whistle.** A flock sitting just east of
centre therefore cannot be pushed from directly behind — you have to work it from a flank, or press it from
further out and settle for a weaker shove. Nothing enforces that rule; it is just what happens when the
paddock and the dartboard are the same circle.

**Time only passes when a dart lands.** Sheep positions are a *rule* — they decide who scored, whose turn
it is and when the match ends — so they can only advance in ways `replay()` can reproduce. Each dart runs
a fixed burst of physics steps: flee, flock and seeded wander, then damping until every sheep is at rest.
Between darts the flock is animated but positionally frozen: heads dip, tails flick, nothing moves. What
you see when you step to the oche is exactly what you will be throwing at.

## The paddock

The fence is the throwable circle. Off its eastern rim, a funnel opens wide onto the field and tapers to a
one-sheep gate, with the pen beyond it. The pen bay is outside throwable space, so **penned sheep can never
be scattered** — but the funnel's wide end is *inside* the fence, so a dart dropped between a sheep and the
gate flushes it back out. That is the denial play, and the window for it is small enough that hitting it is
a genuinely good dart.

The funnel does not merely narrow, it **channels**: a sheep between the walls is drawn along them toward the
gate. That is not flavour, it is necessary. A flock shoved at a narrowing funnel does not file through it,
it arches across the neck and stops dead — the same jamming that blocks a grain hopper — and beating the
arch by widening the gate would take roughly six sheep-widths, which is not a pen. Measured before the fix,
a herded flock reached the mouth and stalled there permanently.

The drift starts at the **fence circle**, which is also exactly the edge of throwable space. So the rule is
"if you can still hit it, you can still save it": a sheep in the mouth of the funnel is inside the fence and
can be flushed, and one past the fence is committed. Nothing is painted on the grass to say so, because the
fence already says it. The practical effect is the best thing in the game — once the flock reaches the mouth
it starts trickling in on its own, and the denial play stops being a niche trick and becomes the thing you
have to watch for.

Obstacles — a pond, a rocky outcrop, a copse — are placed from `payload.seed`, which is fixed for the match
and identical on every screen. Every match gets a different paddock and therefore a different route to the
gate. Obstacles block sheep, not sound: a scare behind a rock still works. There is no line of sight in
this game, because a TV where darts silently do nothing for invisible reasons is a bad TV.

## The match

Every team herds the **same** flock into the **same** pen. A sheep is banked to whichever team's dart-burst
drove it through the gate, and is then removed from play. Scores only ever go up.

The flock is sized so a four-way match is longer than a heads-up without being twice as long:

| mode | flock size | 2 teams | 3 teams | 4 teams |
|---|---|---|---|---|
| Quick | `2 + 2 x teams` | 6 | 8 | 10 |
| Standard | `4 + 2 x teams` | 8 | 10 | 12 |
| Long | `6 + 3 x teams` | 12 | 15 | 18 |

Most sheep wins. Because the pool is fixed, the match ends the moment it is **mathematically decided** —
when no other team can still reach the leader — rather than limping through a last sheep that changes
nothing. If the field empties level, a single **sudden-death sheep** is released from a seeded spot on the
far rim and only the tied teams throw for it, repeating until it is settled.

**Solo** is the same code path with one team: there is nobody to beat, so it plays for a number — clear the
flock in as few darts as you can. `minGroups` stays 1 and nothing is special-cased.

**Turns** are the platform default: three darts to a visit, one visit per team per round, each team
rotating its own thrower. Banking a sheep does not earn another dart.

## Determinism

Barrelo keeps the visit log and every screen replays it independently, so the physics runs **twice** — once
headless inside `replay()` for the authoritative answer, once live in Phaser so you watch real bodies move.
Same engine, same bodies, same fixed step, same order of operations. This is Putt Putt's architecture and
the reasoning behind it applies here unchanged.

Three things this game does that Putt Putt does not:

- **Phaser's Matter integration is not used at all.** The board drives a bare Matter engine built by the
  same `createEngine()` the rules call, and draws sprites from body positions. Phaser's Matter runner
  smooths and snaps frame deltas and takes its solver settings from the scene config, which is a second
  place for the two sims to drift apart; this way there is exactly one engine configuration in the
  codebase, in `simulate.ts`. Catching up on a backlog of darts is done by taking **more fixed steps per
  frame**, never a bigger step.


- **Positions are quantised at every burst boundary.** Putt Putt documents this as the someday-fix for the
  fact that `Math.sin`/`cos` are only accurate to the last ulp, so results are bit-identical within one JS
  engine but not guaranteed across two. Here there is a natural settle point every single dart, so it costs
  two lines and the caveat simply goes away. Static geometry is quantised at build time for the same reason.
- **Wander is seeded per dart, not per replay.** The burst's PRNG is seeded from `payload.seed` and the
  dart's ordinal in the log, so a burst produces the same wander regardless of how much history preceded it.
  A board that joins mid-match derives the same field as one that watched from the start.

The usual prohibitions apply inside `replay()` and everything it calls: no `Math.random()`, no `Date.now()`,
no `crypto.randomUUID()`, no module-level mutable state, no `localStorage`, no `fetch`.

## Measured difficulty

`npm run probe` plays 40 seeds of every mode and roster with a deliberately naive herder — press the
rear-most sheep, whistle a scattered flock — over both input paths. Current numbers:

| | analogue (autoscorer) | snapped (manual entry) |
|---|---|---|
| Quick, 2 teams, 6 sheep | 14 darts (2.3/sheep) | 18 darts (3.0/sheep) |
| Standard, 2 teams, 8 sheep | 17 darts (2.1/sheep) | 19 darts (2.4/sheep) |
| Long, 4 teams, 18 sheep | 27 darts (1.5/sheep) | 28 darts (1.6/sheep) |

Those are medians for a bot with perfect aim and perfect knowledge of where every sheep is; a person at
the oche is the slower case, which is the intent. The two input paths landing this close together is the
point of tuning against the snapped column: manual entry only ever produces 80 scare points, and an
earlier build that played fine with an autoscorer finished only 15–50% of typed-in matches.

## Known risks

- **The last sheep.** A lone sheep has no flock-mates to cohere to and must be pushed one dart at a time.
  The mathematical early-out covers matches that are *decided*, not matches that are merely *slow*.
- **Flush stalemate.** Two teams can in principle spend every dart flushing each other out of the funnel.
  There is no round cap to stop them. The throwable stretch of the race is deliberately short, which makes
  the window small — but it is a window.
- **Burst length is the whole feel.** Too short and darts feel inert; too long and the flock scatters
  beyond recovery. It is the number most likely to need retuning against the probe.
- **The naive herder is a floor, not a ceiling.** It fails to finish about 2% of seeds, always by talking
  itself into a loop a person would step straight out of. The probe therefore asserts a 95% clear rate and,
  separately, that no sheep ever ends up where **no legal dart can reach it** — that second one is the
  check that the paddock geometry is sound, and it passes on every seed.
