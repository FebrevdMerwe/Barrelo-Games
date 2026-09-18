# Territory — a Barrelo game

Two to four sides fight over the twenty numbers and the Bull. You start on one Home territory, expand
into whatever you can reach, shield what you hold, and break through what you don't. Lose every
territory and you are out; the last side standing wins — or, if the match has a round cap, whoever
holds the most territory when it's reached.

Built on the Barrelo Phaser client-owned game template: the whole game is a browser app, Barrelo keeps
the log of what was thrown, and `replay()` works out what it means.

## The rules in one minute

Every dart is worth **hits**, not points: a single is 1, a double is 2, a triple is 3, and the Bull is
1 from either ring. Every territory sits on one ladder, and every hit moves it exactly one rung:

```
unclaimed  →  held  →  1 shield  →  2 shields  →  3 shields
```

| Where it lands | Which way it moves |
|---|---|
| Your own territory | **Up** — one shield per hit, capped at 3 |
| Neutral ground you can reach | **Up** — the first hit claims it, the rest shield it |
| Enemy ground you can reach | **Down** — one shield per hit, then one more to clear it off them |
| Anything else | Nothing |

"Can reach" means the territory touches something you already hold.

Ground never changes hands in one rung. An enemy territory stripped of its shields goes **unclaimed**
on the next hit — off its owner, but not yours — and it takes a further hit to claim it. So a single
into an unshielded enemy clears the wedge and leaves it neutral; a **double** clears it *and* claims
it; a **triple** clears it, claims it and puts a shield on it. Read the same ladder upwards and a
double into neutral ground lands on one shield, a triple on two.

Hits are spent one rung at a time and whatever is left at the top is discarded — a triple into a
three-shield enemy strips all three and stops there, with nothing left to clear it with.

Three darts to a turn. A side with no territories left is eliminated and drops out of the rotation.

## Match length

The default is unlimited rounds — the match runs until one side stands alone. The `matchLength`
setting (`plugin.json`) lets the host cap it at 10, 15 or 20 rounds instead, so a close match can't run
for hours: once the cap is reached, whoever holds the most territory wins. A tie on territory is broken
by shields banked across it, and a tie on both by seat order — arbitrary, but fixed, so a genuine tie
resolves the same way on every replay.

## Two things worth knowing about the map

**Adjacency is the wire.** Two territories touch when their wedges touch on a real dartboard: 11's
neighbours are 8 and 14, 20's are 5 and 1, 6's are 13 and 10. Adjacency you can point at beats
adjacency you have to work out, so a side's ground grows as a visible arc and its front lines are the
two wedges at either end of it.

That means **position tells you where you may throw next**, and the pulsing outline on every reachable
territory confirms it rather than being the only thing that could say it. The ring lives in
`ui/src/board.ts` as `WEDGE_ORDER`, and `buildAdjacency()` is the one place it is chosen — walking
`RING_IDS` there instead would put the game back on a numeric 1‑2‑3‑…‑20‑1 ring, where a side holding
6, 7 and 8 has three wedges scattered around the board rather than a visible arc.

**The Bull touches all twenty numbers**, so it is in reach of every side from the very first dart, and
whoever holds it can expand toward any number on the board. It is nobody's Home and it starts neutral.
Taking it early is the strongest opening in the game — and it makes you the target of everyone else.

## How the board shows ownership

The board is drawn as a dartboard first: the real ring proportions, alternating black and cream beds,
red and green trebles and doubles. Ownership goes on top of that without burying it.

- **The collar** — the numbers ring outside the wire — goes solid in the owner's colour. Twenty blocks
  around the rim is the entire ownership map in one glance, and it is the authoritative readout.
- **The beds** take a light wash of the same colour. Enough that a wedge doesn't look abandoned, not
  enough to compete with the rings. Washing whole wedges was tried and abandoned: by the midgame
  almost everything is owned, and a strong wash turns the board into a colour wheel.
- **The trebles, doubles and the bull itself are never painted.** They are the board's signature, and
  keeping them pure is what lets it still read as a dartboard when every territory has been claimed.
  The Bull gets a collar ring drawn *around* it for the same reason — painting its green ring made a
  red owner's bull brown and a green owner's bull indistinguishable from an unclaimed one.
- **Shield pips** sit in the outer single bed, the **Home star** in the inner one, both well clear of
  the hub where twenty wedges converge and nothing can be told apart.
- **The reachable pulse** steps down in weight once more than a handful of territories are in reach:
  when someone holds the Bull and the answer is "anywhere", twenty pulsing outlines say almost nothing
  and would only be noise.

## Starting positions

Homes are computed from the board rather than drawn at random, so every side starts with the same room
to expand into and every screen agrees without consulting the seed. The wire is cut into equal arcs and
each side takes the wedge nearest its arc's centre — so "opposite" means opposite where the players
are actually looking, not opposite in the numbers:

| Sides | Homes | Spacing |
|---|---|---|
| 2 | 6, 11 | dead opposite — three and nine o'clock |
| 3 | 4, 3, 14 | 120° |
| 4 | 18, 15, 7, 9 | exactly 90° |

Home is an ordinary territory wearing a label. It starts on zero shields, it can be reinforced, and it
walks the same ladder as everything else — losing it costs you nothing but the territory, and you stay
in the game as long as you hold something else.

## Getting started

```bash
cd ui && npm install
npm run dev          # Vite, on http://localhost:5173
```

That boots the board and feeds it a canned two-teams-of-two payload after a moment (see
`ui/src/bridge.ts`), which is enough for rendering work.

To actually play it, open **`dev/harness.html`** as well. It stands in for Barrelo: it keeps the visit
log the same way the host does, posts the same `barrelo:gameState` message into your board, and shows
you the messages your game sends back. Click segments to throw, and use End turn / Undo / Reset. The
**Next roster** button cycles 2 teams of 2 → 2 solo → 3 solo → 4 solo, which is what you need to check
the starting positions: Homes are dealt from the *number of sides*, so each count lays the board out
differently.

The harness greys out whatever the game reports in `deadTargets`, the same way Barrelo greys them on
its own dartboard — an easy way to see the reachability rule working without reading any state.

> Browsers throttle `requestAnimationFrame` in background tabs, which freezes Phaser's tweens and
> timers. If the board looks stuck mid-animation, focus the tab — it will play out from where it left
> off. Nothing is lost either way, because the map repaints from the derived state as soon as the
> animation queue drains.

## Teams are the default

A match is N teams, and a solo match is simply N teams of one — there is no separate solo code path.
`plugin.json` declares a `playerGroup` setting with `minGroups: 2`, because Territory genuinely cannot
be played alone: "last side standing" would be won before the first dart. A roster the game can't play
renders an explanation rather than a broken board (protocol v2 has no `/create` hook to reject it at).

`winnerPlayerIds` and `finalStandings` are lists of *player* ids: a winning side contributes all of its
members, and standings list each side's members together, best side first — the winner, then the
eliminated sides in reverse order, so the last one knocked out ranks highest among them.

## The determinism contract

Barrelo keeps the visit log; **every screen showing the match replays it independently**. They only
agree if replaying the same log always produces the same state. So inside `replay()`:

- No `Math.random()` — `rng(payload.seed)` is the only permitted source. Territory uses none: the
  Homes are computed from the wire, so even the setup needs no randomness.
- No `Date.now()` / `new Date()` — use `throw.detectedAtUtc` from the log.
- No `crypto.randomUUID()` — derive ids from the log (e.g. `throw.throwId`).
- No module-level mutable state, no `localStorage`, no `fetch`.

Barrelo detects a divergence — every screen reports a hash of its derived state and the host logs a
warning when two disagree — but the fix is always in `replay()`.

## Where the code lives

- **`ui/src/board.ts`** — the map: the 21 territories, the wire that is both the drawn ring and the
  adjacency ring, the ring proportions, what a dart is worth, and where each side starts. No game
  state, just the board.
- **`ui/src/rules.ts`** — `replay(payload)`, a pure fold over the visit log and the only place the
  rules live. It returns the sides, the map, whose turn it is, an ordered event stream and who has
  won. Undo needs no code at all — Barrelo shortens the log and you re-derive.
- **`ui/src/scenes/BoardScene.ts`** — composes the display and turns the event stream into animation.
- **`ui/src/ui/`** — `TerritoryMap` (the dartboard), `TeamRail` (the side cards), `Hud` (header, dart
  slots, commentary, victory card), plus the `AnimationQueue`/`eventTail` pair that paces playback.
- **`shared/types.ts`** — the shapes Barrelo sends and expects; don't redeclare them locally.
- **`ui/src/bridge.ts`** — the whole contract in one short file. Worth reading once.

### Why the board renders events, not state

The snapshot that arrives after a visit is the state *after* all three darts. Painting it straight
away would flip a wedge to its final owner while the capture that took it is still animating. So
`replay()` also returns an ordered event stream, `diffEvents` decides whether what just arrived
extends what is already on screen, and the map is mutated a step at a time — then fully repainted from
the derived state once the queue drains, which makes any drift self-correcting.

Every event key is derived from the dart that caused it, and `replay()` is a left fold, so appending
darts can never rewrite an earlier key. That is what makes the prefix comparison sound. Undo produces
a stream that is shorter, or missing its trailing `turnChanged`; both fail the test and resync.

## Testing

```bash
cd ui && npm test        # rules tests, no framework and no build step
npm run typecheck
```

`ui/src/rules.test.mjs` covers the board model, the starting positions, every branch of the dart
resolution table, turn rotation, elimination, standings and the determinism hashes. `replay()` is a
pure function whose only imports are types and `board.ts`, so Node's built-in type stripping loads
`rules.ts` directly — which is why imports inside `src/` carry an explicit `.ts` extension.

This folder lives outside `Barrelo.slnx` and isn't part of `dotnet test`.

## Deploy

Barrelo serves `plugins/{gameId}/ui/index.html` as a static file with no build step, so it needs the
**built** output, not the Vite sources.

Territory's source lives outside Barrelo's solution, which is exactly what `external-plugins/` is for:
a git-tracked home for prebuilt packages, copied into `plugins/{gameId}/` automatically on every
`dotnet build`/`run`/`publish`. Don't hand-copy into `src/Barrelo.Api/plugins/` — that folder is build
output, written by each in-solution game's post-build step, and anything dropped there by hand is
outside version control and liable to be overwritten.

```bash
npm run build     # typechecks, then produces ui/dist/
npm run deploy    # copies plugin.json and the contents of ui/dist/ into external-plugins/territory
```

`scripts/deploy.mjs` defaults to `C:/Projects/Darts/Barrelo/external-plugins/territory`. Pass a path
to send it elsewhere: `npm run deploy -- <path-to-barrelo>/external-plugins/territory`.

Then `dotnet build src/Barrelo.Api/Barrelo.Api.csproj` in Barrelo to pick it up.

The script exists because hand-copying has three failure modes, and it refuses or handles each:

- **The folder name must match `plugin.json`'s `gameId` (`territory`) exactly.** The loader warns
  about a mismatch, and the UI is fetched from `/plugins/territory/ui/...`, so it would 404 while the
  game still appeared in the picker. The script checks the name and exits rather than copying.
- **It is the *contents* of `ui/dist/` that get copied, never `ui/` itself.** With the unbuilt
  `index.html` in place the board silently falls back to a plain JSON dump, because its module script
  can't load without Vite's dev server behind it. The script also stops with a clear message when
  `ui/dist/index.html` is missing, instead of deploying a stale or empty folder.
- **The destination `ui/` is deleted, not merged.** Vite content-hashes the bundle filename, so
  merging would leave every previous build's `index-*.js` behind to be copied and published forever.

That's the whole deployment: a manifest and a folder of static files. No `npm install` at the
destination, no `node_modules`, no runtime dependencies.

### Verifying a deploy

With Barrelo running, these three should all be 200, and the game should appear in the list:

```bash
curl -sL http://localhost:5295/api/games | grep -o '"gameId":"territory"'
curl -sL -o /dev/null -w '%{http_code}
' http://localhost:5295/plugins/territory/plugin.json
curl -sL -o /dev/null -w '%{http_code}
' http://localhost:5295/plugins/territory/ui/index.html
```

A manifest Barrelo rejects is logged as a warning at startup and the game simply won't be listed.

## Smoke test

- [ ] The harness shows a dartboard — 20 at the top, then 1, 18, 4 clockwise — with the collars for 6
      and 11 coloured, each carrying a gold Home star, and every other collar black. The two Homes sit
      directly across the board from each other.
- [ ] Only 13, 6, 10 and the Bull are throwable-with-effect for the opening side — Home and the two
      wedges beside it; everything else is greyed in the harness.
- [ ] `T6` takes Home 6 to three shield pips; a fourth hit on it reports "already at full shields".
- [ ] Claiming the Bull un-greys every target on the board, and draws a collar ring around the bull
      in that side's colour while leaving the bull itself red and green.
- [ ] `D11` against a two-shield enemy strips both without taking it; the next single clears it to
      neutral, and the single after that claims it.
- [ ] `D11` against an unshielded enemy clears it and claims it in the one dart — two beats on the
      board, the wedge going black and then taking your colour.
- [ ] Taking a side's last territory greys their rail card to OUT and skips them in the rotation —
      they go out on the hit that clears it, before anyone has claimed it.
- [ ] The last side standing gets the victory card, and the rail beside it still reads the standings.
- [ ] Undo reverts the last dart, and undo straight after "End turn" re-opens that visit rather than
      dropping a dart.
- [ ] Next roster → 3 solo puts the Homes on 4, 3 and 14, evenly spread around the drawn board;
      → 4 solo puts them on 18, 15, 7 and 9, at twelve, three, six and nine o'clock.
- [ ] The "Sent up by your game" panel shows a `barrelo:display` with a `currentPlayerId`,
      `deadTargets` and a `stateHash` after each throw.
- [ ] After deploying, Territory appears in Barrelo's start-screen picker **with the team chalkboard**
      — that's what confirms the manifest's `playerGroup` setting parsed.
- [ ] With `view.html` open on a second screen, both show the same map after the same throws.
