# Legacy Architecture Documents (archived 2026-07-07)

These documents are **not** the current architecture. They are kept for reference.

| Document | What it was | Status |
|---|---|---|
| `Overview.md`, `Detailed-Architecture.md`, `UI-System.md` | Documentation of the earlier prototype ("Meta_scratch": Next.js monolith, JSON-file persistence, polling, client-side game logic). The prototype code is discarded; the MVP is built from scratch. | Superseded by `architecture/*.md`. `UI-System.md` remains useful as a reference for screens, design language, and the PNG asset inventory. |
| `Design-Overview.md`, `Cryptographic-Proof-System.md` | Two (mutually inconsistent) visions of the blockchain/crypto layer: Avalanche anchoring, Chainlink VRF, client-side encryption, commit-reveal contracts. | Deferred to the blockchain phase. Before implementing, fix the known issues found in review: commitment hashes must bind `gameId`/`turn`/`playerId`; the AES layer has no defined key owner; no reveal-timeout/forfeit policy; the batched multi-player commitment string in `Design-Overview.md` §3.2 cannot be built client-side; per-turn VRF is likely overkill. See `architecture/Blockchain-Portability.md` for the hooks the MVP keeps. |

Why archived: the 2026-07 review found the prototype's client-authoritative model unsound for PvP (clients computed outcomes and awarded themselves resources), and the crypto layer both premature for the MVP and internally inconsistent. The current architecture keeps the good ideas (pure rules engine, commit-reveal *pattern*, all-players-ready consensus) and moves authority to the server.
