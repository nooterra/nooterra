-- Canonical invocation storage
create table if not exists invocations (
  invocation_id uuid primary key,
  trace_id text not null,
  workflow_id uuid references workflows(id) on delete cascade,
  node_name text not null,
  capability_id text not null,
  agent_did text,
  payer_did text,
  constraints jsonb,
  input jsonb,
  created_at timestamptz default now()
);

create index if not exists invocations_trace_idx on invocations(trace_id);
create index if not exists invocations_workflow_idx on invocations(workflow_id);
create index if not exists invocations_agent_idx on invocations(agent_did);

