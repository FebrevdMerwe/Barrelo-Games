# Dart Pool — Scope

## 1. Overview

**Dart Pool** is a virtual 8-ball pool game controlled entirely through a camera-tracked dartboard.

Instead of using a mouse, keyboard, touchscreen, or physical pool cue, players use **three darts to construct a single pool shot**.

The game progressively introduces the mechanics depending on difficulty:

- **Beginner:** Direction
- **Intermediate:** Direction + Power
- **Advanced:** Direction + Power + Spin

The goal is to make pool accessible to people who may have never played pool before while still providing meaningful depth for experienced players.

---

# 2. Core Concept

Each pool shot is created using up to three darts.

The darts are interpreted differently depending on the selected difficulty.

| Difficulty   | Dart 1            | Dart 2                       | Dart 3                       |
| ------------ | ----------------- | ---------------------------- | ---------------------------- |
| Beginner     | Direction attempt | Direction attempt            | Direction attempt / fallback |
| Intermediate | Direction attempt | Direction attempt / fallback | Power                        |
| Advanced     | Direction         | Power                        | Spin                         |

The table shows the longest sequence. **A shot fires as soon as its inputs are complete**, so a player who hits the recommended number early uses fewer darts (see §23).

The resulting values are converted into a virtual pool shot.

The player then watches the physics simulation resolve the shot.

The fundamental gameplay loop is:

```text
Throw darts
    ↓
Game interprets dart inputs
    ↓
Build pool shot
    ↓
Display shot preview
    ↓
Execute shot
    ↓
Resolve pool physics
    ↓
Update table
    ↓
Next turn
```

---

# 3. Game Mode

## 3.1 Primary Mode

The initial game mode is **8-Ball Pool**.

Every match is played between **exactly two teams** (§3.2).

- **1v1:** two one-person teams.
- **Teams:** two teams of up to four players each.

The game uses:

- 7 solid balls
- 7 striped balls
- 1 eight-ball
- 1 cue ball

Teams are assigned either solids or stripes during the game.

## 3.2 Teams

### Strict two-team format

The game always has two teams, **Team 1** and **Team 2**. There is no separate 1v1 code path: a 1v1 match is two teams of one player, replayed by exactly the same rules.

Keeping one path means 1v1 can never drift out of step with team play.

### Barrelo setup

Teams come from Barrelo's start screen through a `playerGroup` setting, which arrives as `payload.playerGroups` (group index `0` = Team 1, `1` = Team 2). Difficulty is a `gameMode` setting.

```json
{
  "protocolVersion": 2,
  "gameId": "dart-pool",
  "displayName": "Dart Pool",
  "stateOwner": "client",
  "settings": [
    {
      "kind": "playerGroup",
      "key": "teams",
      "displayName": "Teams",
      "minGroups": 2,
      "maxGroups": 2,
      "maxPlayersPerGroup": 4
    },
    {
      "kind": "gameMode",
      "key": "difficulty",
      "displayName": "Difficulty",
      "defaultValue": "beginner",
      "choices": [
        { "value": "beginner", "displayName": "Beginner", "options": { "difficulty": "beginner" } },
        { "value": "intermediate", "displayName": "Intermediate", "options": { "difficulty": "intermediate" } },
        { "value": "advanced", "displayName": "Advanced", "options": { "difficulty": "advanced" } }
      ]
    }
  ]
}
```

Difficulty applies to the whole match, for both teams.

### Team composition

- A match needs at least two players, and each team must have at least one.
- Teams may be uneven (e.g. 2v1). Each team rotates through its own players independently.
- Within a team, player order is the order of `payload.playerIds`.

Barrelo's start screen should enforce exactly two non-empty groups. The rules still derive teams defensively, so a malformed payload never breaks the replay:

1. Players with group `0` or `1` join that team.
2. Any other player (no group, or another index) joins the team with fewer players, Team 1 on a tie, in `playerIds` order.
3. If a team is still empty, the last player of the other team moves across.

This is the one place `playerGroups` is read. Everything else in the rules is keyed by team, never by player.

### Terminology

Throughout this document:

- **Team:** one of the two sides. Groups (solids/stripes), turns, fouls, ball in hand, wins and losses belong to teams.
- **Shooter:** the team member currently at the board.
- **Opponent:** the other team.

### Rotation

A team's **turn** (inning) is the run of consecutive shots it takes until the turn passes (§16.4).

- One team member shoots the whole turn. While the team keeps pocketing, the same player keeps shooting.
- When the team's next turn begins, the next team member in rotation shoots, wrapping around.
- The rotation does not reset after fouls; ball in hand is taken by whoever is next.
- In 1v1, the rotation always selects the same player.

Example with Team 1 = A, C and Team 2 = B:

```text
Team 1 turn → A (pots, pots, misses)
Team 2 turn → B (misses)
Team 1 turn → C (misses)
Team 2 turn → B
Team 1 turn → A
```

The rules report the shooter to Barrelo as the current player.

---

# 4. Objective

The objective is to:

1. Clear all balls from the team's assigned group.
2. Legally pocket the 8-ball.

The first team to legally pocket the 8-ball after clearing its group wins. Every member of that team wins.

## 4.1 Match Result

When the match ends, the game reports the result to Barrelo once:

- `winnerPlayerIds`: every member of the winning team.
- `finalStandings`: the winning team's members, then the losing team's members, each in `playerIds` order.

Team members are consecutive in the standings and share their team's placing.

---

# 5. Difficulty Levels

The difficulty system changes how much control the player has over the pool shot.

The underlying pool physics remain the same.

---

# 6. Beginner Mode

## 6.1 Purpose

Beginner mode is designed for players who:

- Have never played virtual pool.
- Have never played pool before.
- Are unfamiliar with cue-ball control.
- Want the simplest possible experience.

The player only controls **direction**.

Power and spin are automatically selected by the game.

---

## 6.2 Direction Target

Before the player begins their shot, the game identifies a recommended direction and displays the corresponding dartboard number.

Example:

```text
🎯 AIM FOR

     5
```

The player does not need to understand angles.

They simply need to throw at the displayed number.

The recommended number is the dartboard segment whose direction (in the table-fixed frame, §11.1) is closest to the recommended shot's exact aim angle.

---

## 6.3 Three Direction Attempts

The player receives **three darts** to hit the recommended number.

Example:

```text
Recommended: 5

Dart 1 → 7 ❌
Dart 2 → 18 ❌
Dart 3 → 5 ✅
```

Dart 3 successfully hits the target.

Therefore:

```text
Direction = Dart 3
```

---

## 6.4 Successful Target Hit

If the player hits the recommended number, that dart determines the shot direction.

The **first successful hit** is used.

Example:

```text
Dart 1 → 5 ✅
Dart 2 → 8
Dart 3 → 12
```

Direction is determined by Dart 1.

The player is rewarded immediately for finding the correct target.

### Snap to the exact aim angle

A successful hit fires the shot at the **recommender's exact aim angle**, not at the dart's actual position.

A segment is 18° wide, while a pot typically needs ±1–2° accuracy. The number is a proxy for the exact angle; using the dart's position within the segment would miss most pots and defeat the purpose of the assist.

### Shot fires immediately

In Beginner mode, the shot fires as soon as the target is hit. Any remaining darts in the visit are ignored.

In the example above, Dart 1 fires the shot and Darts 2 and 3 have no effect.

---

## 6.5 Missing the Target

If all three darts miss the recommended number, the third dart becomes the fallback direction.

Example:

```text
Recommended: 5

Dart 1 → 7 ❌
Dart 2 → 18 ❌
Dart 3 → 12 ❌
```

Direction is determined by the **actual position of Dart 3**, converted to an angle exactly as in Advanced mode (§11).

This guarantees that every three-dart sequence produces a valid pool shot.

A dart classified as a miss still has a position and is used the same way. Under manual entry, Barrelo pins every miss to straight up (towards 20).

---

## 6.6 Automatic Power

The player has no power control.

The game automatically selects a sensible power level based on the recommended shot.

Power should be selected to produce a forgiving and playable result.

Initial algorithm:

- Estimate the distance the cue ball travels to the object ball plus the distance the object ball travels to the pocket.
- Choose the power that carries the object ball past the pocket by a configurable safety margin.
- Clamp between the power floor (§8) and a configurable Beginner maximum.
- On the break, use a configurable Beginner break power.

The same automatic power is used for fallback shots.

The exact power algorithm is configurable.

---

## 6.7 Automatic Spin

The player has no spin control.

Spin defaults to:

```text
No spin
```

Future versions may introduce automatic spin assistance.

---

# 7. Intermediate Mode

## 7.1 Purpose

Intermediate mode introduces power while retaining direction assistance.

The player controls:

- Direction
- Power

The game still displays a recommended direction number.

---

## 7.2 Direction Attempts

The player receives **two darts** to hit the recommended number.

Example:

```text
Recommended: 5

Dart 1 → 7 ❌
Dart 2 → 5 ✅
```

Direction is determined by Dart 2.

---

## 7.3 Successful Target Hit

If either dart hits the recommended number, the **first successful dart** determines the direction.

Example:

```text
Dart 1 → 5 ✅
Dart 2 → 7 ❌
```

Direction:

```text
Dart 1
```

As in Beginner mode, a successful hit snaps to the recommender's exact aim angle (§6.4).

Once direction is locked by a hit, the **next dart is the power dart**. In the example above, Dart 2 is power and Dart 3 is ignored.

---

## 7.4 Direction Fallback

If both darts miss the recommended number, Dart 2 determines the direction from its actual position, converted as in §11.

Example:

```text
Recommended: 5

Dart 1 → 7 ❌
Dart 2 → 12 ❌
```

Direction:

```text
Dart 2 position
```

This ensures the player can always complete the shot.

---

# 8. Intermediate Power

The dart thrown after direction is locked determines power: Dart 2 if Dart 1 hit the target, otherwise Dart 3.

The player throws at a number from **1–20**.

Higher numbers produce greater power.

Example:

```text
Dart 3 → 5

Power = low
```

```text
Dart 3 → 14

Power = medium/high
```

```text
Dart 3 → 20

Power = maximum
```

Power mapping should be configurable.

Recommended initial mapping:

```text
Power = max(power floor, dart number / 20)
```

The ring (single, double, triple) does not affect power.

Therefore, with the default power floor of 15%:

| Dart         | Power |
| -----------: | ----: |
|            1 |   15% |
|            5 |   25% |
|           10 |   50% |
|           15 |   75% |
|           20 |  100% |
| Bull (25/50) |   50% |
|         Miss |   15% |

- **Power floor:** configurable, default 15%, prevents shots too weak to reach anything.
- **Bull:** configurable, default 50%. The hardest target gives an exact medium shot rather than a penalty.
- **Miss:** the power floor. Every dart still produces a shot, but a missed power dart is a weak one.

100% power corresponds to a configurable maximum cue speed, tuned so that 100% is a full-strength break.

This mapping is shared by Intermediate and Advanced power.

---

# 9. Intermediate Spin

Spin is automatically selected.

Default:

```text
No spin
```

The player does not need to understand spin to play Intermediate mode.

---

# 10. Advanced Mode

## 10.1 Purpose

Advanced mode gives the player complete control over the three major components of a pool shot.

The three darts have fixed roles:

```text
Dart 1 → Direction
Dart 2 → Power
Dart 3 → Spin
```

There is no recommended direction target.

---

# 11. Advanced Direction

Dart 1 determines the direction of the cue-ball shot.

The dart's **position relative to the centre of the dartboard** is converted into an angle.

The dartboard effectively acts as a 360° directional controller.

Conceptually:

```text
             ↑
             |
             |
←────────────●────────────→
             |
             |
             ↓
```

The exact dart position provides the angle.

The number/segment itself does not need to be used for direction calculation.

This allows the camera-tracking system to provide continuous directional control.

## 11.1 Table-Fixed Frame

Direction is **fixed to the table**, not relative to the cue ball or the current shot.

- The table is displayed landscape on the TV.
- The top of the dartboard (20) is always up the screen; 6 is right, 3 is down, 11 is left.
- The mapping never rotates during a match, so players learn one map.

This frame applies to every mode: fallback directions (§6.5, §7.4), recommended numbers (§6.2) and Advanced direction.

Direction is computed as the unit vector from the bull to the dart's `(x, y)` position, without trigonometry (§19.2).

## 11.2 Edge Cases

- **Dead-centre bull:** a dart at exactly `(0, 0)` has no direction and shoots straight up (towards 20). Under manual entry, every bull is pinned to the centre.
- **Miss:** uses the dart's actual position. Under manual entry, every miss is pinned straight up (towards 20).

## 11.3 Manual Entry

Under manual entry, Barrelo snaps each throw to the centre of its segment and ring, so Advanced direction is limited to 20 directions.

Advanced mode is designed for a camera autoscorer. It remains available with manual entry, but that limitation should be shown on the difficulty setting.

---

# 12. Advanced Power

Dart 2 determines power.

The dart's number determines the power level.

```text
1  = minimum
20 = maximum
```

Recommended initial mapping:

```text
Power = dart number / 20
```

Example:

```text
Dart 2 → 4
Power → 20%
```

```text
Dart 2 → 12
Power → 60%
```

```text
Dart 2 → 20
Power → 100%
```

The power curve should be configurable independently from the displayed dart number.

Bull, miss and power floor values are the same as Intermediate (§8).

---

# 13. Advanced Spin

Dart 3 determines cue-ball spin.

Spin is determined by the dart's position relative to the centre of the dartboard.

Conceptual mapping:

```text
                  Topspin
                    ↑
                    |
                    |
Left Spin ←──────── ● ────────→ Right Spin
                    |
                    |
                    ↓
                 Backspin
```

The dartboard represents the face of the cue ball. As with a real cue, striking above centre gives topspin and striking below centre gives backspin.

The exact position allows combinations of spin.

Examples:

- Above centre → topspin
- Below centre → backspin
- Left of centre → left spin
- Right of centre → right spin
- Upper-left → topspin + left spin
- Lower-right → backspin + right spin
- Centre → no spin

Distance from the centre determines spin strength.

Closer to centre:

```text
Low spin
```

Further from centre:

```text
High spin
```

The maximum spin strength is configurable.

Spin strength scales linearly with distance from the centre and reaches maximum at the outer edge of the double ring. A miss beyond the double ring is clamped to maximum strength in its direction. Under manual entry, every miss is pinned straight up, which gives maximum topspin.

---

# 14. Shot Preview

Before executing the shot, the TV should display the resulting shot configuration.

## Beginner

```text
🎯 DIRECTION

          ↗

Ready?
```

## Intermediate

```text
🎯 DIRECTION
💥 POWER

Direction → ↗
Power     → ███████░░░
```

## Advanced

```text
🎯 DIRECTION
💥 POWER
🌀 SPIN

Direction → ↗
Power     → ███████░░░
Spin      → ↖
```

The preview should be easy to understand without requiring the player to understand the underlying calculations.

---

# 15. Shot Execution

After the required darts have been thrown:

1. Display the final shot preview.
2. Briefly show the three input values.
3. Execute the cue-ball shot.
4. Run the physics simulation.
5. Wait until all balls have stopped.
6. Evaluate pockets and fouls.
7. Update the table.
8. Determine whether the team continues.
9. Start the other team's turn, with its next shooter in rotation, if necessary.

Example:

```text
DIRECTION → 5
POWER → 14
SPIN → TOPSPIN

         SHOT!
```

---

# 16. Pool Rules

The MVP uses **one simplified 8-ball ruleset for all difficulties**. Difficulty changes player control, not the rules (§26).

A more complete ruleset (called pockets, wrong-ball-first fouls, etc.) may be added for Advanced in a future version.

All rules are evaluated **after all balls come to rest**, using the full set of events from the shot.

All rules apply to **teams** (§3.2). "Shooter" means the team member at the board, and "opponent" means the other team.

## 16.1 Summary

1. Break the rack.
2. Teams are assigned solids or stripes.
3. Pocket your balls.
4. Successfully pocketing your own ball allows another turn.
5. Missing ends the turn.
6. Pocketing the opponent's ball does not cause an automatic penalty.
7. Clear your group.
8. Pocket the 8-ball to win.

## 16.2 The Break

- The breaking team is chosen from the match seed. Its first player in rotation breaks.
- The cue ball starts on the head spot. There is no placement on the break.
- Beginner and Intermediate show the break direction as the recommended number (straight at the head ball).
- The table remains **open** after the break, whatever is pocketed.
- If any object ball is pocketed on the break without a foul, the breaking team continues, with the same shooter.
- If the 8-ball is pocketed on the break, it is re-spotted on the foot spot. It is not a win or a loss.
- If the cue ball is pocketed on the break, it is a foul (§17). The table stays open.

## 16.3 Group Assignment

While the table is open:

- The first shot after the break that pockets an object ball (other than the 8) without a foul assigns groups.
- The shooter's team takes the group of the ball pocketed. If both groups were pocketed, it takes the group with more balls pocketed on that shot; on a tie, the group of the first ball to drop in the simulation.
- The opposing team takes the other group.
- Groups belong to the team, so every team member shoots at the same group.
- A foul shot never assigns groups.

## 16.4 Continuing the Turn

The team's turn continues, with the same shooter, if on that shot:

- No foul was committed, **and**
- At least one ball from the team's group was pocketed, or, on an open table, any object ball other than the 8.

Otherwise, the turn passes to the opposing team, whose next player in rotation shoots (§3.2).

Balls from either group that are pocketed stay pocketed. Pocketing only the opponent's balls ends the turn without a penalty.

## 16.5 The 8-Ball

The 8-ball may be pocketed in any pocket. Pockets are not called.

When the 8-ball is pocketed (other than on the break), the result is decided when balls come to rest:

| Situation                                                                        | Result |
| -------------------------------------------------------------------------------- | ------ |
| Shooter's team group is fully cleared (including balls pocketed on this shot), no foul | Team wins  |
| Shooter's team group is not fully cleared, or the table is open                       | Team loses |
| Foul on the same shot (e.g. cue ball also pocketed)                                   | Team loses |

## 16.6 Legal Target Balls

The legal target balls are used by the recommender (§25) and by the no-contact foul (§17):

- **Open table:** any object ball except the 8.
- **Group assigned:** the shooter's team's remaining group balls.
- **Group cleared:** the 8-ball.

The MVP does not penalise hitting an illegal ball first.

---

# 17. Fouls

The initial game should keep fouls simple.

A foul occurs when:

- The cue ball is pocketed.
- The cue ball does not contact any object ball.

Because the physics is 2D, the cue ball cannot leave the table.

After a foul:

- The team's turn ends, even if it pocketed its own ball.
- Balls pocketed on the foul shot stay pocketed (except as described in §16.5).
- The opposing team's next shooter in rotation receives:

> **Ball in Hand**

The cue ball is placed automatically (§18).

---

# 18. Ball in Hand

When ball-in-hand is available, the cue ball is repositioned before the next shot.

## 18.1 MVP: Automatic Placement (All Modes)

In the MVP, the game places the cue ball automatically in **every difficulty**.

Manual placement would need an input other than darts, which breaks the "physical interaction first" principle (§28), or an extra placement dart, which changes the shot structure. Automatic placement avoids both.

Placement algorithm:

1. Evaluate a fixed grid of candidate positions across the table, skipping positions that overlap a ball or a cushion.
2. Score each candidate with the shot recommender (§25) for the team receiving ball in hand.
3. Place the cue ball at the highest-scoring candidate. Ties are broken by grid order, so the result is deterministic.

The TV shows the cue ball moving to its new position with a **BALL IN HAND** banner.

## 18.2 Future: Dart Placement

Future versions may use a single dart to select the cue-ball position in Intermediate and Advanced.

The dart's `(x,y)` coordinates are mapped onto the virtual pool table.

---

# 19. Physics

The game requires a deterministic 2D pool physics engine.

## 19.1 Engine Decision

The game uses a **custom, purpose-built pool physics engine**, not a general-purpose library (Matter, Planck.js, Rapier).

Reasons:

1. **Cross-screen determinism.** Barrelo replays the visit log independently on every screen (tablet, TV, refreshed tabs). Pool is chaotic: a break amplifies a last-bit floating-point difference into a different table. A custom engine restricted to IEEE-exact operations produces identical results on every JS engine.
2. **Exact collisions.** Beginner and Intermediate snap a successful target hit to the recommender's exact aim angle (§25). The physics must send the object ball along the true centre-to-centre line, or the recommender and the simulation disagree and a "perfect" dart misses. General-purpose engines use iterative contact solvers, and Matter approximates circles as polygons, quantising cut angles.
3. **Small scope.** 16 circles, 6 cushions, 6 pockets, friction and rest detection is a few hundred lines.
4. **Replay performance.** The full match is re-simulated on every dart. A lean engine is the fastest option, and its state (16 ball positions) is trivial to snapshot.
5. **Spin headroom.** A spin model can be added later without changing engines.

## 19.2 Determinism Rules

The engine is run twice: headlessly inside the rules replay (authoritative) and step-by-step by the board for display. Both use the same code, so they cannot diverge.

- Fixed timestep with fixed substeps. Never a variable timestep.
- Simulation and rules use only `+ − × ÷` and `Math.sqrt`. **No** `Math.sin`, `cos`, `atan2`, `pow`, `exp` or other non-exact functions.
- Directions are unit vectors derived from dart `(x, y)`, never angles.
- No `Math.random()` (use the match seed), no wall-clock time, no module-level mutable state.
- Every shot has a hard step cap so the simulation always terminates.

## 19.3 Engine Responsibilities

The engine must simulate:

- Cue-ball movement
- Object-ball movement
- Ball-ball collisions (exact elastic response along the centre line)
- Cushion collisions
- Pocket detection (forgiving pocket geometry)
- Friction
- Rolling resistance
- Spin (see §20)
- Tunnelling prevention at break speed (substeps or time-of-impact)
- Simultaneous contacts (rack, frozen balls)
- Rest detection

Physics parameters must be configurable.

## 19.4 Validation Gate

The physics engine is the first milestone and must pass the following before rules and UI work begins:

| Test          | Pass criteria                                                                 |
| ------------- | ----------------------------------------------------------------------------- |
| Break         | 200 full-power breaks, no ball passes through another ball or a cushion       |
| Cut accuracy  | Recommender's exact angle pots ≥ 95% of 50 random makeable shots              |
| Determinism   | A 100-shot log replayed in Chromium and Firefox/Safari yields identical state |
| Performance   | Replaying a 100-shot log takes < 300 ms on target TV hardware                 |

## 19.5 Fallback

If the custom engine cannot pass the validation gate within roughly two days of effort, switch to `@dimforge/rapier2d-deterministic` (cross-platform deterministic WASM build).

The rules, recommender and board depend only on a narrow interface (apply shot, step, read ball positions and pocket events), so the engine can be swapped without changing them.

---

# 20. Spin Physics

Spin should affect the cue ball in meaningful but understandable ways.

Examples:

### Topspin

Cue ball continues forward after contacting an object ball.

### Backspin

Cue ball moves backwards after contacting an object ball.

### Sidespin

Cue ball receives lateral influence and changes its interaction with cushions.

Spin should be visually obvious enough that players understand its effect through experimentation.

## 20.1 MVP Spin Model

The MVP does not simulate ball angular velocity or the slide-to-roll transition.

Spin is applied as an arcade velocity adjustment to the cue ball:

- **Topspin / backspin:** after the cue ball's first ball contact, add a velocity component along the original shot line (forward for topspin, backward for backspin), scaled by spin strength.
- **Sidespin:** after cushion contact, rotate the cue ball's rebound direction, scaled by spin strength.

The rotation must be computed with vector arithmetic only (see §19.2).

A full spin model (angular velocity, sliding vs rolling friction, cue-ball deflection) may replace this in a future version without changing engines.

### 20.1.1 Natural roll addendum

A cue ball struck with no dialed top/backspin is not actually spin-free by the time it reaches an object
ball: cloth friction spins a sliding ball up toward natural forward roll over distance, and washes out
deliberate top/backspin the same way. Still without simulating angular velocity directly, the engine blends
the dialed topspin toward a small fixed "natural roll" bias as the cue ball travels from the shot's origin
to its first contact, using a transition distance that scales with the square of launch speed (matching the
real d ∝ v² relationship) so soft shots roll up almost immediately while hard shots (including the break)
stay slide-like for most of their travel. See `PHYSICS.spin.naturalRoll` in `constants.ts` and
`effectiveTopSpin` in `step.ts`.

---

# 21. Camera Tracking

The game requires camera-tracked dart detection.

Each detected dart should provide, where available:

```text
x
y
timestamp
segment
ring
number
score
throw order
```

The game primarily uses:

### Beginner

- Segment/number
- Dart position

### Intermediate

- Segment/number
- Dart position

### Advanced

- Dart position
- Segment/number

---

# 22. Dart Validation

Each dart must be classified as:

```text
Valid dart
Miss
Invalid/unknown
```

Misses should still count as darts thrown.

A miss therefore still contributes to:

- Beginner's three attempts
- Intermediate's two direction attempts
- Advanced's direction/power/spin input

---

# 23. Turn Structure

## 23.1 Visits and Shots

Barrelo records play as a log of **visits**: one player's turn at the board, up to three darts.

- **One visit is one shot.**
- The game, not Barrelo, decides who throws next (the shooter, §3.2), and reports it to Barrelo as the current player.
- If the team's turn continues (§16.4), the same shooter takes the next visit. They retrieve their darts between shots, as normal.
- If the turn passes, the next visit belongs to the opposing team's next player in rotation.

## 23.2 When the Shot Fires

The shot fires **on the dart that completes its inputs**:

- **Beginner:** the first hit on the recommended number, or Dart 3.
- **Intermediate:** the power dart (Dart 2 after a Dart 1 hit, otherwise Dart 3).
- **Advanced:** Dart 3.

Darts thrown after the shot fires in the same visit are ignored. They do not affect the shot, the rules or the turn.

## 23.3 Visit Ended Early

If Barrelo ends a visit before the shot's inputs are complete, the shot is built from the darts that were thrown:

| Darts thrown        | Result                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| None                | No shot. The turn passes to the opposing team. It is not a foul.                          |
| Direction not locked | The last thrown dart gives the fallback direction (§6.5, §7.4)                            |
| Power missing       | Beginner automatic power (§6.6)                                                           |
| Spin missing        | No spin                                                                                   |

This preserves "no dead ends": any visit with at least one dart produces a shot.

## 23.4 Beginner

```text
Player turn
    ↓
Dart 1 — Direction attempt ── hit ──┐
    ↓ miss                          │
Dart 2 — Direction attempt ── hit ──┤
    ↓ miss                          │
Dart 3 — Direction attempt / fallback
    ↓                               │
Build shot ←────────────────────────┘
    ↓
Execute
```

## 23.5 Intermediate

```text
Player turn
    ↓
Dart 1 — Direction attempt ── hit ──→ Dart 2 — Power
    ↓ miss                                  ↓
Dart 2 — Direction attempt / fallback       │
    ↓                                       │
Dart 3 — Power                              │
    ↓                                       │
Build shot ←────────────────────────────────┘
    ↓
Execute
```

## 23.6 Advanced

```text
Player turn
    ↓
Dart 1 — Direction
    ↓
Dart 2 — Power
    ↓
Dart 3 — Spin
    ↓
Build shot
    ↓
Execute
```

Each pool shot uses **at most** three darts.

---

# 24. Player Feedback

The TV should clearly communicate what the player needs to do.

Avoid technical terminology where possible.

### Beginner

```text
🎯 AIM FOR 5

Throw at 5!
```

After each dart:

```text
❌ Try again!
```

or:

```text
✅ PERFECT!
```

### Intermediate

```text
🎯 AIM FOR 5

2 attempts remaining
```

Then:

```text
💥 NOW CHOOSE POWER

1 = Gentle
20 = Maximum
```

### Advanced

```text
🎯 CHOOSE DIRECTION
DART 1
```

Then:

```text
💥 CHOOSE POWER
DART 2
```

Then:

```text
🌀 CHOOSE SPIN
DART 3
```

---

# 25. Recommended Shot

The game identifies a recommended shot for **every** Beginner and Intermediate shot. It is also used for automatic power (§6.6) and automatic ball-in-hand placement (§18.1).

Because a successful target hit fires at the recommended aim angle (§6.4), the recommender affects the outcome and is not only a display hint. It runs inside the rules replay and must be deterministic (§19.2).

## 25.1 Inputs

The recommendation can consider:

- Pocket location
- Object-ball position
- Cue-ball position
- The shooter's team's remaining balls
- The opposing team's balls
- Available cushions
- Difficulty level

## 25.2 Selection

The recommender always returns a shot, using the first tier that produces one:

1. **Pot:** for every legal target ball (§16.6) and every pocket, compute the ghost-ball aim point. Discard options where the cue ball's path or the object ball's path to the pocket is blocked, or the cut angle exceeds a configurable maximum. Score the rest by cut angle and total distance, and pick the best.
2. **Contact:** if no pot is available, aim directly at the nearest legal target ball with a clear path, so the shot at least avoids the no-contact foul.
3. **Fallback:** if every legal target ball is blocked, aim at the centre of the nearest legal target ball anyway.

The break always recommends aiming straight at the head ball.

Ties are broken by ball number, then pocket order, so the result is identical on every screen.

MVP recommendations use direct shots only. Bank and kick shots off cushions are a future enhancement.

## 25.3 Presentation

The recommended shot should be presented visually rather than requiring the player to understand pool strategy.

Example:

```text
🎯 RECOMMENDED

Hit the 4 ball
into the bottom-right pocket
```

A future version can provide an aiming line.

---

# 26. Difficulty Philosophy

The three difficulties should not merely make the physics harder.

They should progressively increase **player control**.

### Beginner

> **"Tell me where to shoot."**

The game handles everything else.

### Intermediate

> **"Tell me where to shoot, and I'll decide how hard."**

### Advanced

> **"I'll control the entire shot."**

This makes the difficulty levels intuitive without requiring players to learn complicated rules.

---

# 27. MVP

The MVP should include:

## Game

- Strict two-team 8-ball pool (1v1 as one-person teams, §3.2)
- Team rotation per turn
- Team result reporting (§4.1)
- Pool table
- Solids
- Stripes
- 8-ball
- Cue ball
- Pockets
- Break
- Turn management (one visit per shot, §23)
- Simplified 8-ball ruleset for all difficulties (§16)
- Fouls: scratch and no contact (§17)
- Automatic ball-in-hand placement (§18.1)
- Win/loss conditions

## Dart Control

### Beginner

- Recommended number
- 3 direction attempts
- First successful hit snaps to the exact aim angle and fires immediately
- Dart 3 fallback
- Automatic power
- Automatic no-spin

### Intermediate

- Recommended number
- 2 direction attempts
- First successful hit snaps to the exact aim angle
- Dart 2 fallback
- Next dart after direction is power
- Automatic no-spin

### Advanced

- Dart 1 direction (table-fixed frame, §11.1)
- Dart 2 power
- Dart 3 spin (above centre = topspin)

### All Modes

- Power mapping with floor, bull and miss values (§8)
- Early-ended visits handled (§23.3)

## Shot Recommender

- Pot / contact / fallback tiers (§25.2)
- Direct shots only

## Physics

- Custom deterministic engine (§19)
- Ball movement
- Ball collisions
- Cushion collisions
- Pocket detection
- Friction
- Basic spin (arcade model, §20.1)
- Rest detection
- Passes the validation gate (§19.4)

## UI

- Team panels (Team 1 / Team 2) with member names and assigned group
- Current team and current shooter
- Next shooter in rotation for each team
- Remaining balls per team
- Direction target
- Power indicator
- Spin indicator
- Shot preview
- Turn result
- Fouls
- Winner screen

---

# 28. Design Principles

Dart Pool should follow these principles:

### 1. Easy to understand

A new player should understand the basic mechanic within one turn.

### 2. Physical interaction first

The dartboard is the controller.

Players should not need to interact with menus during normal gameplay.

### 3. Every dart matters

Misses should still produce a valid outcome whenever possible.

### 4. No dead ends

A player should never throw their darts and then be unable to create a shot.

### 5. Progressive complexity

Introduce:

```text
Direction
    ↓
Direction + Power
    ↓
Direction + Power + Spin
```

### 6. Spectator friendly

The TV should make the game understandable to people watching.

### 7. Fun over simulation

Physics should feel believable but remain forgiving and enjoyable.

The game is ultimately a **dart-controlled arcade pool game**, not a replacement for a professional pool simulator.

---

# 29. Core Experience

The desired experience is:

```text
Look at the table
       ↓
Throw darts
       ↓
See your shot being constructed
       ↓
"SHOT!"
       ↓
Watch the balls fly
       ↓
🎱 POCKET!
       ↓
Celebrate
       ↓
Next turn
```

The player should feel that they are **controlling a pool table with darts**, rather than simply entering commands into a computer.
