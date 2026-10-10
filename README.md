# Metarchy

Metarchy is a turn-based strategy game of hidden information, psychological
deduction and resource management, set in a dystopian neural-network world.
2–4 players (or bots) compete over 5 turns: they secretly deploy Actors to
Locations, resolve conflicts through an extended Rock-Paper-Scissors system with
bets, trade on the market, and race for Victory Points.

**Live demo:** https://metarchy.posthuman.digital (staging, Solana devnet)

Created by **Vladimir Understanding** — GitHub / Telegram: **@Antropocosmist**.
The game, its concept and lore are his work; see [LICENSE](LICENSE).

## Run it

Requirements: Node.js 22+ and [pnpm](https://pnpm.io) 11 (`corepack enable`
provides it).

```sh
pnpm install
pnpm start
```

Open http://localhost:8080. `pnpm start` builds the web client and starts the
game server, which hosts the client, keeps game data in an embedded Postgres
under `.data/`, and needs no other setup.

### With Docker

```sh
docker compose up --build
```

Open http://localhost:8080. Game data lives in the `metarchy-data` volume.

### Signing in

Accounts use the project's hosted Supabase Auth, so an internet connection is
required.

- **Solana wallet (recommended):** choose **Solana wallet**, pick Phantom,
  Solflare or another Wallet Standard wallet, and approve the sign-in message.
  Switch the wallet to **devnet** first. On Android and Solana Seeker, Mobile
  Wallet Adapter offers the installed wallets, including Seed Vault.
- **Email:** sign up and confirm the address from the email you receive.

Then pick **vs Bot** for a quick game, **Tutorial** for a guided first match,
or create a **private 1v1** and share the invite code.

## What is inside

| Path | Contents |
|---|---|
| `packages/engine` | Deterministic rules engine: state, intents, phases, conflicts, scoring, bots |
| `packages/protocol` | Client ↔ server message schema and cosmetics catalogue |
| `packages/chain-solana` | Sign-In With Solana message format and signature verification |
| `apps/server` | Authoritative game server (Fastify + WebSocket): rooms, matchmaking, ratings, market, wallet linking |
| `apps/client` | React + PixiJS client; Capacitor Android app with Mobile Wallet Adapter / Seed Vault |
| `e2e` | Browser smoke tests (vs bot, two-browser PvP) and load tests |
| `supabase/migrations` | Database schema |
| `docs/` | Game design and rules — **`docs/metarchy-rules.md` is the canonical rulebook** |
| `spec/` | The rulebook formalized for the engine: identifiers, state, algorithms, test fixtures |
| `architecture/` | Technical architecture, including blockchain portability |
| `plan/GATO-Tokenomics.md` | GATO token design |
| `infra/` | Dockerfile and Fly.io deployment |

## Solana

- Wallet sign-in through Supabase Web3 auth (Sign-In With Solana); the server
  trusts only the verifier's identity claims.
- Browser wallets via Wallet Standard; Android via Mobile Wallet Adapter, which
  reaches Seed Vault on Solana Seeker. See `docs/Solana-Wallet-Login.md`.
- A wallet can be linked to an existing email account, keeping the same profile.
- The engine is deterministic and every game leaves a verifiable move-hash
  trail, so results can later be proven on-chain (`architecture/Blockchain-Portability.md`).

## GATO and how the game shares its revenue

GATO is Metarchy's in-game currency, and the way players share in the game's
success.

**Earn it by playing.** Every account starts with 1000 GATO. Ranked matches pay
by placement (1v1: 30 to the winner, 10 to the loser; three players: 30 / 20 /
10), and each finished game against bots or in the tutorial pays 5. Winners of
ranked games also receive a random cosmetic item.

**Use it.**

- **Shop** — avatars, Actor skins, skin sets and argument-coin sets.
- **Market** — buy and sell cosmetics with other players. Trades move GATO
  between players; they never create or destroy it.
- **Stake** — lock GATO to share in the game's revenue and vote on its rules.

**Stake, don't burn.** GATO is never burned. Instead of destroying tokens to
fight inflation, Metarchy gives players a reason to hold them: staking. Staked
GATO is locked, with a 21-day unstaking period, and gives the holder:

- **Voice Power** — a vote on changes to the game's rules;
- **a share of the game's revenue**, in proportion to their share of all staked
  GATO.

**Where the revenue comes from, and where it goes.** Money that enters the game
flows into one revenue pool that is paid out to stakers:

- **Advertising** — an advertiser's spend goes to stakers, so watching ads pays
  into the players' own stake rather than earning a token reward.
- **Sponsorships** — a championship sponsor buys GATO to fund the prize instead
  of paying out dollars, and that purchase supports the GATO price.
- **Market fees** — the fee on player trades feeds the pool; it is not burned.

Example: $100 of revenue enters the game. A player who holds 1% of all staked
GATO receives $1.

**Price.** GATO is not sold for money. It will get a market price once a
GATO/USD liquidity pool exists; until then its price is zero, which is
deliberate for the test phase.

**Status.** Earning, the Shop and the Market are live in the current build.
Staking, voting and revenue sharing are the next stage, and the Market is built
toward them. The full design, with current amounts, is in
[`plan/GATO-Tokenomics.md`](plan/GATO-Tokenomics.md).

## Development

```sh
pnpm test        # all unit and integration tests
pnpm typecheck
pnpm lint
pnpm format
```

Android: `pnpm --filter @metarchy/client exec vite build --mode mobile`, then
`pnpm --filter @metarchy/client exec cap sync android` and
`./gradlew assembleDebug` in `apps/client/android` (JDK 21, Android SDK 36).

## License

Proprietary — all rights reserved by Vladimir Understanding (@Antropocosmist).
You may clone, build and run this repository for evaluation, including
hackathon judging; any other use needs written permission. See [LICENSE](LICENSE).
