/**
 * News Scout Service - Crypto News Aggregation
 * UPGRADED: Now fetches REAL on-chain activity from Stellar Horizon.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { horizonServer } from './stellar.js';

export interface NewsArticle {
    title: string;
    link: string;
    description: string;
    pubDate: string;
    source: string;
    sourceKey?: string;
    category?: string;
    timeAgo: string;
}

export interface NewsResponse {
    articles: NewsArticle[];
    totalCount: number;
    sources: string[];
    fetchedAt: string;
}

export interface TrendingResult {
    timestamp: string;
    trade_count: number;
    base_volume: string;
    counter_volume: string;
    avg: string;
    high: string;
    low: string;
    open: string;
    close: string;
}

/**
 * Fetch latest network activity from Horizon as "Real News"
 */
export async function getLatestNews(limit: number = 10): Promise<NewsResponse | null> {
    try {
        console.log(`[News Scout] Fetching latest ${limit} network operations from Horizon...`);
        
        // Fetch recent operations across the whole network
        const ops = await horizonServer.operations()
            .limit(limit)
            .order("desc")
            .call();

        const articles: NewsArticle[] = ops.records.map(op => {
            const type = op.type.replace(/_/g, ' ').toUpperCase();
            const time = new Date(op.created_at);
            
            return {
                title: `[Stellar Pulse] ${type} detected`,
                description: `Operation #${op.id} was processed on the Stellar network. Source: ${op.source_account.slice(0, 8)}...`,
                link: `https://stellar.expert/explorer/testnet/op/${op.id}`,
                pubDate: op.created_at,
                source: "Stellar Horizon",
                timeAgo: formatTimeAgo(time)
            };
        });

        return {
            articles,
            totalCount: articles.length,
            sources: ["Stellar Ledger"],
            fetchedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("[News Scout] Error fetching on-chain activity:", error);
        return null;
    }
}

function formatTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * Search news - mapped to account activity search
 */
export async function searchNews(query: string, limit: number = 10): Promise<NewsResponse | null> {
    // If user provides a G... address, search their activity
    if (query.startsWith('G') && query.length === 56) {
        try {
            const ops = await horizonServer.operations()
                .forAccount(query)
                .limit(limit)
                .order("desc")
                .call();

            const articles: NewsArticle[] = ops.records.map(op => ({
                title: `Account Activity: ${op.type.toUpperCase()}`,
                description: `Processed operation on account ${query.slice(0, 8)}...`,
                link: `https://stellar.expert/explorer/testnet/op/${op.id}`,
                pubDate: op.created_at,
                source: "Stellar Ledger",
                timeAgo: formatTimeAgo(new Date(op.created_at))
            }));

            return {
                articles,
                totalCount: articles.length,
                sources: ["Stellar Ledger"],
                fetchedAt: new Date().toISOString()
            };
        } catch {
            return getLatestNews(limit);
        }
    }
    return getLatestNews(limit);
}

/**
 * Get DeFi News - mapped to SDEX trades
 */
export async function getDefiNews(limit: number = 10): Promise<NewsResponse | null> {
    try {
        const trades = await horizonServer.trades()
            .limit(limit)
            .order("desc")
            .call();

        const articles: NewsArticle[] = trades.records.map(trade => ({
            title: `DeFi Pulse: Asset Trade Detected`,
            description: `A trade occurred between ${trade.base_asset_code || 'XLM'} and ${trade.counter_asset_code || 'XLM'}.`,
            link: `https://stellar.expert/explorer/testnet/tx/${trade.ledger_close_time}`,
            pubDate: trade.ledger_close_time,
            source: "SDEX",
            timeAgo: formatTimeAgo(new Date(trade.ledger_close_time))
        }));

        return {
            articles,
            totalCount: articles.length,
            sources: ["Stellar SDEX"],
            fetchedAt: new Date().toISOString()
        };
    } catch {
        return getLatestNews(limit);
    }
}

/**
 * Get breaking news - mapped to latest network transactions
 */
export async function getBreakingNews(): Promise<NewsResponse | null> {
    return getLatestNews(5);
}

/**
 * Get Bitcoin News - fallback to latest news
 */
export async function getBitcoinNews(): Promise<NewsResponse | null> {
    return getLatestNews(5);
}

/**
 * Get Trending Topics - Mapped to high-volume asset pairs
 */
export async function getTrendingTopics(): Promise<TrendingResult | null> {
    try {
        const stats = await (horizonServer as any).tradeAggregation(
            new (StellarSdk as any).Asset.native(),
            new (StellarSdk as any).Asset("USDC", "GBBD47IF6LWNC76YUOOWDQUV6SBCSYOTZLHXWNIY6S77AZEGTXCOFOYJ"),
            Math.floor(Date.now() / 1000) - 86400,
            Math.floor(Date.now() / 1000),
            3600 * 1000
        ).limit(1).order("desc").call();

        return stats.records[0] || null;
    } catch {
        return null;
    }
}

/**
 * Format News Response for display
 */
export function formatNewsResponse(news: NewsResponse): string {
    const lines: string[] = [];
    lines.push("### ⛓️ Pulse of the Network (Real-Time Horizon Events)");
    lines.push("");

    for (const article of news.articles.slice(0, 10)) {
        lines.push(`• **${article.title}**`);
        lines.push(`  ${article.description}`);
        const link = article.link.includes('op/') ? article.link : article.link;
        lines.push(`  🔗 [Verify on StellarExpert](${link})`);
        lines.push("");
    }

    lines.push("");
    lines.push(`_Live ledger data synchronized at ${new Date(news.fetchedAt).toLocaleTimeString()}_`);
    return lines.join("\n");
}

/**
 * Legacy Format function for trending topics
 */
export function formatTrendingTopics(trending: any): string {
    if (!trending) return "No trending network activity detected in the last hour.";
    return `📈 **Trending Pair:** XLM/USDC\n• 24h Volume: ~${trending.base_volume} XLM\n• Trades: ${trending.trade_count}\n• Average Price: ${trending.avg} USDC`;
}
