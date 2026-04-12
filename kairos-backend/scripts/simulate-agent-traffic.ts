/**
 * simulate-agent-traffic.ts
 * Fires real x402 USDC payments to all 9 Kairos agents on Stellar testnet.
 * Useful for seeding the dashboard with activity before a demo.
 *
 * Usage: npx tsx scripts/simulate-agent-traffic.ts
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
const PAYMENT_AMOUNT = "0.0100000"; // 0.01 USDC per simulated query

// Rounds of simulated traffic per agent
const ROUNDS = parseInt(process.env.ROUNDS || "5", 10);

const AGENTS = [
    { name: "Price Oracle",    address: process.env.ORACLE_X402_ADDRESS!,        memo: "x402:oracle:price" },
    { name: "News Scout",      address: process.env.NEWS_X402_ADDRESS!,           memo: "x402:news:sentiment" },
    { name: "Yield Optimizer", address: process.env.YIELD_X402_ADDRESS!,          memo: "x402:yield:apy" },
    { name: "Tokenomics",      address: process.env.TOKENOMICS_X402_ADDRESS!,     memo: "x402:tokenomics" },
    { name: "Perp Stats",      address: process.env.PERP_STATS_X402_ADDRESS!,     memo: "x402:perp:oi" },
    { name: "Stellar Scout",   address: process.env.STELLAR_SCOUT_X402_ADDRESS!,  memo: "x402:stellar:tvl" },
    { name: "Protocol Stats",  address: process.env.PROTOCOL_X402_ADDRESS!,       memo: "x402:protocol" },
    { name: "Bridge Monitor",  address: process.env.BRIDGES_X402_ADDRESS!,        memo: "x402:bridges" },
    { name: "Stellar DEX",     address: process.env.STELLAR_DEX_X402_ADDRESS!,    memo: "x402:sdex:vol" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendPayment(
    treasuryKeypair: StellarSdk.Keypair,
    usdcAsset: StellarSdk.Asset,
    destination: string,
    memo: string
): Promise<string> {
    const treasuryAccount = await server.loadAccount(treasuryKeypair.publicKey());
    const tx = new StellarSdk.TransactionBuilder(treasuryAccount, {
        fee: "1000",
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            StellarSdk.Operation.payment({
                destination,
                asset: usdcAsset,
                amount: PAYMENT_AMOUNT,
            })
        )
        .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
        .setTimeout(60)
        .build();

    tx.sign(treasuryKeypair);
    const result = await server.submitTransaction(tx);
    return (result as any).hash;
}

async function main() {
    if (!TREASURY_SECRET?.startsWith("S")) throw new Error("STELLAR_SPONSOR_SECRET missing");
    if (!USDC_ISSUER) throw new Error("USDC_ISSUER_ADDRESS missing");

    const treasuryKeypair = StellarSdk.Keypair.fromSecret(TREASURY_SECRET);
    const usdcAsset = new StellarSdk.Asset(USDC_CODE, USDC_ISSUER);

    console.log(`\n🚀 Kairos — Agent Traffic Simulator`);
    console.log(`   Treasury : ${treasuryKeypair.publicKey()}`);
    console.log(`   Agents   : ${AGENTS.length}`);
    console.log(`   Rounds   : ${ROUNDS} per agent`);
    console.log(`   Amount   : ${PAYMENT_AMOUNT} USDC per payment`);
    console.log(`   Total    : ~${(AGENTS.length * ROUNDS * parseFloat(PAYMENT_AMOUNT)).toFixed(4)} USDC\n`);

    let success = 0;
    let failed = 0;

    for (const agent of AGENTS) {
        if (!agent.address) {
            console.log(`⏭️  ${agent.name}: no address — skipping`);
            continue;
        }

        console.log(`\n📡 ${agent.name} (${agent.address.slice(0, 8)}...)`);

        for (let i = 1; i <= ROUNDS; i++) {
            try {
                const hash = await sendPayment(treasuryKeypair, usdcAsset, agent.address, agent.memo);
                console.log(`   [${i}/${ROUNDS}] ✅ ${hash.slice(0, 24)}...`);
                success++;
                await sleep(1000); // avoid sequence conflicts
            } catch (err: any) {
                const codes = err?.response?.data?.extras?.result_codes;
                console.error(`   [${i}/${ROUNDS}] ❌ ${JSON.stringify(codes) || err.message}`);
                failed++;
                await sleep(2000);
            }
        }
    }

    console.log(`\n🏁 Simulation complete`);
    console.log(`   ✅ Success : ${success}`);
    console.log(`   ❌ Failed  : ${failed}`);
    console.log(`   💸 Total paid: ~${(success * parseFloat(PAYMENT_AMOUNT)).toFixed(4)} USDC\n`);
}

main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
});
