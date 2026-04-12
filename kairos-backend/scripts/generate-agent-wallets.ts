/**
 * Generate fresh agent keypairs, fund them from the treasury,
 * add USDC trustlines (treasury-issued), and seed 0.1 USDC each.
 *
 * Run:
 *   cd kairos-backend
 *   npx tsx scripts/generate-agent-wallets.ts
 *
 * Outputs new AGENT_*_ADDRESS and AGENT_*_SECRET values to add to .env.
 * The script also writes agent-wallets.json with the full keypairs (keep secret!).
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const server = new StellarSdk.Horizon.Server(HORIZON_URL);

const SPONSOR_SECRET = process.env.STELLAR_SPONSOR_SECRET!;
const USDC_ISSUER_ADDRESS = process.env.USDC_ISSUER_ADDRESS!;

if (!SPONSOR_SECRET) {
    console.error("❌ STELLAR_SPONSOR_SECRET must be set in .env");
    process.exit(1);
}
if (!USDC_ISSUER_ADDRESS) {
    console.error("❌ USDC_ISSUER_ADDRESS must be set in .env");
    process.exit(1);
}

const sponsorKP = StellarSdk.Keypair.fromSecret(SPONSOR_SECRET);
const usdcAsset = new StellarSdk.Asset("USDC", USDC_ISSUER_ADDRESS);
const SEED_USDC = "0.5000000"; // seed each agent with 0.5 USDC

const AGENT_NAMES = ["oracle", "news", "yield", "tokenomics", "perp", "stellarScout"];

async function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function createAndSetupAgent(name: string): Promise<{ name: string; publicKey: string; secret: string }> {
    const agentKP = StellarSdk.Keypair.random();
    console.log(`\n🔑 [${name}] Generated: ${agentKP.publicKey()}`);

    const sponsorAccount = await server.loadAccount(sponsorKP.publicKey());

    // Step 1: Create account + add trustline in one transaction
    // The sponsor creates the agent account and immediately sponsors the trustline reserve.
    const tx = new StellarSdk.TransactionBuilder(sponsorAccount, {
        fee: (Number(StellarSdk.BASE_FEE) * 4).toString(),
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            StellarSdk.Operation.beginSponsoringFutureReserves({
                sponsoredId: agentKP.publicKey(),
            })
        )
        .addOperation(
            StellarSdk.Operation.createAccount({
                destination: agentKP.publicKey(),
                startingBalance: "0", // sponsor covers reserves
            })
        )
        .addOperation(
            StellarSdk.Operation.changeTrust({
                asset: usdcAsset,
                source: agentKP.publicKey(),
            })
        )
        .addOperation(
            StellarSdk.Operation.endSponsoringFutureReserves({
                source: agentKP.publicKey(),
            })
        )
        .setTimeout(60)
        .build();

    tx.sign(sponsorKP);
    tx.sign(agentKP); // agent must sign changeTrust + endSponsoring

    console.log(`  📤 Creating account + USDC trustline (sponsored)...`);
    const result = await server.submitTransaction(tx);
    console.log(`  ✅ Created: ${result.hash}`);

    await sleep(3000); // wait for ledger

    // Step 2: Seed with USDC (treasury is the issuer — can always send)
    const sponsorAccount2 = await server.loadAccount(sponsorKP.publicKey());
    const seedTx = new StellarSdk.TransactionBuilder(sponsorAccount2, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            StellarSdk.Operation.payment({
                destination: agentKP.publicKey(),
                asset: usdcAsset,
                amount: SEED_USDC,
            })
        )
        .setTimeout(60)
        .build();

    seedTx.sign(sponsorKP);
    const seedResult = await server.submitTransaction(seedTx);
    console.log(`  💸 Seeded ${SEED_USDC} USDC: ${seedResult.hash}`);

    return { name, publicKey: agentKP.publicKey(), secret: agentKP.secret() };
}

async function main() {
    console.log("🚀 Kairos — Agent Wallet Generator");
    console.log(`   Treasury: ${sponsorKP.publicKey()}`);
    console.log(`   USDC Issuer: ${USDC_ISSUER_ADDRESS}`);
    console.log(`   Agents: ${AGENT_NAMES.join(", ")}\n`);

    if (sponsorKP.publicKey() !== USDC_ISSUER_ADDRESS) {
        console.warn("⚠️  Warning: STELLAR_SPONSOR_SECRET public key != USDC_ISSUER_ADDRESS");
        console.warn("   USDC payments only work if the treasury IS the issuer (demo mode).");
        console.warn("   If using Circle USDC, ensure the treasury has Circle USDC balance.\n");
    }

    const wallets: Array<{ name: string; publicKey: string; secret: string }> = [];

    for (const name of AGENT_NAMES) {
        try {
            const wallet = await createAndSetupAgent(name);
            wallets.push(wallet);
            await sleep(2000);
        } catch (err: any) {
            console.error(`  ❌ Failed for ${name}:`, err?.response?.data?.extras?.result_codes || err.message);
        }
    }

    // Write keypairs to file
    const outputPath = path.resolve(__dirname, "../agent-wallets.json");
    fs.writeFileSync(outputPath, JSON.stringify(wallets, null, 2));
    console.log(`\n📁 Keypairs saved to: ${outputPath}`);
    console.log("   ⚠️  Keep agent-wallets.json secret and out of git!\n");

    // Print .env additions
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Add these to your .env file:\n");
    const ENV_KEYS: Record<string, string> = {
        oracle: "ORACLE_X402_ADDRESS",
        news: "NEWS_X402_ADDRESS",
        yield: "YIELD_X402_ADDRESS",
        tokenomics: "TOKENOMICS_X402_ADDRESS",
        perp: "PERP_STATS_X402_ADDRESS",
        stellarScout: "STELLAR_SCOUT_X402_ADDRESS",
    };
    for (const w of wallets) {
        const key = ENV_KEYS[w.name] || `${w.name.toUpperCase()}_X402_ADDRESS`;
        console.log(`${key}=${w.publicKey}`);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
    console.error("Fatal:", err?.response?.data || err.message);
    process.exit(1);
});
