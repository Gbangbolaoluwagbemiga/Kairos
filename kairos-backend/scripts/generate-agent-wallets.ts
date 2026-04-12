/**
 * Generate fresh agent keypairs for all 9 Kairos agents.
 * Creates Stellar accounts with USDC trustlines (treasury-sponsored),
 * seeds each with 1 USDC, and writes secrets to agent-wallets.json.
 *
 * Run:
 *   cd kairos-backend
 *   npx tsx scripts/generate-agent-wallets.ts
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const server = new StellarSdk.Horizon.Server(HORIZON_URL);

const SPONSOR_SECRET = process.env.STELLAR_SPONSOR_SECRET!;
const USDC_ISSUER_ADDRESS = process.env.USDC_ISSUER_ADDRESS!;

if (!SPONSOR_SECRET) { console.error("❌ STELLAR_SPONSOR_SECRET not set"); process.exit(1); }
if (!USDC_ISSUER_ADDRESS) { console.error("❌ USDC_ISSUER_ADDRESS not set"); process.exit(1); }

const sponsorKP = StellarSdk.Keypair.fromSecret(SPONSOR_SECRET);
const usdcAsset = new StellarSdk.Asset("USDC", USDC_ISSUER_ADDRESS);
const SEED_USDC = "1.0000000";

const AGENT_NAMES = [
    "oracle", "news", "yield", "tokenomics", "perp",
    "stellarScout", "protocol", "bridges", "stellar-dex"
];

const ENV_KEYS: Record<string, { address: string; secret: string }> = {
    oracle:       { address: "ORACLE_X402_ADDRESS",       secret: "ORACLE_AGENT_SECRET" },
    news:         { address: "NEWS_X402_ADDRESS",         secret: "NEWS_AGENT_SECRET" },
    yield:        { address: "YIELD_X402_ADDRESS",        secret: "YIELD_AGENT_SECRET" },
    tokenomics:   { address: "TOKENOMICS_X402_ADDRESS",   secret: "TOKENOMICS_AGENT_SECRET" },
    perp:         { address: "PERP_STATS_X402_ADDRESS",   secret: "PERP_AGENT_SECRET" },
    stellarScout: { address: "STELLAR_SCOUT_X402_ADDRESS",secret: "STELLAR_SCOUT_AGENT_SECRET" },
    protocol:     { address: "PROTOCOL_X402_ADDRESS",     secret: "PROTOCOL_AGENT_SECRET" },
    bridges:      { address: "BRIDGES_X402_ADDRESS",      secret: "BRIDGES_AGENT_SECRET" },
    "stellar-dex":{ address: "STELLAR_DEX_X402_ADDRESS",  secret: "STELLAR_DEX_AGENT_SECRET" },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createAndSetupAgent(name: string) {
    const agentKP = StellarSdk.Keypair.random();
    console.log(`\n🔑 [${name}] Generated: ${agentKP.publicKey()}`);

    const sponsorAccount = await server.loadAccount(sponsorKP.publicKey());
    const tx = new StellarSdk.TransactionBuilder(sponsorAccount, {
        fee: (Number(StellarSdk.BASE_FEE) * 4).toString(),
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(StellarSdk.Operation.beginSponsoringFutureReserves({ sponsoredId: agentKP.publicKey() }))
        .addOperation(StellarSdk.Operation.createAccount({ destination: agentKP.publicKey(), startingBalance: "0" }))
        .addOperation(StellarSdk.Operation.changeTrust({ asset: usdcAsset, source: agentKP.publicKey() }))
        .addOperation(StellarSdk.Operation.endSponsoringFutureReserves({ source: agentKP.publicKey() }))
        .setTimeout(60).build();

    tx.sign(sponsorKP);
    tx.sign(agentKP);

    console.log(`  📤 Creating account + USDC trustline...`);
    const result = await server.submitTransaction(tx);
    console.log(`  ✅ Created: ${result.hash}`);
    await sleep(3000);

    const sponsorAccount2 = await server.loadAccount(sponsorKP.publicKey());
    const seedTx = new StellarSdk.TransactionBuilder(sponsorAccount2, {
        fee: StellarSdk.BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(StellarSdk.Operation.payment({ destination: agentKP.publicKey(), asset: usdcAsset, amount: SEED_USDC }))
        .setTimeout(60).build();
    seedTx.sign(sponsorKP);
    const seedResult = await server.submitTransaction(seedTx);
    console.log(`  💸 Seeded ${SEED_USDC} USDC: ${seedResult.hash}`);

    return { name, publicKey: agentKP.publicKey(), secret: agentKP.secret() };
}

async function main() {
    console.log("🚀 Kairos — Agent Wallet Generator (all 9 agents)");
    console.log(`   Treasury: ${sponsorKP.publicKey()}`);
    console.log(`   USDC Issuer: ${USDC_ISSUER_ADDRESS}\n`);

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

    const outputPath = path.resolve(__dirname, "../agent-wallets.json");
    fs.writeFileSync(outputPath, JSON.stringify(wallets, null, 2));
    console.log(`\n📁 Keypairs saved to: ${outputPath}`);
    console.log("   ⚠️  Keep agent-wallets.json secret and out of git!\n");

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Add these to your .env file:\n");
    for (const w of wallets) {
        const keys = ENV_KEYS[w.name];
        if (keys) {
            console.log(`${keys.address}=${w.publicKey}`);
            console.log(`${keys.secret}=${w.secret}`);
        }
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => {
    console.error("Fatal:", err?.response?.data || err.message);
    process.exit(1);
});
