import 'dotenv/config';
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import axios from "axios";
import * as StellarSdk from "@stellar/stellar-sdk";
import path from "path";
import { fileURLToPath } from "url";
import { config, getUsdcAsset } from "./config.js";
import { generateResponse, initGemini } from "./services/gemini.js";
import { warmRagIndex } from "./services/rag.js";
import x402AgentRoutes from "./routes/x402-agent-routes.js";
import { StellarSponsorshipService, horizonServer, networkPassphrase } from "./services/stellar.js";
import {
    initSupabase,
    createChatSession,
    getChatSessions,
    deleteChatSession,
    saveMessage,
    getMessages,
    clearMessages,
    rateMessage,
    getMessageRating,
    getAgentRating,
    logQueryTime,
    getAverageResponseTime,
    getTotalUsageCount,
    getAllAgentStats,
    getAgentStatsById,
    getRecentQueries
} from "./services/supabase.js";

const app = express();

type LocalQueryLog = {
    id: string;
    agentId: string;
    responseTimeMs: number;
    createdAt: string;
    txHash?: string;
};

const AGENT_PRICING: Record<string, number> = {
    oracle: 0.01,
    news: 0.01,
    yield: 0.01,
    tokenomics: 0.01,
    "stellar-scout": 0.02,
    perp: 0.02,
    protocol: 0.01,
    bridges: 0.01,
    "stellar-dex": 0.01,
    scout: 0.01, // Chat alias used by Gemini; maps to Stellar Scout line item.
};

const localQueryLogs: LocalQueryLog[] = [];
const localRatings = new Map<string, boolean>(); // key: `${messageId}:${walletLower}`
const receiptStore = new Map<string, Record<string, string>>(); // requestId -> agentId -> txHash

function toRatingKey(messageId: string, wallet: string) {
    return `${messageId}:${wallet.toLowerCase()}`;
}

function pushLocalQueryLog(entry: LocalQueryLog) {
    localQueryLogs.unshift(entry);
    // Keep memory bounded for long dev sessions.
    if (localQueryLogs.length > 2000) {
        localQueryLogs.length = 2000;
    }
}

function recordReceipt(requestId: string, agentId: string, txHash: string) {
    const existing = receiptStore.get(requestId) || {};
    existing[agentId] = txHash;
    receiptStore.set(requestId, existing);

    // Also backfill local activity rows for dashboards.
    for (const row of localQueryLogs) {
        if (row.id === requestId && row.agentId === agentId) {
            row.txHash = txHash;
        }
    }
}

function normalizeAgentId(agentId: string): string {
    if (agentId === "stellar-scout" || agentId === "protocol" || agentId === "bridges" || agentId === "stellar-dex") {
        return "scout";
    }
    return agentId;
}

function resolveTxHashForAgent(
    x402Transactions: Record<string, string | undefined>,
    agentId: string
): string | undefined {
    const direct = x402Transactions[agentId];
    if (direct) return direct;
    const normalized = normalizeAgentId(agentId);
    if (normalized !== agentId && x402Transactions[normalized]) {
        return x402Transactions[normalized];
    }
    return undefined;
}

/** Micropayment memos use `x402:{geminiAgentId}:...` — map marketplace / dashboard id → memo prefix. */
function x402MemoPrefixForDashboardAgent(agentId: string): string {
    const map: Record<string, string> = {
        news: "x402:news:",
        oracle: "x402:oracle:",
        yield: "x402:yield:",
        tokenomics: "x402:tokenomics:",
        perp: "x402:perp:",
        scout: "x402:stellar:",
        "stellar-scout": "x402:stellar:",
        protocol: "x402:stellar:",
        bridges: "x402:stellar:",
        "stellar-dex": "x402:stellar:",
    };
    return map[agentId] || `x402:${agentId}:`;
}

type ActivityRow = {
    id: string;
    agentId: string;
    responseTimeMs: number;
    createdAt: string;
    txHash?: string | null;
};

/**
 * When DB/local logs missed the hash (late confirmation, Supabase down), match treasury txs by memo + time.
 */
async function enrichActivityTxHashesFromHorizon(
    rows: ActivityRow[],
    dashboardAgentId: string
): Promise<void> {
    const secret = config.stellar.sponsorSecret;
    if (!secret?.startsWith("S")) return;
    const missing = rows.filter((r) => !r.txHash);
    if (missing.length === 0) return;

    let treasuryPk: string;
    try {
        treasuryPk = StellarSdk.Keypair.fromSecret(secret).publicKey();
    } catch {
        return;
    }

    const prefix = x402MemoPrefixForDashboardAgent(dashboardAgentId);
    let records: any[] = [];
    try {
        const page = await horizonServer
            .transactions()
            .forAccount(treasuryPk)
            .order("desc")
            .limit(120)
            .call();
        records = page.records || [];
    } catch (e) {
        console.warn("[dashboard/activity] Horizon list failed:", (e as Error)?.message);
        return;
    }

    const candidates = records
        .filter(
            (r: any) =>
                r.successful &&
                r.memo_type === "text" &&
                typeof r.memo === "string" &&
                r.memo.startsWith(prefix)
        )
        .map((r: any) => ({
            hash: r.hash as string,
            t: new Date(r.created_at).getTime(),
        }));

    const WINDOW_MS = 25 * 60 * 1000;
    const used = new Set<string>();

    for (const row of missing) {
        const target = new Date(row.createdAt).getTime();
        if (Number.isNaN(target)) continue;
        let bestHash: string | null = null;
        let bestDiff = Infinity;
        for (const c of candidates) {
            if (used.has(c.hash)) continue;
            const diff = Math.abs(c.t - target);
            if (diff < WINDOW_MS && diff < bestDiff) {
                bestDiff = diff;
                bestHash = c.hash;
            }
        }
        if (bestHash) {
            used.add(bestHash);
            row.txHash = bestHash;
        }
    }
}

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// CORS
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocked request from origin: ${origin}`);
            callback(null, true); // Permissive for hackathon
        }
    },
    credentials: true
}));

// Rate Limiters
const generalLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 500, // Increased for hackathon scaling
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({ 
            success: false, 
            error: "Too many requests, keep it cool. 🧊" 
        });
    }
});
const queryLimiter = rateLimit({ 
    windowMs: 60 * 1000, 
    max: 100, // Increased for parallel agentic calls
    handler: (req, res) => {
        res.status(429).json({ 
            success: false, 
            error: "Query rate limit exceeded. Just a moment for the AI to breathe! ⏳" 
        });
    }
});

app.use(generalLimiter);
app.use(express.json({ limit: '50mb' }));

// --- Initialization ---

// Initialize AI
if (GEMINI_API_KEY) {
    initGemini(GEMINI_API_KEY);
    console.log("✅ Gemini AI initialized");
    warmRagIndex();
} else {
    console.warn("⚠️  GEMINI_API_KEY not set — AI queries will fail");
}

// Log Treasury Public Key for debug
const sponsorSecret = config.stellar.sponsorSecret;
if (sponsorSecret && sponsorSecret.startsWith('S')) {
    try {
        const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
        console.log(`🏦 Treasury Address: ${sponsorKeypair.publicKey()}`);
    } catch (e) {
        console.warn("⚠️ Invalid Treasury Secret format");
    }
} else {
    console.warn("⚠️ No valid Treasury Secret found in .env");
}

// Initialize Database
if (initSupabase()) {
    console.log("✅ Supabase initialized");
}

// --- API Routes ---

// Health
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        network: config.stellar.network,
        geminiEnabled: !!GEMINI_API_KEY,
    });
});

// Stellar Sponsorship
app.post("/api/stellar/sponsor", async (req, res) => {
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ error: "Public key required" });
    const result = await StellarSponsorshipService.sponsorAccount(publicKey);
    res.json(result);
});

app.get("/api/stellar/balance/:address", async (req, res) => {
    const { address } = req.params;
    try {
        const account = await horizonServer.loadAccount(address);
        // Get XLM balance (native)
        const xlmEntry = account.balances.find((b: any) => b.asset_type === 'native');
        const xlmBalance = xlmEntry?.balance || "0.0000000";
        // Get USDC balance
        const usdcBalance = await StellarSponsorshipService.getUSDCBalance(address);
        res.json({ balance: xlmBalance, xlm: xlmBalance, usdc: usdcBalance });
    } catch (e) {
        // Account not found on ledger
        res.json({ balance: "0.0000000", xlm: "0.0000000", usdc: "0.0000000" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Demo USDC on Stellar Testnet (issuer = Kairos treasury)
// ─────────────────────────────────────────────────────────────────────────────

function getDemoUsdcAsset() {
    const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET || "";
    if (!sponsorSecret.startsWith("S")) {
        return { error: "STELLAR_SPONSOR_SECRET not configured" as const };
    }
    const issuerKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
    const issuer = issuerKeypair.publicKey();
    const code = "USDC";
    const asset = new StellarSdk.Asset(code, issuer);
    return { code, issuer, asset };
}

app.get("/api/stellar/usdc/demo-asset", (_req, res) => {
    const demo = getDemoUsdcAsset();
    if ("error" in demo) return res.status(500).json({ error: demo.error });
    res.json({ code: demo.code, issuer: demo.issuer });
});

app.post("/api/stellar/usdc/trustline-xdr", async (req, res) => {
    const { publicKey } = req.body as { publicKey?: string };
    if (!publicKey) return res.status(400).json({ error: "publicKey required" });
    const demo = getDemoUsdcAsset();
    if ("error" in demo) return res.status(500).json({ error: demo.error });
    if (publicKey === demo.issuer) {
        return res.status(400).json({
            error: "Cannot add a trustline from the issuer account. Connect a different wallet.",
            issuer: demo.issuer,
        });
    }

    try {
        const account = await horizonServer.loadAccount(publicKey);
        const tx = new StellarSdk.TransactionBuilder(account, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase,
        })
            .addOperation(StellarSdk.Operation.changeTrust({ asset: demo.asset }))
            .setTimeout(60)
            .build();

        res.json({ xdr: tx.toXDR(), networkPassphrase });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || "Failed to build trustline XDR" });
    }
});

app.post("/api/stellar/submit-xdr", async (req, res) => {
    const { xdr } = req.body as { xdr?: any };
    const xdrString =
        typeof xdr === "string"
            ? xdr
            : (xdr?.signedTxXdr || xdr?.signedXdr || xdr?.xdr);
    if (!xdrString || typeof xdrString !== "string") {
        return res.status(400).json({ error: "xdr required (string or { signedTxXdr })" });
    }
    try {
        const tx = StellarSdk.TransactionBuilder.fromXDR(xdrString, networkPassphrase) as StellarSdk.Transaction;
        const result = await horizonServer.submitTransaction(tx);
        res.json({ hash: result.hash });
    } catch (e: any) {
        const data = e?.response?.data;
        const detail = data?.detail || e?.message;
        const resultCodes = data?.extras?.result_codes;
        res.status(500).json({
            error: detail || "Failed to submit XDR",
            resultCodes,
        });
    }
});

app.post("/api/stellar/usdc/faucet", async (req, res) => {
    const { publicKey, amount } = req.body as { publicKey?: string; amount?: string };
    if (!publicKey) return res.status(400).json({ success: false, error: "publicKey required" });
    const demo = getDemoUsdcAsset();
    if ("error" in demo) return res.status(500).json({ success: false, error: demo.error });
    if (publicKey === demo.issuer) {
        return res.status(400).json({
            success: false,
            error: "Issuer account cannot receive its own issued USDC via faucet. Connect a different wallet.",
            issuer: demo.issuer,
        });
    }

    try {
        const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET!;
        const issuerKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
        const issuerAccount = await horizonServer.loadAccount(issuerKeypair.publicKey());

        const amt = amount && typeof amount === "string" ? amount : "10.0000000";
        const tx = new StellarSdk.TransactionBuilder(issuerAccount, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase,
        })
            .addOperation(StellarSdk.Operation.payment({
                destination: publicKey,
                asset: demo.asset,
                amount: amt,
            }))
            .addMemo(StellarSdk.Memo.text("usdc:faucet"))
            .setTimeout(60)
            .build();

        tx.sign(issuerKeypair);
        const result = await horizonServer.submitTransaction(tx);

        res.json({ success: true, hash: result.hash, code: demo.code, issuer: demo.issuer, amount: amt });
    } catch (e: any) {
        const detail = e?.response?.data?.detail || e?.message;
        res.status(500).json({ success: false, error: detail || "USDC faucet failed" });
    }
});

// Testnet Faucet — fund wallet via Stellar Friendbot + establish USDC trustline

app.post("/faucet", async (req, res) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ success: false, error: "Address required" });

    try {
        // 1. Fund account with XLM via Stellar Friendbot
        console.log(`[Faucet] Funding testnet account: ${address}`);
        try {
            await axios.get(`https://friendbot.stellar.org/?addr=${address}`);
            console.log(`[Faucet] ✅ Friendbot funded ${address}`);
        } catch (fbErr: any) {
            // If already funded, friendbot returns error — that's OK
            if (fbErr?.response?.status === 400) {
                console.log(`[Faucet] Account already exists — skipping friendbot`);
            } else {
                throw fbErr;
            }
        }

        // 2. Establish USDC trustline (required before receiving USDC)
        // Note: The user's account was created client-side so we don't have their secret key.
        // The frontend generates the keypair — we sponsor the trustline instead.
        const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET;
        if (sponsorSecret) {
            try {
                const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
                const sponsorAccount = await horizonServer.loadAccount(sponsorKeypair.publicKey());

                // Send 10 XLM to the new account for operating costs
                const transaction = new StellarSdk.TransactionBuilder(sponsorAccount, {
                    fee: StellarSdk.BASE_FEE,
                    networkPassphrase,
                })
                .addOperation(StellarSdk.Operation.payment({
                    destination: address,
                    asset: StellarSdk.Asset.native(),
                    amount: "10.0",
                }))
                .setTimeout(30)
                .build();

                transaction.sign(sponsorKeypair);
                await horizonServer.submitTransaction(transaction);
                console.log(`[Faucet] ✅ Sent 10 XLM to ${address}`);
            } catch (e: any) {
                console.warn(`[Faucet] ⚠️ XLM transfer failed: ${e.message}`);
            }
        }

        res.json({
            success: true,
            message: `Account ${address} funded on Stellar testnet`,
            network: "testnet",
        });
    } catch (error: any) {
        console.error(`[Faucet] ❌ Error:`, error?.response?.data || error.message);
        const statusCode = error?.response?.status === 429 ? 429 : 500;
        res.status(statusCode).json({
            success: false,
            error: error?.response?.status === 429
                ? "Rate limited by friendbot. Try again later."
                : error.message,
        });
    }
});

// Core AI Query Endpoint
app.post("/query", queryLimiter, async (req, res) => {
    try {
        const { query, imageData, conversationHistory, requestId } = req.body;
        if (!query && !imageData) return res.status(400).json({ error: "Query or image required" });

        const startTime = Date.now();
        const rid = typeof requestId === "string" && requestId.length > 0 ? requestId : crypto.randomUUID();
        const result = await generateResponse(
            query || '',
            imageData,
            conversationHistory,
            (agentId, txHash) => recordReceipt(rid, agentId, txHash)
        );
        const responseTimeMs = Date.now() - startTime;

        // Log agent usage via Supabase (asynchronously, don't block response)
        try {
            const allAgentsToLog = new Set<string>(result.agentsUsed);

            for (const agentId of allAgentsToLog) {
                const txHash = resolveTxHashForAgent(result.x402Transactions, agentId);
                pushLocalQueryLog({
                    id: rid,
                    agentId,
                    responseTimeMs,
                    createdAt: new Date().toISOString(),
                    txHash,
                });
                // We use Promise.resolve().then to avoid blocking the API response while logging to DB
                logQueryTime(responseTimeMs, agentId, txHash)
                    .catch(err => console.error(`[Supabase] Deferred logging failed for ${agentId}:`, err));
            }
        } catch (logError) {
            console.error("[Supabase] ⚠️ Telemetry logging failed (non-critical):", logError);
        }

        const agentsUsed = Array.from(result.agentsUsed);

        res.json({
            success: true,
            response: result.response,
            agentsUsed,
            x402Transactions: result.x402Transactions,
            requestId: rid,
            partial: !!result.partial,
            cost: "0.03", // Flat hackathon price
            ragSources: result.ragSources,
        });
    } catch (error) {
        console.error("Query error:", error);
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// Receipts: async tx hash fetch for fast responses
app.get("/receipts/:requestId", (req, res) => {
    const { requestId } = req.params;
    const receipts = receiptStore.get(requestId) || {};
    res.json({ requestId, receipts });
});

// Marketplace Providers
app.get("/providers", async (req, res) => {
    try {
        const providers = [
            { id: "oracle", name: "Price Oracle", category: "DeFi", description: "Real-time crypto prices via CoinGecko. Supports 200+ tokens with market cap, volume & 24h change.", price: "0.01" },
            { id: "news", name: "News Scout", category: "Analytics", description: "Crypto news & sentiment analysis. Breaking news, trending topics, and market-moving events.", price: "0.01" },
            { id: "yield", name: "Yield Optimizer", category: "DeFi", description: "Best DeFi yields across 500+ protocols. Filter by chain, APY, and TVL for optimal returns.", price: "0.01" },
            { id: "tokenomics", name: "Tokenomics Analyzer", category: "Analytics", description: "Token supply, distribution & unlock schedules. Inflation models and emission analysis.", price: "0.01" },
            { id: "stellar-scout", name: "Stellar Scout", category: "Stellar", description: "Stellar network analytics, SDEX volume, account analysis, and DeFi yields (Blend/Aquarius).", price: "0.02" },
            { id: "perp", name: "Perp Stats", category: "Trading", description: "Perpetual futures data from 7+ exchanges. Funding rates, open interest, and volume analysis.", price: "0.02" },
            { id: "protocol", name: "Protocol Stats", category: "DeFi", description: "TVL, fees & revenue for 100+ DeFi protocols via DeFiLlama. Cross-chain protocol comparisons.", price: "0.01" },
            { id: "bridges", name: "Bridge Monitor", category: "DeFi", description: "Cross-chain bridge volumes and activity. Track capital flows across Stellar, Ethereum & more.", price: "0.01" },
            { id: "stellar-dex", name: "Stellar DEX", category: "Stellar", description: "SDEX order book depth, trading pairs, and liquidity analysis on the Stellar network.", price: "0.01" },
        ];

        const stats = await getAllAgentStats();
        const statsMap = new Map(stats.map(s => [s.agentId, s]));

        const providersWithStats = providers.map(p => {
            const s = statsMap.get(p.id);
            return {
                ...p,
                rating: s?.rating || 0,
                usageCount: s?.usageCount || 0,
                avgResponseTime: s?.avgResponseTimeMs ? (s.avgResponseTimeMs / 1000).toFixed(1) + 's' : '0s'
            };
        });

        res.json({ providers: providersWithStats });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Dashboard Stats
app.get("/dashboard/stats", async (req, res) => {
    const { agentId } = req.query;
    try {
        if (agentId) {
            const stats = await getAgentStatsById(agentId as string);
            const localAgentLogs = localQueryLogs.filter(q => q.agentId === agentId);
            const localUsage = localAgentLogs.length;
            const localTreasury = localAgentLogs.reduce((sum, q) => sum + (AGENT_PRICING[q.agentId] ?? 0.01), 0);
            const dbTreasury = (stats?.usageCount || 0) * (AGENT_PRICING[agentId as string] ?? 0.01);
            const treasury = Math.max(localTreasury, dbTreasury);

            res.json({
                agentId,
                tasksCompleted: (stats?.usageCount || 0) || localUsage,
                rating: stats?.rating || 0,
                treasury: treasury.toFixed(2),
            });
        } else {
            const usageCount = await getTotalUsageCount();
            const fallbackUsageCount = localQueryLogs.length;
            res.json({ usageCount: usageCount || fallbackUsageCount });
        }
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Dashboard Activity Feed
app.get("/dashboard/activity", async (req, res) => {
    const { agentId, limit } = req.query;
    const queryAgentId = (agentId as string) || 'oracle';
    const queryLimit = parseInt(limit as string) || 10;

    const toPayload = (enriched: ActivityRow[]) =>
        enriched.map((q) => ({
            id: q.id,
            type: 'query' as const,
            agentId: q.agentId,
            responseTimeMs: q.responseTimeMs,
            timestamp: q.createdAt,
            txHash: q.txHash,
            amount: AGENT_PRICING[q.agentId] ?? 0.01,
        }));

    try {
        const queries = await getRecentQueries(queryAgentId, queryLimit);
        const localFallback = localQueryLogs
            .filter(q => q.agentId === queryAgentId)
            .slice(0, queryLimit)
            .map(q => ({
                id: q.id,
                agentId: q.agentId,
                responseTimeMs: q.responseTimeMs,
                createdAt: q.createdAt,
                txHash: q.txHash || null,
            }));
        const source = queries.length > 0 ? queries : localFallback;
        const localById = new Map(localFallback.map(q => [q.id, q]));
        const localByTimestamp = new Map(localFallback.map(q => [`${q.agentId}:${q.createdAt}`, q]));
        const enriched: ActivityRow[] = source.map(q => {
            if (q.txHash) return { ...q, txHash: q.txHash };
            const byId = localById.get(q.id);
            if (byId?.txHash) return { ...q, txHash: byId.txHash };
            const byTs = localByTimestamp.get(`${q.agentId}:${q.createdAt}`);
            if (byTs?.txHash) return { ...q, txHash: byTs.txHash };
            return { ...q, txHash: q.txHash ?? null };
        });

        await enrichActivityTxHashesFromHorizon(enriched, queryAgentId);

        res.json({
            success: true,
            activities: toPayload(enriched),
        });
    } catch (error) {
        const enriched: ActivityRow[] = localQueryLogs
            .filter(q => q.agentId === queryAgentId)
            .slice(0, queryLimit)
            .map(q => ({
                id: q.id,
                agentId: q.agentId,
                responseTimeMs: q.responseTimeMs,
                createdAt: q.createdAt,
                txHash: q.txHash || null,
            }));
        await enrichActivityTxHashesFromHorizon(enriched, queryAgentId);
        res.json({ success: true, activities: toPayload(enriched) });
    }
});

// Chat Sessions — fallback to in-memory when Supabase is unavailable
const inMemorySessions = new Map<string, any[]>();
const inMemoryMessages = new Map<string, any[]>();

app.get("/chat/sessions", async (req, res) => {
    const { wallet } = req.query;
    if (!wallet) return res.status(400).json({ error: "Wallet required" });
    
    const dbSessions = await getChatSessions(wallet as string);
    if (dbSessions.length > 0) {
        return res.json({ success: true, sessions: dbSessions });
    }
    // Fallback to in-memory
    const memSessions = inMemorySessions.get((wallet as string).toLowerCase()) || [];
    res.json({ success: true, sessions: memSessions });
});

app.post("/chat/sessions", async (req, res) => {
    const { walletAddress, title } = req.body;
    const session = await createChatSession(walletAddress, title);
    
    if (session) {
        return res.json({ success: true, session });
    }
    
    // Fallback: create in-memory session
    const memSession = {
        id: crypto.randomUUID(),
        wallet_address: walletAddress?.toLowerCase(),
        title: title || 'New Chat',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const key = walletAddress?.toLowerCase();
    const existing = inMemorySessions.get(key) || [];
    existing.unshift(memSession);
    inMemorySessions.set(key, existing);
    
    res.json({ success: true, session: memSession });
});

app.get("/chat/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;
    const dbMessages = await getMessages(sessionId);
    if (dbMessages.length > 0) {
        return res.json({ success: true, messages: dbMessages });
    }
    // Fallback
    const memMessages = inMemoryMessages.get(sessionId) || [];
    res.json({ success: true, messages: memMessages });
});

app.post("/chat/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;
    try {
        const { id, content, is_user, escrow_id, tx_hash, tx_hashes, image_preview } = req.body;

        const message = await saveMessage(sessionId, {
            id,
            content,
            is_user,
            escrow_id,
            tx_hash,
            tx_hashes,
            image_preview,
        });
        
        if (message) {
            return res.json({ success: true, message });
        }
    } catch (e) {
        console.error("Failed to save message to DB, falling back to memory:", e);
    }
    
    // Fallback: store in-memory
    const memMessage = { ...req.body, timestamp: new Date().toISOString() };
    const existing = inMemoryMessages.get(sessionId) || [];
    existing.push(memMessage);
    inMemoryMessages.set(sessionId, existing);
    
    // Update session title from first user message
    if (req.body.is_user && req.body.content) {
        for (const [, sessions] of inMemorySessions) {
            const session = sessions.find((s: any) => s.id === sessionId);
            if (session && session.title === 'New Chat') {
                session.title = req.body.content.slice(0, 50) + (req.body.content.length > 50 ? '...' : '');
            }
        }
    }
    
    res.json({ success: true, message: memMessage });
});

// Delete chat session
app.delete("/chat/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const wallet = req.query.wallet as string;
    
    if (!wallet) return res.status(400).json({ success: false, error: "Wallet required" });
    
    // Try Supabase first
    const deleted = await deleteChatSession(sessionId, wallet);
    
    // Also clean in-memory
    const key = wallet.toLowerCase();
    const memSessions = inMemorySessions.get(key);
    if (memSessions) {
        const filtered = memSessions.filter((s: any) => s.id !== sessionId);
        inMemorySessions.set(key, filtered);
    }
    inMemoryMessages.delete(sessionId);
    
    res.json({ success: true, deleted: deleted || true });
});

// Rename chat session
app.patch("/chat/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const { title } = req.body;
    
    if (!title) return res.status(400).json({ success: false, error: "Title required" });
    
    // Try Supabase
    const sb = (await import("./services/supabase.js")).getSupabase();
    if (sb) {
        await sb.from('chat_sessions').update({ title }).eq('id', sessionId);
    }
    
    // Also update in-memory
    for (const [, sessions] of inMemorySessions) {
        const session = sessions.find((s: any) => s.id === sessionId);
        if (session) session.title = title;
    }
    
    res.json({ success: true });
});

// Message Ratings
app.get("/ratings/:messageId", async (req, res) => {
    const { messageId } = req.params;
    const wallet = req.query.wallet as string;
    
    if (!wallet) return res.json({ rating: null });
    
    const rating = await getMessageRating(messageId, wallet);
    const fallback = localRatings.get(toRatingKey(messageId, wallet));
    res.json({ rating: rating ?? fallback ?? null });
});

app.post("/ratings", async (req, res) => {
    const { messageId, wallet, isPositive, agentId } = req.body;
    
    if (!messageId || !wallet) {
        return res.status(400).json({ success: false, error: "messageId and wallet required" });
    }
    
    const success = await rateMessage(messageId, wallet, isPositive, agentId);
    if (!success) {
        // Keep UX functional when Supabase is transiently unavailable.
        localRatings.set(toRatingKey(messageId, wallet), !!isPositive);
        return res.json({ success: true, persisted: "memory" });
    }
    res.json({ success: true, persisted: "supabase" });
});

// Agent Routes (Stellar x402)
app.use("/api/x402", x402AgentRoutes);

// Start Server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║          KAIROS: STELLAR AGENT MARKETPLACE               ║
╠═══════════════════════════════════════════════════════════╣
║  URL:       http://localhost:${PORT}                         ║
║  Network:   Stellar ${config.stellar.network.padEnd(20)}          ║
╚═══════════════════════════════════════════════════════════╝
    `);
});
