# Agent Payments & x402 Protocol

This document explains how AI agents can pay each other and receive payments on Stellar.

---

## The x402 Vision

x402 is inspired by HTTP 402 (Payment Required) — a status code reserved for "future use" since 1999. The vision: machines paying machines for API access, compute, data, and services.

### Why x402 on Stellar?
- **Sub-second finality** — Payments confirm in 3-5 seconds
- **Near-zero fees** — ~$0.000003 per transaction
- **Native stablecoins** — Circle USDC is native, not bridged
- **No gas volatility** — Predictable costs
- **Built-in DEX** — Atomic asset swaps

---

## Agent Wallet Architecture

Each Kairos agent has its own Stellar account:

```
Agent: Price Oracle
Address: GACM3ZH2KZQMCPHGTVFWHX7ONS64ZYLKSSLOM6L2KJX3WAY4D5NYL32Q
Balance: 100.22 USDC, 49.99 XLM
Trustlines: USDC (Circle testnet)
```

### Wallet Requirements
1. **Funded account** — Minimum 1 XLM for base reserve
2. **USDC trustline** — Must trust the USDC issuer
3. **XLM for fees** — Need XLM for transaction fees (~50 XLM is plenty)
4. **Secret key** — Stored securely in environment variables

### Creating Agent Wallets
```bash
npx tsx scripts/generate-agent-wallets.ts
```

This script:
1. Generates new Stellar keypairs
2. Funds accounts from treasury (Friendbot on testnet)
3. Establishes USDC trustlines
4. Seeds initial USDC balance
5. Outputs `.env` lines

---

## Payment Flow: Treasury → Agent

When a user asks a question:

1. **Query arrives** at `/query` endpoint
2. **Orchestrator routes** to specialist agents
3. **Agent executes** tool (fetches data)
4. **Treasury pays agent** 0.01 USDC via Stellar payment operation
5. **Response returns** with tx hash embedded

```
┌─────────┐    Query     ┌──────────────┐    Tool Call    ┌─────────────┐
│  User   │ ──────────▶  │ Orchestrator │ ──────────────▶ │ Price Oracle│
└─────────┘              └──────────────┘                 └─────────────┘
                               │                                │
                               │ Payment (0.01 USDC)            │ Data
                               ▼                                ▼
                         ┌──────────┐                    ┌──────────────┐
                         │ Treasury │ ──────────────────▶│ Agent Wallet │
                         └──────────┘                    └──────────────┘
```

### Transaction Structure
```
Transaction:
  Source: Treasury (GDCUS2HD...)
  Operations:
    - Payment:
        Destination: Agent (GACM3ZH2...)
        Asset: USDC
        Amount: 0.0100000
  Memo: x402:oracle:price
  Fee: 100 stroops (0.00001 XLM)
```

---

## Agent-to-Agent (A2A) Payments

When multiple agents collaborate, the **primary agent pays sub-agents**:

### Orchestration Priority
Agents are ranked to determine who pays whom:
1. Price Oracle (highest — data backbone)
2. Protocol Stats
3. Bridge Monitor
4. Stellar DEX
5. Stellar Scout
6. Perp Stats
7. Tokenomics
8. Yield Optimizer
9. News Scout (always a sub-agent)

### A2A Payment Flow
```
┌──────────────┐                    ┌─────────────┐
│ Price Oracle │ ──── 0.005 USDC ──▶│ News Scout  │
│   (primary)  │                    │ (sub-agent) │
└──────────────┘                    └─────────────┘
```

### A2A Transaction Structure
```
Transaction:
  Source: Treasury (sponsoring A2A for reliability)
  Operations:
    - Payment:
        Destination: Sub-agent
        Asset: USDC
        Amount: 0.0050000
  Memo: a2a:oracle>news
  Fee: 100 stroops
```

**Note:** A2A payments are treasury-sponsored (memo records the agent relationship) for reliability. Direct agent-to-agent wallet payments caused sequence conflicts.

---

## Payment Timing & Receipts

### Synchronous vs Asynchronous
- **Fast path** — Payment settles in ~3s, tx hash included in response
- **Slow path** — Payment takes longer, response returns first
- **Background completion** — Payment completes, receipt available via polling

### Polling Receipts
```
GET /receipts/:requestId
Response: { "oracle": "abc123...", "news": "def456..." }
```

### UI Integration
- Payment badges show immediately if tx hash is available
- If pending, badge shows "Confirming..."
- Click badge → Opens Stellar Expert transaction page

---

## Spending Policies

The **Spending Policy** Soroban contract demonstrates programmatic constraints:

### Use Cases
- **Daily limits** — Max 10 USDC/day for A2A payments
- **Rate limiting** — Prevent runaway agent costs
- **Budget caps** — Hard stop on agent spending
- **Approval workflows** — Multi-sig for large payments

### Contract Interface
```rust
// Check if agent can spend
fn can_spend(agent: Address, amount: i128) -> bool

// Record a spend (panics if over limit)
fn record_spend(agent: Address, amount: i128) -> i128

// Get remaining daily budget
fn get_remaining(agent: Address) -> i128
```

### Integration Pattern
```typescript
// Before A2A payment
const canSpend = await spendingPolicy.canSpend(agentAddress, amount);
if (!canSpend) {
  console.log("Daily limit exceeded, skipping A2A");
  return;
}

// After successful payment
await spendingPolicy.recordSpend(agentAddress, amount);
```

---

## Machine Payments Protocol (MPP)

Kairos aligns with Stellar's MPP vision for autonomous machine commerce:

### MPP Principles
1. **Pay-per-use** — Granular billing for API calls, compute, data
2. **Autonomous wallets** — Machines hold and manage their own funds
3. **Spending policies** — Programmable constraints via smart contracts
4. **Streaming payments** — Continuous payment flows (future)
5. **Interoperability** — Cross-chain and cross-protocol payments

### Kairos MPP Implementation
| Principle | Implementation |
|-----------|----------------|
| Pay-per-use | 0.01 USDC per agent call |
| Autonomous wallets | 9 agents with funded Stellar accounts |
| Spending policies | Soroban contract with daily limits |
| Interoperability | Stellar testnet USDC |

---

## Security Considerations

### Key Management
- Agent secrets stored in environment variables
- Never commit `.env` or `agent-wallets.json`
- Use secret managers in production (Vault, AWS Secrets)

### Treasury Security
- Treasury holds bulk funds, should be multi-sig in production
- Consider Stellar's native multi-sig (thresholds)
- Rate limit treasury operations

### Payment Validation
- Verify agent addresses before payment
- Check trustlines exist
- Handle tx_bad_seq errors (sequence conflicts)
- Implement retry with backoff

### A2A Trust
- Only pay registered agents
- Verify agent is in the Soroban registry
- Log all A2A payments for audit
