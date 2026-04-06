import axios from "axios";
import { Horizon } from "@stellar/stellar-sdk";
import { horizonServer } from "./stellar.js";

/**
 * Stellar Analytics Service
 * Provides data for Stellar-specific sub-agents.
 */
export class StellarAnalyticsService {
    /**
     * Gets SDEX volume and top pairs
     */
    static async getSdexStats() {
        try {
            // Horizon provides trade aggregations
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - 86400;
            
            // In a real app, we'd query multiple pairs. For the hackathon, we'll return prominent SDEX stats.
            return {
                totalVolume24h: "$12.4M",
                topPairs: [
                    { pair: "XLM/USDC", volume24h: "$4.2M", price: "0.124 USDC" },
                    { pair: "yXLM/XLM", volume24h: "$2.1M", price: "1.024 XLM" },
                    { pair: "AQUA/XLM", volume24h: "$1.2M", price: "0.0042 XLM" }
                ],
                networkStatus: "Healthy",
                lastLedger: (await horizonServer.ledgers().limit(1).order("desc").call()).records[0].sequence
            };
        } catch (error) {
            console.error("Failed to fetch SDEX stats:", error);
            return null;
        }
    }

    /**
     * Gets yields from Stellar DeFi protocols (Blend, Aquarius, YieldBlox)
     */
    static async getStellarYields() {
        try {
            // Mocking high-quality data for the hackathon demo
            // In production, this would hit Blend/Aquarius APIs
            return [
                { 
                    protocol: "Blend", 
                    asset: "USDC", 
                    apy: "8.4%", 
                    tvl: "$45M", 
                    type: "Lending Market",
                    link: "https://blend.host"
                },
                { 
                    protocol: "Aquarius", 
                    asset: "XLM/USDC", 
                    apy: "24.1%", 
                    tvl: "$12M", 
                    type: "AMM/Rewards",
                    link: "https://aqua.network"
                },
                { 
                    protocol: "YieldBlox", 
                    asset: "XLM", 
                    apy: "4.2%", 
                    tvl: "$8M", 
                    type: "Lending",
                    link: "https://yieldblox.com"
                }
            ];
        } catch (error) {
            return null;
        }
    }

    /**
     * Gets detailed account info including trustlines and sponsor
     */
    static async getAccountDetails(publicKey: string) {
        try {
            const account = await horizonServer.loadAccount(publicKey);
            return {
                id: account.id,
                balances: account.balances.map(b => ({
                    asset: (b as any).asset_code || "XLM",
                    balance: b.balance,
                    limit: (b as any).limit
                })),
                subentryCount: account.subentry_count,
                sponsoredBy: (account as any).sponsor || "None"
            };
        } catch (error) {
            return null;
        }
    }
}
