-- Mandate constraint fields on workflows (v0.1)

alter table workflows
  add column if not exists mandate_policy_ids text[],
  add column if not exists mandate_regions_allow text[],
  add column if not exists mandate_regions_deny text[];

