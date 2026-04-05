/**
 * One-time setup: create a USDC trustline for the treasury/payer account.
 *
 * Usage:
 *   npx tsx scripts/x402-create-usdc-trustline.ts
 *
 * Env (required):
 *   STELLAR_SPONSOR_SECRET
 */

import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../src/config.js";
import { horizonServer, networkPassphrase } from "../src/services/stellar.js";

async function main() {
  const secret = config.stellar.sponsorSecret;
  if (!secret || !secret.startsWith("S")) {
    throw new Error("Missing/invalid STELLAR_SPONSOR_SECRET (must be a secret seed starting with 'S').");
  }

  const kp = StellarSdk.Keypair.fromSecret(secret);
  const payer = kp.publicKey();
  
  const usdcCode = config.stellar.usdcCode || "USDC";
  const usdcIssuer = config.stellar.usdcIssuer;

  console.log("\n=== Create USDC Trustline (Stellar Testnet) ===\n");
  console.log(`Payer Account: ${payer}`);

  // Strict issuer check: do not silently switch assets.
  if (!usdcIssuer || !StellarSdk.StrKey.isValidEd25519PublicKey(usdcIssuer)) {
    throw new Error(`Invalid USDC issuer in config: "${usdcIssuer}"`);
  }
  try {
    await horizonServer.loadAccount(usdcIssuer);
    console.log(`USDC Issuer:   ${usdcIssuer} ✅`);
  } catch (e: any) {
    if (e?.response?.status === 404) {
      throw new Error(`Configured USDC issuer ${usdcIssuer} not found on current Stellar network.`);
    }
    throw e;
  }

  const usdc = new StellarSdk.Asset(usdcCode, usdcIssuer);

  // 🛡️ Logic Check: Issuers don't need trustlines to their own asset
  if (payer === usdcIssuer) {
    console.log("\n✅ Payer is the Issuer. No trustline required. You are ready to issue tokens!\n");
    return;
  }

  const acct = await horizonServer.loadAccount(payer);
  const already = acct.balances.some(
    (b: any) => b.asset_code === usdcCode && b.asset_issuer === usdcIssuer
  );
  if (already) {
    console.log("\n✅ Trustline already exists. Nothing to do.\n");
    return;
  }

  console.log("\nSubmitting changeTrust transaction...");
  const tx = new StellarSdk.TransactionBuilder(acct, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: usdc,
      })
    )
    .addMemo(StellarSdk.Memo.text("x402:trustline"))
    .setTimeout(60)
    .build();

  tx.sign(kp);
  const result = await horizonServer.submitTransaction(tx);
  console.log(`✅ Trustline created. txHash: ${result.hash}\n`);

  console.log("Next: fund the account with Stellar testnet USDC (e.g., Circle faucet), then run:");
  console.log('  npm run x402:demo -- oracle "/oracle/price?symbol=XLM" 0.01\n');
}

main().catch((e) => {
  console.error("\n❌ Trustline setup failed:");
  console.error(e?.message || e);
  process.exit(1);
});

