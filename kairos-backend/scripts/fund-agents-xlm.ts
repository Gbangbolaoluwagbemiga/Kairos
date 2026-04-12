/**
 * fund-agents-xlm.ts
 * Sends XLM to all 9 agent wallets so they can pay Soroban tx fees.
 * Usage: npx tsx scripts/fund-agents-xlm.ts
 */
import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";

const HORIZON = "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const XLM_AMOUNT = "50"; // 50 XLM per agent — plenty for Soroban fees

const AGENTS = [
    { name: "oracle",       address: process.env.ORACLE_X402_ADDRESS! },
    { name: "news",         address: process.env.NEWS_X402_ADDRESS! },
    { name: "yield",        address: process.env.YIELD_X402_ADDRESS! },
    { name: "tokenomics",   address: process.env.TOKENOMICS_X402_ADDRESS! },
    { name: "perp",         address: process.env.PERP_STATS_X402_ADDRESS! },
    { name: "stellarScout", address: process.env.STELLAR_SCOUT_X402_ADDRESS! },
    { name: "protocol",     address: process.env.PROTOCOL_X402_ADDRESS! },
    { name: "bridges",      address: process.env.BRIDGES_X402_ADDRESS! },
    { name: "stellarDex",   address: process.env.STELLAR_DEX_X402_ADDRESS! },
];

async function main() {
    const treasurySecret = process.env.STELLAR_SPONSOR_SECRET;
    if (!treasurySecret) throw new Error("Missing STELLAR_SPONSOR_SECRET");
    
    const treasuryKeypair = StellarSdk.Keypair.fromSecret(treasurySecret);
    const server = new StellarSdk.Horizon.Server(HORIZON);
    const treasuryAccount = await server.loadAccount(treasuryKeypair.publicKey());

    console.log(`\n💰 Funding ${AGENTS.length} agents with ${XLM_AMOUNT} XLM each...\n`);

    let builder = new StellarSdk.TransactionBuilder(treasuryAccount, {
        fee: (parseInt(StellarSdk.BASE_FEE) * AGENTS.length).toString(),
        networkPassphrase: NETWORK_PASSPHRASE,
    });

    for (const agent of AGENTS) {
        builder = builder.addOperation(
            StellarSdk.Operation.payment({
                destination: agent.address,
                asset: StellarSdk.Asset.native(),
                amount: XLM_AMOUNT,
            })
        );
    }

    const tx = builder.setTimeout(60).build();

    tx.sign(treasuryKeypair);
    
    console.log("Submitting batch payment...");
    const result = await server.submitTransaction(tx);
    console.log(`✅ Done! Tx: https://stellar.expert/explorer/testnet/tx/${(result as any).hash}\n`);

    for (const agent of AGENTS) {
        console.log(`  ${agent.name.padEnd(12)} → ${agent.address}`);
    }
    console.log("\nAll agents now have XLM for Soroban fees.\n");
}

main().catch(e => {
    console.error("❌ Failed:", e.message);
    process.exit(1);
});
