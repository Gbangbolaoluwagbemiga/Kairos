/**
 * One-time setup: register Kairos agents in the Soroban Agent Registry (testnet).
 *
 * This writes real on-chain data (no mock) so the backend can resolve agent owners/prices via:
 * - get_agents_by_service(service_type)
 * - get_agent(id)
 *
 * Required env:
 * - AGENT_REGISTRY_CONTRACT_ID (C...)
 * - STELLAR_NETWORK=testnet (or public)
 * - ORACLE_AGENT_SECRET, NEWS_AGENT_SECRET, YIELD_AGENT_SECRET,
 *   TOKENOMICS_AGENT_SECRET, PERP_AGENT_SECRET, STELLAR_SCOUT_AGENT_SECRET
 *
 * Notes:
 * - register_agent requires owner.require_auth(), so each agent must sign its own registration.
 * - Make sure each agent account exists on testnet (fund via friendbot) before running.
 */

import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../src/config.js";
import { networkPassphrase, sorobanServer } from "../src/services/stellar.js";

type AgentKey = "oracle" | "news" | "yield" | "tokenomics" | "perp" | "stellar";

const SERVICE_TYPE: Record<AgentKey, string> = {
  oracle: "price",
  news: "news",
  yield: "yield",
  tokenomics: "tokenomics",
  perp: "perp",
  stellar: "stellar",
};

const DISPLAY_NAME: Record<AgentKey, string> = {
  oracle: "Price Oracle",
  news: "News Scout",
  yield: "Yield Optimizer",
  tokenomics: "Tokenomics",
  perp: "Perp Stats",
  stellar: "Stellar Scout",
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v.trim();
}

function priceToI128(price: string): bigint {
  // Contract stores i128; we use 7 decimals to match Stellar asset precision.
  // Example: "0.01" -> 100000 (0.01 * 1e7)
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return 100000n;
  return BigInt(Math.round(n * 1e7));
}

async function simulateReadonly(contractId: string, sourcePublicKey: string, method: string, args: StellarSdk.xdr.ScVal[]) {
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
    const detail = (sim as any)?.error || JSON.stringify(sim);
    throw new Error(`Simulation failed for ${method}: ${detail}`);
  }

  const retval = (sim as any).result?.retval;
  return retval ? StellarSdk.scValToNative(retval) : undefined;
}

async function isAlreadyRegistered(contractId: string, readerPublicKey: string, serviceType: string, owner: string) {
  const ids = (await simulateReadonly(
    contractId,
    readerPublicKey,
    "get_agents_by_service",
    [StellarSdk.nativeToScVal(serviceType)]
  )) as unknown;

  if (!Array.isArray(ids) || ids.length === 0) return false;

  for (const id of ids) {
    const n = Number(id);
    if (!Number.isFinite(n) || n <= 0) continue;
    const agent = (await simulateReadonly(
      contractId,
      readerPublicKey,
      "get_agent",
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

  console.log("  • simulating transaction...");
  const sim = await sorobanServer.simulateTransaction(tx);
  if (!StellarSdk.rpc.Api.isSimulationSuccess(sim)) {
    const detail = (sim as any)?.error || JSON.stringify(sim);
    throw new Error(`Simulation failed for ${method}: ${detail}`);
  }

  const assembled = StellarSdk.rpc.assembleTransaction(tx, sim).build();
  assembled.sign(kp);

  console.log("  • sending transaction...");
  const sent = await sorobanServer.sendTransaction(assembled);
  const hash = (sent as any)?.hash || (sent as any)?.txHash || (sent as any)?.id;
  if (!hash || typeof hash !== "string") {
    throw new Error(`Unexpected sendTransaction response: ${JSON.stringify(sent)}`);
  }

  console.log(`  • submitted: ${hash}`);
  console.log("  • waiting for confirmation...");
  const res = await sorobanServer.pollTransaction(hash, {
    attempts: 30,
    sleepStrategy: StellarSdk.rpc.BasicSleepStrategy,
  });
  if ((res as any)?.status !== StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
    if (verifyRegistered) {
      console.log("  • tx not finalized yet, checking on-chain registry state...");
      await new Promise((r) => setTimeout(r, 5000));
      const registered = await verifyRegistered();
      if (registered) {
        console.log("  • registration found on-chain despite delayed tx lookup");
        return hash;
      }
    }
    throw new Error(`Transaction failed or not found: ${hash}`);
  }

  return hash;
}

async function main() {
  const contractId = requireEnv("AGENT_REGISTRY_CONTRACT_ID");

  const secrets: Record<AgentKey, string> = {
    oracle: requireEnv("ORACLE_AGENT_SECRET"),
    news: requireEnv("NEWS_AGENT_SECRET"),
    yield: requireEnv("YIELD_AGENT_SECRET"),
    tokenomics: requireEnv("TOKENOMICS_AGENT_SECRET"),
    perp: requireEnv("PERP_AGENT_SECRET"),
    stellar: requireEnv("STELLAR_SCOUT_AGENT_SECRET"),
  };

  // Default price per agent from config (string like "0.0100000")
  const priceByKey: Record<AgentKey, string> = {
    oracle: config.prices.oracle,
    news: config.prices.news,
    yield: config.prices.yield,
    tokenomics: config.prices.tokenomics,
    perp: config.prices.perp,
    stellar: config.prices.stellarScout,
  };

  console.log("\n=== Register Kairos agents on Soroban (testnet) ===\n");
  console.log(`Contract: ${contractId}`);

  for (const key of Object.keys(secrets) as AgentKey[]) {
    const secret = secrets[key];
    const owner = StellarSdk.Keypair.fromSecret(secret).publicKey();
    const name = DISPLAY_NAME[key];
    const serviceType = SERVICE_TYPE[key];
    const priceI128 = priceToI128(priceByKey[key]);

    console.log(`\n→ Registering ${key} (${name})`);
    console.log(`  owner: ${owner}`);
    console.log(`  service_type: ${serviceType}`);
    console.log(`  price (i128, 7dp): ${priceI128.toString()}`);

    // Make the script safe to rerun: skip if already registered on-chain.
    try {
      const already = await isAlreadyRegistered(contractId, owner, serviceType, owner);
      if (already) {
        console.log("  ↪ already registered, skipping");
        continue;
      }
    } catch (e: any) {
      console.warn(`  ⚠️ could not pre-check registration status: ${e?.message || e}`);
    }

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

    console.log(`  ✅ registered (tx: ${txHash})`);
  }

  console.log("\nDone. Your backend can now resolve agents on-chain.\n");
}

main().catch((e) => {
  console.error("\n❌ Agent registration failed:");
  console.error(e?.message || e);
  process.exit(1);
});

