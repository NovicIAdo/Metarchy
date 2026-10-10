# Metarchy Architecture Design Overview

## Document Purpose

This document provides a comprehensive architectural overview of the Metarchy game system, detailing key components, data flows, integration points, and the distribution of logic between on-chain and off-chain layers.

**Target Audience:**
- System Architects
- Backend/Frontend Developers
- Smart Contract Developers
- Security Auditors
- Technical Stakeholders

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         METARCHY SYSTEM ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │   Player 1   │    │   Player 2   │    │   Player 3   │              │
│  │   (Browser)  │    │   (Browser)  │    │   (Browser)  │              │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │
│         │                   │                   │                       │
│         │  HTTPS/WSS        │                   │                       │
│         ▼                   ▼                   ▼                       │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │              GAME SERVER (Next.js API + Node.js)         │           │
│  │  ┌────────────────────────────────────────────────────┐  │           │
│  │  │  • Game State Management                           │  │           │
│  │  │  • Phase Coordination                              │  │           │
│  │  │  • Conflict Resolution Engine                      │  │           │
│  │  │  • Encryption/Decryption Service                   │  │           │
│  │  │  • Blockchain Gateway (Avalanche MCP)              │  │           │
│  │  └────────────────────────────────────────────────────┘  │           │
│  └──────────────────────────────────────────────────────────┘           │
│         │                   │                                            │
│         │  JSON-RPC         │                                            │
│         ▼                   ▼                                            │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │           AVALANCHE C-CHAIN (Smart Contracts)            │           │
│  │  ┌─────────────────┐  ┌─────────────────┐               │           │
│  │  │  Commitment     │  │  MetarchyGame   │               │           │
│  │  │  Registry       │  │  Core Logic     │               │           │
│  │  └─────────────────┘  └─────────────────┘               │           │
│  └──────────────────────────────────────────────────────────┘           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │              CHAINLINK VRF (Random Number Gen)           │           │
│  └──────────────────────────────────────────────────────────┘           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Architectural Principles

1. **Defense in Depth** - Multiple layers of security (encryption, blockchain, signatures)
2. **Zero-Knowledge by Design** - Server never sees unencrypted moves before reveal
3. **Blockchain Agnostic** - Designed for portability across EVM-compatible chains
4. **Hybrid Performance** - Critical data on-chain, real-time logic off-chain
5. **Verifiable Fairness** - All players can independently verify game integrity

---

## 2. Key Components

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        COMPONENT ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CLIENT LAYER (Browser)                                                 │
│  ═══════════════════                                                    │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  React Frontend (Next.js)                                      │    │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │    │
│  │  │ GameBoard    │ │ ConflictView │ │ ResourceHUD  │           │    │
│  │  │ Component    │ │ Component    │ │ Component    │           │    │
│  │  └──────────────┘ └──────────────┘ └──────────────┘           │    │
│  │                                                                │    │
│  │  ┌────────────────────────────────────────────────────────┐    │    │
│  │  │  Crypto Module (Client-Side)                           │    │    │
│  │  │  • MoveSerializer.ts    - Format moves to canonical string│  │    │
│  │  │  • HashGenerator.ts     - Keccak-256 hashing            │    │    │
│  │  │  • SaltGenerator.ts     - Cryptographic random salt     │    │    │
│  │  │  • CommitmentBuilder.ts - Assemble commitment package   │    │    │
│  │  └────────────────────────────────────────────────────────┘    │    │
│  │                                                                │    │
│  │  ┌────────────────────────────────────────────────────────┐    │    │
│  │  │  Wallet Integration                                    │    │    │
│  │  │  • MetaMask / WalletConnect                            │    │    │
│  │  │  • Transaction Signer                                  │    │    │
│  │  └────────────────────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  SERVER LAYER (Game Server)                                             │
│  ═══════════════════                                                    │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  API Gateway (Next.js API Routes / Express)                    │    │
│  │  • POST /api/games/:id/commit   - Receive encrypted moves      │    │
│  │  • POST /api/games/:id/reveal   - Submit reveal data           │    │
│  │  • GET  /api/games/:id/state    - Fetch game state             │    │
│  │  • WS   /api/games/:id/ws       - Real-time updates            │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  Core Services                                                 │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                   │    │
│  │  │ Game State       │  │ Phase Engine     │                   │    │
│  │  │ Manager          │  │ Service          │                   │    │
│  │  │                  │  │                  │                   │    │
│  │  │ • State Machine  │  │ • Phase Transitions│                 │    │
│  │  │ • Actor Tracking │  │ • Turn Management│                   │    │
│  │  │ • Conflict Queue │  │ • Win Conditions │                   │    │
│  │  └──────────────────┘  └──────────────────┘                   │    │
│  │                                                                │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                   │    │
│  │  │ Conflict         │  │ Encryption       │                   │    │
│  │  │ Resolution       │  │ Service          │                   │    │
│  │  │ Engine           │  │                  │                   │    │
│  │  │                  │  │ • AES-256-GCM    │                   │    │
│  │  │ • RPS Logic      │  │ • Key Management │                   │    │
│  │  │ • Bet Processing │  │ • Decrypt on     │                   │    │
│  │  │ • Reward Calc    │  │   Reveal         │                   │    │
│  │  └──────────────────┘  └──────────────────┘                   │    │
│  │                                                                │    │
│  │  ┌──────────────────┐  ┌──────────────────┐                   │    │
│  │  │ Blockchain       │  │ Event Card       │                   │    │
│  │  │ Gateway          │  │ Service          │                   │    │
│  │  │                  │  │                  │                   │    │
│  │  │ • Avalanche MCP  │  │ • Chainlink VRF  │                   │    │
│  │  │ • Tx Submission  │  │ • Random Event   │                   │    │
│  │  │ • State Sync     │  │   Selection      │                   │    │
│  │  └──────────────────┘  └──────────────────┘                   │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  DATA LAYER                                                             │
│  ═══════════                                                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │
│  │ PostgreSQL       │  │ Redis Cache      │  │ Avalanche        │     │
│  │ (Game State)     │  │ (Session/State)  │  │ (Commitments)    │     │
│  │                  │  │                  │  │                  │     │
│  │ • Games table    │  │ • Active games   │  │ • Move hashes    │     │
│  │ • Players table  │  │ • Player sessions│  │ • Timestamps     │     │
│  │ • Moves table    │  │ • Phase state    │  │ • Reveal status  │     │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility | Technology |
|-----------|---------------|------------|
| **React Frontend** | UI rendering, user input, client-side encryption | Next.js 14, TypeScript |
| **Crypto Module** | Hash generation, salt creation, commitment building | ethers.js, crypto |
| **Wallet Integration** | Transaction signing, key management | MetaMask, WalletConnect |
| **API Gateway** | HTTP/WebSocket endpoints, request routing | Next.js API, Socket.io |
| **Game State Manager** | Authoritative game state, validation | Node.js, PostgreSQL |
| **Phase Engine** | Phase transitions, turn management | TypeScript state machine |
| **Conflict Resolution** | RPS logic, bet processing, rewards | Pure TypeScript functions |
| **Encryption Service** | AES encryption, key derivation | Node.js crypto module |
| **Blockchain Gateway** | Avalanche RPC, tx submission | Avalanche MCP Server |
| **Event Card Service** | Random event selection via VRF | Chainlink Functions |

---

## 3. Data Flow Architecture

### 3.1 Complete Game Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PHASE 2: DISTRIBUTION                            │
│                        (Player Commits Moves)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  STEP 1: Player Distributes Actors                                       │
│  ─────────────────────────────                                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  Player 1 Browser                                            │       │
│  │                                                              │       │
│  │  1. Select Actor: Politician                                 │       │
│  │  2. Choose Location: University                              │       │
│  │  3. Select Argument: Rock                                    │       │
│  │  4. Optional Bet: Lose (requires Electricity resource)       │       │
│  │                                                              │       │
│  │  Repeat for each Actor (Scientist, Artist, Robot)            │       │
│  │                                                              │       │
│  │  Final Distribution:                                         │       │
│  │  ┌─────────────────────────────────────────────────────┐    │       │
│  │  │ LU-AS-aP-BD  = Location:University, Actor:Scientist,│    │       │
│  │  │                Argument:Paper, Bet:Draw              │    │       │
│  │  │                                                      │    │       │
│  │  │ LS-AP-aR-BL  = Location:Square, Actor:Politician,   │    │       │
│  │  │                Argument:Rock, Bet:Lose               │    │       │
│  │  │                                                      │    │       │
│  │  │ LT-AA-aS-B0  = Location:Theatre, Actor:Artist,      │    │       │
│  │  │                Argument:Scissors, Bet:None           │    │       │
│  │  │                                                      │    │       │
│  │  │ LD-AR-aD-BW  = Location:Dump, Actor:Robot,          │    │       │
│  │  │                Argument:Dummy, Bet:Win               │    │       │
│  │  └─────────────────────────────────────────────────────┘    │       │
│  │                                                              │       │
│  │  Player clicks "Next Phase"                                  │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                           │                                             │
│                           ▼                                             │
│  STEP 2: Client-Side Encryption                                        │
│  ───────────────────────────                                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  Crypto Module (runs in browser)                             │       │
│  │                                                              │       │
│  │  1. Serialize moves to canonical string:                     │       │
│  │     data = "P1:LU-AS-aP-BD|LS-AP-aR-BL|LT-AA-aS-B0|LD-AR-aD-BW"│      │
│  │                                                              │       │
│  │  2. Generate cryptographic salt:                             │       │
│  │     salt = randomBytes(16) = "a7f3c9e2b1d4f6a8..."           │       │
│  │                                                              │       │
│  │  3. Create commitment string:                                │       │
│  │     commitment = data + "|" + salt                           │       │
│  │                                                              │       │
│  │  4. Hash with Keccak-256:                                    │       │
│  │     hash = keccak256(commitment)                             │       │
│  │     hash = "0x7f3a9c2e1b4d8f6a3e5c7d9b2a4f6e8c0d2b4a6..."   │       │
│  │                                                              │       │
│  │  5. Encrypt data with AES-256-GCM:                           │       │
│  │     key = deriveKey(playerPassword, salt)                    │       │
│  │     encrypted = AES_encrypt(data, key)                       │       │
│  │                                                              │       │
│  │  6. Send to Game Server:                                     │       │
│  │     POST /api/games/:id/commit                               │       │
│  │     {                                                        │       │
│  │       "playerId": "P1",                                      │       │
│  │       "hash": "0x7f3a...",                                   │       │
│  │       "encrypted": "0x9a4b...",                              │       │
│  │       "signature": "0x3c7d..."                               │       │
│  │     }                                                        │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                           │                                             │
│                           ▼                                             │
│  STEP 3: Game Server Receives Commitments                              │
│  ─────────────────────────────────                                     │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  Game Server                                                 │       │
│  │                                                              │       │
│  │  Server receives encrypted commitments from ALL players:     │       │
│  │                                                              │       │
│  │  ┌─────────────────────────────────────────────────────┐    │       │
│  │  │  Player 1: hash=0x7f3a..., encrypted=0x9a4b...      │    │       │
│  │  │  Player 2: hash=0x2b8c..., encrypted=0x4e1f...      │    │       │
│  │  │  Player 3: hash=0x5d9e..., encrypted=0x7c3a...      │    │       │
│  │  └─────────────────────────────────────────────────────┘    │       │
│  │                                                              │       │
│  │  Server CANNOT decrypt - only players have keys              │       │
│  │  Server CANNOT see moves - only cryptographic hashes         │       │
│  │                                                              │       │
│  │  Server validates:                                           │       │
│  │  ✓ All players submitted commitments                         │       │
│  │  ✓ Signatures are valid                                      │       │
│  │  ✓ Hashes are properly formatted                             │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                           │                                             │
│                           ▼                                             │
│  STEP 4: Blockchain Commitment                                         │
│  ───────────────────────────                                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  Blockchain Gateway (Avalanche MCP)                          │       │
│  │                                                              │       │
│  │  1. Server creates batch transaction:                        │       │
│  │     tx = {                                                   │       │
│  │       gameId: "game-123",                                    │       │
│  │       commitments: [                                         │       │
│  │         { player: "P1", hash: "0x7f3a..." },                 │       │
│  │         { player: "P2", hash: "0x2b8c..." },                 │       │
│  │         { player: "P3", hash: "0x5d9e..." }                  │       │
│  │       ],                                                     │       │
│  │       timestamp: Date.now()                                  │       │
│  │     }                                                        │       │
│  │                                                              │       │
│  │  2. Server signs with game's private key:                    │       │
│  │     signature = sign(tx, GAME_SERVER_PRIVATE_KEY)            │       │
│  │                                                              │       │
│  │  3. Submit to Avalanche C-Chain:                             │       │
│  │     txHash = avalanche.submitCommitment(tx, signature)       │       │
│  │                                                              │       │
│  │  4. Wait for confirmation (~1-2 seconds on Avalanche)        │       │
│  │                                                              │       │
│  │  5. Store txHash in game record:                             │       │
│  │     game.blockchainTxHash = txHash                           │       │
│  │     game.phase = 3  // Advance to Action Phase               │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PHASE 4: REVEAL                                  │
│                      (Players Reveal Moves)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  STEP 5: Players Reveal Moves                                            │
│  ───────────────────────────                                             │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  Player 1 Browser                                            │       │
│  │                                                              │       │
│  │  1. Player clicks "Reveal" in conflict UI                    │       │
│  │                                                              │       │
│  │  2. Client sends reveal data:                                │       │
│  │     POST /api/games/:id/reveal                               │       │
│  │     {                                                        │       │
│  │       "playerId": "P1",                                      │       │
│  │       "moves": [                                             │       │
│  │         {                                                    │       │
│  │           "actorId": "a1",                                   │       │
│  │           "actorType": "politician",                         │       │
│  │           "locationId": "university",                        │       │
│  │           "argument": "rock",                                │       │
│  │           "bet": "lose",                                     │       │
│  │           "salt": "a7f3c9e2b1d4f6a8..."                      │       │
│  │         },                                                   │       │
│  │         // ... more actors                                    │       │
│  │       ]                                                      │       │
│  │     }                                                        │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                           │                                             │
│                           ▼                                             │
│  STEP 6: Server Verifies Reveals                                       │
│  ─────────────────────────────                                         │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  Game Server - Encryption Service                            │       │
│  │                                                              │       │
│  │  For each revealed move:                                     │       │
│  │                                                              │       │
│  │  1. Reconstruct commitment string:                           │       │
│  │     data = serialize(move)                                   │       │
│  │     commitment = data + "|" + salt                           │       │
│  │                                                              │       │
│  │  2. Re-hash:                                                 │       │
│  │     recomputedHash = keccak256(commitment)                   │       │
│  │                                                              │       │
│  │  3. Compare with original hash from blockchain:              │       │
│  │     if (recomputedHash === originalHash) {                   │       │
│  │       ✓ Move is VALID - matches commitment                   │       │
│  │     } else {                                                 │       │
│  │       ✗ Move is INVALID - player cheated!                    │       │
│  │       // Player loses game, penalty applied                  │       │
│  │     }                                                        │       │
│  │                                                              │       │
│  │  4. Fetch original hash from Avalanche:                      │       │
│  │     originalHash = avalanche.getCommitment(gameId, playerId) │       │
│  │                                                              │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                           │                                             │
│                           ▼                                             │
│  STEP 7: Display Revealed State                                        │
│  ───────────────────────────                                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │  Game Server → All Players                                   │       │
│  │                                                              │       │
│  │  Server broadcasts revealed state via WebSocket:             │       │
│  │                                                              │       │
│  │  {                                                          │       │
│  │    "phase": 4,                                              │       │
│  │    "revealedMoves": {                                       │       │
│  │      "P1": [                                                │       │
│  │        { "actor": "politician", "location": "university",   │       │
│  │          "argument": "rock", "bet": "lose" }                │       │
│  │      ],                                                     │       │
│  │      "P2": [ ... ],                                         │       │
│  │      "P3": [ ... ]                                          │       │
│  │    },                                                       │       │
│  │    "conflicts": [                                           │       │
│  │      {                                                      │       │
│  │        "location": "university",                            │       │
│  │        "actors": ["P1:politician", "P2:politician"],        │       │
│  │        "conflictId": "university_politician"                │       │
│  │      }                                                      │       │
│  │    ]                                                        │       │
│  │  }                                                          │       │
│  │                                                              │       │
│  │  Players see:                                                │       │
│  │  ✓ All actors in each location                               │       │
│  │  ✓ All arguments (Rock/Paper/Scissors/Dummy)                 │       │
│  │  ✓ All bets (Win/Lose/Draw/None)                             │       │
│  │  ✓ Verification badge: "✓ Moves verified on Avalanche"       │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Format Specification

#### Move Serialization Format

```
Format: LOC-ACTOR-ARG-BET

Where:
  LOC  = Location ID (2 chars)
  ACTOR = Actor Type (2 chars)
  ARG  = Argument (2 chars)
  BET  = Bet Type (2 chars)

Location Codes:
  LU = University (Location: University)
  LS = Square (Location: Square)
  LT = Theatre (Location: Theatre)
  LF = Factory (Location: Factory)
  LP = Power Plant (Location: Power Plant)
  LD = Dump (Location: Dump)

Actor Codes:
  AP = Politician (Actor: Politician)
  AS = Scientist (Actor: Scientist)
  AA = Artist (Actor: Artist)
  AR = Robot (Actor: Robot)

Argument Codes:
  aR = Rock (argument: Rock)
  aP = Paper (argument: Paper)
  aS = Scissors (argument: Scissors)
  aD = Dummy (argument: Dummy)

Bet Codes:
  BW = Win (Bet: Win - requires Product resource)
  BL = Lose (Bet: Lose - requires Electricity resource)
  BD = Draw (Bet: Draw - requires Recycling resource)
  B0 = None (No bet)

Example:
  "LU-AS-aP-BD" = University, Scientist, Paper, Bet on Draw
  "LS-AP-aR-BL" = Square, Politician, Rock, Bet on Lose
  "LT-AA-aS-B0" = Theatre, Artist, Scissors, No Bet
  "LD-AR-aD-BW" = Dump, Robot, Dummy, Bet on Win
```

#### Complete Commitment String

```javascript
// Player 1's complete distribution
const player1Moves = "P1:LU-AS-aP-BD|LS-AP-aR-BL|LT-AA-aS-B0|LD-AR-aD-BW";

// Player 2's complete distribution
const player2Moves = "P2:LU-AP-aS-B0|LS-AA-aR-BD|LT-AS-aP-BL|LF-AR-aD-BW";

// Player 3's complete distribution
const player3Moves = "P3:LS-AP-aP-BW|LT-AA-aS-B0|LU-AS-aR-BL|LP-AR-aD-BD";

// Full commitment string (includes salt)
const commitment = `${player1Moves}|${player2Moves}|${player3Moves}|${salt}`;

// Hash for blockchain
const hash = keccak256(commitment);
```

---

## 4. On-Chain vs Off-Chain Logic

### 4.1 Architecture Decision Matrix

| Function | Location | Rationale |
|----------|----------|-----------|
| **Move Commitment (Hash)** | On-Chain | Immutable proof, timestamp, public verification |
| **Move Data (Encrypted)** | Off-Chain | Privacy, storage cost optimization |
| **Move Reveal** | Off-Chain | Computation efficiency, gas cost reduction |
| **Hash Verification** | Both | Server verifies, hash anchored on-chain |
| **Conflict Resolution** | Off-Chain | Complex logic, gas cost prohibitive |
| **Phase Transitions** | Off-Chain | Real-time responsiveness required |
| **Random Event Selection** | On-Chain (VRF) | Provably fair, tamper-proof |
| **Game Result Finalization** | On-Chain | Immutable record, prize distribution |
| **Player Authentication** | Off-Chain | Session management, performance |
| **Resource Tracking** | Off-Chain | Frequent updates, state complexity |

### 4.2 On-Chain Components

```solidity
// contracts/MetarchyCommitment.sol
// Purpose: Immutable record of player commitments

contract MetarchyCommitment {
    struct Commitment {
        bytes32 moveHash;
        address player;
        uint256 gameId;
        uint256 timestamp;
        bool revealed;
    }
    
    mapping(bytes32 => Commitment) public commitments;
    mapping(uint256 => bytes32[]) public gameCommitments;
    
    event CommitmentSubmitted(
        uint256 indexed gameId,
        bytes32 indexed moveHash,
        address indexed player,
        uint256 timestamp
    );
    
    event MoveRevealed(
        uint256 indexed gameId,
        bytes32 indexed moveHash,
        string moveData,
        string salt
    );
    
    function submitCommitment(
        uint256 gameId,
        bytes32 moveHash,
        bytes memory signature
    ) external {
        // Verify signature
        address signer = recoverSigner(moveHash, signature);
        require(signer == msg.sender, "Invalid signature");
        
        // Store commitment
        commitments[moveHash] = Commitment({
            moveHash: moveHash,
            player: msg.sender,
            gameId: gameId,
            timestamp: block.timestamp,
            revealed: false
        });
        
        gameCommitments[gameId].push(moveHash);
        
        emit CommitmentSubmitted(gameId, moveHash, msg.sender, block.timestamp);
    }
    
    function reveal(
        uint256 gameId,
        string memory moveData,
        string memory salt
    ) external {
        bytes32 moveHash = keccak256(abi.encodePacked(moveData, "|", salt));
        Commitment storage commitment = commitments[moveHash];
        
        require(commitment.player == msg.sender, "No commitment");
        require(!commitment.revealed, "Already revealed");
        
        commitment.revealed = true;
        
        emit MoveRevealed(gameId, moveHash, moveData, salt);
    }
}
```

### 4.3 Off-Chain Components

```typescript
// server/services/ConflictResolutionService.ts
// Purpose: Complex game logic (too expensive for on-chain)

class ConflictResolutionService {
    resolveConflict(conflict: Conflict): ConflictResult {
        // 1. Parse arguments
        const choices = conflict.actors.map(a => a.argument);
        
        // 2. Apply RPS rules for 3+ players
        const winners = this.determineWinners(choices);
        const losers = this.determineLosers(choices);
        
        // 3. Process bets
        const successfulBids = this.processBets(conflict.actors, winners, losers);
        
        // 4. Apply actor-type specific rules
        if (conflict.actorType === 'politician' && this.isDraw(choices)) {
            return { restart: true, ... }; // Re-roll
        }
        
        if (conflict.actorType === 'artist' && this.isDraw(choices)) {
            return { evictAll: true, ... }; // All lose
        }
        
        // 5. Calculate rewards
        const rewards = this.calculateRewards(winners, successfulBids);
        
        return { winners, losers, rewards, successfulBids };
    }
}
```

### 4.4 Hybrid Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ON-CHAIN vs OFF-CHAIN RESPONSIBILITIES               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ON-CHAIN (Avalanche)                    OFF-CHAIN (Game Server)        │
│  ════════════════                        ════════════════               │
│                                                                          │
│  ┌────────────────────────────┐          ┌────────────────────────────┐ │
│  │  Immutable Record          │          │  Real-Time Processing      │ │
│  │                            │          │                            │ │
│  │  ✓ Commitment hashes       │◀────────│  • Move encryption         │ │
│  │  ✓ Timestamps              │          │  • State management        │ │
│  │  ✓ Player addresses        │          │  • Phase transitions       │ │
│  │  ✓ Reveal status           │────────▶│  • Conflict resolution     │ │
│  │  ✓ Event card RNG (VRF)    │          │  • Reward calculation      │ │
│  │  ✓ Game result finalization│          │  • Player matchmaking      │ │
│  └────────────────────────────┘          └────────────────────────────┘ │
│                                                                          │
│         ▲                                       ▼                        │
│         │                                       │                        │
│         │  1. Hash submitted                    │  2. Encrypted data     │
│         │     (public proof)                    │     stored privately   │
│         │                                       │                        │
│         │  3. Reveal verified                   │  4. Decryption keys    │
│         │     (hash match)                      │     held by players    │
│         │                                       │                        │
│         ▼                                       ▼                        │
│                                                                          │
│  TRUST MODEL:                            TRUST MODEL:                    │
│  - Trustless (code-enforced)               - Minimized (hash-anchored)   │
│  - Publicly verifiable                     - Privacy-preserving          │
│  - Immutable                               - Performant                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Integration Points

### 5.1 Avalanche Integration

```typescript
// server/services/AvalancheMCPService.ts

import { Avalanche } from '@avalabs/avalanchejs';
import { MCPClient } from '@avalanche/mcp-server';

class AvalancheMCPService {
    private mcp: MCPClient;
    private gameServerWallet: Wallet;
    
    constructor() {
        this.mcp = new MCPClient({
            network: 'mainnet', // or 'fuji' for testnet
            rpcUrl: process.env.AVALANCHE_RPC_URL
        });
        
        this.gameServerWallet = Wallet.fromPrivateKey(
            process.env.GAME_SERVER_PRIVATE_KEY
        );
    }
    
    async submitCommitment(
        gameId: string,
        commitments: PlayerCommitment[]
    ): Promise<string> {
        // 1. Create commitment batch
        const batch = {
            gameId,
            commitments: commitments.map(c => ({
                player: c.playerId,
                hash: c.hash
            })),
            timestamp: Date.now()
        };
        
        // 2. Sign with game server key
        const signature = await this.gameServerWallet.sign(batch);
        
        // 3. Submit via MCP Server
        const txHash = await this.mcp.submitCommitment({
            contractAddress: process.env.COMMITMENT_CONTRACT_ADDRESS,
            batch,
            signature
        });
        
        // 4. Wait for confirmation
        await this.mcp.waitForConfirmation(txHash);
        
        return txHash;
    }
    
    async getCommitment(
        gameId: string,
        playerId: string
    ): Promise<CommitmentData> {
        return await this.mcp.getCommitment({
            contractAddress: process.env.COMMITMENT_CONTRACT_ADDRESS,
            gameId,
            playerId
        });
    }
    
    async verifyReveal(
        originalHash: string,
        revealedData: string,
        salt: string
    ): Promise<boolean> {
        const recomputedHash = keccak256(revealedData + '|' + salt);
        return recomputedHash.toLowerCase() === originalHash.toLowerCase();
    }
}
```

### 5.2 Chainlink VRF Integration

```typescript
// server/services/EventCardService.ts

import { ChainlinkVRF } from '@chainlink/vrf-client';

class EventCardService {
    private vrf: ChainlinkVRF;
    private eventCards = [
        'political_repression',
        'educational_crisis',
        'cultural_decline',
        'revolution',
        'help_poor_countries',
        'earth_hour',
        'prevent_eco_crisis'
    ];
    
    async selectRandomEvent(gameId: string): Promise<EventCard> {
        // Request random number from Chainlink VRF
        const requestId = await this.vrf.requestRandomness({
            subscriptionId: process.env.CHAINLINK_SUBSCRIPTION_ID,
            callbackGasLimit: 100000,
            numValues: 1
        });
        
        // Wait for VRF fulfillment
        const randomWords = await this.vrf.waitForFulfillment(requestId);
        
        // Select event card (randomWords[0] % 7)
        const randomIndex = randomWords[0] % this.eventCards.length;
        const selectedEvent = this.eventCards[randomIndex];
        
        // Log for audit
        await this.logEventSelection(gameId, selectedEvent, requestId);
        
        return this.getEventCard(selectedEvent);
    }
    
    private async logEventSelection(
        gameId: string,
        event: string,
        vrfRequestId: number
    ) {
        // Store on-chain for public verification
        await this.mcp.logEventSelection({ gameId, event, vrfRequestId });
    }
}
```

---

## 6. Security Architecture

### 6.1 Defense Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SECURITY DEFENSE LAYERS                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Layer 1: Client-Side Encryption                                        │
│  ═══════════════════════════════                                        │
│  - Moves encrypted BEFORE leaving browser                               │
│  - Server never sees plaintext until reveal                             │
│  - AES-256-GCM with player-derived keys                                 │
│                                                                          │
│  Layer 2: Cryptographic Commitment                                      │
│  ═══════════════════════════════                                        │
│  - Keccak-256 hash of moves + salt                                      │
│  - Salt prevents rainbow table attacks                                  │
│  - Hash submitted to blockchain (immutable)                             │
│                                                                          │
│  Layer 3: Digital Signatures                                            │
│  ═══════════════════════════════                                        │
│  - ECDSA signatures on all commitments                                  │
│  - Prevents replay attacks                                              │
│  - Verifies player identity                                             │
│                                                                          │
│  Layer 4: Blockchain Anchoring                                          │
│  ═══════════════════════════════                                        │
│  - Hashes permanently recorded on Avalanche                             │
│  - Timestamps prove commitment timing                                   │
│  - Publicly verifiable by anyone                                        │
│                                                                          │
│  Layer 5: Reveal Verification                                           │
│  ═══════════════════════════════                                        │
│  - Recompute hash from revealed data                                    │
│  - Compare with original blockchain hash                                │
│  - Mismatch = player cheated (automatic loss)                           │
│                                                                          │
│  Layer 6: Chainlink VRF                                                 │
│  ═══════════════════════════════                                        │
│  - Provably fair random number generation                               │
│  - Server cannot manipulate event selection                             │
│  - Verifiable on-chain                                                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Attack Vector Analysis

| Attack Vector | Mitigation | Effectiveness |
|--------------|------------|---------------|
| **Server sees moves early** | Client-side encryption | ✅ Prevented |
| **Server changes moves post-commit** | Blockchain hash anchor | ✅ Prevented |
| **Player changes move after seeing others** | Hash verification on reveal | ✅ Prevented |
| **Server rigs event cards** | Chainlink VRF | ✅ Prevented |
| **Player reuses old commitment** | Salt (unique per game) | ✅ Prevented |
| **Hacker breaches server DB** | Only encrypted data stored | ✅ Mitigated |
| **Insider threat (admin)** | Zero-knowledge architecture | ✅ Prevented |
| **Front-running** | Commit-reveal scheme | ✅ Prevented |

---

## 7. Deployment Architecture

### 7.1 Production Deployment

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       PRODUCTION DEPLOYMENT                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  AWS / GCP / Azure (Cloud Provider)                            │     │
│  │                                                                │     │
│  │  ┌──────────────────┐  ┌──────────────────┐                   │     │
│  │  │  Game Server     │  │  Game Server     │                   │     │
│  │  │  (Primary)       │  │  (Replica)       │                   │     │
│  │  │                  │  │                  │                   │     │
│  │  │  • Node.js 20    │  │  • Node.js 20    │                   │     │
│  │  │  • Next.js 14    │  │  • Next.js 14    │                   │     │
│  │  │  • PostgreSQL    │  │  • PostgreSQL    │                   │     │
│  │  │  • Redis         │  │  • Redis         │                   │     │
│  │  └──────────────────┘  └──────────────────┘                   │     │
│  │         │                       │                              │     │
│  │         ▼                       ▼                              │     │
│  │  ┌──────────────────────────────────────────┐                 │     │
│  │  │         Load Balancer (NGINX)            │                 │     │
│  │  └──────────────────────────────────────────┘                 │     │
│  │         │                                                      │     │
│  │         ▼                                                      │     │
│  │  ┌──────────────────────────────────────────┐                 │     │
│  │  │         Cloudflare CDN                   │                 │     │
│  │  │         • DDoS Protection                │                 │     │
│  │  │         • SSL Termination                │                 │     │
│  │  │         • Static Asset Caching           │                 │     │
│  │  └──────────────────────────────────────────┘                 │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │  Avalanche C-Chain (Mainnet)                                   │     │
│  │                                                                │     │
│  │  ┌──────────────────┐  ┌──────────────────┐                   │     │
│  │  │  Commitment      │  │  MetarchyGame    │                   │     │
│  │  │  Contract        │  │  Contract        │                   │     │
│  │  └──────────────────┘  └──────────────────┘                   │     │
│  │                                                                │     │
│  │  ┌──────────────────┐                                          │     │
│  │  │  Chainlink VRF   │                                          │     │
│  │  └──────────────────┘                                          │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Environment Configuration

```bash
# .env.production

# Game Server
GAME_SERVER_PRIVATE_KEY=0x...  # Avalanche wallet for tx signing
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@db.example.com:5432/metarchy
REDIS_URL=redis://redis.example.com:6379

# Avalanche
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
COMMITMENT_CONTRACT_ADDRESS=0x...
GAME_CONTRACT_ADDRESS=0x...
CHAIN_ID=43114  # Avalanche Mainnet

# Chainlink
CHAINLINK_VRF_COORDINATOR=0x...
CHAINLINK_SUBSCRIPTION_ID=12345
CHAINLINK_KEY_HASH=0x...

# Security
JWT_SECRET=...
ENCRYPTION_KEY=...
CORS_ORIGIN=https://metarchy.io
```

---

## 8. Monitoring & Observability

### 8.1 Key Metrics

```typescript
// server/metrics/GameMetrics.ts

class GameMetrics {
    // Performance
    @metric('game.phase_transition_duration_seconds')
    phaseTransitionDuration: Histogram;
    
    @metric('game.conflict_resolution_duration_ms')
    conflictResolutionDuration: Histogram;
    
    // Blockchain
    @metric('blockchain.commitment_submission_duration_seconds')
    commitmentSubmissionDuration: Histogram;
    
    @metric('blockchain.gas_cost_wei')
    gasCost: Counter;
    
    // Security
    @metric('security.reveal_verification_failures_total')
    revealFailures: Counter;
    
    @metric('security.invalid_signature_attempts_total')
    invalidSignatures: Counter;
    
    // Business
    @metric('games.active_games')
    activeGames: Gauge;
    
    @metric('games.completed_games_total')
    completedGames: Counter;
}
```

### 8.2 Audit Trail

```typescript
// server/services/AuditService.ts

class AuditService {
    async logCommitment(gameId: string, playerId: string, hash: string) {
        await this.auditLog.create({
            eventType: 'COMMITMENT_SUBMITTED',
            gameId,
            playerId,
            data: { hash },
            timestamp: new Date(),
            blockchainTxHash: null // Will be updated after submission
        });
    }
    
    async logReveal(gameId: string, playerId: string, verified: boolean) {
        await this.auditLog.create({
            eventType: 'MOVE_REVEALED',
            gameId,
            playerId,
            data: { verified },
            timestamp: new Date(),
            blockchainTxHash: null
        });
        
        if (!verified) {
            // Alert security team
            await this.alertSecurityTeam('CHEAT_DETECTED', { gameId, playerId });
        }
    }
    
    async logEventSelection(gameId: string, event: string, vrfRequestId: number) {
        await this.auditLog.create({
            eventType: 'EVENT_CARD_SELECTED',
            gameId,
            data: { event, vrfRequestId },
            timestamp: new Date(),
            blockchainTxHash: vrfRequestId // Chainlink tx
        });
    }
}
```

---

## 9. Glossary

| Term | Definition |
|------|------------|
| **Commitment** | Cryptographic hash of player's moves, submitted before reveal |
| **Reveal** | Player discloses actual moves + salt for verification |
| **Salt** | Random data preventing rainbow table attacks |
| **Keccak-256** | SHA-3 variant used for hashing in Ethereum/Avalanche |
| **ECDSA** | Elliptic Curve Digital Signature Algorithm |
| **VRF** | Verifiable Random Function (Chainlink) |
| **MCP Server** | Avalanche Model Context Protocol for blockchain interaction |
| **Zero-Knowledge** | Server cannot see moves until players reveal |
| **On-Chain** | Executed and stored on blockchain |
| **Off-Chain** | Executed by game server (not on blockchain) |

---

**Document Version:** 1.0  
**Last Updated:** March 2026  
**Status:** Draft for Review  
**Next Review:** After blockchain integration phase
