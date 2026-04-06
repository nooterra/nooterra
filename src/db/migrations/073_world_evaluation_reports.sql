CREATE TABLE IF NOT EXISTS world_evaluation_reports (
  report_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  schema_version TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, report_type, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_world_evaluation_reports_tenant
  ON world_evaluation_reports (tenant_id, report_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_world_evaluation_reports_subject
  ON world_evaluation_reports (tenant_id, subject_type, subject_id, created_at DESC);
