-- Payments rail hardening
alter table if not exists payment_transactions add column if not exists provider_event_id text;
alter table if not exists payment_transactions add column if not exists provider_ref text;
create unique index if not exists payment_provider_event_idx on payment_transactions(provider_event_id) where provider_event_id is not null;

-- Trace propagation
alter table if not exists workflows add column if not exists trace_id text;
alter table if not exists task_nodes add column if not exists trace_id text;
alter table if not exists task_receipts add column if not exists trace_id text;
alter table if not exists ledger_events add column if not exists trace_id text;
alter table if not exists dispatch_queue add column if not exists trace_id text;
