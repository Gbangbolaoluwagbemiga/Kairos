/**
 * Gemini Service — Stellar-Native AI Orchestrator
 * All EVM analytics (Alchemy, Etherscan, OpenSea) have been removed.
 * Remaining agents: Price Oracle, News Scout, Yield Optimizer, Tokenomics, Stellar Scout, Perp Stats
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { config } from "../config.js";
import { fetchPrice, PriceData } from "./price-oracle.js";
import { perpStatsService } from "./perp-stats/PerpStatsService.js";
import { StellarAnalyticsService } from "./stellar-analytics.js";
import { searchWeb as groqSearch } from "./search.js";
import * as defillama from "./defillama.js";
import * as newsScout from "./news-scout.js";
import * as yieldOptimizer from "./yield-optimizer.js";
import * as tokenomicsService from "./tokenomics-service.js";
import * as StellarSdk from "@stellar/stellar-sdk";
import { horizonServer, networkPassphrase, submitTransactionWithTimeoutRecovery } from "./stellar.js";
import { AgentRegistryService } from "./agent-registry.js";
import { retrieveRagAugmentation, type RagSource } from "./rag.js";

/**
 * Treasury must submit txs **one at a time**. Parallel Gemini tool calls used to race:
 * each tx reused the same account `sequence`, causing tx_bad_seq; parallel Horizon submits also time out.
 */
let treasuryPaymentQueue: Promise<unknown> = Promise.resolve();

/**
 * Cache: agent address → whether it has USDC trustline.
 * Populated on first payment; saves one Horizon loadAccount per subsequent call.
 */
const agentUsdcTrustlineCache = new Map<string, boolean>();

function runTreasurySerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = treasuryPaymentQueue.then(() => fn());
    treasuryPaymentQueue = next.then(
        () => undefined,
        () => undefined
    );
    return next;
}

/**
 * 🤝 Agent-to-Agent Payment (A2A)
 * When a specialist agent delegates to another sub-agent, it pays from its own wallet.
 * This demonstrates true autonomous agent commerce on Stellar — agents earning and spending.
 *
 * Agent secret keys are loaded from environment variables (set by generate-agent-wallets script).
 * Amount: 0.005 USDC per sub-delegation (half of the base rate, split economy).
 */
const AGENT_SECRETS: Record<string, string | undefined> = {
    oracle:        process.env.ORACLE_AGENT_SECRET,
    news:          process.env.NEWS_AGENT_SECRET,
    yield:         process.env.YIELD_AGENT_SECRET,
    tokenomics:    process.env.TOKENOMICS_AGENT_SECRET,
    perp:          process.env.PERP_AGENT_SECRET,
    "stellar-scout": process.env.STELLAR_SCOUT_AGENT_SECRET,
    protocol:      process.env.PROTOCOL_AGENT_SECRET,
    bridges:       process.env.BRIDGES_AGENT_SECRET,
    "stellar-dex": process.env.STELLAR_DEX_AGENT_SECRET,
};

export interface A2APayment {
    from: string;
    to: string;
    amount: string;
    txHash: string;
    label: string;
}

// Track a2a payments for the current request
let currentA2APayments: A2APayment[] = [];

async function sendAgentToAgentPayment(
    fromAgentId: string,
    toAgentId: string,
    label: string
): Promise<A2APayment | undefined> {
    const toMeta = await AgentRegistryService.getAgent(toAgentId);
    if (!toMeta?.owner) {
        console.warn(`[A2A] ⚠️ Could not resolve address for sub-agent: ${toAgentId}`);
        return undefined;
    }

    // Try paying from the agent's own wallet first (true peer-to-peer A2A).
    // If balance is too low (agent hasn't accumulated yet), fall back to
    // treasury-sponsored A2A — the memo records the delegation chain on-chain.
    const fromSecret = AGENT_SECRETS[fromAgentId];

    return runTreasurySerialized(async () => {
        const usdcAsset = new StellarSdk.Asset(config.stellar.usdcCode, config.stellar.usdcIssuer);
        const amount = "0.0050000";
        const memoText = `a2a:${fromAgentId.slice(0, 7)}>${toAgentId.slice(0, 7)}`;

        // Attempt 1: direct agent-to-agent payment
        if (fromSecret) {
            try {
                const fromKeypair = StellarSdk.Keypair.fromSecret(fromSecret);
                const fromAccount = await horizonServer.loadAccount(fromKeypair.publicKey());
                const usdcBalance = fromAccount.balances.find(
                    (b: any) => b.asset_code === config.stellar.usdcCode && b.asset_issuer === config.stellar.usdcIssuer
                );
                const balance = parseFloat((usdcBalance as any)?.balance || '0');

                if (balance >= 0.005) {
                    const tx = new StellarSdk.TransactionBuilder(fromAccount, {
                        fee: StellarSdk.BASE_FEE,
                        networkPassphrase,
                    })
                        .addOperation(StellarSdk.Operation.payment({
                            destination: toMeta.owner,
                            asset: usdcAsset,
                            amount,
                        }))
                        .addMemo(StellarSdk.Memo.text(memoText))
                        .setTimeout(60)
                        .build();

                    tx.sign(fromKeypair);
                    const result = await submitTransactionWithTimeoutRecovery(tx);
                    console.log(`[A2A] ✅ ${fromAgentId} → ${toAgentId} (${amount} USDC, direct): ${result.hash}`);
                    const payment: A2APayment = { from: fromAgentId, to: toAgentId, amount, txHash: result.hash, label };
                    currentA2APayments.push(payment);
                    return payment;
                }
                console.log(`[A2A] ℹ️ ${fromAgentId} USDC balance ${balance} too low — treasury-sponsored A2A`);
            } catch (err: any) {
                console.log(`[A2A] ℹ️ Direct A2A failed (${err?.message}) — falling back to treasury-sponsored`);
            }
        }

        // Attempt 2: treasury pays sub-agent on behalf of primary agent
        try {
            const treasurySecret = config.stellar.sponsorSecret;
            if (!treasurySecret?.startsWith('S')) return undefined;
            const treasuryKeypair = StellarSdk.Keypair.fromSecret(treasurySecret);
            const treasuryAccount = await horizonServer.loadAccount(treasuryKeypair.publicKey());

            const tx = new StellarSdk.TransactionBuilder(treasuryAccount, {
                fee: StellarSdk.BASE_FEE,
                networkPassphrase,
            })
                .addOperation(StellarSdk.Operation.payment({
                    destination: toMeta.owner,
                    asset: usdcAsset,
                    amount,
                }))
                .addMemo(StellarSdk.Memo.text(memoText))
                .setTimeout(60)
                .build();

            tx.sign(treasuryKeypair);
            const result = await submitTransactionWithTimeoutRecovery(tx);
            console.log(`[A2A] ✅ ${fromAgentId} → ${toAgentId} (${amount} USDC, treasury-sponsored): ${result.hash}`);
            const payment: A2APayment = { from: fromAgentId, to: toAgentId, amount, txHash: result.hash, label };
            currentA2APayments.push(payment);
            return payment;
        } catch (err: any) {
            console.error(`[A2A] ❌ ${fromAgentId} → ${toAgentId} failed:`, err?.response?.data?.extras?.result_codes || err.message);
            return undefined;
        }
    });
}

/**
 * 🚀 Real On-Chain Settlement (x402 Micropayments)
 * Sends USDC (stablecoin micropayment) from the Treasury to the Agent on Stellar Testnet.
 * Uses the AgentRegistryService to resolve on-chain details.
 */
async function sendAgentPayment(agentId: string, label: string): Promise<string | undefined> {
    const secret = config.stellar.sponsorSecret;

    // ⚠️ CRITICAL: Validate Stellar Secret Format
    if (!secret.startsWith('S')) {
        console.error(`[x402] ❌ INVALID STELLAR SECRET FORMAT. On-chain payments skipped.`);
        return `invalid_secret_format_${Date.now().toString(36)}`;
    }

    // Resolve on-chain details from Soroban Registry
    const agentMetadata = await AgentRegistryService.getAgent(agentId);
    const destination = agentMetadata?.owner;
    const price = agentMetadata?.price || "0.01";

    if (!destination) {
        console.warn(`[x402] ⚠️ Could not resolve address for agent: ${agentId}. Skipping payment.`);
        return undefined;
    }

    return runTreasurySerialized(async () => {
        try {
            const sourceKeypair = StellarSdk.Keypair.fromSecret(secret);
            const sourcePublicKey = sourceKeypair.publicKey();
            const usdcAsset = new StellarSdk.Asset(config.stellar.usdcCode, config.stellar.usdcIssuer);
            const sourceIsIssuer = sourcePublicKey === config.stellar.usdcIssuer;

            let operation: StellarSdk.xdr.Operation;
            let paidCurrency: "USDC" | "XLM" = "USDC";
            let useUsdc = true;

            // Check destination trustline — use cache to avoid an extra loadAccount each payment
            const cachedTrustline = agentUsdcTrustlineCache.get(destination);
            if (cachedTrustline === false) {
                useUsdc = false;
            } else if (cachedTrustline === undefined) {
                // Not yet cached — check once and store result
                try {
                    const destAccount = await horizonServer.loadAccount(destination);
                    const hasTrustline = destAccount.balances.some(
                        (b: any) => b.asset_code === config.stellar.usdcCode && b.asset_issuer === config.stellar.usdcIssuer
                    );
                    agentUsdcTrustlineCache.set(destination, hasTrustline);
                    if (!hasTrustline) {
                        useUsdc = false;
                        console.warn(`[x402-Stellar] ⚠️ Agent ${agentId} missing USDC trustline. Falling back to XLM.`);
                    }
                } catch (e: any) {
                    if (e?.response?.status === 404) {
                        agentUsdcTrustlineCache.set(destination, false);
                        paidCurrency = "XLM";
                        const sourceAccount = await horizonServer.loadAccount(sourcePublicKey);
                        console.warn(`[x402-Stellar] ⚠️ Agent ${agentId} account missing. Creating with XLM.`);
                        const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
                            fee: StellarSdk.BASE_FEE,
                            networkPassphrase,
                        })
                            .addOperation(StellarSdk.Operation.createAccount({ destination, startingBalance: "1.5000000" }))
                            .addMemo(StellarSdk.Memo.text(`x402:${agentId}:${label.slice(0, 5)}`))
                            .setTimeout(60)
                            .build();
                        tx.sign(sourceKeypair);
                        const result = await submitTransactionWithTimeoutRecovery(tx);
                        console.log(`[x402-Stellar] ✅ Created Agent ${agentId}: ${result.hash}`);
                        return result.hash;
                    }
                    throw e;
                }
            }

            // Treasury is the USDC issuer — no need to check its own trustline
            if (!sourceIsIssuer && useUsdc) {
                const sourceAccount = await horizonServer.loadAccount(sourcePublicKey);
                const hasTrustline = sourceAccount.balances.some(
                    (b: any) => b.asset_code === config.stellar.usdcCode && b.asset_issuer === config.stellar.usdcIssuer
                );
                if (!hasTrustline) {
                    useUsdc = false;
                    console.warn(`[x402-Stellar] ⚠️ Treasury has no USDC trustline. Falling back to XLM.`);
                }
            }

            // Load treasury account for sequence number (required, but only one call now)
            const sourceAccount = await horizonServer.loadAccount(sourcePublicKey);

            if (useUsdc) {
                operation = StellarSdk.Operation.payment({
                    destination,
                    asset: usdcAsset,
                    amount: Number(price).toFixed(7),
                });
            } else {
                paidCurrency = "XLM";
                operation = StellarSdk.Operation.payment({
                    destination,
                    asset: StellarSdk.Asset.native(),
                    amount: "0.0010000",
                });
            }

            const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
                fee: StellarSdk.BASE_FEE,
                networkPassphrase,
            })
                .addOperation(operation)
                .addMemo(StellarSdk.Memo.text(`x402:${agentId}:${label.slice(0, 5)}`))
                .setTimeout(60)
                .build();

            transaction.sign(sourceKeypair);
            const result = await submitTransactionWithTimeoutRecovery(transaction);

            const paidAmount = paidCurrency === "USDC" ? Number(price).toFixed(7) : "0.0010000";
            console.log(`[x402-Stellar] ✅ Paid Agent ${agentId} (${paidAmount} ${paidCurrency}): ${result.hash}`);
            return result.hash;
        } catch (error: any) {
            const errorDetail = error?.response?.data?.extras?.result_codes || error?.response?.data?.detail || error.message;
            console.error(`[x402-Stellar] ❌ Payment failed for ${agentId}:`, errorDetail);
            return undefined;
        }
    });
}

// Payment wrappers — one per agent, each with its own wallet
const createOraclePayment       = (label: string) => sendAgentPayment('oracle', label);
const createNewsScoutPayment    = (label: string) => sendAgentPayment('news', label);
const createYieldOptimizerPayment = (label: string) => sendAgentPayment('yield', label);
const createTokenomicsPayment   = (label: string) => sendAgentPayment('tokenomics', label);
const createPerpStatsPayment    = (label: string) => sendAgentPayment('perp', label);
const createStellarScoutPayment = (label: string) => sendAgentPayment('stellar-scout', label);
const createProtocolPayment     = (label: string) => sendAgentPayment('protocol', label);
const createBridgesPayment      = (label: string) => sendAgentPayment('bridges', label);
const createStellarDexPayment   = (label: string) => sendAgentPayment('stellar-dex', label);

async function withTimeoutOptional<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
    try {
        return await Promise.race([
            p,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
        ]);
    } catch {
        return undefined;
    }
}

// Keep responses fast: do not block on payment confirmation.
// We still use this value when callers *optionally* await a hash.
const PAYMENT_CAPTURE_TIMEOUT_MS = Number(process.env.KAIROS_PAYMENT_CAPTURE_TIMEOUT_MS || 2500);

let genAI: GoogleGenerativeAI | null = null;

// Track oracle usage for this session
let oracleQueryCount = 0;
// Track chain scout usage for this session
let scoutQueryCount = 0;
// Track news scout usage for this session
let newsScoutQueryCount = 0;
// Track yield optimizer usage for this session
let yieldOptimizerQueryCount = 0;

export function initGemini(apiKey: string) {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log(`[Provider] Gemini initialized with model: ${config.gemini.model}`);
}

export function getOracleQueryCount(): number {
    return oracleQueryCount;
}

export function getScoutQueryCount(): number {
    return scoutQueryCount;
}

export function getNewsScoutQueryCount(): number {
    return newsScoutQueryCount;
}

export function getYieldOptimizerQueryCount(): number {
    return yieldOptimizerQueryCount;
}


// Function to handle protocol stats queries
async function handleGetProtocolStats(protocol: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📊 Getting protocol stats for: ${protocol}...`);

    const payP = withTimeoutOptional(createProtocolPayment(`protocol:${protocol}`), PAYMENT_CAPTURE_TIMEOUT_MS);
    const stats = await defillama.getProtocolStats(protocol);

    if (!stats) {
        return { data: JSON.stringify({ error: `Could not find protocol: ${protocol}. Try: aave, uniswap, lido, compound, curve, makerdao` }) };
    }

    let txHash: string | undefined;
    txHash = await payP;

    return {
        data: JSON.stringify({
            name: stats.name,
            category: stats.category,
            symbol: stats.symbol,
            tvl: stats.tvl,
            tvlChange24h: stats.tvlChange24h,
            mcap: stats.mcap,
            fees24h: stats.fees24h,
            fees7d: stats.fees7d,
            fees30d: stats.fees30d,
            revenue24h: stats.revenue24h,
            revenue7d: stats.revenue7d,
            chains: stats.chains.slice(0, 8),
            url: stats.url
        }),
        txHash
    };
}

// Function to handle bridges queries
async function handleGetBridges(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🌉 Getting bridge volumes...`);

    const bridges = await defillama.getBridges();

    if (!bridges || bridges.length === 0) {
        return { data: JSON.stringify({ error: "Could not fetch bridge data. Try again later." }) };
    }

    // Only pay once we have real data to return
    const txHash = await withTimeoutOptional(createBridgesPayment(`bridges`), PAYMENT_CAPTURE_TIMEOUT_MS);

    return {
        data: JSON.stringify({
            count: bridges.length,
            topBridges: bridges.slice(0, 8).map((b: any) => ({
                name: b.displayName,
                tvl: b.tvl,
                chains: b.chains?.slice(0, 5),
            })),
            note: "TVL-ranked bridge protocols from DeFiLlama. Volume data from bridges.llama.fi requires a paid plan."
        }),
        txHash
    };
}

// Function to handle Stellar SDEX stats
async function handleGetStellarStats(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 💫 Getting Stellar SDEX stats...`);
    const payP = withTimeoutOptional(createStellarDexPayment("sdex_stats"), PAYMENT_CAPTURE_TIMEOUT_MS);
    const stats = await StellarAnalyticsService.getSdexStats();
    if (!stats) return { data: JSON.stringify({ error: "Could not fetch Stellar stats" }) };

    const txHash = await payP;

    return { data: JSON.stringify(stats), txHash };
}

// Function to handle Stellar yields
async function handleGetStellarYields(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🌾 Getting Stellar DeFi yields...`);
    const payP = withTimeoutOptional(createStellarScoutPayment("yields"), PAYMENT_CAPTURE_TIMEOUT_MS);
    const yields = await StellarAnalyticsService.getStellarYields();
    if (!yields) return { data: JSON.stringify({ error: "Could not fetch Stellar yields" }) };

    // Pay Stellar Scout
    const txHash = await payP;

    return { data: JSON.stringify(yields), txHash };
}

// Function to handle Stellar account analysis
async function handleGetStellarAccount(address: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🔍 Analyzing Stellar account: ${address}...`);
    const payP = withTimeoutOptional(createStellarScoutPayment(`account:${address}`), PAYMENT_CAPTURE_TIMEOUT_MS);
    const details = await StellarAnalyticsService.getAccountDetails(address);
    if (!details) return { data: JSON.stringify({ error: "Account not found or invalid" }) };

    // Pay Stellar Scout
    const txHash = await payP;

    return { data: JSON.stringify(details), txHash };
}

const SYSTEM_PROMPT = `You are Kairos, the premier AI agentic marketplace for the Stellar ecosystem. 
You facilitate a multi-agent economy where agents pay each other using x402 USDC micropayments.

**ROUTING (CRITICAL):**
- Only the tools you actually call determine which specialist answered. Do not pretend to be "Price Oracle" unless you called getPriceData.
- For **"why is X dumping/pumping?", market analysis, current events, macroeconomic crypto news, regulatory news**: use your built-in **Google Search** grounding (it activates automatically when you need live web data).
- For **Stellar on-chain activity, "latest Stellar network events"**: call **getNews**.
- For **general crypto news headlines or current events**: rely on Google Search grounding — it gives real web results.
- For **prices, ATH, market cap, "how much is X"**: call **getPriceData**.
- For **Stellar SDEX / network stats**: call **getStellarStats** or **getStellarAccount** as appropriate.
- For **"which bridge", "how to bridge", "bridge ETH to XLM", "convert across chains", "cross-chain transfer", "move funds between chains"**: call **getBridges** to surface real bridge options, then answer using that data.
- For **simple greetings** ("hi", "hey", "hello", "good morning", thanks, small talk): reply in 1–3 friendly sentences **with NO tools**. Do not attribute the reply to a named specialist agent.

**IMPORTANT CONTEXT:**
- You operate exclusively in the crypto/blockchain/DeFi space, with a special focus on STELLAR and SOROBAN.
- Use Stellar-native terminology (Assets, Trustlines, SDEX, Soroban).
- When users mention "XLM" or "Stellar", use your Stellar-specific tools.

**On-chain x402 payments (do not invent numbers):**
- Treasury-to-agent payments are **0.01 USDC** per specialist invocation. Agent accounts are pre-configured with USDC trustlines so USDC payments should now succeed.
- If USDC still fails, the fallback is **0.001 XLM** — block explorers show **XLM**, not USDC, for those txs.
- UI copy says **~$0.03 per chat** as a **bundled UX estimate**, not the literal per-operation amount.
- **Never** state "0.1 USDC" or any invented amount.
- On Stellar Expert, **Max Fee** (0.00001 XLM) is the **network fee to validators**, NOT the payment to the agent. The agent receives the payment operation amount (0.01 USDC or 0.001 XLM) which is a separate field in the transaction.

**Your Capabilities:**
- PRICE ORACLE: Real-time prices for any crypto (XLM, USDC, BTC, ETH, etc.) via CoinGecko.
- STELLAR SCOUT: SDEX volume, Stellar DeFi yields (Blend/Aquarius), and account analysis.
- NEWS SCOUT: Real-time crypto news and sentiment analysis.
- PERP STATS: Perpetual futures funding rates, open interest, and volume.
- PROTOCOL STATS: DeFi protocol TVL, fees, and revenue via DeFiLlama.
- BRIDGE MONITOR: Top cross-chain bridges by TVL, supported chains, and how to bridge between networks (ETH→XLM, etc.).

**Special Data Handling:**
- ALL-TIME HIGH (ATH): When using the Price Oracle, always report the ATH and the date it was reached if available. The user expects professional, 'top tier' financial responses.
- Historical context: If the current price is significantly below the ATH, mention the percentage drawdown.

**When Users Ask About Stellar:**
- To check SDEX volume/stats, YOU MUST USE getStellarStats.
- To find yields on Stellar (Blend, Aquarius), YOU MUST USE getStellarYields.
- To analyze a Stellar account (G...), YOU MUST USE getStellarAccount.
- Stellar addresses start with 'G'.

**Handling Tool Failures (STRICT):**
- If a tool returns a "system_note" key: follow the instruction silently — **never mention it to the user**, never say "timeout", "unavailable", "search tools", "live feed", or similar.
- If a tool returns valid data, USE IT — do NOT say it's unavailable.
- **NEVER** tell the user about internal timeouts, tool errors, or search failures. Just answer from knowledge.
- **NEVER** apologize at length before answering. No multi-paragraph apologies.
- Do not make up specific prices, headlines, or metrics as if they were live.

**Standard Formatting:**
- Use emojis to make responses visually appealing.
- Be concise but thorough. Users pay for every query.
- Always provide accurate, up-to-date information. Cite sources when relevant.`;

// Function declaration for price oracle
const getPriceDataFunction = {
    name: "getPriceData",
    description: "Get real-time cryptocurrency price data. Use this when users ask about crypto prices, market caps, or 24h changes. Supports: bitcoin, ethereum, solana, usdc, usdt, bnb, xrp, ada, doge, xpl, arb, op, sui, and 100+ more tokens.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            symbol: {
                type: SchemaType.STRING,
                description: "The cryptocurrency symbol or name, e.g., 'bitcoin', 'ethereum', 'btc', 'eth', 'sol', 'xpl'",
            },
        },
        required: ["symbol"],
    },
};

// Function declaration for web search
const searchWebFunction = {
    name: "searchWeb",
    description: "Search the web for real-time information. Use this for: crypto market analysis ('why is X dumping/pumping?'), current events, macroeconomic factors affecting crypto, company news, regulatory news, general 'why' questions about market moves, or anything that requires live web results. PREFER this over getNews for market explanation questions.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            query: {
                type: SchemaType.STRING,
                description: "The search query to look up on the web",
            },
        },
        required: ["query"],
    },
};

// Function declaration for protocol stats
const getProtocolStatsFunction = {
    name: "getProtocolStats",
    description: "Get detailed stats for a DeFi protocol including TVL, fees, revenue. Use when users ask about protocol metrics like 'What's Aave's TVL?' or 'Uniswap fees?'. Supports: aave, uniswap, lido, makerdao, compound, curve, etc.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            protocol: {
                type: SchemaType.STRING,
                description: "The protocol name (e.g., 'aave', 'uniswap', 'lido', 'compound')",
            },
        },
        required: ["protocol"],
    },
};

// Function declaration for bridges
const getBridgesFunction = {
    name: "getBridges",
    description: "Get top cross-chain bridges ranked by TVL. Use this whenever users ask: 'which bridge should I use?', 'how do I bridge ETH to XLM?', 'what bridges support Stellar?', 'how to convert ETH to XLM', 'move funds from Ethereum to Stellar', 'cross-chain transfer options', or any question about bridging assets between blockchains. Also use for bridge volume or activity questions.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for hacks
const getHacksFunction = {
    name: "getHacks",
    description: "Get recent DeFi hacks and exploits database. Shows protocol name, amount lost, and attack type. Use when users ask about security incidents or recent exploits.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for crypto news
const getNewsFunction = {
    name: "getNews",
    description: "Get live Stellar network activity and on-chain events (recent operations from Horizon ledger). Best for: 'show me Stellar network activity', 'what's happening on-chain', 'latest Stellar transactions'. For general crypto news or market explanations ('why is X dumping'), use searchWeb instead.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            query: {
                type: SchemaType.STRING,
                description: "Optional search query to filter news by topic (e.g., 'solana', 'ethereum', 'regulatory')"
            },
            category: {
                type: SchemaType.STRING,
                enum: ["all", "bitcoin", "defi", "breaking"],
                description: "News category to filter by. Use 'breaking' for urgent news, 'bitcoin' for BTC-focused, 'defi' for DeFi news."
            }
        },
        required: [],
    },
};

// Function declaration for trending topics
const getTrendingFunction = {
    name: "getTrending",
    description: "Get trending topics in crypto with sentiment analysis. Shows what's being talked about most, with bullish/bearish/neutral sentiment. Use when users ask about 'what's trending', 'hot topics', or 'market sentiment'.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for yield optimizer
const getYieldsFunction = {
    name: "getYields",
    description: "Get DeFi yield opportunities from Lido, Yearn, Beefy, Curve, Aave, Pendle, and Turtle. Use when users ask about 'best yields', 'APY', 'where to earn', 'staking rates', 'vault yields', 'show more yields', 'lending rates', or mention any of these protocols by name (including 'Turtle'). Supports filtering by chain, asset, type, APY range (min/max), and pagination. IMPORTANT: Always explicitly state the total number of opportunities found (from the 'totalCount' field) in your response before listing them.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            chain: {
                type: SchemaType.STRING,
                description: "Filter by blockchain (ethereum, arbitrum, polygon, optimism, base)",
            },
            asset: {
                type: SchemaType.STRING,
                description: "Filter by asset (ETH, USDC, USDT, DAI, stETH, etc.)",
            },
            protocol: {
                type: SchemaType.STRING,
                enum: ["lido", "aave", "yearn", "beefy", "curve", "pendle", "turtle"],
                description: "Filter by specific protocol (Lido, Aave, Yearn, Beefy, Curve, Pendle, Turtle). Use when user asks about a specific protocol.",
            },
            type: {
                type: SchemaType.STRING,
                enum: ["staking", "lending", "vault", "lp", "fixed"],
                description: "Filter by yield type: staking (Lido), lending (Aave/Turtle), vault (Yearn/Beefy/Turtle), lp (Curve), fixed (Pendle)",
            },
            minApy: {
                type: SchemaType.NUMBER,
                description: "Minimum APY percentage to filter (e.g., 10 for 10%+)",
            },
            maxApy: {
                type: SchemaType.NUMBER,
                description: "Maximum APY percentage to filter (e.g., 20 for up to 20%). Use with minApy for range queries like '10-20% APY'.",
            },
            page: {
                type: SchemaType.NUMBER,
                description: "Page number for pagination (1-based). Use when user says 'show more' or 'next page'. Default is 1.",
            },
        },
        required: [],
    },
};

// Function declaration for tokenomics analyzer
const getTokenomicsFunction = {
    name: "getTokenomics",
    description: "Get tokenomics analysis for a cryptocurrency including supply data, vesting schedule, token unlocks, allocation breakdown, and inflation rate. Use when users ask about 'tokenomics', 'vesting', 'unlock schedule', 'token distribution', 'supply', or 'inflation' for a specific token. Supports ARB, OP, SUI, APT, ETH, SOL, and many more tokens.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            symbol: {
                type: SchemaType.STRING,
                description: "Token symbol (e.g., ARB, OP, SUI, APT, ETH, SOL)",
            },
        },
        required: ["symbol"],
    },
};



// Function declaration for Perp Global Stats
const getGlobalPerpStatsFunction = {
    name: "getGlobalPerpStats",
    description: "Get aggregated global perpetual market statistics including Total Open Interest and Total 24h Volume across all exchanges. Use when users ask about 'market open interest', 'total crypto perp volume', or general market activity levels.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for Perp Markets
const getPerpMarketsFunction = {
    name: "getPerpMarkets",
    description: "Get funding rates, open interest, and volume for specific perpetual markets. Use when users ask about 'funding rates for BTC', 'best funding yields', 'open interest on ETH', 'who has highest funding', 'negative funding rates'.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            symbol: {
                type: SchemaType.STRING,
                description: "Optional: Filter by token symbol (e.g. BTC, ETH, SOL). If omitted, returns top markets.",
            },
        },
        required: [],
    },
};

// Function declaration for Stellar stats
const getStellarStatsFunction = {
    name: "getStellarStats",
    description: "Get real-time Stellar SDEX statistics, top trading pairs and network volume. Use when users ask about Stellar trading, SDEX, or network activity.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
};

// Function declaration for Stellar yields
const getStellarYieldsFunction = {
    name: "getStellarYields",
    description: "Get current DeFi yield opportunities on the Stellar network (Blend, Aquarius, etc.). Use when users ask for yields or APY specifically on Stellar.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
};

// Function declaration for Stellar account info
const getStellarAccountFunction = {
    name: "getStellarAccount",
    description: "Analyze a Stellar account (G...) to get balances, trustlines, and sponsorship details. Use when users provide a Stellar public key.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            address: {
                type: SchemaType.STRING,
                description: "The Stellar Public Key starting with 'G' (e.g., GABCD...)",
            },
        },
        required: ["address"],
    },
};

export interface ImageData {
    base64: string;
    mimeType: string;
}

export interface ConversationMessage {
    role: "user" | "model";
    content: string;
}

// Function to handle price oracle calls with payment tracking
async function handleGetPriceData(
    symbol: string,
    receiptSink?: (agentId: string, txHash: string) => void
): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🔮 Calling Price Oracle for ${symbol}...`);

    const priceData = await fetchPrice(symbol);

    if (!priceData) {
        return { data: JSON.stringify({ error: `Could not find price data for ${symbol}` }) };
    }

    // Pay Oracle
    oracleQueryCount++;
    // Fire-and-forget payment: keep response fast, but publish receipt when ready.
    const payP = createOraclePayment(`price:${symbol}`);
    void payP.then((h) => { if (h) receiptSink?.("oracle", h); }).catch(() => {});
    const txHash = await withTimeoutOptional(payP, 200); // opportunistic capture (doesn't slow much)

    return {
        data: JSON.stringify({
            symbol: priceData.symbol,
            name: priceData.name,
            price: priceData.price,
            currency: priceData.currency,
            change24h: priceData.change24h,
            marketCap: priceData.marketCap,
            volume24h: priceData.volume24h,
            ath: priceData.ath,
            athDate: priceData.athDate,
            lastUpdated: priceData.lastUpdated,
        }),
        txHash
    };
}

// Function to handle web search calls
async function handleSearchWeb(query: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🌐 Searching web for: "${query}"...`);

    const searchResult = await groqSearch(query);

    if (!searchResult) {
        return { data: JSON.stringify({
            system_note: "Live search data not available for this query. Answer confidently from training knowledge — do NOT mention any timeout, unavailability, or tool failure to the user. Just answer directly."
        }) };
    }

    return {
        data: JSON.stringify({
            query: searchResult.query,
            answer: searchResult.answer,
            sources: searchResult.results.map(r => ({
                title: r.title,
                url: r.url,
                content: r.content,
            })),
        })
    };
}



// Function to handle hacks queries
async function handleGetHacks(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] ⚠️ Getting recent DeFi hacks...`);

    const payP = withTimeoutOptional(createStellarScoutPayment(`hacks`), PAYMENT_CAPTURE_TIMEOUT_MS);
    const hacks = await defillama.getHacks();

    if (!hacks) {
        return { data: JSON.stringify({ error: "Could not fetch hacks data. Try again later." }) };
    }

    // Pay Stellar Scout for research
    const txHash = await payP;

    return {
        data: JSON.stringify({
            count: hacks.length,
            recentHacks: hacks.slice(0, 7).map(h => ({
                name: h.name,
                amount: h.amount,
                date: new Date(h.date).toLocaleDateString(),
                classification: h.classification,
                technique: h.technique,
                targetType: h.targetType,
                source: h.source,
                returnedFunds: h.returnedFunds,
                isBridgeHack: h.bridgeHack
            })),
        }),
        txHash
    };
}

// Function to handle crypto news queries
async function handleGetNews(
    query?: string,
    category?: string,
    receiptSink?: (agentId: string, txHash: string) => void
): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📰 Getting crypto news... query="${query || 'none'}", category="${category || 'all'}"`);

    let news;

    if (category === "breaking") {
        news = await newsScout.getBreakingNews();
    } else if (category === "bitcoin") {
        news = await newsScout.getBitcoinNews();
    } else if (category === "defi") {
        news = await newsScout.getDefiNews();
    } else if (query) {
        news = await newsScout.searchNews(query);
    } else {
        news = await newsScout.getLatestNews();
    }

    if (!news || news.articles.length === 0) {
        return { data: JSON.stringify({ error: "Could not fetch Stellar network activity. Try again later." }) };
    }

    newsScoutQueryCount++;
    const payP = createNewsScoutPayment(`news:${query || category || 'latest'}`);
    void payP.then((h) => { if (h) receiptSink?.("news", h); }).catch(() => {});
    const txHash = await withTimeoutOptional(payP, 200);

    return {
        data: JSON.stringify({
            note: "These are live Stellar network operations fetched from Horizon ledger, NOT traditional crypto news. Present them as on-chain activity, not headlines.",
            articles: news.articles.slice(0, 8).map(a => ({
                title: a.title,
                description: a.description,
                link: a.link,
                source: a.source,
                timeAgo: a.timeAgo
            })),
            totalCount: news.totalCount,
            sources: news.sources,
            fetchedAt: news.fetchedAt
        }),
        txHash
    };
}

// Function to handle trending topics
async function handleGetTrending(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📈 Getting trending crypto topics...`);

    const payP = withTimeoutOptional(createNewsScoutPayment(`trending:topics`), PAYMENT_CAPTURE_TIMEOUT_MS);
    const trending = await newsScout.getTrendingTopics();

    if (!trending) {
        return { data: JSON.stringify({ error: "Could not fetch trending data. Try again later." }) };
    }

    // Pay News Scout agent
    newsScoutQueryCount++;
    const txHash = await payP;

    return {
        data: JSON.stringify({
            trending: [{
                topic: "Stellar SDEX Activity (XLM/USDC)",
                count: trending.trade_count,
                sentiment: parseFloat(trending.close) >= parseFloat(trending.open) ? "bullish" : "bearish",
                headline: `24h Volume: ${parseFloat(trending.base_volume).toLocaleString()} XLM | Avg Price: ${parseFloat(trending.avg).toFixed(4)} USDC`
            }],
            articlesAnalyzed: trending.trade_count,
            timeWindow: "24h (Real-time Horizon Data)"
        }),
        txHash
    };
}

// Function to handle yield queries
async function handleGetYields(options?: { chain?: string; type?: string; minApy?: number; maxApy?: number; asset?: string; protocol?: string; page?: number }): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🌾 Getting DeFi yields...`, options);

    try {
        const page = options?.page || 1;
        const pageSize = 20; // Show 20 results per page

        let result;

        if (options?.asset) {
            result = await yieldOptimizer.getYieldsForAsset(options.asset);
            result = { opportunities: result, totalCount: result.length, fetchedAt: new Date().toISOString() };
        } else {
            result = await yieldOptimizer.getTopYields({
                chain: options?.chain,
                type: options?.type,
                protocol: options?.protocol,
                minApy: options?.minApy,
                maxApy: options?.maxApy,
                limit: 100 // Fetch up to 100 to support pagination
            });
        }

        if (!result || result.opportunities.length === 0) {
            return { data: JSON.stringify({ error: "No yield opportunities found matching your criteria. Try different filters." }) };
        }

        // Pay Yield Optimizer agent (only on first page) without blocking the response too long
        let txHash: string | undefined;
        if (page === 1) {
            yieldOptimizerQueryCount++;
            txHash = await withTimeoutOptional(createYieldOptimizerPayment(`yields:${options?.chain || options?.asset || 'top'}`), PAYMENT_CAPTURE_TIMEOUT_MS);
        }

        // Calculate pagination
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedOpportunities = result.opportunities.slice(startIndex, endIndex);
        const totalPages = Math.ceil(result.totalCount / pageSize);
        const hasMore = page < totalPages;

        return {
            data: JSON.stringify({
                opportunities: paginatedOpportunities.map(y => ({
                    protocol: y.protocol,
                    name: y.name,
                    asset: y.asset,
                    apy: y.apy,
                    tvl: y.tvl,
                    chain: y.chain,
                    risk: y.risk,
                    type: y.type,
                    url: y.url
                })),
                showing: paginatedOpportunities.length,
                totalCount: result.totalCount,
                page: page,
                totalPages: totalPages,
                hasMore: hasMore,
                nextPageHint: hasMore ? `Say "show more yields" or "page ${page + 1}" to see more` : null,
                fetchedAt: result.fetchedAt
            }),
            txHash
        };
    } catch (error) {
        console.error("[Gemini] Yield fetch error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch yield data. Try again later." }) };
    }
}

// Track tokenomics usage for this session
let tokenomicsQueryCount = 0;

export function getTokenomicsQueryCount(): number {
    return tokenomicsQueryCount;
}

// Track perp stats usage
let perpStatsQueryCount = 0;

export function getPerpStatsQueryCount(): number {
    return perpStatsQueryCount;
}

// Function to handle Global Perp Stats
async function handleGetGlobalPerpStats(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📊 Getting global perp stats...`);

    try {
        // Pay Perp Stats Agent
        perpStatsQueryCount++;
        const txHash = await withTimeoutOptional(createPerpStatsPayment('global'), PAYMENT_CAPTURE_TIMEOUT_MS);

        const stats = await perpStatsService.getGlobalStats();
        return { data: JSON.stringify(stats), txHash };
    } catch (error) {
        console.error("Perp Stats Error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch global perp stats." }) };
    }
}

// Function to handle Perp Markets
async function handleGetPerpMarkets(symbol?: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📈 Getting perp markets${symbol ? ` for ${symbol}` : ''}...`);

    try {
        // Pay Perp Stats Agent
        perpStatsQueryCount++;
        const txHash = await withTimeoutOptional(createPerpStatsPayment(`markets:${symbol || 'all'}`), PAYMENT_CAPTURE_TIMEOUT_MS);

        let markets = await perpStatsService.getMarkets();

        if (symbol) {
            let s = symbol.toUpperCase();

            // Normalize common names to tickers
            const MAPPINGS: Record<string, string> = {
                "BITCOIN": "BTC",
                "ETHEREUM": "ETH",
                "SOLANA": "SOL",
                "RIPPLE": "XRP",
                "CARDANO": "ADA",
                "DOGECOIN": "DOGE",
                "AVALANCHE": "AVAX",
                "MATIC": "POL",
                "POLYGON": "POL"
            };
            if (MAPPINGS[s]) s = MAPPINGS[s];

            // Loose match: Allow "BTC" to match "BTC-USD", "BTCUSD", "BTC-PERP"
            markets = markets.filter(m => {
                const mSym = m.symbol.toUpperCase();
                return mSym === s || mSym.includes(s) || mSym.replace(/[-_]/g, '') === s;
            });

            if (markets.length === 0) {
                return { data: JSON.stringify({ error: `No perp markets found matching "${symbol}".` }), txHash };
            }
        } else {
            // If no symbol, return top 60 by OI to ensure diversity across exchanges (Hyperliquid dominates top 20)
            markets = markets.sort((a, b) => b.openInterestUsd - a.openInterestUsd).slice(0, 60);
        }

        return { data: JSON.stringify({ markets }), txHash };
    } catch (error) {
        console.error("Perp Stats Error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch perp markets." }) };
    }
}




// Function to handle tokenomics analysis
async function handleGetTokenomics(symbol: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📊 Analyzing tokenomics for ${symbol}...`);

    const payP = withTimeoutOptional(createTokenomicsPayment(`tokenomics:${symbol}`), PAYMENT_CAPTURE_TIMEOUT_MS);
    const analysis = await tokenomicsService.analyzeTokenomics(symbol);

    if (!analysis) {
        return { data: JSON.stringify({ error: `Could not find tokenomics data for ${symbol}. Try a different token (ARB, OP, SUI, APT, ETH, SOL).` }) };
    }

    // Pay Tokenomics agent
    tokenomicsQueryCount++;
    const txHash = await payP;

    // Format response for Gemini
    const hasUnlocks = analysis.upcomingUnlocks.length > 0;
    const isFullyCirculating = analysis.supply.percentUnlocked >= 99;

    return {
        data: JSON.stringify({
            symbol: analysis.symbol,
            name: analysis.name,
            supply: {
                circulating: analysis.supply.circulatingFormatted,
                total: analysis.supply.totalFormatted,
                max: analysis.supply.maxFormatted,
                percentUnlocked: analysis.supply.percentUnlocked + '%',
            },
            nextUnlock: analysis.nextUnlock ? {
                date: analysis.nextUnlock.date,
                amount: analysis.nextUnlock.amountFormatted,
                percentOfCirculating: analysis.nextUnlock.percentOfCirculating + '%',
                recipient: analysis.nextUnlock.recipient,
                riskLevel: analysis.nextUnlock.riskLevel,
            } : null,
            noUnlocksNote: !hasUnlocks ? (
                isFullyCirculating
                    ? "This token is fully circulating with no locked supply remaining."
                    : "Detailed unlock schedule data is not available for this token. Check sources like Token Unlocks or the project's official documentation for more info."
            ) : null,
            upcomingUnlocks: analysis.upcomingUnlocks.slice(0, 3).map(u =>
                `${u.date}: ${u.amountFormatted} (${u.percentOfCirculating}% of circ supply) - ${u.riskLevel}`
            ),
            allocations: analysis.allocations.map(a => `${a.category}: ${a.percentage}%`),
            inflation: analysis.inflation,
            fetchedAt: analysis.fetchedAt,
        }),
        txHash
    };
}

export interface GenerateResponseResult {
    response: string;
    agentsUsed: string[];
    x402Transactions: Record<string, string>; // agentId -> txHash for x402 payments
    a2aPayments?: A2APayment[];               // agent-to-agent sub-payments
    partial?: boolean;
    /** Populated when RAG retrieved corpus excerpts for this turn */
    ragSources?: RagSource[];
}

export async function generateResponse(
    prompt: string,
    imageData?: ImageData,
    conversationHistory?: ConversationMessage[],
    receiptSink?: (agentId: string, txHash: string) => void
): Promise<GenerateResponseResult> {
    if (!genAI) {
        throw new Error("Gemini not initialized. Call initGemini first.");
    }

    let ragSources: RagSource[] | undefined;
    let augmentedUserText = prompt || "";
    if (!imageData && (prompt || "").trim().length >= 8) {
        try {
            const rag = await retrieveRagAugmentation(prompt);
            if (rag) {
                augmentedUserText = `${rag.prefixText}\n\n${(prompt || "").trim()}`;
                ragSources = rag.sources;
            }
        } catch (e) {
            console.warn("[RAG] augmentation skipped:", e);
        }
    }

    // Track which agents are called
    const agentsUsed = new Set<string>();
    // Track x402 transaction hashes per agent
    const x402Transactions: Record<string, string> = {};
    let partial = false;
    // Reset A2A payments for this request
    currentA2APayments = [];
    const startedAt = Date.now();
    // Best-effort latency cap:
    // Keep typical responses fast (<~5s end-to-end) by limiting tool execution time.
    // Still overridable via env for deeper/longer analysis.
    const TOOL_BUDGET_MS = Number(process.env.KAIROS_TOOL_BUDGET_MS || 6500);
    const TOOL_TIMEOUT_MS = Number(process.env.KAIROS_TOOL_TIMEOUT_MS || 6000);

    const remainingMs = () => TOOL_BUDGET_MS - (Date.now() - startedAt);

    async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
        return await Promise.race([
            p,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout_after_${ms}ms`)), ms)),
        ]);
    }

    function wrapToolResult(raw: string) {
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed !== "object" || parsed === null) return { result: parsed };
            return parsed;
        } catch {
            return { error: "Failed to parse tool result", raw };
        }
    }

    async function executeToolCall(call: any): Promise<{ name: string; raw: string }> {
        // Global time budget check
        if (remainingMs() <= 0) {
            partial = true;
            return { name: call.name, raw: JSON.stringify({ error: "Time budget exceeded" }) };
        }

        const perCallTimeout = Math.max(250, Math.min(TOOL_TIMEOUT_MS, remainingMs()));

        try {
            if (call.name === "getPriceData") {
                agentsUsed.add("oracle");
                const args = call.args as { symbol: string };
                const r = await withTimeout(handleGetPriceData(args.symbol, receiptSink), perCallTimeout);
                if (r.txHash) x402Transactions["oracle"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "searchWeb") {
                agentsUsed.add("news");
                const args = call.args as { query: string };
                const r = await withTimeout(handleSearchWeb(args.query), perCallTimeout);
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getProtocolStats") {
                agentsUsed.add("protocol");
                const args = call.args as { protocol: string };
                const r = await withTimeout(handleGetProtocolStats(args.protocol), perCallTimeout);
                if (r.txHash) x402Transactions["protocol"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getBridges") {
                agentsUsed.add("bridges");
                const r = await withTimeout(handleGetBridges(), perCallTimeout);
                if (r.txHash) x402Transactions["bridges"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getHacks") {
                agentsUsed.add("protocol");
                const r = await withTimeout(handleGetHacks(), perCallTimeout);
                if (r.txHash) x402Transactions["protocol"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getNews") {
                agentsUsed.add("news");
                const args = call.args as { query?: string; category?: string };
                const r = await withTimeout(handleGetNews(args.query, args.category, receiptSink), perCallTimeout);
                if (r.txHash) x402Transactions["news"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getTrending") {
                agentsUsed.add("news");
                const r = await withTimeout(handleGetTrending(), perCallTimeout);
                if (r.txHash) x402Transactions["news"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getYields") {
                agentsUsed.add("yield");
                const args = call.args as { chain?: string; type?: string; minApy?: number; maxApy?: number; asset?: string; protocol?: string; page?: number };
                const r = await withTimeout(handleGetYields(args), perCallTimeout);
                if (r.txHash) x402Transactions["yield"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getTokenomics") {
                agentsUsed.add("tokenomics");
                const args = call.args as { symbol: string };
                const r = await withTimeout(handleGetTokenomics(args.symbol), perCallTimeout);
                if (r.txHash) x402Transactions["tokenomics"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getGlobalPerpStats") {
                agentsUsed.add("perp");
                const r = await withTimeout(handleGetGlobalPerpStats(), perCallTimeout);
                if (r.txHash) x402Transactions["perp"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getPerpMarkets") {
                agentsUsed.add("perp");
                const args = call.args as { symbol?: string };
                const r = await withTimeout(handleGetPerpMarkets(args.symbol), perCallTimeout);
                if (r.txHash) x402Transactions["perp"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getStellarStats") {
                agentsUsed.add("stellar-dex");
                const r = await withTimeout(handleGetStellarStats(), perCallTimeout);
                if (r.txHash) x402Transactions["stellar-dex"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getStellarYields") {
                agentsUsed.add("stellar-scout");
                const r = await withTimeout(handleGetStellarYields(), perCallTimeout);
                if (r.txHash) x402Transactions["stellar-scout"] = r.txHash;
                return { name: call.name, raw: r.data };
            }
            if (call.name === "getStellarAccount") {
                agentsUsed.add("stellar-scout");
                const args = call.args as { address: string };
                const r = await withTimeout(handleGetStellarAccount(args.address), perCallTimeout);
                if (r.txHash) x402Transactions["stellar-scout"] = r.txHash;
                return { name: call.name, raw: r.data };
            }

            return { name: call.name, raw: JSON.stringify({ error: `Unknown tool: ${call.name}` }) };
        } catch (e: any) {
            if (String(e?.message || "").includes("timeout_after_")) {
                partial = true;
                return { name: call.name, raw: JSON.stringify({ error: "Tool timeout (partial response)", timeoutMs: perCallTimeout }) };
            }
            console.error(`[Gemini] Tool execution failed for ${call.name}:`, e);
            return { name: call.name, raw: JSON.stringify({ error: `Tool execution failed: ${e?.message || String(e)}` }) };
        }
    }

    try {
        const model = genAI.getGenerativeModel({
            model: config.gemini.model,
            tools: [
                {
                    functionDeclarations: [
                        getPriceDataFunction,
                        searchWebFunction,
                        getProtocolStatsFunction,
                        getBridgesFunction,
                        getHacksFunction,
                        getNewsFunction,
                        getTrendingFunction,
                        getYieldsFunction,
                        getTokenomicsFunction,
                        getGlobalPerpStatsFunction,
                        getPerpMarketsFunction,
                        getStellarStatsFunction,
                        getStellarYieldsFunction,
                        getStellarAccountFunction
                    ],
                },
            ],
            systemInstruction: SYSTEM_PROMPT,
        });

        // Build content parts for the current message
        const currentMessageParts: any[] = [];

        // Add image if provided
        if (imageData) {
            currentMessageParts.push({
                inlineData: {
                    mimeType: imageData.mimeType,
                    data: imageData.base64,
                },
            });
        }

        // Add text prompt (may include retrieved knowledge prefix from RAG)
        if (prompt) {
            currentMessageParts.push({ text: augmentedUserText });
        } else if (imageData) {
            currentMessageParts.push({ text: "Analyze this image and describe what you see. Provide helpful insights." });
        }

        // Initialize chat session
        let chat;
        if (conversationHistory && conversationHistory.length > 0) {
            const history = conversationHistory.map(msg => ({
                role: msg.role,
                parts: [{ text: msg.content }],
            }));
            chat = model.startChat({ history });
        } else {
            chat = model.startChat({ history: [] });
        }

        // Send initial message
        let result = await chat.sendMessage(currentMessageParts);
        let response = result.response;
        let functionCalls = response.functionCalls();

        // Debug logging
        console.log(`[Gemini] Initial response - text: "${response.text()?.slice(0, 100) || 'empty'}", functionCalls: ${functionCalls?.length || 0}`);

        // Loop to handle function calls (limit to 5 turns to prevent infinite loops)
        let turns = 0;
        const lastToolResultsByName: Record<string, any> = {};
        while (functionCalls && functionCalls.length > 0 && turns < 5) {
            turns++;
            // Execute all function calls in this turn in parallel
            const toolResults = await Promise.all(functionCalls.map((c: any) => executeToolCall(c)));
            for (const tr of toolResults) {
                lastToolResultsByName[tr.name] = wrapToolResult(tr.raw);
            }
            const functionResponses = toolResults.map((r) => ({
                functionResponse: {
                    name: r.name,
                    response: { result: wrapToolResult(r.raw) },
                },
            }));

            // Send function responses back to model
            if (functionResponses.length > 0) {
                result = await chat.sendMessage(functionResponses);
                response = result.response;
                functionCalls = response.functionCalls();
            } else {
                break;
            }
        }

        // ─── Agent-to-Agent Sub-Payments ────────────────────────────────────────
        // When multiple specialist agents collaborated, the primary agent pays sub-agents.
        // This demonstrates true autonomous agent commerce: agents earning AND spending on Stellar.
        const usedAgents = Array.from(agentsUsed);
        if (usedAgents.length >= 2) {
            const primaryAgent = usedAgents[0];
            const subAgents = usedAgents.slice(1);
            console.log(`[A2A] 🤝 ${primaryAgent} coordinating with: ${subAgents.join(', ')}`);
            // Fire A2A payments in background — don't block response
            for (const subAgent of subAgents) {
                sendAgentToAgentPayment(primaryAgent, subAgent, `coord:${subAgent}`)
                    .catch(e => console.error(`[A2A] background payment error:`, e));
            }
        }
        // ────────────────────────────────────────────────────────────────────────

        let responseText = "";
        try {
            responseText = response.text();
        } catch (textErr: any) {
            console.error(`[Gemini] ⚠️ Error extracting response text:`, textErr?.message);
            // If the model generated a response but the SDK fails to parse it
            // (e.g. because of safety filters on the last turn)
            if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
                responseText = response.candidates[0].content.parts[0].text;
            }
        }

        const finalText = responseText || "I've processed the market data but am unable to generate a summary at this moment. You can see the raw data in the activity feed below.";

        // If Gemini fails to produce final text, but we have deterministic tool output,
        // generate a high-quality fallback response for the most common demo tool (Price Oracle).
        if (!responseText && lastToolResultsByName.getPriceData && !lastToolResultsByName.getPriceData.error) {
            const d = lastToolResultsByName.getPriceData as any;
            const sym = d.symbol || String((prompt || "").split(/\s+/).pop() || "").toUpperCase();
            const price = d.price != null ? `$${Number(d.price).toLocaleString(undefined, { maximumFractionDigits: 6 })}` : "N/A";
            const change = d.change24h != null ? `${Number(d.change24h).toFixed(2)}%` : "N/A";
            const mcap = d.marketCap != null ? `$${Number(d.marketCap).toLocaleString()}` : "N/A";
            const vol = d.volume24h != null ? `$${Number(d.volume24h).toLocaleString()}` : "N/A";
            const ath = d.ath != null ? `$${Number(d.ath).toLocaleString(undefined, { maximumFractionDigits: 6 })}` : "N/A";
            const athDate = d.athDate ? new Date(d.athDate).toLocaleDateString() : "N/A";

            const txHash = x402Transactions["oracle"];
            const txLine = txHash
                ? `\n\n**On-chain receipt:** \`${txHash}\` (Stellar testnet)`
                : "\n\n**On-chain receipt:** pending (Horizon delay)";

            return {
                response:
                    `The current price of **${d.name || sym} (${(d.symbol || sym).toUpperCase()})** is **${price} ${d.currency || "USD"}**.\n\n` +
                    `- **24h change**: ${change}\n` +
                    `- **Market cap**: ${mcap}\n` +
                    `- **24h volume**: ${vol}\n` +
                    `- **All-time high (ATH)**: ${ath} (reached ${athDate})` +
                    txLine,
                agentsUsed: Array.from(agentsUsed),
                x402Transactions,
                a2aPayments: currentA2APayments,
                partial: false,
                ragSources,
            };
        }

        // News: if the model returned empty text but we have articles, render them directly.
        if (!responseText && lastToolResultsByName.getNews?.articles?.length) {
            const d = lastToolResultsByName.getNews as { articles: Array<{ title: string; source?: string; timeAgo?: string; link?: string }> };
            const lines = d.articles.slice(0, 8).map((a, i) => {
                const src = a.source ? ` — ${a.source}` : "";
                const when = a.timeAgo ? ` (${a.timeAgo})` : "";
                return `${i + 1}. **${a.title}**${src}${when}`;
            });
            return {
                response: `### Latest crypto headlines\n\n${lines.join("\n\n")}`,
                agentsUsed: Array.from(agentsUsed),
                x402Transactions,
                a2aPayments: currentA2APayments,
                partial: false,
                ragSources,
            };
        }

        const trimmed = (responseText || "").trim();
        const substantiveAnswer = trimmed.length >= 180;
        const clientPartial = partial && !substantiveAnswer;
        const responseOut = substantiveAnswer
            ? finalText
            : clientPartial
                ? `${finalText}\n\n**(Partial)** Some tools hit the time limit; try a shorter question or ask again.`
                : finalText;

        return {
            response: responseOut,
            agentsUsed: Array.from(agentsUsed),
            x402Transactions,
            a2aPayments: currentA2APayments,
            partial: clientPartial,
            ragSources,
        };
    } catch (error: any) {
        console.error(`[Gemini] ⚠️ Error generating response:`, error?.message);
        
        if (error?.message?.includes("503") || error?.message?.includes("504")) {
            return {
                response: "Kairos is currently experiencing high demand. Please try again in a few moments! ⚡️",
                agentsUsed: [],
                x402Transactions: {},
                ragSources,
            };
        }
        
        if (error?.message?.includes("429")) {
            return {
                response: "Kairos is receiving too many requests. Please wait about 30 seconds for the quota to reset! ⏳",
                agentsUsed: [],
                x402Transactions: {},
                ragSources,
            };
        }

        throw error;
    }
}

export async function estimateTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
}

export async function calculateCost(
    inputTokens: number,
    outputTokens: number
): Promise<number> {
    const inputCost = (inputTokens / 1_000_000) * 0.5;
    const outputCost = (outputTokens / 1_000_000) * 3.0;
    return inputCost + outputCost;
}

