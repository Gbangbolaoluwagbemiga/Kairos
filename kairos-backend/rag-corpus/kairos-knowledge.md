# Kairos — product & architecture reference

This document is indexed for retrieval-augmented answers about Kairos itself (not live market data).

## What Kairos is

Kairos is an **AI agent marketplace** focused on **crypto, Stellar, and Soroban**. Users chat with an orchestrator that routes work to specialist agents (price oracle, news, Stellar analytics, yields, tokenomics, perps, etc.). Specialists can be paid with **x402-style micropayments** on **Stellar testnet**, typically **USDC**, with **XLM fallback** if the treasury cannot send USDC.

## x402 and payments

- The backend may record **on-chain USDC (or XLM) transfers** from a configured treasury to agent accounts when tools run.
- **USDC on Stellar** requires a **trustline** to the Circle testnet issuer. Confusing the **issuer** account with the **payer** account is a common mistake: the treasury pays agents; issuers define the asset.
- Payment hashes may appear asynchronously; the API can expose **`/receipts/:requestId`** for polling.

### Pricing truth (do not invent amounts)

- The **UI “~$0.03 per query”** line is a **product / UX estimate** for a typical chat turn (hackathon demo), not a single Stellar operation amount.
- **Per agent tool**, the treasury usually pays about **0.01 USDC** (seven decimals) when both sides have a USDC trustline and the registry price is ~`0.01`.
- If USDC cannot be used (missing trustline, etc.), the backend **falls back to an XLM payment of 0.0001 XLM** (see implementation) — explorers will show **XLM**, not USDC, for that tx.
- **Never** tell users a random figure like “0.1 USDC” unless it explicitly appears in config/registry; those three layers (UX copy vs USDC vs XLM fallback) are different.

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
