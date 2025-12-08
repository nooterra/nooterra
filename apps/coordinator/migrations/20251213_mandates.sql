-- Mandate linking (v0.1)

alter table workflows
  add column if not exists mandate_id uuid;

alter table invocations
  add column if not exists mandate_id uuid;

alter table task_receipts
  add column if not exists mandate_id uuid;

create index if not exists task_receipts_mandate_idx
  on task_receipts(mandate_id);

