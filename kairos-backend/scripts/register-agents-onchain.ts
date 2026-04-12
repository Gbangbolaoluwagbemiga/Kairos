/**
 * register-agents-onchain.ts
 * Registers all 9 Kairos agents in the Soroban Agent Registry on Stellar testnet.
 * Safe to rerun — skips agents already registered.
 *
 * Required env:
 * - AGENT_REGISTRY_CONTRACT_ID
 * - STELLAR_NETWORK=testnet
 * - All 9 *_AGENT_SECRET variables
 *
 * Usage: npx tsx scripts/register-agents-onchain.ts
 */

import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../src/config.js";
import { networkPassphrase, sorobanServer } from "../src/services/stellar.js";

type AgentKey =
    | "oracle" | "news" | "yield" | "tokenomics" | "perp"
    | "stellarScout" | "protocol" | "bridges" | "stellarDex";

const SERVICE_TYPE: Record<AgentKey, string> = {
    oracle:      "price",
    news:        "news",
    yield:       "yield",
    tokenomics:  "tokenomics",
    perp:        "perp",
    stellarScout:"stellar",
    protocol:    "protocol",
    bridges:     "bridges",
    stellarDex:  "stellar-dex",
};

const DISPLAY_NAME: Record<AgentKey, string> = {
    oracle:       "Price Oracle",
    news:         "News Scout",
    yield:        "Yield Optimizer",
    tokenomics:   "Tokenomics",
    perp:         "Perp Stats",
    stellarScout: "Stellar Scout",
    protocol:     "Protocol Stats",
    bridges:      "Bridge Monitor",
    stellarDex:   "Stellar DEX",
};

function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v?.trim()) throw new Error(`Missing required env: ${name}`);
    return v.trim();
}

function priceToI128(price: string): bigint {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return 100000n;
    return BigInt(Math.round(n * 1e7));
}

async function simulateReadonly(
    contractId: string,
    sourcePublicKey: string,
    method: string,
    args: StellarSdk.xdr.ScVal[]
) {
    const contract = new StellarSdk.Contract(contractId);
    const account = await sorobanServer.getAccount(sourcePublicKey);
    const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

    const sim = await sorobanServer.simulateTransaction(tx);
    if (!StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
        throw new Error(`Simulation failed for ${method}: ${(sim as any)?.error || JSON.stringify(sim)}`);
    }
    const retval = (sim as any).result?.retval;
    return retval ? StellarSdk.scValToNative(retval) : undefined;
}

async function isAlreadyRegistered(
    contractId: string,
    readerPublicKey: string,
    serviceType: string,
    owner: string
): Promise<boolean> {
    const ids = (await simulateReadonly(
        contractId, readerPublicKey, "get_agents_by_service",
        [StellarSdk.nativeToScVal(serviceType)]
    )) as unknown;

    if (!Array.isArray(ids) || ids.length === 0) return false;

    for (const id of ids) {
        const n = Number(id);
        if (!Number.isFinite(n) || n <= 0) continue;
        const agent = (await simulateReadonly(
            contractId, readerPublicKey, "get_agent",
            [StellarSdk.nativeToScVal(n, { type: "u32" })]
        )) as any;
        const onchainOwner = typeof agent?.owner === "string" ? agent.owner : String(agent?.owner ?? "");
        if (onchainOwner === owner) return true;
    }
    return false;
}

async function invokeAndSend(
    contractId: string,
    ownerSecret: string,
    method: string,
    args: StellarSdk.xdr.ScVal[],
    verifyRegistered?: () => Promise<boolean>
): Promise<string> {
    const kp = StellarSdk.Keypair.fromSecret(ownerSecret);
    const owner = kp.publicKey();
    const contract = new StellarSdk.Contract(contractId);
    const account = await sorobanServer.getAccount(owner);

    const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(60)
        .build();

    console.log("  • simulating...");
    const sim = await sorobanServer.simulateTransaction(tx);
    if (!StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
        throw new Error(`Simulation failed: ${(sim as any)?.error || JSON.stringify(sim)}`);
    }

    const assembled = StellarSdk.rpc.assembleTransaction(tx, sim).build();
    assembled.sign(kp);

    console.log("  • submitting...");
    const sent = await sorobanServer.sendTransaction(assembled);
    const hash = (sent as any)?.hash || (sent as any)?.txHash || (sent as any)?.id;
    if (!hash) throw new Error(`Unexpected response: ${JSON.stringify(sent)}`);

    console.log(`  • submitted: ${hash}`);
    console.log("  • waiting for confirmation...");

    const res = await sorobanServer.pollTransaction(hash, {
        attempts: 30,
        sleepStrategy: StellarSdk.rpc.BasicSleepStrategy,
    });

    if ((res as any)?.status !== StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
        if (verifyRegistered) {
            await new Promise((r) => setTimeout(r, 5000));
            if (await verifyRegistered()) {
                console.log("  • confirmed via registry lookup");
                return hash;
            }
        }
        throw new Error(`Transaction failed: ${hash}`);
    }

    return hash;
}

async function main() {
    const contractId = requireEnv("AGENT_REGISTRY_CONTRACT_ID");

    const secrets: Record<AgentKey, string> = {
        oracle:       requireEnv("ORACLE_AGENT_SECRET"),
        news:         requireEnv("NEWS_AGENT_SECRET"),
        yield:        requireEnv("YIELD_AGENT_SECRET"),
        tokenomics:   requireEnv("TOKENOMICS_AGENT_SECRET"),
        perp:         requireEnv("PERP_AGENT_SECRET"),
        stellarScout: requireEnv("STELLAR_SCOUT_AGENT_SECRET"),
        protocol:     requireEnv("PROTOCOL_AGENT_SECRET"),
        bridges:      requireEnv("BRIDGES_AGENT_SECRET"),
        stellarDex:   requireEnv("STELLAR_DEX_AGENT_SECRET"),
    };

    const priceByKey: Record<AgentKey, string> = {
        oracle:       config.prices.oracle,
        news:         config.prices.news,
        yield:        config.prices.yield,
        tokenomics:   config.prices.tokenomics,
        perp:         config.prices.perp,
        stellarScout: config.prices.stellarScout,
        protocol:     config.prices.protocol,
        bridges:      config.prices.bridges,
        stellarDex:   config.prices.stellarDex,
    };

    console.log("\n=== Register all 9 Kairos agents on Soroban (testnet) ===\n");
    console.log(`Contract: ${contractId}\n`);

    let registered = 0;
    let skipped = 0;
    let failed = 0;

    for (const key of Object.keys(secrets) as AgentKey[]) {
        const secret = secrets[key];
        const owner = StellarSdk.Keypair.fromSecret(secret).publicKey();
        const name = DISPLAY_NAME[key];
        const serviceType = SERVICE_TYPE[key];
        const priceI128 = priceToI128(priceByKey[key]);

        console.log(`→ ${name} (${key})`);
        console.log(`  owner        : ${owner}`);
        console.log(`  service_type : ${serviceType}`);
        console.log(`  price (i128) : ${priceI128.toString()}`);

        try {
            const already = await isAlreadyRegistered(contractId, owner, serviceType, owner);
            if (already) {
                console.log("  ↪ already registered — skipping\n");
                skipped++;
                continue;
            }
        } catch (e: any) {
            console.warn(`  ⚠️ pre-check failed: ${e?.message}`);
        }

        try {
            const txHash = await invokeAndSend(
                contractId,
                secret,
                "register_agent",
                [
                    StellarSdk.Address.fromString(owner).toScVal(),
                    StellarSdk.nativeToScVal(name),
                    StellarSdk.nativeToScVal(serviceType),
                    StellarSdk.nativeToScVal(priceI128, { type: "i128" }),
                ],
                () => isAlreadyRegistered(contractId, owner, serviceType, owner)
            );
            console.log(`  ✅ registered (tx: ${txHash})\n`);
            registered++;
        } catch (e: any) {
            console.error(`  ❌ failed: ${e?.message}\n`);
            failed++;
        }
    }

    console.log("═".repeat(60));
    console.log(`✅ Registered : ${registered}`);
    console.log(`⏭️  Skipped   : ${skipped}`);
    console.log(`❌ Failed     : ${failed}`);
    console.log("═".repeat(60));
    console.log("\nDone. Backend can now resolve all 9 agents on-chain.\n");
}

main().catch((e) => {
    console.error("\n❌ Registration failed:", e?.message || e);
    process.exit(1);
});
