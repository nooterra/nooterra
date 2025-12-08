import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || "postgres://postgres:postgres@localhost:5432/nooterra",
});

export async function migrate() {
  await pool.query(`
    create table if not exists users (
      id serial primary key,
      email text not null unique,
      password_hash text not null,
      created_at timestamptz default now()
    );
  `);

  // OAuth columns
  await pool.query(`alter table users add column if not exists google_id text unique;`);
  await pool.query(`alter table users add column if not exists name text;`);
  await pool.query(`alter table users add column if not exists avatar_url text;`);
  await pool.query(`alter table users add column if not exists role text default 'user';`);
  await pool.query(`create index if not exists ix_users_google_id on users(google_id) where google_id is not null;`);

  await pool.query(`
    create table if not exists projects (
      id serial primary key,
      owner_user_id int references users(id) on delete cascade,
      name text not null,
      payer_did text not null,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists api_keys (
      id serial primary key,
      project_id int references projects(id) on delete cascade,
      key_hash text not null unique,
      label text,
      scopes text[],
      created_at timestamptz default now(),
      revoked_at timestamptz
    );
  `);

  // Refresh tokens for secure session management
  await pool.query(`
    create table if not exists refresh_tokens (
      id serial primary key,
      user_id int references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists ix_refresh_tokens_user on refresh_tokens(user_id);`);
  await pool.query(`create index if not exists ix_refresh_tokens_hash on refresh_tokens(token_hash);`);

  await pool.query(`
    create table if not exists policies (
      project_id int primary key references projects(id) on delete cascade,
      rules jsonb not null,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists tasks (
      id uuid primary key,
      requester_did text,
      description text not null,
      requirements jsonb,
      budget numeric,
      deadline timestamptz,
      status text default 'open',
      winner_did text,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists workflows (
      id uuid primary key,
      task_id uuid references tasks(id) on delete cascade,
      intent text,
      status text default 'pending',
      payer_did text default 'did:noot:system',
      max_cents bigint,
      spent_cents bigint default 0,
      parent_workflow_id uuid references workflows(id),
      spawned_from_node text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
  await pool.query(`alter table workflows add column if not exists payer_did text default 'did:noot:system';`);
  await pool.query(`alter table workflows add column if not exists max_cents bigint;`);
  await pool.query(`alter table workflows add column if not exists spent_cents bigint default 0;`);
  await pool.query(`alter table workflows add column if not exists parent_workflow_id uuid references workflows(id);`);
  await pool.query(`alter table workflows add column if not exists spawned_from_node text;`);

  await pool.query(`
    create table if not exists task_nodes (
      id uuid primary key,
      workflow_id uuid references workflows(id) on delete cascade,
      name text not null,
      capability_id text not null,
      agent_did text,
      allowed_agents text[],
      status text default 'pending',
      depends_on text[] default '{}',
      payload jsonb,
      result_hash text,
      result_payload jsonb,
      result_id uuid,
      attempts int default 0,
      max_attempts int default 3,
      deadline_at timestamptz,
      started_at timestamptz,
      finished_at timestamptz,
      requires_verification boolean default false,
      requires_human boolean default false,
      consensus_total int,
      consensus_quorum int,
      consensus_status text,
      child_workflow_id uuid,
      verification_status text,
      verified_by text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
  await pool.query(`create unique index if not exists ix_task_nodes_result_id on task_nodes(result_id) where result_id is not null;`);
  await pool.query(`alter table task_nodes add column if not exists deadline_at timestamptz;`);
  await pool.query(`alter table task_nodes add column if not exists target_agent_id text;`);
  await pool.query(`alter table task_nodes add column if not exists allow_broadcast_fallback boolean default false;`);
  await pool.query(`alter table task_nodes add column if not exists requires_human boolean default false;`);
  await pool.query(`alter table task_nodes add column if not exists allowed_agents text[];`);
  await pool.query(`alter table task_nodes add column if not exists consensus_total int;`);
  await pool.query(`alter table task_nodes add column if not exists consensus_quorum int;`);
  await pool.query(`alter table task_nodes add column if not exists consensus_status text;`);
  await pool.query(`alter table task_nodes add column if not exists child_workflow_id uuid;`);

  await pool.query(`
    create table if not exists bids (
      id serial primary key,
      task_id uuid references tasks(id) on delete cascade,
      agent_did text not null,
      amount numeric,
      eta_ms int,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`alter table bids add column if not exists sla_hints jsonb;`);
  await pool.query(`alter table bids add column if not exists safety_class text;`);
  await pool.query(`alter table bids add column if not exists status text default 'pending';`);
  await pool.query(`alter table bids add column if not exists proposal jsonb;`);

  // Simple ledger: accounts + events
  await pool.query(`
    create table if not exists ledger_accounts (
      id serial primary key,
      owner_did text not null unique,
      balance numeric not null default 0,
      currency text default 'NCR',
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists ledger_events (
      id serial primary key,
      account_id int references ledger_accounts(id) on delete cascade,
      workflow_id uuid,
      node_name text,
      delta numeric not null,
      reason text,
      meta jsonb,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists ledger_escrow (
      id serial primary key,
      account_did text not null,
      workflow_id uuid,
      node_name text,
      amount numeric not null,
      status text default 'held',
      reason text,
      created_at timestamptz default now(),
      resolved_at timestamptz
    );
  `);
  await pool.query(`create index if not exists ledger_escrow_workflow_idx on ledger_escrow(workflow_id, node_name);`);

  await pool.query(`
    create table if not exists feedback (
      id serial primary key,
      task_id uuid,
      agent_did text,
      from_did text,
      to_did text,
      workflow_id uuid,
      node_name text,
      rating numeric check (rating >= 0 and rating <= 1),
      quality numeric,
      latency numeric,
      reliability numeric,
      comment text,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`alter table feedback add column if not exists from_did text;`);
  await pool.query(`alter table feedback add column if not exists to_did text;`);
  await pool.query(`alter table feedback add column if not exists workflow_id uuid;`);
  await pool.query(`alter table feedback add column if not exists node_name text;`);
  await pool.query(`alter table feedback add column if not exists quality numeric;`);
  await pool.query(`alter table feedback add column if not exists latency numeric;`);
  await pool.query(`alter table feedback add column if not exists reliability numeric;`);

  await pool.query(`create index if not exists feedback_task_idx on feedback(task_id);`);

  await pool.query(`
    create table if not exists webhooks (
      id serial primary key,
      task_id uuid,
      target_url text not null,
      event text not null,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create index if not exists bids_task_idx on bids(task_id);
  `);

  await pool.query(`
    create table if not exists node_result_shares (
      id serial primary key,
      workflow_id uuid not null,
      node_name text not null,
      agent_did text,
      result_hash text,
      result_payload jsonb,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists node_result_shares_idx on node_result_shares(workflow_id, node_name);`);

  await pool.query(`
    create table if not exists heartbeats (
      agent_did text primary key,
      last_seen timestamptz not null default now(),
      load numeric default 0,
      latency_ms int default 0,
      queue_depth int default 0,
      availability_score numeric default 1,
      updated_at timestamptz default now(),
      last_heartbeat timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists heartbeats_agent_idx on heartbeats(agent_did);`);
  await pool.query(`alter table agents add column if not exists health_status text;`);
  await pool.query(`alter table agents add column if not exists is_active boolean default true;`);
  await pool.query(`alter table agents add column if not exists last_heartbeat timestamptz default now();`);

  await pool.query(`
    create table if not exists dlq (
      id serial primary key,
      task_id uuid,
      target_url text,
      event text,
      payload jsonb,
      attempts int,
      last_error text,
      created_at timestamptz default now()
    );
  `);

  // Budget reservation tracking (dispatch queue safety)
  await pool.query(`
    create table if not exists budget_reservations (
      id serial primary key,
      workflow_id uuid not null,
      node_name text not null,
      capability_id text not null,
      amount_cents bigint not null,
      payer_did text not null,
      status text default 'reserved',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
  await pool.query(
    `create unique index if not exists budget_reservations_wf_node_idx on budget_reservations(workflow_id, node_name)`
  );

  // Fault traces (best-effort logging of failed nodes)
  await pool.query(`
    create table if not exists fault_traces (
      id serial primary key,
      workflow_id uuid not null,
      node_name text not null,
      fault_type text not null,
      fault_detail jsonb,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists fault_traces_wf_idx on fault_traces(workflow_id);`);

  await pool.query(`
    create table if not exists dispatch_queue (
      id serial primary key,
      task_id uuid,
      workflow_id uuid,
      node_id text,
      dispatch_key text,
      event text not null,
      target_url text not null,
      payload jsonb,
      attempts int default 0,
      next_attempt timestamptz default now(),
      status text default 'pending',
      trace_id text,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`alter table dispatch_queue add column if not exists last_error text;`);
  await pool.query(`alter table dispatch_queue add column if not exists trace_id text;`);
  // ensure unique constraint for ON CONFLICT (dispatch_key)
  await pool.query(`do $$
  begin
    if exists(select 1 from pg_indexes where schemaname='public' and indexname='ix_dispatch_queue_dispatch_key') then
      execute 'drop index if exists ix_dispatch_queue_dispatch_key';
    end if;
  end$$;`);
  await pool.query(
    `create unique index if not exists ix_dispatch_queue_dispatch_key on dispatch_queue(dispatch_key);`
  );

  await pool.query(`
    create table if not exists task_results (
      id serial primary key,
      task_id uuid references tasks(id) on delete cascade,
      result jsonb,
      error text,
      metrics jsonb,
      hash text,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists agent_stats (
      agent_did text primary key,
      tasks_success int not null default 0,
      tasks_failed int not null default 0,
      avg_latency_ms double precision not null default 0,
      last_updated_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists agent_reputation (
      agent_did text primary key,
      reputation double precision not null default 0,
      last_updated_at timestamptz not null default now()
    );
  `);

  // optional price for capabilities (populated by registry; safe to add here)
  await pool.query(`alter table if exists capabilities add column if not exists price_cents int default 0;`);

  // Add unique constraint for capabilities upsert
  await pool.query(`
    do $$ begin
      if not exists (
        select 1 from pg_constraint where conname = 'capabilities_agent_did_capability_id_key'
      ) then
        alter table capabilities add constraint capabilities_agent_did_capability_id_key unique (agent_did, capability_id);
      end if;
    end $$;
  `);

  await pool.query(`
    create table if not exists agent_endorsements (
      id serial primary key,
      from_did text not null,
      to_did text not null,
      weight numeric default 1,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists agent_endorsements_from_idx on agent_endorsements(from_did);`);
  await pool.query(`create index if not exists agent_endorsements_to_idx on agent_endorsements(to_did);`);

  // agents table lives in the same DB (populated by registry); add reputation column if missing
  await pool.query(`alter table if exists agents add column if not exists reputation double precision default 0;`);

  // Platform features for frontend
  await pool.query(`alter table users add column if not exists role text default 'user';`);
  await pool.query(`alter table users add column if not exists name text;`);
  await pool.query(`alter table users add column if not exists avatar_url text;`);
  await pool.query(`alter table users add column if not exists hf_token text;`);
  await pool.query(`alter table users add column if not exists stripe_customer_id text;`);

  // Web3 wallet support
  await pool.query(`alter table users add column if not exists wallet_address text;`);
  await pool.query(`alter table users add column if not exists preferred_chain_id int default 137;`); // Polygon by default
  await pool.query(`create unique index if not exists users_wallet_address_idx on users(wallet_address) where wallet_address is not null;`);

  // Make email optional for wallet users
  await pool.query(`alter table users alter column email drop not null;`).catch(() => { });
  await pool.query(`alter table users alter column password_hash drop not null;`).catch(() => { });

  // Conversations
  await pool.query(`
    create table if not exists conversations (
      id uuid primary key default gen_random_uuid(),
      user_id int references users(id) on delete cascade,
      title text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists messages (
      id uuid primary key default gen_random_uuid(),
      conversation_id uuid references conversations(id) on delete cascade,
      role text not null,
      content text not null,
      agents_used text[],
      workflow_id uuid,
      tokens_used int default 0,
      credits_spent int default 0,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists messages_conversation_idx on messages(conversation_id);`);

  // Teams
  await pool.query(`
    create table if not exists teams (
      id serial primary key,
      name text not null,
      owner_user_id int references users(id) on delete set null,
      slug text unique,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists team_members (
      id serial primary key,
      team_id int references teams(id) on delete cascade,
      user_id int references users(id) on delete cascade,
      role text default 'member',
      invited_at timestamptz default now(),
      accepted_at timestamptz,
      unique(team_id, user_id)
    );
  `);

  await pool.query(`
    create table if not exists team_invites (
      id uuid primary key default gen_random_uuid(),
      team_id int references teams(id) on delete cascade,
      email text not null,
      role text default 'member',
      invited_by int references users(id),
      expires_at timestamptz default now() + interval '7 days',
      accepted_at timestamptz,
      created_at timestamptz default now()
    );
  `);

  // Saved workflows
  await pool.query(`
    create table if not exists saved_workflows (
      id uuid primary key default gen_random_uuid(),
      team_id int references teams(id) on delete cascade,
      user_id int references users(id) on delete set null,
      name text not null,
      description text,
      nodes jsonb not null,
      status text default 'draft',
      trigger_type text,
      trigger_config jsonb,
      run_count int default 0,
      last_run_at timestamptz,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  // Payments
  await pool.query(`
    create table if not exists payment_transactions (
      id uuid primary key default gen_random_uuid(),
      user_id int references users(id) on delete set null,
      stripe_payment_intent_id text,
      stripe_session_id text,
      amount_cents int not null,
      currency text default 'usd',
      credits_purchased int not null,
      status text default 'pending',
      created_at timestamptz default now(),
      completed_at timestamptz
    );
  `);

  // Add crypto payment columns
  await pool.query(`alter table payment_transactions add column if not exists tx_hash text;`);
  await pool.query(`alter table payment_transactions add column if not exists chain_id int;`);
  await pool.query(`alter table payment_transactions add column if not exists from_address text;`);
  await pool.query(`alter table payment_transactions add column if not exists payment_method text default 'stripe';`);
  await pool.query(`alter table payment_transactions add column if not exists provider_event_id text;`);
  await pool.query(`alter table payment_transactions add column if not exists provider_ref text;`);
  await pool.query(`create unique index if not exists payment_tx_hash_idx on payment_transactions(tx_hash) where tx_hash is not null;`);
  await pool.query(`create unique index if not exists payment_provider_event_idx on payment_transactions(provider_event_id) where provider_event_id is not null;`);

  await pool.query(`
    create table if not exists subscriptions (
      id serial primary key,
      user_id int references users(id) on delete cascade unique,
      stripe_subscription_id text,
      plan text default 'free',
      credits_per_month int default 500,
      current_period_start timestamptz,
      current_period_end timestamptz,
      status text default 'active',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  // HuggingFace deployments
  await pool.query(`
    create table if not exists hf_deployments (
      id uuid primary key default gen_random_uuid(),
      user_id int references users(id) on delete set null,
      hf_model_id text not null,
      agent_did text,
      name text,
      description text,
      price_cents int default 10,
      status text default 'deploying',
      endpoint_url text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  // Usage tracking
  await pool.query(`
    create table if not exists usage_logs (
      id serial primary key,
      user_id int references users(id) on delete set null,
      conversation_id uuid,
      workflow_id uuid,
      agents_used text[],
      credits_used int default 0,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists usage_logs_user_idx on usage_logs(user_id);`);
  await pool.query(`create index if not exists usage_logs_created_idx on usage_logs(created_at);`);

  // Agent selection introspection: why a given agent was chosen for a node
  await pool.query(`
    create table if not exists selection_logs (
      id serial primary key,
      workflow_id uuid not null references workflows(id) on delete cascade,
      node_name text not null,
      node_id uuid,
      attempt int default 0,
      capability_id text not null,
      chosen_agent_did text,
      candidates jsonb,
      filtered jsonb,
      policy jsonb,
      created_at timestamptz default now()
    );
  `);
  await pool.query(
    `create index if not exists selection_logs_workflow_idx on selection_logs(workflow_id)`
  );

  // Operational alerts (health/safety/anomaly)
  await pool.query(`
    create table if not exists alerts (
      id serial primary key,
      type text not null,
      severity text default 'warn',
      message text not null,
      meta jsonb,
      created_at timestamptz default now(),
      acknowledged_at timestamptz,
      resolved_at timestamptz
    );
  `);
  await pool.query(`create index if not exists alerts_type_idx on alerts(type)`);
  await pool.query(`create index if not exists alerts_unresolved_idx on alerts(resolved_at)`);

  // ============================================================
  // PHASE 1: TRUST LAYER
  // ============================================================

  // Revocation Registry - Block/ban agents protocol-wide
  await pool.query(`
    create table if not exists revoked_dids (
      id serial primary key,
      did text not null unique,
      reason text not null,
      revoked_by text,
      evidence jsonb,
      created_at timestamptz default now(),
      expires_at timestamptz
    );
  `);
  await pool.query(`create index if not exists revoked_dids_did_idx on revoked_dids(did);`);

  // Agent key rotation history
  await pool.query(`
    create table if not exists key_rotations (
      id serial primary key,
      agent_did text not null,
      old_public_key text not null,
      new_public_key text not null,
      rotation_proof text,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists key_rotations_did_idx on key_rotations(agent_did);`);

  // Signed results for cryptographic verification
  await pool.query(`
    create table if not exists signed_results (
      id uuid primary key default gen_random_uuid(),
      node_id uuid not null,
      workflow_id uuid references workflows(id) on delete cascade,
      agent_did text not null,
      result_hash text not null,
      signature text not null,
      public_key text not null,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists signed_results_node_idx on signed_results(node_id);`);
  await pool.query(`create index if not exists signed_results_workflow_idx on signed_results(workflow_id);`);

  // ============================================================
  // PHASE 2: ACCOUNTABILITY LAYER  
  // ============================================================

  // Immutable audit log with chain linking
  await pool.query(`
    create table if not exists audit_chain (
      id serial primary key,
      prev_hash text,
      event_type text not null,
      actor_did text,
      target_type text,
      target_id text,
      action text not null,
      payload jsonb,
      metadata jsonb,
      hash text not null,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists audit_chain_actor_idx on audit_chain(actor_did);`);
  await pool.query(`create index if not exists audit_chain_target_idx on audit_chain(target_type, target_id);`);
  await pool.query(`create index if not exists audit_chain_type_idx on audit_chain(event_type);`);

  // Agent receipts - proof of task completion
  await pool.query(`
    create table if not exists task_receipts (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null,
      node_id uuid not null,
      workflow_id uuid references workflows(id) on delete cascade,
      agent_did text not null,
      capability_id text not null,
      input_hash text not null,
      output_hash text not null,
      started_at timestamptz not null,
      completed_at timestamptz not null,
      latency_ms int,
      credits_earned int,
      coordinator_signature text,
      agent_signature text,
      receipt_cose text,
      receipt_kid text,
      receipt_profile int,
      dispute_window_seconds int,
      created_at timestamptz default now()
    );
  `);
  await pool.query(
    `alter table task_receipts add column if not exists dispute_window_seconds int`
  );
  await pool.query(`create index if not exists task_receipts_agent_idx on task_receipts(agent_did);`);
  await pool.query(`create index if not exists task_receipts_workflow_idx on task_receipts(workflow_id);`);
  await pool.query(`create unique index if not exists task_receipts_workflow_node_idx on task_receipts(workflow_id, node_id);`);

  // OpenTelemetry trace storage
  await pool.query(`
    create table if not exists traces (
      id uuid primary key default gen_random_uuid(),
      trace_id text not null,
      span_id text not null,
      parent_span_id text,
      operation_name text not null,
      service_name text not null,
      start_time timestamptz not null,
      end_time timestamptz,
      duration_ms int,
      status text,
      attributes jsonb,
      events jsonb,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists traces_trace_id_idx on traces(trace_id);`);
  await pool.query(`create index if not exists traces_span_id_idx on traces(span_id);`);
  // Propagate trace_ids to core tables for audit correlation
  await pool.query(`alter table workflows add column if not exists trace_id text;`);
  await pool.query(`alter table task_nodes add column if not exists trace_id text;`);
  await pool.query(`alter table task_receipts add column if not exists trace_id text;`);
  await pool.query(`alter table ledger_events add column if not exists trace_id text;`);

  // ============================================================
  // PHASE 3: PROTOCOL COMPLETENESS
  // ============================================================

  // Workflow cancellation tracking
  await pool.query(`alter table workflows add column if not exists cancelled_at timestamptz;`);
  await pool.query(`alter table workflows add column if not exists cancel_reason text;`);
  await pool.query(`alter table workflows add column if not exists cancelled_by text;`);

  // Capability versions and negotiation
  await pool.query(`
    create table if not exists capability_versions (
      id serial primary key,
      capability_id text not null,
      version text not null,
      schema_hash text,
      input_schema jsonb,
      output_schema jsonb,
      deprecated_at timestamptz,
      successor_version text,
      created_at timestamptz default now(),
      unique(capability_id, version)
    );
  `);

  // Scheduled workflow triggers
  await pool.query(`
    create table if not exists scheduled_workflows (
      id uuid primary key default gen_random_uuid(),
      template_id uuid,
      manifest jsonb not null,
      cron_expression text,
      next_run_at timestamptz,
      last_run_at timestamptz,
      last_run_workflow_id uuid,
      enabled boolean default true,
      timezone text default 'UTC',
      payer_did text,
      max_cents bigint,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists scheduled_workflows_next_run_idx on scheduled_workflows(next_run_at) where enabled = true;`);

  // ============================================================
  // PHASE 4: IDENTITY & INHERITANCE
  // ============================================================

  // ACARD extensions for inheritance
  await pool.query(`
    create table if not exists agent_inheritance (
      id serial primary key,
      agent_did text not null unique,
      recovery_address text,
      heir_did text,
      expires_at timestamptz,
      dead_man_switch_hours int,
      last_activity_at timestamptz,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  // Human-readable agent names (ENS-style)
  await pool.query(`
    create table if not exists agent_names (
      id serial primary key,
      name text not null unique,
      agent_did text not null,
      owner_did text,
      expires_at timestamptz,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists agent_names_did_idx on agent_names(agent_did);`);

  // ============================================================
  // PHASE 5: ECONOMICS
  // ============================================================

  // Invoices for billing
  await pool.query(`
    create table if not exists invoices (
      id uuid primary key default gen_random_uuid(),
      payer_did text not null,
      payee_did text,
      workflow_id uuid,
      period_start timestamptz,
      period_end timestamptz,
      subtotal_cents int not null,
      protocol_fee_cents int default 0,
      total_cents int not null,
      currency text default 'USD',
      status text default 'pending',
      pdf_url text,
      stripe_invoice_id text,
      created_at timestamptz default now(),
      paid_at timestamptz
    );
  `);
  await pool.query(`create index if not exists invoices_payer_idx on invoices(payer_did);`);

  // Dispute resolution
  await pool.query(`
    create table if not exists disputes (
      id uuid primary key default gen_random_uuid(),
      workflow_id uuid references workflows(id) on delete set null,
      node_id uuid,
      complainant_did text not null,
      respondent_did text,
      dispute_type text not null,
      description text not null,
      evidence jsonb,
      status text default 'open',
      resolution text,
      resolved_by text,
      credits_refunded int,
      created_at timestamptz default now(),
      resolved_at timestamptz
    );
  `);
  await pool.query(`create index if not exists disputes_status_idx on disputes(status);`);

  // Usage quotas
  await pool.query(`
    create table if not exists usage_quotas (
      id serial primary key,
      owner_did text not null unique,
      max_workflows_per_day int,
      max_concurrent_workflows int,
      max_spend_per_day_cents int,
      current_daily_workflows int default 0,
      current_daily_spend_cents int default 0,
      quota_reset_at timestamptz default now() + interval '1 day',
      created_at timestamptz default now()
    );
  `);
}
