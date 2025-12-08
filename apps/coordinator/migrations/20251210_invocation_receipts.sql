-- Invocation correlation for receipts
alter table task_receipts
  add column if not exists invocation_id uuid;

create index if not exists task_receipts_invocation_idx
  on task_receipts(invocation_id);

