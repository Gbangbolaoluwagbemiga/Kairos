-- ============================================================
-- Kairos — Supabase Database Schema
-- Run once in Supabase SQL Editor to initialize all tables.
-- ============================================================

-- Chat Sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    title TEXT DEFAULT 'New Chat',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_wallet ON chat_sessions(wallet_address);

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    content TEXT NOT NULL,
    is_user BOOLEAN DEFAULT true,
    escrow_id TEXT,
    tx_hash TEXT,
    tx_hashes JSONB DEFAULT '{}'::jsonb,
    image_preview TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

-- Message Ratings (thumbs up/down → agent reputation)
CREATE TABLE IF NOT EXISTS message_ratings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    message_id TEXT NOT NULL,
    user_address TEXT NOT NULL,
    is_positive BOOLEAN NOT NULL,
    agent_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(message_id, user_address)
);

CREATE INDEX IF NOT EXISTS idx_message_ratings_agent ON message_ratings(agent_id);

-- Query Logs (agent response times, usage counts, A2A payments)
CREATE TABLE IF NOT EXISTS query_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- Logical dedup key (requestId or requestId-a2a-in/out-agentId). Prevents double-inserts.
    logical_id TEXT UNIQUE,
    agent_id TEXT,
    response_time_ms INTEGER,
    tx_hash TEXT,
    -- 'credit' = payment received (treasury→agent or A2A→agent)
    -- 'debit'  = payment sent (agent→sub-agent A2A)
    direction TEXT DEFAULT 'credit',
    -- Actual USDC amount for this entry (0.01 for standard, 0.005 for A2A)
    nominal_usd NUMERIC(12, 7) DEFAULT 0.0100000,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_logs_agent ON query_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_query_logs_direction ON query_logs(agent_id, direction);

-- Row Level Security
ALTER TABLE chat_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_ratings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_logs       ENABLE ROW LEVEL SECURITY;

-- Open policies (anon key access — tighten for mainnet)
CREATE POLICY "allow_all_chat_sessions"   ON chat_sessions   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_chat_messages"   ON chat_messages   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_message_ratings" ON message_ratings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_query_logs"      ON query_logs      FOR ALL USING (true) WITH CHECK (true);
