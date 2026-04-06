-- Tenant collection configuration — operational constraints and strategy.
-- Stored alongside objectives in tenant_objectives.collection_config JSONB.
--
-- Example config:
-- {
--   "strategy": "balanced",               -- aggressive | balanced | relationship_first
--   "maxContactsPerDayPerCustomer": 1,
--   "maxContactsPerWeekPerCustomer": 3,
--   "businessHoursStart": 9,
--   "businessHoursEnd": 17,
--   "businessTimezone": "America/New_York",
--   "cooldownHoursAfterContact": 72,
--   "escalationThresholdCents": 500000,    -- escalate to human above this
--   "escalationThresholdDaysOverdue": 30,
--   "writeOffThresholdDays": 90,
--   "shadowModeEnabled": true
-- }

ALTER TABLE tenant_objectives
ADD COLUMN IF NOT EXISTS collection_config JSONB NOT NULL DEFAULT '{}';
