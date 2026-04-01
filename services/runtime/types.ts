/** Core domain types for the Nooterra agent runtime. */

// ── Worker ──────────────────────────────────────────────

export interface Worker {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  model: string;
  charter: Charter;
  status: 'active' | 'paused' | 'archived' | 'shadow';
  schedule: string | null;
  knowledge: KnowledgeEntry[] | null;
  provider_mode: 'platform' | 'openai' | 'anthropic' | 'byok';
  byok_provider: string | null;
  byok_api_key?: string;
  shadow?: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeEntry {
  title: string;
  content: string;
}

// ── Charter ─────────────────────────────────────────────

export interface Charter {
  role?: string;
  goal?: string;
  instructions?: string;
  canDo?: string[];
  askFirst?: string[];
  neverDo?: string[];
  task?: string;
  prompt?: string;
  tools?: ToolDefinition[];
  maxDailyRuns?: number;
  capabilities?: CapabilityMap;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

// ── Execution ───────────────────────────────────────────

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'billing_error'
  | 'awaiting_approval'
  | 'auto_paused'
  | 'timed_out'
  | 'cancelled'
  | 'shadow_completed';

export type ApprovalStatus =
  | 'none'
  | 'pending'
  | 'approved'
  | 'denied'
  | 'timed_out'
  | 'edited';

export interface Execution {
  id: string;
  worker_id: string;
  tenant_id: string;
  status: ExecutionStatus;
  approval_status: ApprovalStatus;
  trigger_type: string;
  started_at: string;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  activity: ActivityEntry[];
  cost_usd: number | null;
  token_usage: TokenUsage | null;
  metadata: Record<string, unknown> | null;
}

export interface ActivityEntry {
  ts: string;
  type: string;
  detail: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ── Approval ────────────────────────────────────────────

export interface ApprovalRecord {
  id: string;
  execution_id: string;
  worker_id: string;
  tenant_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status: ApprovalStatus;
  charter_verdict: 'canDo' | 'askFirst' | 'neverDo' | 'unknown';
  matched_rule: string | null;
  decided_at: string | null;
  decided_by: string | null;
}

// ── Verification ────────────────────────────────────────

export type AssertionType =
  | 'execution_metric'
  | 'response_content'
  | 'tool_call_required'
  | 'tool_call_absent'
  | 'duration_limit'
  | 'no_blocked_actions'
  | 'no_errors_in_log'
  | 'no_pending_approvals'
  | 'memory_key_set';

export interface VerificationAssertion {
  type: AssertionType;
  config: Record<string, unknown>;
}

export interface VerificationPlan {
  assertions: VerificationAssertion[];
  passCriteria: 'all_must_pass' | 'majority_pass';
}

export interface VerificationResult {
  type: AssertionType;
  passed: boolean;
  detail: string;
}

export interface VerificationReport {
  businessOutcome: 'passed' | 'partial' | 'failed' | 'inconclusive';
  assertions: VerificationResult[];
  passedCount: number;
  failedCount: number;
}

// ── Learning Signals ────────────────────────────────────

export interface LearningSignal {
  id: string;
  worker_id: string;
  tenant_id: string;
  execution_id: string;
  tool_name: string | null;
  tool_args_hash: string | null;
  charter_verdict: 'canDo' | 'askFirst' | 'neverDo' | 'unknown' | null;
  approval_decision: ApprovalStatus | null;
  execution_outcome: 'success' | 'blocked' | 'paused' | 'error' | null;
  matched_rule: string | null;
  error_message: string | null;
  created_at: string;
}

// ── Runtime Policy ──────────────────────────────────────

export interface RuntimePolicy {
  verification?: {
    lookbackHours?: number;
    failureThreshold?: number;
    autoPauseThreshold?: number;
  };
  approval?: {
    lookbackHours?: number;
    thrashThreshold?: number;
    autoPauseThreshold?: number;
  };
  sideEffects?: {
    lookbackHours?: number;
    failureThreshold?: number;
    cooldownMinutes?: number;
  };
  webhooks?: {
    lookbackHours?: number;
    deadLetterThreshold?: number;
    signatureFailureThreshold?: number;
  };
}

// ── Sessions ────────────────────────────────────────────

export type SessionStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface Session {
  id: string;
  worker_id: string;
  tenant_id: string;
  status: SessionStatus;
  goal: string | null;
  context: Record<string, unknown>;
  history: SessionHistoryEntry[];
  created_at: string;
  updated_at: string;
}

export interface SessionHistoryEntry {
  execution_id: string;
  ts: string;
  summary: string;
}

// ── Memory ──────────────────────────────────────────────

export type MemoryType = 'semantic' | 'episodic' | 'procedural';
export type MemorySource = 'agent' | 'system';

export interface MemoryEntry {
  id: string;
  worker_id: string;
  tenant_id: string | null;
  key: string;
  value: string;
  scope: 'worker' | 'team';
  memory_type: MemoryType;
  source: MemorySource;
  metadata: Record<string, unknown>;
  access_count: number;
  last_accessed_at: string | null;
  updated_at: string;
  expires_at: string | null;
}

// ── Capabilities ────────────────────────────────────────

export type CapabilityAllow = 'canDo' | 'askFirst' | 'neverDo';

export interface CapabilityConstraints {
  to_domains?: string[];
  max_amount_usd?: number;
  max_per_day?: number;
  allowed_values?: Record<string, string[]>;
  blocked_values?: Record<string, string[]>;
  max_length?: Record<string, number>;
  pattern?: Record<string, string>;
}

export interface Capability {
  allow: CapabilityAllow;
  constraints?: CapabilityConstraints;
}

export type CapabilityMap = Record<string, Capability>;

// ── Charter Evolution ───────────────────────────────────

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ProposalType = 'promote' | 'demote';

export interface CharterProposal {
  id: string;
  worker_id: string;
  tenant_id: string;
  status: ProposalStatus;
  proposal_type: ProposalType;
  tool_name: string | null;
  from_level: string;
  to_level: string;
  rule_text: string;
  confidence: number;
  evidence: Record<string, unknown>;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

// ── Competence ──────────────────────────────────────────

export interface CompetenceEntry {
  id: string;
  worker_id: string;
  tenant_id: string;
  task_type: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  avg_duration_ms: number;
  avg_cost_usd: number;
  last_run_at: string | null;
  score: number;
  updated_at: string;
}

// ── Delegation ─────────────────────────────────────────

export interface DelegationGrant {
  id: string;
  parent_worker_id: string;
  child_worker_id: string;
  tenant_id: string;
  status: 'active' | 'revoked' | 'expired' | 'completed';
  granted_capabilities: string[];
  max_depth: number;
  max_cost_usd: number | null;
  expires_at: string | null;
  task_description: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}
