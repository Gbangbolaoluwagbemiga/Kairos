import type { RequestHandler } from "express";
import { horizonServer } from "./stellar.js";
import { config, getUsdcAsset } from "../config.js";

type Currency = "XLM" | "USDC";

export type X402VerifiedPayment = {
  currency: Currency;
  amount: string;
  payer: string;
  seller: string;
  txHash: string;
  memo?: string;
};

type GatewayConfig = {
  sellerAddress: string;
  /**
   * What asset to enforce for the paywalled HTTP endpoint.
   * - "USDC" is closest to the hackathon story.
   * - "XLM" matches the existing on-chain settlement flow used elsewhere in this repo.
   */
  currency?: Currency;
  /**
   * Optional memo prefix to require (e.g. "x402:").
   * Memo verification is best-effort (Horizon may redact/omit memo depending on type).
   */
  requireMemoPrefix?: string;
};

// Simple in-memory replay protection (good enough for hackathon demo)
const seenTx = new Map<string, number>(); // txHash -> expiresAtMs
const REPLAY_TTL_MS = 10 * 60 * 1000; // 10 minutes

function rememberTx(txHash: string) {
  const now = Date.now();
  seenTx.set(txHash, now + REPLAY_TTL_MS);
  // opportunistic cleanup
  for (const [h, exp] of seenTx) {
    if (exp <= now) seenTx.delete(h);
  }
}

function isTxSeen(txHash: string) {
  const exp = seenTx.get(txHash);
  if (!exp) return false;
  if (exp <= Date.now()) {
    seenTx.delete(txHash);
    return false;
  }
  return true;
}

function parseRequiredAmount(price: string, currency: Currency): string {
  // Accept formats like "$0.01" (USD) and "0.0100000" (direct units)
  const trimmed = price.trim();
  const asNumber = trimmed.startsWith("$") ? Number(trimmed.slice(1)) : Number(trimmed);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    throw new Error(`Invalid price requirement: "${price}"`);
  }

  if (currency === "USDC") {
    // Stellar USDC is 7 decimals
    return asNumber.toFixed(7);
  }

  // For XLM enforcement, interpret "$0.01" as XLM amount is ambiguous.
  // We treat the numeric as an XLM amount directly for enforcement.
  return asNumber.toFixed(7);
}

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

async function getPaymentOperationForTx(txHash: string) {
  const ops = await horizonServer.operations().forTransaction(txHash).limit(200).call();
  // Find the first payment-like op (payment or path_payment_strict_receive/send)
  return ops.records.find((op: any) => op.type === "payment") as any | undefined;
}

function opMatchesAsset(op: any, currency: Currency): boolean {
  if (currency === "XLM") return op?.asset_type === "native";

  // USDC check
  const asset = getUsdcAsset();
  const code = (asset as any).code ?? config.stellar.usdcCode;
  const issuer = (asset as any).issuer ?? config.stellar.usdcIssuer;

  const opCode = op?.asset_code;
  const opIssuer = op?.asset_issuer;

  return safeLower(opCode) === safeLower(code) && safeLower(opIssuer) === safeLower(issuer);
}

export function createGatewayMiddleware(gatewayConfig: GatewayConfig) {
  // Default to XLM so the paid-HTTP loop is demoable without trustlines.
  // You can switch to USDC via per-route config (or by passing currency explicitly).
  const currency: Currency = gatewayConfig.currency ?? "XLM";
  const seller = gatewayConfig.sellerAddress;

  return {
    require: (price: string) => {
      const handler: RequestHandler = async (req, res, next) => {
        try {
          const txHash = (req.header("x402-tx-hash") || req.header("x-payment-tx-hash") || "").trim();
          if (!txHash) {
            return res.status(402).json({
              success: false,
              error: "Payment required",
              details: {
                header: "x402-tx-hash",
                seller,
                currency,
                amount: parseRequiredAmount(price, currency),
              },
            });
          }

          if (isTxSeen(txHash)) {
            return res.status(409).json({
              success: false,
              error: "Payment already used (replay detected)",
              txHash,
            });
          }

          const requiredAmount = parseRequiredAmount(price, currency);

          const tx = await horizonServer.transactions().transaction(txHash).call();
          if (!tx?.successful) {
            return res.status(402).json({
              success: false,
              error: "Transaction not successful",
              txHash,
            });
          }

          const paymentOp = await getPaymentOperationForTx(txHash);
          if (!paymentOp) {
            return res.status(402).json({
              success: false,
              error: "No payment operation found in transaction",
              txHash,
            });
          }

          // Destination must match seller
          if (safeLower(paymentOp.to) !== safeLower(seller)) {
            return res.status(402).json({
              success: false,
              error: "Payment destination mismatch",
              txHash,
              expectedSeller: seller,
              got: paymentOp.to,
            });
          }

          // Asset must match
          if (!opMatchesAsset(paymentOp, currency)) {
            return res.status(402).json({
              success: false,
              error: "Payment asset mismatch",
              txHash,
              expectedCurrency: currency,
              got: paymentOp.asset_type === "native" ? "XLM" : `${paymentOp.asset_code}:${paymentOp.asset_issuer}`,
            });
          }

          const paid = Number(paymentOp.amount);
          const required = Number(requiredAmount);
          if (!Number.isFinite(paid) || paid < required) {
            return res.status(402).json({
              success: false,
              error: "Insufficient payment amount",
              txHash,
              requiredAmount,
              paidAmount: paymentOp.amount,
              currency,
            });
          }

          const memo = typeof tx.memo === "string" ? tx.memo : undefined;
          if (gatewayConfig.requireMemoPrefix && memo && !memo.startsWith(gatewayConfig.requireMemoPrefix)) {
            return res.status(402).json({
              success: false,
              error: "Memo requirement not satisfied",
              txHash,
              requiredPrefix: gatewayConfig.requireMemoPrefix,
              memo,
            });
          }

          const payer = paymentOp.from || tx.source_account;

          const verified: X402VerifiedPayment = {
            currency,
            amount: paymentOp.amount,
            payer,
            seller,
            txHash,
            memo,
          };

          (req as any).payment = verified;
          rememberTx(txHash);
          next();
        } catch (e: any) {
          // If Horizon can't find the tx yet, treat as "payment pending"
          const status = e?.response?.status;
          if (status === 404) {
            return res.status(402).json({
              success: false,
              error: "Payment transaction not found (yet). Try again shortly.",
            });
          }

          return res.status(500).json({
            success: false,
            error: "Payment verification failed",
            details: e?.message || String(e),
          });
        }
      };

      return handler;
    },
  };
}

