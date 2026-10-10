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
