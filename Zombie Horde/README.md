# Zombie Horde

A cooperative zombie survival game for [Barrelo](../../Barrelo), built on a [Phaser 4](https://phaser.io/)
board (TypeScript + Vite). Two to six players share one safehouse and one horde: kill the zombies by
hitting the number written above them, and survive as many waves as you can.

**The MVP is built and unplayed.** The rules in `ui/src/rules.ts` and the board in
`ui/src/scenes/BoardScene.ts` implement everything in §21 of the scope; `npm run check` asserts the
rules against the gameplay checklist below. What it has not had is a room with four people and a
dartboard, which is the only thing that can tell you whether the numbers in §20 are right.

- **[Zombie Horde — Game Scope.md](Zombie%20Horde%20—%20Game%20Scope.md)** — the rules. The authority: if
  this README and the scope disagree, the scope is right.
- **[Zombie Horde — Power-Up System.md](Zombie%20Horde%20—%20Power-Up%20System.md)** — post-MVP. Do not
  build this until the core has been playtested.

What is deliberately *not* built, per §21: Swarm, Armoured, Mutant and bosses (the type table and ring
restrictions are implemented, but `ENABLED_TYPES` and `BOSSES_ENABLED` in `rules.ts` gate them off), and
everything in §18.

Your game is **entirely a browser app**. There is no server half, no process for Barrelo to spawn, and no
HTTP contract to implement — Barrelo keeps the log of what was thrown and pushes it to your board, and
your board works out what it means. See the top-level README's "Adding a new game" section for the full
contract.

## Prerequisites

- [Node.js](https://nodejs.org) — to build. Nothing needs Node at *runtime*, including on the machine
  running Barrelo: the build output is static files.
- Nothing else — no .NET SDK needed to iterate on this folder in isolation.

## Getting started

```bash
cd ui && npm install
npm run dev          # Vite, on http://localhost:5173
```

That alone boots the board and feeds it a canned payload after a moment (see `ui/src/bridge.ts`) — one
team of four survivors with wave 1 on the spawn line, which is enough for rendering work.

To actually play it, open **`dev/harness.html`** in a browser as well. It stands in for Barrelo: it keeps
the visit log the same way the host does, posts the same `barrelo:gameState` message into your board, and
shows you the messages your game sends back. Click segments to throw, and use End turn / Undo / Reset.
The Roster button swaps between four survivors and the two-player minimum, which is the check that matters
for this game: zombies move once per round, so the same wave must reach the safehouse on the same round
either way (Game Scope §3).

The harness and the board are on different origins — the board is on Vite's port, the harness is a file
you opened — so in a dev build `bridge.ts` posts its messages up with a `"*"` target. A production build
always posts to its exact origin, because Barrelo serves the plugin from its own. Without that split the
harness's "Sent up by your game" panel silently stays empty.

To run the rules with no browser at all:

```bash
npm run check        # from this folder — folds scripted logs and asserts the rules
```

It needs nothing installed: `replay()` is a pure function, Node runs the TypeScript directly, and the
whole thing is `dev/rules-check.ts`.

## One team, many survivors

Barrelo is a team platform first. A match is **N teams**, and the host collects a team assignment before
the match starts. Zombie Horde is cooperative, so it is **one team of 2–6 players** — see Game Scope §2,
which is the authority on this; the summary here is just what it means for the code.

`plugin.json` declares it:

```json
{
  "minPlayers": 2,
  "settings": [
    { "kind": "playerGroup", "key": "teams", "displayName": "Survivors",
      "maxGroups": 1, "maxPlayersPerGroup": 6 }
  ]
}
```

Two consequences for the code:

- **Turn order falls out of the existing rotation.** `replay()` rotates one visit per team per round and
  each team rotates its own thrower. With a single team, that is exactly "each survivor throws in turn,
  round after round" — which is the loop in Game Scope §3. Don't rewrite it to walk the flat roster; it
  already does the right thing.
- **Movement happens once per round, not once per visit.** A round is complete when the team's rotation
  comes back around to its first member, *or* when the active wave is cleared — whichever comes first.
  That boundary is the one your fold has to detect, and it is the reason wave difficulty doesn't depend on
  how many people are playing (Game Scope §3, §10).

`winnerPlayerIds` and `finalStandings` stay lists of *player* ids. Zombie Horde always ends in defeat, and
reports **every player** in both lists, so the whole group is credited with the run and each member earns
session-leaderboard points (Game Scope §2).

Deleting the `playerGroup` setting from the manifest would make the game solo-only — the host would stop
collecting a team assignment and send an empty `playerGroups`. Keep it.

## The determinism contract — read this one

Barrelo keeps the visit log; **every screen showing the match replays it independently** — the control
tablet in someone's hand, the TV on the wall, and any tab that gets refreshed mid-match. They only agree
if replaying the same log always produces the same state.

So inside `replay()` (and anything it calls):

- No `Math.random()` — use the `rng(payload.seed)` helper in `ui/src/rules.ts`. The seed is fixed for the
  match and identical on every screen.
- No `Date.now()` / `new Date()` — use `throw.detectedAtUtc` from the log.
- No `crypto.randomUUID()` — derive ids from the log (e.g. `throw.throwId`).
- No module-level mutable state, no `localStorage`, no `fetch`.

Break any of these and the TV quietly shows something different from the tablet. Barrelo does detect it —
every screen reports a hash of its derived state and the host logs a warning when two disagree — but the
fix is always in `replay()`.

This bites Zombie Horde harder than a scoring game, because so much of its state *looks* like something
you would accumulate. It isn't. Wave number, every zombie's position and health, safehouse HP, the score
and the survival time are all recomputed from the whole log on every push — which is also what makes undo
free. Game Scope §2 has the specifics, including the survival timer and the power-up spawn rolls, which
are the two places the temptation is strongest.

## Where to put your game

- **Rules** — `ui/src/rules.ts`. `replay(payload)` is a pure fold over the visit log and is the only place
  the rules live. It gets the roster (`payload.playerIds`, `payload.playerGroups`), the match options, the
  seed, and every dart thrown so far, and returns the horde, the safehouse, the wave, whose turn it is,
  and whether the run is over. Undo needs no code at all — Barrelo shortens the log and it re-derives.
  Every tunable value from §20 is a named constant at the top of the file.
- **Rendering** — `ui/src/scenes/BoardScene.ts`. The approach track read left to right: zombies spawn at
  space 6 on the far left, the safehouse is on the right, so "closer to the safehouse" is literally
  "further right" — which is what makes the automatic targeting in §6 legible. It renders the state
  `replay()` derived, not the raw payload. Everything is vector (rounded-rect zombie cards, a drawn
  safehouse, drawn health pips), so nothing depends on an emoji font rendering the same way on the machine
  driving the TV as it did on a laptop.
- **Sound** — `ui/src/sfx.ts`. Synthesised with the Web Audio API rather than shipped as files, so the
  deployed plugin stays a manifest plus static files. `BoardScene` fires sounds from the *difference*
  between two rendered states, never from the fold — so a screen refreshed mid-match doesn't replay the
  whole run's audio, and undo doesn't play a kill backwards.
- **Wire types** — `shared/types.ts`. The shapes Barrelo sends and expects; don't redeclare them locally.
  Note `Ring` has three single-ish values (`Single`, `InnerSingle`, `OuterSingle`) which all mean one
  damage, and that the bullseye arrives as segment 25 — `Double` for the bull, `Single` for the outer bull
  (Game Scope §5, §12).
- **The bridge** — `ui/src/bridge.ts` connects the two and talks to Barrelo. You shouldn't need to change
  it, but it's worth reading once: it's the whole contract in one short file.

### What Barrelo does and doesn't know

Barrelo records darts and nothing else. In the snapshot it pushes you, `currentPlayerId` is **always
null** and `legNumber`/`setNumber` are **always 1** — those are rules output, and your rules own them.
Read them from your own replay.

That's also why the bridge sends a `barrelo:display` message back up on every change: it's what drives the
turn indicator, the dart 1/2/3 slots, the leg/set label, and greyed-out targets in Barrelo's own chrome
around your board. And when your `replay()` sets `isComplete`, the bridge sends `barrelo:matchComplete`
once, which is what ends the match and awards session-leaderboard points from your `finalStandings`.

## Deploy

Barrelo serves `plugins/{gameId}/ui/index.html` as a static file with no build step, so it needs the
**built** output, not the Vite sources.

1. Build the UI:
   ```bash
   cd ui && npm run build     # produces ui/dist/
   ```
2. Copy the manifest and the built board into Barrelo's plugins directory. The destination folder name
   must match `plugin.json`'s `gameId` exactly, since the UI is fetched from `/plugins/{gameId}/ui/...`:
   ```bash
   DEST=<path-to-barrelo>/src/Barrelo.Api/plugins/zombie-horde
   mkdir -p "$DEST/ui"
   cp plugin.json "$DEST/"
   cp -r ui/dist/. "$DEST/ui/"
   ```

That's the whole deployment: a manifest and a folder of static files. No `npm install` at the destination,
no `node_modules`, no runtime dependencies.

Copying `ui/` itself instead of the contents of `ui/dist/` is the likely mistake: the board will silently
fall back to a plain JSON dump, because the unbuilt `index.html`'s module script can't load without Vite's
dev server behind it.

## Smoke test — plumbing

This proves the pipeline, not the game. The first four are verified and pass in `dev/harness.html`; the
rest need Barrelo itself and are the first thing to check after deploying.

- [x] `dev/harness.html` shows the board — wave 1 on the spawn line — and clicking segments updates it.
- [x] End turn advances to the next player, and a full round comes back around to the first.
- [x] The harness's "Sent up by your game" panel shows a `barrelo:display` message with a
      `currentPlayerId` and a `stateHash` after each throw.
- [x] Undo reverts the last throw, and undo straight after "End turn" re-opens that visit rather than
      dropping a dart.
- [ ] After deploying, Zombie Horde appears in Barrelo's start-screen game picker **with the team
      chalkboard** — a single "Survivors" bucket taking 2–6 players. That's what confirms the manifest's
      `playerGroup` setting parsed.
- [ ] Starting a match shows the board, not a raw JSON dump, and throwing (manual entry is enough) updates
      it — that proves the whole path: dart → host log → `barrelo:gameState` → `replay()` → `BoardScene`.
- [ ] With `view.html` open on a second screen, both show the same thing after the same throws.

## Smoke test — gameplay

**`npm run check` covers all of these.** Each one targets a rule that is easy to get subtly wrong, and
each is a named case in `dev/rules-check.ts` — if one fails, the failure names the section of the scope
it came from.

- [x] `S18` deals 1, `D18` deals 2, `T18` deals 3 to a zombie requiring 18; any other number deals 0.
- [x] With two 18-zombies on the board, damage lands on the one **closest** to the safehouse (Game Scope
      §6), and ties break by spawn order.
- [x] A `T18` that overkills a 1 HP zombie carries its remaining 2 damage to the next-closest 18-zombie.
- [x] Zombies move **once per round** — not after each player's turn. Checked with 2 players and again
      with 5: the same wave reaches the safehouse on the same round in both.
- [x] A zombie reaching the safehouse costs 1 HP and is removed; it never attacks twice.
- [x] Clearing a wave ends the round as soon as the clearing player's own turn is over — the rest of the
      rotation isn't spent throwing at an empty board — and the next wave spawns immediately.
- [x] Bull (segment 25, `Double`) is a Critical Hit; outer bull (segment 25, `Single`) freezes movement
      for one phase.
- [x] At 0 safehouse HP the run is complete, with **every** player in both `winnerPlayerIds` and
      `finalStandings`, and the state stops moving even if more darts arrive.
- [x] Undo after a killing dart brings the zombie back with the right health — the proof that nothing is
      being accumulated outside `replay()`.
- [x] The same log folds to the same state twice, so two screens report the same `stateHash`.

Two things the checks can't reach, because they live in the browser rather than in `replay()`:

- [ ] The bridge sends `barrelo:matchComplete` **exactly once** — verify in the harness's "Sent up by your
      game" panel, or in Barrelo itself.
- [ ] With `view.html` open on a second screen, both show the same thing after the same throws.

## Testing

This game intentionally lives outside `Barrelo.slnx` and isn't part of `dotnet test`. The rules have their
own check (`npm run check`); everything about the *board* — layout, animation, sound, the game-over
screen — is verified by playing it in `dev/harness.html`.

## Playtest notes

Simulating skill levels against these constants (aim at the most urgent zombie, ring chosen to finish it)
gives a median run of roughly:

| Roster | Beginner | Club | Strong |
|---|---:|---:|---:|
| 2 players | wave 8 | wave 10 | wave 15 |
| 4 players | wave 12 | wave 24 | wave 31 |
| 6 players | wave 20 | wave 35 | wave 50 |

Two things to watch for in a real session. A strong six is looking at 170-odd rounds, which is a long
evening — §19 names the lever if that turns out to be too much (wave size as a function of player count),
and deliberately doesn't pull it before the base curve is right. And the spread between two and six
players is roughly threefold, which is §19 working as designed rather than a bug: the reward for filling
the roster is more darts against the same wave.
