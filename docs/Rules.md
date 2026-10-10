# Metarchy — Rules (Player-Facing)

> This is the canonical, complete rulebook for Metarchy. Written for players, not developers. For technical implementation details, see `MECHANICS.md`.

---

## Goal of the Game

Accumulate the most **Victory Points (VP)** by the end of the final Turn.

```
1 Victory Point = 1 Power + 1 Art + 1 Knowledge
```

**Fame** is a wild-card Value that fills whichever of {Power, Art, Knowledge} you have the least of.

If players are tied in VP after the final Turn, they play one additional tie-breaker Turn.

---

## Players & Starting Setup

- **2–3 players** (or 2 vs 2 team mode)
- **Game length:** 5 Turns (2–3 players), 4–8 Turns (4 players)

Each player starts with:
- 4 **Actors:** Politician, Scientist, Artist, Robot
- 4 **Arguments:** Rock, Scissors, Paper, Dummy
- 3 **Resources:** 1 Production, 1 Electricity, 1 Recycling

---

## The Board: 6 Locations

### Human Locations (produce Values)
| Location | Accepted Actors | Produces |
|---|---|---|
| 🏛️ **University** | Politician, Scientist | Power or Knowledge |
| 🎭 **Theatre** | Scientist, Artist | Knowledge or Art |
| ⛲ **Square** | Politician, Artist | Power or Art |

### Robot Locations (produce Resources)
| Location | Accepted Actors | Produces |
|---|---|---|
| 🏭 **Factory** | Robot only | Production |
| ⚡ **Energy Plant** | Robot only | Electricity |
| 🗑️ **Dump** | Robot only | Recycling |

---

## Actors

### 👔 Politician
- Goes to: Square, University
- Produces: **Power**
- On **Draw:** Must re-fight (resolve again until Win/Lose)

### 🧑‍🔬 Scientist
- Goes to: University, Theatre
- Produces: **Knowledge**
- On **Draw:** All Scientists **win** (everyone gets Knowledge)

### 🧑‍🎨 Artist
- Goes to: Theatre, Square
- Produces: **Art**
- On **Draw:** All Artists **lose** (nobody gets Art)

### 🤖 Robot
- Goes to: Factory, Energy Plant, Dump
- Produces: **3 Resources** (type depends on location)
- On **Win:** 3 Resources
- On **Draw:** 1 Resource each
- On **Lose:** Nothing

---

## Arguments (Rock-Paper-Scissors + Dummy)

When sending an Actor to a Location, you **must** assign one Argument. Each of your 4 Actors must have a **different** Argument.

| Argument | Beats | Loses to | Draws with |
|---|---|---|---|
| 🪨 **Rock** | Scissors, Dummy | Paper | Rock |
| ✂️ **Scissors** | Paper, Dummy | Rock | Scissors |
| 📄 **Paper** | Rock, Dummy | Scissors | Paper |
| 🪆 **Dummy** | Nothing | Rock, Paper, Scissors | Dummy |

---

## Bets

When sending an Actor, you **may** attach a Bet by spending 1 Resource. Each Actor can have at most 1 Bet. The Resource is **always consumed** regardless of outcome.

| Resource Spent | You Bet On | If Bet Succeeds |
|---|---|---|
| ⚙️ **Production** | Win | Actor brings +1 **extra** Value or Resource |
| 🔋 **Electricity** | Lose | The Conflict is **re-resolved** (second chance) |
| ♻️ **Recycling** | Draw | Draw counts as **Win** for your Actor |

---

## Values & Resources

### Values (for Victory Points)
- 👑 **Power** — created by Politicians
- 🎨 **Art** — created by Artists
- 📖 **Knowledge** — created by Scientists
- ⭐ **Fame** — earned via Events (wild card, fills your lowest Value)

### Resources (for Bets & Market)
- ⚙️ **Production** — from Factory (also bets on Win)
- 🔋 **Electricity** — from Energy Plant (also bets on Lose)
- ♻️ **Recycling** — from Dump (also bets on Draw)

---

## Turn Phases

### Phase 1: Event (starts from Turn 2)

**Compare Events** (reward: Fame):
- **Political Repression** — player with the **least** Power gets Fame
- **Educational Crisis** — player with the **least** Knowledge gets Fame
- **Cultural Decline** — player with the **least** Art gets Fame
- **Revolution** — player with the **most** Power gets Fame

**Discard Events** (reward: random Action Card):
- **Help Poor Countries** — secretly discard Production; most discarded wins
- **Earth Hour** — secretly discard Electricity; most discarded wins
- **Prevent Eco-Crisis** — secretly discard Recycling; most discarded wins

If tied, resolve with Rock-Paper-Scissors.

---

### Phase 2: Distribution

**Secretly** assign all 4 of your Actors:
1. Choose a **Location** (must be valid for that Actor type)
2. Assign an **Argument** (Rock/Paper/Scissors/Dummy — each Actor gets a unique one)
3. Optionally attach a **Bet** (costs 1 Resource)

You can only see your own placements. Other players' distributions are hidden.

After all players confirm, the game advances.

---

### Phase 3: Action Cards (4 Steps)

All Actors and their Locations are **revealed** (Arguments and Bets stay hidden).

Players simultaneously commit Action Cards in this strict order:

| Step | Action |
|---|---|
| **Step 1: Bidding** | (Reserved for future use) |
| **Step 2: Block Locations** | Play location-blocking cards (disables a Location for this turn) |
| **Step 3: Relocation** | Move an Actor from one Location to another valid Location |
| **Step 4: Exchange** | Exchange one of your Values with another player's Value |

Players can play **any number** of Action Cards per step (of the correct type).

---

### Phase 4: Conflict Resolution

**Arguments and Bets are revealed.** Conflicts are resolved location by location:

1. **No conflict** (only one Actor of a type at a Location): That Actor auto-wins and produces its Value/Resources.
   - If it had a Win bet → bet succeeds, +1 extra reward
   - If it had a Draw or Lose bet → bet fails (resource still consumed)

2. **Conflict** (2+ Actors of the same type at a Location):
   - Arguments are compared using RPS rules
   - **Winner** gets full rewards
   - **Loser** gets nothing
   - **Draw** behavior depends on Actor type (see Actors section above)
   - Bets are checked against the outcome

---

### Phase 5: Market

You may spend **1 Production + 1 Electricity + 1 Recycling** to buy a **random Action Card**.

After the Market Phase, the Turn ends and the next Turn begins with Phase 1.

**If it was the final Turn:** the game ends after Phase 4 (Conflict Resolution). Count VPs to determine the winner.

---

## Action Cards (15-card deck)

### Location Blockers (6 cards, 1 each)
| Card | Disables |
|---|---|
| **Construction Work** | Square |
| **Reconstruction** (Charity Event) | Theatre |
| **Student Protests** (Student Strikes) | University |
| **Sabotage** | Factory |
| **Cable Stolen** (Blackout) | Energy Plant |
| **Environmental Protests** (Ecological Protest) | Dump |

When a Location is disabled: no Conflicts happen there, and Actors produce no Values/Resources.

### Relocation (6 cards)
Move one of your Actors (along with its Argument and Bet) to any other **valid** Location for that Actor type. Useful for escaping blocked Locations.

### Change Values (3 cards)
Exchange one of your Values (Power, Knowledge, or Art) for one Value of another player. Cannot exchange Glory.

### How to Get Action Cards
- **Events:** Win a discard-type Event → random Action Card
- **Market:** Spend 1 Production + 1 Electricity + 1 Recycling → random Action Card
- Cards are always received randomly from the deck

---

## Event Cards (7-card deck)

| Event | Type | Condition | Reward |
|---|---|---|---|
| **Political Repression** | Compare | Least Power | Fame |
| **Educational Crisis** | Compare | Least Knowledge | Fame |
| **Cultural Decline** | Compare | Least Art | Fame |
| **Revolution** | Compare | Most Power | Fame |
| **Help Poor Countries** | Discard | Most Production discarded | Action Card |
| **Earth Hour** | Discard | Most Electricity discarded | Action Card |
| **Prevent Eco-Crisis** | Discard | Most Recycling discarded | Action Card |

---

## Victory Point Calculation

At game end:

1. **Distribute Fame:** Each Fame point is added to your lowest Value (Power, Art, or Knowledge), one at a time
2. **Calculate VP:** `VP = min(Power, Art, Knowledge)`
3. **Winner:** Player with the most VP wins
4. **Tie:** Play one additional Turn
