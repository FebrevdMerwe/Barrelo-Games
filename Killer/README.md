# Killer

A Barrelo **client-owned** game (protocol v2): everyone is dealt a number, you hit your own double to
become a killer, and then you take your opponents' lives. Last player standing wins.

Killer is entirely a browser app — a [Phaser 4](https://phaser.io/) board built with TypeScript + Vite.
There is no server half, no process for Barrelo to spawn, and no HTTP contract. Barrelo keeps the log of
what was thrown and pushes it to the board; the board works out what it means.

## Rules

- Each player is dealt a unique number from 1–20 at the start of the match (2–20 players).
- Hitting the **double** of your own number makes you a **killer**. Any other hit on your own number does
  nothing, and once you're a killer you stay one.
- As a killer, hitting a **living opponent's** number — on any ring — costs them one life. Everyone starts
  with three.
- The bull is inert, and so is any number that wasn't dealt to anybody.
- Three darts to a turn. Eliminated players are skipped.
- The last player standing wins; final standings are the winner followed by the elimination order
  reversed, so the first player knocked out places last.

## Getting started

```bash
cd ui && npm install
npm run dev          # Vite, on http://localhost:5173
```

That alone boots the board with a canned four-player roster (see `ui/src/bridge.ts`), which is enough for
rendering work.

To actually play it, open **`dev/harness.html`** as well. It stands in for Barrelo: it keeps the visit log
the same way the host does, posts the same `barrelo:gameState` message into the board, and shows the
messages the game sends back. Set the roster, click segments to throw, and use End turn / Undo / Reset.

Two Killer-specific controls the generic template harness doesn't have:

- **Seed** — drives the number assignment. Change it and everyone's number moves.
- **Enable second board** — runs a second copy of the board on the same log and compares the state hash
  both report. This is the cheapest possible check on the determinism contract below.

> If the board loads as some other app, a stale service worker from another project has claimed
> `localhost:5173`. Unregister it in DevTools → Application → Service Workers.

## The determinism contract — read this one

Barrelo keeps the visit log; **every screen showing the match replays it independently** — the control
tablet in someone's hand, the TV on the wall, and any tab that gets refreshed mid-match. They only agree
if replaying the same log always produces the same state.

So inside `replay()` (and anything it calls):

- No `Math.random()` — use the `rng(payload.seed)` helper in `ui/src/rules.ts`. The seed is fixed for the
  match and identical on every screen. **This is what deals the numbers**, so getting it wrong means the
  TV and the tablet disagree about who is on what — the most visible possible failure.
- No `Date.now()` / `new Date()` — use `throw.detectedAtUtc` from the log.
- No `crypto.randomUUID()` — derive ids from the log (e.g. `throw.throwId`).
- No module-level mutable state, no `localStorage`, no `fetch`.

Barrelo does detect a violation — every screen reports a hash of its derived state and the host logs a
warning when two disagree — but the fix is always in `replay()`.

## Layout

- **Rules** — `ui/src/rules.ts`. `replay(payload)` is a pure fold over the visit log and the only place
  the rules live. Undo needs no code at all: Barrelo shortens the log and the board re-derives.
- **The bridge** — `ui/src/bridge.ts`. The whole contract with Barrelo in one short file: replay on the
  way in, `barrelo:display` (turn, darts, dead targets, hashes) and `barrelo:matchComplete` on the way out.
- **Rendering** — `ui/src/scenes/BoardScene.ts` plus `ui/src/ui/*` (player cards, dartboard, banners,
  throw and elimination effects). It renders the state `replay()` derived, never the raw payload.
- **Animation** — `replay()` emits the match as an ordered `GameEvent[]`; `ui/src/ui/eventTail.ts` diffs
  the previous list against the new one by common prefix, so a normal throw animates its tail and an undo
  is detected exactly rather than guessed at, then hard-resyncs.
- **Wire types** — `shared/types.ts`, mirrored from the C# records. Don't redeclare them locally.

### What Barrelo does and doesn't know

Barrelo records darts and nothing else. In the snapshot it pushes, `currentPlayerId` is **always null**
and `legNumber`/`setNumber` are **always 1** — those are rules output, and the rules own them. That's why
the bridge sends `barrelo:display` back up on every change: it drives the turn indicator, the dart 1/2/3
slots, and the greyed-out targets in Barrelo's own chrome around the board. Killer greys out the bull,
every undealt number, and every eliminated player's number, since none of them can ever do anything.

## Deploy

```bash
npm run build      # ui/dist/
npm run deploy     # -> C:/Projects/Darts/Barrelo/external-plugins/killer
```

`scripts/deploy.mjs` takes an optional destination argument. It copies `plugin.json` and the **contents
of** `ui/dist/` — copying `ui/` itself is the known failure mode, since the unbuilt `index.html`'s module
script can't load without Vite behind it and the board silently falls back to a raw JSON dump. The
destination folder must be named `killer` to match `plugin.json`'s `gameId`; the UI is served from
`/plugins/killer/ui/`.

## Testing

```bash
cd ui && npm test
```

`ui/src/rules.test.mjs` covers the rules directly — number assignment and its determinism, the turn model
(including a visit that is both three darts and `ended`, and a four-dart visit whose last dart belongs to
the next player), killer/elimination rules, roster guards, event-key prefix stability under undo, and a
full 20-player match. No framework and no build step: `replay()` is a pure function whose only imports are
types, so Node's built-in type stripping loads `rules.ts` directly.

This project sits outside `Barrelo.slnx` and isn't part of `dotnet test`. Everything above the rules —
rendering, the postMessage boundary, animation — is verified by hand in the harness: a full match to a
winner, undo (mid-visit and straight after End turn), 2 / 20 / 1 / 21 player rosters, and the second-board
determinism check.
