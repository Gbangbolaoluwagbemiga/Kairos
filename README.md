# Kairos — Stellar Agentic Marketplace

> **Multi-agent AI marketplace where agents don't just talk — they buy, sell, coordinate, and earn on Stellar.**

Built for the **Stellar Agentic Hackathon 2026** | [Live Demo](https://kairos-chatbox.vercel.app/) | [Video Walkthrough](https://www.loom.com/share/ffccc293cac9406aa178c2761097d462)

---

## What Kairos Does

Kairos solves the "last mile" problem for AI agents: **payments**. Agents can reason and plan, but they hit a wall when they need to pay for APIs, tools, or data. On Kairos, every agent query triggers **real USDC micropayments on Stellar** — agents earn for their work, pay sub-agents for coordination, and build on-chain reputation.

**Key differentiators:**
- ✅ **x402 micropayments** — Every agent call pays 0.01 USDC on-chain
- ✅ **Agent-to-agent (A2A) commerce** — Agents pay each other for sub-tasks
- ✅ **On-chain registry** — 9 agents registered on Soroban smart contract
- ✅ **Auditable** — All payments visible on Stellar Expert with clickable tx hashes
- ✅ **Multi-agent orchestration** — Gemini routes queries to specialist agents

**9 specialist agents:**

| Agent | ID | Capability |
|---|---|---|
| Price Oracle | `oracle` | Real-time prices, market cap, ATH via CoinGecko |
| News Scout | `news` | Crypto headlines (aggregated RSS); Stellar account ledger snippets only when the user passes a valid `G…` address |
| Yield Optimizer | `yield` | DeFi yields across 500+ protocols |
| Tokenomics Analyzer | `tokenomics` | Supply, unlocks, inflation models |
| Stellar Scout | `stellar-scout` | Stellar DeFi yields (Blend, Aquarius), account analysis |
| Perp Stats | `perp` | Perpetual futures, funding rates, open interest |
| Protocol Stats | `protocol` | TVL, fees, revenue via DeFiLlama |
| Bridge Monitor | `bridges` | Cross-chain bridge volumes |
| Stellar DEX | `stellar-dex` | SDEX order book depth, trading pairs |

---

## Architecture

```
kairos-frontend/     React + Vite + TailwindCSS (deployed on Vercel/Railway)
kairos-backend/      Node.js + Express + TypeScript (deployed on Railway)
  src/
    index.ts              API routes, activity feed, treasury endpoints
    config.ts             All agent addresses, network config, pricing
    services/
      gemini.ts           AI orchestrator (Groq) — tool routing, x402 payments
      search.ts           Google Search grounding (Gemini 2.0 Flash)
      agent-registry.ts   Soroban registry (simulation read) with env-driven fallback
      price-oracle.ts     CoinGecko integration
      news-scout.ts       Crypto RSS headlines (+ Horizon ops only for valid Stellar `G…` queries)
      yield-optimizer.ts  DeFi yield aggregation
      tokenomics-service.ts Token supply & unlock data
      defillama.ts        DeFiLlama TVL/fees/bridges
      perp-stats/         Perpetuals data from 7+ exchanges
      stellar-analytics.ts SDEX stats, Blend yields, account lookup
      rag.ts              RAG corpus indexing + semantic search
      supabase.ts         Chat history, ratings, response time logs
      stellar.ts          Horizon server, payment utilities
    routes/
      x402-agent-routes.ts  Paywalled API endpoints (demo)
  db/
    schema.sql            Supabase table definitions (run once)
  scripts/
    generate-agent-wallets.ts  Create new agent accounts with USDC trustlines
    check-agent-balances.ts    Check USDC balances for all 9 agents
    fund-agents.ts             Top up agent USDC balances from treasury
    x402-auto-refill.ts        Auto-refill agents below threshold
    register-agents-onchain.ts Register agents on Soroban contract
    simulate-agent-traffic.ts  Load-test agent payments
    list-models.ts             List available Gemini models
  rag-corpus/
    kairos-knowledge.md   Domain knowledge for RAG
    sources.urls          External URLs indexed at startup
contracts/              Soroban: `agent-registry/`, `spending-policy/`
```

---

## Quick Start (Local)

### Prerequisites
- Node.js 20+
- A funded Stellar testnet account (treasury)
- Freighter browser wallet

### Backend

```bash
cd kairos-backend
cp .env.example .env   # fill in required values
npm install
npm run dev
```

### Frontend

```bash
cd kairos-frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`, backend at `http://localhost:3001`.

---

## Environment Variables

### Backend (`kairos-backend/.env`)

**Required:**

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key (OpenAI-compatible) |
| `GROQ_MODEL` | Groq model id (default `llama-3.3-70b-versatile`) |
| `STELLAR_SPONSOR_SECRET` | Treasury private key (S...) |
| `USDC_ISSUER_ADDRESS` | Treasury public key (= USDC issuer in demo mode) |

**Stellar config:**

| Variable | Default | Description |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` | `testnet` or `public` |
| `PORT` | `3001` | HTTP port |
| `ALLOWED_ORIGINS` | _(optional)_ | Comma-separated origins; only enforced when **`STRICT_CORS=1`**. Default CORS reflects any browser `Origin` (good for Vercel + Railway). |

**Agent addresses (all 9 required):**

```
ORACLE_X402_ADDRESS
NEWS_X402_ADDRESS
YIELD_X402_ADDRESS
TOKENOMICS_X402_ADDRESS
PERP_STATS_X402_ADDRESS
STELLAR_SCOUT_X402_ADDRESS
PROTOCOL_X402_ADDRESS
BRIDGES_X402_ADDRESS
STELLAR_DEX_X402_ADDRESS
```

**Optional (app degrades gracefully):**

| Variable | Effect if missing |
|---|---|
| `COINGECKO_API_KEY` | Price oracle hits public rate limits |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | No persistent chat history, ratings, or response time tracking |
| `AGENT_REGISTRY_CONTRACT_ID` | Agent address resolution falls back to built-in map (payments still work) |
| `SPENDING_POLICY_CONTRACT_ID` | Spending-policy demo / scripts target only what you configure locally |
| `STRICT_CORS` | Set to `1` to allow only **`ALLOWED_ORIGINS`** plus `https://*.vercel.app`. If unset, CORS is **permissive** (reflects any `Origin`) — better for hackathon deploys; tighten for real production. |

### Frontend (`kairos-frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | Backend URL |
| `VITE_ADMIN_ADDRESS` | _(empty)_ | Wallet address shown with Admin badge |

---

## Agent Wallet Setup

Each agent needs a Stellar account with a USDC trustline before it can receive payments.

```bash
cd kairos-backend

# Generate new agent wallets (creates accounts + USDC trustlines + seeds 1 USDC each)
npx tsx scripts/generate-agent-wallets.ts

# Check current balances
npx tsx scripts/check-agent-balances.ts

# Top up agents below 1 USDC
npx tsx scripts/fund-agents.ts
```

The script outputs `.env` lines ready to paste. Keep `agent-wallets.json` secret — it contains private keys.

---

## Database Setup (Supabase)

Run `db/schema.sql` once in the Supabase SQL Editor. It creates:
- `chat_sessions` — per-wallet conversation threads
- `chat_messages` — full message history with tx hashes
- `message_ratings` — thumbs up/down per agent (drives ratings)
- `query_logs` — response times per agent (drives live stats)

---

## Deployment

### Backend → Railway

Set all environment variables from the table above in Railway's Variables tab, then connect the `kairos-backend/` directory. `railway.toml` and `Dockerfile` handle the rest.

### Frontend → Vercel / Railway

Set `VITE_API_URL` to your Railway backend URL. `vercel.json` includes SPA rewrite rules.

---

## Payment Architecture

Kairos implements two layers of on-chain payments — both are real Stellar transactions, fully auditable.

### Layer 1: Treasury → Agent (x402)
Every user query triggers the treasury paying each specialist agent 0.01 USDC via Stellar's x402 micropayment protocol. The payment fires before the response is returned and the tx hash is embedded in the UI.

```
User query → Orchestrator → Agent A  →  0.01 USDC (treasury → oracle)
                          → Agent B  →  0.01 USDC (treasury → news)
```

### Layer 2: Agent → Agent (A2A Sub-payments)
When multiple agents collaborate on a query, the primary agent pays the sub-agents 0.005 USDC for their coordination. This is true autonomous agent commerce — agents earn AND spend on Stellar.

```
Agent A (oracle) → Agent B (news)  →  0.005 USDC A2A payment
```

Both payment layers are visible in the chat UI as clickable badges linking to StellarExpert.

**Payment path:** Treasury (USDC issuer) → Agent wallets (USDC, Stellar testnet)  
**Network fee:** 0.00001 XLM per transaction (Stellar network validators)  
**A2A protocol:** Compatible with [stellar-mpp-sdk](https://github.com/stellar/stellar-mpp-sdk) Machine Payments Protocol — each agent holds its own funded wallet and signs transactions autonomously.

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI | Gemini 2.5 Flash (Google) |
| Search grounding | Gemini Google Search (built-in) |
| Blockchain | Stellar (Horizon API, Soroban) |
| Smart contracts | Soroban Agent Registry (deployed to testnet) |
| Payments | x402 USDC micropayments + A2A sub-payments |
| Prices | CoinGecko API |
| DeFi data | DeFiLlama API |
| Database | Supabase (PostgreSQL) |
| Backend | Node.js + Express + TypeScript |
| Frontend | React + Vite + TailwindCSS + shadcn/ui |
| Wallet | Freighter (Stellar browser wallet) |

---

## Soroban Smart Contracts

Two Soroban contracts deployed to Stellar testnet:

### 1. Agent Registry

All 9 agents are registered on-chain via the **Soroban Agent Registry**.

**Contract ID:** `CDY6H4HA3KTCRYHOV4NO23U25NHQEFRHQPVRYX23D3CS7HPEPL7D74HI`  
**Explorer:** [View on Stellar Lab](https://lab.stellar.org/r/testnet/contract/CDY6H4HA3KTCRYHOV4NO23U25NHQEFRHQPVRYX23D3CS7HPEPL7D74HI)

The contract stores:
- Agent owner address (Stellar G... account)
- Service type (price, news, yield, etc.)
- Per-task price (in USDC stroops)
- Reputation score (updated on ratings)
- Tasks completed counter

```rust
pub struct Agent {
    pub id: u32,
    pub owner: Address,
    pub name: String,
    pub service_type: String,
    pub price: i128,
    pub reputation: u32,
    pub tasks_completed: u32,
    pub active: bool,
}
```

Contract methods: `register_agent`, `update_agent`, `deregister_agent`, `get_agent`, `get_agents_by_service`

### 2. Spending Policy

Demonstrates **programmable spending constraints** for autonomous agents — a key capability for production agentic systems.

**Contract ID:** `CBKLN62D5RR4PL5JAM2OAQXYBDEU5UHGWIOLL46U7QGKIPBS5WQGZILU`  
**Explorer:** [View on Stellar Lab](https://lab.stellar.org/r/testnet/contract/CBKLN62D5RR4PL5JAM2OAQXYBDEU5UHGWIOLL46U7QGKIPBS5WQGZILU)

Features:
- Daily spending limits per agent (e.g., max 10 USDC/day for A2A payments)
- Automatic daily reset
- Lifetime spend tracking
- Owner-controlled limit updates

```rust
pub struct SpendingLimit {
    pub agent: Address,
    pub daily_limit: i128,
    pub spent_today: i128,
    pub period_start: u64,
    pub total_spent: i128,
}
```

Contract methods: `initialize`, `set_limit`, `can_spend`, `record_spend`, `get_status`, `get_remaining`

The Price Oracle agent has a 10 USDC/day spending limit set as a demo.

---

## MPP Alignment

Kairos is architecturally aligned with the **Machine Payments Protocol (MPP)** and [stellar-mpp-sdk](https://github.com/AhaLabs/stellar-mpp-sdk):

| MPP Principle | Kairos Implementation |
|---|---|
| Machine-to-machine payments | A2A sub-payments between agents |
| Pay-per-use resources | 0.01 USDC per query, 0.005 USDC per A2A |
| Autonomous wallets | Each agent holds its own funded Stellar account |
| Programmable access | Soroban registry controls agent metadata |
| Microtransactions | Sub-cent payments via USDC on Stellar |

Future work: Wire `stellar-mpp-sdk` for formal MPP facilitator flows. **Spending policy** is already demonstrated on Soroban (`spending-policy/` contract); deeper contract-account enforcement can extend that path.

---


### Chat Interface
Users ask natural language questions. Agent badges show which specialists responded. Payment badges link directly to Stellar Expert.

### Dashboard
Per-agent treasury balance, tasks completed, recent activity feed with on-chain receipts. A2A debits/credits displayed with direction indicators.

### Agent Marketplace
Browse all 9 agents, see ratings, response times, and pricing. Connect to view your agent's dashboard.

---

## Hackathon Submission Checklist

- [x] **Open-source repo** — Full source code with detailed README
- [x] **Video demo** — Shows agent queries, payments, A2A coordination
- [x] **Stellar testnet interaction** — Real USDC payments + Soroban contract
- [x] **Agent-to-agent payments** — Primary agent pays sub-agents
- [x] **Agent wallets** — 9 independent Stellar accounts
- [x] **On-chain registry** — Soroban smart contract
- [x] **Rating/reputation** — Thumbs up/down updates agent ratings

---

## License

MIT
