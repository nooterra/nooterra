/**
 * Execution Policy — receipt building, runtime policy resolution, and pre-flight checks.
 * Extracted from server.js.
 */

import type pg from 'pg';
import { createDefaultVerificationPlan, runVerification } from './verification-engine.js';
import { getWorkerRuntimePolicyForTool } from './runtime-policy-store.js';
import {
  resolveApprovalEnforcementDecision,
  resolveSideEffectEnforcementDecision,
  resolveVerificationEnforcementDecision,
} from './runtime-enforcement.js';

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

export function safeParseJson(value: unknown, fallback: unknown = null): unknown {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Execution receipt
// ---------------------------------------------------------------------------

interface ReceiptParams {
  worker: any;
  executionId: string;
  finalResponse: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  startedAt: Date;
  rounds: number;
  toolCallCount: number;
  blockedActions?: any[];
  approvalsPending?: any[];
  toolResults?: any[];
  verificationPlan?: any;
  interruption?: any;
}

export function buildExecutionReceipt({
  worker,
  executionId,
  finalResponse,
  totalPromptTokens,
  totalCompletionTokens,
  totalCost,
  startedAt,
  rounds,
  toolCallCount,
  blockedActions = [],
  approvalsPending = [],
  toolResults = [],
  verificationPlan,
  interruption = null,
}: ReceiptParams) {
  const receipt: Record<string, unknown> = {
    schemaVersion: 'WorkerExecutionReceipt.v1',
    executionId,
    workerId: worker.id,
    workerName: worker.name,
    model: worker.model,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    cost: totalCost,
    durationMs: Date.now() - startedAt.getTime(),
    rounds,
    toolCallCount,
    blockedActions,
    approvalsPending,
    interruption,
    toolResults,
    response: finalResponse?.slice(0, 50000) || '',
  };

  const report = runVerification(receipt, verificationPlan || createDefaultVerificationPlan());
  receipt.verificationReport = report;
  receipt.businessOutcome = report.businessOutcome;
  receipt.success = report.businessOutcome === 'passed' || report.businessOutcome === 'partial';
  return receipt;
}

// ---------------------------------------------------------------------------
// Runtime execution policy builders
// ---------------------------------------------------------------------------

export function buildMetadataExecutionPolicy(executionMetadata: any = {}) {
  if (!executionMetadata?.forceApprovalReentry) return null;
  return {
    forceApprovalForAllTools: true,
    matchedRule: executionMetadata.webhookPolicyReason || 'Webhook anomaly approval re-entry',
    reason: executionMetadata.webhookPolicyReason || 'Webhook anomaly policy requires tool approval re-entry',
  };
}

export function buildSideEffectExecutionPolicy(decision: any) {
  if (!decision || decision.action === 'allow') return null;
  const policy = {
    blockedToolNames: Array.isArray(decision.blockedToolNames) ? [...decision.blockedToolNames] : [],
    blockedToolReasons: { ...(decision.blockedToolReasons || {}) },
    forceApprovalToolNames: Array.isArray(decision.forceApprovalToolNames) ? [...decision.forceApprovalToolNames] : [],
    forceApprovalToolReasons: { ...(decision.forceApprovalToolReasons || {}) },
  };
  return policy.blockedToolNames.length > 0 || policy.forceApprovalToolNames.length > 0 ? policy : null;
}

export function buildVerificationExecutionPolicy(decision: any) {
  if (!decision?.forceApprovalForAllTools) return null;
  return {
    forceApprovalForAllTools: true,
    matchedRule: decision.matchedRule || 'Verification regression approval re-entry',
    reason: decision.reason || 'Verification regression policy requires tool approval re-entry',
  };
}

export function mergeExecutionPolicies(...policies: any[]) {
  const merged: Record<string, any> = {
    forceApprovalForAllTools: false,
    blockedToolNames: [] as string[],
    blockedToolReasons: {} as Record<string, string>,
    forceApprovalToolNames: [] as string[],
    forceApprovalToolReasons: {} as Record<string, string>,
    matchedRule: null,
    reason: null,
  };

  for (const policy of policies) {
    if (!policy || typeof policy !== 'object') continue;
    if (policy.forceApprovalForAllTools) merged.forceApprovalForAllTools = true;
    if (Array.isArray(policy.blockedToolNames)) {
      merged.blockedToolNames.push(...policy.blockedToolNames);
    }
    if (Array.isArray(policy.forceApprovalToolNames)) {
      merged.forceApprovalToolNames.push(...policy.forceApprovalToolNames);
    }
    if (policy.blockedToolReasons && typeof policy.blockedToolReasons === 'object') {
      Object.assign(merged.blockedToolReasons, policy.blockedToolReasons);
    }
    if (policy.forceApprovalToolReasons && typeof policy.forceApprovalToolReasons === 'object') {
      Object.assign(merged.forceApprovalToolReasons, policy.forceApprovalToolReasons);
    }
    if (policy.matchedRule) merged.matchedRule = policy.matchedRule;
    if (policy.reason) merged.reason = policy.reason;
  }

  merged.blockedToolNames = [...new Set(merged.blockedToolNames.filter(Boolean))];
  merged.forceApprovalToolNames = [...new Set(merged.forceApprovalToolNames.filter(Boolean))];

  if (!merged.forceApprovalForAllTools
      && merged.blockedToolNames.length === 0
      && merged.forceApprovalToolNames.length === 0) {
    return null;
  }

  return merged;
}

export function describeExecutionPolicy(policy: any) {
  if (!policy) return '';
  const parts: string[] = [];
  if (policy.forceApprovalForAllTools) {
    parts.push(policy.reason || policy.matchedRule || 'all tool calls require approval');
  }
  if (Array.isArray(policy.forceApprovalToolNames) && policy.forceApprovalToolNames.length > 0) {
    parts.push(`approval re-entry for: ${policy.forceApprovalToolNames.join(', ')}`);
  }
  if (Array.isArray(policy.blockedToolNames) && policy.blockedToolNames.length > 0) {
    parts.push(`temporary block for: ${policy.blockedToolNames.join(', ')}`);
  }
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Recent activity loaders (DB queries)
// ---------------------------------------------------------------------------

export async function loadRecentSideEffectFailuresForWorker(
  pool: pg.Pool, workerId: string, tenantId: string,
  { lookbackHours = 24, limit = 100 } = {}
) {
  const cutoffIso = new Date(Date.now() - (lookbackHours * 60 * 60 * 1000)).toISOString();
  const result = await pool.query(
    `SELECT tool_name, status, error_text, created_at, updated_at
       FROM worker_tool_side_effects
      WHERE worker_id = $1
        AND tenant_id = $2
        AND status = 'failed'
        AND created_at >= $3
      ORDER BY created_at DESC
      LIMIT $4`,
    [workerId, tenantId, cutoffIso, limit]
  );
  return result.rows;
}

export async function loadRecentVerificationExecutionsForWorker(
  pool: pg.Pool, workerId: string, tenantId: string,
  { excludeExecutionId = null, lookbackHours = 24, limit = 50 } = {} as any,
) {
  const cutoffIso = new Date(Date.now() - (lookbackHours * 60 * 60 * 1000)).toISOString();
  const params: any[] = [workerId, tenantId, cutoffIso];
  let excludeSql = '';
  if (excludeExecutionId) {
    params.push(excludeExecutionId);
    excludeSql = ` AND id <> $${params.length}`;
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT id, status, receipt, started_at, completed_at
       FROM worker_executions
      WHERE worker_id = $1
        AND tenant_id = $2
        AND receipt IS NOT NULL
        AND completed_at >= $3${excludeSql}
      ORDER BY completed_at DESC
      LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export async function loadRecentApprovalDecisionsForWorker(
  pool: pg.Pool, workerId: string, tenantId: string,
  { lookbackHours = 24, limit = 100 } = {},
) {
  const cutoffIso = new Date(Date.now() - (lookbackHours * 60 * 60 * 1000)).toISOString();
  const result = await pool.query(
    `SELECT tool_name, matched_rule, status, decision, decided_at, created_at
       FROM worker_approvals
      WHERE worker_id = $1
        AND tenant_id = $2
        AND COALESCE(decision, status) IN ('denied', 'edited', 'timeout')
        AND COALESCE(decided_at, created_at) >= $3
      ORDER BY COALESCE(decided_at, created_at) DESC
      LIMIT $4`,
    [workerId, tenantId, cutoffIso, limit]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Scoped runtime decision merging
// ---------------------------------------------------------------------------

export function mergeScopedRuntimeDecisions(decisions: any[] = []) {
  const merged: Record<string, any> = {
    action: 'allow',
    blockedToolNames: [],
    blockedToolReasons: {},
    forceApprovalToolNames: [],
    forceApprovalToolReasons: {},
    forceApprovalForAllTools: false,
    matchedRule: null,
    reason: null,
    anomalies: [],
    autoPauseReasons: [],
  };

  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') continue;
    if (decision.action === 'auto_pause') merged.action = 'auto_pause';
    else if (merged.action === 'allow' && decision.action && decision.action !== 'allow') merged.action = decision.action;
    if (Array.isArray(decision.blockedToolNames)) merged.blockedToolNames.push(...decision.blockedToolNames);
    if (decision.blockedToolReasons && typeof decision.blockedToolReasons === 'object') {
      Object.assign(merged.blockedToolReasons, decision.blockedToolReasons);
    }
    if (Array.isArray(decision.forceApprovalToolNames)) merged.forceApprovalToolNames.push(...decision.forceApprovalToolNames);
    if (decision.forceApprovalToolReasons && typeof decision.forceApprovalToolReasons === 'object') {
      Object.assign(merged.forceApprovalToolReasons, decision.forceApprovalToolReasons);
    }
    if (decision.forceApprovalForAllTools) merged.forceApprovalForAllTools = true;
    if (!merged.matchedRule && decision.matchedRule) merged.matchedRule = decision.matchedRule;
    if (!merged.reason && decision.reason) merged.reason = decision.reason;
    if (Array.isArray(decision.anomalies)) merged.anomalies.push(...decision.anomalies);
    if (Array.isArray(decision.autoPauseReasons)) merged.autoPauseReasons.push(...decision.autoPauseReasons);
  }

  merged.blockedToolNames = [...new Set(merged.blockedToolNames.filter(Boolean))];
  merged.forceApprovalToolNames = [...new Set(merged.forceApprovalToolNames.filter(Boolean))];
  merged.autoPauseReasons = [...new Set(merged.autoPauseReasons.filter(Boolean))];
  if (merged.autoPauseReasons.length > 0) merged.action = 'auto_pause';
  else if (
    merged.forceApprovalForAllTools
    || merged.blockedToolNames.length > 0
    || merged.forceApprovalToolNames.length > 0
  ) merged.action = 'restrict';
  return merged;
}

export function buildScopedSideEffectDecision(sideEffects: any[] = [], workerRuntimePolicyRecord: any = null) {
  const grouped = new Map<string, any[]>();
  for (const sideEffect of sideEffects) {
    const toolName = String(sideEffect?.tool_name || '').trim();
    const key = toolName || '__global__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(sideEffect);
  }

  const decisions: any[] = [];
  for (const [toolName, rows] of grouped.entries()) {
    const scopedPolicy = toolName === '__global__'
      ? {
        sideEffects: workerRuntimePolicyRecord?.effective?.sideEffects || {},
        sources: { sideEffects: workerRuntimePolicyRecord?.sources?.sideEffects || 'default' },
      }
      : getWorkerRuntimePolicyForTool(workerRuntimePolicyRecord, toolName);
    const decision = resolveSideEffectEnforcementDecision(rows, {
      policy: scopedPolicy.sideEffects,
    });
    if (Array.isArray(decision.anomalies)) {
      decision.anomalies = decision.anomalies.map((anomaly: any) => ({
        policyScope: scopedPolicy.sources?.sideEffects || 'default',
        ...anomaly,
      }));
    }
    decisions.push(decision);
  }
  return mergeScopedRuntimeDecisions(decisions);
}

export function buildScopedApprovalDecision(approvals: any[] = [], workerRuntimePolicyRecord: any = null) {
  const byTool = new Map<string, any[]>();
  for (const approval of approvals) {
    const toolName = String(approval?.tool_name || '').trim();
    if (toolName) {
      if (!byTool.has(toolName)) byTool.set(toolName, []);
      byTool.get(toolName)!.push(approval);
    }
  }

  const decisions: any[] = [];
  if (approvals.length > 0) {
    const baseDecision = resolveApprovalEnforcementDecision(approvals, {
      policy: workerRuntimePolicyRecord?.effective?.approvals || {},
    });
    if (Array.isArray(baseDecision.anomalies)) {
      baseDecision.anomalies = baseDecision.anomalies.map((anomaly: any) => ({
        policyScope: workerRuntimePolicyRecord?.sources?.approvals || 'default',
        ...anomaly,
      }));
    }
    decisions.push(baseDecision);
  }

  for (const [toolName, rows] of byTool.entries()) {
    if (!workerRuntimePolicyRecord?.effectiveTools?.[toolName]) continue;
    const scopedPolicy = getWorkerRuntimePolicyForTool(workerRuntimePolicyRecord, toolName);
    const decision = resolveApprovalEnforcementDecision(rows, {
      policy: scopedPolicy.approvals,
    });
    if (Array.isArray(decision.anomalies)) {
      decision.anomalies = decision.anomalies.map((anomaly: any) => ({
        policyScope: scopedPolicy.sources?.approvals || 'default',
        ...anomaly,
      }));
    }
    decisions.push(decision);
  }

  return mergeScopedRuntimeDecisions(decisions);
}

// ---------------------------------------------------------------------------
// Current policy resolvers (combine DB queries + decision logic)
// ---------------------------------------------------------------------------

export async function resolveCurrentSideEffectPolicy(pool: pg.Pool, worker: any, workerRuntimePolicyRecord: any = null) {
  const failures = await loadRecentSideEffectFailuresForWorker(pool, worker.id, worker.tenant_id);
  const decision = buildScopedSideEffectDecision(failures, workerRuntimePolicyRecord);
  return {
    decision,
    policy: buildSideEffectExecutionPolicy(decision),
    autoPauseReasons: Array.isArray(decision.autoPauseReasons) ? decision.autoPauseReasons : [],
  };
}

export async function resolveCurrentApprovalPolicy(pool: pg.Pool, worker: any, workerRuntimePolicyRecord: any = null) {
  const approvals = await loadRecentApprovalDecisionsForWorker(pool, worker.id, worker.tenant_id);
  const decision = buildScopedApprovalDecision(approvals, workerRuntimePolicyRecord);
  return {
    decision,
    policy: decision.action === 'allow'
      ? null
      : {
        blockedToolNames: Array.isArray(decision.blockedToolNames) ? [...decision.blockedToolNames] : [],
        blockedToolReasons: { ...(decision.blockedToolReasons || {}) },
        forceApprovalForAllTools: decision.forceApprovalForAllTools === true,
        matchedRule: decision.matchedRule || null,
        reason: decision.reason || null,
      },
    autoPauseReasons: Array.isArray(decision.autoPauseReasons) ? decision.autoPauseReasons : [],
  };
}

export async function resolveCurrentVerificationPolicy(
  pool: pg.Pool, worker: any, workerRuntimePolicyRecord: any = null,
  { excludeExecutionId = null, currentReceipt = null } = {} as any,
) {
  const executions = await loadRecentVerificationExecutionsForWorker(pool, worker.id, worker.tenant_id, { excludeExecutionId });
  if (currentReceipt) {
    executions.unshift({
      id: excludeExecutionId || 'current',
      status: 'failed',
      receipt: currentReceipt,
      completed_at: new Date().toISOString(),
    });
  }
  const decision = resolveVerificationEnforcementDecision(executions, {
    policy: workerRuntimePolicyRecord?.effective?.verification || {},
  });
  return {
    decision,
    policy: buildVerificationExecutionPolicy(decision),
    autoPauseReasons: decision.action === 'auto_pause' && decision.reason ? [decision.reason] : [],
  };
}

// ---------------------------------------------------------------------------
// Smart polling gate
// ---------------------------------------------------------------------------

export async function shouldWorkerRun(
  pool: pg.Pool, worker: any, triggerType: string,
  addActivity: (type: string, detail: string) => void,
): Promise<boolean> {
  if (triggerType !== 'cron' && triggerType !== 'interval') return true;

  const charter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : worker.charter;
  if (charter?.alwaysRun === true) return true;

  try {
    const integrationsResult = await pool.query(
      `SELECT service FROM tenant_integrations WHERE tenant_id = $1 AND status = 'connected'`,
      [worker.tenant_id]
    );
    if (integrationsResult.rowCount === 0) return true;
  } catch {
    return true;
  }

  try {
    const lastExecResult = await pool.query(
      `SELECT tool_calls, result, completed_at FROM worker_executions
       WHERE worker_id = $1 AND status IN ('completed', 'shadow_completed')
       ORDER BY completed_at DESC LIMIT 3`,
      [worker.id]
    );

    const recentRuns = lastExecResult.rows;
    if (recentRuns.length === 0) return true;

    const idleRuns = recentRuns.filter((r: any) => (parseInt(r.tool_calls) || 0) === 0).length;

    if (idleRuns >= 3) {
      if (Math.random() < 0.75) {
        addActivity('smart_skip', 'Skipped: last 3 runs found nothing to do (adaptive frequency)');
        return false;
      }
    } else if (idleRuns >= 2) {
      if (Math.random() < 0.50) {
        addActivity('smart_skip', 'Skipped: last 2 runs were idle (adaptive frequency)');
        return false;
      }
    }
  } catch {
    return true;
  }

  return true;
}
