# Metarchy: Official Rulebook

Welcome to the official rules for **Metarchy**, a turn-based strategy game of hidden information, psychological deduction, and resource management.

## 🎯 Goal of the Game

The ultimate objective is to accumulate the highest number of **Victory Points** by the end of the game's final Turn (Turn 5).
A **Victory Point** is earned by collecting a full set of the three Value Tokens:
`1 Victory Point = 1 Power + 1 Art + 1 Knowledge`

If players have an equal number of Victory Points at the end of the final Turn (Turn 5), an extra tie-breaker Turn is played between those tied players. Extra turns are added sequentially until only one player holds the highest number of Victory Points.

## 🎭 Core Vision: Creation through Interaction

Metarchy is a world where nothing happens in isolation.

- **Locations** are static; they just exist.
- **Actors** have potential but no purpose until deployed.
- **Creation** only happens when an **Actor interacts with a Location**.

### Values vs. Resources

- **Humans create VALUES**: Politicians, Scientists, and Artists perform intellectual or social labor to create **Power, Knowledge, and Art**. They refuse hard labor; they seek to influence and inspire.
- **Robots produce RESOURCES**: Utilizing utilitarian modules, Robots produce **Products, Electricity, and Recycling**. They do not create values; they sustain the material infrastructure.

## Gaming Terminology

- **Conflict** - If two or more Actors of the same type meet in one Location, they will have a Conflict. If Actors have a Conflict, players need to start the process of Conflict Resolution.
- **Conflict Resolution** - When two or more Actors of the same type meet in one Location, or when game rules conflict, players start Conflict Resolution: each player chooses Rock, Paper, or Scissors. Choices are hidden until all players have committed, then revealed simultaneously. The Outcome for each Actor/Player can be WIN, LOSE, or DRAW.
- **Outcome** - result of the Conflict Resolution. It can be WIN, LOSE or DRAW.
- **Location** - part of the game field. Locations do nothing by themselves. Players can send Actors to the Locations.
- **Actor** - main characters of each player. Players send Actors to the Locations. Actors create Values or produce Resources in the Locations.
- **Argument** - when sending an Actor to a Location, player MUST give an Argument to Actor. Each Actor must to have an Argument. Each Actor can get only one Argument. Actors of the same player must have different Arguments.
- **Bet** - when sending an Actor to a Location, player MAY add a Bet on Outcome to Actor. To add a Bet on the Outcome of a Conflict, a player must use a Resource. If a player does not have the required Resource, player cannot add a Bet to Actor. Player can't add more than one Bet to one Actor. If Outcome of the Conflict is the same as a Bet, then Bet is successful. If Outcome of the Conflict is other than a Bet, then Bet is failed. Regardless of whether the Bet was successful or failed, the Bet Resource is discarded and is not returned to the player.
- **Elimination** - When a Player leaves the game for any reason (elimination during a tie-breaker, giving up, or disconnection timeout), all Actors, Resources, Values, and Action Cards of this Player leave the game together with the Player.
- **Disputed Situations (universal rule)** - If the rules for an Actor type specify what happens on a Draw, act exactly as specified. In any situation not described by the rules, where two or more Players claim a victory or a reward, the dispute is resolved by a Conflict Resolution (Rock-Paper-Scissors) between those Players. All Players act simultaneously; whenever simultaneous actions collide, the collision is resolved the same way.
- **Choice Deadline (universal rule)** - In every live Conflict Resolution round (conflict re-resolutions, the Politician deadlock, Event and Relocation tie-breaks) each Player has 30 seconds to choose an argument. A Player who has not chosen within the time is treated as having chosen nothing and **automatically loses that round**; the Players who did choose resolve the round among themselves as usual (a single remaining chooser wins outright). If several Players miss the deadline, they all lose; if every Player misses it, everyone loses — nobody takes the disputed reward.

## 🔬 Game Components

### 1. Players

The game supports 2 to 3 players, or "2 vs. 2" mode.
Each player starts the game with:

- 4 Actors (Politician, Scientist, Artist, Robot)
- 4 Arguments (Rock, Scissors, Paper, Dummy)
- 3 Resources (1 Product, 1 Electricity, 1 Recycling)

#### "2 vs. 2" Team Mode

Two teams of two Players each. The game plays by the same rules, with two differences: **full openness between Allies** and a **shared team pool of Values**.

- Allies see each other's Actor placements, Arguments, and Bets already during the Distribution Phase (hidden from the opposing team as usual).
- Allies see each other's Action Cards, Resources, and Values at all times.
- Allies can communicate through an in-game team chat, invisible to the opposing team.
- **Shared team pool of Values**: Allies accumulate Power, Art, Knowledge, and Fame in one shared team pool. Victory Points are counted for the team from this pool: `1 Victory Point = 1 Power + 1 Art + 1 Knowledge`, and Fame fills the lowest team Value as usual. Resources (Product, Electricity, Recycling) and Action Cards remain personal.
- All other rules apply as usual: two Actors of the same type in one Location have a Conflict, whether they belong to Allies or to opponents. Action Cards can be played on yourself or on your Ally (for example, Relocation of an Ally's Actor).
- **Change Values in "2 vs. 2"**: since Allies share one pool of Values, a Change Values card cannot exchange Values inside the team — it exchanges one Value from your team's pool with one Value from the opposing team's pool.
- Compare Events compare the team pools of Values; the winning team's pool receives Fame. Discard Events stay individual (Resources are personal), and the winning Player receives the Action Card.
- If the teams tie in a Compare Event, all four Players play the Conflict Resolution together (Allies may coordinate their choices in the team chat). Players are eliminated round by round by the usual Conflict Resolution rules; as soon as all remaining Players belong to one team, that team wins the tie.

### 2. The Game Board (Locations)

The board consists of 6 distinct Locations where Conflicts are happening:
**Human Locations:**

- 🏛️ **University** (You can send here Politician or Scientist)
- 🎭 **Theater** (You can send here Scientist or Artist)
- ⛲ **Square** (You can send here Politician or Artist)

**Robot Locations:**

- 🏭 **Factory** (You can send here Robot)
- ⚡ **Power Plant** (You can send here Robot)
- 🗑️ **Dump** (You can send here Robot)

### 3. Actors (4 Types per Player)

Actors are sent to Locations to create values or produce resources.

- ![](actor.politician) 👔 **Politician** (Valid Locations: Square, University)
  - **Vision**: On a Square, they organize manifestations. In the University, they organize student strikes. Both create **Power**. In the Theater, they are satirized; they cannot create Power there.
  - If two or more Politicians meet, they argue until one wins. They never agree.
  - **WIN**: Returns with Value **Power**.
  - **LOSE**: Returns with nothing.
  - **DRAW**: Must Resolve the Conflict again until there is a WIN/LOSE outcome.

- ![](actor.scientist) 🧑🔬 **Scientist** (Valid Locations: University, Theater)
  - **Vision**: In the University, they conduct research/experiments. In the Theater, they study humanitarian sciences. Both create **Knowledge**. On the Square, they have no purpose and create nothing.
  - If two Scientists have equally good arguments (**DRAW**), they _both_ create Knowledge.
  - **WIN**: Returns with Value **Knowledge**.
  - **LOSE**: Returns with nothing.
  - **DRAW** (Individual outcome): Returns with Value **Knowledge**.

- ![](actor.artist) 🧑🎨 **Artist** (Valid Locations: Theater, Square)
  - **Vision**: In the Theater or on the Square, they perform or play music. Both create **Art**. In the University, they are just students; they have no stage to create Art.
  - Art is only recognized when one artist is visibly better than others.
  - **WIN**: Returns with Value **Art**.
  - **LOSE**: Returns with nothing.
  - **DRAW**: NO Art is created. Everyone returns with nothing.

- ![](actor.robot) 🤖 **Robot** (Valid Locations: Factory, Power Plant, Dump)
  - **Vision**: Purely industrial. Robots produce material goods.
  - Factory output is limited. More robots doesn't mean more total production per robot.
  - **WIN**: Returns with **3 Resources** (Product/Electricity/Recycling).
  - **LOSE**: Returns with nothing.
  - **DRAW**: Returns with **1 Resource**.

### 4. Arguments (4 Types)

When Player send an Actor to Location, Player must give an Argument to Actor.

- ![](argument.rock) 🪨 **Rock** _(Loses to Paper. Wins against Scissors and Dummy. Draws against Rock)._
- ![](argument.scissors) ✂️ **Scissors** _(Loses to Rock. Wins against Paper and Dummy. Draws against Scissors)._
- ![](argument.paper) 📄 **Paper** _(Loses to Scissors. Wins against Rock and Dummy. Draws against Paper)._
- ![](argument.dummy) 🪆 **Dummy** _(Loses to Rock, Paper, and Scissors. Draws against another Dummy)._

#### **Conflict Resolution with Arguments**

- **In 2-Player Conflicts**: Outcome is determined by standard RPS rules.

**Outcomes for Conflicts with 3 players (Actors without Bets):**

- If all Actors have the same type of Arguments, then Outcome for every Actor is Draw -> Game starts Conflict Resolution with all three Actors.
- If all Actors have different types of Arguments (Rock, Scissors, Paper, and not including Dummy), then Outcome for every Actor is Draw -> Game starts Conflict Resolution with all three Actors.
- If all Actors have different types of Arguments (Rock, Scissors, Paper, and/or Dummy), then Actor with Dummy is a Clear Loser, as Dummy is a weak Argument to all other Arguments. Game needs to compare non-Dummy arguments, and this is the same as a conflict between 2 Actors, not 3 Actors.
- If 2 of Actors have weak Arguments, and 1 Actor has strong Argument, then Outcome for a player with the strong Argument is Win -> No Conflict Resolution is needed.
- If 2 of Actors have strong Arguments, and 1 Actor has weak Argument, then Outcome for a player with the weak Argument is Lose, and Outcomes for players with strong Arguments are Win -> Game needs to start the Conflict Resolution only for Actors with strong Arguments. Actor with a weak Argument returns to a player with nothing.

**Examples:**

- P1 with Rock, P2 with Scissors, P3 with Paper -> Outcome for every Actor is Draw -> Conflict Resolution is needed. All three Actors are involved in the new Conflict Resolution.
- P1 with Rock, P2 with Rock, P3 with Rock -> Outcome for every Actor is Draw -> Conflict Resolution is needed. All three Actors are involved in the new Conflict Resolution.
- P1 and P2 with Paper, P3 with Scissors (in the conflict between Paper and Scissors: Paper is a weak Argument, and Scissors is a strong Argument) -> P3 is a winner, no Conflict Resolution is needed.
- P1 with Scissors, P2 with Dummy, P3 with Rock -> Dummy is a weak Argument as to Scissors, as to Rock. Actor with Dummy is a Clear Loser and leave the Conflict. Game checks the conflict only between P1 and P3. This is a common conflict between two Actors. Scissors is a weak Argument to Rock. P3 is a winner, no Conflict Resolution is needed.
- P1 and P2 with Rock, and P3 with Scissors (in the conflict between Rock and Scissors: Scissors is a weak Argument, and Rock is a strong Argument) -> P3 is a clear loser, P1 and P2 are winners to P3. Game needs to understand who is the winner, so, Conflict Resolution is needed. Only P1 and P2 will participate in the new Conflict Resolution.
- P1 with Dummy, P2 with Dummy, P3 with Dummy -> Outcome for every Actor is Draw -> Conflict Resolution is needed. All three Actors are involved in the new Conflict Resolution.

**How the Conflict Resolution proceeds is determined by the Actors involved.** The Argument comparison above determines which Actor wins, which loses, and between which Actors the Conflict Resolution continues. Then look at what the Conflict is: the Actors' rules apply. If the Conflict Resolution is between two Scientists with equal Arguments — both Scientists create Knowledge. Between two Artists — no one creates Art. Between two Robots — 1 Resource each. Between two Politicians — replay the Conflict Resolution until there is a Win/Lose outcome.

### 5. Values (4 Types)

Required to form Victory Points. 1 Power + 1 Art + 1 Knowledge = 1 Victory Point

- ![](value.power) 👑 **Power** (Created by Politics in Square/University)
- ![](value.art) 🎨 **Art** (Created by Artists in Theater/Square)
- ![](value.knowledge) 📖 **Knowledge** (Created by Scientists in University/Theater)
- ![](value.fame) 🌟 **Fame** (The fourth, wildcard Value. Not created at Locations — gained only from Events: the comparison winner and the Event tie-break winner each receive 1 Fame. When Victory Points are counted, each Fame fills the lowest of the Player's Power/Art/Knowledge (the first equal one in that fixed order), and only then Victory Points are formed. Fame cannot be exchanged with the Change Values card.)

### 6. Resources

Used to add bets on Conflict Outcome.

- ![](resource.product) ⚙️ **Product** (Used to bet on "Win". If the Conflict Outcome for Actor is Win, this Actor will return to Player-owner with one more additional Value or Resource, depending on the Actor.)
- ![](resource.electricity) 🔋 **Electricity** (Used to bet on "Lose". If the Conflict Outcome for Actor is Lose, then Resolve the Conflict one more time.)
- ![](resource.recycling) ♻️ **Recycling** (Used to bet on "Draw". If the Conflict Outcome for Actor is Draw, then the Outcome is counted as a **Win** for this Actor instead. This ensures the Actor receives the full Win reward while simultaneously denying the "Draw" rewards to any opponents who resulted in a Draw without this bet).

#### **Applying of Bets Rules**

In the process of the Conflict, after the game sees the Conflict Outcome, the game needs to check Bets:

- If there is no Bet, then Bets Rules are not applied.
- If a Bet is added to an Actor, compare the Outcome with the Bet.
- If the Bet does not match the Outcome, the Bet is failed, and Bets Rules are not applied.
- If the Bet matches the Outcome, the Bet is successful, and Bets Rules are applied.

**One-Time Bet Rule**: Bets are only checked and processed during the very first round of a confrontation. Regardless of whether the bet was successful or failed, the bet resource is consumed and discarded after this first check. Any subsequent Conflict Resolutions in the same location (due to Electricity bets or tie-breakers) proceed without bets.

**Examples for 2 players:**

- P1-Artist with Paper and Bet on Win vs. P2-Artist with Rock and Bet on Lose. Outcome: P1 Win, P2 Lose. P1-Bet is successful. P2-Bet is successful. Apply Bets Rules. P1 gets 1 additional Value Art. P2 gets Conflict Resolution -> Game needs to start a new Conflict Resolution. If P1 is a Winner, and P2 is a Loser, then P1 gets 2 Values Art, and P2 gets nothing. If P1 is a Loser and P2 is a Winner, then P1 returns to a player with 1 Art, and P2 returns to a player with 1 Art. If there is a Draw between P1 and P2, then P1 returns to a player with 1 Art, and P2 returns to a player with nothing.

- P1-Scientist with Paper and Bet on Win vs. P2-Scientist with Rock and Bet on Lose. Outcome: P1 Win, P2 Lose. P1-Bet is successful. P2-Bet is successful. Apply Bets Rules. P1 gets 1 additional Value Knowledge. P2 gets Conflict Resolution -> Game needs to start a new Conflict Resolution. If P1 is a Winner and P2 is a Loser, then P1 gets 2 Values Knowledge, and P2 gets nothing. If P1 is a Loser and P2 is a Winner, then P1 returns to a player with 1 Knowledge, and P2 returns to a player with 1 Knowledge. If there is a Draw between P1 and P2, then P1 returns to a player with 2 Values Knowledge, and P2 returns to a player with 1 Value Knowledge.

- P1-Politician with Paper and Bet on Win vs. P2-Politician with Rock and Bet on Lose. Outcome: P1 Win, P2 Lose. P1-Bet is successful. P2-Bet is successful. Apply Bets Rules. P1 gets 1 additional Value Power. P2 gets Conflict Resolution -> Game needs to start a new Conflict Resolution. If P1 is a Winner and P2 is a Loser, then P1 gets 2 Values Power, and P2 gets nothing. If P1 is a Loser and P2 is a Winner, then P1 returns to a player with 1 Power, and P2 returns to a player with 1 Power. If there is a Draw between P1 and P2, then start a new Conflict Resolution, until one of Actors is a Winner.

- P1-Robot with Dummy and Bet on Draw vs. P2-Robot with Dummy and Bet on Draw. Outcome: P1 Draw, P2 Draw. P1-Bet is successful. P2-Bet is successful. Apply Bets Rules. P1 is a Winner. P2 is a Winner. Game needs to understand who is the winner, so Conflict Resolution is needed, but already without Bets. The second Conflict Resolution is judged by its own Outcome under the Standard Rules: if one Robot wins, it returns with 3 Resources and the other with nothing; if it is a Draw, each Robot returns with 1 Resource. The Bets do not participate again — they already played in the first Conflict.

- P1-Robot with Rock and without Bet vs. P2-Robot with Dummy and Bet on Lose. Outcome: P1 Win, P2 Lose. P1 has no Bet. P2-Bet is successful. Apply Bets Rules. Start a new Conflict Resolution, but already without Bets.

**Examples for 3 players:**

- P1 with Rock and no Bet, P2 with Scissors and no Bet, P3 with Dummy and Bet on Lose.
  Outcome for P1: Win against P2, Win against P3.
  Outcome for P2: Lose against P1, Win against P3.
  Outcome for P3: Lose against P1, Lose against P2. Bet is successful. Apply Bets Rules -> Start a new Conflict Resolution.
  P1 is Winner against P2, then P2 returns to player with nothing. P1 will resolve the Conflict with P3, but already without bets.

- P1 with Rock and no Bet, P2 with Dummy and Bet on Draw, P3 with Dummy and Bet on Draw.
  Outcome for P1: Win against P2, Win against P3.
  Outcome for P2: Lose against P1, Bet is failed against P1. Draw against P3, Bet is successful against P3.
  Outcome for P3: Lose against P1, Bet is failed against P1. Draw against P2, Bet is successful against P2. -> No Conflict Resolution is needed. Even if P2 and P3 have applied Bets Rules, and they are winners against each other, both of them are losers against P1. P1 returns to a player with reward. P2 and P3 return to players with nothing.

- **Electricity Bet in 3+ Players**: If one player has a successful Electricity bet (Lose) but other losers in the same conflict do not, the losers without the bet are eliminated and return home with nothing. The player with the successful Electricity bet then starts a new Conflict Resolution only with the remaining survivors (Winners/Tied Winners).
  - **Example**: P1 (Paper, no bet), P2 (Rock, Bet on Lose), P3 (Rock, no bet). Outcome: P1 Wins, P2 and P3 Lose. P2's bet is successful. P3 is eliminated and returns home. A new Conflict Resolution begins between P1 and P2 only, without bets.

### Open Information (Table Transparency)

The game hides **intentions**, not standings. At all times, every player can see:

- Every player's **Resources** and **Values** (in "2 vs. 2" — the team Value pools).
- **How many** Action Cards each player holds. The cards themselves stay secret (in "2 vs. 2", Allies additionally see each other's cards).
- Every Action Card **already played** this game, and by whom.
- How many cards remain in the **Event Deck** and the **Action Deck**.

Hidden until revealed by play: the cards in a hand, sealed Arguments and Bets during the Distribution Phase, sealed discard amounts during Events, and sealed Market buys.

### 7. Action Cards

Action cards are powerful, single-use items that can dramatically alter the game state. They are purchased during Market Phase using a combination of Resources.
Deck of Action Cards contains 15 cards:

- ![](card.action.construction_work) **Construction Work** (1 card. Location Square doesn't work this turn. No Conflicts will happen there. Actors in this location will not produce any Values.)
- ![](card.action.charity_event) **Charity Event** (1 card. Location Theater doesn't work this turn. No conflicts will happen there. Actors in this location will not produce any Values.)
- ![](card.action.student_protests) **Student Protests** (1 card. Location University doesn't work this turn. No conflicts will happen there. Actors in this location will not produce any Values.)
- ![](card.action.sabotage) **Sabotage** (1 card. Location Factory doesn't work this turn. No conflicts will happen there. Actors in this location will not produce any Values.)
- ![](card.action.cable_stolen) **Cable Stolen** (1 card. Location Power Plant doesn't work this turn. No Conflicts will happen there. Actors in this location will not produce any Values.)
- ![](card.action.environmental_protests) **Environmental Protests** (1 card. Location Dump doesn't work this turn. No Conflicts will happen there. Actors in this location will not produce any Values.)
- ![](card.action.relocation) **Relocation** (6 cards. Choose one Actor and move it to any valid location. Valid locations are determined by the Actor type: Politicians (Square/University), Scientists (Theater/University), Artists (Theater/Square), Robots (Factory/Power Plant/Dump). You can't relocate Humans to Robot Locations or Robots to Human Locations. You can play Relocation card after any player played a Block Location card.
  - **Timing of Conflicts**: Conflicts between **Actors** (revealing arguments) happen _only_ during the Conflict Phase (Phase 4). If Actors of the same type end up in the same Location during Relocation, their RPS conflict is triggered in Phase 4.
  - **Player Priority**: Conflicts between **Players** (e.g., two players trying to move the same Actor to different places) are resolved immediately in the Action Phase via a Player-to-Player Tie-Breaker.)
- ![](card.action.change_values) **Change Values** (3 cards. Exchange one of your Values with any other Value of another Player. Players can't exchange the Fame Value.)

- An Action Card can be obtained randomly by playing an Event Card.
- Players always receive Action Cards randomly.
- In the last phase of each turn (Market Phase), a player may purchase a random Action Card using three different Resources: "Product + Electricity + Recycling."
- A player may play any amount of Action Cards during the Action Phase.
- The earliest an Action Card can be played is Turn 2. Nobody holds a card on Turn 1 — the first cards are won in an Event or bought in the Market Phase at the end of the Turn — which is why Turn 1 has no Action Phase at all.
- The Action Cards Deck contains 15 cards for the whole game and is never reshuffled: obtained and played Action Cards do not return to the Deck.
- If the Action Cards Deck is empty, Action Cards can no longer be obtained or purchased in any way: the "Buy" option in the Market Phase becomes unavailable, and the winner of a Discard Event receives no reward.

### 8. Event Cards

At the beginning of each turn, in Event Phase (but not on the Turn 1), one of the seven Event Cards is randomly drawn from the Event Deck, and Event happens.

- The Event Deck is not reshuffled: every drawn Event Card is discarded and does not return to the Event Deck.
- If the Event Deck is empty at the start of the Event Phase, no Event happens: Phase 1 is skipped and the game goes directly to Phase 2 (Distribution Phase). This is a rare but possible case — it can only occur in games extended by tie-breaker Turns (7 Event Cards cover Turns 2–8).

Deck of Event Cards contains 7 cards:

- ![](card.event.political_repression) **Political Repression** (Compare the amount of Value Power for each Player. The player with the lowest amount of Value Power gains the Value Fame.)
- ![](card.event.educational_crisis) **Educational Crisis** (Compare the amount of Value Knowledge for each Player. The player with the lowest amount of Value Knowledge gains the Value Fame.)
- ![](card.event.cultural_decline) **Cultural Decline** (Compare the amount of Value Art for each Player. The player with the lowest amount of Value Art gains the Value Fame.)
- ![](card.event.revolution) **Revolution** - Compare the total amount of all Values for each Player. The player with the lowest amount of all Values gains the Value Fame.)
- ![](card.event.help_poor_countries) **Help Poor Countries** (Each Player may discards any amount of Resource Product, but players don't know how many Resources other players discarded. After all Players have discarded the desired amount of Resources Product (the amount may be zero), information about how many resources each player has discarded becomes publicly known. The Player who has discarded more Resourse Products receives a random Action Card.
- ![](card.event.earth_hour) **Earth Hour** - Each Player may discard any amount of Resource Electricity, but players don't know how many Resources other players discarded. After all Players have discarded the desired amount of Resources Electricity (the amount may be zero), information about how many resources each player has discarded becomes publicly known. The Player who has discarded more Resource Electricity receives a random Action Card.
- ![](card.event.prevent_eco_crisis) **Prevent Eco-Crisis** - Each Player may discard any amount of Resource Recycling, but players don't know how many Resources other players discarded. After all Players have discarded the desired amount of Resources Recycling (the amount may be zero), information about how many resources each player has discarded becomes publicly known. The Player who has discarded more Resource Recycling receives a random Action Card.

If two or more players meet the conditions specified on the Event Card, the winner is determined by a Conflict Resolution.

This includes the case when every Player discards zero Resources in a Discard Event: all Players have discarded an equal amount, so all of them meet the winning condition. The winner is determined by a Conflict Resolution between all Players; the winner is considered the Player who discarded the most and receives the reward (if the Action Cards Deck is not empty).

# Metarchy Phase Flow

This document describes the exact flow of turns and phases currently implemented in the Metarchy

## Turn Structure

### Max Turns:

- 2 players (1 vs 1): ends after 5 turns
- 3 players (1 vs 1 vs 1): ends after 5 turns
- 4 players (2 vs. 2): ends after 5 turns
- Game vs. Bots ends after 5 turns

- Turn 1: Skips Phase 1 (Event Phase) and starts directly at Phase 2 (Distribution Phase). Turn 1 also skips Phase 3 (Action Phase): nobody can hold an Action Card yet, so Turn 1 goes from Phase 2 (Distribution Phase) straight to Phase 4 (Conflicts Reveal). The Turn is therefore Phase 2 → Phase 4 → Phase 5.
- Turn 2+: Starts at Phase 1 (Event Phase) and plays all five Phases in order.
- The last Turn: No Phase 5 (Market Phase), game is finished after Phase 4 (Conflicts Resolution)

## Phases Structure

### Phase 1: Event Phase

- At the start of the phase, a random Event Card is drawn automatically from the Event Card Deck
- The Event Deck is not reshuffled: drawn cards leave the deck permanently. If the Event Deck is empty (possible only in games extended by tie-breaker Turns), Phase 1 is skipped and the game goes directly to Phase 2 (Distribution Phase)
- The UI presents the Event Card and its conditions (e.g., discard resources, compare sum of values, compare single values).

Player Action: In case of comparing values, the player must click "CONFIRM" to resolve the event. In case of discarding resources, the player needs to choose the amount to discard and after click "CONFIRM".

Resolution:

- UI shows the summary to players: Amount of discarded resources by each player, or amount of values owned by each player. And also shows Outcome:
- If there is a clear winner, UI show which of the players get reward: Value Fame or Action Card. Note: Only player-winner see the exactly Action Card, all other players see that winner got Action Card, but they don't know which Action Card. Players need to click on button "Get It!", and game goes to the Phase 2 (Distribution Phase)
- If there are several players meet the conditions for winning (two or more players discarded the same biggest amount of resources, or two or more players have the same smallest amount of values), UI shows wich players need to start the process of the Conflict Resolution. Players, who meet the conditions for winning, see the button "Resolve the Conflict" and need to click on it. Other players see the button "Wait for resolution...", but they can't click on it, they just need to wait while the conflict will be resolved.
- Fro players, who meet the conditions for winning, a specialized Conflict Resolution modal (Tie-Breaker) pops up where tied players play Rock-Paper-Scissors: each player choose Rock, Scissors or Paper and click on "Done". UI shows to players the Outcome:
- If the Outcome is Draw, players see the button "Resolve the Conflict" and need to click on it. Conflict Resolution happens one more time, until one of players is winner.
- If there is a clear winner, UI show which of the players get reward: Value Fame or Action Card. Players need to click on button "Get It!", and game goes to the Phase 2 (Distribution Phase)

### Phase 2: Distribution Phase

- Players have their set of Actors (Politician, Scientist, Artist, Robot).

Player Action: The player clicks an Actor, chooses a valid Location on the Map, and selects an Argument Token (Rock/Paper/Scissors). They may optionally add a Bet (Product, Energy, Recycle). After distributing all their Actors by Locations, the player must click the "Next Phase" button. If other players still didn't finish with the distribution of Actors by the Locations, the player's button changes to "WAITING FOR OTHERS..." until the other players finish.

Bots Actions (Game vs. Bots): Bots automatically place their actors in the background. The player's button changes to "WAITING FOR OTHERS..." until the bots finish.

Distribution Reveal: Once all players (humans and bots) have committed their turns, the board opens. Every Actor is shown in the Location its player sent it to — including the opponents' — so everyone can see the shape of the Turn before anything is resolved. Arguments and Bets stay sealed until Phase 4.

- Player Action: each player clicks "**Get It!**". The reveal closes as soon as every player has clicked it, or after 15 seconds, whichever comes first.

Phase Transition: past the reveal, the game advances to Phase 3 (Action Phase) — except on Turn 1, which has no Action Phase and advances straight to Phase 4 (Conflicts Reveal).

### Phase 3: Action Phase

This phase does not happen at all on Turn 1. Action Cards can only be won in an Event (Phase 1, which Turn 1 also skips) or bought in the Market Phase at the end of a Turn, so on Turn 1 no player holds a single card and there would be nothing to play: on Turn 1 the game goes from Phase 2 (Distribution Phase) directly to Phase 4 (Conflicts Reveal). From Turn 2 on, the Action Phase always runs, even for a player with an empty hand.

This phase is divided into multiple sequential sub-steps (p3Step in the code).

#### Step 0: Action: Select Cards

- UI shows Action Card board to a player. Even if a player don't have any Action Cards.

Player Action: The player selects which cards they want to activate this turn (they can pick 0 or multiple). Once selection is complete, the player must click "Commit Action Cards" (or "Play No Cards" if none selected). The player's button changes to "WAITING FOR OTHERS..." until the other players finish to select action cards, and click on "Commit Action Cards" (or "Play No Cards" if none selected).

After all players selected cards to play, the game gets the information about Action Cards that will be played and goes to the next Step:

- If Block Location Cards (Construction Work, Charity Event, Student Protests, Sabotage, Cable Stolen, Environmental Protests) have not been selected, then the game should skip Step 1
- If Relocation Cards have not been selected, then the game should skip Step 2
- If Change Values Cards have not been selected, then the game should skip Step 3

- If no Action Cards have been seelcted, the game must show the players board with the information: "No Actions this turn."
  Player Action: Players need to click on button "Get It!", and game should go to Phase 4.

#### Step 1: Action: Block Locations

- UI shows to players a board with the information: "<Locations-Names> will not work this turn."

Player Action: Players need to click on button "Get It!", and game goes to the next Step.

#### Step 2: Action: Relocation

- Players, who didn't select to play Relocation Cards in Step 0, get notification "Waiting for the Relocation..."
- UI asks players, who selected Relocation Cards to play in Step 0, which actor they want to move from one location to another. (Note: Player can choose to relocate their own Actor, or an Actor of another player, provided the destination is a valid location for that Actor type.)

Player Action: Player needs to click on any Actor, then click a new valid Location (this repeats for the number of Relocation cards played). After, click on the button "Done". The player's button changes to "WAITING FOR OTHERS..." until the other players finish relocation.

After this, the game should show which Actors have moved to which Locations, and goes to the next Step.

- If different players choose to relocate the same Actor to different locations, then the game starts the process of Conflict Resolution between these players (Other players receive a notification: "Waiting for the Conflict Resolution").
- The Relocation Card of the player-winner has effect. The Relocation Card of the player-loser has no effect and is discarded.
- After this, the game should show which Actors have moved to which Locations, and goes to the next Step.

#### Step 3: Action: Change Values

Only for players who selected to play Change Values Card in Step 0. All other players get notification: Waiting for Values Exchange

- UI shows to a player a board with Values of a player and ask player to choose own Value for exchange
- If a player have no Values, the game should show to a player a board with the information: "You have no Values for exchange. Change Values cards are returned to your hand.". Then the game goes to the next Step.

Player Action: The player need to click on available value (Power, Knowledg of Art), and after click on button: "Choose a Value"

- Player can't click on a Value if amount of Value is 0
- Player can't click on Value Fame

- UI shows to a player a board with avatars of opponent players, and their Values (Power, Knowledg of Art) and ask a player to choose opponent's Value for exchange
- If opponents don't have Values to exchange, the game should show to a player a board with the information: "Opponents have no Values for exchange. Change Values card is returned to your hand.". Then the game goes to the next Step.

Player Action: The player need to click on available value (Power, Knowledg of Art), and after click on button: "Change Values"

- Player can't click on a Value if amount of Value is 0
- Player can't click on Value Fame

- If a player selected to play several Change Values cards in Step 0, then the process is repeating for each Change Values card

After a player played all Change Values cards, UI shows to a player updated amount of player's values, and the game goes to the next phase

### Phase 4: Conflicts Reveal

The game scans all the Locations on a board:

- Check all Locations for Actors
- Check Actor Types
- If Actors of the same Type meet in a Location, a Conflict occurs between these Actors.
- If a Location contains an Actor with a Type that is not shared by other Actors in the same Location (or if there is only one Actor in the Location), that Actor has no Conflict and the Outcome of its Conflict is considered as Win.
- The game displays a sidebar with a list of all Conflicts between Actors for each Player, as well as a list of Actors that do not have a Conflict.
- For each Player, the Game displays only those Conflicts involving Actors belonging to the Player. Conflicts in which the Player's Actors are not involved are not displayed to the Player. The same applies to Actors that do not have a Conflict: each player sees only their own Actors that are not involved in the Conflict in the list.

#### The process of Conflict

Player Action: The player clicks on a Conflict in the sidebar to open the Conflict board.

- The game displays the Conflict board to the Player.
- The player sees their Actor, sees their Actor's Argument, and sees the Bet on their Actor (if a Bet has been made).
- The player sees the Actors of other players, but does not see the Arguments and Bets of other players' Actors.

Player Action: The player clicks the "Reveal Conflict" button.

- The game displays the Arguments and Bets (if any) of other players' Actors.
- The game compares the Arguments of the Actors involved in the Conflict and obtains the Conflict Outcome for each Actor: Win, Lose, or Draw.
- After this, the Game compares the Actors' Bets (if any have been made) with the Conflict Outcome for each Actor
- If the Bet does not match the Conflict Outcome, then the Bet is faild.
- If the Bet matches the Conflict Outcome, then the Bet is a success.
- If the Bet is a success, then the betting rules apply.
- If the Bet is failed, then the betting rules do not apply.  
  After this, all Bets are removed, and the Game shows the Player the result of Conflict.

#### Results of the Conflict without applying of betting rules (Standard Rules):

- If the Player's Actor wins, and the other players' Actors lose, then the Player Actor produces one Value of the type that depends on the Player Actor Type (Politician produces Power, Scientist produces Knowledge, Artist produces Art). If the Actor is Robot, it produces 3 Resources of the type that depends on the Location (Robot in the Factory produces Product, Robot in the Power Plant produces Electricity, Robot in the Dump produces Recycling). After it, Actor returns to the owning Player with produced Value or Resources.
- If the Player's Actor loses, then the Actor does not produce Value (or 3 Resources, if it is a Robot Actor) and returns to the owning Player with nothing.

If the Conflict Outcome for the Player's Actor is a Draw, then results depend on the Actor's Type:

- Actor Artist doesn't produce Value Art and returns to the owning Player with nothing.
- Actor Scientist produces 1 Value Knowledge and returns to the owning Player with 1 Value Knowledge.
- Actor Robot produces 1 Resource of the type that depends on the Location (Robot in the Factory produces Product, Robot in the Power Plant produces Electricity, Robot in the Dump produces Recycling) and returns to the owning Player with 1 produced Resource.
- Actor Politician doesn't produce a Value and doesn't return to the owning Player, but participates in the process of the Conflict Resolution with other Politician Actors who also got Draw as a Conflict Outcome:
  Player Action: Player clicks on the button "Resolve the Conflict"
  - A specialized Conflict Resolution modal pops up where each player choose Rock, Scissors or Paper and click on "Done".
    UI shows to players the Outcome:
  - If the Outcome is Draw, players see the button "Resolve the Conflict" and need to click on it. Conflict Resolution happens one more time, until one of players is a winner.
  - When one of the players wins the Conflict Resolution, Outcome for Actor Politician of the Player-winner is Win.
  - **Politician Deadlock Rule**: If the Conflict between Politicians is not resolved after 10 Conflict Resolutions, a Conflict Resolution between the Players themselves begins, to determine whose Politician wins. This Player-level Conflict Resolution is given 10 more attempts. If the Conflict is still not resolved after that, all involved Players and their Politicians are considered losers: no one creates Power, and all Politicians return to their owners with nothing. A Bet on Win that was successful in the first Conflict still brings its +1 Power — a successful Bet always brings what it promises, per the Applying of Bets Rules.

#### Results of the Conflict with applying of betting rules:

##### If the Outcome for Actor is Win, and the Bet was made on Win

Actor produces one additional Value of the type that depends on the Player Actor Type (Politician produces Power, Scientist produces Knowledge, Artist produces Art). If the Actor is Robot, it produces 1 additional Resource of the type that depends on the Location (Robot in the Factory produces Product, Robot in the Power Plant produces Electricity, Robot in the Dump produces Recycling). After it, Actor returns to the owning Player with 2 produced Values or with 4 produced Resources.

##### If the Outcome for Actor is Lose, and the Bet was made on Lose

- Actor with Outcome Lose doesn't returns to a player with nothing
- Actors with Outcome Win of other players don't return to players with Valus or Resources
- Conflict between Actors need to be resolved one more time, and the game display the information that the Conflict need to be resolved:
  Player Action: Player clicks on the button "Resolve the Conflict"
  - A specialized Conflict Resolution modal pops up: each player choose Rock, Scissors or Paper and click on "Done".
    UI shows the Outcome to players:
  - Outcome for the player is an Outcome for the Player's Actor.
  - Since the betting rules apply only to the first Conflict, and Bets are discarded after the betting rule is applied, then the Conflict Resolution is resolving according to the Standard Rules.

##### If the Outcome for Actor is Draw, and the Bet was made on Draw

The Outcome for Actor is Win instead of Draw.

After the Conflict is resolved, the game displays a board to the players with the information about conflict's results:

- For players whose Actor's Outcome is Win: Information that Actor returns to a player with produced Value or 3 Resources
- For players whose Actor's Outcome is Lose: Information that Actor returns to a player without any Values or Resources
- For players whose Artist's Outcome is Draw: Information that Artist returns to a player without Art
- For players whose Scientist's Outcome is Draw: Information that Scientist returns to a player with produced Knowledge
- For players whose Robot's Outcome is Draw: Information that Robot returns to a player with 1 produced Resource
- The information for Politician's Outcome is Draw cannot be shown as Politicians always replay Draws, resulting in a Conflict Outcome for Politicians being either a Win or a Loss.

Player Action: Player clicks on the button "Get It!", and the game returns to the sidebar with the list of not-resolved Conflicts.

Player Action: The player clicks on the next not-resolved Conflict in the sidebar to open the Conflict board, and the Conflict process is repeated for every active conflict.

Player Action: The player clicks on the non-conflict Actor in the sidebar (if any):

- The game displays a board with the Player's Actor and the information that the Player's Actor has won, and returns to the player with 1 produced Value Power/Knowldege/Art (if the Actor is Politician/Scientist/Artist) or with 3 produced Resources (if the Actor is a Robot).
  Players Action: Player clicks on the button "Get It!".

After a player has resolved all Conflicts and reviewed all their Actors that were not involved in the Conflicts, the player must click the "Next Phase" button. The button changes to "WAITING FOR OTHERS..."
Once all players click the "Next Phase" button, the game goes the Market Phase.

#### In case of Phase 4 on the last Turn (Turn 5)

- If it was the last Turn, the game is counting Victory Points of each player
- UI shows a board with the amount of Victory Points of each player. The player with the biggest amount of Victory Point is shown as a Winner.
  Player Action: Player can click on the button "Good Game", and it will redirect player to the main menu of the game

- If two or more players have the same amount of Victory Points, UI shows a board with the amount of Victory Points of each player. Players with the same biggest amount of Victory Point are shown as a Potential Winner.
- **Player Elimination**: Players with the lowest amount of Victory Points will not go to the next phase. They get a notification that they have lost and can exit to the main menu.
- **Let's Go!**: Only players with the same biggest amount of Victory Points can click on the button "**Let's Go!**". This button changes to "WAITING FOR OTHERS..." until all tied players are ready.
- **Extra Turn**: The game goes to the next Phase (Market Phase), but only players with the same biggest amount of Victory Points participate. After the Market Phase, an additional Turn is played, which is now considered the new Last Turn. If a tie occurs again, these rules apply recursively until a single winner is determined.

#### End of Phase 4: the Turn Summary

- Phase 4 always happens, on every Turn — including a Turn where no two Actors of
  the same Type met anywhere and there was nothing to resolve. The Phase is never
  skipped: what it did is what the Turn amounted to, and players have to see it.
- When every Conflict of the Turn has been resolved, the game shows all players
  the same **Turn Summary**: which Locations held a Conflict and how each one
  ended, and what every Actor brought its player — how much of which Value, or
  which resource for a Robot. A Win bet that paid its +1 is named as such, so the
  numbers add up.
- If there were no Conflicts at all, the Summary says exactly that, and still
  lists what each Actor brought its player.
- Player Action: each player clicks "**Get It!**". The Summary closes as soon as
  every player has clicked it, or after **15 seconds**, whichever comes first —
  then the game goes to Phase 5 (Market Phase).

### Phase 5: Market Phase

Note: Skip this Phase if it's the phase of the last turn, until two or more players with the same biggest amount of Victory Points in the previous phase.

In the Market Phase, players can buy random Action Cards from the Action Cards Deck for resources. The price for one Action Card is: 1 Product + 1 Recycling + 1 Electricity. **Market Phase remains fully active during any extra turns**, allowing tied players to purchase and strategically use new cards to break the tie.

- UI shows a Market board with the information about the price of an Action Card to a player
- There are 2 buttons on a board: "Buy" and "Skip"
- If a player hasn't enough resources to buy an Action Card, the button "Buy" is unavailable for a player

Player Action: If a player click on the button "Skip", the player's button "Skip" changes to "WAITING FOR OTHERS..." until all players finish the Market Phase. After it, the game goes to the next Turn.

Player Action: If a player clicks on the button "Buy":

- UI shows to a player a board with the random Action Card from Action Cards Deck. This Action Card is going to inventory of a player.

Player Action: Player can click on the button "Get It!", and it will return a player to the Market Board.

- If a player still has enough resources to buy one more Action Card, then the button "Buy" is available
- If a player doesn't have enough resources to buy one more Action Card, then the button "Buy" is unavailable, and only "Skip" button is available

After all players clicked on the button "Skip", the game goes to the next Turn:

- Turn counter increments by +1, and the game loops back to Phase 1: Event Stage
