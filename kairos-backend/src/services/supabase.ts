import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export interface ChatMessage {
    id: string;
    content: string;
    is_user: boolean;
    timestamp: string;
    escrow_id?: string;
    tx_hash?: string;
    tx_hashes?: Record<string, string>;
    image_preview?: string;
}

export interface ChatSession {
    id: string;
    wallet_address: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export function initSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
        console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
        return false;
    }

    supabase = createClient(url, key);
    console.log('[Supabase] Client initialized');
    return true;
}

export function getSupabase(): SupabaseClient | null {
    return supabase;
}

/**
 * 🛡️ Resilience Helper: Retry async functions with exponential backoff.
 * Mitigates [ConnectTimeoutError] and [UND_ERR_CONNECT_TIMEOUT].
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        if (retries > 0 && (error.message?.includes('timeout') || error.message?.includes('fetch failed'))) {
            console.warn(`[Supabase] 🔄 Connection failed, retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
}

// ============ Chat Sessions ============

export async function createChatSession(walletAddress: string, title: string = 'New Chat'): Promise<ChatSession | null> {
    if (!supabase) return null;

    return withRetry(async () => {
        const { data, error } = await supabase!
            .from('chat_sessions')
            .insert({
                wallet_address: walletAddress.toLowerCase(),
                title,
            })
            .select()
            .single();

        if (error) {
            console.error('[Supabase] Failed to create chat session:', error);
            return null;
        }

        return data;
    });
}

export async function getChatSessions(walletAddress: string): Promise<ChatSession[]> {
    if (!supabase) return [];

    return withRetry(async () => {
        const { data, error } = await supabase!
            .from('chat_sessions')
            .select('*')
            .eq('wallet_address', walletAddress.toLowerCase())
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('[Supabase] Failed to get chat sessions:', error);
            return [];
        }

        return data || [];
    });
}

export async function deleteChatSession(sessionId: string, walletAddress: string): Promise<boolean> {
    if (!supabase) return false;

    return withRetry(async () => {
        // Delete messages first
        await supabase!
            .from('chat_messages')
            .delete()
            .eq('session_id', sessionId);

        // Then delete session
        const { error } = await supabase!
            .from('chat_sessions')
            .delete()
            .eq('id', sessionId)
            .eq('wallet_address', walletAddress.toLowerCase());

        if (error) {
            console.error('[Supabase] Failed to delete chat session:', error);
            return false;
        }

        return true;
    });
}

// ============ Chat Messages ============

// If a session is created in-memory (Supabase unavailable / RLS / network),
// attempts to insert messages will violate FK constraints. Cache those failures
// to avoid spamming logs on every message.
const missingSessionIds = new Set<string>();

export function markChatSessionPresent(sessionId: string): void {
    missingSessionIds.delete(sessionId);
}

/**
 * Ensure a chat session row exists for a given id.
 * This fixes the "memory-only session id" FK problem by persisting the session lazily
 * when the first message arrives (server-side).
 */
export async function ensureChatSessionById(
    sessionId: string,
    walletAddress: string,
    title: string = 'New Chat'
): Promise<boolean> {
    if (!supabase) return false;
    if (!sessionId) return false;
    if (!walletAddress) return false;

    try {
        const { error } = await supabase
            .from('chat_sessions')
            .upsert(
                {
                    id: sessionId,
                    wallet_address: walletAddress.toLowerCase(),
                    title,
                    updated_at: new Date().toISOString(),
                } as any,
                { onConflict: 'id', ignoreDuplicates: true } as any
            );
        if (error) {
            console.error('[Supabase] ensureChatSessionById failed:', error);
            return false;
        }
        markChatSessionPresent(sessionId);
        return true;
    } catch (e: any) {
        console.error('[Supabase] ensureChatSessionById exception:', e?.message || e);
        return false;
    }
}

export async function saveMessage(
    sessionId: string,
    message: Pick<ChatMessage, 'id' | 'content' | 'is_user' | 'escrow_id' | 'tx_hash' | 'tx_hashes' | 'image_preview'>
): Promise<ChatMessage | null> {
    if (!supabase) return null;
    if (missingSessionIds.has(sessionId)) return null;

    const { data, error } = await supabase
        .from('chat_messages')
        .insert({
            session_id: sessionId,
            message_id: message.id,
            content: message.content,
            is_user: message.is_user,
            escrow_id: message.escrow_id,
            tx_hash: message.tx_hash,
            tx_hashes: message.tx_hashes,
            image_preview: message.image_preview,
        })
        .select()
        .single();

    if (error) {
        // FK violation means the session id doesn't exist in chat_sessions (often memory-only session).
        if ((error as any).code === '23503') {
            missingSessionIds.add(sessionId);
            return null;
        }
        console.error('[Supabase] Failed to save message:', error);
        return null;
    }

    // Update session's updated_at
    await supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', sessionId);

    // Update session title if it's the first user message
    if (message.is_user && message.content) {
        const title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
        await supabase
            .from('chat_sessions')
            .update({ title })
            .eq('id', sessionId)
            .eq('title', 'New Chat');
    }

    return data;
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Supabase] Failed to get messages:', error);
        return [];
    }

    return (data || []).map(m => ({
        id: m.message_id,
        content: m.content,
        is_user: m.is_user,
        timestamp: m.created_at,
        escrow_id: m.escrow_id,
        tx_hash: m.tx_hash,
        image_preview: m.image_preview,
    }));
}

export async function clearMessages(sessionId: string): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('session_id', sessionId);

    if (error) {
        console.error('[Supabase] Failed to clear messages:', error);
        return false;
    }

    return true;
}

// ============ Message Ratings ============

export interface MessageRating {
    message_id: string;
    user_address: string;
    is_positive: boolean;
}

export async function rateMessage(
    messageId: string,
    userAddress: string,
    isPositive: boolean,
    agentId?: string
): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('message_ratings')
        .upsert({
            message_id: messageId,
            user_address: userAddress.toLowerCase(),
            is_positive: isPositive,
            agent_id: agentId || null,
        }, {
            onConflict: 'message_id,user_address',
        });

    if (error) {
        console.error('[Supabase] Failed to rate message:', error);
        return false;
    }

    return true;
}


export async function getMessageRating(
    messageId: string,
    userAddress: string
): Promise<boolean | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('message_ratings')
        .select('is_positive')
        .eq('message_id', messageId)
        .eq('user_address', userAddress.toLowerCase())
        .single();

    if (error || !data) {
        return null; // Not rated yet
    }

    return data.is_positive;
}

export async function getAgentRating(): Promise<{ rating: number; totalRatings: number }> {
    if (!supabase) return { rating: 0, totalRatings: 0 };

    const { data, error } = await supabase
        .from('message_ratings')
        .select('is_positive');

    if (error || !data || data.length === 0) {
        return { rating: 0, totalRatings: 0 };
    }

    const positiveCount = data.filter(r => r.is_positive).length;
    const totalRatings = data.length;
    const rating = (positiveCount / totalRatings) * 5;

    return {
        rating: Math.round(rating * 10) / 10, // Round to 1 decimal
        totalRatings
    };
}

// ============ Query Logs (Response Time) ============

export async function logQueryTime(
    responseTimeMs: number,
    agentId?: string,
    txHash?: string,
    direction: 'credit' | 'debit' = 'credit',
    nominalUsd: number = 0.01,
    logicalId?: string,
): Promise<boolean> {
    if (!supabase) return false;

    const row: Record<string, unknown> = {
        response_time_ms: responseTimeMs,
        agent_id: agentId || null,
        tx_hash: txHash || null,
        direction,
        nominal_usd: nominalUsd,
    };
    if (logicalId) row.logical_id = logicalId;

    // Plain INSERT — PostgREST upsert on partial unique(logical_id) often fails silently in the wild.
    // Duplicate logical_id → 23505; treat as success (idempotent retries).
    const { error } = await supabase.from('query_logs').insert(row);

    if (error) {
        if ((error as { code?: string }).code === '23505') return true;
        console.error('[Supabase] Failed to log query time:', error);
        return false;
    }

    return true;
}

export async function getAverageResponseTime(agentId?: string): Promise<number> {
    if (!supabase) return 0;

    let query = supabase
        .from('query_logs')
        .select('response_time_ms')
        .order('created_at', { ascending: false })
        .limit(100);

    if (agentId) {
        query = query.eq('agent_id', agentId);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
        return 0;
    }

    const totalMs = data.reduce((sum, d) => sum + d.response_time_ms, 0);
    return Math.round(totalMs / data.length);
}

export async function getTotalUsageCount(agentId?: string): Promise<number> {
    if (!supabase) return 0;

    let query = supabase
        .from('query_logs')
        .select('*', { count: 'exact', head: true });

    if (agentId) {
        query = query.eq('agent_id', agentId);
    }

    const { count, error } = await query;

    if (error) {
        console.error('[Supabase] Failed to get usage count:', error);
        return 0;
    }

    return count || 0;
}

export interface RecentQuery {
    id: string;
    agentId: string;
    responseTimeMs: number;
    createdAt: string;
    txHash: string | null;
    direction?: 'credit' | 'debit';
    nominalUsd?: number;
    logicalId?: string;
}

export async function getRecentQueries(agentId: string, limit: number = 10): Promise<RecentQuery[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('query_logs')
        .select('id, logical_id, agent_id, response_time_ms, created_at, tx_hash, direction, nominal_usd')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error || !data) {
        console.error('[Supabase] Failed to get recent queries:', error);
        return [];
    }

    return data.map(q => ({
        id: q.id,
        logicalId: q.logical_id || undefined,
        agentId: q.agent_id,
        responseTimeMs: q.response_time_ms,
        createdAt: q.created_at,
        txHash: q.tx_hash || null,
        direction: (q.direction as 'credit' | 'debit') ?? 'credit',
        nominalUsd: q.nominal_usd ?? undefined,
    }));
}

/** logical_id values already stored for this agent (for merging in-memory telemetry). */
export async function getPersistedLogicalIdsForAgent(agentId: string): Promise<Set<string>> {
    if (!supabase) return new Set();
    try {
        const { data, error } = await withRetry(async () => {
            const r = await supabase!
                .from('query_logs')
                .select('logical_id')
                .eq('agent_id', agentId)
                .not('logical_id', 'is', null);
            if (r.error) throw r.error;
            return r;
        });
        if (error || !data) return new Set();
        return new Set(data.map((r: { logical_id: string | null }) => r.logical_id).filter((x): x is string => !!x));
    } catch {
        return new Set();
    }
}

/**
 * Returns the net treasury balance for an agent.
 * Credits (standard queries + A2A received) are added.
 * Debits (A2A payments sent) are subtracted.
 * Persisted in Supabase — survives server restarts.
 */
export async function getAgentTreasuryBalance(agentId: string): Promise<number> {
    if (!supabase) return 0;

    let data: { direction?: string | null; nominal_usd?: unknown }[] | null = null;
    let error: { message?: string; code?: string } | null = null;
    try {
        const r = await withRetry(async () => {
            const q = await supabase!
                .from('query_logs')
                .select('direction, nominal_usd')
                .eq('agent_id', agentId);
            if (q.error) throw q.error;
            return q;
        });
        data = r.data;
        error = r.error;
    } catch (e: any) {
        error = e;
    }

    if (error) {
        // Columns may not exist yet (migration pending) — fall back to count × rate
        if (error.message?.includes('does not exist')) {
            const { count } = await supabase
                .from('query_logs')
                .select('*', { count: 'exact', head: true })
                .eq('agent_id', agentId);
            return (count || 0) * 0.01;
        }
        console.warn('[Supabase] getAgentTreasuryBalance failed:', error.message || error);
        return 0;
    }

    if (!data) return 0;

    const rowAmt = (row: { nominal_usd?: unknown; direction?: string | null }) => {
        const raw = row.nominal_usd;
        const n = raw == null || raw === '' ? NaN : Number.parseFloat(String(raw));
        if (Number.isFinite(n) && n > 0) return n;
        const d = (row.direction || 'credit').toLowerCase();
        // Missing/zero amount: debits are always 0.005 A2A; credits default to standard 0.01
        return d === 'debit' ? 0.005 : 0.01;
    };

    return data.reduce((sum, row) => {
        const amt = rowAmt(row);
        const d = (row.direction || 'credit').toLowerCase();
        return d === 'debit' ? sum - amt : sum + amt;
    }, 0);
}

// Get the treasury earned in the last 24 hours to calculate trend
export async function getAgentTreasuryTrend(agentId?: string): Promise<number> {
    if (!supabase) return 0;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    let query = supabase
        .from('query_logs')
        .select('nominal_usd, direction')
        .gte('created_at', yesterday.toISOString());
        
    if (agentId) {
        query = query.eq('agent_id', agentId);
    }

    const { data, error } = await query;
    if (error || !data) return 0;

    const rowAmt = (row: { nominal_usd?: unknown; direction?: string | null }) => {
        const raw = row.nominal_usd;
        const n = raw == null || raw === '' ? NaN : Number.parseFloat(String(raw));
        if (Number.isFinite(n) && n > 0) return n;
        const d = (row.direction || 'credit').toLowerCase();
        return d === 'debit' ? 0.005 : 0.01;
    };

    return data.reduce((sum, row) => {
        const amt = rowAmt(row);
        const d = (row.direction || 'credit').toLowerCase();
        return d === 'debit' ? sum - amt : sum + amt;
    }, 0);
}

// Get stats for a single agent (optimized - no loop)
export async function getAgentStatsById(agentId: string): Promise<AgentStats | null> {
    const { rating, totalRatings } = await getAgentRatingById(agentId);
    const avgResponseTimeMs = await getAverageResponseTime(agentId);
    const usageCount = await getTotalUsageCount(agentId);

    return {
        agentId,
        rating,
        totalRatings,
        avgResponseTimeMs,
        usageCount
    };
}

// ============ Per-Agent Stats ============

export async function getAgentRatingById(agentId: string): Promise<{ rating: number; totalRatings: number }> {
    if (!supabase) return { rating: 0, totalRatings: 0 };

    const { data, error } = await supabase
        .from('message_ratings')
        .select('is_positive')
        .eq('agent_id', agentId);

    if (error || !data || data.length === 0) {
        return { rating: 0, totalRatings: 0 };
    }

    const positiveCount = data.filter(r => r.is_positive).length;
    const totalRatings = data.length;
    const rating = (positiveCount / totalRatings) * 5;

    return {
        rating: Math.round(rating * 10) / 10,
        totalRatings
    };
}

export interface AgentStats {
    agentId: string;
    rating: number;
    totalRatings: number;
    avgResponseTimeMs: number;
    usageCount: number;
}

export async function getAllAgentStats(): Promise<AgentStats[]> {
    if (!supabase) return [];

    const agents = ['oracle', 'news', 'yield', 'tokenomics', 'stellar-scout', 'perp', 'protocol', 'bridges', 'stellar-dex'];

    // Fetch all data in just 2 queries instead of 21
    const [queryLogsData, ratingsData] = await Promise.all([
        // Get all query logs grouped by agent_id
        supabase
            .from('query_logs')
            .select('agent_id, response_time_ms')
            .in('agent_id', agents),
        // Get all ratings grouped by agent_id
        supabase
            .from('message_ratings')
            .select('agent_id, is_positive')
            .in('agent_id', agents)
    ]);

    // Process query logs
    const queryLogsByAgent = new Map<string, number[]>();
    if (queryLogsData.data) {
        for (const log of queryLogsData.data) {
            const logs = queryLogsByAgent.get(log.agent_id) || [];
            logs.push(log.response_time_ms);
            queryLogsByAgent.set(log.agent_id, logs);
        }
    }

    // Process ratings
    const ratingsByAgent = new Map<string, { positive: number; total: number }>();
    if (ratingsData.data) {
        for (const rating of ratingsData.data) {
            const current = ratingsByAgent.get(rating.agent_id) || { positive: 0, total: 0 };
            current.total++;
            if (rating.is_positive) current.positive++;
            ratingsByAgent.set(rating.agent_id, current);
        }
    }

    // Build stats for each agent
    return agents.map(agentId => {
        const logs = queryLogsByAgent.get(agentId) || [];
        const ratings = ratingsByAgent.get(agentId) || { positive: 0, total: 0 };

        const avgResponseTimeMs = logs.length > 0
            ? Math.round(logs.reduce((a, b) => a + b, 0) / Math.min(logs.length, 100))
            : 0;
        const rating = ratings.total > 0
            ? Math.round((ratings.positive / ratings.total) * 5 * 10) / 10
            : 0;

        return {
            agentId,
            rating,
            totalRatings: ratings.total,
            avgResponseTimeMs,
            usageCount: logs.length
        };
    });
}

