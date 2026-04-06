import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config.js";

const { stellar } = config;

// Horizon Server (Public API)
export const horizonServer = new StellarSdk.Horizon.Server(stellar.horizonUrl);

/**
 * Submit a signed tx; if Horizon returns "submission timed out" it may still land on-ledger.
 * Poll GET /transactions/{hash} using extras.hash when present.
 */
export async function submitTransactionWithTimeoutRecovery(
    transaction: StellarSdk.Transaction
): Promise<{ hash: string }> {
    try {
        const result = await horizonServer.submitTransaction(transaction);
        return { hash: result.hash };
    } catch (e: any) {
        const data = e?.response?.data;
        const hash = data?.extras?.hash as string | undefined;
        const detail = String(data?.detail || e?.message || "");
        const submitTimedOut =
            /timed out|timeout|submission request has timed out/i.test(detail) ||
            /timed out|timeout/i.test(String(e?.message || ""));

        if (hash && submitTimedOut) {
            console.warn(`[Stellar] Submit response timed out; polling ledger for ${hash.slice(0, 10)}…`);
            for (let i = 0; i < 35; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                try {
                    const tx = await horizonServer.transactions().transaction(hash).call();
                    if ((tx as any).successful !== false) {
                        return { hash };
                    }
                } catch {
                    /* not visible yet */
                }
            }
            console.warn(`[Stellar] Poll exhausted for ${hash}; tx may still confirm later`);
        }
        throw e;
    }
}

// Soroban RPC Server (Smart Contracts)
export const sorobanServer = new StellarSdk.rpc.Server(stellar.rpcUrl);

// Network Passphrase
export const networkPassphrase = stellar.network === "public" 
    ? StellarSdk.Networks.PUBLIC 
    : StellarSdk.Networks.TESTNET;

/**
 * Sponsored Account Service
 * Provides "Gasless" onboarding by creating or funding accounts for new users.
 */
export class StellarSponsorshipService {
    private static sponsorKeypair: StellarSdk.Keypair | null = null;

    private static getSponsorKey(): StellarSdk.Keypair {
        if (!this.sponsorKeypair) {
            if (!stellar.sponsorSecret) {
                console.warn("⚠️ STELLAR_SPONSOR_SECRET is missing. Sponsorship will be disabled.");
                throw new Error("Sponsorship secret not configured");
            }
            this.sponsorKeypair = StellarSdk.Keypair.fromSecret(stellar.sponsorSecret);
        }
        return this.sponsorKeypair;
    }

    /**
     * Sponsers a new account on Stellar Testnet.
     * This creates the account with the minimum reserve (0.5 XLM + extra for fees).
     */
    static async sponsorAccount(userPublicKey: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            const sponsor = this.getSponsorKey();
            
            // Check if account already exists
            let accountExists = false;
            try {
                await horizonServer.loadAccount(userPublicKey);
                accountExists = true;
            } catch (e) {
                accountExists = false;
            }

            if (accountExists) {
                return { success: true, error: "Account already exists" };
            }

            console.log(`🚀 Sponsoring new Kairos account: ${userPublicKey}`);

            // Load sponsor account
            const sponsorAccount = await horizonServer.loadAccount(sponsor.publicKey());

            // Build Transaction: Create Account
            const transaction = new StellarSdk.TransactionBuilder(sponsorAccount, {
                fee: StellarSdk.BASE_FEE,
                networkPassphrase,
            })
            .addOperation(StellarSdk.Operation.createAccount({
                destination: userPublicKey,
                startingBalance: "2.0", // 0.5 (reserve) + extra for trustlines/fees
            }))
            .setTimeout(30)
            .build();

            // Sign and submit
            transaction.sign(sponsor);
            const result = await horizonServer.submitTransaction(transaction);
            
            return { success: true, txHash: result.hash };

        } catch (error: any) {
            console.error("❌ Sponsorship failed:", error?.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Checks balance of an account
     */
    static async getUSDCBalance(publicKey: string): Promise<string> {
        try {
            const account = await horizonServer.loadAccount(publicKey);
            // Primary: configured USDC issuer (Circle or env-configured issuer)
            let usdcBalance = account.balances.find(
                (b: any) => b.asset_code === stellar.usdcCode && b.asset_issuer === stellar.usdcIssuer
            );

            // Fallback for hackathon demo faucet: treasury-issued "USDC" asset
            if (!usdcBalance && stellar.sponsorSecret?.startsWith("S")) {
                try {
                    const demoIssuer = this.getSponsorKey().publicKey();
                    usdcBalance = account.balances.find(
                        (b: any) => b.asset_code === stellar.usdcCode && b.asset_issuer === demoIssuer
                    );
                } catch {
                    // ignore and return default
                }
            }

            return usdcBalance?.balance || "0.0000000";
        } catch (e) {
            return "0.0000000";
        }
    }
}
