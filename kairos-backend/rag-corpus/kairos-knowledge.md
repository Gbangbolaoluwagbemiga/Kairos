# Kairos — product & architecture reference

This document is indexed for retrieval-augmented answers about Kairos itself (not live market data).

## What Kairos is

Kairos is an **AI agent marketplace** focused on **crypto, Stellar, and Soroban**. Users chat with an orchestrator that routes work to specialist agents (price oracle, news, Stellar analytics, yields, tokenomics, perps, etc.). Specialists can be paid with **x402-style micropayments** on **Stellar testnet**, typically **USDC**, with **XLM fallback** if the treasury cannot send USDC.

## x402 and payments

- The backend records **on-chain USDC (or XLM) transfers** from a configured treasury to agent accounts when tools run.
- **USDC on Stellar** requires a **trustline** to the asset issuer. All agent accounts are pre-configured with USDC trustlines (treasury-issued demo USDC).
- Payment hashes may appear asynchronously; the API exposes **`/receipts/:requestId`** for polling.

### Pricing truth (do not invent amounts)

- The **UI "~$0.03 per query"** line is a **product / UX estimate** for a typical chat turn (hackathon demo), not a single Stellar operation amount.
- **Per agent tool**, the treasury pays **0.01 USDC** when the agent has a USDC trustline. Agent accounts are pre-set up so payments should be **0.01 USDC** per specialist call.
- If USDC still fails (e.g. balance too low), the backend **falls back to 0.001 XLM** — block explorers show **XLM**, not USDC, for those txs.
- **Never** tell users a random figure like "0.1 USDC"; the three layers (UX copy, USDC per-tool, XLM fallback) are distinct.

### Stellar transaction anatomy — do not confuse these two amounts

When you see a transaction on Stellar Expert, there are TWO separate fields:

1. **Max Fee** (e.g. `0.00001 XLM`) — the **network processing fee** paid to validators, always in XLM. Typically 100 stroops = 0.00001 XLM. This is NOT the payment amount to agents.
2. **Operation amount** (e.g. `0.001 XLM` or `0.01 USDC`) — the **actual transfer** from treasury to agent inside the transaction body.

Max Fee and the payment operation amount are completely separate. A tx can have Max Fee = 0.00001 XLM while sending 0.01 USDC in the same tx.

## Soroban agent registry

- Agent destinations and pricing can be resolved from a **Soroban agent registry** contract when `AGENT_REGISTRY_CONTRACT_ID` is set.
- Registration scripts (e.g. `npm run registry:register`) exist to map logical agent ids (`oracle`, `news`, …) to on-chain metadata.

## Deployment (Railway / Docker)

- The API listens on **`PORT`** (default **3001**).
- Typical env vars: **`GEMINI_API_KEY`**, **`ALLOWED_ORIGINS`**, **`STELLAR_SPONSOR_SECRET`**, **`AGENT_REGISTRY_CONTRACT_ID`**, **`USDC_ISSUER_ADDRESS`** (if not using the default testnet issuer).
- Production images should include the **`rag-corpus/`** directory so **RAG** can load local knowledge without external vector DBs.

## How RAG fits

- For questions about **Kairos features, deployment, x402, or Stellar integration**, the backend may inject **retrieved excerpts** from this corpus into the model context. Answers should cite **[Source N]** when using those excerpts.
- **Live prices, news, and chain stats** still come from **tools** (CoinGecko, news APIs, Horizon, etc.), not from this file.
