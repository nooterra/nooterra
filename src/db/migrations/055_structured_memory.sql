-- Evolve worker_memory from flat k/v to structured memory with types and metadata.
-- Backward compatible — existing rows get defaults.

ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'semantic';
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE worker_memory ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_worker_memory_type ON worker_memory (worker_id, memory_type);
