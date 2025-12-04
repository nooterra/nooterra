/**
 * Dispute Resolution System - Database Migrations
 * 
 * Complete database schema for the dispute resolution system including:
 * - Disputes table
 * - Evidence table with attachments
 * - Arbitrator assignments
 * - Escrow integration
 * - Reputation impact tracking
 */

import { pool } from "./db.js";

export async function migrateDisputeSystem(): Promise<void> {
  // ==========================================================================
  // ESCROW TABLE (if not exists)
  // ==========================================================================
  
  await pool.query(`
    create table if not exists escrow (
      id text primary key,
      workflow_id uuid references workflows(id) on delete cascade,
      node_name text not null,
      requester_did text not null,
      agent_did text not null,
      amount numeric not null,
      currency text default 'NCR',
      status text default 'held' check (status in ('pending', 'held', 'released', 'slashed', 'disputed', 'refunded', 'partial_release')),
      release_conditions jsonb,
      timeout_at timestamptz,
      released_at timestamptz,
      released_to text,
      release_amount numeric,
      slash_reason text,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists escrow_workflow_idx on escrow(workflow_id);`);
  await pool.query(`create index if not exists escrow_requester_idx on escrow(requester_did);`);
  await pool.query(`create index if not exists escrow_agent_idx on escrow(agent_did);`);
  await pool.query(`create index if not exists escrow_status_idx on escrow(status);`);
  
  // ==========================================================================
  // DISPUTES TABLE
  // ==========================================================================
  
  await pool.query(`
    create table if not exists disputes (
      id text primary key,
      escrow_id text references escrow(id) on delete cascade,
      workflow_id uuid references workflows(id) on delete set null,
      node_name text,
      
      -- Parties
      requester_did text not null,
      agent_did text not null,
      filed_by text not null,
      
      -- Dispute details
      category text not null check (category in (
        'quality', 'timeout', 'schema_violation', 'malicious', 
        'incomplete', 'overcharge', 'misrepresentation', 'other'
      )),
      severity text default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
      reason text not null,
      expected_outcome text,
      
      -- Financial
      disputed_amount numeric not null,
      currency text default 'NCR',
      requested_refund numeric,
      
      -- Status flow
      status text default 'open' check (status in (
        'open', 'evidence_collection', 'awaiting_response', 
        'arbitration', 'mediation', 'resolved', 'appealed', 
        'appeal_review', 'closed', 'expired'
      )),
      phase_deadline timestamptz,
      
      -- Resolution
      resolution text check (resolution in (
        'requester_full_refund', 'requester_partial_refund',
        'agent_full_payment', 'agent_partial_payment',
        'split_50_50', 'custom_split', 'dismissed', 'withdrawn'
      )),
      resolution_note text,
      refund_amount numeric,
      agent_payment numeric,
      protocol_fee numeric default 0,
      
      -- Arbitration
      arbitrator_id text,
      arbitrator_assigned_at timestamptz,
      arbitration_started_at timestamptz,
      
      -- Reputation impact
      requester_rep_change int default 0,
      agent_rep_change int default 0,
      reputation_applied boolean default false,
      
      -- Timestamps
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      response_deadline timestamptz,
      evidence_deadline timestamptz,
      resolved_at timestamptz,
      closed_at timestamptz,
      
      -- Metadata
      tags text[],
      metadata jsonb default '{}'
    );
  `);
  await pool.query(`create index if not exists disputes_escrow_idx on disputes(escrow_id);`);
  await pool.query(`create index if not exists disputes_workflow_idx on disputes(workflow_id);`);
  await pool.query(`create index if not exists disputes_requester_idx on disputes(requester_did);`);
  await pool.query(`create index if not exists disputes_agent_idx on disputes(agent_did);`);
  await pool.query(`create index if not exists disputes_status_idx on disputes(status);`);
  await pool.query(`create index if not exists disputes_arbitrator_idx on disputes(arbitrator_id);`);
  await pool.query(`create index if not exists disputes_created_idx on disputes(created_at desc);`);
  
  // ==========================================================================
  // EVIDENCE TABLE
  // ==========================================================================
  
  await pool.query(`
    create table if not exists dispute_evidence (
      id text primary key,
      dispute_id text references disputes(id) on delete cascade,
      
      -- Submitter
      submitted_by text not null,
      party_role text not null check (party_role in ('requester', 'agent', 'arbitrator', 'system')),
      
      -- Evidence content
      type text not null check (type in (
        'output_sample', 'input_sample', 'schema_diff', 
        'logs', 'screenshot', 'video', 'timeline',
        'transaction_proof', 'communication', 'contract',
        'third_party_verification', 'expert_opinion',
        'system_generated', 'other'
      )),
      title text not null,
      description text,
      
      -- Content storage
      content_type text default 'application/json',
      content jsonb,
      content_hash text,
      
      -- Attachments (S3/IPFS URLs)
      attachments jsonb default '[]',
      
      -- Verification
      verified boolean default false,
      verified_by text,
      verified_at timestamptz,
      verification_method text,
      
      -- Scoring (for arbitration)
      relevance_score numeric,
      credibility_score numeric,
      impact_score numeric,
      
      -- Timestamps
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      
      -- Metadata
      metadata jsonb default '{}'
    );
  `);
  await pool.query(`create index if not exists evidence_dispute_idx on dispute_evidence(dispute_id);`);
  await pool.query(`create index if not exists evidence_submitter_idx on dispute_evidence(submitted_by);`);
  await pool.query(`create index if not exists evidence_type_idx on dispute_evidence(type);`);
  
  // ==========================================================================
  // DISPUTE RESPONSES TABLE
  // ==========================================================================
  
  await pool.query(`
    create table if not exists dispute_responses (
      id text primary key,
      dispute_id text references disputes(id) on delete cascade,
      responder_did text not null,
      party_role text not null check (party_role in ('requester', 'agent')),
      
      -- Response content
      response_type text not null check (response_type in (
        'initial_response', 'counter_claim', 'rebuttal', 
        'settlement_offer', 'withdrawal', 'acceptance'
      )),
      content text not null,
      
      -- Settlement offers
      proposed_resolution text,
      proposed_amount numeric,
      
      -- Status
      status text default 'submitted' check (status in (
        'submitted', 'acknowledged', 'accepted', 'rejected', 'expired'
      )),
      
      -- Timestamps
      created_at timestamptz default now(),
      expires_at timestamptz,
      responded_at timestamptz
    );
  `);
  await pool.query(`create index if not exists responses_dispute_idx on dispute_responses(dispute_id);`);
  
  // ==========================================================================
  // ARBITRATORS TABLE
  // ==========================================================================
  
  await pool.query(`
    create table if not exists arbitrators (
      id text primary key,
      user_id int references users(id) on delete set null,
      
      -- Profile
      name text not null,
      email text,
      expertise text[],
      certifications text[],
      bio text,
      
      -- Stats
      cases_handled int default 0,
      cases_pending int default 0,
      avg_resolution_time_hours numeric,
      satisfaction_rating numeric,
      
      -- Status
      status text default 'active' check (status in ('active', 'inactive', 'suspended', 'on_leave')),
      max_concurrent_cases int default 10,
      
      -- Compensation
      fee_per_case_cents int default 0,
      fee_percentage numeric default 0,
      
      -- Timestamps
      created_at timestamptz default now(),
      last_active_at timestamptz
    );
  `);
  await pool.query(`create index if not exists arbitrators_status_idx on arbitrators(status);`);
  
  // ==========================================================================
  // ARBITRATION DECISIONS TABLE
  // ==========================================================================
  
  await pool.query(`
    create table if not exists arbitration_decisions (
      id text primary key,
      dispute_id text references disputes(id) on delete cascade,
      arbitrator_id text references arbitrators(id) on delete set null,
      
      -- Decision
      decision text not null check (decision in (
        'requester_wins', 'agent_wins', 'partial_requester',
        'partial_agent', 'split', 'dismissed', 'escalate'
      )),
      rationale text not null,
      
      -- Financial ruling
      requester_award numeric default 0,
      agent_award numeric default 0,
      protocol_fee numeric default 0,
      
      -- Reputation ruling
      requester_rep_impact int default 0,
      agent_rep_impact int default 0,
      
      -- Confidence
      confidence_score numeric check (confidence_score between 0 and 1),
      precedent_cases text[],
      
      -- Appeal info
      appealable boolean default true,
      appeal_deadline timestamptz,
      
      -- Timestamps
      created_at timestamptz default now(),
      
      -- Metadata
      metadata jsonb default '{}'
    );
  `);
  await pool.query(`create index if not exists decisions_dispute_idx on arbitration_decisions(dispute_id);`);
  await pool.query(`create index if not exists decisions_arbitrator_idx on arbitration_decisions(arbitrator_id);`);
  
  // ==========================================================================
  // APPEALS TABLE
  // ==========================================================================
  
  await pool.query(`
    create table if not exists dispute_appeals (
      id text primary key,
      dispute_id text references disputes(id) on delete cascade,
      original_decision_id text references arbitration_decisions(id) on delete set null,
      
      -- Appellant
      appellant_did text not null,
      party_role text not null check (party_role in ('requester', 'agent')),
      
      -- Appeal details
      grounds text not null,
      new_evidence_ids text[],
      requested_outcome text,
      
      -- Status
      status text default 'pending' check (status in (
        'pending', 'under_review', 'additional_info_required',
        'upheld', 'overturned', 'modified', 'dismissed'
      )),
      
      -- Review
      reviewed_by text,
      review_notes text,
      
      -- Outcome
      new_decision_id text references arbitration_decisions(id) on delete set null,
      
      -- Timestamps
      created_at timestamptz default now(),
      reviewed_at timestamptz
    );
  `);
  await pool.query(`create index if not exists appeals_dispute_idx on dispute_appeals(dispute_id);`);
  
  // ==========================================================================
  // DISPUTE TIMELINE/ACTIVITY LOG
  // ==========================================================================
  
  await pool.query(`
    create table if not exists dispute_activity (
      id serial primary key,
      dispute_id text references disputes(id) on delete cascade,
      
      -- Activity
      action text not null,
      actor_did text,
      actor_role text,
      
      -- Details
      description text,
      old_value jsonb,
      new_value jsonb,
      
      -- Timestamps
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create index if not exists activity_dispute_idx on dispute_activity(dispute_id);`);
  await pool.query(`create index if not exists activity_created_idx on dispute_activity(created_at desc);`);
  
  // ==========================================================================
  // DISPUTE TEMPLATES (for common dispute types)
  // ==========================================================================
  
  await pool.query(`
    create table if not exists dispute_templates (
      id text primary key,
      category text not null,
      name text not null,
      description text,
      
      -- Pre-filled fields
      default_severity text,
      evidence_requirements text[],
      typical_resolution text,
      estimated_duration_hours int,
      
      -- Automation
      auto_evidence_collection jsonb,
      auto_resolution_rules jsonb,
      
      -- Status
      active boolean default true,
      
      -- Timestamps
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
  
  // Insert default templates
  await pool.query(`
    insert into dispute_templates (id, category, name, description, default_severity, evidence_requirements, typical_resolution, estimated_duration_hours)
    values
      ('tmpl_timeout', 'timeout', 'Agent Timeout', 'Agent failed to respond within SLA', 'medium', 
       array['timeline', 'logs'], 'requester_full_refund', 24),
      ('tmpl_schema', 'schema_violation', 'Schema Mismatch', 'Output does not match declared schema', 'high',
       array['schema_diff', 'output_sample'], 'requester_full_refund', 48),
      ('tmpl_quality', 'quality', 'Quality Issue', 'Output quality below acceptable standards', 'medium',
       array['output_sample', 'expert_opinion'], 'split_50_50', 72),
      ('tmpl_malicious', 'malicious', 'Malicious Behavior', 'Agent exhibited harmful behavior', 'critical',
       array['logs', 'output_sample', 'transaction_proof'], 'requester_full_refund', 168)
    on conflict (id) do nothing;
  `);
  
  // ==========================================================================
  // DISPUTE STATS (for analytics)
  // ==========================================================================
  
  await pool.query(`
    create table if not exists dispute_stats (
      id serial primary key,
      period_start date not null,
      period_end date not null,
      
      -- Counts
      disputes_filed int default 0,
      disputes_resolved int default 0,
      disputes_expired int default 0,
      
      -- Outcomes
      requester_wins int default 0,
      agent_wins int default 0,
      splits int default 0,
      dismissed int default 0,
      
      -- Financial
      total_disputed_amount numeric default 0,
      total_refunded numeric default 0,
      total_agent_paid numeric default 0,
      protocol_fees_collected numeric default 0,
      
      -- Timing
      avg_resolution_hours numeric,
      
      -- By category
      by_category jsonb default '{}',
      
      -- Timestamps
      created_at timestamptz default now()
    );
  `);
  await pool.query(`create unique index if not exists dispute_stats_period_idx on dispute_stats(period_start, period_end);`);
  
  console.log("✅ Dispute system migrations complete");
}
