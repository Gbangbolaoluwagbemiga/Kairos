/**
 * Demo: Pay (USDC) on Stellar Testnet then call /api/x402/*
 *
 * Usage:
 *   npx tsx scripts/x402-pay-and-call.ts oracle "/oracle/price?symbol=XLM" 0.01
 *
 * POST with JSON body:
 *   npx tsx scripts/x402-pay-and-call.ts oracle "/oracle/prices" 0.02 POST '{"symbols":["XLM","BTC","ETH"]}'
 *
 * Env (required):
 *   STELLAR_SPONSOR_SECRET  - secret seed (payer)
 *
 * Env (optional):
 *   API_BASE_URL           - defaults to http://localhost:3001
 *   ORACLE_X402_ADDRESS, NEWS_X402_ADDRESS, YIELD_X402_ADDRESS, TOKENOMICS_X402_ADDRESS, PERP_STATS_X402_ADDRESS
 */

import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config, getUsdcAsset } from "../src/config.js";
import { horizonServer, networkPassphrase } from "../src/services/stellar.js";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3001";

const AGENT_SELLERS: Record<string, string> = {
  oracle: process.env.ORACLE_X402_ADDRESS || config.agentAddresses.oracle,
  news: process.env.NEWS_X402_ADDRESS || config.agentAddresses.news,
  yield: process.env.YIELD_X402_ADDRESS || config.agentAddresses.yield,
  tokenomics: process.env.TOKENOMICS_X402_ADDRESS || config.agentAddresses.tokenomics,
  perp: process.env.PERP_STATS_X402_ADDRESS || config.agentAddresses.perp,
};

function usageAndExit(msg?: string): never {
  if (msg) console.error(`\n❌ ${msg}\n`);
  console.log(`
Usage:
  npx tsx scripts/x402-pay-and-call.ts <agentId> <pathAndQuery> [price] [method] [jsonBody]

Examples:
  npx tsx scripts/x402-pay-and-call.ts oracle "/oracle/price?symbol=XLM" 0.01
  npx tsx scripts/x402-pay-and-call.ts news "/news/latest?limit=3" 0.01
  npx tsx scripts/x402-pay-and-call.ts oracle "/oracle/prices" 0.02 POST '{"symbols":["XLM","BTC","ETH"]}'

Notes:
  - This script sends a Stellar TESTNET USDC payment to the agent (seller),
    then calls: ${API_BASE_URL}/api/x402/<pathAndQuery>
  - The returned tx hash is passed in header: x402-tx-hash
`);
  process.exit(1);
}

function parsePriceTo7Decimals(price: string): string {
  const trimmed = price.trim();
  // zsh gotcha: "$0.01" expands $0 -> "/bin/zsh", producing "/bin/zsh.01"
  // If we detect that pattern, treat it as "$0.01".
  if (/^\/bin\/zsh\.\d+$/.test(trimmed)) {
    const suffix = trimmed.split(".").pop() || "";
    const recovered = `0.${suffix}`;
    const n = Number(recovered);
    if (Number.isFinite(n) && n > 0) return n.toFixed(7);
  }
  const n = trimmed.startsWith("$") ? Number(trimmed.slice(1)) : Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid price: "${price}"`);
  return n.toFixed(7);
}

async function ensureTrustlineForUsdc(payer: string) {
  const account = await horizonServer.loadAccount(payer);
  const hasUsdc = account.balances.some(
    (b: any) => b.asset_code === config.stellar.usdcCode && b.asset_issuer === config.stellar.usdcIssuer
  );
  if (!hasUsdc) {
    throw new Error(
      `Payer account ${payer} has no USDC trustline for ${config.stellar.usdcCode}:${config.stellar.usdcIssuer}. ` +
        `Add a trustline & fund it with testnet USDC, then retry.`
    );
  }
}

async function sendPaymentTx({
  seller,
  amount,
  memo,
  currency,
}: {
  seller: string;
  amount: string;
  memo: string;
  currency: "USDC" | "XLM";
}): Promise<string> {
  const secret = config.stellar.sponsorSecret;
  if (!secret || !secret.startsWith("S")) {
    throw new Error("Missing/invalid STELLAR_SPONSOR_SECRET (must be a secret seed starting with 'S').");
  }

  const payerKeypair = StellarSdk.Keypair.fromSecret(secret);
  const payerPub = payerKeypair.publicKey();

  const payerAccount = await horizonServer.loadAccount(payerPub);
  let asset: StellarSdk.Asset;
  if (currency === "USDC") {
    await ensureTrustlineForUsdc(payerPub);
    asset = getUsdcAsset();
  } else {
    asset = StellarSdk.Asset.native();
  }

  const tx = new StellarSdk.TransactionBuilder(payerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: seller,
        asset,
        amount,
      })
    )
    .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
    .setTimeout(60)
    .build();

  tx.sign(payerKeypair);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}

async function callPaidEndpoint(opts: {
  pathAndQuery: string;
  txHash: string;
  method: string;
  jsonBody?: any;
}) {
  const { pathAndQuery, txHash, method, jsonBody } = opts;
  const url = `${API_BASE_URL}/api/x402${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`;

  const headers: Record<string, string> = {
    "x402-tx-hash": txHash,
    accept: "application/json",
  };

  const init: RequestInit = { method: method.toUpperCase(), headers };
  if (init.method !== "GET" && init.method !== "HEAD") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(jsonBody ?? {});
  }

  const res = await fetch(url, init);

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: res.status, json, url };
}

async function main() {
  const agentId = process.argv[2];
  const pathAndQuery = process.argv[3];
  const price = process.argv[4] || "0.01";
  const method = process.argv[5] || "GET";
  const bodyArg = process.argv[6];
  const currencyArg = (process.env.X402_CURRENCY || "XLM").toUpperCase();
  const currency = (currencyArg === "USDC" ? "USDC" : "XLM") as "USDC" | "XLM";

  if (!agentId || !pathAndQuery) usageAndExit();
  const seller = AGENT_SELLERS[agentId];
  if (!seller) usageAndExit(`Unknown agentId "${agentId}". Expected one of: ${Object.keys(AGENT_SELLERS).join(", ")}`);

  const amount = parsePriceTo7Decimals(price);
  let jsonBody: any = undefined;
  if (bodyArg) {
    try {
      jsonBody = JSON.parse(bodyArg);
    } catch (e) {
      usageAndExit(`Invalid JSON body. Provide a JSON string, e.g. '{"symbols":["XLM","BTC"]}'`);
    }
  }

  console.log("\n=== x402 Paid HTTP Demo (Stellar Testnet) ===\n");
  console.log(`Agent:     ${agentId}`);
  console.log(`Seller:    ${seller}`);
  console.log(`Endpoint:  ${API_BASE_URL}/api/x402${pathAndQuery.startsWith("/") ? "" : "/"}${pathAndQuery}`);
  console.log(`Method:    ${method.toUpperCase()}`);
  console.log(`Amount:    ${amount} ${currency}`);
  if (jsonBody) console.log(`Body:      ${JSON.stringify(jsonBody)}`);

  console.log(`\n1) Sending ${currency} payment tx...`);
  const txHash = await sendPaymentTx({
    seller,
    amount,
    memo: `x402:http:${agentId}`,
    currency,
  });
  console.log(`   ✅ txHash: ${txHash}`);

  console.log("\n2) Calling paid endpoint with x402-tx-hash...");
  const result = await callPaidEndpoint({ pathAndQuery, txHash, method, jsonBody });
  console.log(`   ✅ HTTP ${result.status}`);
  console.log(`   URL: ${result.url}`);
  console.log("\nResponse:");
  console.log(JSON.stringify(result.json, null, 2));
  console.log("");
}

main().catch((e) => {
  console.error("\n❌ Demo failed:");
  console.error(e?.message || e);
  process.exit(1);
});

