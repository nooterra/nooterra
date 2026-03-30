-- Complete RLS coverage for all remaining tenant-scoped tables.
-- Migration 037 covered: jobs, job_events, contracts, deliveries, outbox,
-- auth_keys, signer_keys, agents, sessions, session_events, workers,
-- worker_executions, worker_memory, worker_approvals, tenant_credits.
--
-- This migration adds RLS to every other tenant-scoped table to ensure
-- full defense-in-depth multi-tenant isolation.

-- -------------------------------------------------------------------------
-- Enable RLS
-- -------------------------------------------------------------------------

ALTER TABLE agent_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billable_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_compilations_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_signatures_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE correlations ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_account_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_rfq_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_rail_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_rail_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_event_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_billing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settlement_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- Create tenant isolation policies
-- -------------------------------------------------------------------------

CREATE POLICY tenant_isolation_agent_identities ON agent_identities
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_agent_run_settlements ON agent_run_settlements
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_agent_wallets ON agent_wallets
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_artifacts ON artifacts
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_billable_usage_events ON billable_usage_events
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_contract_compilations_v2 ON contract_compilations_v2
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_contract_signatures_v2 ON contract_signatures_v2
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_contracts_v2 ON contracts_v2
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_correlations ON correlations
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_credit_transactions ON credit_transactions
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_delivery_receipts ON delivery_receipts
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_finance_account_maps ON finance_account_maps
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_ingest_records ON ingest_records
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_ledger_allocations ON ledger_allocations
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_marketplace_rfq_bids ON marketplace_rfq_bids
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_marketplace_rfqs ON marketplace_rfqs
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_money_rail_operations ON money_rail_operations
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_money_rail_provider_events ON money_rail_provider_events
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_ops_audit ON ops_audit
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_parties ON parties
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_party_statements ON party_statements
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_reputation_event_index ON reputation_event_index
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_tenant_billing_config ON tenant_billing_config
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_tenant_integrations ON tenant_integrations
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_tenant_settlement_policies ON tenant_settlement_policies
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_events ON events
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_snapshots ON snapshots
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_idempotency ON idempotency
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_ledger_entries ON ledger_entries
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_ledger_balances ON ledger_balances
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_worker_files ON worker_files
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));

CREATE POLICY tenant_isolation_scheduled_reports ON scheduled_reports
  USING (tenant_id = current_setting('nooterra.current_tenant_id', true));
