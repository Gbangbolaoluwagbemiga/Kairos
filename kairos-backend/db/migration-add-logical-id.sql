-- Add logical_id for deduplication (prevents double-inserts from retries/races)
ALTER TABLE query_logs ADD COLUMN IF NOT EXISTS logical_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_query_logs_logical_id ON query_logs(logical_id) WHERE logical_id IS NOT NULL;
