/**
 * fund-agents.ts
 * Sends 100 USDC from the treasury to each of the 9 Kairos agents.
 * Safe to run multiple times — checks balance first and skips agents already funded.
 *
 * Usage: npx tsx scripts/fund-agents.ts
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
const FUND_AMOUNT = "100"; // 100 USDC per agent

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
        const usdcBalance = account.balances.find(
            (b: any) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER
        );
        return parseFloat((usdcBalance as any)?.balance || "0");
    } catch {
        return 0;
    }
}

async function main() {
    if (!TREASURY_SECRET?.startsWith("S")) {
        throw new Error("STELLAR_SPONSOR_SECRET missing or invalid in .env");
    }
    if (!USDC_ISSUER) {
        throw new Error("USDC_ISSUER_ADDRESS missing in .env");
    }

    const treasuryKeypair = StellarSdk.Keypair.fromSecret(TREASURY_SECRET);
    const usdcAsset = new StellarSdk.Asset(USDC_CODE, USDC_ISSUER);

    console.log(`\n💰 Kairos Agent Funding Script`);
    console.log(`   Treasury : ${treasuryKeypair.publicKey()}`);
    console.log(`   USDC     : ${USDC_CODE}:${USDC_ISSUER.slice(0, 8)}...`);
    console.log(`   Amount   : ${FUND_AMOUNT} USDC per agent\n`);

    // Check treasury USDC balance
    const treasuryBalance = await getUsdcBalance(treasuryKeypair.publicKey());
    console.log(`   Treasury USDC balance: ${treasuryBalance} USDC`);
    const needed = AGENTS.length * parseFloat(FUND_AMOUNT);
    if (treasuryBalance < needed) {
        console.warn(`\n⚠️  Warning: Treasury has ${treasuryBalance} USDC but ${needed} USDC needed.`);
        console.warn(`   Proceeding anyway — some payments may fail if balance runs out.\n`);
    } else {
        console.log(`   ✅ Sufficient balance for all agents (need ${needed} USDC)\n`);
    }

    let funded = 0;
    let skipped = 0;
    let failed = 0;

    for (const agent of AGENTS) {
        if (!agent.address) {
            console.log(`⏭️  ${agent.name}: no address configured — skipping`);
            skipped++;
            continue;
        }

        // Check current balance
        const currentBalance = await getUsdcBalance(agent.address);
        console.log(`📊 ${agent.name} (${agent.address.slice(0, 8)}...): ${currentBalance} USDC`);

        if (currentBalance >= parseFloat(FUND_AMOUNT)) {
            console.log(`   ✅ Already has ${currentBalance} USDC — skipping\n`);
            skipped++;
            continue;
        }

        const topUp = (parseFloat(FUND_AMOUNT) - currentBalance).toFixed(7);
        console.log(`   ➕ Sending ${topUp} USDC (top-up to ${FUND_AMOUNT})...`);

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
                .addMemo(StellarSdk.Memo.text(`fund:${agent.name.slice(0, 14)}`))
                .setTimeout(60)
                .build();

            tx.sign(treasuryKeypair);
            const result = await server.submitTransaction(tx);

            console.log(`   ✅ Funded! TX: ${(result as any).hash}\n`);
            funded++;
        } catch (err: any) {
            const codes = err?.response?.data?.extras?.result_codes;
            console.error(`   ❌ Failed: ${JSON.stringify(codes) || err.message}\n`);
            failed++;
        }
    }

    console.log(`\n🏁 Done!`);
    console.log(`   ✅ Funded  : ${funded}`);
    console.log(`   ⏭️  Skipped : ${skipped}`);
    console.log(`   ❌ Failed  : ${failed}\n`);

    // Print final balances
    console.log(`📈 Final USDC Balances:\n`);
    for (const agent of AGENTS) {
        if (!agent.address) continue;
        const bal = await getUsdcBalance(agent.address);
        const status = bal >= parseFloat(FUND_AMOUNT) ? "✅" : bal > 0 ? "⚠️ " : "❌";
        console.log(`   ${status} ${agent.name.padEnd(18)} ${bal.toFixed(7)} USDC`);
    }
    console.log();
}

main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
});
