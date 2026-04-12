# Kairos — Stellar Agentic Marketplace

> The premier multi-agent AI marketplace on Stellar. Ask a question, watch specialist agents compete, pay, and respond — all on-chain via x402 USDC micropayments.

---

## Overview

Kairos is a production-grade agentic application built on Stellar. Users connect their Freighter wallet, ask questions in natural language, and the AI orchestrator routes each query to the best specialist agents. Every agent call triggers a real USDC micropayment from the treasury to the agent's Stellar account — fully auditable on-chain.

**9 specialist agents:**

| Agent | ID | Capability |
|---|---|---|
| Price Oracle | `oracle` | Real-time prices, market cap, ATH via CoinGecko |
| News Scout | `news` | Crypto news, sentiment, trending topics |
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
      gemini.ts           AI orchestrator — tool routing, x402 payments
      search.ts           Google Search grounding (Gemini 2.0 Flash)
      agent-registry.ts   Mock registry → resolves agent address from ID
      price-oracle.ts     CoinGecko integration
      news-scout.ts       Stellar Horizon news feed
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
contracts/              Soroban smart contracts (agent registry)
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
| `GEMINI_API_KEY` | Google AI Studio API key |
| `STELLAR_SPONSOR_SECRET` | Treasury private key (S...) |
| `USDC_ISSUER_ADDRESS` | Treasury public key (= USDC issuer in demo mode) |

**Stellar config:**

| Variable | Default | Description |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` | `testnet` or `public` |
| `PORT` | `3001` | HTTP port |
| `ALLOWED_ORIGINS` | localhost variants | CORS allowed origins |

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

## x402 Payment Flow

1. User sends a message → backend starts a chat session
2. Gemini orchestrator routes to specialist agents via function calls
3. For each agent call, treasury sends **0.01 USDC** to that agent's Stellar address
4. Transaction hash is returned alongside the AI response
5. Dashboard shows live activity feed with Stellar Expert links

**Payment path:** Treasury → Agent wallet (USDC, Stellar testnet)  
**Network fee:** 0.00001 XLM (paid by treasury, separate from agent payment)

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI | Gemini 3 Flash Preview (Google) |
| Search grounding | Gemini Google Search (built-in) |
| Blockchain | Stellar (Horizon API, Soroban) |
| Payments | x402 USDC micropayments |
| Prices | CoinGecko API |
| DeFi data | DeFiLlama API |
| Database | Supabase (PostgreSQL) |
| Backend | Node.js + Express + TypeScript |
| Frontend | React + Vite + TailwindCSS + shadcn/ui |
| Wallet | Freighter (Stellar browser wallet) |
