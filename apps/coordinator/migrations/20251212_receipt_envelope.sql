-- Persist agent result envelopes on receipts
alter table task_receipts
  add column if not exists result_envelope jsonb;

