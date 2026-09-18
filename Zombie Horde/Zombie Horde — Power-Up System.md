# Zombie Horde — Power-Up System

> **Status: post-MVP.** Nothing in this document ships in the first playable version. *Zombie Horde — Game
> Scope.md* §21 is the MVP, and §18 lists this system as deferred until the core game has been playtested.
> The design below is written so it can be added without changing the core.

Power-ups are temporary abilities that appear during gameplay. A power-up is **offered** on the TV, and a
player **collects** it by hitting a specific dartboard target. Once collected, it goes into the team's
shared inventory and can be spent later.

Power-ups should create exciting opportunities without being mandatory for surviving normal waves.

---

## 1. Two-step model

Every power-up has three states, and the distinction matters because it is what keeps power-ups from
hijacking ordinary darts:

| State | What it means |
|---|---|
| **Offered** | Showing on the TV with a collection target. Only then does that target do anything special. |
| **Collected** | In the team's inventory. Any player can spend it. |
| **Spent** | Consumed by its trigger, and gone. |

```text
┌─────────────────────────────────────────┐
│                                         │
│              🎯 POWER-UP                │
│                                         │
│            💀 HEADSHOT                  │
│                                         │
│         COLLECT: HIT DOUBLE 20          │
│                                         │
└─────────────────────────────────────────┘
```

### The dart does both

Collection targets are ordinary doubles and triples — exactly the darts players throw to kill zombies — so
a rule is needed for the overlap. It is deliberately generous:

> A dart that hits an offered power-up's collection target **deals its normal damage first** (Game Scope
> §6), **and then** collects the power-up.

Nothing is ever taken away from the player for collecting. A `T18` into a wave of 18-zombies kills what it
was always going to kill, and picks up the offered power-up as a bonus.

If no power-up is currently offered, `D20` is just a `D20`.

### The bullseye is not available

Both bull targets belong to the core game — bull (50) is Critical Hit, outer bull (25) is Freeze (Game
Scope §12). **No power-up may use a bull as its collection target.** That is why the collection targets
below are all doubles and triples.

---

## 2. The power-ups

| Power-up | Collect on | Effect | Rarity |
|---|---|---|---|
| 💀 Headshot | `D20` | Next matching Triple instantly kills its target | Common |
| 🛡️ Shield | `D16` | Next zombie to reach the safehouse deals no damage | Common |
| ❄️ Deep Freeze | `D12` | Zombies do not move for the next 2 rounds | Common |
| ❤️ Heal | `D10` | Restore 2 safehouse HP | Common |
| ⚡ Double Damage | `D19` | Next damaging dart deals double | Uncommon |
| 💣 Bomb | `D15` | Next damaging dart also hits neighbours | Uncommon |
| 🐌 Slow Motion | `D13` | All zombie movement is 1 for 2 rounds | Uncommon |
| 🔁 Extra Turn | `T18` | Current player throws another 3 darts | Rare |
| ☢️ Nuke | `T20` | 5 damage to every zombie on the board | Very rare |

Each is described below. All numbers are constants, tunable after playtesting.

---

## 3. Headshot

**Collect on `D20`.**

The next **Triple** that damages a zombie instantly kills it, regardless of remaining health.

```text
🧟 THE BRUTE
10 × 20

Player hits D20 (offered)
        ↓
💀 HEADSHOT COLLECTED
        ↓
Player hits T20
        ↓
💥 HEADSHOT!
🧟 DEAD
```

The Triple still has to be a **damaging** hit — it must match the target zombie's required number and any
ring restriction. A `T20` against a zombie that requires 18 does nothing and does **not** spend the
Headshot, which preserves the importance of choosing the right target.

The kill applies to the zombie the targeting rule (Game Scope §6) selected — the closest matching one.
Overkill does not carry from a Headshot; it kills exactly one zombie.

Usable on any zombie or boss unless explicitly immune.

---

## 4. Shield

**Collect on `D16`.**

The next zombie to reach the safehouse deals no damage. It is still removed.

```text
🏠
🛡️
❤️❤️❤️❤️❤️
```

The shield is consumed when it blocks, not when the round ends — it can sit unused for several rounds.

---

## 5. Deep Freeze

**Collect on `D12`.**

Zombies do not move for the next **2 rounds**.

```text
❄️ DEEP FREEZE — 2 ROUNDS

🧟 ❄️    🧟 ❄️    🧟 ❄️

ZOMBIES WILL NOT MOVE
```

The core game's outer-bull Freeze (Game Scope §12) stops one movement phase; this is the stronger version,
which is why it is named differently. If both are active, they do not stack — the longer one wins.

---

## 6. Heal

**Collect on `D10`.**

Restores **2** safehouse HP, never above the maximum of 5. If the safehouse is already full, the team gets
a Shield instead so the collection is never wasted.

```text
🏠
❤️❤️❤️
     ↓
❤️❤️❤️❤️❤️
```

---

## 7. Double Damage

**Collect on `D19`.**

The next dart that deals damage deals double.

```text
Normal:          T18 → 3 damage
Double Damage:   T18 → 6 damage
```

Consumed by the first damaging dart. A miss or a wrong number does not spend it. The doubled total carries
its overkill as usual (Game Scope §6), so this is the most reliable way to clear a clustered wave.

---

## 8. Bomb

**Collect on `D15`.**

The next damaging dart also hits the zombies on either side of its target on the track, for **half** damage
rounded down.

```text
       🧟   🧟
          💥
       🧟   🧟
```

Splash damage ignores required numbers and ring restrictions — a bomb does not care what a zombie is weak
to. Splash does not carry overkill.

---

## 9. Slow Motion

**Collect on `D13`.**

Every zombie's movement drops to **1** for the next 2 rounds.

```text
RUNNER
Normal: 2 spaces

SLOWED: 1 space
```

Weaker than Deep Freeze but longer-reaching against a wave of Runners and Swarm.

---

## 10. Extra Turn

**Collect on `T18`.**

The current player throws another 3 darts after finishing their current turn. The round's movement phase
happens after the extra turn, not before it.

```text
PLAYER 3

🎯 🎯 🎯

EXTRA TURN!

🎯 🎯 🎯
```

Rare, because it adds a whole turn of attack to the round.

---

## 11. Nuke

**Collect on `T20`.**

Deals **5** damage to every zombie on the board, ignoring ring restrictions.

```text
☢️ NUKE

💥💥💥💥💥

🧟 🧟 🧟 🧟 🧟
      ↓
     💀
```

Very rare — it is the answer to a wave that has already gone wrong.

---

## 12. Spawn rules

Power-ups must be **rare enough to feel exciting** and must never feel like a rhythm the team can count on.

Since every screen replays the log independently (Game Scope §2), spawning cannot use real time or an
ad-hoc random roll. **There is no clock available.** The rule is therefore expressed in throws:

- After each dart is logged, draw once from `rng(payload.seed)` advanced by the dart's index in the log.
- **10%** chance to offer a power-up, but only if the cooldown has expired.
- **Cooldown: 15 throws** since the last power-up was offered.
- **At most 1 offered at a time.** An offer stands until it is collected — it does not expire.

The cap of 1 applies to *offered* power-ups only. The team's **inventory is uncapped**: holding a Shield,
a Freeze and two Headshots at once is fine and is exactly the kind of stockpile that makes a late wave
survivable.

Which power-up gets offered is a weighted draw from the same seeded RNG, using the rarity column in §2 —
weight 8 for Common, 4 for Uncommon, 2 for Rare, 1 for Very rare. With the nine power-ups above that puts
Nuke at roughly 2% of offers, which at one offer per 15-plus throws makes it something a team sees a
handful of times a year.

Every one of these numbers is a constant, tunable after playtesting.

---

## 13. Visibility

The TV should always make four things obvious.

**A power-up is offered, and how to get it:**

```text
🎯 POWER-UP AVAILABLE

💀 HEADSHOT

COLLECT: DOUBLE 20
```

**What the team is holding:**

```text
TEAM POWER-UPS

💀 Headshot ×1
❄️ Deep Freeze ×1
🛡️ Shield ×2
```

**When something is armed:**

```text
💀 HEADSHOT READY

Next matching TRIPLE = INSTANT KILL
```

**When something is spent:**

```text
💥 HEADSHOT!

Power-up used.
```

---

## 14. Shared by the team

Power-ups belong to the **whole team**, not the player who collected them. Any player can spend one, and
the inventory is on screen for everyone.

This is the point of the system — it gives the team something to argue about:

> "I've got Headshot ready."

> "Save it for the Brute."

---

## 15. Strategy

Power-ups should create meaningful decisions. With one Headshot in hand and this board:

```text
🧟 Walker     2 × 6      (space 1)
🧟 Runner     1 × 20     (space 2)
🧟 Tank       5 × 18     (space 5)
```

The team can spend it now on whatever a triple reaches, or hold it for the Tank and deal with the Runner
by hand. Holding costs nothing but risks never getting the triple. That is the whole decision, and it is
enough.

---

## 16. Design principles

1. **Easy to understand** — one line of text explains any power-up.
2. **Clearly visible on the TV** — offered, held, armed and spent are all distinct displays.
3. **Collected with familiar dart targets** — doubles and triples, never a bull.
4. **Never punishing** — collecting a power-up also deals the dart's normal damage.
5. **Useful without being mandatory** — normal waves are survivable with none.
6. **Rare enough to feel exciting** — cooldown plus a low per-throw chance.
7. **Shared by the whole team** — collected by one player, spent by any.
8. **Deterministic** — every spawn is a function of the seed and the log, never a clock.
9. **Configurable** — every number here is a constant that can be retuned.

New power-ups should be addable by extending the table in §2 and its effect handler, without touching the
core rules.
