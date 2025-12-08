import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || "postgres://postgres:postgres@localhost:5432/nooterra",
});

export async function migrate() {
  await pool.query(`
    create table if not exists agents (
      did text primary key,
      name text,
      endpoint text,
      reputation numeric default 0,
      availability_score numeric default 0,
      last_seen timestamptz,
      public_key text,
      acard_version integer,
      acard_lineage text,
      acard_signature text,
      acard_raw jsonb,
      did_method text,
      pqc_public_key text,
      source_peer text,
      is_conflicted boolean default false,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  await pool.query(`
    create table if not exists capabilities (
      id serial primary key,
      agent_did text references agents(did) on delete cascade,
      capability_id text,
      description text,
      tags text[],
      output_schema jsonb,
      price_model text,
      safety_class text,
      region text,
      sla_hints jsonb,
      certs jsonb,
      created_at timestamptz default now()
    );
  `);

  await pool.query(`alter table agents add column if not exists reputation numeric default 0;`);
  await pool.query(`alter table agents add column if not exists availability_score numeric default 0;`);
  await pool.query(`alter table agents add column if not exists last_seen timestamptz;`);
  await pool.query(`alter table agents add column if not exists public_key text;`);
  await pool.query(`alter table agents add column if not exists acard_version integer;`);
  await pool.query(`alter table agents add column if not exists acard_lineage text;`);
  await pool.query(`alter table agents add column if not exists acard_signature text;`);
  await pool.query(`alter table agents add column if not exists acard_raw jsonb;`);
  await pool.query(`alter table agents add column if not exists agent_card jsonb;`);
  await pool.query(`alter table agents add column if not exists did_method text;`);
  await pool.query(`alter table agents add column if not exists pqc_public_key text;`);
  await pool.query(`alter table agents add column if not exists source_peer text;`);
  await pool.query(`alter table agents add column if not exists is_conflicted boolean default false;`);
  await pool.query(`alter table agents add column if not exists updated_at timestamptz default now();`);
  await pool.query(`alter table agents add column if not exists reputation_stats jsonb;`);
  
  // Wallet address for agent developer payments
  await pool.query(`alter table agents add column if not exists wallet_address text;`);
  await pool.query(`create index if not exists agents_wallet_idx on agents(wallet_address) where wallet_address is not null;`);
  
  // Price per capability call (in NCR cents)
  await pool.query(`alter table capabilities add column if not exists price_cents int default 10;`);
  await pool.query(`alter table capabilities add column if not exists price_model text;`);
  await pool.query(`alter table capabilities add column if not exists safety_class text;`);
  await pool.query(`alter table capabilities add column if not exists region text;`);
  await pool.query(`alter table capabilities add column if not exists sla_hints jsonb;`);
  await pool.query(`alter table capabilities add column if not exists certs jsonb;`);
  await pool.query(`alter table capabilities add column if not exists price_model text;`);

  // MCP / tool schemas
  await pool.query(`
    create table if not exists tool_schemas (
      id serial primary key,
      capability_id text not null,
      agent_did text references agents(did) on delete cascade,
      schema jsonb not null,
      version int default 1,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
  await pool.query(
    `create unique index if not exists tool_schemas_cap_agent_idx on tool_schemas(capability_id, agent_did)`
  );

  // Federation peer tracking (binary trust)
  await pool.query(`
    create table if not exists federation_peers (
      id uuid primary key,
      endpoint text not null,
      region text,
      public_key text,
      status text default 'active',
      state_version integer default 0,
      last_sync_at timestamptz,
      last_seen_at timestamptz,
      capabilities text[],
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);

  // Collision/conflict log
  await pool.query(`
    create table if not exists federation_conflicts (
      id serial primary key,
      did text not null,
      peer_id uuid not null,
      local_version integer,
      peer_version integer,
      reason text,
      diff jsonb,
      resolved boolean default false,
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists federation_conflicts_did_idx on federation_conflicts(did) where resolved = false;`);

  // Registry state version
  await pool.query(`
    create table if not exists registry_state (
      id integer primary key default 1,
      state_version integer default 0,
      updated_at timestamptz default now()
    );
  `);
  await pool.query(`insert into registry_state (id, state_version) values (1, 0) on conflict (id) do nothing;`);

  // Agent reputation stats with decay-friendly fields
  await pool.query(`
    create table if not exists agent_reputation_stats (
      agent_did text primary key references agents(did) on delete cascade,
      total_tasks numeric default 0,
      successes numeric default 0,
      failures numeric default 0,
      disputes numeric default 0,
      p90_latency_ms numeric,
      last_event_at timestamptz,
      updated_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists agent_reputation_stats_updated_idx on agent_reputation_stats(updated_at);`);
}
