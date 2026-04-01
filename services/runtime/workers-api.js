/**
 * Worker CRUD API
 *
 * Ported from src/api/workers.js into the scheduler service.
 * Handles all /v1/workers/* routes with raw Node.js HTTP.
 */

import crypto from 'node:crypto';
import { encryptCredential, decryptCredential } from './crypto-utils.js';
import { autoPauseWorker, validateCharterRules } from './charter-enforcement.js';
import { analyzePromotionCandidates, buildLearningAnalytics, summarizeExecutionOutcomes } from './trust-learning.js';
import { WORKER_EXECUTION_TERMINAL_STATUSES } from './state-machine.js';
import { presignS3Url } from './lib/s3-presign.js';
import { getAuthenticatedTenantId } from './auth.js';
import { querySignalsForWorker } from './learning-signals.js';
import {
  getTenantWorkerRuntimePolicy,
  getWorkerRuntimePolicy,
  getWorkerRuntimePolicyForTool,
  putTenantWorkerRuntimePolicy,
  putWorkerRuntimePolicy,
  resolveWorkerRuntimePolicy,
  resolveTenantWorkerRuntimePolicy,
} from './runtime-policy-store.js';
import { resolveApprovalEnforcementDecision } from './runtime-enforcement.js';
import {
  buildWorkerWebhookDeadLetterCode,
  computeWorkerWebhookDedupeKey,
  normalizeWorkerWebhookConfig,
  normalizeWorkerWebhookEvent,
  parseWorkerWebhookPayload,
  readWorkerWebhookRequest,
  resolveWebhookEnforcementDecision,
  sanitizeWorkerWebhookHeaders,
  summarizeWebhookAnomalies,
  verifyWorkerWebhookRequest,
  WorkerWebhookIngressError,
} from './webhook-ingress.js';
import { getExecutionTrace } from './traces.ts';
import { generateTeam } from './team-generator.ts';

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function getTenantId(req) {
  const h = req.headers['x-tenant-id'];
  if (h && h.trim()) return h.trim();
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)tenant_id=([^;]+)/);
  if (m) return decodeURIComponent(m[1]).trim() || null;
  return null;
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) {
      req.destroy();
      return null;
    }
  }
  try { return JSON.parse(body); } catch { return null; }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function err(res, status, msg) {
  json(res, status, { error: msg });
}

const VALID_STATUSES = new Set(['ready', 'running', 'paused', 'error', 'archived']);
const UPDATABLE = new Set(['name', 'description', 'charter', 'schedule', 'model', 'status', 'knowledge', 'triggers', 'provider_mode', 'byok_provider', 'chain']);
const JSON_FIELDS = new Set(['charter', 'schedule', 'knowledge', 'triggers', 'chain']);

// Simple per-tenant rate limiter for workers API
const apiRateLimits = new Map(); // key -> { count, resetAt }
const API_RATE_LIMIT_PER_MINUTE = 60;

function checkApiRateLimit(key) {
  if (!key) return true;
  const now = Date.now();
  let entry = apiRateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60000 };
    apiRateLimits.set(key, entry);
  }
  if (entry.count >= API_RATE_LIMIT_PER_MINUTE) return false;
  entry.count++;
  return true;
}

function parseJsonField(value, fallback) {
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

function parseReceipt(receipt) {
  return parseJsonField(receipt, {});
}

function parseActivity(activity) {
  const parsed = parseJsonField(activity, []);
  return Array.isArray(parsed) ? parsed : [];
}

function groupRowsByWorker(rows = [], workerKey = 'worker_id') {
  const grouped = new Map();
  for (const row of rows) {
    const workerId = row?.[workerKey];
    if (!workerId) continue;
    if (!grouped.has(workerId)) grouped.set(workerId, []);
    grouped.get(workerId).push(row);
  }
  return grouped;
}

export function summarizeSideEffects(sideEffects = []) {
  const summary = {
    total: sideEffects.length,
    succeeded: 0,
    failed: 0,
    pending: 0,
    replayedOperations: 0,
    replayCount: 0,
    byTool: {},
    latestFailureAt: null,
    latestReplayAt: null,
  };

  for (const effect of sideEffects) {
    const status = String(effect?.status || 'unknown');
    const toolName = String(effect?.tool_name || 'unknown');
    const replayCount = Number(effect?.replay_count || 0);

    if (!summary.byTool[toolName]) {
      summary.byTool[toolName] = {
        total: 0,
        succeeded: 0,
        failed: 0,
        pending: 0,
        replayedOperations: 0,
        replayCount: 0,
      };
    }
    const toolSummary = summary.byTool[toolName];
    toolSummary.total += 1;

    if (status === 'succeeded') {
      summary.succeeded += 1;
      toolSummary.succeeded += 1;
    } else if (status === 'failed') {
      summary.failed += 1;
      toolSummary.failed += 1;
      const updatedAt = effect?.updated_at || effect?.created_at || null;
      if (updatedAt && (!summary.latestFailureAt || Date.parse(updatedAt) > Date.parse(summary.latestFailureAt))) {
        summary.latestFailureAt = updatedAt;
      }
    } else {
      summary.pending += 1;
      toolSummary.pending += 1;
    }

    if (replayCount > 0) {
      summary.replayedOperations += 1;
      summary.replayCount += replayCount;
      toolSummary.replayedOperations += 1;
      toolSummary.replayCount += replayCount;
      const replayedAt = effect?.last_replayed_at || effect?.updated_at || effect?.created_at || null;
      if (replayedAt && (!summary.latestReplayAt || Date.parse(replayedAt) > Date.parse(summary.latestReplayAt))) {
        summary.latestReplayAt = replayedAt;
      }
    }
  }

  return summary;
}

function summarizeWebhookIngress(webhookIngress = []) {
  const summary = {
    total: webhookIngress.length,
    accepted: 0,
    deadLetters: 0,
    processed: 0,
    replayedDeliveries: 0,
    replayCount: 0,
    byProvider: {},
    latestDeadLetterAt: null,
    latestReplayAt: null,
  };

  for (const ingress of webhookIngress) {
    const provider = String(ingress?.provider || 'generic');
    const status = String(ingress?.status || 'accepted');
    const replayCount = Number(ingress?.replay_count || 0);
    const wasProcessed = Boolean(ingress?.execution_id || ingress?.processed_at);

    if (!summary.byProvider[provider]) {
      summary.byProvider[provider] = {
        total: 0,
        accepted: 0,
        deadLetters: 0,
        processed: 0,
        replayedDeliveries: 0,
        replayCount: 0,
      };
    }
    const providerSummary = summary.byProvider[provider];
    providerSummary.total += 1;

    if (status === 'dead_letter') {
      summary.deadLetters += 1;
      providerSummary.deadLetters += 1;
      const updatedAt = ingress?.updated_at || ingress?.created_at || null;
      if (updatedAt && (!summary.latestDeadLetterAt || Date.parse(updatedAt) > Date.parse(summary.latestDeadLetterAt))) {
        summary.latestDeadLetterAt = updatedAt;
      }
    } else {
      summary.accepted += 1;
      providerSummary.accepted += 1;
    }

    if (wasProcessed) {
      summary.processed += 1;
      providerSummary.processed += 1;
    }

    if (replayCount > 0) {
      summary.replayedDeliveries += 1;
      summary.replayCount += replayCount;
      providerSummary.replayedDeliveries += 1;
      providerSummary.replayCount += replayCount;
      const replayedAt = ingress?.last_replayed_at || ingress?.updated_at || ingress?.created_at || null;
      if (replayedAt && (!summary.latestReplayAt || Date.parse(replayedAt) > Date.parse(summary.latestReplayAt))) {
        summary.latestReplayAt = replayedAt;
      }
    }
  }

  return summary;
}

function mergeApprovalAnomalyDecisions(decisions = []) {
  const anomalies = [];
  const blockedToolNames = [];
  const blockedToolReasons = {};
  let forceApprovalForAllTools = false;
  let matchedRule = null;
  let reason = null;
  const autoPauseReasons = [];

  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') continue;
    if (Array.isArray(decision.anomalies)) anomalies.push(...decision.anomalies);
    if (Array.isArray(decision.blockedToolNames)) blockedToolNames.push(...decision.blockedToolNames);
    if (decision.blockedToolReasons && typeof decision.blockedToolReasons === 'object') {
      Object.assign(blockedToolReasons, decision.blockedToolReasons);
    }
    if (decision.forceApprovalForAllTools) forceApprovalForAllTools = true;
    if (!matchedRule && decision.matchedRule) matchedRule = decision.matchedRule;
    if (!reason && decision.reason) reason = decision.reason;
    if (Array.isArray(decision.autoPauseReasons)) autoPauseReasons.push(...decision.autoPauseReasons);
  }

  const action = autoPauseReasons.length > 0
    ? 'auto_pause'
    : (forceApprovalForAllTools || blockedToolNames.length > 0 ? 'restrict' : 'allow');

  return {
    action,
    blockedToolNames: [...new Set(blockedToolNames.filter(Boolean))],
    blockedToolReasons,
    forceApprovalForAllTools,
    matchedRule,
    reason,
    anomalies,
    autoPauseReasons: [...new Set(autoPauseReasons.filter(Boolean))],
  };
}

function resolveApprovalOverviewDecision(approvals = [], workerRuntimePolicy = null) {
  const decisions = [];
  const approvalsByTool = new Map();

  for (const approval of approvals) {
    const toolName = String(approval?.tool_name || approval?.toolName || '').trim();
    if (toolName) {
      if (!approvalsByTool.has(toolName)) approvalsByTool.set(toolName, []);
      approvalsByTool.get(toolName).push(approval);
    }
  }

  if (approvals.length > 0) {
    const decision = resolveApprovalEnforcementDecision(approvals, {
      policy: workerRuntimePolicy?.effective?.approvals || {},
    });
    if (Array.isArray(decision.anomalies)) {
      decision.anomalies = decision.anomalies.map((anomaly) => ({
        policyScope: workerRuntimePolicy?.sources?.approvals || 'default',
        ...anomaly,
      }));
    }
    decisions.push(decision);
  }

  for (const [toolName, rows] of approvalsByTool.entries()) {
    if (!workerRuntimePolicy?.effectiveTools?.[toolName]) continue;
    const scopedPolicy = getWorkerRuntimePolicyForTool(workerRuntimePolicy, toolName);
    const decision = resolveApprovalEnforcementDecision(rows, {
      policy: scopedPolicy.approvals,
    });
    if (Array.isArray(decision.anomalies)) {
      decision.anomalies = decision.anomalies.map((anomaly) => ({
        policyScope: scopedPolicy.sources?.approvals || 'default',
        ...anomaly,
      }));
    }
    decisions.push(decision);
  }

  return mergeApprovalAnomalyDecisions(decisions);
}

export function buildTenantLearningOverview({
  workers = [],
  executions = [],
  approvals = [],
  signals = [],
  sideEffects = [],
  webhookIngress = [],
  workerPolicies = [],
  runtimePolicy = null,
  lookbackDays = 30,
} = {}) {
  const effectiveTenantRuntimePolicy = resolveTenantWorkerRuntimePolicy(runtimePolicy || {});
  const executionsByWorker = groupRowsByWorker(executions);
  const approvalsByWorker = groupRowsByWorker(approvals);
  const signalsByWorker = groupRowsByWorker(signals);
  const sideEffectsByWorker = groupRowsByWorker(sideEffects);
  const webhookIngressByWorker = groupRowsByWorker(webhookIngress);
  const workerPoliciesByWorker = groupRowsByWorker(workerPolicies, 'worker_id');

  const workersOverview = [];
  const topPromotionCandidates = [];
  const topUnstableRules = [];
  const recentVerifierFailures = [];
  const recentSideEffectFailures = [];
  const recentSideEffectReplays = [];
  const recentWebhookDeadLetters = [];
  const recentWebhookReplays = [];
  const recentWebhookAnomalies = [];
  const recentApprovalAnomalies = [];

  for (const worker of workers) {
    const workerId = worker.id;
    const charter = parseJsonField(worker.charter, {});
    const workerExecutions = executionsByWorker.get(workerId) || [];
    const workerApprovals = approvalsByWorker.get(workerId) || [];
    const workerSignals = signalsByWorker.get(workerId) || [];
    const workerSideEffects = sideEffectsByWorker.get(workerId) || [];
    const workerWebhookIngress = webhookIngressByWorker.get(workerId) || [];
    const workerPolicyRow = (workerPoliciesByWorker.get(workerId) || [])[0] || null;
    const effectiveRuntimePolicy = resolveWorkerRuntimePolicy({
      tenantOverrides: runtimePolicy || {},
      workerOverrides: workerPolicyRow?.policy || {},
    });
    const analytics = buildLearningAnalytics({
      charter,
      executions: workerExecutions,
      approvals: workerApprovals,
      signals: workerSignals,
      lookbackDays,
    });
    const sideEffectSummary = summarizeSideEffects(workerSideEffects);
    const webhookIngressSummary = summarizeWebhookIngress(workerWebhookIngress);
    const webhookAnomalies = summarizeWebhookAnomalies(
      workerWebhookIngress,
      effectiveRuntimePolicy?.effective?.webhooks?.thresholds || effectiveTenantRuntimePolicy?.webhooks?.thresholds || {}
    );
    const approvalDecision = resolveApprovalOverviewDecision(workerApprovals, effectiveRuntimePolicy);
    const approvalAnomalies = Array.isArray(approvalDecision?.anomalies)
      ? approvalDecision.anomalies.map((anomaly) => ({
        kind: anomaly?.kind || anomaly?.type || null,
        ...anomaly,
      }))
      : [];

    const verifierFailures = workerExecutions
      .map((execution) => {
        const receipt = parseReceipt(execution?.receipt);
        const report = receipt?.verificationReport || {};
        const assertions = Array.isArray(report?.assertions) ? report.assertions : [];
        const failedAssertions = assertions.filter((assertion) => assertion && assertion.passed === false);
        if (report?.businessOutcome !== 'failed' && failedAssertions.length === 0) {
          return null;
        }
        return {
          workerId,
          workerName: worker.name,
          executionId: execution.id || receipt.executionId || null,
          startedAt: execution.started_at || null,
          status: execution.status || null,
          businessOutcome: report?.businessOutcome || receipt?.businessOutcome || null,
          failedAssertions: failedAssertions.map((assertion) => ({
            type: assertion.type,
            evidence: assertion.evidence || null,
            actualValue: assertion.actualValue ?? null,
          })),
        };
      })
      .filter(Boolean);

    const interruptedExecutions = workerExecutions
      .map((execution) => {
        const receipt = parseReceipt(execution?.receipt);
        const interruption = receipt?.interruption || null;
        if (!interruption) return null;
        return {
          workerId,
          workerName: worker.name,
          executionId: execution.id || receipt.executionId || null,
          startedAt: execution.started_at || null,
          status: execution.status || null,
          code: typeof interruption === 'object' ? interruption.code || 'interrupted' : interruption,
          detail: typeof interruption === 'object' ? interruption.detail || null : null,
        };
      })
      .filter(Boolean);

    const pendingApprovals = workerApprovals.filter((approval) => String(approval?.status || '') === 'pending').length;
    const lastRunAt = workerExecutions[0]?.started_at || null;

    workersOverview.push({
      workerId,
      workerName: worker.name,
      lookbackDays,
      executionSummary: analytics.executionSummary,
      executionStatusCounts: analytics.executionStatusCounts,
      pendingApprovals,
      promotionCandidates: analytics.promotionCandidates,
      unstableRules: analytics.unstableRules,
      sideEffects: sideEffectSummary,
      webhookIngress: webhookIngressSummary,
      webhookAnomalies,
      approvalAnomalies,
      runtimePolicy: {
        workerOverride: Boolean(workerPolicyRow?.policy && Object.keys(workerPolicyRow.policy || {}).length > 0),
        workerPolicyUpdatedAt: workerPolicyRow?.updated_at || null,
      },
      verifierFailures: verifierFailures.length,
      interruptedExecutions: interruptedExecutions.length,
      lastRunAt,
      latestExecutionId: workerExecutions[0]?.id || null,
      riskScore:
        pendingApprovals
        + analytics.unstableRules.length
        + verifierFailures.length
        + sideEffectSummary.failed
        + sideEffectSummary.replayedOperations
        + webhookIngressSummary.deadLetters
        + webhookIngressSummary.replayedDeliveries
        + webhookAnomalies.length
        + approvalAnomalies.length,
    });

    for (const candidate of analytics.promotionCandidates) {
      topPromotionCandidates.push({
        workerId,
        workerName: worker.name,
        ...candidate,
      });
    }
    for (const unstableRule of analytics.unstableRules) {
      topUnstableRules.push({
        workerId,
        workerName: worker.name,
        ...unstableRule,
      });
    }
    recentVerifierFailures.push(...verifierFailures);

    for (const effect of workerSideEffects) {
      if (effect?.status === 'failed') {
        recentSideEffectFailures.push({
          workerId,
          workerName: worker.name,
          sideEffectId: effect.id || null,
          executionId: effect.execution_id || null,
          idempotencyKey: effect.idempotency_key || null,
          toolName: effect.tool_name,
          target: effect.target || null,
          error: effect.error_text || null,
          status: effect.status || null,
          updatedAt: effect.updated_at || effect.created_at || null,
          replayCount: Number(effect.replay_count || 0),
        });
      }
      if (Number(effect?.replay_count || 0) > 0) {
        recentSideEffectReplays.push({
          workerId,
          workerName: worker.name,
          sideEffectId: effect.id || null,
          executionId: effect.execution_id || null,
          idempotencyKey: effect.idempotency_key || null,
          toolName: effect.tool_name,
          target: effect.target || null,
          status: effect.status || null,
          providerRef: effect.provider_ref || null,
          replayCount: Number(effect.replay_count || 0),
          lastReplayedAt: effect.last_replayed_at || effect.updated_at || effect.created_at || null,
        });
      }
    }

    for (const ingress of workerWebhookIngress) {
      if (ingress?.status === 'dead_letter') {
        recentWebhookDeadLetters.push({
          workerId,
          workerName: worker.name,
          ingressId: ingress.id || null,
          executionId: ingress.execution_id || null,
          provider: ingress.provider || 'generic',
          dedupeKey: ingress.dedupe_key || null,
          requestPath: ingress.request_path || null,
          signatureScheme: ingress.signature_scheme || null,
          signatureStatus: ingress.signature_status || null,
          signatureError: ingress.signature_error || null,
          deadLetterReason: ingress.dead_letter_reason || null,
          replayCount: Number(ingress.replay_count || 0),
          updatedAt: ingress.updated_at || ingress.created_at || null,
        });
      }
      if (Number(ingress?.replay_count || 0) > 0) {
        recentWebhookReplays.push({
          workerId,
          workerName: worker.name,
          ingressId: ingress.id || null,
          executionId: ingress.execution_id || null,
          provider: ingress.provider || 'generic',
          dedupeKey: ingress.dedupe_key || null,
          requestPath: ingress.request_path || null,
          status: ingress.status || null,
          replayCount: Number(ingress.replay_count || 0),
          lastReplayedAt: ingress.last_replayed_at || ingress.updated_at || ingress.created_at || null,
        });
      }
    }

    for (const anomaly of webhookAnomalies) {
      recentWebhookAnomalies.push({
        workerId,
        workerName: worker.name,
        ...anomaly,
      });
    }
    for (const anomaly of approvalAnomalies) {
      recentApprovalAnomalies.push({
        workerId,
        workerName: worker.name,
        ...anomaly,
      });
    }
  }

  const tenantSideEffects = summarizeSideEffects(sideEffects);
  const tenantWebhookIngress = summarizeWebhookIngress(webhookIngress);

  workersOverview.sort((left, right) =>
    right.riskScore - left.riskScore
    || right.pendingApprovals - left.pendingApprovals
    || left.workerName.localeCompare(right.workerName)
  );

  topPromotionCandidates.sort((left, right) => right.confidence - left.confidence || left.action.localeCompare(right.action));
  topUnstableRules.sort((left, right) =>
    right.denied - left.denied
    || right.failedSignals - left.failedSignals
    || left.rule.localeCompare(right.rule)
  );
  recentVerifierFailures.sort((left, right) => Date.parse(right.startedAt || '') - Date.parse(left.startedAt || ''));
  recentSideEffectFailures.sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''));
  recentSideEffectReplays.sort((left, right) => Date.parse(right.lastReplayedAt || '') - Date.parse(left.lastReplayedAt || ''));
  recentWebhookDeadLetters.sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''));
  recentWebhookReplays.sort((left, right) => Date.parse(right.lastReplayedAt || '') - Date.parse(left.lastReplayedAt || ''));
  recentWebhookAnomalies.sort((left, right) =>
    Date.parse(right.latestAt || '') - Date.parse(left.latestAt || '')
    || right.count - left.count
    || left.workerName.localeCompare(right.workerName)
  );
  recentApprovalAnomalies.sort((left, right) =>
    Date.parse(right.latestAt || '') - Date.parse(left.latestAt || '')
    || right.count - left.count
    || left.workerName.localeCompare(right.workerName)
  );

  return {
    lookbackDays,
    summary: {
      workersEvaluated: workersOverview.length,
      totalRecentRuns: workersOverview.reduce((sum, worker) => sum + Number(worker.executionSummary?.totalRecentRuns || 0), 0),
      pendingApprovals: workersOverview.reduce((sum, worker) => sum + Number(worker.pendingApprovals || 0), 0),
      promotionCandidates: topPromotionCandidates.length,
      unstableRules: topUnstableRules.length,
      verifierFailures: recentVerifierFailures.length,
      interruptedExecutions: workersOverview.reduce((sum, worker) => sum + Number(worker.interruptedExecutions || 0), 0),
      sideEffects: tenantSideEffects,
      webhookIngress: tenantWebhookIngress,
      webhookAnomalies: recentWebhookAnomalies.length,
      approvalAnomalies: recentApprovalAnomalies.length,
    },
    workers: workersOverview,
    topPromotionCandidates: topPromotionCandidates.slice(0, 20),
    topUnstableRules: topUnstableRules.slice(0, 20),
    recentVerifierFailures: recentVerifierFailures.slice(0, 20),
    recentSideEffectFailures: recentSideEffectFailures.slice(0, 20),
    recentSideEffectReplays: recentSideEffectReplays.slice(0, 20),
    recentWebhookDeadLetters: recentWebhookDeadLetters.slice(0, 20),
    recentWebhookReplays: recentWebhookReplays.slice(0, 20),
    recentWebhookAnomalies: recentWebhookAnomalies.slice(0, 20),
    recentApprovalAnomalies: recentApprovalAnomalies.slice(0, 20),
  };
}

function normalizeLookbackDays(value, fallback = 30) {
  const parsed = parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 365);
}

function normalizeListLimit(value, fallback = 20, max = 200) {
  const parsed = parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function fetchTenantLearningOverview(pool, tenantId, lookbackDays = 30) {
  const normalizedLookbackDays = normalizeLookbackDays(lookbackDays);
  const cutoffIso = new Date(Date.now() - normalizedLookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const [runtimePolicyRecord, workersResult, executionsResult, approvalsResult, signalsResult, sideEffectsResult, webhookIngressResult, workerPoliciesResult] = await Promise.all([
    getTenantWorkerRuntimePolicy(pool, tenantId, { fresh: true }),
    pool.query(
      `SELECT id, name, charter
         FROM workers
        WHERE tenant_id = $1 AND status != 'archived'
        ORDER BY name ASC
        LIMIT 500`,
      [tenantId]
    ),
    pool.query(
      `SELECT id, worker_id, status, started_at, completed_at, receipt
         FROM worker_executions
        WHERE tenant_id = $1
          AND started_at >= $2
        ORDER BY started_at DESC
        LIMIT 5000`,
      [tenantId, cutoffIso]
    ),
    pool.query(
      `SELECT worker_id, tool_name, matched_rule, status, decision, decided_at, created_at
         FROM worker_approvals
        WHERE tenant_id = $1
          AND created_at >= $2
        ORDER BY created_at DESC
        LIMIT 5000`,
      [tenantId, cutoffIso]
    ),
    pool.query(
      `SELECT worker_id, tool_name, args_hash, charter_verdict, approval_decision, matched_rule,
              tool_success, interruption_code, execution_outcome, created_at
         FROM learning_signals
        WHERE tenant_id = $1
          AND created_at >= $2
        ORDER BY created_at DESC
        LIMIT 5000`,
      [tenantId, cutoffIso]
    ),
    pool.query(
      `SELECT id, worker_id, execution_id, tool_name, idempotency_key, status, target, amount_usd,
              provider_ref, error_text, replay_count, last_replayed_at, created_at, updated_at
         FROM worker_tool_side_effects
        WHERE tenant_id = $1
          AND created_at >= $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 5000`,
      [tenantId, cutoffIso]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT id, worker_id, execution_id, provider, dedupe_key, request_path, content_type,
              signature_scheme, signature_status, signature_error, status, replay_count,
              last_replayed_at, dead_letter_reason, processed_at, created_at, updated_at
         FROM worker_webhook_ingress
        WHERE tenant_id = $1
          AND created_at >= $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 5000`,
      [tenantId, cutoffIso]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT worker_id, policy, updated_at, updated_by
         FROM worker_runtime_policy_overrides
        WHERE tenant_id = $1
        ORDER BY updated_at DESC
        LIMIT 5000`,
      [tenantId]
    ).catch(() => ({ rows: [] })),
  ]);

  return buildTenantLearningOverview({
    workers: workersResult.rows,
    executions: executionsResult.rows,
    approvals: approvalsResult.rows,
    signals: signalsResult.rows,
    sideEffects: sideEffectsResult.rows,
    webhookIngress: webhookIngressResult.rows,
    workerPolicies: workerPoliciesResult.rows,
    runtimePolicy: runtimePolicyRecord.overrides,
    lookbackDays: normalizedLookbackDays,
  });
}

function normalizeApprovalRecord(record = {}) {
  return {
    id: record.id || null,
    executionId: record.execution_id || null,
    toolName: record.tool_name || null,
    action: record.action || null,
    matchedRule: record.matched_rule || null,
    actionHash: record.action_hash || null,
    status: record.status || null,
    decision: record.decision || null,
    decidedBy: record.decided_by || null,
    decidedAt: record.decided_at || null,
    createdAt: record.created_at || null,
    toolArgs: parseJsonField(record.tool_args, null),
  };
}

function normalizeSideEffectRecord(record = {}, { includePayloads = false } = {}) {
  const normalized = {
    id: record.id || null,
    executionId: record.execution_id || null,
    toolName: record.tool_name || null,
    idempotencyKey: record.idempotency_key || null,
    status: record.status || null,
    target: record.target || null,
    amountUsd: record.amount_usd == null ? null : Number(record.amount_usd),
    providerRef: record.provider_ref || null,
    error: record.error_text || null,
    replayCount: Number(record.replay_count || 0),
    lastReplayedAt: record.last_replayed_at || null,
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
  };
  if (includePayloads) {
    normalized.requestJson = parseJsonField(record.request_json, null);
    normalized.responseJson = parseJsonField(record.response_json, null);
  }
  return normalized;
}

function normalizeWebhookIngressRecord(record = {}, { includeEvidence = false } = {}) {
  const normalized = {
    id: record.id || null,
    executionId: record.execution_id || null,
    provider: record.provider || 'generic',
    dedupeKey: record.dedupe_key || null,
    requestPath: record.request_path || null,
    contentType: record.content_type || null,
    signatureScheme: record.signature_scheme || null,
    signatureStatus: record.signature_status || null,
    signatureError: record.signature_error || null,
    status: record.status || null,
    replayCount: Number(record.replay_count || 0),
    lastReplayedAt: record.last_replayed_at || null,
    deadLetterReason: record.dead_letter_reason || null,
    createdAt: record.created_at || null,
    updatedAt: record.updated_at || null,
    processedAt: record.processed_at || null,
  };

  if (includeEvidence) {
    normalized.headers = parseJsonField(record.headers_json, {});
    normalized.payload = parseJsonField(record.payload_json, null);
    normalized.rawBody = record.raw_body || '';
    normalized.normalizedEvent = normalizeWorkerWebhookEvent({
      payload: normalized.payload,
      headers: normalized.headers,
      contentType: normalized.contentType,
      config: { webhook: { provider: normalized.provider } },
    });
    normalized.channel = normalized.normalizedEvent?.channel || null;
    normalized.eventType = normalized.normalizedEvent?.eventType || null;
    normalized.eventId = normalized.normalizedEvent?.id || null;
  }

  return normalized;
}

function normalizeExecutionDrilldown(worker, execution, approvals = [], sideEffects = []) {
  const receipt = parseReceipt(execution?.receipt);
  const tokensIn = Number(execution?.tokens_in || 0);
  const tokensOut = Number(execution?.tokens_out || 0);
  const cost = Number(execution?.cost_usd || 0);

  return {
    id: execution?.id || null,
    workerId: worker?.id || execution?.worker_id || null,
    workerName: worker?.name || null,
    triggerType: execution?.trigger_type || null,
    status: execution?.status || null,
    model: execution?.model || null,
    startedAt: execution?.started_at || null,
    completedAt: execution?.completed_at || null,
    tokensIn,
    tokensOut,
    tokens: tokensIn + tokensOut,
    totalTokens: tokensIn + tokensOut,
    cost,
    rounds: Number(execution?.rounds || 0),
    toolCalls: Number(execution?.tool_calls || 0),
    result: execution?.result || '',
    error: execution?.error || null,
    activity: parseActivity(execution?.activity),
    receipt,
    verificationReport: receipt?.verificationReport || null,
    interruption: receipt?.interruption || null,
    metadata: parseJsonField(execution?.metadata, {}),
    approvals,
    sideEffects,
  };
}

async function fetchWorkerIdentity(pool, workerId, tenantId) {
  const result = await pool.query(
    'SELECT id, name FROM workers WHERE id = $1 AND tenant_id = $2',
    [workerId, tenantId]
  );
  return result.rows[0] || null;
}

async function fetchExecutionRow(pool, { workerId, tenantId, executionId = null }) {
  if (executionId) {
    const result = await pool.query(
      `SELECT id, worker_id, trigger_type, status, model, started_at, completed_at,
              tokens_in, tokens_out, cost_usd, rounds, tool_calls, result, error, activity, receipt, metadata
         FROM worker_executions
        WHERE id = $1 AND worker_id = $2 AND tenant_id = $3`,
      [executionId, workerId, tenantId]
    );
    return result.rows[0] || null;
  }

  const result = await pool.query(
    `SELECT id, worker_id, trigger_type, status, model, started_at, completed_at,
            tokens_in, tokens_out, cost_usd, rounds, tool_calls, result, error, activity, receipt, metadata
       FROM worker_executions
      WHERE worker_id = $1 AND tenant_id = $2
      ORDER BY started_at DESC
      LIMIT 1`,
    [workerId, tenantId]
  );
  return result.rows[0] || null;
}

async function fetchExecutionApprovals(pool, { workerId, tenantId, executionId }) {
  const result = await pool.query(
    `SELECT id, execution_id, tool_name, action, matched_rule, action_hash, status, decision,
            decided_by, decided_at, created_at, tool_args
       FROM worker_approvals
      WHERE worker_id = $1 AND tenant_id = $2 AND execution_id = $3
      ORDER BY created_at ASC, decided_at ASC NULLS LAST`,
    [workerId, tenantId, executionId]
  );
  return result.rows.map((row) => normalizeApprovalRecord(row));
}

async function fetchExecutionSideEffects(pool, { workerId, tenantId, executionId, includePayloads = false }) {
  const selectPayloads = includePayloads ? ', request_json, response_json' : '';
  const result = await pool.query(
    `SELECT id, execution_id, tool_name, idempotency_key, status, target, amount_usd,
            provider_ref, error_text, replay_count, last_replayed_at, created_at, updated_at${selectPayloads}
       FROM worker_tool_side_effects
      WHERE worker_id = $1 AND tenant_id = $2 AND execution_id = $3
      ORDER BY updated_at DESC, created_at DESC`,
    [workerId, tenantId, executionId]
  );
  return result.rows.map((row) => normalizeSideEffectRecord(row, { includePayloads }));
}

async function loadExecutionDrilldown(pool, { workerId, tenantId, executionId = null }) {
  const worker = await fetchWorkerIdentity(pool, workerId, tenantId);
  if (!worker) return null;

  const execution = await fetchExecutionRow(pool, { workerId, tenantId, executionId });
  if (!execution) return { worker, execution: null, approvals: [], sideEffects: [] };

  const [approvals, sideEffects] = await Promise.all([
    fetchExecutionApprovals(pool, { workerId, tenantId, executionId: execution.id }),
    fetchExecutionSideEffects(pool, { workerId, tenantId, executionId: execution.id, includePayloads: true }).catch(() => []),
  ]);

  return {
    worker,
    execution: normalizeExecutionDrilldown(worker, execution, approvals, sideEffects),
    approvals,
    sideEffects,
  };
}

async function fetchWorkerSideEffects(pool, {
  workerId,
  tenantId,
  toolName = null,
  status = null,
  idempotencyKey = null,
  executionId = null,
  replayedOnly = false,
  limit = 20,
} = {}) {
  const conditions = ['worker_id = $1', 'tenant_id = $2'];
  const params = [workerId, tenantId];
  let nextIndex = params.length + 1;

  if (toolName) {
    conditions.push(`tool_name = $${nextIndex}`);
    params.push(toolName);
    nextIndex += 1;
  }
  if (status) {
    conditions.push(`status = $${nextIndex}`);
    params.push(status);
    nextIndex += 1;
  }
  if (idempotencyKey) {
    conditions.push(`idempotency_key = $${nextIndex}`);
    params.push(idempotencyKey);
    nextIndex += 1;
  }
  if (executionId) {
    conditions.push(`execution_id = $${nextIndex}`);
    params.push(executionId);
    nextIndex += 1;
  }
  if (replayedOnly) {
    conditions.push('COALESCE(replay_count, 0) > 0');
  }

  const normalizedLimit = normalizeListLimit(limit);
  params.push(normalizedLimit);

  const result = await pool.query(
    `SELECT id, execution_id, tool_name, idempotency_key, status, target, amount_usd,
            provider_ref, error_text, replay_count, last_replayed_at, created_at, updated_at
       FROM worker_tool_side_effects
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return result.rows.map((row) => normalizeSideEffectRecord(row));
}

async function fetchWorkerSideEffectDetail(pool, { workerId, tenantId, sideEffectId }) {
  const result = await pool.query(
    `SELECT id, execution_id, tool_name, idempotency_key, status, target, amount_usd,
            provider_ref, error_text, replay_count, last_replayed_at, request_json, response_json,
            created_at, updated_at
       FROM worker_tool_side_effects
      WHERE id = $1 AND worker_id = $2 AND tenant_id = $3`,
    [sideEffectId, workerId, tenantId]
  );
  return result.rowCount > 0 ? normalizeSideEffectRecord(result.rows[0], { includePayloads: true }) : null;
}

async function fetchWorkerWebhookIngress(pool, {
  workerId,
  tenantId,
  status = null,
  provider = null,
  executionId = null,
  limit = 20,
} = {}) {
  const conditions = ['worker_id = $1', 'tenant_id = $2'];
  const params = [workerId, tenantId];
  let nextIndex = params.length + 1;

  if (status) {
    conditions.push(`status = $${nextIndex}`);
    params.push(status);
    nextIndex += 1;
  }
  if (provider) {
    conditions.push(`provider = $${nextIndex}`);
    params.push(provider);
    nextIndex += 1;
  }
  if (executionId) {
    conditions.push(`execution_id = $${nextIndex}`);
    params.push(executionId);
    nextIndex += 1;
  }

  const normalizedLimit = normalizeListLimit(limit);
  params.push(normalizedLimit);
  const result = await pool.query(
    `SELECT id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
            signature_status, signature_error, status, replay_count, last_replayed_at,
            dead_letter_reason, created_at, updated_at, processed_at
       FROM worker_webhook_ingress
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT $${params.length}`,
    params
  ).catch(() => ({ rows: [] }));

  return result.rows.map((row) => normalizeWebhookIngressRecord(row));
}

async function fetchRecentWebhookIngressForPolicy(pool, {
  workerId,
  tenantId,
  provider,
  lookbackHours = 24,
  limit = 200,
} = {}) {
  const lookbackMs = Math.max(Number(lookbackHours || 24), 1) * 60 * 60 * 1000;
  const cutoffIso = new Date(Date.now() - lookbackMs).toISOString();
  const normalizedLimit = normalizeListLimit(limit, 200, 500);
  const result = await pool.query(
    `SELECT id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
            signature_status, signature_error, status, replay_count, last_replayed_at,
            dead_letter_reason, processed_at, created_at, updated_at
       FROM worker_webhook_ingress
      WHERE worker_id = $1
        AND tenant_id = $2
        AND provider = $3
        AND created_at >= $4
      ORDER BY updated_at DESC, created_at DESC
      LIMIT $5`,
    [workerId, tenantId, provider || 'generic', cutoffIso, normalizedLimit]
  ).catch(() => ({ rows: [] }));

  return result.rows;
}

async function fetchWorkerWebhookIngressDetail(pool, { workerId, tenantId, ingressId }) {
  const result = await pool.query(
    `SELECT id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
            signature_status, signature_error, status, replay_count, last_replayed_at,
            dead_letter_reason, headers_json, payload_json, raw_body, created_at, updated_at, processed_at
       FROM worker_webhook_ingress
      WHERE id = $1 AND worker_id = $2 AND tenant_id = $3`,
    [ingressId, workerId, tenantId]
  ).catch(() => ({ rowCount: 0, rows: [] }));

  return result.rowCount > 0 ? normalizeWebhookIngressRecord(result.rows[0], { includeEvidence: true }) : null;
}

async function lookupWorkerWebhookIngress(pool, { workerId, tenantId, dedupeKey }) {
  const result = await pool.query(
    `SELECT id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
            signature_status, signature_error, status, replay_count, last_replayed_at,
            dead_letter_reason, created_at, updated_at, processed_at
       FROM worker_webhook_ingress
      WHERE worker_id = $1 AND tenant_id = $2 AND dedupe_key = $3`,
    [workerId, tenantId, dedupeKey]
  ).catch(() => ({ rowCount: 0, rows: [] }));
  return result.rowCount > 0 ? normalizeWebhookIngressRecord(result.rows[0]) : null;
}

async function incrementWorkerWebhookReplay(pool, { workerId, tenantId, dedupeKey }) {
  const result = await pool.query(
    `UPDATE worker_webhook_ingress
        SET replay_count = COALESCE(replay_count, 0) + 1,
            last_replayed_at = NOW(),
            updated_at = NOW()
      WHERE worker_id = $1 AND tenant_id = $2 AND dedupe_key = $3
      RETURNING id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
                signature_status, signature_error, status, replay_count, last_replayed_at,
                dead_letter_reason, created_at, updated_at, processed_at`,
    [workerId, tenantId, dedupeKey]
  ).catch(() => ({ rowCount: 0, rows: [] }));
  return result.rowCount > 0 ? normalizeWebhookIngressRecord(result.rows[0]) : null;
}

async function insertWorkerWebhookIngress(pool, {
  id,
  workerId,
  tenantId,
  provider,
  dedupeKey,
  requestPath,
  contentType,
  signatureScheme,
  signatureStatus,
  signatureError = null,
  status,
  headersJson,
  payloadJson,
  rawBody,
  deadLetterReason = null,
} = {}) {
  const result = await pool.query(
    `INSERT INTO worker_webhook_ingress (
       id, tenant_id, worker_id, provider, dedupe_key, request_path, content_type,
       signature_scheme, signature_status, signature_error, status, headers_json,
       payload_json, raw_body, dead_letter_reason, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12::jsonb,
       $13::jsonb, $14, $15, NOW(), NOW()
     )
     ON CONFLICT (tenant_id, worker_id, dedupe_key) DO NOTHING
     RETURNING id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
               signature_status, signature_error, status, replay_count, last_replayed_at,
               dead_letter_reason, created_at, updated_at, processed_at`,
    [
      id,
      tenantId,
      workerId,
      provider || 'generic',
      dedupeKey,
      requestPath,
      contentType || null,
      signatureScheme || null,
      signatureStatus || 'not_required',
      signatureError,
      status,
      JSON.stringify(headersJson || {}),
      payloadJson == null ? null : JSON.stringify(payloadJson),
      rawBody || '',
      deadLetterReason,
    ]
  ).catch(() => ({ rowCount: 0, rows: [] }));

  return result.rowCount > 0 ? normalizeWebhookIngressRecord(result.rows[0]) : null;
}

async function attachExecutionToWorkerWebhookIngress(pool, { workerId, tenantId, dedupeKey, executionId }) {
  const result = await pool.query(
    `UPDATE worker_webhook_ingress
        SET execution_id = $4,
            processed_at = NOW(),
            updated_at = NOW()
      WHERE worker_id = $1 AND tenant_id = $2 AND dedupe_key = $3
      RETURNING id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
                signature_status, signature_error, status, replay_count, last_replayed_at,
                dead_letter_reason, created_at, updated_at, processed_at`,
    [workerId, tenantId, dedupeKey, executionId]
  ).catch(() => ({ rowCount: 0, rows: [] }));
  return result.rowCount > 0 ? normalizeWebhookIngressRecord(result.rows[0]) : null;
}

async function markWorkerWebhookDeadLetter(pool, {
  workerId,
  tenantId,
  dedupeKey,
  signatureError = null,
  deadLetterReason = null,
} = {}) {
  const result = await pool.query(
    `UPDATE worker_webhook_ingress
        SET status = 'dead_letter',
            signature_error = COALESCE($4, signature_error),
            dead_letter_reason = COALESCE($5, dead_letter_reason),
            updated_at = NOW()
      WHERE worker_id = $1 AND tenant_id = $2 AND dedupe_key = $3
      RETURNING id, execution_id, provider, dedupe_key, request_path, content_type, signature_scheme,
                signature_status, signature_error, status, replay_count, last_replayed_at,
                dead_letter_reason, created_at, updated_at, processed_at`,
    [workerId, tenantId, dedupeKey, signatureError, deadLetterReason]
  ).catch(() => ({ rowCount: 0, rows: [] }));
  return result.rowCount > 0 ? normalizeWebhookIngressRecord(result.rows[0]) : null;
}

export function buildPendingRiskQueue(overview, { limit = 20 } = {}) {
  const normalizedLimit = normalizeListLimit(limit);
  const workers = Array.isArray(overview?.workers) ? overview.workers : [];
  const items = workers
    .filter((worker) =>
      Number(worker?.riskScore || 0) > 0
      || Number(worker?.pendingApprovals || 0) > 0
      || Number(worker?.verifierFailures || 0) > 0
      || Number(worker?.interruptedExecutions || 0) > 0
      || Number(worker?.sideEffects?.failed || 0) > 0
      || Number(worker?.sideEffects?.replayedOperations || 0) > 0
      || Number(worker?.webhookIngress?.deadLetters || 0) > 0
      || Number(worker?.webhookIngress?.replayedDeliveries || 0) > 0
      || (Array.isArray(worker?.webhookAnomalies) && worker.webhookAnomalies.length > 0)
      || (Array.isArray(worker?.approvalAnomalies) && worker.approvalAnomalies.length > 0)
      || (Array.isArray(worker?.unstableRules) && worker.unstableRules.length > 0)
    )
    .map((worker) => {
      const reasons = [];
      if (worker.pendingApprovals > 0) reasons.push(`${worker.pendingApprovals} pending approval(s)`);
      if (worker.verifierFailures > 0) reasons.push(`${worker.verifierFailures} verifier failure(s)`);
      if (worker.interruptedExecutions > 0) reasons.push(`${worker.interruptedExecutions} interrupted execution(s)`);
      if (worker.sideEffects?.failed > 0) reasons.push(`${worker.sideEffects.failed} failed side effect(s)`);
      if (worker.sideEffects?.replayedOperations > 0) reasons.push(`${worker.sideEffects.replayedOperations} replayed side effect(s)`);
      if (worker.webhookIngress?.deadLetters > 0) reasons.push(`${worker.webhookIngress.deadLetters} dead-lettered webhook(s)`);
      if (worker.webhookIngress?.replayedDeliveries > 0) reasons.push(`${worker.webhookIngress.replayedDeliveries} replayed webhook delivery(s)`);
      if (Array.isArray(worker.webhookAnomalies) && worker.webhookAnomalies.length > 0) reasons.push(`${worker.webhookAnomalies.length} webhook anomaly alert(s)`);
      if (Array.isArray(worker.approvalAnomalies) && worker.approvalAnomalies.length > 0) reasons.push(`${worker.approvalAnomalies.length} approval anomaly alert(s)`);
      if (Array.isArray(worker.unstableRules) && worker.unstableRules.length > 0) {
        reasons.push(`${worker.unstableRules.length} unstable charter rule(s)`);
      }
      return {
        workerId: worker.workerId,
        workerName: worker.workerName,
        riskScore: worker.riskScore,
        pendingApprovals: worker.pendingApprovals,
        verifierFailures: worker.verifierFailures,
        interruptedExecutions: worker.interruptedExecutions,
        unstableRules: Array.isArray(worker.unstableRules) ? worker.unstableRules.length : 0,
        failedSideEffects: Number(worker.sideEffects?.failed || 0),
        replayedSideEffects: Number(worker.sideEffects?.replayedOperations || 0),
        deadLetteredWebhooks: Number(worker.webhookIngress?.deadLetters || 0),
        replayedWebhooks: Number(worker.webhookIngress?.replayedDeliveries || 0),
        webhookAnomalies: Array.isArray(worker.webhookAnomalies) ? worker.webhookAnomalies.length : 0,
        approvalAnomalies: Array.isArray(worker.approvalAnomalies) ? worker.approvalAnomalies.length : 0,
        lastRunAt: worker.lastRunAt || null,
        latestExecutionId: worker.latestExecutionId || null,
        reasons,
      };
    })
    .sort((left, right) =>
      right.riskScore - left.riskScore
      || right.pendingApprovals - left.pendingApprovals
      || right.verifierFailures - left.verifierFailures
      || left.workerName.localeCompare(right.workerName)
    );

  return {
    items: items.slice(0, normalizedLimit),
    count: items.length,
  };
}

// =========================================================================
// Team Generation — Industry Templates & Role Definitions (inlined)
// =========================================================================

const TEAM_INDUSTRY_TEMPLATES = {
  dental:       { roles: ['receptionist', 'scheduler', 'follow_up', 'reviews', 'billing', 'customer_support'] },
  medical:      { roles: ['receptionist', 'scheduler', 'follow_up', 'billing', 'customer_support', 'reviews'] },
  legal:        { roles: ['receptionist', 'scheduler', 'follow_up', 'billing', 'customer_support', 'reviews'] },
  restaurant:   { roles: ['receptionist', 'reviews', 'customer_support', 'scheduler', 'follow_up', 'billing'] },
  salon:        { roles: ['receptionist', 'scheduler', 'reviews', 'follow_up', 'customer_support', 'billing'] },
  fitness:      { roles: ['receptionist', 'scheduler', 'follow_up', 'reviews', 'billing', 'customer_support'] },
  realestate:   { roles: ['follow_up', 'scheduler', 'customer_support', 'reviews', 'receptionist', 'billing'] },
  ecommerce:    { roles: ['customer_support', 'reviews', 'follow_up', 'billing', 'receptionist', 'scheduler'] },
  consulting:   { roles: ['scheduler', 'follow_up', 'billing', 'receptionist', 'reviews', 'customer_support'] },
  general:      { roles: ['receptionist', 'scheduler', 'follow_up', 'reviews', 'billing', 'customer_support'] },
};

const TEAM_ROLE_DEFINITIONS = {
  receptionist: {
    nameTemplate: '{business} Receptionist',
    purpose: 'Greet customers, answer common questions, and route inquiries for {business}',
    canDo: ['answer FAQs', 'greet visitors', 'route messages to staff', 'collect contact info'],
    askFirst: ['schedule appointments on behalf of staff', 'share pricing details'],
    neverDo: ['provide medical/legal advice', 'process payments', 'access private records'],
    capabilities: ['chat'],
    schedule: { type: 'always_on' },
    taskType: 'communication',
  },
  scheduler: {
    nameTemplate: '{business} Scheduler',
    purpose: 'Manage appointment booking and calendar coordination for {business}',
    canDo: ['check availability', 'book appointments', 'send confirmations', 'reschedule appointments'],
    askFirst: ['cancel appointments', 'double-book time slots'],
    neverDo: ['access patient/client records', 'modify pricing', 'override staff schedules'],
    capabilities: ['calendar', 'chat'],
    schedule: { type: 'always_on' },
    taskType: 'scheduling',
  },
  follow_up: {
    nameTemplate: '{business} Follow-Up',
    purpose: 'Send follow-up messages and reminders to customers of {business}',
    canDo: ['send appointment reminders', 'follow up after visits', 'request feedback', 'send thank-you messages'],
    askFirst: ['offer discounts or promotions', 'contact customers more than twice'],
    neverDo: ['spam customers', 'share customer info externally', 'make medical/legal claims'],
    capabilities: ['email', 'chat'],
    schedule: { type: 'cron', value: '0 9 * * *' },
    taskType: 'outreach',
  },
  reviews: {
    nameTemplate: '{business} Review Manager',
    purpose: 'Monitor and respond to online reviews for {business}',
    canDo: ['request reviews from happy customers', 'draft review responses', 'flag negative reviews', 'track review trends'],
    askFirst: ['publish responses to negative reviews', 'offer compensation for bad experiences'],
    neverDo: ['write fake reviews', 'threaten reviewers', 'disclose private information'],
    capabilities: ['web', 'chat'],
    schedule: { type: 'cron', value: '0 10 * * *' },
    taskType: 'monitoring',
  },
  billing: {
    nameTemplate: '{business} Billing Assistant',
    purpose: 'Handle billing inquiries and invoice management for {business}',
    canDo: ['answer billing questions', 'send invoice reminders', 'explain charges', 'track payment status'],
    askFirst: ['issue refunds', 'adjust invoice amounts', 'set up payment plans'],
    neverDo: ['process payments directly', 'access full credit card numbers', 'waive fees without approval'],
    capabilities: ['chat', 'email'],
    schedule: { type: 'cron', value: '0 8 * * 1' },
    taskType: 'finance',
  },
  customer_support: {
    nameTemplate: '{business} Support Agent',
    purpose: 'Provide frontline customer support and issue resolution for {business}',
    canDo: ['answer product/service questions', 'troubleshoot common issues', 'escalate complex problems', 'log support tickets'],
    askFirst: ['issue refunds or credits', 'make exceptions to policies'],
    neverDo: ['make promises outside policy', 'share internal documents', 'access admin systems'],
    capabilities: ['chat', 'email'],
    schedule: { type: 'always_on' },
    taskType: 'support',
  },
};

const INDUSTRY_KEYWORDS = {
  dental:     ['dental', 'dentist', 'orthodont', 'teeth', 'oral'],
  medical:    ['medical', 'clinic', 'doctor', 'health', 'hospital', 'physician', 'therapy', 'chiropr'],
  legal:      ['legal', 'law', 'attorney', 'lawyer', 'paralegal'],
  restaurant: ['restaurant', 'cafe', 'diner', 'food', 'catering', 'bistro', 'bar', 'grill'],
  salon:      ['salon', 'barber', 'spa', 'beauty', 'hair', 'nail', 'skincare'],
  fitness:    ['fitness', 'gym', 'yoga', 'pilates', 'crossfit', 'training', 'martial arts'],
  realestate: ['real estate', 'realtor', 'property', 'brokerage', 'housing'],
  ecommerce:  ['ecommerce', 'e-commerce', 'online store', 'shop', 'retail', 'marketplace'],
  consulting: ['consulting', 'advisory', 'consultant', 'agency', 'firm'],
};

function detectIndustryFromDescription(desc) {
  if (typeof desc !== 'string' || !desc.trim()) return 'general';
  const lower = desc.toLowerCase();
  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return industry;
    }
  }
  return 'general';
}

function extractBusinessName(desc) {
  if (typeof desc !== 'string' || !desc.trim()) return 'My Business';
  // Try to find a proper noun-like phrase (consecutive capitalized words)
  const match = desc.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
  if (match && match[1].length > 2) return match[1];
  // Fallback: first few meaningful words
  const words = desc.trim().split(/\s+/).slice(0, 3).join(' ');
  return words || 'My Business';
}

/**
 * Handle a /v1/workers* request. Returns true if handled, false if not matched.
 */
export async function handleWorkerRoute(req, res, pool, pathname, searchParams) {
  // Rate limit by tenant or IP
  const rateLimitKey = getTenantId(req) || req.socket?.remoteAddress || 'unknown';
  if (!checkApiRateLimit(rateLimitKey)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
    return true;
  }

  const method = req.method;

  // POST /v1/workers — create
  if (method === 'POST' && pathname === '/v1/workers') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (!body.name?.trim()) return err(res, 400, 'name is required'), true;

    // Validate charter rules for prompt injection
    if (body.charter) {
      const parsedCharter = typeof body.charter === 'string' ? JSON.parse(body.charter) : body.charter;
      const validation = validateCharterRules(parsedCharter);
      if (!validation.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid charter rules', details: validation.errors }));
        return true;
      }
    }

    const id = generateId('wrk');
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO workers (id, tenant_id, name, description, charter, schedule, model, provider_mode, byok_provider, knowledge, triggers, chain, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, tid, body.name.trim(), body.description ?? null,
       JSON.stringify(body.charter ?? {}), body.schedule ? JSON.stringify(body.schedule) : null,
       body.model ?? 'google/gemini-2.5-flash', body.provider_mode ?? 'platform',
       body.byok_provider ?? null, JSON.stringify(body.knowledge ?? []),
       JSON.stringify(body.triggers ?? []), body.chain ? JSON.stringify(body.chain) : null, now, now]
    );
    return json(res, 201, { worker: result.rows[0] }), true;
  }

  // GET /v1/workers — list
  if (method === 'GET' && pathname === '/v1/workers') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const status = searchParams.get('status');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50') || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0') || 0, 0);

    let q, p;
    if (status && VALID_STATUSES.has(status)) {
      q = `SELECT * FROM workers WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
      p = [tid, status, limit, offset];
    } else {
      q = `SELECT * FROM workers WHERE tenant_id = $1 AND status != 'archived' ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      p = [tid, limit, offset];
    }
    const result = await pool.query(q, p);
    return json(res, 200, { workers: result.rows, count: result.rowCount }), true;
  }

  // GET /v1/workers/runtime-policy — effective tenant worker runtime enforcement policy
  if (method === 'GET' && pathname === '/v1/workers/runtime-policy') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      return json(res, 200, await getTenantWorkerRuntimePolicy(pool, tid, { fresh: true })), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to load worker runtime policy'), true;
    }
  }

  // PUT /v1/workers/runtime-policy — replace tenant worker runtime enforcement overrides
  if (method === 'PUT' && pathname === '/v1/workers/runtime-policy') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return err(res, 400, 'invalid JSON body'), true;
    }
    try {
      const updatedBy = typeof req.headers['x-user-email'] === 'string' && req.headers['x-user-email'].trim()
        ? req.headers['x-user-email'].trim()
        : null;
      return json(res, 200, await putTenantWorkerRuntimePolicy(pool, tid, body, { updatedBy })), true;
    } catch (e) {
      return err(res, 400, e?.message || 'invalid worker runtime policy'), true;
    }
  }

  const workerRuntimePolicyMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/runtime-policy$/);
  if (workerRuntimePolicyMatch && method === 'GET') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = workerRuntimePolicyMatch[1];
    const workerResult = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
    if (workerResult.rowCount === 0) return err(res, 404, 'worker not found'), true;
    try {
      return json(res, 200, await getWorkerRuntimePolicy(pool, tid, workerId, { fresh: true })), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to load worker runtime policy'), true;
    }
  }

  if (workerRuntimePolicyMatch && method === 'PUT') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = workerRuntimePolicyMatch[1];
    const workerResult = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
    if (workerResult.rowCount === 0) return err(res, 404, 'worker not found'), true;
    const body = await readBody(req);
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return err(res, 400, 'invalid JSON body'), true;
    }
    try {
      const updatedBy = typeof req.headers['x-user-email'] === 'string' && req.headers['x-user-email'].trim()
        ? req.headers['x-user-email'].trim()
        : null;
      return json(res, 200, await putWorkerRuntimePolicy(pool, tid, workerId, body, { updatedBy })), true;
    } catch (e) {
      return err(res, 400, e?.message || 'invalid worker runtime policy'), true;
    }
  }

  // GET /v1/workers/learning/overview — tenant-wide explainability and risk summary
  if (method === 'GET' && pathname === '/v1/workers/learning/overview') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      return json(res, 200, await fetchTenantLearningOverview(pool, tid, lookbackDays)), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to build tenant learning overview'), true;
    }
  }

  // GET /v1/workers/verification/failures — recent verifier failures across the tenant
  if (method === 'GET' && pathname === '/v1/workers/verification/failures') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      const limit = normalizeListLimit(searchParams.get('limit') || '20');
      const overview = await fetchTenantLearningOverview(pool, tid, lookbackDays);
      return json(res, 200, {
        lookbackDays,
        failures: overview.recentVerifierFailures.slice(0, limit),
        count: overview.recentVerifierFailures.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query verifier failures'), true;
    }
  }

  // GET /v1/workers/side-effects/replays — recent replayed outbound side effects
  if (method === 'GET' && pathname === '/v1/workers/side-effects/replays') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      const limit = normalizeListLimit(searchParams.get('limit') || '20');
      const overview = await fetchTenantLearningOverview(pool, tid, lookbackDays);
      return json(res, 200, {
        lookbackDays,
        replays: overview.recentSideEffectReplays.slice(0, limit),
        count: overview.recentSideEffectReplays.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query replayed side effects'), true;
    }
  }

  // GET /v1/workers/webhooks/dead-letters — recent dead-lettered inbound webhook deliveries
  if (method === 'GET' && pathname === '/v1/workers/webhooks/dead-letters') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      const limit = normalizeListLimit(searchParams.get('limit') || '20');
      const overview = await fetchTenantLearningOverview(pool, tid, lookbackDays);
      return json(res, 200, {
        lookbackDays,
        deadLetters: overview.recentWebhookDeadLetters.slice(0, limit),
        count: overview.recentWebhookDeadLetters.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query dead-lettered webhooks'), true;
    }
  }

  // GET /v1/workers/webhooks/replays — recent replayed inbound webhook deliveries
  if (method === 'GET' && pathname === '/v1/workers/webhooks/replays') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      const limit = normalizeListLimit(searchParams.get('limit') || '20');
      const overview = await fetchTenantLearningOverview(pool, tid, lookbackDays);
      return json(res, 200, {
        lookbackDays,
        replays: overview.recentWebhookReplays.slice(0, limit),
        count: overview.recentWebhookReplays.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query replayed webhooks'), true;
    }
  }

  // GET /v1/workers/webhooks/anomalies — recent inbound webhook anomaly alerts
  if (method === 'GET' && pathname === '/v1/workers/webhooks/anomalies') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      const limit = normalizeListLimit(searchParams.get('limit') || '20');
      const overview = await fetchTenantLearningOverview(pool, tid, lookbackDays);
      return json(res, 200, {
        lookbackDays,
        anomalies: overview.recentWebhookAnomalies.slice(0, limit),
        count: overview.recentWebhookAnomalies.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query webhook anomalies'), true;
    }
  }

  // GET /v1/workers/approvals/anomalies — recent approval anomaly alerts
  if (method === 'GET' && pathname === '/v1/workers/approvals/anomalies') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      const limit = normalizeListLimit(searchParams.get('limit') || '20');
      const overview = await fetchTenantLearningOverview(pool, tid, lookbackDays);
      return json(res, 200, {
        lookbackDays,
        anomalies: overview.recentApprovalAnomalies.slice(0, limit),
        count: overview.recentApprovalAnomalies.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query approval anomalies'), true;
    }
  }

  // GET /v1/workers/risk/queue — operator queue of workers that need attention
  if (method === 'GET' && pathname === '/v1/workers/risk/queue') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const lookbackDays = normalizeLookbackDays(searchParams.get('days') || '30');
      const limit = normalizeListLimit(searchParams.get('limit') || '20');
      const overview = await fetchTenantLearningOverview(pool, tid, lookbackDays);
      const queue = buildPendingRiskQueue(overview, { limit });
      return json(res, 200, {
        lookbackDays,
        ...queue,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to build pending risk queue'), true;
    }
  }

  // GET /v1/workers/:id
  const idMatch = pathname.match(/^\/v1\/workers\/([^/]+)$/);
  if (method === 'GET' && idMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const result = await pool.query(`SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`, [idMatch[1], tid]);
    if (result.rowCount === 0) return err(res, 404, 'worker not found'), true;
    return json(res, 200, { worker: result.rows[0] }), true;
  }

  // PUT /v1/workers/:id — update
  if (method === 'PUT' && idMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) return err(res, 400, `invalid status: ${body.status}`), true;

    // Save current state as a version before applying updates
    try {
      const current = await pool.query(`SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`, [idMatch[1], tid]);
      if (current.rowCount > 0) {
        const lastVersion = await pool.query(
          `SELECT COALESCE(MAX(version), 0) AS max_v FROM worker_versions WHERE worker_id = $1`, [idMatch[1]]
        );
        const nextVersion = (lastVersion.rows[0].max_v || 0) + 1;
        const row = current.rows[0];
        await pool.query(
          `INSERT INTO worker_versions (id, worker_id, tenant_id, version, config, created_at, created_by)
           VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
          [generateId('wver'), idMatch[1], tid, nextVersion, JSON.stringify(row), tid]
        );
      }
    } catch { /* versioning is best-effort, don't block the update */ }

    const sets = [], vals = [];
    let pi = 1;
    for (const f of UPDATABLE) {
      if (body[f] !== undefined) {
        sets.push(`${f} = $${pi}`);
        vals.push(JSON_FIELDS.has(f) ? JSON.stringify(body[f]) : body[f]);
        pi++;
      }
    }
    if (sets.length === 0) return err(res, 400, 'no updatable fields'), true;
    sets.push(`updated_at = $${pi}`); vals.push(new Date().toISOString()); pi++;
    vals.push(idMatch[1], tid);

    const result = await pool.query(
      `UPDATE workers SET ${sets.join(', ')} WHERE id = $${pi} AND tenant_id = $${pi + 1} RETURNING *`, vals
    );
    if (result.rowCount === 0) return err(res, 404, 'worker not found'), true;
    return json(res, 200, { worker: result.rows[0] }), true;
  }

  // DELETE /v1/workers/:id — archive
  if (method === 'DELETE' && idMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const result = await pool.query(
      `UPDATE workers SET status = 'archived', updated_at = $1 WHERE id = $2 AND tenant_id = $3 AND status != 'archived' RETURNING *`,
      [new Date().toISOString(), idMatch[1], tid]
    );
    if (result.rowCount === 0) return err(res, 404, 'worker not found'), true;
    return json(res, 200, { worker: result.rows[0] }), true;
  }

  // POST /v1/workers/:id/run — manual trigger
  const runMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/run$/);
  if (method === 'POST' && runMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wr = await pool.query(`SELECT id, model, status FROM workers WHERE id = $1 AND tenant_id = $2`, [runMatch[1], tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    if (wr.rows[0].status === 'archived') return err(res, 409, 'cannot run archived worker'), true;
    if (wr.rows[0].status === 'paused') return err(res, 409, 'cannot run paused worker'), true;

    const body = await readBody(req);
    const isShadow = searchParams.get('shadow') === 'true' || body?.shadow === true;
    const triggerType = isShadow ? 'shadow' : 'manual';

    // Resolve session_id: use provided session_id, or create one from goal
    let sessionId = body?.session_id || null;
    if (!sessionId && body?.goal) {
      const { getOrCreateSession } = await import('./sessions.ts');
      const session = await getOrCreateSession(pool, runMatch[1], tid, { goal: body.goal.trim() });
      if (session) sessionId = session.id;
    }

    const execId = generateId('exec');
    const insertCols = ['id', 'worker_id', 'tenant_id', 'trigger_type', 'status', 'model', 'started_at'];
    const insertVals = [execId, runMatch[1], tid, triggerType, 'queued', wr.rows[0].model, new Date().toISOString()];
    if (sessionId) {
      insertCols.push('session_id');
      insertVals.push(sessionId);
    }
    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `INSERT INTO worker_executions (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      insertVals
    );
    return json(res, 202, { execution: result.rows[0] }), true;
  }

  // GET /v1/workers/:id/logs — execution history
  const logsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/logs$/);
  if (method === 'GET' && logsMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50') || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0') || 0, 0);
    const status = searchParams.get('status');

    let q, p;
    if (status) {
      q = `SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 AND status = $3 ORDER BY started_at DESC LIMIT $4 OFFSET $5`;
      p = [logsMatch[1], tid, status, limit, offset];
    } else {
      q = `SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY started_at DESC LIMIT $3 OFFSET $4`;
      p = [logsMatch[1], tid, limit, offset];
    }
    const result = await pool.query(q, p);
    return json(res, 200, { executions: result.rows, count: result.rowCount }), true;
  }

  // GET /v1/workers/:id/executions/latest — latest execution drilldown
  const latestExecutionMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/executions\/latest$/);
  if (method === 'GET' && latestExecutionMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const detail = await loadExecutionDrilldown(pool, { workerId: latestExecutionMatch[1], tenantId: tid });
      if (!detail?.worker) return err(res, 404, 'worker not found'), true;
      if (!detail.execution) return err(res, 404, 'execution not found'), true;
      return json(res, 200, detail.execution), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch latest execution'), true;
    }
  }

  // GET /v1/workers/:id/executions/:execId/verification — execution verification drilldown
  const verificationDetailMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/executions\/([^/]+)\/verification$/);
  if (method === 'GET' && verificationDetailMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const [, workerId, executionId] = verificationDetailMatch;
      const detail = await loadExecutionDrilldown(pool, { workerId, tenantId: tid, executionId });
      if (!detail?.worker) return err(res, 404, 'worker not found'), true;
      if (!detail.execution) return err(res, 404, 'execution not found'), true;
      return json(res, 200, detail.execution), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch execution verification detail'), true;
    }
  }

  // GET /v1/workers/:id/executions/:execId/approvals — approval timeline for one execution
  const approvalsTimelineMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/executions\/([^/]+)\/approvals$/);
  if (method === 'GET' && approvalsTimelineMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const [, workerId, executionId] = approvalsTimelineMatch;
      const worker = await fetchWorkerIdentity(pool, workerId, tid);
      if (!worker) return err(res, 404, 'worker not found'), true;
      const approvals = await fetchExecutionApprovals(pool, { workerId, tenantId: tid, executionId });
      return json(res, 200, {
        workerId,
        workerName: worker.name,
        executionId,
        approvals,
        count: approvals.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch execution approvals'), true;
    }
  }

  // GET /v1/workers/:id/executions/:execId/trace — structured execution trace
  const traceMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/executions\/([^/]+)\/trace$/);
  if (method === 'GET' && traceMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const [, workerId, executionId] = traceMatch;
      const worker = await fetchWorkerIdentity(pool, workerId, tid);
      if (!worker) return err(res, 404, 'worker not found'), true;
      // Verify execution belongs to this worker/tenant
      const execCheck = await pool.query(
        'SELECT id FROM worker_executions WHERE id = $1 AND worker_id = $2 AND tenant_id = $3',
        [executionId, workerId, tid]
      );
      if (execCheck.rowCount === 0) return err(res, 404, 'Execution not found'), true;
      const trace = await getExecutionTrace(pool, executionId);
      return json(res, 200, {
        workerId,
        workerName: worker.name,
        executionId,
        trace,
        count: trace.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch execution trace'), true;
    }
  }

  // GET /v1/workers/:id/executions/:execId — execution drilldown
  const executionDetailMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/executions\/([^/]+)$/);
  if (method === 'GET' && executionDetailMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const [, workerId, executionId] = executionDetailMatch;
      const detail = await loadExecutionDrilldown(pool, { workerId, tenantId: tid, executionId });
      if (!detail?.worker) return err(res, 404, 'worker not found'), true;
      if (!detail.execution) return err(res, 404, 'execution not found'), true;
      return json(res, 200, detail.execution), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch execution detail'), true;
    }
  }

  // GET /v1/workers/:id/side-effects — worker side-effect journal list
  const workerSideEffectsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/side-effects$/);
  if (method === 'GET' && workerSideEffectsMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const workerId = workerSideEffectsMatch[1];
      const worker = await fetchWorkerIdentity(pool, workerId, tid);
      if (!worker) return err(res, 404, 'worker not found'), true;
      const sideEffects = await fetchWorkerSideEffects(pool, {
        workerId,
        tenantId: tid,
        toolName: searchParams.get('tool'),
        status: searchParams.get('status'),
        idempotencyKey: searchParams.get('idempotencyKey'),
        executionId: searchParams.get('executionId'),
        replayedOnly: searchParams.get('replayed') === 'true',
        limit: searchParams.get('limit') || '20',
      });
      return json(res, 200, {
        workerId,
        workerName: worker.name,
        sideEffects,
        count: sideEffects.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch worker side effects'), true;
    }
  }

  // GET /v1/workers/:id/side-effects/:sideEffectId — side-effect journal detail
  const workerSideEffectDetailMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/side-effects\/([^/]+)$/);
  if (method === 'GET' && workerSideEffectDetailMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const [, workerId, sideEffectId] = workerSideEffectDetailMatch;
      const worker = await fetchWorkerIdentity(pool, workerId, tid);
      if (!worker) return err(res, 404, 'worker not found'), true;
      const sideEffect = await fetchWorkerSideEffectDetail(pool, { workerId, tenantId: tid, sideEffectId });
      if (!sideEffect) return err(res, 404, 'side effect not found'), true;
      return json(res, 200, {
        workerId,
        workerName: worker.name,
        sideEffect,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch side effect detail'), true;
    }
  }

  // GET /v1/workers/:id/webhooks — inbound webhook ingress journal
  const workerWebhookListMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/webhooks$/);
  if (method === 'GET' && workerWebhookListMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const workerId = workerWebhookListMatch[1];
      const worker = await fetchWorkerIdentity(pool, workerId, tid);
      if (!worker) return err(res, 404, 'worker not found'), true;
      const ingress = await fetchWorkerWebhookIngress(pool, {
        workerId,
        tenantId: tid,
        status: searchParams.get('status'),
        provider: searchParams.get('provider'),
        executionId: searchParams.get('executionId'),
        limit: searchParams.get('limit') || '20',
      });
      return json(res, 200, {
        workerId,
        workerName: worker.name,
        ingress,
        count: ingress.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch webhook ingress'), true;
    }
  }

  // GET /v1/workers/:id/webhooks/:ingressId — inbound webhook ingress detail
  const workerWebhookDetailMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/webhooks\/([^/]+)$/);
  if (method === 'GET' && workerWebhookDetailMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const [, workerId, ingressId] = workerWebhookDetailMatch;
      const worker = await fetchWorkerIdentity(pool, workerId, tid);
      if (!worker) return err(res, 404, 'worker not found'), true;
      const ingress = await fetchWorkerWebhookIngressDetail(pool, { workerId, tenantId: tid, ingressId });
      if (!ingress) return err(res, 404, 'webhook ingress not found'), true;
      return json(res, 200, {
        workerId,
        workerName: worker.name,
        ingress,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch webhook ingress detail'), true;
    }
  }

  // POST /v1/workers/:id/trigger — webhook trigger
  // POST /v1/workers/:id/trigger/test — manual test trigger
  // Note: webhook triggers use header auth since webhooks don't have browser sessions
  const trigMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/trigger(\/test)?$/);
  if (method === 'POST' && trigMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const isTest = trigMatch[2] === '/test';
    const wr = await pool.query(`SELECT id, model, status, triggers FROM workers WHERE id = $1 AND tenant_id = $2`, [trigMatch[1], tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    const worker = wr.rows[0];
    const workerRuntimePolicyRecord = await getWorkerRuntimePolicy(pool, tid, worker.id, { fresh: true });
    const triggers = typeof worker.triggers === 'string' ? JSON.parse(worker.triggers) : (worker.triggers || {});
    const webhookConfig = normalizeWorkerWebhookConfig(triggers);
    let rawBody = '';
    let contentType = '';
    let parsedPayload = null;
    let payload = null;
    let normalizedWebhookEvent = null;
    let verification = {
      provider: webhookConfig.provider,
      scheme: webhookConfig.sharedSecret && !isTest ? 'shared_secret' : 'none',
      status: webhookConfig.sharedSecret && !isTest ? 'verified' : 'not_required',
    };

    try {
      const incoming = await readWorkerWebhookRequest(req);
      rawBody = incoming.rawBody;
      contentType = incoming.contentType;
      parsedPayload = parseWorkerWebhookPayload(rawBody, contentType);
      payload =
        parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload) && Object.prototype.hasOwnProperty.call(parsedPayload, 'payload')
          ? parsedPayload.payload
          : parsedPayload;
      normalizedWebhookEvent = normalizeWorkerWebhookEvent({
        payload: parsedPayload,
        headers: req.headers,
        contentType,
        config: triggers,
      });
      verification = verifyWorkerWebhookRequest({
        rawBody,
        payload: parsedPayload,
        headers: req.headers,
        config: triggers,
        req,
        isTest,
      });
    } catch (e) {
      if (e instanceof WorkerWebhookIngressError && e.statusCode === 413) {
        return err(res, e.statusCode, e.message), true;
      }
      const dedupeKey = computeWorkerWebhookDedupeKey({
        rawBody,
        payload: parsedPayload,
        headers: req.headers,
        config: triggers,
      });
      const existing = await lookupWorkerWebhookIngress(pool, { workerId: worker.id, tenantId: tid, dedupeKey });
      if (existing) {
        const replay = await incrementWorkerWebhookReplay(pool, { workerId: worker.id, tenantId: tid, dedupeKey }) || existing;
        return json(res, 409, {
          error: 'duplicate webhook event previously dead-lettered',
          duplicate: true,
          ingress: replay,
        }), true;
      }

      const rejectedIngress = await insertWorkerWebhookIngress(pool, {
        id: generateId('whi'),
        workerId: worker.id,
        tenantId: tid,
        provider: webhookConfig.provider,
        dedupeKey,
        requestPath: req.url || pathname,
        contentType,
        signatureScheme: verification.scheme || null,
        signatureStatus: 'rejected',
        signatureError: e?.message || 'webhook rejected',
        status: 'dead_letter',
        headersJson: sanitizeWorkerWebhookHeaders(req.headers),
        payloadJson: parsedPayload,
        rawBody,
        deadLetterReason: buildWorkerWebhookDeadLetterCode(e?.message || 'ingress_rejected'),
      });
      const recentPolicyRows = await fetchRecentWebhookIngressForPolicy(pool, {
        workerId: worker.id,
        tenantId: tid,
        provider: webhookConfig.provider,
      });
      const enforcement = resolveWebhookEnforcementDecision(recentPolicyRows, {
        policy: workerRuntimePolicyRecord?.effective?.webhooks || {},
      });
      if (enforcement.action === 'auto_pause') {
        await autoPauseWorker(pool, worker.id, null, enforcement.anomalies.map((anomaly) => anomaly.reason));
        worker.status = 'paused';
        return json(res, enforcement.statusCode, {
          error: enforcement.reason,
          ingress: rejectedIngress,
          enforcement,
        }), true;
      }
      return err(res, e?.statusCode || 400, e?.message || 'invalid webhook payload'), true;
    }

    const dedupeKey = computeWorkerWebhookDedupeKey({
      rawBody,
      payload: parsedPayload,
      headers: req.headers,
      config: triggers,
    });
    const existing = await lookupWorkerWebhookIngress(pool, { workerId: worker.id, tenantId: tid, dedupeKey });
    if (existing) {
      const replay = await incrementWorkerWebhookReplay(pool, { workerId: worker.id, tenantId: tid, dedupeKey }) || existing;
      if (replay.executionId) {
        return json(res, 200, {
          ok: true,
          duplicate: true,
          executionId: replay.executionId,
          ingress: replay,
        }), true;
      }
      return json(res, 409, {
        error: 'duplicate webhook event previously dead-lettered',
        duplicate: true,
        ingress: replay,
      }), true;
    }

    const policyProvider = verification.provider || webhookConfig.provider;
    const recentPolicyRows = await fetchRecentWebhookIngressForPolicy(pool, {
      workerId: worker.id,
      tenantId: tid,
      provider: policyProvider,
    });
    const enforcement = resolveWebhookEnforcementDecision(recentPolicyRows, {
      policy: workerRuntimePolicyRecord?.effective?.webhooks || {},
    });
    let forceApprovalReentry = enforcement.forceApprovalReentry === true;

    if (enforcement.action === 'auto_pause' || enforcement.action === 'cooldown') {
      const blockedIngress = await insertWorkerWebhookIngress(pool, {
        id: generateId('whi'),
        workerId: worker.id,
        tenantId: tid,
        provider: policyProvider,
        dedupeKey,
        requestPath: req.url || pathname,
        contentType,
        signatureScheme: verification.scheme || null,
        signatureStatus: verification.status || 'verified',
        status: 'dead_letter',
        headersJson: sanitizeWorkerWebhookHeaders(req.headers),
        payloadJson: parsedPayload,
        rawBody,
        deadLetterReason: enforcement.code,
      });
      if (enforcement.action === 'auto_pause') {
        await autoPauseWorker(pool, worker.id, null, enforcement.anomalies.map((anomaly) => anomaly.reason));
        worker.status = 'paused';
      }
      return json(res, enforcement.statusCode, {
        error: enforcement.reason,
        ingress: blockedIngress,
        enforcement,
      }), true;
    }

    if (worker.status !== 'ready' && worker.status !== 'running') {
      const ingress = await insertWorkerWebhookIngress(pool, {
        id: generateId('whi'),
        workerId: worker.id,
        tenantId: tid,
        provider: verification.provider || webhookConfig.provider,
        dedupeKey,
        requestPath: req.url || pathname,
        contentType,
        signatureScheme: verification.scheme || null,
        signatureStatus: verification.status || 'verified',
        status: 'dead_letter',
        headersJson: sanitizeWorkerWebhookHeaders(req.headers),
        payloadJson: parsedPayload,
        rawBody,
        deadLetterReason: 'worker_unavailable',
      });
      return json(res, 409, {
        error: `cannot trigger worker in '${worker.status}' status`,
        ingress,
      }), true;
    }

    const ingress = await insertWorkerWebhookIngress(pool, {
      id: generateId('whi'),
      workerId: worker.id,
      tenantId: tid,
      provider: verification.provider || webhookConfig.provider,
      dedupeKey,
      requestPath: req.url || pathname,
      contentType,
      signatureScheme: verification.scheme || null,
      signatureStatus: verification.status || 'verified',
      status: 'accepted',
      headersJson: sanitizeWorkerWebhookHeaders(req.headers),
      payloadJson: parsedPayload,
      rawBody,
    });
    if (!ingress) {
      const raced = await lookupWorkerWebhookIngress(pool, { workerId: worker.id, tenantId: tid, dedupeKey });
      const replay = raced ? (await incrementWorkerWebhookReplay(pool, { workerId: worker.id, tenantId: tid, dedupeKey }) || raced) : null;
      if (replay?.executionId) {
        return json(res, 200, { ok: true, duplicate: true, executionId: replay.executionId, ingress: replay }), true;
      }
      return json(res, 409, {
        error: 'duplicate webhook event previously dead-lettered',
        duplicate: true,
        ingress: replay,
      }), true;
    }

    const triggerType = isTest ? 'manual_test' : 'webhook';

    const execId = generateId('exec');
    const now = new Date().toISOString();
    const initialActivity = [
      {
        timestamp: now,
        ts: now,
        type: 'webhook_ingress',
        message: `${verification.provider || webhookConfig.provider} webhook received`,
        data: {
          ingressId: ingress.id,
          dedupeKey,
          signatureScheme: verification.scheme || null,
          signatureStatus: verification.status || 'verified',
        },
      },
    ];
    if (payload != null) {
      initialActivity.push({
        timestamp: now,
        ts: now,
        type: 'webhook_payload',
        detail: JSON.stringify(payload).slice(0, 10000),
      });
    }
    if (normalizedWebhookEvent) {
      initialActivity.push({
        timestamp: now,
        ts: now,
        type: 'webhook_normalized',
        data: {
          provider: normalizedWebhookEvent.provider,
          channel: normalizedWebhookEvent.channel || null,
          eventType: normalizedWebhookEvent.eventType || null,
          eventId: normalizedWebhookEvent.id || null,
          from: normalizedWebhookEvent.from?.address || null,
          to: Array.isArray(normalizedWebhookEvent.to)
            ? normalizedWebhookEvent.to.map((entry) => entry?.address || entry?.normalized || null).filter(Boolean)
            : [],
          subject: normalizedWebhookEvent.subject || null,
        },
      });
    }
    if (forceApprovalReentry) {
      initialActivity.push({
        timestamp: now,
        ts: now,
        type: 'webhook_policy',
        message: enforcement.reason || 'Webhook anomaly policy requires approval re-entry',
        data: {
          code: enforcement.code,
          cooldownUntil: enforcement.cooldownUntil || null,
          anomalies: enforcement.anomalies,
          policyContext: {
            version: workerRuntimePolicyRecord.version,
            tenantUpdatedAt: workerRuntimePolicyRecord.scopes?.tenant?.updatedAt || null,
            workerUpdatedAt: workerRuntimePolicyRecord.scopes?.worker?.updatedAt || null,
          },
        },
      });
    }

    try {
      const result = await pool.query(
        `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at, activity, metadata)
         VALUES ($1,$2,$3,$4,'queued',$5,$6,$7::jsonb,$8::jsonb) RETURNING *`,
        [
          execId,
          trigMatch[1],
          tid,
          triggerType,
          worker.model,
          now,
          JSON.stringify(initialActivity),
          JSON.stringify({
            webhookIngressId: ingress.id,
            webhookDedupeKey: dedupeKey,
            webhookProvider: verification.provider || webhookConfig.provider,
            webhookEvent: normalizedWebhookEvent,
            forceApprovalReentry,
            webhookPolicyCode: enforcement.code,
            webhookPolicyReason: enforcement.reason,
            webhookPolicyAnomalies: enforcement.anomalies,
            webhookPolicyContext: {
              version: workerRuntimePolicyRecord.version,
              tenantUpdatedAt: workerRuntimePolicyRecord.scopes?.tenant?.updatedAt || null,
              workerUpdatedAt: workerRuntimePolicyRecord.scopes?.worker?.updatedAt || null,
            },
          }),
        ]
      );
      await attachExecutionToWorkerWebhookIngress(pool, { workerId: worker.id, tenantId: tid, dedupeKey, executionId: execId });
      return json(res, 202, {
        ok: true,
        executionId: execId,
        ingressId: ingress.id,
        execution: result.rows[0],
      }), true;
    } catch (e) {
      await markWorkerWebhookDeadLetter(pool, {
        workerId: worker.id,
        tenantId: tid,
        dedupeKey,
        signatureError: e?.message || 'failed to enqueue webhook execution',
        deadLetterReason: 'enqueue_failed',
      });
      return err(res, 500, e?.message || 'failed to enqueue webhook execution'), true;
    }
  }

  // GET /v1/workers/:id/trust — trust progression for a worker
  const trustMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/trust$/);
  if (method === 'GET' && trustMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = trustMatch[1];

    try {
      // Get worker
      const workerResult = await pool.query(
        'SELECT * FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]
      );
      if (workerResult.rowCount === 0) return err(res, 404, 'worker not found'), true;
      const worker = workerResult.rows[0];

      // Get recent executions
      const execResult = await pool.query(
        `SELECT status, cost_usd, tool_calls, rounds, started_at, completed_at, receipt
         FROM worker_executions
         WHERE worker_id = $1 AND tenant_id = $2
         ORDER BY started_at DESC LIMIT 100`,
        [workerId, tid]
      );
      const executions = execResult.rows;

      // Get pending approvals count
      const approvalResult = await pool.query(
        `SELECT COUNT(*) as pending FROM worker_approvals
         WHERE worker_id = $1 AND tenant_id = $2 AND status = 'pending'`,
        [workerId, tid]
      );
      const approvalHistoryResult = await pool.query(
        `SELECT matched_rule, action, status, decision, decided_at, created_at
         FROM worker_approvals
         WHERE worker_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC
         LIMIT 500`,
        [workerId, tid]
      );

      // Compute trust metrics using shared classification from trust-learning.js
      const allTime = summarizeExecutionOutcomes(executions, 36500); // ~100 years = all time
      const totalRuns = allTime.terminalRecentRuns;
      const successRuns = allTime.successfulRecentRuns;
      const failedRuns = allTime.failedRecentRuns;
      const successRate = allTime.recentSuccessRate;

      // 7-day window
      const recent7d = summarizeExecutionOutcomes(executions, 7);
      const recentRate = recent7d.recentSuccessRate;

      // Compute trust level based on run history
      // OBSERVING: < 10 runs or < 50% success
      // SUPERVISED: 10-25 runs and >= 70% success
      // TRUSTED: 25-50 runs and >= 85% success
      // AUTONOMOUS: 50+ runs and >= 95% success
      let trustLevel = 'observing';
      let trustScore = 0;

      if (totalRuns >= 50 && successRate >= 95) {
        trustLevel = 'autonomous';
        trustScore = Math.min(100, 80 + Math.round(successRate * 0.2));
      } else if (totalRuns >= 25 && successRate >= 85) {
        trustLevel = 'trusted';
        trustScore = Math.min(80, 50 + Math.round(successRate * 0.3));
      } else if (totalRuns >= 10 && successRate >= 70) {
        trustLevel = 'supervised';
        trustScore = Math.min(50, 20 + Math.round(successRate * 0.3));
      } else {
        trustLevel = 'observing';
        trustScore = totalRuns > 0 ? Math.min(20, Math.round(totalRuns * 2)) : 0;
      }

      // Parse charter for promotion candidates
      let promotionCandidates = [];
      try {
        const charter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : worker.charter;
        promotionCandidates = analyzePromotionCandidates({
          charter,
          executions,
          approvals: approvalHistoryResult.rows,
          lookbackDays: 30,
          minApprovedActions: 5,
          minRecentSuccessRate: 90,
        });
      } catch { /* ignore parse errors */ }

      const nextLevel = trustLevel === 'observing' ? 'supervised'
        : trustLevel === 'supervised' ? 'trusted'
        : trustLevel === 'trusted' ? 'autonomous'
        : null;

      const runsNeeded = trustLevel === 'observing' ? Math.max(0, 10 - totalRuns)
        : trustLevel === 'supervised' ? Math.max(0, 25 - totalRuns)
        : trustLevel === 'trusted' ? Math.max(0, 50 - totalRuns)
        : 0;

      return json(res, 200, {
        workerId,
        workerName: worker.name,
        trustLevel,
        trustScore,
        nextLevel,
        runsUntilNextLevel: runsNeeded,
        successRateRequired: nextLevel === 'supervised' ? 70 : nextLevel === 'trusted' ? 85 : nextLevel === 'autonomous' ? 95 : null,
        stats: {
          totalRuns,
          successRuns,
          failedRuns,
          successRate,
          recentWindow: {
            days: 7,
            runs: recent7d.totalRecentRuns,
            successRate: recentRate
          }
        },
        pendingApprovals: parseInt(approvalResult.rows[0]?.pending || '0'),
        promotionCandidates,
        lastRunAt: executions[0]?.started_at || null
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'trust computation failed'), true;
    }
  }

  // GET /v1/workers/:id/signals — learning signal history
  const signalsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/signals$/);
  if (method === 'GET' && signalsMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = signalsMatch[1];
    try {
      const lookbackDays = parseInt(searchParams.get('days') || '30', 10);
      const signals = await querySignalsForWorker(pool, workerId, tid, { lookbackDays });
      return json(res, 200, { signals, count: signals.length }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to query signals'), true;
    }
  }

  // GET /v1/workers/:id/learning — explainable learning analytics
  const learningMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/learning$/);
  if (method === 'GET' && learningMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = learningMatch[1];
    try {
      const lookbackDays = parseInt(searchParams.get('days') || '30', 10);
      const workerResult = await pool.query(
        'SELECT id, name, charter FROM workers WHERE id = $1 AND tenant_id = $2',
        [workerId, tid]
      );
      if (workerResult.rowCount === 0) return err(res, 404, 'worker not found'), true;

      const [executionsResult, approvalsResult] = await Promise.all([
        pool.query(
          `SELECT status, started_at, completed_at, receipt
           FROM worker_executions
           WHERE worker_id = $1 AND tenant_id = $2
           ORDER BY started_at DESC LIMIT 500`,
          [workerId, tid]
        ),
        pool.query(
          `SELECT matched_rule, status, decision, decided_at, created_at
           FROM worker_approvals
           WHERE worker_id = $1 AND tenant_id = $2
           ORDER BY created_at DESC LIMIT 500`,
          [workerId, tid]
        ),
      ]);

      const signals = await querySignalsForWorker(pool, workerId, tid, { lookbackDays, limit: 2000 });
      const worker = workerResult.rows[0];
      const charter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : (worker.charter || {});
      const analytics = buildLearningAnalytics({
        charter,
        executions: executionsResult.rows,
        approvals: approvalsResult.rows,
        signals,
        lookbackDays,
      });

      return json(res, 200, {
        workerId,
        workerName: worker.name,
        ...analytics,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to build learning analytics'), true;
    }
  }

  // GET /v1/workers/:id/proposals — list pending charter change proposals
  const proposalsListMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/proposals$/);
  if (method === 'GET' && proposalsListMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = proposalsListMatch[1];
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    try {
      const { listPendingProposals } = await import('./charter-evolution.ts');
      const proposals = await listPendingProposals(pool, workerId);
      return json(res, 200, { proposals }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to list proposals'), true;
    }
  }

  // POST /v1/workers/:id/proposals/generate — trigger charter change proposal generation
  const proposalsGenerateMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/proposals\/generate$/);
  if (method === 'POST' && proposalsGenerateMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = proposalsGenerateMatch[1];
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    try {
      const { generateProposals } = await import('./charter-evolution.ts');
      const proposals = await generateProposals(pool, workerId, tid);
      return json(res, 200, { generated: proposals.length, proposals }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to generate proposals'), true;
    }
  }

  // POST /v1/workers/:id/proposals/:proposalId/approve — approve and apply a charter change
  const proposalApproveMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/proposals\/([^/]+)\/approve$/);
  if (method === 'POST' && proposalApproveMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = proposalApproveMatch[1];
    const proposalId = proposalApproveMatch[2];
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    // Verify proposal belongs to this worker/tenant and is pending
    const propCheck = await pool.query(
      'SELECT id FROM charter_proposals WHERE id = $1 AND worker_id = $2 AND tenant_id = $3 AND status = $4',
      [proposalId, workerId, tid, 'pending']
    );
    if (propCheck.rowCount === 0) return err(res, 404, 'Proposal not found'), true;
    const body = await readBody(req);
    try {
      const { applyProposal } = await import('./charter-evolution.ts');
      const result = await applyProposal(pool, proposalId, body?.decided_by || 'dashboard');
      return json(res, 200, result), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to approve proposal'), true;
    }
  }

  // POST /v1/workers/:id/proposals/:proposalId/reject — reject a charter change proposal
  const proposalRejectMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/proposals\/([^/]+)\/reject$/);
  if (method === 'POST' && proposalRejectMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = proposalRejectMatch[1];
    const proposalId = proposalRejectMatch[2];
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    // Verify proposal belongs to this worker/tenant and is pending
    const propCheck = await pool.query(
      'SELECT id FROM charter_proposals WHERE id = $1 AND worker_id = $2 AND tenant_id = $3 AND status = $4',
      [proposalId, workerId, tid, 'pending']
    );
    if (propCheck.rowCount === 0) return err(res, 404, 'Proposal not found'), true;
    const body = await readBody(req);
    try {
      const { rejectProposal } = await import('./charter-evolution.ts');
      await rejectProposal(pool, proposalId, body?.decided_by || 'dashboard');
      return json(res, 200, { status: 'rejected' }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to reject proposal'), true;
    }
  }

  // GET /v1/workers/:id/feed — SSE activity feed (uses header auth for SSE compatibility)
  const feedMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/feed$/);
  if (method === 'GET' && feedMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [feedMatch[1], tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const recent = await pool.query(`SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY started_at DESC LIMIT 10`, [feedMatch[1], tid]);
    res.write(`event: snapshot\ndata: ${JSON.stringify({ executions: recent.rows })}\n\n`);

    const lastSeen = { v: new Date().toISOString() };
    const poll = setInterval(async () => {
      try {
        const nw = await pool.query(`SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 AND started_at > $3 ORDER BY started_at ASC`, [feedMatch[1], tid, lastSeen.v]);
        for (const r of nw.rows) res.write(`event: execution\ndata: ${JSON.stringify(r)}\n\n`);
        if (nw.rowCount > 0) lastSeen.v = nw.rows[nw.rowCount - 1].started_at;
      } catch {}
    }, 2000);
    const ka = setInterval(() => { try { res.write(':keepalive\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(poll); clearInterval(ka); });
    return true;
  }

  // GET /v1/workers/:id/executions/:execId/stream — SSE execution streaming (uses header auth for SSE compatibility)
  const streamMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/executions\/([^/]+)\/stream$/);
  if (method === 'GET' && streamMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const [, workerId, execId] = streamMatch;

    // Validate execution belongs to worker and tenant
    const execResult = await pool.query(
      `SELECT * FROM worker_executions WHERE id = $1 AND worker_id = $2 AND tenant_id = $3`,
      [execId, workerId, tid]
    );
    if (execResult.rowCount === 0) return err(res, 404, 'execution not found'), true;

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send current state immediately
    const exec = execResult.rows[0];
    const currentActivity = typeof exec.activity === 'string' ? JSON.parse(exec.activity) : (exec.activity || []);
    res.write(`data: ${JSON.stringify({ type: 'status', status: exec.status, executionId: execId })}\n\n`);
    for (const entry of currentActivity) {
      res.write(`data: ${JSON.stringify({ type: 'activity', entry })}\n\n`);
    }

    // If already completed, send final event and close
    const TERMINAL_STATUSES = new Set(WORKER_EXECUTION_TERMINAL_STATUSES);
    if (TERMINAL_STATUSES.has(exec.status)) {
      res.write(`data: ${JSON.stringify({ type: 'complete', status: exec.status, result: exec.result?.slice(0, 10000) || null })}\n\n`);
      res.end();
      return true;
    }

    // Poll for new activity entries and status changes
    let lastActivityCount = currentActivity.length;
    let lastStatus = exec.status;
    let closed = false;

    const pollInterval = setInterval(async () => {
      if (closed) return;
      try {
        const updated = await pool.query(
          `SELECT status, activity, result, error FROM worker_executions WHERE id = $1`,
          [execId]
        );
        if (updated.rowCount === 0) { clearIntervals(); return; }
        const row = updated.rows[0];
        const activity = typeof row.activity === 'string' ? JSON.parse(row.activity) : (row.activity || []);

        // Send status change
        if (row.status !== lastStatus) {
          lastStatus = row.status;
          res.write(`data: ${JSON.stringify({ type: 'status', status: row.status })}\n\n`);
        }

        // Send new activity entries
        if (activity.length > lastActivityCount) {
          const newEntries = activity.slice(lastActivityCount);
          for (const entry of newEntries) {
            res.write(`data: ${JSON.stringify({ type: 'activity', entry })}\n\n`);
          }
          lastActivityCount = activity.length;
        }

        // Check for completion
        if (TERMINAL_STATUSES.has(row.status)) {
          res.write(`data: ${JSON.stringify({ type: 'complete', status: row.status, result: row.result?.slice(0, 10000) || null, error: row.error || null })}\n\n`);
          clearIntervals();
          res.end();
        }
      } catch { /* ignore poll errors */ }
    }, 500);

    // Heartbeat every 15 seconds
    const heartbeatInterval = setInterval(() => {
      if (closed) return;
      try { res.write(`data: ${JSON.stringify({ type: 'heartbeat', ts: new Date().toISOString() })}\n\n`); } catch { /* ignore */ }
    }, 15000);

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify({ type: 'timeout', message: 'Stream timed out after 5 minutes' })}\n\n`);
      } catch { /* ignore */ }
      clearIntervals();
      res.end();
    }, 5 * 60 * 1000);

    function clearIntervals() {
      closed = true;
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
      clearTimeout(timeout);
    }

    req.on('close', () => { clearIntervals(); });
    return true;
  }

  // GET /v1/approvals/feed — SSE feed for approval inbox updates (uses header auth for SSE compatibility)
  if (method === 'GET' && pathname === '/v1/approvals/feed') {
    const tenantId = getTenantId(req);
    if (!tenantId) { res.writeHead(401); res.end('Unauthorized'); return true; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial snapshot
    try {
      const result = await pool.query(
        `SELECT * FROM worker_approvals WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`,
        [tenantId]
      );
      res.write(`event: snapshot\ndata: ${JSON.stringify(result.rows)}\n\n`);
    } catch { res.write(`event: snapshot\ndata: []\n\n`); }

    // Poll for changes
    let lastCount = -1;
    const pollInterval = setInterval(async () => {
      try {
        const result = await pool.query(
          `SELECT COUNT(*)::int as count FROM worker_approvals WHERE tenant_id = $1 AND status = 'pending'`,
          [tenantId]
        );
        const count = result.rows[0]?.count || 0;
        if (count !== lastCount) {
          lastCount = count;
          const pending = await pool.query(
            `SELECT * FROM worker_approvals WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`,
            [tenantId]
          );
          res.write(`event: update\ndata: ${JSON.stringify({ count, items: pending.rows })}\n\n`);
        }
      } catch { /* ignore */ }
    }, 3000);

    // Keepalive
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(pollInterval);
      clearInterval(keepalive);
    });

    return true;
  }

  // GET /v1/approvals — list pending approvals
  if (method === 'GET' && pathname === '/v1/approvals') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `SELECT wa.*, w.name as worker_name
         FROM worker_approvals wa
         LEFT JOIN workers w ON w.id = wa.worker_id AND w.tenant_id = wa.tenant_id
         WHERE wa.tenant_id = $1
         ORDER BY wa.created_at DESC LIMIT 50`,
        [tid]
      );
      return json(res, 200, { items: result.rows }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch approvals'), true;
    }
  }

  // POST /v1/approvals/:id/approve — approve an action
  if (method === 'POST' && pathname.match(/^\/v1\/approvals\/[^/]+\/approve$/)) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const approvalId = pathname.split('/')[3];
    try {
      const result = await pool.query(
        `UPDATE worker_approvals SET status = 'approved', decision = 'approved', decided_by = $1, decided_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
         RETURNING id, worker_id, tool_name`,
        [tid, approvalId, tid]
      );
      if (result.rows.length === 0) return err(res, 404, 'approval not found or already decided'), true;
      // The NOTIFY trigger (from migration 035) will signal the scheduler to resume
      return json(res, 200, { ok: true, approval: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to approve'), true;
    }
  }

  // POST /v1/approvals/:id/deny — deny an action
  if (method === 'POST' && pathname.match(/^\/v1\/approvals\/[^/]+\/deny$/)) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const approvalId = pathname.split('/')[3];
    try {
      const result = await pool.query(
        `UPDATE worker_approvals SET status = 'denied', decision = 'denied', decided_by = $1, decided_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
         RETURNING id, worker_id, tool_name`,
        [tid, approvalId, tid]
      );
      if (result.rows.length === 0) return err(res, 404, 'approval not found or already decided'), true;
      // Mark the paused execution as charter_blocked
      await pool.query(
        `UPDATE worker_executions SET status = 'charter_blocked', completed_at = NOW(),
         error = $1
         WHERE worker_id = $2 AND tenant_id = $3 AND status = 'awaiting_approval'`,
        [`Action denied: ${result.rows[0].tool_name} was denied`, result.rows[0].worker_id, tid]
      );
      return json(res, 200, { ok: true, approval: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to deny'), true;
    }
  }

  // POST /v1/providers/openai/validate — validate OpenAI API key
  if (method === 'POST' && pathname === '/v1/providers/openai/validate') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body?.apiKey) return err(res, 400, 'apiKey is required'), true;
    try {
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${body.apiKey}` },
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        return err(res, 401, e?.error?.message || 'Invalid API key'), true;
      }
      const data = await resp.json();
      const modelCount = data?.data?.length || 0;
      return json(res, 200, { ok: true, models: modelCount }), true;
    } catch (e) {
      return err(res, 502, 'Failed to reach OpenAI API'), true;
    }
  }

  // POST /v1/providers/anthropic/validate — validate Anthropic API key
  if (method === 'POST' && pathname === '/v1/providers/anthropic/validate') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body?.apiKey) return err(res, 400, 'apiKey is required'), true;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': body.apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        return err(res, 401, e?.error?.message || 'Invalid API key'), true;
      }
      return json(res, 200, { ok: true }), true;
    } catch (e) {
      return err(res, 502, 'Failed to reach Anthropic API'), true;
    }
  }

  // POST /v1/providers — store a provider API key
  if (method === 'POST' && pathname === '/v1/providers') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body?.provider || !body?.apiKey) return err(res, 400, 'provider and apiKey are required'), true;
    const allowed = new Set(['openai', 'anthropic']);
    if (!allowed.has(body.provider)) return err(res, 400, `unsupported provider: ${body.provider}`), true;
    // Use a tenant-scoped worker_id to avoid collisions: "tenant:{tid}"
    const systemWorkerId = `tenant:${tid}`;
    const memKey = `provider_${body.provider}_key`;
    try {
      // Delete existing entry then insert (upsert via delete+insert for compatibility)
      await pool.query(
        `DELETE FROM worker_memory WHERE worker_id = $1 AND key = $2`,
        [systemWorkerId, memKey]
      );
      const encApiKey = encryptCredential(body.apiKey);
      await pool.query(
        `INSERT INTO worker_memory (id, worker_id, tenant_id, scope, key, value, updated_at)
         VALUES ($1, $2, $3, 'tenant', $4, $5, NOW())`,
        [generateId('mem'), systemWorkerId, tid, memKey, encApiKey]
      );
      return json(res, 200, { ok: true, provider: body.provider }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to store provider key'), true;
    }
  }

  // GET /v1/providers — list connected providers (masked keys)
  if (method === 'GET' && pathname === '/v1/providers') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const systemWorkerId = `tenant:${tid}`;
    try {
      const result = await pool.query(
        `SELECT key, value FROM worker_memory WHERE worker_id = $1 AND scope = 'tenant' AND key LIKE 'provider_%_key'`,
        [systemWorkerId]
      );
      const providers = result.rows.map(row => {
        const provider = row.key.replace('provider_', '').replace('_key', '');
        const plainKey = decryptCredential(row.value);
        const masked = plainKey ? '****' + plainKey.slice(-4) : '';
        return { provider, connected: true, maskedKey: masked };
      });
      return json(res, 200, { providers }), true;
    } catch {
      return json(res, 200, { providers: [] }), true;
    }
  }

  // DELETE /v1/providers/:provider — remove a provider key
  const providerDeleteMatch = pathname.match(/^\/v1\/providers\/(openai|anthropic)$/);
  if (method === 'DELETE' && providerDeleteMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const provider = providerDeleteMatch[1];
    const systemWorkerId = `tenant:${tid}`;
    const memKey = `provider_${provider}_key`;
    try {
      await pool.query(
        `DELETE FROM worker_memory WHERE worker_id = $1 AND key = $2`,
        [systemWorkerId, memKey]
      );
      return json(res, 200, { ok: true }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to remove provider key'), true;
    }
  }

  // GET /v1/credits — credit balance
  if (method === 'GET' && pathname === '/v1/credits') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(`SELECT balance_usd, total_spent_usd FROM tenant_credits WHERE tenant_id = $1`, [tid]);
      const row = result.rows[0] || { balance_usd: 0, total_spent_usd: 0 };
      return json(res, 200, { balance: parseFloat(row.balance_usd), remaining: parseFloat(row.balance_usd), totalSpent: parseFloat(row.total_spent_usd) }), true;
    } catch {
      return json(res, 200, { balance: 0, remaining: 0, totalSpent: 0 }), true;
    }
  }

  // GET /v1/workers/:id/versions — list all versions
  const versionsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/versions$/);
  if (method === 'GET' && versionsMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `SELECT * FROM worker_versions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY version DESC`,
        [versionsMatch[1], tid]
      );
      return json(res, 200, { versions: result.rows }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to list versions'), true;
    }
  }

  // POST /v1/workers/:id/versions/:version/rollback — restore a previous version
  const rollbackMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/versions\/(\d+)\/rollback$/);
  if (method === 'POST' && rollbackMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const [, workerId, versionNum] = rollbackMatch;
    try {
      const vr = await pool.query(
        `SELECT config FROM worker_versions WHERE worker_id = $1 AND tenant_id = $2 AND version = $3`,
        [workerId, tid, parseInt(versionNum)]
      );
      if (vr.rowCount === 0) return err(res, 404, 'version not found'), true;
      const config = typeof vr.rows[0].config === 'string' ? JSON.parse(vr.rows[0].config) : vr.rows[0].config;

      // Save current state as a new version before rollback
      const current = await pool.query(`SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
      if (current.rowCount === 0) return err(res, 404, 'worker not found'), true;
      const lastVersion = await pool.query(
        `SELECT COALESCE(MAX(version), 0) AS max_v FROM worker_versions WHERE worker_id = $1`, [workerId]
      );
      const nextVersion = (lastVersion.rows[0].max_v || 0) + 1;
      await pool.query(
        `INSERT INTO worker_versions (id, worker_id, tenant_id, version, config, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
        [generateId('wver'), workerId, tid, nextVersion, JSON.stringify(current.rows[0]), tid]
      );

      // Apply the old config
      const sets = [], vals = [];
      let pi = 1;
      for (const f of UPDATABLE) {
        if (config[f] !== undefined) {
          sets.push(`${f} = $${pi}`);
          vals.push(JSON_FIELDS.has(f) ? (typeof config[f] === 'string' ? config[f] : JSON.stringify(config[f])) : config[f]);
          pi++;
        }
      }
      sets.push(`updated_at = $${pi}`); vals.push(new Date().toISOString()); pi++;
      vals.push(workerId, tid);
      const result = await pool.query(
        `UPDATE workers SET ${sets.join(', ')} WHERE id = $${pi} AND tenant_id = $${pi + 1} RETURNING *`, vals
      );
      return json(res, 200, { worker: result.rows[0], rolledBackToVersion: parseInt(versionNum) }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'rollback failed'), true;
    }
  }

  // =========================================================================
  // Full-Text Search
  // =========================================================================

  // GET /v1/search?q=...&type=workers|executions|approvals
  if (method === 'GET' && pathname === '/v1/search') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const q = searchParams.get('q');
    if (!q || !q.trim()) return err(res, 400, 'q parameter is required'), true;
    const type = searchParams.get('type');
    const pattern = `%${q.trim()}%`;
    const results = [];

    try {
      if (!type || type === 'workers') {
        const wr = await pool.query(
          `SELECT * FROM workers WHERE tenant_id = $1 AND (name ILIKE $2 OR description ILIKE $2) LIMIT 20`,
          [tid, pattern]
        );
        for (const row of wr.rows) results.push({ type: 'worker', ...row });
      }
      if (!type || type === 'executions') {
        const er = await pool.query(
          `SELECT * FROM worker_executions WHERE tenant_id = $1 AND (result ILIKE $2 OR error ILIKE $2) ORDER BY started_at DESC LIMIT 20`,
          [tid, pattern]
        );
        for (const row of er.rows) results.push({ type: 'execution', ...row });
      }
      if (!type || type === 'approvals') {
        const ar = await pool.query(
          `SELECT * FROM worker_approvals
           WHERE tenant_id = $1
             AND (tool_name ILIKE $2 OR COALESCE(decision, status) ILIKE $2 OR COALESCE(matched_rule, '') ILIKE $2)
           LIMIT 20`,
          [tid, pattern]
        );
        for (const row of ar.rows) results.push({ type: 'approval', ...row });
      }
      return json(res, 200, { results }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'search failed'), true;
    }
  }

  // =========================================================================
  // Audit Log Export
  // =========================================================================

  // GET /v1/audit/export?format=csv|json&from=ISO&to=ISO
  if (method === 'GET' && pathname === '/v1/audit/export') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const format = searchParams.get('format') || 'json';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!from || !to) return err(res, 400, 'from and to date parameters are required'), true;

    try {
      // Fetch executions with worker name
      const executions = await pool.query(
        `SELECT e.id AS execution_id, w.name AS worker_name, e.started_at, e.completed_at,
                e.status, e.model, e.tokens_in, e.tokens_out, e.cost_usd, e.tool_calls,
                e.trigger_type
         FROM worker_executions e
         LEFT JOIN workers w ON w.id = e.worker_id AND w.tenant_id = e.tenant_id
         WHERE e.tenant_id = $1 AND e.started_at >= $2 AND e.started_at <= $3
         ORDER BY e.started_at DESC`,
        [tid, from, to]
      );

      // Fetch approvals with worker name
      const approvals = await pool.query(
        `SELECT a.id AS approval_id, w.name AS worker_name, a.tool_name, a.decision,
                a.decided_by, a.decided_at
         FROM worker_approvals a
         LEFT JOIN workers w ON w.id = a.worker_id AND w.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.decided_at >= $2 AND a.decided_at <= $3
         ORDER BY a.decided_at DESC`,
        [tid, from, to]
      );

      const rows = [];
      for (const e of executions.rows) {
        rows.push({
          type: 'execution', id: e.execution_id, worker_name: e.worker_name || '',
          started_at: e.started_at, completed_at: e.completed_at || '',
          status: e.status, model: e.model || '', tokens_in: e.tokens_in || 0,
          tokens_out: e.tokens_out || 0, cost_usd: e.cost_usd || 0,
          tool_calls: e.tool_calls || 0, trigger_type: e.trigger_type || '',
          decision: '', decided_by: '', tool_name: '',
        });
      }
      for (const a of approvals.rows) {
        rows.push({
          type: 'approval', id: a.approval_id, worker_name: a.worker_name || '',
          started_at: '', completed_at: '', status: '',
          model: '', tokens_in: 0, tokens_out: 0, cost_usd: 0, tool_calls: 0,
          trigger_type: '', decision: a.decision, decided_by: a.decided_by || '',
          tool_name: a.tool_name,
        });
      }

      const dateStr = new Date().toISOString().split('T')[0];

      if (format === 'csv') {
        const headers = ['type', 'id', 'worker_name', 'started_at', 'completed_at', 'status', 'model',
                         'tokens_in', 'tokens_out', 'cost_usd', 'tool_calls', 'trigger_type',
                         'tool_name', 'decision', 'decided_by'];
        const escapeCsv = (val) => {
          const s = String(val ?? '');
          if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const csvLines = [headers.join(',')];
        for (const row of rows) {
          csvLines.push(headers.map(h => escapeCsv(row[h])).join(','));
        }
        const csvBody = csvLines.join('\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="nooterra-audit-${dateStr}.csv"`,
        });
        res.end(csvBody);
        return true;
      }

      // JSON format
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nooterra-audit-${dateStr}.json"`,
      });
      res.end(JSON.stringify({ rows }));
      return true;
    } catch (e) {
      return err(res, 500, e?.message || 'audit export failed'), true;
    }
  }

  // =========================================================================
  // Team Permissions (RBAC CRUD)
  // =========================================================================

  const VALID_ROLES = new Set(['owner', 'admin', 'member', 'viewer']);

  // GET /v1/team — list team members
  if (method === 'GET' && pathname === '/v1/team') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `SELECT * FROM team_members WHERE tenant_id = $1 ORDER BY joined_at ASC`, [tid]
      );
      return json(res, 200, { members: result.rows, count: result.rowCount }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to list team members'), true;
    }
  }

  // POST /v1/team/invite — invite a team member by email
  if (method === 'POST' && pathname === '/v1/team/invite') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (!body.email?.trim()) return err(res, 400, 'email is required'), true;
    const role = body.role || 'member';
    if (!VALID_ROLES.has(role)) return err(res, 400, `invalid role: ${role}`), true;
    if (role === 'owner') return err(res, 400, 'cannot invite as owner'), true;
    try {
      const id = generateId('tm');
      const result = await pool.query(
        `INSERT INTO team_members (id, tenant_id, email, role, invited_by, joined_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [id, tid, body.email.trim().toLowerCase(), role, tid]
      );
      return json(res, 201, { member: result.rows[0] }), true;
    } catch (e) {
      if (e?.code === '23505') return err(res, 409, 'member already exists'), true;
      return err(res, 500, e?.message || 'failed to invite member'), true;
    }
  }

  // PUT /v1/team/:memberId/role — change a member's role
  const teamRoleMatch = pathname.match(/^\/v1\/team\/([^/]+)\/role$/);
  if (method === 'PUT' && teamRoleMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (!body.role || !VALID_ROLES.has(body.role)) return err(res, 400, `invalid role: ${body.role}`), true;
    try {
      const result = await pool.query(
        `UPDATE team_members SET role = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [body.role, teamRoleMatch[1], tid]
      );
      if (result.rowCount === 0) return err(res, 404, 'team member not found'), true;
      return json(res, 200, { member: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to update role'), true;
    }
  }

  // DELETE /v1/team/:memberId — remove a team member
  const teamDeleteMatch = pathname.match(/^\/v1\/team\/([^/]+)$/);
  if (method === 'DELETE' && teamDeleteMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `DELETE FROM team_members WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [teamDeleteMatch[1], tid]
      );
      if (result.rowCount === 0) return err(res, 404, 'team member not found'), true;
      return json(res, 200, { ok: true, member: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to remove member'), true;
    }
  }

  // =========================================================================
  // Worker File Uploads (S3 presigned URLs)
  // =========================================================================

  const S3_ENDPOINT = process.env.WORKER_S3_ENDPOINT || process.env.PROXY_EVIDENCE_S3_ENDPOINT || '';
  const S3_REGION = process.env.WORKER_S3_REGION || process.env.PROXY_EVIDENCE_S3_REGION || 'us-east-1';
  const S3_BUCKET = process.env.WORKER_S3_BUCKET || process.env.PROXY_EVIDENCE_S3_BUCKET || '';
  const S3_ACCESS_KEY_ID = process.env.WORKER_S3_ACCESS_KEY_ID || process.env.PROXY_EVIDENCE_S3_ACCESS_KEY_ID || '';
  const S3_SECRET_ACCESS_KEY = process.env.WORKER_S3_SECRET_ACCESS_KEY || process.env.PROXY_EVIDENCE_S3_SECRET_ACCESS_KEY || '';

  // POST /v1/workers/:id/files — generate a presigned upload URL
  const filesUploadMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/files$/);
  if (method === 'POST' && filesUploadMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wid = filesUploadMatch[1];

    // Verify worker belongs to tenant
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;

    const body = await readBody(req);
    if (!body?.filename) return err(res, 400, 'filename is required'), true;

    const ALLOWED_EXTENSIONS = new Set(['pdf', 'csv', 'json', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
    const ext = (body.filename.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return err(res, 400, `Unsupported file type: .${ext}`), true;

    const contentType = body.content_type || 'application/octet-stream';

    if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) {
      return err(res, 503, 'File storage not configured — S3 credentials missing'), true;
    }

    const fileId = generateId('file');
    const s3Key = `workers/${tid}/${wid}/${fileId}.${ext}`;

    try {
      const uploadUrl = presignS3Url({
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        bucket: S3_BUCKET,
        key: s3Key,
        method: 'PUT',
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
        expiresInSeconds: 3600,
      });

      // Store file metadata
      await pool.query(
        `INSERT INTO worker_files (id, worker_id, tenant_id, filename, s3_key, content_type, size_bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [fileId, wid, tid, body.filename, s3Key, contentType, body.size || 0]
      );

      return json(res, 200, { upload_url: uploadUrl, file_id: fileId, s3_key: s3Key }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to generate upload URL'), true;
    }
  }

  // GET /v1/workers/:id/files — list uploaded files for a worker
  if (method === 'GET' && filesUploadMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wid = filesUploadMatch[1];

    try {
      const result = await pool.query(
        `SELECT id, filename, content_type, size_bytes, created_at FROM worker_files
         WHERE worker_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC LIMIT 100`,
        [wid, tid]
      );

      // Generate download URLs for each file
      const files = result.rows.map(f => {
        let download_url = null;
        if (S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET) {
          try {
            const s3Key = `workers/${tid}/${wid}/${f.id}.${(f.filename.split('.').pop() || '').toLowerCase()}`;
            download_url = presignS3Url({
              endpoint: S3_ENDPOINT,
              region: S3_REGION,
              bucket: S3_BUCKET,
              key: s3Key,
              method: 'GET',
              accessKeyId: S3_ACCESS_KEY_ID,
              secretAccessKey: S3_SECRET_ACCESS_KEY,
              expiresInSeconds: 3600,
            });
          } catch { /* ignore presign errors */ }
        }
        return { ...f, download_url };
      });

      return json(res, 200, { files, count: result.rowCount }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to list files'), true;
    }
  }

  // =========================================================================
  // Generate Team (onboarding flow)
  // =========================================================================

  // POST /v1/workers/generate-team — onboarding: describe your business, get a team
  if (method === 'POST' && pathname === '/v1/workers/generate-team') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (typeof body.description !== 'string' || !body.description.trim()) {
      return err(res, 400, 'description must be a non-empty string'), true;
    }

    try {
      const team = generateTeam(body.description.trim());
      const now = new Date().toISOString();
      const createdWorkers = [];

      for (const gw of team.workers) {
        const id = generateId('wrk');
        const charter = JSON.stringify({
          schemaVersion: '1.0',
          name: gw.name,
          purpose: gw.charter.goal,
          canDo: gw.charter.canDo,
          askFirst: gw.charter.askFirst,
          neverDo: gw.charter.neverDo,
          role: gw.charter.role,
        });
        const scheduleValue = gw.schedule === 'continuous' ? 'on_demand' : (gw.schedule || 'on_demand');
        const result = await pool.query(
          `INSERT INTO workers (id, tenant_id, name, description, charter, schedule, model, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'paused', $8, $8) RETURNING *`,
          [id, tid, gw.name, gw.description, charter, scheduleValue, gw.model, now]
        );
        createdWorkers.push(result.rows[0]);
      }

      // Ensure meta-agent exists for this tenant
      try {
        const { ensureMetaAgent } = await import('./meta-agent.ts');
        await ensureMetaAgent(pool, tid);
      } catch (_metaErr) {
        // Non-fatal: meta-agent creation failure should not block team generation
      }

      return json(res, 201, { team, workers: createdWorkers }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'team generation failed'), true;
    }
  }

  // =========================================================================
  // Team Generation (legacy)
  // =========================================================================

  // POST /v1/teams/generate — auto-generate a team of workers from a business description
  if (method === 'POST' && pathname === '/v1/teams/generate') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (typeof body.businessDescription !== 'string' || !body.businessDescription.trim()) return err(res, 400, 'businessDescription must be a non-empty string'), true;

    try {
      const description = body.businessDescription.trim();
      const options = body.options || {};
      const maxWorkers = Math.min(options.maxWorkers || 5, 10);

      // Detect industry from keywords
      const industry = detectIndustryFromDescription(description);
      let roles = TEAM_INDUSTRY_TEMPLATES[industry]?.roles || TEAM_INDUSTRY_TEMPLATES.general.roles;

      // Apply include/exclude filters
      if (options.includeRoles?.length) {
        roles = options.includeRoles.filter(r => TEAM_ROLE_DEFINITIONS[r]);
      }
      if (options.excludeRoles?.length) {
        const excludeSet = new Set(options.excludeRoles);
        roles = roles.filter(r => !excludeSet.has(r));
      }

      const selectedRoles = roles.slice(0, maxWorkers);

      // Extract business name
      const businessName = options.businessName || extractBusinessName(description);

      // Create workers
      const workers = [];
      const now = new Date().toISOString();
      for (const roleKey of selectedRoles) {
        const role = TEAM_ROLE_DEFINITIONS[roleKey];
        if (!role) continue;

        const name = role.nameTemplate.replace('{business}', businessName);
        const charter = JSON.stringify({
          schemaVersion: '1.0',
          name,
          purpose: role.purpose.replace('{business}', businessName),
          canDo: role.canDo,
          askFirst: role.askFirst,
          neverDo: role.neverDo,
          capabilities: role.capabilities,
          schedule: role.schedule,
          taskType: role.taskType,
        });

        const id = generateId('wrk');
        const scheduleValue = role.schedule?.type === 'cron' ? role.schedule.value : 'on_demand';
        const result = await pool.query(
          `INSERT INTO workers (id, tenant_id, name, description, charter, schedule, model, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $8) RETURNING *`,
          [id, tid, name, role.purpose.replace('{business}', businessName), charter,
           scheduleValue, 'openai/gpt-4.1-mini', now]
        );
        workers.push({ ...result.rows[0], trustLevel: 'observing', role: roleKey });
      }

      return json(res, 201, {
        team: workers,
        industry,
        businessName,
        workerCount: workers.length,
      }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'team generation failed'), true;
    }
  }

  // GET /v1/workers/:id/sessions — list active sessions
  const sessionsListMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/sessions$/);
  if (method === 'GET' && sessionsListMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = sessionsListMatch[1];
    const wr = await pool.query('SELECT id FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    const { listActiveSessions } = await import('./sessions.ts');
    const sessions = await listActiveSessions(pool, workerId);
    return json(res, 200, { sessions }), true;
  }

  // POST /v1/workers/:id/sessions — create session
  if (method === 'POST' && sessionsListMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = sessionsListMatch[1];
    const wr = await pool.query('SELECT id FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    const body = await readBody(req);
    if (!body?.goal?.trim()) return err(res, 400, 'goal is required'), true;
    const { getOrCreateSession } = await import('./sessions.ts');
    const session = await getOrCreateSession(pool, workerId, tid, { goal: body.goal.trim() });
    return json(res, 201, { session }), true;
  }

  // GET /v1/workers/:id/sessions/:sessionId — session detail with executions
  const sessionDetailMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/sessions\/([^/]+)$/);
  if (method === 'GET' && sessionDetailMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const [, workerId, sessionId] = sessionDetailMatch;
    const wr = await pool.query('SELECT id FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    const result = await pool.query(
      `SELECT s.*,
        COALESCE(json_agg(json_build_object(
          'id', e.id, 'status', e.status, 'trigger_type', e.trigger_type,
          'started_at', e.started_at, 'completed_at', e.completed_at,
          'cost_usd', e.cost_usd
        ) ORDER BY e.started_at) FILTER (WHERE e.id IS NOT NULL), '[]') AS executions
      FROM worker_sessions s
      LEFT JOIN worker_executions e ON e.session_id = s.id
      WHERE s.id = $1 AND s.worker_id = $2
      GROUP BY s.id`,
      [sessionId, workerId]
    );
    if (result.rowCount === 0) return err(res, 404, 'session not found'), true;
    return json(res, 200, { session: result.rows[0] }), true;
  }

  // POST /v1/workers/:id/sessions/:sessionId/complete — complete session
  const sessionCompleteMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/sessions\/([^/]+)\/complete$/);
  if (method === 'POST' && sessionCompleteMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const [, workerId, sessionId] = sessionCompleteMatch;
    const wr = await pool.query('SELECT id FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    // Verify session belongs to this worker/tenant
    const sessCheck = await pool.query(
      'SELECT id FROM worker_sessions WHERE id = $1 AND worker_id = $2 AND tenant_id = $3',
      [sessionId, workerId, tid]
    );
    if (sessCheck.rowCount === 0) return err(res, 404, 'Session not found'), true;
    const { completeSession } = await import('./sessions.ts');
    await completeSession(pool, sessionId);
    return json(res, 200, { ok: true }), true;
  }

  // GET /v1/workers/rank/:taskType — rank workers for a task type
  const rankMatch = pathname.match(/^\/v1\/workers\/rank\/([^/]+)$/);
  if (method === 'GET' && rankMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const taskType = decodeURIComponent(rankMatch[1]);
    const { rankWorkersForTask } = await import('./competence.ts');
    const entries = await rankWorkersForTask(pool, tid, taskType);
    return json(res, 200, { rankings: entries }), true;
  }

  // GET /v1/workers/:id/competence — get worker competence entries
  const competenceMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/competence$/);
  if (method === 'GET' && competenceMatch) {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const workerId = competenceMatch[1];
    const wr = await pool.query('SELECT id FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    const { getWorkerCompetence } = await import('./competence.ts');
    const entries = await getWorkerCompetence(pool, workerId);
    return json(res, 200, { competence: entries }), true;
  }

  // POST /v1/workers/meta-agent/ensure — create or get the meta-agent for this tenant
  if (method === 'POST' && pathname === '/v1/workers/meta-agent/ensure') {
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const { ensureMetaAgent } = await import('./meta-agent.ts');
      const metaAgentId = await ensureMetaAgent(pool, tid);
      return json(res, 200, { meta_agent_id: metaAgentId }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to ensure meta-agent'), true;
    }
  }

  // GET /v1/workers/:id/delegations — list delegations from/to this worker
  const delegationsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/delegations$/);
  if (method === 'GET' && delegationsMatch) {
    const workerId = delegationsMatch[1];
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wr = await pool.query('SELECT id FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    try {
      const { getActiveDelegationsFrom, getActiveDelegationsTo } = await import('./delegation.ts');
      const [from, to] = await Promise.all([
        getActiveDelegationsFrom(pool, workerId),
        getActiveDelegationsTo(pool, workerId),
      ]);
      return json(res, 200, { delegated_from: from, delegated_to: to }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch delegations'), true;
    }
  }

  // POST /v1/workers/:id/delegations/:grantId/revoke — revoke a delegation
  const revokeMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/delegations\/([^/]+)\/revoke$/);
  if (method === 'POST' && revokeMatch) {
    const workerId = revokeMatch[1];
    const grantId = revokeMatch[2];
    const tid = await getAuthenticatedTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wr = await pool.query('SELECT id FROM workers WHERE id = $1 AND tenant_id = $2', [workerId, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    // Verify grant belongs to this tenant
    const grantCheck = await pool.query(
      'SELECT id FROM delegation_grants WHERE id = $1 AND tenant_id = $2',
      [grantId, tid]
    );
    if (grantCheck.rowCount === 0) return err(res, 404, 'Grant not found'), true;
    try {
      const { revokeDelegation } = await import('./delegation.ts');
      await revokeDelegation(pool, grantId);
      return json(res, 200, { revoked: true, grant_id: grantId }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to revoke delegation'), true;
    }
  }

  return false; // Not handled
}

// Exported for testing
export {
  detectIndustryFromDescription,
  extractBusinessName,
  TEAM_INDUSTRY_TEMPLATES,
  TEAM_ROLE_DEFINITIONS,
};
