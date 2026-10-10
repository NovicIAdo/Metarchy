# Solana wallet login

Players choose email or a Solana wallet on the login screen. Wallet login signs a
fresh message and receives a normal Supabase Auth session. It requires no SOL,
blockchain transaction, RPC account, OpenAI API key, or private key in Metarchy.
The development Solana MCP wallet is separate from player authentication.

## Supported connections

| Platform | Connection |
| --- | --- |
| Desktop browser | Solana Wallet Standard `signIn`, or `connect` plus `signMessage`; guarded injected-provider compatibility for Phantom and Solflare |
| Android browser | Official Solana Mobile Wallet Standard adapter opens installed MWA wallets |
| Android APK / Seeker | Capacitor bridge to official Android MWA 2.1.1; select **Seed Vault Wallet** in the OS chooser for Seeker's hardware-backed wallet |
| Native iOS shell | Wallet login is unavailable; email/Google remain available |

Only compatible signing wallets appear in browser discovery. A phone wallet that
does not return SIWS can use signed-message fallback. Canceled requests never
trigger that fallback. Account changes, expired messages, wrong domains, and
modified or invalid signatures are rejected before authentication.

Seeker's wallet owns the private key and prompts for authorization. Metarchy
receives the public account and signed proof through MWA. This integration does
not access the Seed Vault directly or extract its keys.

## Account identity and linking

An existing email player opens **Profile → Wallet → Link Solana wallet**, selects
the wallet, and signs the linking message. Linking a fresh wallet preserves the
same profile, ratings, inventory, GATO, history, nickname, and email-granted
cosmetics. An address that already owns an independent Metarchy profile cannot
be merged into another player; link a fresh address before signing into it as a
separate player.

The temporary wallet Auth client is isolated from the primary session. A
server-issued challenge binds the canonical player UUID, nonce, app URI, request
ID, chain, and five-minute expiry. The server verifies both Auth principals,
provider-owned wallet identity, and the signature; then consumes the challenge
and creates the unique alias in one transaction. The browser cannot write these
tables through Supabase's Data API.

If any principal on the account has verified MFA, every login method requires
MFA. Linking prompts for enrollment or verification on the wallet principal
before activation. Removing that factor while another principal still requires
MFA sends the wallet user back to enrollment. An unavailable policy check blocks
access until it can be retried. Wallet-first players can add email/password from
their profile and confirm the address using the existing Supabase email flow.

## Configuration

The default chain is **devnet**. No funding is needed for message signing.

| Variable | Staging value / meaning |
| --- | --- |
| `VITE_SOLANA_CHAIN` | `solana:devnet`; mobile association chain |
| `VITE_SOLANA_AUTH_URL` | `https://metarchy-staging.fly.dev/`; public native app identity, set in `.env.mobile` |
| `SOLANA_AUTH_CHAIN_ID` | `solana:devnet`; SIWS linking network |
| `SOLANA_AUTH_URL` | `https://metarchy-staging.fly.dev/`; native linking identity |
| `SOLANA_AUTH_ALLOWED_ORIGINS` | Comma-separated exact browser origins; staging uses `https://metarchy-staging.fly.dev,https://metarchy.posthuman.digital` |
| `SUPABASE_URL` | Existing Metarchy Auth project URL |
| `SUPABASE_ANON_KEY` | Public project key used with the player's bearer token for `/auth/v1/user`; never the service-role key |
| `DATABASE_URL` | Existing least-privilege `metarchy_server` connection |

Browsers sign their actual origin plus `/`, including Vite localhost. The native
WebView's `https://localhost` asset origin is accepted, but its signed identity
must be the configured public HTTPS URL. Explicit `http://localhost:5173` and
`http://127.0.0.1:5173` development origins are accepted by the server; other
origins must be configured. No wildcard CORS is used. Verified users have
independent rate limits even when Fly presents a shared socket peer address.

In Supabase **Authentication → Providers → Web3 / Solana**, enable Solana. The
management setting is `external_web3_solana_enabled=true`. Keep email, Google,
MFA, and unrelated Auth settings. Auth checks the message URI and domain against
its redirect allowlist. Staging's existing entries include:

```text
https://metarchy-staging.fly.dev/**
http://localhost:3000/**
http://localhost:5173/**
com.metarchy.game://auth-callback
https://metarchy.posthuman.digital
https://metarchy.posthuman.digital/**
```

Every web origin players use needs both an allowlist entry here and a
`SOLANA_AUTH_ALLOWED_ORIGINS` entry. Without the Auth entry, wallet sign-in fails
with "Signed Solana message is using URI which is not allowed on this server"
(the Cloudflare domain `metarchy.posthuman.digital` hit exactly this). The Android OAuth callback remains in place for email/Google flows.

Apply `supabase/migrations/20261009162320_solana_wallet_identity.sql` before
releasing the new server. It adds private aliases, wallet addresses and durable
single-use challenges, plus narrow owner-backed views of verified MFA UUIDs and
canonical email grants. `anon`/`authenticated` have no private-schema access; the
game server gets only the required private tables/views and no Auth credentials.
Memory-only and Auth-free PGlite configurations cannot provide account-wide MFA
policy and therefore return 503 for linking; ordinary standalone login remains
available with fresh Auth factor checks.

## Build and verify

```sh
pnpm install --frozen-lockfile
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @metarchy/client build
pnpm --filter @metarchy/client exec vite build --mode mobile
pnpm --filter @metarchy/client exec cap sync android
cd apps/client/android
./gradlew testDebugUnitTest assembleDebug --console=plain
```

Use JDK 21 and Android SDK 36. The APK is
`apps/client/android/app/build/outputs/apk/debug/app-debug.apk`. Server image
builds copy the new workspace package manifest before the frozen dependency
install. Releasing the server image and distributing the APK are separate from
building and checking this feature.

After a completed project update, refresh jCodeMunch with the project-wide
incremental scan and inspect the outline, as required by `AGENTS.md`.

## Operational status (2026-10-09)

- Hosted Supabase: Solana Web3 provider enabled; private identity migration
  `20261009162320_solana_wallet_identity.sql` applied; private schema, MFA view
  and canonical-email view permissions verified for client and server roles.
- Hosted Web3 claims arrive under `identity_data.custom_claims` (`address`,
  `chain`, `network`) with `identity_data.sub` = `web3:solana:<address>`; the
  server parser reads only that shape.
- Live check on devnet with an ephemeral key passed: Web3 login, server JWT
  verification, authoritative wallet identity, and promoted-session refresh.
  All disposable Auth test users were deleted afterwards.
- Not yet done: hosted wallet linking against a real email account, server
  release, APK distribution, and physical Seeker acceptance below.

## Physical Seeker acceptance

1. Install the new APK on a Seeker with Seed Vault Wallet configured. Use a test
   account on devnet; no private key is pasted into Metarchy.
2. Choose **Solana wallet → Seeker / Mobile wallet**, select Seed Vault Wallet,
   approve the displayed Metarchy origin and sign-in message, and complete the
   wallet's device authentication. Confirm the returned address in Profile.
3. Sign out and sign in again; confirm the same nickname, inventory and ratings.
   Background/foreground the app and repeat after a session refresh.
4. Cancel the wallet prompt and an in-flight sign-in. Confirm no game session is
   created and another attempt works. Repeat with a changed wallet account,
   denied signing, no compatible wallet installed, and an expired link prompt.
5. Sign in using an existing email test account and explicitly link a fresh Seed
   Vault address. Sign out, return with that address, and confirm the original
   profile and GATO. Repeat with a primary MFA account, including enrollment on
   the new wallet principal.
6. Repeat basic signing and cancellation with Phantom, Solflare, and another
   installed MWA-compatible wallet. In a desktop browser, repeat using Wallet
   Standard discovery. Confirm email/Google and Android deep-link callbacks still
   work.

Unit tests and an APK build do not establish physical Seed Vault compatibility.
Record the device model, Android/wallet versions, selected address, and observed
results before claiming Seeker acceptance. The release record should also state
whether the new server is live and which APK was installed.

## Primary references

- [Solana Mobile repositories](https://github.com/solana-mobile)
- [Mobile Wallet Adapter](https://docs.solanamobile.com/developers/mobile-wallet-adapter)
- [Wallet Standard mobile adapter](https://github.com/solana-mobile/mobile-wallet-adapter/tree/main/js/packages/wallet-standard-mobile)
- [Supabase Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3)
- [Supabase local sign-out semantics](https://supabase.com/docs/reference/javascript/auth-signout)
