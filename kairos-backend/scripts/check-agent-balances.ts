/**
 * check-agent-balances.ts
 * Checks XLM and USDC balances for all 9 Kairos agents on Stellar testnet.
 *
 * Usage: npx tsx scripts/check-agent-balances.ts
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const server = new StellarSdk.Horizon.Server(HORIZON_URL);

const USDC_ISSUER = process.env.USDC_ISSUER_ADDRESS!;
const USDC_CODE = "USDC";

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

async function getBalances(address: string): Promise<{ xlm: number; usdc: number }> {
    try {
        const account = await server.loadAccount(address);
        let xlm = 0;
        let usdc = 0;

        for (const b of account.balances) {
            if (b.asset_type === "native") {
                xlm = parseFloat((b as any).balance || "0");
            } else if ((b as any).asset_code === USDC_CODE && (b as any).asset_issuer === USDC_ISSUER) {
                usdc = parseFloat((b as any).balance || "0");
            }
        }
        return { xlm, usdc };
    } catch {
        return { xlm: -1, usdc: -1 };
    }
}

async function main() {
    if (!USDC_ISSUER) {
        throw new Error("USDC_ISSUER_ADDRESS missing in .env");
    }

    const treasury = process.env.STELLAR_SPONSOR_SECRET
        ? StellarSdk.Keypair.fromSecret(process.env.STELLAR_SPONSOR_SECRET).publicKey()
        : "N/A";

    console.log(`\n📊 Kairos Agent Balance Check — Stellar Testnet`);
    console.log(`   Treasury : ${treasury}`);
    console.log(`   USDC     : ${USDC_CODE}:${USDC_ISSUER.slice(0, 8)}...\n`);
    console.log(`${"Agent".padEnd(18)} ${"Address".padEnd(14)} ${"XLM".padStart(12)} ${"USDC".padStart(14)} ${"Status"}`);
    console.log("─".repeat(72));

    let totalUsdc = 0;
    let missingTrustline = 0;
    let notFound = 0;

    for (const agent of AGENTS) {
        if (!agent.address) {
            console.log(`${agent.name.padEnd(18)} ${"(no address)".padEnd(14)}`);
            notFound++;
            continue;
        }

        const shortAddr = `${agent.address.slice(0, 6)}...${agent.address.slice(-4)}`;
        const { xlm, usdc } = await getBalances(agent.address);

        if (xlm === -1) {
            console.log(`${agent.name.padEnd(18)} ${shortAddr.padEnd(14)} ${"NOT FOUND".padStart(12)} ${"—".padStart(14)} ❌ account missing`);
            notFound++;
            continue;
        }

        if (usdc === 0 && xlm > 0) {
            missingTrustline++;
        }

        totalUsdc += usdc;

        const usdcStatus =
            usdc >= 10 ? "✅ funded" :
            usdc >= 1  ? "⚠️  low" :
                         "❌ empty";

        console.log(
            `${agent.name.padEnd(18)} ${shortAddr.padEnd(14)} ${xlm.toFixed(4).padStart(12)} ${usdc.toFixed(7).padStart(14)} ${usdcStatus}`
        );
    }

    console.log("─".repeat(72));
    console.log(`${"TOTAL".padEnd(34)} ${"".padStart(12)} ${totalUsdc.toFixed(7).padStart(14)}\n`);

    if (notFound > 0) {
        console.log(`⚠️  ${notFound} agent(s) not found on-chain. Run: npx tsx scripts/generate-agent-wallets.ts`);
    }
    if (missingTrustline > 0) {
        console.log(`⚠️  ${missingTrustline} agent(s) may be missing USDC trustline.`);
    }
    if (notFound === 0 && missingTrustline === 0) {
        console.log(`✅ All agents online with USDC trustlines.`);
    }

    const lowAgents = AGENTS.filter(async (a) => {
        if (!a.address) return false;
        const { usdc } = await getBalances(a.address);
        return usdc < 10;
    });

    if (totalUsdc < AGENTS.length * 10) {
        console.log(`💡 Tip: Top up agents with: npx tsx scripts/fund-agents.ts\n`);
    } else {
        console.log();
    }
}

main().catch((err) => {
    console.error("Fatal:", err.message);
    process.exit(1);
});
