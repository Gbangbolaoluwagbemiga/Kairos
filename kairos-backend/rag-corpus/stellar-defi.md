# Stellar DeFi Ecosystem

This document provides context on DeFi protocols and yields available on the Stellar network.

---

## Blend Protocol

Blend is a decentralized lending and borrowing protocol built on Soroban.

### How Blend Works
- **Lend** — Deposit assets to earn interest
- **Borrow** — Use collateral to borrow other assets
- **Liquidation** — Undercollateralized positions are liquidated
- **Interest rates** — Algorithmically determined by utilization

### Supported Assets
- USDC (Circle)
- XLM (native)
- yXLM (yield-bearing XLM)
- Various anchor-issued stablecoins

### Typical Yields (Variable)
- USDC lending: 3-6% APY
- XLM lending: 2-4% APY
- Higher utilization = higher rates

---

## Aquarius Protocol

Aquarius is an AMM (Automated Market Maker) for liquidity provision on Stellar.

### Features
- **Liquidity pools** — Provide liquidity, earn trading fees
- **AQUA token** — Governance and rewards
- **Vote-to-earn** — Stake AQUA to vote on pool emissions
- **Concentrated liquidity** — Coming soon

### Popular Pools
- XLM/USDC
- yXLM/XLM
- AQUA/XLM

### Yield Sources
- Trading fees (0.3% per swap, split among LPs)
- AQUA emissions (bonus rewards)
- Variable APY: 5-20% depending on pool and volume

---

## SDEX (Stellar Decentralized Exchange)

The SDEX is Stellar's native, protocol-level exchange.

### Advantages Over AMMs
- **No slippage on limits** — Order book model
- **Path payments** — Atomic cross-asset swaps
- **No smart contract risk** — Built into the protocol
- **Same low fees** — 0.00001 XLM per operation

### Order Types
- **Limit orders** — Set your price
- **Passive offers** — Don't cross the spread
- **Path payments** — Swap through multiple hops atomically

### Trading Pairs
All Stellar assets can be traded against each other. Popular pairs:
- XLM/USDC
- XLM/yUSDC
- BTC.anchor/XLM
- ETH.anchor/XLM

---

## Yield Comparison: Stellar vs EVM

| Protocol | Chain | Asset | APY Range |
|----------|-------|-------|-----------|
| Blend | Stellar | USDC | 3-6% |
| Aquarius | Stellar | XLM/USDC LP | 5-15% |
| Aave | Ethereum | USDC | 2-5% |
| Compound | Ethereum | USDC | 2-4% |
| Lido | Ethereum | stETH | 3-4% |

Stellar yields are competitive with EVM, with the advantage of:
- Sub-second finality
- Near-zero transaction costs
- No gas price volatility

---

## Cross-Chain Bridges to Stellar

### Stellar Anchors
Anchors are trusted entities that issue tokenized assets on Stellar:
- **Circle** — Native USDC on Stellar
- **StellarX** — BTC, ETH anchors
- **COINQVEST** — EUR, USD stablecoins

### Bridge Protocols
- **Allbridge** — Multi-chain bridge including Stellar
- **Wormhole** — Cross-chain messaging (Stellar support planned)

### Bridging Flow
1. Lock assets on source chain
2. Anchor mints equivalent on Stellar
3. Use assets in Stellar DeFi
4. Burn on Stellar to unlock on source chain

---

## Risks in Stellar DeFi

### Smart Contract Risk (Soroban)
- Soroban is newer than EVM — less battle-tested
- Audits are critical for Soroban protocols
- Blend and Aquarius have been audited

### Anchor Risk
- Anchored assets depend on the anchor's solvency
- Circle USDC is generally trusted
- Smaller anchors carry counterparty risk

### Liquidity Risk
- Some pools have lower liquidity than EVM
- Slippage can be higher for large trades
- SDEX provides better execution for limit orders

### Impermanent Loss
- Standard AMM risk applies to Aquarius LPs
- XLM volatility affects IL in XLM pairs
- Consider IL before providing liquidity
