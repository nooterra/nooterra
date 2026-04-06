-- Add constraint_config column to tenant_objectives for per-tenant policy thresholds
ALTER TABLE tenant_objectives
ADD COLUMN IF NOT EXISTS constraint_config JSONB DEFAULT '{}';
