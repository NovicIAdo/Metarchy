# Metarchy Technical Architecture

## Executive Summary

Metarchy is a turn-based strategy game combining psychological deduction, resource management, and cryptographic fairness guarantees. Built on a hybrid Web2/Web3 architecture, Metarchy ensures provably fair gameplay through Avalanche blockchain integration while maintaining responsive user experience through traditional web infrastructure.

---

## 1. Technology Stack

### 1.1 Frontend Layer

```
Framework:      Next.js 14 (React 18)
Language:       TypeScript 5.x
Styling:        Tailwind CSS + Custom SVG
State:          React Context API + useState/useEffect
Routing:        Next.js App Router (file-based)
UI Components:  Custom-built (no component libraries)
Animation:      Framer Motion
```

**Directory Structure:**
```
frontend/
├── app/                    # Next.js App Router
│   ├── game/
│   │   ├── board/[id]/     # Main game interface
│   │   ├── lobby/[id]/     # Pre-game lobby
│   │   └── create/         # Game creation
│   └── api/                # API routes (Next.js serverless)
├── components/             # React components
│   ├── game/               # Game-specific UI
│   └── ui/                 # Reusable UI elements
├── context/                # React Context providers
├── lib/                    # Core game logic
│   ├── modules/            # Domain-specific logic
│   │   ├── conflict/       # RPS conflict resolution
│   │   ├── phase/          # Phase engine
│   │   ├── resources/      # Resource management
│   │   └── core/           # Types, constants
│   └── game/               # Game flow logic
└── data/                   # Static game data
```

### 1.2 Backend Layer (Current - Web2)

```
Runtime:        Node.js 20.x
API:            Next.js API Routes (serverless functions)
Database:       JSON file storage (development)
Real-time:      Polling (2-3 second intervals)
Authentication: Guest sessions (citizenId-based)
```

**Current Limitations:**
- Centralized game state storage
- No cryptographic proof of move integrity
- Vulnerable to server-side manipulation
- Suitable for development and testing only

### 1.3 Blockchain Layer (Planned - Web3)

```
Blockchain:     Avalanche C-Chain (EVM-compatible)
Smart Contracts: Solidity 0.8.x
Oracle:         Chainlink VRF (Verifiable Random Function)
Storage:        IPFS (decentralized file storage)
Encryption:     ECDSA (Elliptic Curve Digital Signature Algorithm)
Commitment:     Keccak-256 hashing (SHA-3 variant)
```

**Why Avalanche:**
- **Sub-second finality** - Critical for real-time gameplay
- **Low transaction costs** - ~$0.01 per transaction vs Ethereum's $5-50
- **EVM compatibility** - Easy Solidity smart contract deployment
- **High throughput** - 4,500+ TPS supports massive player base
- **Carbon neutral** - Environmentally sustainable consensus

---

## 2. Core Game Architecture

### 2.1 Phase Engine Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Game State Machine                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Turn 1          Turn 2-5         Final Turn     Tie-Breaker│
│  ┌────┐         ┌────────┐        ┌────────┐     ┌────────┐ │
│  │ P2 │────────▶│  P1    │────────▶│  P1-4  │────▶│  P5    │ │
│  └────┘         └────────┘        └────────┘     └────────┘ │
│     ▲              │  │               │  │          │       │
│     │              ▼  ▼               ▼  ▼          ▼       │
│     │         ┌────────┐        ┌────────┐     ┌────────┐   │
│     └─────────│  P5    │        │  P5    │     │ GAME   │   │
│               └────────┘        └────────┘     │  END   │   │
│                                                └────────┘   │
└─────────────────────────────────────────────────────────────┘

P1 = Event Phase        P3 = Action Phase
P2 = Distribution       P4 = Conflicts Reveal
P5 = Market Phase
```

**Implementation:** `frontend/lib/game/PhaseEngine.ts`

```typescript
// Pure function state machine
export function handleNextPhase(input: PhaseInput): PhaseOutput {
    // 1. Check win conditions
    if (phase === 4 && turn >= maxTurns) {
        return calculateWinner();
    }
    
    // 2. Advance phase or turn
    if (phase < 5) {
        return { phase: phase + 1 };
    } else {
        return { turn: turn + 1, phase: 1 };
    }
}
```

### 2.2 Conflict Resolution System

**Algorithm:** Multi-player Rock-Paper-Scissors with iterative elimination

```typescript
// Core logic: frontend/lib/modules/conflict/conflictResolver.ts

interface ConflictResult {
    winnerId: string | null;      // Single winner (if any)
    loserIds: string[];           // Eliminated players
    survivorIds: string[];        // Players advancing to next round
    isDraw: boolean;
    restart: boolean;             // Politician re-roll trigger
    successfulBids: Bid[];        // Activated bets
}

function resolveConflictLogic(
    localPlayerId: string,
    playerChoice: string,
    applyBids: boolean,
    conflict: Conflict,
    opponentChoices: { [id: string]: string }
): ConflictResult {
    // 1. Build participant array
    const participants = [player, ...opponents];
    
    // 2. Filter out Dummy choices for RPS calculation
    const choicesValues = participants
        .filter(p => p.choice !== 'dummy')
        .map(p => p.choice);
    
    // 3. Determine winners/losers using 3+ player RPS rules
    // - Win: Beats at least one, beaten by none
    // - Lose: Beaten by at least one
    // - Draw: All same OR all three types present
    
    // 4. Apply bets (only on first round)
    // - Product (Win): +1 resource bonus
    // - Electricity (Lose): Force re-roll
    // - Recycling (Draw): Convert draw to win
    
    // 5. Apply actor-type specific rules
    // - Politician: Re-roll on draw
    // - Artist: All lose on draw
    // - Scientist/Robot: Share rewards on draw
    
    return { winnerId, loserIds, survivorIds, ... };
}
```

**Key Design Decisions:**

1. **Dummy Always Loses** (except vs Dummy)
   - Prevents stalemate strategies
   - Creates risk/reward dynamic for "safe" plays

2. **Iterative Elimination**
   - 3+ player conflicts resolve in rounds
   - Losers exit immediately
   - Survivors re-roll until single winner or type-specific draw

3. **Bets Burn After First Round**
   - Prevents infinite bet exploitation
   - Electricity bid triggers re-roll without bet effects

---

## 3. Cryptographic Proof System (The Oracle Problem)

### 3.1 The Problem: Centralized Trust

**Traditional Web2 Architecture:**
```
Player Client ──▶ Central Server ──▶ Database
     │                  │
     │                  ▼
     │            [VULNERABILITY]
     │            - Admin can see all moves
     │            - Hacker can breach server
     │            - Moves can be changed post-commitment
     ▼
[Player B's move visible to Player A before reveal]
```

**Attack Vectors:**
1. **Insider Threat** - Server admin sees Player A's move before Player B commits
2. **Database Breach** - Hacker accesses unencrypted move data
3. **Post-Hoc Manipulation** - Server changes moves after seeing outcomes
4. **Rigged RNG** - Server manipulates random event card selection

**Why This Matters for Metarchy:**
- Players bet real value (cryptocurrency, NFTs)
- Single conflict can determine game outcome
- Trust in "black box" server is unacceptable for high-stakes play

### 3.2 The Solution: Commit-Reveal Scheme

**Cryptographic Commitment Flow:**

```
┌──────────────────────────────────────────────────────────────┐
│                 PHASE 2: DISTRIBUTION (Commit)                │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Player Device                    Blockchain                   │
│  ┌─────────────┐                  ┌─────────────┐            │
│  │  Actor:     │                  │             │            │
│  │  Politician │                  │  Transaction│            │
│  │  Location:  │                  │  Hash:      │            │
│  │  Square     │                  │  0x7f3a...  │───────────▶│
│  │  Argument:  │                  │             │            │
│  │  Rock       │                  │  Timestamp: │            │
│  │  Bet: Lose  │                  │  1710234567 │            │
│  └──────┬──────┘                  └─────────────┘            │
│         │                                                    │
│         │ 1. Generate random salt                            │
│         │    salt = "a7f3c9e2b1d4"                           │
│         │                                                    │
│         │ 2. Create commitment string                        │
│         │    data = "politician:square:rock:lose:a7f3c9e2b1d4"│
│         │                                                    │
│         │ 3. Hash with Keccak-256                            │
│         │    hash = keccak256(data)                          │
│         │    hash = 0x7f3a9c2e1b4d8f6a3e5c7d9b2a4f6e8c0d2b4a6│
│         │                                                    │
│         │ 4. Sign with ECDSA                                 │
│         │    signature = sign(hash, privateKey)              │
│         │                                                    │
│         │ 5. Submit to Avalanche C-Chain                     │
│         │    txHash = avalanche.submit(hash, signature)      │
│         │                                                    │
│         ▼                                                    │
│  [COMMITTED] - Move is now immutable & hidden                │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────────────────┐
│                 PHASE 4: REVEAL (Open)                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  Player Device                    Verifier                    │
│  ┌─────────────┐                  ┌─────────────┐            │
│  │  Reveal:    │                  │             │            │
│  │  Actor:     │                  │  1. Fetch   │            │
│  │  Politician │──────data───────▶│  tx from    │            │
│  │  Location:  │     +salt        │  Avalanche  │            │
│  │  Square     │                  │             │            │
│  │  Argument:  │                  │  2. Re-hash │            │
│  │  Rock       │                  │  submitted  │            │
│  │  Bet: Lose  │                  │  data       │            │
│  │  Salt:      │                  │             │            │
│  │  a7f3c9e2   │                  │  3. Compare │            │
│  └─────────────┘                  │  hashes     │            │
│                                   │             │            │
│                                   │  hash' ===│            │
│                                   │  hash?    │            │
│                                   │             │            │
│                                   │  ✅ MATCH   │            │
│                                   │  Move is    │            │
│                                   │  VALID      │            │
│                                   └─────────────┘            │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 Implementation Architecture

#### Current (Web2 - Development)

```typescript
// frontend/app/game/board/[id]/page.tsx

const commitTurn = async () => {
    // ❌ VULNERABLE: Plain text moves sent to server
    const moves = placedActors.map(actor => ({
        actorId: actor.actorId,
        locId: actor.locId,
        type: actor.type,  // ← EXPOSED
        bid: actor.bid     // ← EXPOSED
    }));
    
    await fetch(`/api/games/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ action: 'commit', moves })
    });
};
```

**Security Issues:**
- Moves visible in network tab
- Server can see all moves before reveal
- No cryptographic proof of commitment timing
- Database breach exposes all strategies

#### Planned (Web3 - Production)

```typescript
// frontend/lib/crypto/commitment.ts

import { keccak256 } from 'ethers/lib/utils';
import { ethers } from 'ethers';

interface MoveCommitment {
    actorType: string;
    locationId: string;
    argument: string;
    bet: string | null;
    salt: string;  // Cryptographically random
}

export function createCommitment(move: MoveCommitment): {
    hash: string;
    signature: string;
    timestamp: number;
} {
    // 1. Generate cryptographically secure salt
    const salt = ethers.utils.hexlify(ethers.utils.randomBytes(16));
    // salt = "0xa7f3c9e2b1d4f6a8c0e2b4d6f8a0c2e4"
    
    // 2. Create canonical string (sorted keys for consistency)
    const data = JSON.stringify({
        actorType: move.actorType,
        locationId: move.locationId,
        argument: move.argument,
        bet: move.bet || null,
        salt: salt
    });
    
    // 3. Hash with Keccak-256
    const hash = keccak256(ethers.utils.toUtf8Bytes(data));
    // hash = "0x7f3a9c2e1b4d8f6a3e5c7d9b2a4f6e8c0d2b4a6..."
    
    // 4. Sign with player's private key (stored in wallet)
    const signer = await getSigner(); // From MetaMask/WalletConnect
    const signature = await signer.signMessage(ethers.utils.arrayify(hash));
    
    // 5. Submit to Avalanche C-Chain
    const tx = await submitToBlockchain(hash, signature);
    
    return {
        hash,
        signature,
        timestamp: Date.now()
    };
}

export function verifyReveal(
    originalHash: string,
    revealedMove: MoveCommitment
): boolean {
    // 1. Re-create commitment string
    const data = JSON.stringify(revealedMove);
    
    // 2. Re-hash
    const recomputedHash = keccak256(ethers.utils.toUtf8Bytes(data));
    
    // 3. Compare hashes
    return recomputedHash.toLowerCase() === originalHash.toLowerCase();
}
```

#### Smart Contract (Solidity)

```solidity
// contracts/MetarchyGame.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MetarchyGame {
    struct MoveCommitment {
        bytes32 hash;
        address player;
        uint256 timestamp;
        bool revealed;
    }
    
    mapping(bytes32 => MoveCommitment) public commitments;
    mapping(uint256 => bytes32[]) public gameMoves; // gameId => move hashes
    
    event MoveCommitted(
        uint256 indexed gameId,
        bytes32 indexed hash,
        address indexed player,
        uint256 timestamp
    );
    
    event MoveRevealed(
        uint256 indexed gameId,
        bytes32 indexed hash,
        string actorType,
        string locationId,
        string argument,
        string bet
    );
    
    function commitMove(
        uint256 gameId,
        bytes32 moveHash,
        bytes memory signature
    ) external {
        // 1. Verify signature matches sender
        address signer = recoverSigner(moveHash, signature);
        require(signer == msg.sender, "Invalid signature");
        
        // 2. Store commitment
        commitments[moveHash] = MoveCommitment({
            hash: moveHash,
            player: msg.sender,
            timestamp: block.timestamp,
            revealed: false
        });
        
        // 3. Add to game's move list
        gameMoves[gameId].push(moveHash);
        
        emit MoveCommitted(gameId, moveHash, msg.sender, block.timestamp);
    }
    
    function revealMove(
        uint256 gameId,
        string memory actorType,
        string memory locationId,
        string memory argument,
        string memory bet,
        string memory salt
    ) external {
        // 1. Re-create hash from revealed data
        bytes32 revealedHash = keccak256(
            abi.encodePacked(actorType, locationId, argument, bet, salt)
        );
        
        // 2. Verify commitment exists
        MoveCommitment storage commitment = commitments[revealedHash];
        require(commitment.player == msg.sender, "No commitment found");
        require(!commitment.revealed, "Already revealed");
        
        // 3. Mark as revealed
        commitment.revealed = true;
        
        emit MoveRevealed(
            gameId,
            revealedHash,
            actorType,
            locationId,
            argument,
            bet
        );
    }
    
    function recoverSigner(
        bytes32 hash,
        bytes memory signature
    ) pure internal returns (address) {
        // ECDSA signature recovery
        (uint8 v, bytes32 r, bytes32 s) = splitSignature(signature);
        return ecrecover(hash, v, r, s);
    }
}
```

### 3.4 Random Number Generation (Event Cards)

**Problem:** Server-controlled RNG can be manipulated to favor certain players.

**Solution:** Chainlink VRF (Verifiable Random Function)

```solidity
// contracts/MetarchyRNG.sol
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";

contract MetarchyRNG is VRFConsumerBaseV2 {
    VRFCoordinatorV2Interface COORDINATOR;
    uint64 s_subscriptionId;
    uint32 callbackGasLimit = 100000;
    uint16 requestConfirmations = 3;
    uint32 numValues = 7; // 7 Event Cards
    
    mapping(uint256 => uint256[]) public randomNumbers;
    
    constructor(address vrfCoordinator) VRFConsumerBaseV2(vrfCoordinator) {
        COORDINATOR = VRFCoordinatorV2Interface(vrfCoordinator);
    }
    
    function requestRandomEvent(uint256 gameId) external returns (uint256 requestId) {
        requestId = COORDINATOR.requestRandomWords(
            keyHash,
            s_subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            numValues
        );
    }
    
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {
        randomNumbers[requestId] = randomWords;
        // Use randomWords[0] % 7 to select Event Card
        // Provably fair - generated by Chainlink, verifiable on-chain
    }
}
```

**Why Chainlink VRF:**
- **Tamper-proof** - Generated off-chain, verified on-chain
- **Auditable** - Anyone can verify randomness source
- **Unpredictable** - Cannot be manipulated by players or server
- **Decentralized** - No single point of failure

### 3.5 Architecture Comparison

| Feature | Web2 (Current) | Web3 (Planned) |
|---------|---------------|----------------|
| **Move Storage** | Plain text JSON | Keccak-256 hash |
| **Commitment** | Server timestamp | Avalanche block timestamp |
| **Reveal Verification** | Server trust | Hash comparison |
| **RNG Source** | `Math.random()` | Chainlink VRF |
| **Audit Trail** | Server logs | Blockchain transactions |
| **Trust Model** | Centralized | Trustless |
| **Breach Impact** | All moves exposed | Only hashes exposed |
| **Post-Hoc Changes** | Possible | Cryptographically impossible |

---

## 4. Data Flow Architecture

### 4.1 Current Flow (Web2)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Player    │────▶│   Next.js   │────▶│   JSON      │
│   Browser   │◀────│   API       │◀────│   Storage   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │ 1. Place Actor     │                    │
      │───────────────────▶│                    │
      │                    │ 2. Save to file    │
      │                    │───────────────────▶│
      │                    │                    │
      │ 3. Poll every 2s   │                    │
      │◀───────────────────│                    │
      │ 4. Updated state   │                    │
      │                    │ 5. Read from file  │
      │                    │◀───────────────────│
```

### 4.2 Planned Flow (Web3)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Player    │────▶│   Next.js   │────▶│   Avalanche │
│   Browser   │     │   Frontend  │     │   C-Chain   │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │                    │
      │ 1. Create move     │                    │
      │ 2. Hash + sign     │                    │
      │───────────────────▶│                    │
      │                    │ 3. Submit tx       │
      │                    │───────────────────▶│
      │                    │                    │ 4. Store hash
      │                    │                    │
      │ 5. Reveal move     │                    │
      │───────────────────▶│                    │
      │                    │ 6. Verify hash     │
      │                    │───────────────────▶│
      │                    │                    │
      │ 7. Resolve conflict│                    │
      │◀───────────────────│                    │
```

---

## 5. Security Considerations

### 5.1 Attack Vectors & Mitigations

| Attack | Web2 Risk | Web3 Mitigation |
|--------|-----------|-----------------|
| **Move Leakage** | HIGH - Server sees all | NONE - Hashes only |
| **Post-Hoc Changes** | HIGH - DB edit | NONE - Immutable blockchain |
| **RNG Manipulation** | HIGH - Server controls | NONE - Chainlink VRF |
| **Signature Forgery** | N/A | LOW - ECDSA secured |
| **Front-Running** | N/A | MEDIUM - Use commit-reveal |
| **Replay Attacks** | N/A | LOW - Salt prevents reuse |

### 5.2 Salt Generation Best Practices

```typescript
// ❌ WEAK: Predictable salt
const salt = Math.random().toString();

// ❌ WEAK: Timestamp-based (guessable)
const salt = Date.now().toString();

// ✅ STRONG: Cryptographically secure
import { randomBytes } from 'crypto';
const salt = randomBytes(16).toString('hex');

// ✅ STRONG: Ethers.js (browser-compatible)
import { ethers } from 'ethers';
const salt = ethers.utils.hexlify(ethers.utils.randomBytes(16));
```

### 5.3 Key Management

**Private Key Storage:**
- **NEVER** store in localStorage or cookies
- **USE** wallet providers (MetaMask, WalletConnect)
- **NEVER** transmit private keys to server
- **ALWAYS** sign locally on player's device

```typescript
// ✅ Correct: Sign with wallet
const provider = new ethers.providers.Web3Provider(window.ethereum);
const signer = provider.getSigner();
const signature = await signer.signMessage(hash);

// ❌ Wrong: Exposing private key
const privateKey = process.env.PRIVATE_KEY; // NEVER DO THIS
const wallet = new ethers.Wallet(privateKey);
```

---

## 6. Performance Optimization

### 6.1 Blockchain Cost Optimization

**Problem:** Every move submitted to blockchain costs gas (~$0.01 on Avalanche).

**Solution:** Batch commitments

```solidity
function commitMultipleMoves(
    uint256 gameId,
    bytes32[] memory hashes,
    bytes[] memory signatures
) external {
    for (uint256 i = 0; i < hashes.length; i++) {
        // Process all 4 actors in single transaction
        commitMove(gameId, hashes[i], signatures[i]);
    }
    // Gas cost: ~$0.04 total vs $0.04 individual
}
```

### 6.2 Hybrid Architecture

**Optimal Design:**
- **Commitment hashes** → Blockchain (immutable proof)
- **Game state** → Traditional database (fast reads)
- **Reveal verification** → Compare hash vs blockchain record
- **Conflict resolution** → Server-side (off-chain computation)

```
┌─────────────────────────────────────────────────────────┐
│                  Hybrid Architecture                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Blockchain Layer (Avalanche)                           │
│  - Move commitments (hashes)                            │
│  - Random number generation (Chainlink VRF)             │
│  - Game result finalization                             │
│                                                          │
│  Traditional Layer (Next.js + DB)                       │
│  - Real-time game state                                 │
│  - Conflict resolution computation                      │
│  - Player matchmaking                                   │
│  - Chat & social features                               │
│                                                          │
│  Verification Layer (Client-side)                       │
│  - Hash verification on reveal                          │
│  - Blockchain state sync                                │
│  - Proof validation                                     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Current)
- ✅ Core game logic implemented
- ✅ Phase engine functional
- ✅ Conflict resolution working
- ✅ UI/UX complete
- ⚠️ Centralized server (development only)

### Phase 2: Cryptographic Commitment (Next)
- [ ] Implement Keccak-256 hashing
- [ ] Add salt generation
- [ ] Create commitment UI flow
- [ ] Deploy Avalanche smart contract
- [ ] Integrate wallet connection (MetaMask)

### Phase 3: Verification System
- [ ] Build reveal verification
- [ ] Add blockchain sync layer
- [ ] Implement hash comparison
- [ ] Create audit trail viewer

### Phase 4: Decentralized RNG
- [ ] Integrate Chainlink VRF
- [ ] Replace server RNG with on-chain
- [ ] Add Event Card commitment
- [ ] Verify randomness publicly

### Phase 5: Production Deployment
- [ ] Security audit
- [ ] Load testing
- [ ] Mainnet deployment
- [ ] Bug bounty program

---

## 8. Glossary

| Term | Definition |
|------|------------|
| **Commit-Reveal** | Cryptographic scheme where moves are hashed before submission, revealed later |
| **Keccak-256** | SHA-3 variant used by Ethereum/Avalanche for hashing |
| **ECDSA** | Elliptic Curve Digital Signature Algorithm - used for signing transactions |
| **Salt** | Random data added to commitments to prevent rainbow table attacks |
| **VRF** | Verifiable Random Function - provably fair random number generation |
| **Finality** | Time until blockchain transaction is irreversible |
| **Gas** | Transaction fee paid to blockchain validators |
| **EVM** | Ethereum Virtual Machine - execution environment for smart contracts |

---

## 9. References

- [Avalanche Documentation](https://docs.avax.network/)
- [Chainlink VRF Documentation](https://docs.chain.link/vrf/v2/introduction)
- [Ethers.js Documentation](https://docs.ethers.org/v5/)
- [Solidity Documentation](https://docs.soliditylang.org/)
- [Commit-Reveal Scheme (Wikipedia)](https://en.wikipedia.org/wiki/Commitment_scheme)

---

**Document Version:** 1.0  
**Last Updated:** March 2026  
**Maintained By:** Metarchy Development Team
