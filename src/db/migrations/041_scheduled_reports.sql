-- Scheduled daily reports
CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  report_date DATE NOT NULL,
  summary TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_tenant ON scheduled_reports(tenant_id, report_date DESC);
