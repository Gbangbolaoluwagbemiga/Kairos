ALTER TABLE query_logs
    ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'credit',
    ADD COLUMN IF NOT EXISTS nominal_usd NUMERIC(12, 7) DEFAULT 0.0100000;

UPDATE query_logs SET direction = 'credit', nominal_usd = 0.0100000 WHERE direction IS NULL;

CREATE INDEX IF NOT EXISTS idx_query_logs_direction ON query_logs(agent_id, direction);