# Blockchain Portability

> Solana wallet authentication is an optional identity adapter; the game engine and
> protocol remain chain-neutral. This document defines (a) the trust
> model we consciously accept now, (b) the cheap hooks the MVP keeps so the blockchain
> phase is an add-on rather than a rewrite, and (c) what that future phase will contain.

---

## 1. MVP Trust Model (explicit)

Players trust the game operator — the same model as any online board game. The server
can see sealed moves (players cannot see each other's). What the MVP already guarantees
*technically*:

- Players cannot cheat each other (server-authoritative validation, hidden info never
  reaches other clients).
- The operator leaves a tamper-evident trail (below) that makes post-hoc verification
  possible the moment we start anchoring it externally.

## 2. Hooks Kept in the MVP

| Hook | Implementation | Cost |
|---|---|---|
| **Deterministic engine + event log** | already core architecture (Engine.md, Data-Model.md) — any game is replayable from `(seed, intents)` | free |
| **Move commitments** | on accepting each sealed intent, the server stores `keccak256(canonicalJson({gameId, turn, phase, seat, intent}) ‖ salt)` + salt in `move_commitments` | ~free (`@noble/hashes`) |
| **Committed RNG seed** | `keccak256(seed)` published at game start (in `games` and the first event); seed revealed at game end → anyone with the engine can re-derive every draw | free |
| **Canonical serialization** | stable-key JSON everywhere hashes are computed; integer-only engine math; stable ordering | discipline, enforced by tests |
| **`ProofAnchor` interface** | `anchorGameStart(gameId, seedHash)` · `anchorCommitments(gameId, batchRoot)` · `anchorResult(gameId, resultHash)` — `NoopAnchor` in MVP | one small interface |
| **Identity attachment point** | verified Supabase principals resolve through private aliases to one canonical profile UUID; no game identifier depends on transport or provider | implemented |

Together these mean: at the blockchain phase, publishing a Merkle root of
`move_commitments` per phase + the seed hash gives public verifiability of *every past
and future game* without touching the engine or the client game flow.

## 3. The Future Blockchain Phase (out of MVP scope)

Planned add-ons, roughly in order:

1. **EVM anchoring** — an `EvmAnchor` implementation of `ProofAnchor` posting batch
   roots to an EVM chain (chain-agnostic; Avalanche was the earlier target). Server
   pays gas; players need no wallets yet.
2. **True commit-reveal** — clients hash locally and send the hash *before* the sealed
   content, removing the "operator sees moves early" trust assumption. Requires reveal
   deadlines + forfeit rules (design them then; the legacy crypto docs lack them).
3. **Signed gameplay commitments** — optional wallet signatures over commitments.
   Solana wallet login and explicit linking already use Ed25519 SIWS proofs; they
   do not sign or submit game moves on-chain.
4. **Verifiable randomness** — replace or supplement the committed-seed scheme (e.g.
   VRF) if the trust bar requires it; note the committed seed already prevents *silent*
   seed manipulation.
5. **NFT actors / token economy** — ERC-1155 per the legacy design, gated on product
   decisions.

## 4. Corrections to Carry Into That Phase

Wallet authentication lives in `packages/chain-solana`, client authentication, the
native Android bridge, and server identity modules. It does not add wallet or chain
fields to the engine/protocol. Deployment and device acceptance are documented in
[Solana-Wallet-Login.md](../docs/Solana-Wallet-Login.md).

The archived crypto design (`legacy/`) must not be implemented as written. Known issues
found in the 2026-07 review:

- Commitment hashes must bind `gameId`, `turn`, `phase`, and player identity (the
  `Cryptographic-Proof-System.md` contract example binds none of them → replay and
  collision issues). The MVP's `move_commitments` format above already binds all four —
  reuse it.
- The client-side AES-256-GCM layer had no defined key owner ("player password" does
  not exist) and adds nothing over hash commitments — drop it.
- `Design-Overview.md` §3.2 builds one commitment string from *all* players' moves —
  impossible client-side; commitments are per-player.
- No reveal-timeout/forfeit policy existed — required before real commit-reveal.
- Per-turn Chainlink VRF is heavyweight for a casual game; committed-seed covers MVP
  and most of the trust gap.
