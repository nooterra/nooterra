-- Add chain config to workers for execution chaining (multi-step workflows).
-- chain JSONB: { "onComplete": "worker_id", "passResult": true }

ALTER TABLE workers ADD COLUMN IF NOT EXISTS chain JSONB;
