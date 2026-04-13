/**
 * x402 Agent Routes - Stellar-Native Protected Endpoints
 * 
 * These endpoints are protected by x402 Gateway middleware.
 * All EVM-specific routes (Chain Scout, NFT Scout) have been removed.
 */

import { Router, Request, Response } from 'express';
import { createGatewayMiddleware } from '../services/x402-stellar-gateway.js';
import { fetchPrice, fetchPrices } from '../services/price-oracle.js';
import { searchNews, getBreakingNews, getLatestNews } from '../services/news-scout.js';
import { getTopYields, getYieldsForAsset } from '../services/yield-optimizer.js';
import { analyzeTokenomics } from '../services/tokenomics-service.js';
import { PerpStatsService } from '../services/perp-stats/PerpStatsService.js';
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { horizonServer, networkPassphrase } from "../services/stellar.js";

const perpService = new PerpStatsService();

// Agent addresses (sellers receive payments at these Stellar addresses)
const AGENT_ADDRESSES = {
    priceOracle: process.env.ORACLE_X402_ADDRESS || 'GD3ST27N7QIGIJTFFBMHEHKNTRLGAQNENFG3SCJIACFU2RFZB3GFBKOD',
    newsScout: process.env.NEWS_X402_ADDRESS || 'GC7XSVV54SBKFHE6LZYXK7Q6PYD5PCZ4DBWQQO64HUIDCFLABALGIRFU',
    yieldOptimizer: process.env.YIELD_X402_ADDRESS || 'GBREPHL7BFCVQXIT2EJZ2LGEEXZBGJKA5I34WM224PV3CNLVBAKGJOGH',
    tokenomics: process.env.TOKENOMICS_X402_ADDRESS || 'GAKNTZ5VMLJTWXADZIDNTJYZWITRCA5URY4C5L2ARBRQ4O5S4SRLIMMW',
    perpStats: process.env.PERP_STATS_X402_ADDRESS || 'GA26WFT2JJLPATCW4KNAMFLOGRKS7VA7AQVNB74QISFDCTY2CU4HXUWF',
} as const;

// Create Gateway middleware for each agent
const oracleGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.priceOracle,
});

const newsGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.newsScout,
});

const yieldGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.yieldOptimizer,
});

const tokenomicsGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.tokenomics,
});

const perpGateway = createGatewayMiddleware({
    sellerAddress: AGENT_ADDRESSES.perpStats,
});

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// DEMO HELPERS (FRONTEND) — create payment tx hashes to retry paid endpoints
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_PRICES_XLM: Record<string, string> = {
    "$0.01": "0.0100000",
};

function getSellerByAgentId(agentId: string): string | undefined {
    switch (agentId) {
        case "oracle": return AGENT_ADDRESSES.priceOracle;
        case "news": return AGENT_ADDRESSES.newsScout;
        case "yield": return AGENT_ADDRESSES.yieldOptimizer;
        case "tokenomics": return AGENT_ADDRESSES.tokenomics;
        case "perp": return AGENT_ADDRESSES.perpStats;
        default: return undefined;
    }
}

router.post("/demo/pay", async (req: Request, res: Response) => {
    try {
        const { agentId, price } = req.body as { agentId?: string; price?: "$0.01" };
        if (!agentId) return res.status(400).json({ success: false, error: "agentId required" });

        const seller = getSellerByAgentId(agentId);
        if (!seller) return res.status(400).json({ success: false, error: `Unknown agentId "${agentId}"` });

        const amount = DEMO_PRICES_XLM[price || "$0.01"] || DEMO_PRICES_XLM["$0.01"];
        const secret = config.stellar.sponsorSecret;
        if (!secret || !secret.startsWith("S")) {
            return res.status(500).json({ success: false, error: "STELLAR_SPONSOR_SECRET not configured" });
        }

        const payerKeypair = StellarSdk.Keypair.fromSecret(secret);
        const payerPub = payerKeypair.publicKey();
        const payerAccount = await horizonServer.loadAccount(payerPub);

        const tx = new StellarSdk.TransactionBuilder(payerAccount, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase,
        })
            .addOperation(StellarSdk.Operation.payment({
                destination: seller,
                asset: StellarSdk.Asset.native(),
                amount,
            }))
            .addMemo(StellarSdk.Memo.text(`x402:http:${agentId}`.slice(0, 28)))
            .setTimeout(60)
            .build();

        tx.sign(payerKeypair);
        const result = await horizonServer.submitTransaction(tx);

        res.json({
            success: true,
            txHash: result.hash,
            payer: payerPub,
            seller,
            amount,
            currency: "XLM",
        });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e?.message || "Failed to create demo payment" });
    }
});

// Helper to extract payment info from request
function getPaymentInfo(req: Request) {
    const payment = (req as any).payment;
    return payment ? {
        amount: payment.amount,
        payer: payment.payer,
        transaction: payment.transaction,
    } : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE ORACLE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /oracle/price?symbol=BTC
 * Protected: $0.01 per request
 */
router.get('/oracle/price', oracleGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const symbol = (req.query.symbol as string) || 'BTC';
        const payment = getPaymentInfo(req);

        console.log(`[x402 Oracle] Price for ${symbol}, paid by ${payment?.payer}`);

        const priceData = await fetchPrice(symbol);

        res.json({
            success: true,
            data: priceData,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * POST /oracle/prices
 * Body: { symbols: ["BTC", "ETH", ...] }
 * Protected: $0.01 for batch
 */
router.post('/oracle/prices', oracleGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const { symbols } = req.body as { symbols: string[] };
        const payment = getPaymentInfo(req);

        console.log(`[x402 Oracle] Batch: ${symbols?.join(', ')}, paid by ${payment?.payer}`);

        const prices = await fetchPrices(symbols || ['BTC', 'ETH']);

        res.json({
            success: true,
            data: prices,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// NEWS SCOUT ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /news/search?query=bitcoin
 * Protected: $0.01 per request
 */
router.get('/news/search', newsGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const query = req.query.query as string;
        const payment = getPaymentInfo(req);

        if (!query) {
            return res.status(400).json({ success: false, error: 'Query required' });
        }

        console.log(`[x402 News] Search "${query}", paid by ${payment?.payer}`);

        const news = await searchNews(query);

        res.json({
            success: true,
            data: news,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /news/latest
 * Protected: $0.01 per request
 */
router.get('/news/latest', newsGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;
        const payment = getPaymentInfo(req);

        console.log(`[x402 News] Latest news, paid by ${payment?.payer}`);

        const news = await getLatestNews(limit);

        res.json({
            success: true,
            data: news,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /news/breaking
 * Protected: $0.01 per request
 */
router.get('/news/breaking', newsGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const payment = getPaymentInfo(req);

        console.log(`[x402 News] Breaking news, paid by ${payment?.payer}`);

        const news = await getBreakingNews();

        res.json({
            success: true,
            data: news,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// YIELD OPTIMIZER ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /yield/top?minApy=5&chain=ethereum
 * Protected: $0.01 per request
 */
router.get('/yield/top', yieldGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const chain = req.query.chain as string;
        const minApy = parseFloat(req.query.minApy as string) || 0;
        const limit = parseInt(req.query.limit as string) || 20;
        const payment = getPaymentInfo(req);

        console.log(`[x402 Yield] Top yields, paid by ${payment?.payer}`);

        const yields = await getTopYields({ chain, minApy, limit });

        res.json({
            success: true,
            data: yields,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /yield/asset?token=ETH
 * Protected: $0.01 per request
 */
router.get('/yield/asset', yieldGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const token = req.query.token as string;
        const payment = getPaymentInfo(req);

        if (!token) {
            return res.status(400).json({ success: false, error: 'Token required' });
        }

        console.log(`[x402 Yield] Yields for ${token}, paid by ${payment?.payer}`);

        const yields = await getYieldsForAsset(token);

        res.json({
            success: true,
            data: yields,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOKENOMICS ANALYZER ENDPOINTS - $0.01 per query
// ─────────────────────────────────────────────────────────────────────────────

router.get('/tokenomics/analyze', tokenomicsGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const symbol = req.query.symbol as string || 'ARB';
        const payment = getPaymentInfo(req);

        console.log(`[x402 Tokenomics] Analyzing ${symbol}, paid by ${payment?.payer}`);

        const analysis = await analyzeTokenomics(symbol);

        if (!analysis) {
            return res.status(404).json({
                success: false,
                error: `Token not found: ${symbol}. Supported: ARB, OP, SUI, APT, ETH, etc.`,
            });
        }

        res.json({
            success: true,
            data: analysis,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PERP STATS AGENT ENDPOINTS - Aggregated "Alpha" Data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /perp/markets
 * Protected: $0.01 per request
 */
router.get('/perp/markets', perpGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const payment = getPaymentInfo(req);
        console.log(`[x402 Perp] Market Data, paid by ${payment?.payer}`);

        const markets = await perpService.getMarkets();

        res.json({
            success: true,
            data: markets,
            meta: {
                count: markets.length,
                sources: [...new Set(markets.map(m => m.exchange))]
            },
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

/**
 * GET /perp/global
 * Protected: $0.01 per request
 */
router.get('/perp/global', perpGateway.require('$0.01') as any, async (req: Request, res: Response) => {
    try {
        const payment = getPaymentInfo(req);
        console.log(`[x402 Perp] Global Stats, paid by ${payment?.payer}`);

        const stats = await perpService.getGlobalStats();

        res.json({
            success: true,
            data: stats,
            payment,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK (FREE)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        network: 'stellar-testnet',
        agents: {
            oracle: AGENT_ADDRESSES.priceOracle,
            news: AGENT_ADDRESSES.newsScout,
            yield: AGENT_ADDRESSES.yieldOptimizer,
            tokenomics: AGENT_ADDRESSES.tokenomics,
            perp: AGENT_ADDRESSES.perpStats,
        },
        endpoints: {
            oracle: ['GET /oracle/price', 'POST /oracle/prices'],
            news: ['GET /news/search', 'GET /news/latest', 'GET /news/breaking'],
            yield: ['GET /yield/top', 'GET /yield/asset'],
            tokenomics: ['GET /tokenomics/analyze'],
            perp: ['GET /perp/markets', 'GET /perp/global'],
        },
    });
});

export default router;
