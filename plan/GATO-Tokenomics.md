# GATO Tokenomics

> Single reference for the GATO soft currency. Compiled 2026-08-06 from
> `plan/Market-Plan.md` §2 (author's decision, 2026-08-01), the live code
> (`packages/protocol/src/shop.ts`, `apps/server/src/rewards.ts`,
> `packages/protocol/src/market.ts`) and the beta ledger state.
> Where this file and the code disagree, the code is right — fix this file.

## 1. What GATO is

| | |
|---|---|
| **Purpose** | In-game currency for cosmetics: Shop purchases and player↔player Market trades |
| **Type** | Soft in-game currency. Never sold for money; it will gain a market price through a future GATO/USD liquidity pool |
| **Conversion** | GATO ↔ items via the Shop and the Market. No cash-out until the pool exists |
| **Burn** | **GATO is NEVER burned.** Inflation is fought by demand (staking + voting), not destruction |
| **Current price** | **Zero** — no liquidity pool exists yet. Correct for the beta: we watch how players use the market, we do not tune prices |

## 2. Core rule: stake, don't burn

A player who earns GATO can sell it or **stake** it — frozen, with a 21-day
unstaking period. Staked GATO gives:

- **Voice Power** — the right to vote on game-rule changes;
- **A share of the game's revenue**, proportional to the share of the total stake.
  $100 enters the game, a player holds 1% of all staked GATO → they receive $1.

Consequences a normal F2P economy does not have:

- **Advertising becomes a shared interest.** An advertiser's $1000 flows to stakers;
  a player watches ads not "for a reward" but because it pays into their stake.
- **A championship sponsor buys GATO** instead of handing out dollars: the prize is
  paid in GATO, and the purchase itself lifts the price in the GATO/USD pool.
- **The Market fee is not a furnace — it feeds the same revenue pool.** "Burn to
  fight inflation" does not apply here.

> Staking, voting and revenue sharing are the **next stage after the Market** —
> recorded here so the Market is built toward them, not against them.

## 3. Faucets (how GATO enters)

| Source | Amount | Notes |
|---|---|---|
| **Start grant** | 1000 | Once per account, on first wallet touch (`GATO_START_BALANCE`) |
| **Ranked 1v1** | 30 / 10 | Winner / loser, all-human match |
| **Ranked ffa3** | 30 / 20 / 10 | By placement, all-human match |
| **Ranked with a bot seated** | 1v1: 10 / 0 · ffa3: 20 / 10 / 0 | Lower ladder; the bot itself earns nothing (it has no wallet) |
| **vs_bots / tutorial** | 5 | Flat, per finished game — placement does not matter (`CASUAL_REWARD`) |
| **Ranked winner item drop** | cosmetic item | Not GATO, but the market's scarcity source (see §6) |

Every payout is idempotent: one `gato_rewards` row per (game, seat), so a recovered
game that reaches `finished` twice never pays twice. Bots earn nothing, ever.

## 4. Sinks (where GATO goes)

| Sink | Amount | Notes |
|---|---|---|
| **Shop: avatar** | 150 | Beyond the three free launch faces |
| **Shop: actor skin** | 300 | Whole-figure look |
| **Shop: matrix skin set** | 1000 | Premium set |
| **Shop: argument-coin set** | 300 | Re-skins all four coins |
| **Market fee** | `MARKET_FEE_BPS = 0` | **Not burned** — accrues to the stakers' revenue pool. Currently zero for the test; one constant turns it on. The trade ledger records `fee` from day one |
| **Market trades** | seller's price | Player→player sales **move** GATO; they neither create nor destroy it |

## 5. Known holes (and the levers ready to close them)

### 5.1 The start grant is transferable

The grant is 99.7% of all GATO in circulation (19,000 at the 2026-08-01 measure).
Today 1000 GATO on a fresh account is safe — it has nowhere to go but the Shop.
**The Market makes it movable:** 10 alt accounts = 10,000 GATO funneled to a main
account through a fake lot.

**Author's decision: no gates during the test** — trading is open from the start;
the mechanics are being tested, not the defenses, and GATO is worth nothing yet.
Ready to enable when needed (one constant / one check each):

1. Selling unlocked only after N finished ranked games — an alt costs an hour of
   play, not a click.
2. Seller fee (`MARKET_FEE_BPS`) into the revenue pool.
3. Active-lot limit — already on: `MARKET_MAX_ACTIVE = 10`.
4. Daily sales-volume cap per account.

### 5.2 The Market has nothing scarce to trade

A Shop skin costs 300 and is available to everyone forever; nobody pays more than
300 to a player, and selling cheaper loses on the fee. A market of shop goods is
dead on arrival. What was decided:

- **Ranked-game drop** (`apps/server/src/drops.ts`) — the winner receives a random
  cosmetic they do not own. The only way to get an item without paying the price
  list, hence the only true scarcity source. Deliberately simple for now (uniform
  across the catalog, winner only); rarities, rates and loser-drops come after the test.
- **Seasonal sets** — sold for 2 weeks, then only second-hand. Later.
- **Personal skins (`ann`, `asa`, `okeesha`, …) never trade** — a gift to a
  specific account is canon (`EXCLUSIVE_SKINS`; `isTradable` reads the Shop catalog,
  so gifts are excluded automatically).
- **The free default coin set never trades** — everyone has it; it is not in the catalog.

## 6. Beta-era events on the ledger

- **2026-08-06 retroactive grant** (author's schedule): per already-played game —
  500 ranked, 300 private, 100 vs_bots, 50 tutorial; plus 100 per ranked win,
  50 per ranked loss, 10 per bots win, 10 per private win. **51,410 GATO** across
  21 players, idempotent via marker rows (`games.rules_version = 'retro-gato'`).

## 7. Current state (measure of the live DB, 2026-08-01, pre-retro grant)

| Metric | Value |
|---|---|
| GATO on hand | 19,000 |
| Share from the start grant | 99.7% |
| Game faucet paid over the whole beta | 50 |

Conclusion the author acted on: the game loop barely emitted GATO; the Market and
the retro grant rebalance that before prices exist.
