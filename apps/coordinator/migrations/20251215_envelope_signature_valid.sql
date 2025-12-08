-- Track whether agent result envelope signatures are valid (soft check)

alter table task_receipts
  add column if not exists envelope_signature_valid boolean;

