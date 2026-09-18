# Zombie Horde — Game Scope

## 1. Overview

**Zombie Horde** is a cooperative, turn-based zombie survival game for **2–6 players** using a
camera-tracked dartboard.

Players work together to defend a safehouse against increasingly dangerous waves of zombies. Each player
gets **3 darts per turn**, following the traditional darts format.

The game uses the **dartboard's numbers and scoring rings** as the primary game mechanic rather than
requiring players to aim at virtual targets on the TV.

### Core objective

> **Work together to survive as many zombie waves as possible before the safehouse is destroyed.**

### Companion documents

- **Zombie Horde — Power-Up System.md** — the power-up layer. It is **post-MVP**: none of it ships in the
  first playable version (see §21).
- **README.md** — how this game plugs into Barrelo, and where the code goes.

---

## 2. How the match maps onto Barrelo

Barrelo is a team platform: a match is N teams, and the host collects a team assignment before the match
starts. Zombie Horde is cooperative, so it is **one team of 2–6 players** — a single group of survivors
defending a single safehouse.

`plugin.json` therefore declares:

```json
{
  "minPlayers": 2,
  "settings": [
    { "kind": "playerGroup", "key": "teams", "displayName": "Survivors",
      "maxGroups": 1, "maxPlayersPerGroup": 6 }
  ]
}
```

Consequences worth stating plainly, because they shape the rules:

- **Turn order is the roster order within that one team.** Barrelo's rotation gives one visit per team per
  round; with a single team, that is exactly "each survivor throws in turn".
- **There is no opposing side and no individual winner.** Nothing is scored per player.
- **The match always ends in defeat** — the safehouse falls eventually. On defeat the game reports
  **every player** in both `winnerPlayerIds` and `finalStandings`, so the whole group is credited with the
  run and each member earns session-leaderboard points. The team survived together; they are ranked
  together.
- **Solo is not offered.** `minPlayers: 2` — the game is built around players talking to each other about
  which zombie to take.

### Determinism — this constrains the rules

Barrelo keeps the log of darts and nothing else. **Every screen showing the match replays that log
independently** — the control tablet, the TV, any tab refreshed mid-match — and they only agree if
replaying the same log always produces the same state. Undo works the same way: Barrelo shortens the log
and every screen re-derives from scratch.

So the entire game state — wave number, every zombie's position and health, safehouse HP, power-up
inventory, score — is a **pure function of (seed, options, visit log)**. Nothing accumulates between
pushes. In practice:

| Tempting | Actually required |
|---|---|
| A wall-clock survival timer | Derive from `detectedAtUtc` of the first and last dart in the log |
| "10% chance when a zombie dies" | Draw from `rng(payload.seed)`, advanced by a log-derived counter |
| "At least 30 seconds between X" | Count throws, turns or waves — real time is not available |
| Incrementing safehouse HP as darts arrive | Recompute HP from the whole log on every push |

Any "configurable" value in this document is either a **constant in the code** or a **declared setting in
`plugin.json`** (arriving in `payload.options`). It can never be a mid-match toggle, because a toggle is
not in the log.

---

## 3. Core Game Loop

The game is played in rounds. Each player gets one turn consisting of **3 darts**. When every player has
thrown, the surviving zombies move — **once per round, not once per player**.

```text
ROUND
  ├── Player 1 — dart, dart, dart
  ├── Player 2 — dart, dart, dart
  ├── Player 3 — dart, dart, dart
  └── Zombies move  ← once, after the whole round
        ↓
      NEXT ROUND
```

Movement is per round rather than per player so that **wave difficulty does not depend on roster size**.
Moving after each player's turn would give the zombies three times as many steps in a 6-player game as in
a 2-player one, while the wave tables in §10 stayed the same — the same wave would be gentle at 2 players
and unplayable at 6.

A round also ends early, the instant the last zombie in the active wave dies — nobody has to throw at an
empty board waiting for the rotation to come back around. See §10.

```text
ROUND
  ├── Player 1 — dart, dart, dart
  ├── Player 2 — dart kills the last zombie
  └── Zombies move  ← no zombies left, so this is a no-op; the next wave spawns right away
        ↓
      NEXT ROUND  ← Player 3 opens it, rotation unbroken
```

Either way — full rotation or early clear — movement only ever happens once per round, so the §19 pacing
math still holds: it is a no-op against an empty board, never an extra step for a wave that is still up.

The cycle continues until the safehouse is destroyed.

---

## 4. Players

- Minimum: **2 players**
- Maximum: **6 players**
- Each player receives **3 darts per turn**
- Players share the same safehouse and work toward the same objective
- There is no individual winner
- The entire group wins or loses together

More players means more darts per round, which is the intended reward for a bigger group — wave sizes do
**not** scale with player count (see §19 for why, and what to do if playtesting disagrees).

---

## 5. Dart Mechanics

The game uses the standard dartboard scoring system.

Every detected dart provides: number/segment hit, ring hit, score, player, and throw order.

### Damage

The score multiplier determines the damage dealt when the correct number is hit.

| Dart | Damage |
|---|---:|
| Single 18 | 1 |
| Double 18 | 2 |
| Triple 18 | 3 |
| Miss / wrong number | 0 |

For example, a zombie requiring `3 × 18` can be killed with:

- `S18 + S18 + S18`
- `D18 + S18`
- `T18`

A `T18` therefore provides a satisfying opportunity to instantly kill a zombie requiring up to 3 damage.

### Ring mapping

Barrelo's wire format has three single-ish rings. All of them are one damage:

| Wire ring | Damage multiplier |
|---|---:|
| `Single`, `InnerSingle`, `OuterSingle` | 1 |
| `Double` | 2 |
| `Triple` | 3 |
| `Miss` | 0 |

The bullseye is **segment 25**: `25/Double` is the bull (50 points), `25/Single` is the outer bull (25
points). Both are handled by §12, not by the table above.

---

## 6. Zombie Targets

Each zombie has a **required number** and **health**, written `health × number`.

```text
🧟
2 × 18
```

That zombie requires **2 damage delivered through the 18 segment**. A player hitting S18 deals 1, D18
deals 2, T18 deals 3. Hits on any other number deal nothing to it.

### Which zombie takes the damage

Several zombies can require the same number, so the rule is fixed and automatic — **players never nominate
a target**:

1. Consider only zombies whose required number matches the segment hit, and whose ring restriction, if
   any, is satisfied (see Armoured and Mutant in §7).
2. Damage the one **closest to the safehouse**. It is the most urgent threat, and it makes the TV's
   warning in §16 actionable.
3. Ties — two zombies the same distance away — break by **spawn order, oldest first**, so the result is
   deterministic on every screen.
4. **Overkill carries.** Damage beyond a zombie's remaining health spills onto the next-closest matching
   zombie, and keeps spilling until the damage runs out or no matching zombie remains.

Example — a `T18` (3 damage) thrown at:

```text
🧟 1 × 18  (space 1)     🧟 2 × 18  (space 3)

T18 → 3 damage
  ├── 1 damage kills the closest        💀
  └── 2 damage carries to the next      💀
```

Both die on one dart. This is why a triple always feels worth throwing, and it is the single most
important rule to get right — the alternative, wasting the overkill, makes the best dart in the game feel
bad.

Damage on a segment no living zombie requires is simply lost. There is no partial credit and no "charging
up" a number.

---

## 7. Zombie Types

| Type | Health | Movement | Ring restriction | Notes |
|---|---:|---:|---|---|
| Walker | 2 | 1 | — | Basic enemy |
| Runner | 1 | 2 | — | Fragile, but reaches the safehouse fast |
| Tank | 5 | 1 | — | Soaks a whole turn's darts |
| Swarm | 1 | 3 | — | Spawns in groups; fastest thing on the board |
| Armoured | 4 | 1 | `Double` only | Singles and triples deal 0 |
| Mutant | 3 | 1 | `Triple` only | One matching triple kills it outright |
| Boss | 10+ | 1 | — | Wave intervals only; see §11 |

Health is written `health × number` on the TV, so an Armoured zombie on 12 reads `4 × D12` and a Mutant on
19 reads `3 × T19` — the ring prefix is the restriction, not the damage.

### Ring restrictions

A restricted zombie takes damage **only** from its named ring, and that ring still deals its normal
multiplier:

```text
🪖 ARMOURED   4 × D12

S12 → 0 damage   (wrong ring)
T12 → 0 damage   (wrong ring)
D12 → 2 damage   ✓
```

So an Armoured zombie needs two doubles, and a Mutant dies to a single triple (3 damage against 3 health).
Restricted zombies are skipped entirely by the targeting rule in §6 when the ring doesn't match — an `S12`
passes straight over an Armoured 12 to any unrestricted 12-zombie behind it.

### Examples

```text
🧟   2 × 6        🏃🧟  1 × 20        🧟  5 × 18
Walker            Runner              Tank
```

---

## 8. Zombie Movement

After every player has thrown — once per round, see §3 — each surviving zombie advances toward the
safehouse by its movement value.

The approach is a track of **6 spaces**. Zombies spawn at space 6; the safehouse sits at space 0.

```text
🧟 → 🧟 → 🧟 → 🏠
 3    2    1    0
```

A zombie reaching space 0 attacks the safehouse and is then removed from the board — it does not linger
and it does not attack twice. A Runner spawning at 6 therefore has three rounds of life before it lands; a
Walker has six.

Movement values are per type (§7) and are constants, tunable after playtesting.

---

## 9. Safehouse

The players defend a shared safehouse with **5 health**.

```text
🏠
❤️❤️❤️❤️❤️
```

When a zombie reaches it:

| Zombie | Damage to safehouse |
|---|---:|
| Walker, Runner, Swarm, Armoured, Mutant | 1 |
| Tank | 2 |
| Boss | 3 |

```text
❤️❤️❤️❤️❤️
     ↓  (Walker lands)
❤️❤️❤️❤️
```

The zombie is removed after attacking.

### Game Over

The game ends when safehouse HP reaches **0**. The whole team loses — and, per §2, the whole team is still
reported to Barrelo as the run's participants, so everyone is credited.

---

## 10. Waves

Zombies are organised into waves. A wave spawns all at once, at space 6.

| Wave | Contents |
|---|---|
| 1 | 3 Walkers |
| 2 | 4 Walkers, 1 Runner |
| 3 | 5 Walkers, 2 Runners |
| 4 | 5 Walkers, 2 Runners, 1 Tank |
| 5 | **Boss** |
| 6+ | Generated — see below |

From wave 6 the composition is generated from the wave number using `rng(seed)`, drawing more and tougher
types as the number climbs. Because the draw comes from the seeded RNG, every screen generates the
identical wave, and the same seed replays the same run.

### Wave transition

A wave is cleared the moment the last zombie in it dies. **The next wave spawns at the start of the next
round** — which arrives right away: the current thrower's own turn finishes out normally (their remaining
darts, if any, simply have nothing left to hit), but the round then ends there rather than waiting for the
rest of the rotation to take empty turns. The team doesn't get a breath between waves; play continues with
whoever is up next, now facing the new wave.

Early waves are deliberately gentle. As waves increase: more zombies spawn, health rises, faster types
appear, and bosses get stronger.

---

## 11. Boss Waves

Every **5th wave** is a boss wave. The boss spawns alone.

```text
WAVE 5

        🧟‍♂️
       BOSS

      10 × 20
```

Bosses introduce special mechanics, added progressively rather than all at once:

- **The Brute** — very high health, nothing else. The first boss, and the only one in scope for early
  builds. (Named to avoid a collision with the Tank *zombie type* in §7.)
- **The Necromancer** — revives one defeated zombie per round.
- **The Swarm Mother** — spawns a Swarm zombie each round.
- **The Runner King** — movement 3.

Bosses are **post-MVP** (§21).

---

## 12. The Bullseye

The bullseye is not a normal number, and it is the **only** owner of the two bull targets — nothing else in
the game, including power-ups, may claim them.

| Target | Wire value | Effect |
|---|---|---|
| **Bull** (50) | segment 25, ring `Double` | **Critical Hit** — 5 damage to the zombie closest to the safehouse, regardless of its required number or ring restriction |
| **Outer bull** (25) | segment 25, ring `Single` | **Freeze** — zombies do not move at the end of this round |

Critical Hit ignores ring restrictions on purpose: it is the answer to an Armoured zombie nobody can hit,
and it gives a player with no useful number left something to aim at. Overkill from a Critical Hit carries
under the same rule as §6.

Both effects are constants, tunable after playtesting.

---

## 13. Player Turn

The TV should clearly communicate whose turn it is.

```text
┌─────────────────────────────┐
│                             │
│       PLAYER 2              │
│                             │
│       🎯 🎯 🎯              │
│       3 DARTS               │
│                             │
│       Throw 1 of 3          │
│                             │
└─────────────────────────────┘
```

After each detected dart, the UI updates immediately.

```text
PLAYER 2

Dart 1: D18
Dart 2: T6
Dart 3: ?

Zombies killed: 2
```

The turn indicator, the dart 1/2/3 slots and greyed-out targets in Barrelo's own chrome are driven by the
`barrelo:display` message the board sends up — the host does not know whose turn it is.

---

## 14. Zombie Health Display

Zombie health should be visually obvious. The player should never need to mentally calculate health.

```text
🧟          🧟          💥
18          18          DEAD
❤️❤️        ❤️
            ↑ after S18  ↑ after a second S18
```

Distance to the safehouse must be as readable as health — it is what the targeting rule in §6 keys on, so
players need to see which zombie their dart is going to hit.

---

## 15. Score

The run's score, shown at game over and used for the team's own leaderboards:

```text
score = (zombies killed × 10)
      + (waves cleared × 100)
      + (safehouse HP remaining × 50)
```

It is derived from the log like everything else, so it is identical on every screen. Note that Barrelo's
session leaderboard is awarded from `finalStandings` order, not from this number — this score is Zombie
Horde's own metric, for the game-over screen and for the "beat our last run" goal.

---

## 16. Target Prioritisation

The game should encourage players to communicate and make decisions. The TV should visually highlight
important threats.

```text
⚠️ RUNNER WILL REACH THE SAFEHOUSE NEXT TURN
```

Since damage lands on the closest matching zombie automatically (§6), the decision players actually make
is **which number to throw**, not which zombie to pick. That is the intended shape of the strategy:

> "I'll take the 20 — that runner lands next round."

> "You keep chipping the tank on 18."

> "I'm going for the triple."

---

## 17. Game End

When the safehouse reaches zero health:

```text
💀 SAFEHOUSE DESTROYED 💀

WAVE 18

SURVIVAL TIME
24:37

ZOMBIES KILLED
428

TEAM SCORE
12,450
```

**Survival time is derived from the log** — `detectedAtUtc` of the last dart minus the first — never from a
running clock (§2).

There is no victory condition: the run ends when the safehouse falls, and the goal is to beat the team's
previous best. Leaderboard metrics: highest wave, longest survival time, zombies killed, highest team
score.

---

## 18. Deferred features

These are wanted, but not until the core has been playtested. None of them should be built before §21 is
complete and played.

- **Power-ups** — the whole of *Zombie Horde — Power-Up System.md*.
- **Team combos** — consecutive successful hits build a combo for bonus damage or safehouse healing. Needs
  a definition of "consecutive" (across players? does a miss reset it?) before it can be specced.
- **Between-wave upgrades** — the team picks one of several upgrades after each wave, voting with darts.
  Needs a deterministic vote-resolution rule.
- **Special events** — Power Outage, Supply Drop, Blood Moon, Zombie Swarm, Safehouse Breach.
- **Headshots as instant kills** — in the MVP a Triple simply deals 3 damage (§5). Instant-kill triples
  arrive with the power-up system, which is where the name "Headshot" lives; the two must not both exist.

---

## 19. Difficulty

Difficulty scales through: zombie count, zombie health, movement speed, zombie types, spawn frequency,
boss difficulty, and later special events.

It deliberately does **not** scale with player count. A 6-player group gets three times the darts of a
2-player group against the same wave, and that is the reward for filling the roster. If playtesting shows
big groups trivialising early waves, the lever to reach for is wave size as a function of player count —
but add it only once the base curve is right, since it makes every wave table conditional.

The game should remain playable by beginners while giving experienced players something to reach for.

---

## 20. Constants

Every tunable value in one place. All are constants in code unless promoted to a declared `plugin.json`
setting (§2) — none can change mid-match.

| Value | Default | Reference |
|---|---:|---|
| Players | 2–6 | §4 |
| Darts per turn | 3 | §4 |
| Safehouse health | 5 | §9 |
| Track length | 6 spaces | §8 |
| Movement phase | once per round | §3 |
| Walker | 2 HP, move 1 | §7 |
| Runner | 1 HP, move 2 | §7 |
| Tank | 5 HP, move 1, 2 damage to safehouse | §7, §9 |
| Swarm | 1 HP, move 3 | §7 |
| Armoured | 4 HP, move 1, Double only | §7 |
| Mutant | 3 HP, move 1, Triple only | §7 |
| Boss interval | every 5 waves | §11 |
| Boss damage to safehouse | 3 | §9 |
| Bull (50) Critical Hit | 5 damage | §12 |
| Outer bull (25) Freeze | 1 movement phase | §12 |
| Score per kill / wave / HP left | 10 / 100 / 50 | §15 |

---

## 21. MVP Scope

The first playable version should intentionally be small.

### Required

- 2–6 players in one co-op team, turn management, 3 darts per player
- Dart detection through Barrelo, standard segment/ring detection
- Zombie spawning, health, number-based weaknesses, movement
- The targeting rule in §6, including overkill carry
- Safehouse health and the game-over condition
- Waves 1–4 from the table in §10, then a simple generated continuation
- Basic TV UI: whose turn, zombie health, zombie distance, safehouse HP, wave number
- The score in §15
- Basic sound effects

### Initial zombie types

Only **Walker**, **Runner** and **Tank**. Swarm, Armoured, Mutant and bosses come later.

### Initial special mechanics

- Single = 1 damage, Double = 2, Triple = 3
- Bull = Critical Hit, Outer bull = Freeze (§12)

Everything in §18 stays out until the core has been played.

---

## 22. Design Philosophy

### Easy to understand

A new player should understand the objective within **30 seconds**.

> "Kill the zombies by hitting the number above them."

### Fun with normal darts

Players should feel like they are playing darts rather than controlling a video game with an awkward input
device.

### Teamwork over precision

A beginner should be able to contribute. An experienced player should have opportunities to make
spectacular plays through doubles, triples and bullseyes.

---

## 23. Example Session

Four players start a game. Safehouse at 5 HP, track of 6 spaces.

### Wave 1 — 3 Walkers (§10)

```text
🧟 2×6 (space 6)    🧟 2×20 (space 6)    🧟 2×18 (space 6)

                 🏠
                ❤️❤️❤️❤️❤️
```

### Player 1

```text
D6  → 2 damage → Walker (6) killed         💀
D20 → 2 damage → Walker (20) killed        💀
S18 → 1 damage → Walker (18) on 1 HP
```

### Player 2

Opens with `T18` — 3 damage into a 1 HP Walker. One damage kills it; the overkill carries, but no other
18-zombie is on the board, so the remaining 2 are lost. The wave is clear.

Player 2's other two darts hit nothing — the board is empty. But the round doesn't wait for players 3 and 4
to also throw at nothing: once Player 2's own turn is over, the round ends right there (§10).

### Zombies move

Nothing is left to move — a no-op, since there's nothing left on the board.

### Wave 2 — 4 Walkers, 1 Runner

Spawns immediately, and it's Player 3's turn to open it. The Runner is at space 6 with movement 2, so it
lands on the safehouse in three rounds unless someone takes it down.

The group continues until the safehouse is eventually destroyed. Their goal is now:

> **Beat their previous highest wave.**
