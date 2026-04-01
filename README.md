## Kairos (Agents on Stellar)

**Kairos** is a multi-agent “crypto intelligence terminal” where **agents can actually pay**. Each agent tool call is treated like a paid interaction and Kairos returns **on-chain receipts** (tx hashes) so judges can verify settlement.

<div align="center">
  <img src="./kairos-frontend/public/og-image.png" alt="Kairos Banner" width="100%" />
</div>

### Live deployment

- **Backend**: `https://kairos-chatbox.up.railway.app`
- **Soroban Agent Registry (testnet)**: `CBLVIPCOGFNDLBGZ6ZQ2S3NPSA2CU3H6EZZJXYKBKHLTQ2MKJWPRQZG5`

### What it does

- **Multi-agent orchestration**: a single query triggers multiple specialized agents in parallel (price, news, yields, tokenomics, perps, Stellar scout).
- **Paid agent economy**: each agent invocation is settled on **Stellar testnet** and returned as a **tx hash receipt**.
- **On-chain service discovery**: agent owners + prices are stored in a **Soroban registry** and resolved on-chain by the backend.
- **Hackathon-ready onboarding**: add USDC trustline + request demo USDC in-app (Freighter signs the trustline tx).


---

## Architecture (high level)

- `kairos-frontend/`: React + Vite UI (wallet connect, chat, receipts)
- `kairos-backend/`: Node/Express orchestrator (Gemini tool routing + Stellar settlement + Soroban reads)
- `contracts/agent-registry/`: Soroban contract (agent metadata, pricing, discovery by service type)

---

## USDC choice: Circle USDC vs demo USDC

**Can we use Circle USDC?**  
**Yes on mainnet**, and **sometimes on testnet** if you have a valid Stellar issuer address + a way to acquire testnet USDC from that issuer.

**Why we default to demo USDC on testnet:**  
For hackathon reliability, Kairos supports a treasury-issued testnet asset `USDC:<treasury_pubkey>`. It’s still a *real Stellar asset*, real trustlines, real payments, and real receipts—just not Circle’s issuer.

**If you want to switch to Circle USDC:**

1) Set `USDC_ISSUER_ADDRESS=<Circle_USDC_issuer_public_key>` (must be a valid `G...` Stellar key)  
2) Ensure treasury has a trustline:

```bash
cd kairos-backend
npm run x402:trustline
```

3) Fund treasury with Circle USDC on that network (via the issuer/faucet)  
4) Ensure user wallets + agent wallets also have that trustline (or accept XLM fallback).

---

## Soroban Agent Registry (real on-chain)

**Contract (testnet):** `CBLVIPCOGFNDLBGZ6ZQ2S3NPSA2CU3H6EZZJXYKBKHLTQ2MKJWPRQZG5`

### Prove it’s on-chain (quick commands)

```bash
stellar contract invoke --network testnet --source kairos --id CBLVIPCOGFNDLBGZ6ZQ2S3NPSA2CU3H6EZZJXYKBKHLTQ2MKJWPRQZG5 -- get_agents_by_service --service_type price
stellar contract invoke --network testnet --source kairos --id CBLVIPCOGFNDLBGZ6ZQ2S3NPSA2CU3H6EZZJXYKBKHLTQ2MKJWPRQZG5 -- get_agents_by_service --service_type news
stellar contract invoke --network testnet --source kairos --id CBLVIPCOGFNDLBGZ6ZQ2S3NPSA2CU3H6EZZJXYKBKHLTQ2MKJWPRQZG5 -- get_agents_by_service --service_type stellar
```

### Register agents on-chain (one-time)

```bash
cd kairos-backend
export AGENT_REGISTRY_CONTRACT_ID="CBLVIPCOGFNDLBGZ6ZQ2S3NPSA2CU3H6EZZJXYKBKHLTQ2MKJWPRQZG5"

# Each agent signs its own registration (testnet only)
export ORACLE_AGENT_SECRET="S..."
export NEWS_AGENT_SECRET="S..."
export YIELD_AGENT_SECRET="S..."
export TOKENOMICS_AGENT_SECRET="S..."
export PERP_AGENT_SECRET="S..."
export STELLAR_SCOUT_AGENT_SECRET="S..."

npm run registry:register
```

---

## Local dev

### Prerequisites

-   Node.js v20+
-   npm or pnpm
-   A Stellar Testnet wallet (Freighter recommended)
-   A Stellar testnet **treasury** account secret (used by backend to sponsor accounts and submit settlement txs)

### 1. Installation

Clone the repository and install dependencies for both services:

```bash
# Install Backend Dependencies
cd kairos-backend
npm install

# Install Frontend Dependencies
cd ../kairos-frontend
npm install
```

### 2. Configuration

You need to set up environment variables for both the backend and frontend.

**Backend (`kairos-backend/.env`):**
Create a `.env` file in `kairos-backend/` with:

-   **AI**
    -   `GEMINI_API_KEY`: Google Gemini API key
-   **Stellar**
    -   `STELLAR_NETWORK`: `testnet` (default)
    -   `STELLAR_SPONSOR_SECRET`: **Secret seed** (starts with `S...`) for the Kairos treasury account
    -   `USDC_ISSUER_ADDRESS`: issuer public key for USDC on the selected network (demo issuer or Circle issuer)
    -   `AGENT_REGISTRY_CONTRACT_ID`: Soroban contract id (`C...`)
-   **Supabase (optional but recommended)**
    -   `SUPABASE_URL`
    -   `SUPABASE_ANON_KEY`
-   **Agent addresses (optional)**
    -   `ORACLE_X402_ADDRESS`, `NEWS_X402_ADDRESS`, `YIELD_X402_ADDRESS`, `TOKENOMICS_X402_ADDRESS`, `PERP_STATS_X402_ADDRESS`, `STELLAR_SCOUT_X402_ADDRESS`

If Supabase isn’t configured, Kairos still works and falls back to in-memory sessions/messages.

**Frontend (`kairos-frontend/.env`):**
Create a `.env` file in `kairos-frontend/` with:
-   `VITE_API_URL`: URL of your backend (e.g., `http://localhost:3000`).
-   `VITE_ADMIN_ADDRESS`: Wallet address for admin dashboard visibility.

### 3. Running Locally

**Start the Backend:**
```bash
cd kairos-backend
npm run dev
# Server will start on http://localhost:3001 (default)
```

**Start the Frontend:**
```bash
cd kairos-frontend
npm run dev
# App will start on http://localhost:5173
```

## 🎬 Suggested 2–3 minute demo script

**Goal**: show (1) multi-agent orchestration, (2) real Stellar transactions, (3) visible payment flow + tx hashes.

-   **Step 1 (10s)**: Open the app, connect Freighter, show “sponsored account” toast (gasless onboarding).
-   **Step 2 (45s)**: Run a query that triggers multiple tools, e.g.:
    -   “What’s the price of XLM + latest Stellar headlines + current SDEX volume?”
-   **Step 3 (30s)**: Point out the “payment flow” UI and show the returned **tx hashes** per agent in the chat message.
-   **Step 4 (30s)**: Open one tx hash in a Stellar testnet explorer / Horizon and show memo `x402:...`.
-   **Step 5 (20s)**: Show the marketplace page (`/providers`) and the dashboard stats (usage, response times).

## 🧪 Useful endpoints

-   `GET /health`: backend health + enabled network
-   `POST /api/stellar/sponsor`: sponsor/create a new user account (testnet)
-   `GET /api/stellar/balance/:address`: fetch XLM + USDC balance (testnet)
-   `POST /query`: main AI endpoint; returns:
    -   `agentsUsed`: list of sub-agents invoked
    -   `x402Transactions`: map of agent → Stellar tx hash (when available)
-   `GET /api/x402/health`: shows which seller addresses are configured
-   `GET /api/x402/*`: paid endpoints that now enforce payment verification (see below)

## 🔐 x402 HTTP enforcement (Stellar-backed)

The `/api/x402/*` routes enforce a “paid HTTP request” pattern by requiring a **Stellar testnet payment tx hash** in the request headers.

- **Required header**: `x402-tx-hash: <stellar_tx_hash>`
- **What the backend checks**:
  - the tx exists on Horizon and is `successful`
  - the tx contains a `payment` operation to the endpoint’s seller address
  - the payment asset matches the enforced currency (default: USDC)
  - the amount is \(\ge\) the endpoint price (e.g. `$0.01`)
  - the tx hash hasn’t been used before (basic replay protection)

### 30-second demo script

From `kairos-backend/`:

```bash
npm run x402:demo -- oracle "/oracle/price?symbol=XLM" 0.01
```

> If you really want the dollar sign format, escape it in zsh: `'\$0.01'`.

By default the paid-HTTP demo uses **XLM** (no trustlines needed). To switch to USDC mode:

```bash
X402_CURRENCY=USDC npm run x402:demo -- oracle "/oracle/price?symbol=XLM" 0.01
```

### Paid POST demo (JSON body)

```bash
npm run x402:demo -- oracle "/oracle/prices" 0.02 POST '{"symbols":["XLM","BTC","ETH"]}'
```

### One-time setup (treasury USDC trustline)

If your treasury account doesn’t have a USDC trustline yet:

```bash
npm run x402:trustline
```

## 🖥️ Frontend demos

- **Providers page (`/providers`)**
  - `Paid API Demo (x402)` section explains and demonstrates:
    1. call protected API
    2. receive `402 Payment required`
    3. pay and retry with `x402-tx-hash`
  - Includes clickable tx proof links to Stellar Expert.

- **Fund Wallet page (`/deposit`)**
  - XLM testnet faucet (friendbot-backed)
  - USDC demo flow:
    1. add USDC trustline via wallet signature
    2. request demo USDC from treasury issuer

## 🧠 Soroban contract (Agent Registry)

There is a Soroban contract workspace in `contracts/agent-registry` for registering agents on-chain.

-   **What’s implemented**: register/update/deregister agent metadata + query by service type
-   **Status**: the contract is currently **not wired into the frontend/backend demo path** (yet), but it’s included as the on-chain registry foundation.

## ⚠️ Known limitations (transparent for hackathon judges)

- **USDC on testnet**: by default the app uses a **treasury-issued testnet asset** `USDC:<treasury_pubkey>` for reliable demos. Switching to Circle USDC depends on issuer availability on the chosen network.
- **Paid HTTP**: `/api/x402/*` enforces payment using a Stellar tx hash header; some demo endpoints may still use helper flows for hackathon UX.
- **External data sources**: price/news/perps/yields are API-backed (real-time), not on-chain.



## 📄 License

This project is licensed under the MIT License.
