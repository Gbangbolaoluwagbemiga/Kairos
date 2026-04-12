/**
 * x402-auto-refill.ts
 * Monitors all 9 agent USDC balances on Stellar testnet.
 * Automatically tops up any agent that drops below the threshold.
 *
 * Run once:  npx tsx scripts/x402-auto-refill.ts
 * As daemon: DAEMON=true npx tsx scripts/x402-auto-refill.ts
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const server = new StellarSdk.Horizon.Server(HORIZON_URL);

const TREASURY_SECRET = process.env.STELLAR_SPONSOR_SECRET!;
const USDC_ISSUER = process.env.USDC_ISSUER_ADDRESS!;
const USDC_CODE = "USDC";

// Refill config
const LOW_BALANCE_THRESHOLD = 10;   // USDC — trigger refill below this
const REFILL_TARGET = 100;          // USDC — top up to this level
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const AGENTS = [
    { name: "Price Oracle",    address: process.env.ORACLE_X402_ADDRESS! },
    { name: "News Scout",      address: process.env.NEWS_X402_ADDRESS! },
    { name: "Yield Optimizer", address: process.env.YIELD_X402_ADDRESS! },
    { name: "Tokenomics",      address: process.env.TOKENOMICS_X402_ADDRESS! },
    { name: "Perp Stats",      address: process.env.PERP_STATS_X402_ADDRESS! },
    { name: "Stellar Scout",   address: process.env.STELLAR_SCOUT_X402_ADDRESS! },
    { name: "Protocol Stats",  address: process.env.PROTOCOL_X402_ADDRESS! },
    { name: "Bridge Monitor",  address: process.env.BRIDGES_X402_ADDRESS! },
    { name: "Stellar DEX",     address: process.env.STELLAR_DEX_X402_ADDRESS! },
];

async function getUsdcBalance(address: string): Promise<number> {
    try {
        const account = await server.loadAccount(address);
        const b = account.balances.find(
            (b: any) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER
        );
        return parseFloat((b as any)?.balance || "0");
    } catch {
        return -1;
    }
}

async function refillAgent(
    treasuryKeypair: StellarSdk.Keypair,
    usdcAsset: StellarSdk.Asset,
    agent: { name: string; address: string },
    currentBalance: number
): Promise<string | null> {
    const topUp = (REFILL_TARGET - currentBalance).toFixed(7);
    try {
        const treasuryAccount = await server.loadAccount(treasuryKeypair.publicKey());
        const tx = new StellarSdk.TransactionBuilder(treasuryAccount, {
            fee: "1000",
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                StellarSdk.Operation.payment({
                    destination: agent.address,
                    asset: usdcAsset,
                    amount: topUp,
                })
            )
            .addMemo(StellarSdk.Memo.text(`refill:${agent.name.slice(0, 13)}`))
            .setTimeout(60)
            .build();

        tx.sign(treasuryKeypair);
        const result = await server.submitTransaction(tx);
        return (result as any).hash;
    } catch (err: any) {
        console.error(
            `  ❌ Refill failed for ${agent.name}:`,
            err?.response?.data?.extras?.result_codes || err.message
        );
        return null;
    }
}

async function checkAndRefill(): Promise<{ refilled: number; ok: number; missing: number }> {
    if (!TREASURY_SECRET?.startsWith("S")) throw new Error("STELLAR_SPONSOR_SECRET missing");
    if (!USDC_ISSUER) throw new Error("USDC_ISSUER_ADDRESS missing");

    const treasuryKeypair = StellarSdk.Keypair.fromSecret(TREASURY_SECRET);
    const usdcAsset = new StellarSdk.Asset(USDC_CODE, USDC_ISSUER);

    console.log(`\n[Auto-Refill] 🔄 Checking ${AGENTS.length} agents — ${new Date().toISOString()}`);
    console.log(`[Auto-Refill]    Threshold: <${LOW_BALANCE_THRESHOLD} USDC → top up to ${REFILL_TARGET} USDC\n`);

    let refilled = 0;
    let ok = 0;
    let missing = 0;

    for (const agent of AGENTS) {
        if (!agent.address) {
            console.log(`[Auto-Refill] ⚠️  ${agent.name}: no address`);
            missing++;
            continue;
        }

        const balance = await getUsdcBalance(agent.address);

        if (balance === -1) {
            console.log(`[Auto-Refill] ❌ ${agent.name}: account not found`);
            missing++;
            continue;
        }

        if (balance >= LOW_BALANCE_THRESHOLD) {
            console.log(`[Auto-Refill] ✅ ${agent.name}: ${balance.toFixed(4)} USDC — OK`);
            ok++;
            continue;
        }

        console.log(`[Auto-Refill] ⚠️  ${agent.name}: ${balance.toFixed(4)} USDC — REFILLING...`);
        const txHash = await refillAgent(treasuryKeypair, usdcAsset, agent, balance);

        if (txHash) {
            const newBalance = balance + (REFILL_TARGET - balance);
            console.log(`[Auto-Refill] ✅ ${agent.name}: refilled to ~${REFILL_TARGET} USDC (tx: ${txHash.slice(0, 16)}...)`);
            refilled++;
        }
    }

    console.log(`\n[Auto-Refill] Done — ✅ ${ok} ok, 💸 ${refilled} refilled, ❌ ${missing} missing\n`);
    return { refilled, ok, missing };
}

// Run as daemon or single check
const isDaemon = process.env.DAEMON === "true";

if (isDaemon) {
    console.log(`[Auto-Refill] 🚀 Starting daemon (every ${CHECK_INTERVAL_MS / 60000} min)`);
    checkAndRefill().catch(console.error);
    setInterval(() => checkAndRefill().catch(console.error), CHECK_INTERVAL_MS);
} else {
    checkAndRefill()
        .then((result) => {
            console.log("📊 Summary:", result);
            process.exit(0);
        })
        .catch((err) => {
            console.error("Fatal:", err.message);
            process.exit(1);
        });
}
