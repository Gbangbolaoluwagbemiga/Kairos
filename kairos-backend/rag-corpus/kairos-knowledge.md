# Kairos — Product & Architecture Reference

This document is indexed for retrieval-augmented answers about Kairos, Stellar, x402 payments, and the agentic ecosystem.

---

## What Kairos Is

Kairos is an **AI agent marketplace** built on **Stellar**. Users chat with an AI orchestrator (Gemini) that routes queries to specialist agents. Each agent call triggers a **real USDC micropayment** on Stellar — agents earn for their work, pay sub-agents for coordination, and build on-chain reputation.

### Key Differentiators
- **x402 micropayments** — Every agent call pays 0.01 USDC on-chain
- **Agent-to-agent (A2A) commerce** — Agents pay each other 0.005 USDC for sub-tasks
- **On-chain registry** — 9 agents registered on Soroban smart contract
- **Auditable** — All payments visible on Stellar Expert with clickable tx hashes
- **Multi-agent orchestration** — Gemini routes queries to specialist agents

---

## The 9 Specialist Agents

| Agent | ID | Capability | Price |
|-------|-----|------------|-------|
| Price Oracle | `oracle` | Real-time crypto prices via CoinGecko | 0.01 USDC |
| News Scout | `news` | Crypto headlines (RSS); Stellar account ops only if user passes a valid `G…` address as the query | 0.01 USDC |
| Yield Optimizer | `yield` | DeFi yields from Lido, Aave, Curve, Beefy | 0.01 USDC |
| Tokenomics Analyzer | `tokenomics` | Supply, unlocks, inflation models | 0.01 USDC |
| Stellar Scout | `stellar-scout` | Stellar DeFi yields, SDEX stats, account analysis | 0.01 USDC |
| Perp Stats | `perp` | Perpetual futures, funding rates, OI | 0.01 USDC |
| Protocol Stats | `protocol` | TVL, fees, revenue via DeFiLlama | 0.01 USDC |
| Bridge Monitor | `bridges` | Cross-chain bridge volumes | 0.01 USDC |
| Stellar DEX | `stellar-dex` | SDEX order book depth, trading pairs | 0.01 USDC |

---

## x402 Payment Architecture

### Layer 1: Treasury → Agent (x402)
Every user query triggers the treasury paying each specialist agent 0.01 USDC via Stellar. The payment fires before the response is returned and the tx hash is embedded in the UI.

```
User query → Orchestrator → Agent A  →  0.01 USDC (treasury → oracle)
                          → Agent B  →  0.01 USDC (treasury → news)
```

### Layer 2: Agent → Agent (A2A Sub-payments)
When multiple agents collaborate, the primary agent pays sub-agents 0.005 USDC for coordination. This is true autonomous agent commerce — agents earn AND spend on Stellar.

```
Agent A (oracle) → Agent B (news)  →  0.005 USDC A2A payment
```

### Payment Truth (Do Not Invent Amounts)
- **UI "~$0.03 per query"** is a UX estimate for typical multi-agent queries
- **Per agent tool**: Treasury pays **0.01 USDC**
- **A2A sub-payments**: Primary agent pays **0.005 USDC** to each sub-agent
- **XLM fallback**: Only if USDC trustline missing (0.001 XLM)
- **Network fee**: 0.00001 XLM (100 stroops) per transaction — NOT the payment amount

---

## Soroban Smart Contracts

### Agent Registry
**Contract ID:** `CDY6H4HA3KTCRYHOV4NO23U25NHQEFRHQPVRYX23D3CS7HPEPL7D74HI`

Stores agent metadata on-chain:
- Owner address (Stellar G... account)
- Service type (price, news, yield, etc.)
- Per-task price (in USDC stroops)
- Reputation score
- Tasks completed counter

### Spending Policy
**Contract ID:** `CBKLN62D5RR4PL5JAM2OAQXYBDEU5UHGWIOLL46U7QGKIPBS5WQGZILU`

Programmable spending constraints:
- Daily spending limits per agent
- Automatic daily reset
- Lifetime spend tracking
- Owner-controlled limit updates

---

## Stellar Network Fundamentals

### What is Stellar?
Stellar is a decentralized, open-source blockchain designed for fast, low-cost cross-border payments. Key features:
- **3-5 second finality** — Transactions confirm in seconds
- **Near-zero fees** — ~0.00001 XLM per transaction
- **Built-in DEX** — Native decentralized exchange (SDEX)
- **Anchors** — Bridges to fiat currencies worldwide
- **Soroban** — Smart contract platform (launched 2024)

### Stellar Consensus Protocol (SCP)
Unlike proof-of-work, Stellar uses **Federated Byzantine Agreement (FBA)**:
- Nodes choose which other nodes to trust (quorum slices)
- No mining, no energy waste
- Achieves consensus in 3-5 seconds
- Tolerates Byzantine failures

### Assets on Stellar
- **XLM (Lumens)** — Native currency, used for fees and spam prevention
- **Issued assets** — Any asset (USDC, EUR, BTC) can be tokenized
- **Trustlines** — Accounts must explicitly trust an asset issuer before holding
- **Anchors** — Trusted entities that issue fiat-backed tokens

### Transactions
- **Operations** — Individual actions (payment, create account, manage offers)
- **Multi-operation transactions** — Up to 100 operations per tx
- **Sequence numbers** — Prevent replay attacks
- **Time bounds** — Optional validity windows
- **Memos** — Attach metadata (text, hash, ID)

---

## Soroban Smart Contracts

### What is Soroban?
Soroban is Stellar's smart contract platform, launched in 2024:
- **Rust-based** — Write contracts in Rust, compile to WASM
- **Predictable fees** — Resource-based pricing model
- **State archival** — Temporary and persistent storage tiers
- **Host functions** — Efficient built-in operations
- **No reentrancy** — Contract calls are isolated

### Soroban vs EVM
| Feature | Soroban | EVM |
|---------|---------|-----|
| Language | Rust | Solidity |
| Execution | WASM | EVM bytecode |
| Fees | Predictable, resource-based | Gas auction |
| State | Archival tiers | Permanent |
| Finality | 5 seconds | 12+ seconds |

### Contract Example
```rust
#[contract]
pub struct HelloWorld;

#[contractimpl]
impl HelloWorld {
    pub fn hello(env: Env, to: Symbol) -> Vec<Symbol> {
        vec![&env, symbol_short!("Hello"), to]
    }
}
```

---

## Machine Payments Protocol (MPP)

Kairos aligns with Stellar's **Machine Payments Protocol** vision:

| MPP Principle | Kairos Implementation |
|---------------|----------------------|
| Machine-to-machine payments | A2A sub-payments between agents |
| Pay-per-use resources | 0.01 USDC per query, 0.005 USDC per A2A |
| Autonomous wallets | Each agent holds its own funded Stellar account |
| Programmable access | Soroban registry controls agent metadata |
| Microtransactions | Sub-cent payments via USDC on Stellar |

The `stellar-mpp-sdk` provides primitives for:
- Spending policies (daily limits, rate limits)
- Contract accounts (programmable wallets)
- Payment channels (off-chain scaling)

---

## DeFi on Stellar

### SDEX (Stellar Decentralized Exchange)
- Built into the protocol (not a smart contract)
- Order book model with path payments
- Cross-asset atomic swaps
- No AMM slippage for limit orders

### Stellar DeFi Protocols
- **Blend** — Lending/borrowing protocol
- **Aquarius** — AMM liquidity pools
- **StellarX** — DEX interface
- **Lobstr** — Wallet with DEX integration

### Yields on Stellar
- Blend lending: 2-8% APY on stablecoins
- Aquarius LP: Variable APY based on volume
- Lower than EVM yields but with sub-second finality

---

## API Architecture

### Endpoints
- `POST /query` — Chat with AI, triggers agent payments
- `GET /receipts/:requestId` — Poll for payment tx hashes
- `GET /dashboard/stats?agentId=X` — Agent treasury balance, usage
- `GET /dashboard/activity?agentId=X` — Payment history
- `GET /health` — Server status

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google AI Studio API key |
| `STELLAR_SPONSOR_SECRET` | Yes | Treasury private key (S...) |
| `USDC_ISSUER_ADDRESS` | No | USDC issuer (defaults to treasury) |
| `AGENT_REGISTRY_CONTRACT_ID` | No | Soroban registry contract |
| `SPENDING_POLICY_CONTRACT_ID` | No | Soroban spending policy |
| `SUPABASE_URL` | No | Database for chat history |
| `COINGECKO_API_KEY` | No | Higher rate limits |

---

## How RAG Works in Kairos

For questions about Kairos features, Stellar, x402, or deployment:
1. The query is embedded using the same model as the corpus
2. Top-k relevant chunks are retrieved
3. Chunks are injected into the model context
4. Model answers citing **[Source N]** when using excerpts

For **live data** (prices, news, yields), RAG is bypassed — tools fetch real-time data from external APIs.

---

## Hackathon Context

Kairos was built for the **Stellar Agentic Hackathon 2026**.

### Track Alignment
- **Agent Payments** — x402 micropayments + A2A commerce
- **Soroban Contracts** — Agent registry + spending policy
- **Multi-Agent Systems** — 9 specialist agents with orchestration
- **MPP Alignment** — Implements MPP principles

### Demo Flow
1. Connect Freighter wallet
2. Ask "What's the price of XLM?"
3. Watch payment badge appear (click → Stellar Expert)
4. Ask multi-agent query to trigger A2A payments
5. Check dashboard for treasury balances
