import * as StellarSdk from "@stellar/stellar-sdk";

async function generate() {
    try {
        const pair = StellarSdk.Keypair.random();
        const publicKey = pair.publicKey();
        const secretKey = pair.secret();

        console.log("--- 🏦 NEW KAIROS TREASURY WALLET ---");
        console.log(`PUBLIC_KEY: ${publicKey}`);
        console.log(`SECRET_KEY: ${secretKey}`);
        console.log("---------------------------------------");

        console.log("🌊 Funding via Stellar Friendbot...");
        const response = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
        
        if (response.ok) {
            console.log("✅ Wallet funded with 10,000 Testnet XLM!");
            console.log("\nCopy the SECRET_KEY above to your .env file.");
        } else {
            const err = await response.text();
            console.error("❌ Friendbot funding failed:", err);
            console.log("Please fund manually at: https://laboratory.stellar.org/#account-creator?addr=" + publicKey);
        }
    } catch (error) {
        console.error("❌ Generation error:", error);
    }
}

generate();
