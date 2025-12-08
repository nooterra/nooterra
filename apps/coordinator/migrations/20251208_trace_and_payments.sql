-- Payments rail hardening
alter table payment_transactions add column if not exists provider_event_id text;
alter table payment_transactions add column if not exists provider_ref text;
create unique index if not exists payment_provider_event_idx on payment_transactions(provider_event_id) where provider_event_id is not null;

-- Trace propagation
alter table workflows add column if not exists trace_id text;
alter table task_nodes add column if not exists trace_id text;
alter table task_receipts add column if not exists trace_id text;
alter table ledger_events add column if not exists trace_id text;
alter table dispatch_queue add column if not exists trace_id text;
