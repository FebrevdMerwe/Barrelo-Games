# Territory

## 1. Overview

**Territory** is a competitive dartboard territory-control game built for Barrelo.

Players or teams compete to control the dartboard by expanding from a starting **Home** territory, defending territories with shields, and attacking opposing territories.

Each team starts with a strategically positioned Home territory. Territories can be expanded, defended, attacked and captured.

A team is eliminated when it loses **all of its territories**.

The last team remaining wins.

---

# 2. Core Concept

Each team starts with a **Home** territory.

Teams expand their territory by hitting adjacent neutral numbers.

Once two teams' territories touch, they can attack each other's territories.

Territories can be protected with up to **3 shield points**.

A territory must have its shields destroyed before it can be captured.

Doubles and triples count as multiple hits:

- Single = 1 hit
- Double = 2 hits
- Triple = 3 hits
- Bull = 1 hit

The game ends when only one team still controls territory.

---

# 3. Board

The dartboard consists of **21 territories**:

- Numbers 1–20
- Bull

Each territory can be:

- Neutral
- Owned by Team 1
- Owned by Team 2
- Owned by Team 3
- Owned by Team 4

Each owned territory has a shield level from **0–3**.

## The Territory Ladder

Every territory sits on a single ladder, and **every hit moves it exactly one rung**:

```text
unclaimed  →  claimed (0 shields)  →  1 shield  →  2 shields  →  3 shields
```

A hit moves the territory **up** the ladder when it is the thrower's own or nobody's, and **down**
the ladder when it belongs to an opposing team. The ladder runs the same way in both directions:
there is no rung that can be skipped and no rung that can be jumped over.

The rung below "claimed" is **unclaimed**, which is why a territory taken off an opposing team does
not become the attacker's on the same hit — it becomes neutral, and the next hit claims it.

---

# 4. Territory Adjacency

The numbered territories form a ring, and that ring is the **dartboard's own layout** — the order the
numbers physically sit in, clockwise from the top:

> 20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5

Each numbered territory is adjacent to the two territories whose wedges touch it on the board.

For example:

- 20 is adjacent to 5 and 1
- 11 is adjacent to 8 and 14
- 6 is adjacent to 13 and 10

Adjacency is therefore something a player can **see**: a team's territory grows as a visible arc, and
the two wedges at either end of that arc are where it can expand or attack next.

Numbers that are adjacent *numerically* are not adjacent in the rules — 1 does not touch 2.

The **Bull is adjacent to every numbered territory**.

Therefore, controlling the Bull provides access to every numbered territory on the board.

---

# 5. Starting Territories

Starting territories should be distributed so that the teams begin **evenly spaced around the board**.

The board should effectively be divided into equal sections based on the number of teams.

A starting territory is selected near the **centre of each team's section**.

"Evenly spaced" means evenly spaced **around the drawn board**, not evenly spaced in the numbers —
the teams must start visibly across from one another.

### Example: 2 Teams

The two starting territories should be opposite each other on the board: **6 and 11**, which sit at
three o'clock and nine o'clock.

### Example: 3 Teams

The starting territories should be approximately **120° apart**: **4, 3 and 14**.

### Example: 4 Teams

The starting territories should be **90° apart**: **18, 15, 7 and 9** — twelve, three, six and nine
o'clock.

No two starting territories may be adjacent, so the opening move of the game is always an expansion
into neutral ground rather than an attack.

The exact starting numbers should be calculated from the board layout rather than randomly selected.

The purpose is to ensure that every team starts with approximately the same amount of space available for expansion.

---

# 6. Home Territory

Each team's starting territory is its **Home**.

The Home territory:

- Is immediately owned by the team.
- Starts with 0 shields.
- Can be reinforced like any other owned territory.
- Can be attacked by opposing teams.
- Can be captured by opposing teams.
- Provides the team's initial starting point for expansion.

**Home has no permanent protection.**

Once the game begins, Home behaves exactly like a normal territory.

This means a team must defend its Home if an opponent reaches it.

---

# 7. Claiming Neutral Territory

A team may claim a neutral territory if it is directly adjacent to one of its existing territories.

To claim a territory, the player must hit its number.

### Example

Team Red owns:

> 11

The territories adjacent to 11 on the board are:

> 8 and 14

Red can therefore attempt to claim:

> 8 or 14

If Red hits single 8:

> Territory 8 becomes Red, with 0 shields.

Red's territory has now expanded, allowing it to continue expanding from 8 — which puts 16 (8's other
neighbour) in reach as well as 14.

### Claiming With a Multiplier

The first hit claims the territory and every remaining hit climbs the ladder as a shield.

| Dart into adjacent neutral ground | Result |
|---|---|
| Single | Claimed, **0 shields** |
| Double | Claimed, **1 shield** |
| Triple | Claimed, **2 shields** |

Example — Red throws D8 at neutral 8:

> unclaimed → Red, 0 shields → Red, 1 shield

---

# 8. Multiple Hits

The number of hits generated by a dart depends on where it lands.

| Dart | Hits |
|---|---:|
| Single | 1 |
| Double | 2 |
| Triple | 3 |
| Outer Bull | 1 |
| Bullseye | 1 |

For example:

- S12 = 1 hit
- D12 = 2 hits
- T12 = 3 hits

The multiplier applies to whichever action the dart is performing.

---

# 9. Shielding

Every owned territory can have between **0 and 3 shields**.

A team can increase the shields of one of its territories by hitting that territory.

### Example

Team Red owns 12 with 1 shield.

Red throws:

> D12

The territory receives 2 shield points.

Result:

> Shield 1 → Shield 3

The maximum shield level is 3.

Any hits beyond the maximum are discarded.

---

# 10. Attacking Enemy Territory

A team can attack an enemy territory when that territory is **directly adjacent to one of the team's territories**.

This means opposing territories must be touching before they can attack each other.

### Example

```text
Red → Red → Blue → Blue
```

The Red territory immediately next to Blue is a valid attack target.

A Red player can attack the Blue territory by hitting its number.

---

# 11. Breaking Shields

Enemy shields must be destroyed before a territory can be captured.

Each successful hit removes one shield point.

The multiplier of the dart determines how many shield points are removed.

### Example

Blue owns 12 with 2 shields.

Red throws:

> D12

D12 produces 2 hits.

Result:

> Shield 2 → Shield 0

The territory remains Blue but is now vulnerable.

---

# 12. Clearing an Unshielded Territory

Once an enemy territory has **0 shields**, the next hit takes it off its owner — and leaves it
**unclaimed**. It does not pass straight to the attacker.

### Example

Blue owns 12 with 0 shields.

Red throws:

> S12

Result:

> 12 becomes neutral territory. Nobody owns it.

Blue has lost the territory, and it counts against Blue for elimination immediately. Red must hit 12
again to claim it, exactly as it would claim any other neutral territory — and until it does, any
team adjacent to 12 may claim it instead.

### Taking It in One Dart

Because a multiplier is worth more than one hit, a single dart can clear the territory *and* claim
it:

| Dart into an adjacent enemy territory on 0 shields | Result |
|---|---|
| Single | Becomes **unclaimed** |
| Double | Becomes unclaimed, then **claimed by the attacker**, 0 shields |
| Triple | Becomes unclaimed, claimed by the attacker, then **1 shield** |

---

# 13. Excess Attack Damage

If an attack has more hits than required to destroy the remaining shields, the excess hits carry on
down the ladder — and then back up it.

### Example

Blue owns 12 with 1 shield.

Red throws:

> T12

T12 produces 3 hits.

The first hit destroys the shield.

The second hit clears the territory to unclaimed.

The third hit claims it for Red.

Result:

> Blue, 1 shield → Blue, 0 shields → unclaimed → Red, 0 shields

Any hits still left over after that become shields, capped at 3. Hits beyond the top of the ladder
are discarded.

---

# 14. Attacking With a Single

If an enemy territory has:

> Shield 3

and the attacker hits:

> S12

The result is:

> Shield 3 → Shield 2

The territory remains under enemy control.

---

# 15. Attacking With a Double

If an enemy territory has:

> Shield 2

and the attacker hits:

> D12

The result is:

> Shield 2 → Shield 0

The territory becomes vulnerable but is not taken.

The attacker must hit it again to clear it to unclaimed, and again after that to claim it — or take
both rungs at once with a double or better.

---

# 16. Attacking With a Triple

If an enemy territory has:

> Shield 1

and the attacker hits:

> T12

The first hit destroys the shield.

The second clears the territory to unclaimed, and the third claims it for the attacker.

Result:

> Enemy territory → unclaimed → Attacker territory, 0 shields

---

# 17. Hitting Non-Adjacent Territories

A team cannot directly claim or attack a territory that is not connected to its existing territory.

If a player hits a territory that is:

- Not owned by their team
- Not adjacent to their territory
- Not a valid attack target

the dart has **no effect**.

This prevents players from simply targeting any number on the board.

---

# 18. Hitting Your Own Territory

Players may hit their own territories to strengthen their defences.

If a player hits one of their own territories:

> The dart adds shields to that territory.

Example:

> Red owns 15 with Shield 1

Red throws:

> T15

Result:

> Shield 1 → Shield 3

The maximum remains 3.

Home territories can also be reinforced in exactly the same way.

---

# 19. Bull Territory

The Bull is a special territory.

It behaves like any other territory but is adjacent to **all 20 numbered territories**.

This means:

- A team can expand into the Bull if it is adjacent to their territory.
- A team controlling the Bull can potentially expand toward any numbered territory.
- The Bull can be attacked by an adjacent opponent.
- The Bull can have up to 3 shields.
- The Bull can be captured.

Both Outer Bull and Bullseye count as the Bull territory.

For the MVP:

- Outer Bull = 1 hit
- Bullseye = 1 hit

---

# 20. Turns

Each team gets **3 darts per turn**.

Each dart is processed immediately.

Example:

### Team Red

**Dart 1**

> S19

Claims territory 19.

**Dart 2**

> D12

Adds 2 shields to Red's 12.

**Dart 3**

> T3

Attacks the enemy's 3 territory.

After the third dart, the turn passes to the next team.

---

# 21. Team Elimination

A team is eliminated when it no longer controls any territories.

A team therefore loses when:

> **Territory Count = 0**

This includes its Home territory.

Home provides no special protection against elimination.

### Example

Red owns:

> Home 7, 8, 9

Blue captures:

> 8

Blue then captures:

> 7

Red still owns:

> 9

Red remains in the game.

If Blue subsequently captures:

> 9

Red has no territories remaining and is eliminated.

---

# 22. Capturing Home

Home can be captured exactly like any other territory.

If Home has shields:

> The shields must first be destroyed.

Once Home has 0 shields:

> The next successful attack clears it to unclaimed, and the hit after that claims it.

Home walks the same ladder as every other territory: a single takes it off its owner without taking
it for the attacker, while a double or a triple does both in the one dart.

The original team does not receive any special protection or replacement Home.

If a team loses its Home but still controls other territories, it remains in the game and can continue expanding and attacking.

---

# 23. Last Team Standing

The default victory condition is:

> **The last team with at least one territory wins.**

The game should immediately end when only one team remains with territory.

### Example

```text
Red:   8 territories
Blue:  6 territories
Green: 0 territories
Yellow: 7 territories
```

Green is eliminated.

The game continues.

Later:

```text
Red:   11 territories
Blue: 0 territories
Green: 0 territories
Yellow: 10 territories
```

Blue and Green are eliminated.

The game continues between Red and Yellow.

If Red captures Yellow's final territory:

> Red wins.

---

# 24. Turn Handling After Elimination

If a team is eliminated during its own turn, the turn immediately ends.

The next active team takes its normal turn.

Eliminated teams:

- No longer receive turns.
- Cannot attack.
- Cannot claim territory.
- Cannot shield territories.
- Are removed from the active player rotation.

---

# 25. Territory Rules Summary

| Situation | Result |
|---|---|
| Hit adjacent neutral territory | Claim it; further hits in the same dart become shields |
| Hit own territory | Add shields |
| Hit adjacent enemy territory with shields | Remove one shield per hit |
| Hit adjacent enemy territory with 0 shields | It becomes unclaimed; a further hit claims it |
| Double into adjacent neutral ground | Claimed with 1 shield |
| Triple into adjacent neutral ground | Claimed with 2 shields |
| Double into an unshielded enemy territory | Cleared and claimed in the one dart |
| Hit non-adjacent enemy territory | No effect |
| Hit non-adjacent neutral territory | No effect |
| Hit own territory at 3 shields | No additional effect |
| Hit Home territory | Add shields |
| Enemy attacks Home | Home is cleared and can then be claimed |
| Lose all territories | Team eliminated |
| Single | 1 hit |
| Double | 2 hits |
| Triple | 3 hits |
| Bull | 1 hit |

---

# 26. Win Condition

The game uses **last team standing** as its default victory condition.

A team wins when:

> It is the only remaining team with one or more territories.

There is no fixed territory target.

This means the game naturally progresses from:

**Expansion → Conflict → Territory Loss → Elimination → Final Battle**

---

# 27. Optional Match Length

**Implemented.** The `matchLength` setting (`plugin.json`) offers:

- Unlimited (default)
- 10 rounds
- 15 rounds
- 20 rounds

If the maximum number of rounds is reached before elimination occurs, the team controlling the most territories wins.

Ties are broken first by shields banked across the tied teams' territory, then by seat order — an
arbitrary but fixed and deterministic last resort, so a genuine tie resolves the same way on every
replay. See `maxRoundsFor()` and `rankSurvivors()` in `ui/src/rules.ts`.

The MVP used **unlimited rounds / last team standing**, which remains the default.

---

# 28. Game State

The game should maintain the following state for each territory:

```typescript
interface Territory {
  id: string;
  ownerId: string | null;
  shield: number;
  isHome: boolean;
}
```

The game should also maintain:

```typescript
interface Team {
  id: string;
  name: string;
  colour: string;
  homeTerritoryId: string;
  territoryCount: number;
  isEliminated: boolean;
}
```

`isHome` identifies the team's original starting territory but does not provide any special protection.

---

# 29. MVP Scope

The first version should implement only the following.

### Game setup

- 2–4 teams
- Evenly spaced starting territories
- Starting territories positioned near the centre of each team's section
- Home territories can be captured

### Territory system

- 20 numbered territories
- Bull territory
- Neutral / owned states
- 0–3 shields
- Territory adjacency
- Home territory tracking

### Actions

- Claim adjacent neutral territory
- Shield friendly territory
- Attack adjacent enemy territory
- Destroy shields
- Capture enemy territory
- Capture Home territory
- Eliminate teams with no territories

### Dart scoring

- Single = 1 hit
- Double = 2 hits
- Triple = 3 hits
- Bull = 1 hit

### Game flow

- 3 darts per turn
- Immediate state updates
- Team elimination
- Victory detection
- Eliminated teams removed from turn rotation

### Victory

- Last team with at least one territory wins

---

# 30. Future Features

The following should **not** be part of the initial MVP but can be added later.

### Special territories

- Double-value territories
- Triple-value territories
- Fortresses
- Resource territories

### Special attacks

- Bombs
- Siege attacks
- Steal attacks
- Territory swaps

### Power-ups

- Extra dart
- Double damage
- Shield regeneration
- Territory freeze

### Game modes

- Timed games
- Limited rounds
- King of the hill
- Team elimination
- Last territory standing

### Visual effects

- Territory expansion animations
- Shield breaking animations
- Attack animations
- Capture animations
- Elimination animations
- Territory ownership map
- Battle/front-line indicators
- Victory animation

---

# 31. Barrelo Integration

The game should be implemented as a Barrelo game.

Barrelo provides the game with detected dart events, while the Territory game is responsible for interpreting those events according to the Territory rules.

The game should not contain camera or dart-detection logic.

Conceptually:

```text
Camera
   ↓
Dart Detection
   ↓
Barrelo
   ↓
Dart Event
   ↓
Territory Game
   ↓
Game State
   ↓
TV / Game UI
```

The game should therefore remain completely independent of the hardware used to detect the darts.

---

# 32. Design Goals

### Easy to understand

A new player should understand the basic rules within one minute.

### Easy to play

Players should only need to understand:

> Expand → Defend → Attack → Capture

### Strategic

Players should have meaningful choices between:

- Expanding
- Strengthening territory
- Attacking opponents
- Protecting vulnerable territories
- Protecting their remaining territory from elimination

### Visually engaging

The TV display should make territory ownership immediately obvious.

### Fast paced

Every dart should have a visible consequence whenever possible.

### Beginner friendly

Players should not need to understand complex scoring systems.

### Replayable

Different starting positions, team counts and battle fronts should create different games.

---

# 33. Core Gameplay Loop

```text
START GAME
    ↓
Determine number of teams
    ↓
Divide board into equal sections
    ↓
Assign centre territory of each section as Home
    ↓
Teams take turns
    ↓
Throw dart
    ↓
Determine territory + multiplier
    ↓
┌───────────────────────────┐
│                           │
│ Neutral + adjacent        │ → Claim
│                           │
│ Own territory             │ → Shield
│                           │
│ Enemy + adjacent          │ → Attack
│                           │
│ Invalid target            │ → No effect
│                           │
└───────────────────────────┘
    ↓
Update territory
    ↓
Check for team elimination
    ↓
Check victory
    ↓
Next dart
    ↓
Next active team
    ↓
Repeat
```

# 34. Success Criteria for MVP

The MVP is complete when:

- A 2–4 team game can be started.
- Teams receive evenly spaced Home territories.
- Home territories are positioned approximately equidistant around the board.
- Home territories can be captured.
- Players can claim adjacent neutral territories.
- Players can reinforce their own territories.
- Territories support 0–3 shields.
- Players can attack adjacent enemy territories.
- Shields must be destroyed before capture.
- Doubles and triples apply 2× and 3× hits.
- The Bull works as a special central territory.
- Teams are eliminated when they lose all territories.
- Eliminated teams are removed from the turn rotation.
- The game detects the final surviving team.
- The current game state can be rendered on the Barrelo game display.
- All game logic is independent of the dart-detection implementation.