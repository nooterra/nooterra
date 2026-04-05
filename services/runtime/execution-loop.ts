// @ts-nocheck — extracted JS code, will be properly typed in Phase 3
/**
 * Execution Loop — the core worker execution function.
 * Extracted from server.js (1,500+ lines).
 *
 * Uses the init pattern (like builtin-tools.js setPool) to receive module-level
 * dependencies without changing the function body.
 */

import type pg from 'pg';
import { initTracing, withSpan, addSpanAttributes } from './lib/tracing.js';
import { chatCompletion, listModels } from './openrouter.js';
import { getPlanLimits } from './billing.js';
import { chatCompletionForWorker } from './providers/index.js';
import { decryptCredential } from './crypto-utils.js';
import { executeTool, getAvailableTools } from './integrations.js';
import { getBuiltinTools, isBuiltinTool, executeBuiltinTool } from './builtin-tools.js';
import {
  enforceCharter as enforceCharterRules,
  requiresApproval as checkApproval,
  detectPromptInjection,
  validateToolCall,
  detectAnomalies,
  getAvgExecutionCost,
  autoPauseWorker,
  createApprovalRecord,
} from './charter-enforcement.js';
import { createDefaultVerificationPlan, runVerification } from './verification-engine.js';
import { buildSignalsFromExecution, persistSignals } from './learning-signals.js';
import { buildExecutionContextMessages } from './execution-context.js';
import { getWorkerRuntimePolicy, getWorkerRuntimePolicyForTool } from './runtime-policy-store.js';
import { loadSessionMessages, updateSessionAfterExecution, extractSessionUpdates } from './sessions.ts';
import { loadRelevantMemories, extractEpisodicMemories, storeEpisodicMemories } from './memory.ts';
import { classifyTaskType, updateCompetence } from './competence.ts';
import { isMetaAgent, executeMetaAgentTool, getMetaAgentTools } from './meta-agent.ts';
import { createDelegation, completeDelegation } from './delegation.ts';
import { createTracer } from './traces.ts';
import { deliverNotification } from './notifications.js';
import { createCollectionsExecutor } from './collections-executor.js';

import { buildMessages } from './prompt-builder.ts';
import { loadWorkerMemory, saveWorkerMemory, parseMemoryEntries } from './memory-store.ts';
import { canCallOpenRouter, canTenantCall, isWorkerThrottled, recordWorkerExec, EXECUTION_COST_CAP, TOOL_TIMEOUT_MS, MAX_TOOL_RESULT_SIZE } from './rate-limiter.ts';
import {
  safeParseJson,
  buildExecutionReceipt,
  buildMetadataExecutionPolicy,
  mergeExecutionPolicies,
  describeExecutionPolicy,
  resolveCurrentSideEffectPolicy,
  resolveCurrentApprovalPolicy,
  resolveCurrentVerificationPolicy,
  shouldWorkerRun,
} from './execution-policy.ts';
import { appendEvent } from '../../src/ledger/event-store.ts';
import { assembleContext } from '../../src/objects/graph.ts';
import { submit as gatewaySubmit } from '../../src/gateway/gateway.ts';
import { COLLECTIONS_TOOLS, createCollectionsAgent } from '../../src/agents/templates/ar-collections.ts';
import { generateReactivePlan } from '../../src/planner/planner.ts';

// World Runtime bridge — feeds data into the new event ledger, object graph,
// state estimator, and evaluation engine alongside the existing execution.
let bridgeEnabled = false;
let onExecutionCompleteFn: ((pool: any, data: any) => Promise<void>) | null = null;

export function enableBridge() {
  import('../../src/bridge.js').then(mod => {
    onExecutionCompleteFn = mod.onExecutionComplete;
    bridgeEnabled = true;
  }).catch(() => {
    // Bridge not available (e.g., migrations not run yet) — continue without it
  });
}

// ---------------------------------------------------------------------------
// Module-level deps (set via initExecutionLoop)
// ---------------------------------------------------------------------------

let pool: pg.Pool;
let log: (level: string, msg: string) => void;
let generateId: (prefix?: string) => string;

const COLLECTIONS_WORLD_RUNTIME_TOOLS = COLLECTIONS_TOOLS.map(({ function: fn }) => ({
  name: fn.name,
  description: fn.description,
  parameters: fn.parameters,
}));
const MIN_BALANCE_THRESHOLD = parseFloat(process.env.MIN_BALANCE_THRESHOLD || '0.10');
const TENANT_MAX_PER_MINUTE = parseInt(process.env.TENANT_MAX_PER_MINUTE || '10', 10);
const COLLECTIONS_MAX_ACTIONS_PER_EXECUTION = Math.max(
  1,
  Number.parseInt(process.env.COLLECTIONS_MAX_ACTIONS_PER_EXECUTION || '5', 10) || 5,
);

function mapCollectionsToolToActionClass(toolName) {
  switch (toolName) {
    case 'send_collection_email':
      return 'communicate.email';
    case 'create_followup_task':
      return 'task.create';
    case 'log_collection_note':
      return 'data.write';
    default:
      return `legacy.${String(toolName || 'unknown').toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
  }
}

function buildCollectionsPrompt(planAction, context) {
  const relatedSummary = (context.related || []).slice(0, 5).map(({ relationship, object }) => ({
    relationship: relationship.type,
    objectId: object.id,
    objectType: object.type,
    state: object.state,
    estimated: object.estimated,
  }));
  const eventSummary = (context.recentEvents || []).slice(0, 10).map((event) => ({
    id: event.id,
    type: event.type,
    timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : event.timestamp,
    payload: event.payload,
  }));

  return [
    'You are running inside Nooterra’s Stripe-first AR collections world runtime.',
    'You are in shadow mode. Propose the next governed action using tools, but assume nothing will send automatically.',
    `Planner recommendation: ${planAction.description}`,
    `Planner action class: ${planAction.actionClass}`,
    `Planner priority: ${Number(planAction.priority || 0).toFixed(2)}`,
    `Planner reasoning: ${(planAction.reasoning || []).join(' | ') || 'none provided'}`,
    `Target invoice observed state: ${JSON.stringify(context.target.state || {})}`,
    `Target invoice estimated state: ${JSON.stringify(context.target.estimated || {})}`,
    `Related business context: ${JSON.stringify(relatedSummary)}`,
    `Recent event history: ${JSON.stringify(eventSummary)}`,
    'If dispute, complaint, or high-risk signals exist, create a follow-up task instead of sending email.',
    'If you choose email, make it specific, professional, empathetic, and grounded in the invoice details.',
  ].join('\n\n');
}

function buildCollectionsEvidence(worker, planAction, toolName, context) {
  const relatedIds = (context.related || []).slice(0, 5).map(({ object }) => object.id);
  return {
    policyClauses: [
      'Stripe-first governed AR collections runtime',
      ...(planAction.reasoning || []).slice(0, 4),
    ],
    factsReliedOn: [planAction.targetObjectId, ...relatedIds],
    toolsUsed: [toolName, 'world.planner', 'world.object_graph'],
    uncertaintyDeclared: planAction.uncertainty?.composite
      ?? Math.max(0.05, Math.min(0.95, 1 - Number(planAction.priority || 0))),
    planner: {
      recommendedVariantId: planAction.parameters?.recommendedVariantId,
      explorationMode: planAction.explorationMode ?? null,
      explorationBaselineVariantId: planAction.explorationBaselineVariantId ?? null,
      sequenceScore: planAction.sequenceScore ?? null,
      sequencePlan: planAction.sequencePlan ?? [],
    },
    authorityChain: [worker.id],
  };
}

async function appendCollectionsGatewayEvent({
  pool,
  worker,
  executionId,
  plannedAction,
  gatewayResult,
  toolName,
}) {
  const type = gatewayResult.status === 'escrowed'
    ? 'agent.action.escrowed'
    : gatewayResult.status === 'denied'
      ? 'agent.action.blocked'
      : 'agent.action.executed';

  await appendEvent(pool, {
    tenantId: worker.tenant_id,
    type,
    timestamp: new Date(),
    sourceType: 'agent',
    sourceId: worker.id,
    objectRefs: plannedAction.targetObjectId
      ? [{ objectId: plannedAction.targetObjectId, objectType: plannedAction.targetObjectType || 'invoice', role: 'target' }]
      : [],
    payload: {
      executionId,
      actionId: gatewayResult.actionId,
      actionClass: plannedAction.actionClass,
      tool: toolName,
      decision: gatewayResult.decision,
      status: gatewayResult.status,
      executed: gatewayResult.executed,
      reason: gatewayResult.reason,
      shadowMode: true,
    },
    provenance: {
      sourceSystem: 'world-runtime',
      sourceId: executionId,
      extractionMethod: 'api',
      extractionConfidence: 1.0,
    },
    traceId: plannedAction.id,
  });
}

async function executeCollectionsWorldRuntimeShadow({
  worker,
  charter,
  executionId,
  activity,
  addActivity,
  startedAt,
  tracer,
}) {
  // Refresh Stripe data before planning
  try {
    const keyResult = await pool.query(
      `SELECT credentials_encrypted FROM tenant_integrations
       WHERE tenant_id = $1 AND service = 'stripe' AND status = 'connected'`,
      [worker.tenant_id],
    );
    if (keyResult.rows[0]?.credentials_encrypted) {
      const { decryptCredential } = await import('./crypto-utils.js');
      const apiKey = decryptCredential(keyResult.rows[0].credentials_encrypted);
      const { backfillStripeData } = await import('./router.js');
      await backfillStripeData(pool, worker.tenant_id, apiKey, log);
      addActivity('backfill', 'Refreshed Stripe data');
    }
  } catch (err: any) {
    log('warn', `Stripe refresh failed for ${worker.tenant_id}: ${err.message}`);
    addActivity('backfill', `Stripe refresh failed: ${err.message}`);
  }

  const verificationPlan = charter.verificationPlan || createDefaultVerificationPlan();
  const plan = await generateReactivePlan(pool, worker.tenant_id);
  const plannedActions = (plan.actions || [])
    .filter((action) => action.actionClass === 'communicate.email' || action.actionClass === 'task.create')
    .slice(0, COLLECTIONS_MAX_ACTIONS_PER_EXECUTION);

  addActivity('planner', plan.summary || `Generated ${plannedActions.length} collections action(s)`);

  if (plannedActions.length === 0) {
    const finalResponse = 'No overdue invoices currently require collections outreach.';
    const receipt = buildExecutionReceipt({
      worker,
      executionId,
      finalResponse,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
      startedAt,
      rounds: 1,
      toolCallCount: 0,
      toolResults: [],
      verificationPlan,
    });

    await tracer.flush().catch(() => {});
    await finalizeExecution(executionId, {
      status: 'shadow_completed',
      completedAt: new Date(),
      model: worker.model,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      rounds: 1,
      toolCalls: 0,
      result: finalResponse,
      activity,
      receipt,
    }, worker.tenant_id, 0);
    await pool.query(`
      UPDATE workers SET
        stats = jsonb_set(
          jsonb_set(
            jsonb_set(stats, '{totalRuns}', to_jsonb((stats->>'totalRuns')::int + 1)),
            '{successfulRuns}',
            to_jsonb((stats->>'successfulRuns')::int + 1)
          ),
          '{lastRunAt}', to_jsonb($2::text)
        ),
        updated_at = now()
      WHERE id = $1
    `, [worker.id, new Date().toISOString()]);
    log('info', `Collections world runtime ${executionId} completed in shadow mode for worker ${worker.name} (no actions required)`);
    return;
  }

  const agent = {
    ...createCollectionsAgent(worker.tenant_id, worker.id),
    id: worker.id,
    tenantId: worker.tenant_id,
    name: worker.name,
    model: worker.model,
  };

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCost = 0;
  let toolCallCount = 0;
  const toolResults = [];
  const responseParts = [];

  for (let index = 0; index < plannedActions.length; index += 1) {
    const plannedAction = plannedActions[index];
    addActivity('collections_candidate', plannedAction.description);
    tracer.trace('collections_candidate', {
      executionId,
      targetObjectId: plannedAction.targetObjectId,
      actionClass: plannedAction.actionClass,
      priority: plannedAction.priority,
    });

    const context = await assembleContext(pool, plannedAction.targetObjectId, 1);
    if (!context || context.target.tenantId !== worker.tenant_id) {
      addActivity('collections_skip', `Missing company-state context for ${plannedAction.targetObjectId}`);
      toolResults.push({
        round: index + 1,
        name: 'collections_context_lookup',
        args: { targetObjectId: plannedAction.targetObjectId },
        success: false,
        error: 'Missing company-state context',
        gatewayStatus: 'failed',
      });
      continue;
    }

    const llmResult = await withSpan('llm.call.collections', {
      model: worker.model,
      round: index + 1,
      'worker.id': worker.id,
      'execution.id': executionId,
    }, () => chatCompletionForWorker(worker, {
      model: agent.model,
      messages: [
        {
          role: 'system',
          content: `${agent.role}\n\n${agent.domainInstructions}\n\n${agent.playbook}`,
        },
        {
          role: 'user',
          content: buildCollectionsPrompt(plannedAction, context),
        },
      ],
      tools: COLLECTIONS_WORLD_RUNTIME_TOOLS,
      maxTokens: charter.maxTokens || 4096,
      temperature: charter.temperature ?? 0.2,
    }));

    totalPromptTokens += llmResult.usage?.promptTokens || 0;
    totalCompletionTokens += llmResult.usage?.completionTokens || 0;
    totalCost += llmResult.usage?.cost || 0;
    addActivity(
      'llm_response',
      `Collections round ${index + 1}: ${(llmResult.toolCalls || []).length} tool call(s), ${llmResult.usage?.totalTokens || 0} tokens`,
    );
    tracer.trace('collections_llm', {
      round: index + 1,
      toolCalls: (llmResult.toolCalls || []).length,
      tokens: llmResult.usage?.totalTokens || 0,
      cost: llmResult.usage?.cost || 0,
    });

    if (llmResult.response) {
      responseParts.push(`Invoice ${plannedAction.targetObjectId}: ${llmResult.response}`);
    }

    const llmToolCalls = Array.isArray(llmResult.toolCalls) ? llmResult.toolCalls : [];
    toolCallCount += llmToolCalls.length;

    if (llmToolCalls.length === 0) {
      addActivity('collections_noop', `No governed action proposed for ${plannedAction.targetObjectId}`);
      continue;
    }

    for (const toolCall of llmToolCalls) {
      const args = typeof toolCall.arguments === 'string'
        ? safeParseJson(toolCall.arguments, {}) || {}
        : (toolCall.arguments || {});
      const toolName = toolCall.name || 'unknown_tool';
      const gatewayAction = {
        tenantId: worker.tenant_id,
        agentId: worker.id,
        executionId,
        runtimeTemplateId: 'ar-collections-v1',
        traceId: plannedAction.id,
        actionClass: mapCollectionsToolToActionClass(toolName),
        tool: toolName,
        parameters: args,
        targetObjectId: plannedAction.targetObjectId,
        targetObjectType: plannedAction.targetObjectType,
        counterpartyId: typeof plannedAction.parameters?.partyId === 'string' ? plannedAction.parameters.partyId : undefined,
        valueCents: Math.max(1, Number(plannedAction.parameters?.amountCents || 0)),
        evidence: buildCollectionsEvidence(worker, plannedAction, toolName, context),
      };

      const gatewayResult = await gatewaySubmit(pool, gatewayAction, {
        executor: createCollectionsExecutor(worker.tenant_id),
        escrowThresholdCents: 1,
      });

      toolResults.push({
        round: index + 1,
        name: toolName,
        args,
        targetObjectId: plannedAction.targetObjectId,
        success: gatewayResult.status !== 'denied' && gatewayResult.status !== 'failed',
        error: gatewayResult.error || (gatewayResult.status === 'denied' ? gatewayResult.reason : null),
        gatewayStatus: gatewayResult.status,
        decision: gatewayResult.decision,
        reason: gatewayResult.reason,
      });

      addActivity(
        gatewayResult.status === 'escrowed' ? 'gateway_escrow' : 'gateway_decision',
        `${toolName}: ${gatewayResult.status} (${gatewayResult.reason})`,
      );
      tracer.trace('gateway_submit', {
        tool: toolName,
        status: gatewayResult.status,
        decision: gatewayResult.decision,
      });

      await appendCollectionsGatewayEvent({
        pool,
        worker,
        executionId,
        plannedAction,
        gatewayResult,
        toolName,
      }).catch((err) => {
        log('warn', `Failed to append collections gateway event for ${executionId}: ${err.message}`);
      });
    }
  }

  const finalResponse = (responseParts.join('\n\n') || plan.summary || 'Collections runtime completed without new proposals.').slice(0, 50000);
  const receipt = buildExecutionReceipt({
    worker,
    executionId,
    finalResponse,
    totalPromptTokens,
    totalCompletionTokens,
    totalCost,
    startedAt,
    rounds: plannedActions.length,
    toolCallCount,
    toolResults,
    verificationPlan,
  });

  await tracer.flush().catch(() => {});
  await finalizeExecution(executionId, {
    status: 'shadow_completed',
    completedAt: new Date(),
    model: worker.model,
    tokensIn: totalPromptTokens,
    tokensOut: totalCompletionTokens,
    costUsd: totalCost,
    rounds: plannedActions.length,
    toolCalls: toolCallCount,
    result: finalResponse,
    activity,
    receipt,
  }, worker.tenant_id, totalCost);

  await pool.query(`
    UPDATE workers SET
      stats = jsonb_set(
        jsonb_set(
          jsonb_set(stats, '{totalRuns}', to_jsonb((stats->>'totalRuns')::int + 1)),
          '{successfulRuns}',
          to_jsonb((stats->>'successfulRuns')::int + 1)
        ),
        '{lastRunAt}', to_jsonb($2::text)
      ),
      updated_at = now()
    WHERE id = $1
  `, [worker.id, new Date().toISOString()]);

  log('info', `Collections world runtime ${executionId} completed in shadow mode for worker ${worker.name} (${toolCallCount} proposal(s), $${totalCost.toFixed(6)})`);

  if (bridgeEnabled && onExecutionCompleteFn) {
    try {
      await onExecutionCompleteFn(pool, {
        executionId,
        workerId: worker.id,
        workerName: worker.name,
        tenantId: worker.tenant_id,
        triggerType: 'shadow',
        status: 'completed',
        toolCalls: (toolResults || []).map((result) => ({
          tool: result.name || 'unknown',
          actionClass: mapCollectionsToolToActionClass(result.name || 'unknown'),
          status: result.gatewayStatus === 'escrowed'
            ? 'escrowed'
            : result.gatewayStatus === 'denied' || result.gatewayStatus === 'failed'
              ? 'blocked'
              : 'executed',
          targetObjectId: result.targetObjectId || result.args?.invoiceId || undefined,
          targetObjectType: result.targetObjectId || result.args?.invoiceId ? 'invoice' : undefined,
          error: result.error || undefined,
        })),
        result: finalResponse,
        tokensUsed: totalPromptTokens + totalCompletionTokens,
        costCents: Math.round(totalCost * 100),
        durationMs: Date.now() - startedAt.getTime(),
        receipt,
      });
    } catch (bridgeErr) {
      log('warn', `World Runtime bridge error (non-fatal): ${bridgeErr.message}`);
    }
  }
}

export function initExecutionLoop(deps: {
  pool: pg.Pool;
  log: (level: string, msg: string) => void;
  generateId: (prefix?: string) => string;
}) {
  pool = deps.pool;
  log = deps.log;
  generateId = deps.generateId;
}

// ---------------------------------------------------------------------------
// Functions extracted from server.js (lines 167-1659)
// ---------------------------------------------------------------------------

async function executeWorker(worker, executionId, triggerType, resumeContext = null) {
  return withSpan('worker.execute', {
    'worker.id': worker.id,
    'worker.model': worker.model,
    'tenant.id': worker.tenant_id,
    'execution.id': executionId,
    'trigger.type': triggerType,
  }, async () => {
  const startedAt = new Date();
  const requestedDeadline = Number.isFinite(resumeContext?.executionDeadlineMs)
    ? Number(resumeContext.executionDeadlineMs)
    : null;
  const executionDeadline = requestedDeadline && requestedDeadline > Date.now()
    ? requestedDeadline
    : Date.now() + 5 * 60 * 1000; // 5-minute per-execution timeout
  const activity = [];
  const tracer = createTracer(pool, executionId, worker.id, worker.tenant_id);
  const isResume = triggerType === 'approval_resume' && resumeContext?.approvedToolCalls;

  function addActivity(type, detail) {
    const entry = {
      ts: new Date().toISOString(),
      type,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
    };
    activity.push(entry);

    // Write activity to DB immediately so SSE stream poller can read live updates
    pool.query(
      `UPDATE worker_executions SET activity = $2::jsonb WHERE id = $1`,
      [executionId, JSON.stringify(activity)]
    ).catch(() => { /* best-effort live update, final write happens at completion */ });
  }

  addActivity('start', isResume
    ? `Execution resumed after approval (tools: ${resumeContext.approvedToolCalls.map(t => t.name).join(', ')})`
    : `Execution started via ${triggerType}`);

  // Smart polling gate — skip if nothing new for scheduled workers
  if (!isResume) {
    const shouldRun = await shouldWorkerRun(pool, worker, triggerType, addActivity);
    if (!shouldRun) {
      await updateExecution(executionId, {
        status: 'skipped',
        completedAt: new Date(),
        error: null,
        activity,
      });
      return;
    }
  }

  try {
    // Per-worker daily run cap — prevents any single worker from dominating the budget
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const dailyResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM worker_executions WHERE worker_id = $1 AND started_at >= $2`,
        [worker.id, todayStart]
      );
      const dailyCount = parseInt(dailyResult.rows[0]?.cnt || 0);

      // Default: 200 runs/day per worker. Can be overridden in charter.
      const charter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : worker.charter;
      const maxDailyRuns = charter?.maxDailyRuns || parseInt(process.env.MAX_DAILY_RUNS_PER_WORKER || '200', 10);

      if (dailyCount >= maxDailyRuns) {
        addActivity('rate_limited', `Daily run limit reached (${dailyCount}/${maxDailyRuns}). Resets at midnight UTC.`);
        await updateExecution(executionId, {
          status: 'rate_limited',
          completedAt: new Date(),
          error: `Worker daily run limit (${maxDailyRuns}) reached. Resets at midnight UTC.`,
          activity,
        });
        return;
      }
    } catch (err) {
      log('warn', `Daily run cap check failed for worker ${worker.id}: ${err.message}`);
    }

    // Spam throttle — prevent rapid-fire execution abuse
    if (isWorkerThrottled(worker.id)) {
      addActivity('rate_limited', 'Worker throttled: too many executions in short window (anti-spam)');
      await updateExecution(executionId, {
        status: 'rate_limited',
        completedAt: new Date(),
        error: 'Too many executions in a short period. Cooling down for 5 minutes.',
        activity,
      });
      return;
    }
    recordWorkerExec(worker.id);

    // Check monthly execution limit for tenant's plan
    try {
      const tierResult = await pool.query('SELECT tier FROM tenant_credits WHERE tenant_id = $1', [worker.tenant_id]);
      const { tier, limits } = getPlanLimits(tierResult.rows[0]?.tier || 'sandbox');
      const monthlyLimit = Number(limits?.maxExecutionsPerMonth);

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM worker_executions WHERE tenant_id = $1 AND started_at >= $2 AND status != 'failed'`,
        [worker.tenant_id, monthStart]
      );
      const monthlyCount = parseInt(countResult.rows[0]?.cnt || 0);
      if (Number.isFinite(monthlyLimit) && monthlyLimit >= 0 && monthlyCount >= monthlyLimit) {
        addActivity('error', `Monthly execution limit reached (${monthlyCount}/${monthlyLimit} for ${tier} plan)`);
        await updateExecution(executionId, {
          status: 'budget_exceeded',
          completedAt: new Date(),
          error: `Monthly execution limit reached (${monthlyLimit} for ${tier} plan). Upgrade to increase.`,
          activity,
        });
        return;
      }
    } catch (err) {
      // fail-closed: skip execution when billing state is unknown
      log('error', `Plan limit check failed for ${worker.tenant_id}: ${err.message}`);
      addActivity('error', `Billing check failed — skipping execution (fail-closed)`);
      await updateExecution(executionId, {
        status: 'billing_error',
        completedAt: new Date(),
        error: `Billing check failed: ${err.message}`,
        activity,
      });
      return;
    }

    // Check per-tenant rate limit
    if (!canTenantCall(worker.tenant_id)) {
      addActivity('rate_limited', `Tenant ${worker.tenant_id} exceeded ${TENANT_MAX_PER_MINUTE} executions/min`);
      await updateExecution(executionId, {
        status: 'queued',
        error: 'Rate limited — too many executions per minute',
        activity,
      });
      log('warn', `Tenant ${worker.tenant_id} rate limited: ${TENANT_MAX_PER_MINUTE}/min exceeded`);
      return;
    }

    // Check tenant credits
    const creditResult = await pool.query(
      'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1',
      [worker.tenant_id]
    );
    if (creditResult.rowCount === 0) {
      // New tenant — seed with sandbox trial credits ($2.00)
      await pool.query(
        `INSERT INTO tenant_credits (tenant_id, balance_usd, total_spent_usd, updated_at)
         VALUES ($1, 2.00, 0, now())
         ON CONFLICT (tenant_id) DO NOTHING`,
        [worker.tenant_id]
      );
      log('info', `Seeded $2.00 sandbox trial credits for tenant ${worker.tenant_id}`);
    }
    const balance = parseFloat(creditResult.rows[0]?.balance_usd ?? (creditResult.rowCount === 0 ? 2.00 : 0));
    if (balance < MIN_BALANCE_THRESHOLD) {
      addActivity('error', 'Insufficient credits');
      await updateExecution(executionId, {
        status: 'budget_exceeded',
        completedAt: new Date(),
        error: 'Insufficient tenant credits',
        activity,
      });
      return;
    }

    // Build messages from charter
    const charter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : worker.charter;
    const knowledge = typeof worker.knowledge === 'string' ? JSON.parse(worker.knowledge) : worker.knowledge;

    // Load delegation grant constraints if this execution was delegated
    let delegationGrant = null;
    try {
      const execRow = await pool.query('SELECT grant_id FROM worker_executions WHERE id = $1', [executionId]);
      const grantId = execRow.rows[0]?.grant_id;
      if (grantId) {
        const grantRow = await pool.query('SELECT * FROM delegation_grants WHERE id = $1 AND status = $2', [grantId, 'active']);
        delegationGrant = grantRow.rows[0] || null;
        if (delegationGrant) {
          addActivity('delegation', `Running under delegation grant ${grantId} from worker ${delegationGrant.parent_worker_id}`);
          // Restrict charter to only granted capabilities
          const grantedCaps = delegationGrant.granted_capabilities || [];
          if (grantedCaps.length > 0) {
            // Restrict typed capabilities
            if (charter.capabilities) {
              const restricted = {};
              for (const cap of grantedCaps) {
                if (charter.capabilities[cap]) restricted[cap] = charter.capabilities[cap];
              }
              charter.capabilities = restricted;
            }
            // Also restrict string canDo rules to only those matching granted capabilities.
            // If a canDo rule doesn't match any granted capability name, demote it to askFirst.
            if (Array.isArray(charter.canDo)) {
              const demoted = [];
              charter.canDo = charter.canDo.filter(rule => {
                const ruleNorm = rule.toLowerCase().replace(/[^a-z0-9]/g, '');
                const matched = grantedCaps.some(cap => {
                  const capNorm = cap.toLowerCase().replace(/[^a-z0-9]/g, '');
                  return ruleNorm.includes(capNorm) || capNorm.includes(ruleNorm);
                });
                if (!matched) demoted.push(rule);
                return matched;
              });
              // Demoted rules become askFirst (require approval)
              if (demoted.length > 0) {
                charter.askFirst = [...(charter.askFirst || []), ...demoted];
                addActivity('delegation', `Demoted ${demoted.length} canDo rule(s) to askFirst (not in granted capabilities)`);
              }
            }
          }
        }
      }
    } catch (err) {
      log('warn', `Failed to load delegation grant for ${executionId}: ${err.message}`);
    }

    let executionMetadata = {};
    try {
      const executionRow = await pool.query(
        'SELECT metadata FROM worker_executions WHERE id = $1',
        [executionId]
      );
      executionMetadata = safeParseJson(executionRow.rows[0]?.metadata, {}) || {};
    } catch (err) {
      log('warn', `Failed to load execution metadata for ${executionId}: ${err.message}`);
    }
    const isShadowMode = worker.shadow === true
      || worker.status === 'shadow'
      || triggerType === 'shadow'
      || executionMetadata?.shadowMode === true;
    if (isShadowMode) {
      addActivity('shadow', 'Running in shadow mode — no real actions will be taken');
    }

    if (charter?.worldRuntimeTemplateId === 'ar-collections-v1') {
      if (!isShadowMode) {
        addActivity('error', 'Collections world runtime is restricted to shadow mode until promotion criteria are met');
        await updateExecution(executionId, {
          status: 'failed',
          completedAt: new Date(),
          error: 'Collections world runtime must remain in shadow mode',
          activity,
        });
        return;
      }

      await executeCollectionsWorldRuntimeShadow({
        worker,
        charter,
        executionId,
        activity,
        addActivity,
        startedAt,
        tracer,
      });
      return;
    }

    // --- Charter enforcement: prompt injection detection on task prompt ---
    const taskPromptRaw = charter.task || charter.prompt || 'Execute your scheduled task.';
    const injectionCheck = detectPromptInjection(taskPromptRaw);
    if (!injectionCheck.safe) {
      addActivity('charter_block', `Prompt injection detected: ${injectionCheck.reason} (severity: ${injectionCheck.severity})`);
      log('warn', `Prompt injection detected for worker ${worker.name} [${executionId}]: ${injectionCheck.reason}`);

      if (injectionCheck.severity === 'high') {
        await autoPauseWorker(pool, worker.id, executionId, [`Prompt injection: ${injectionCheck.reason}`]);
        await updateExecution(executionId, {
          status: 'auto_paused',
          completedAt: new Date(),
          error: `Blocked: prompt injection detected — ${injectionCheck.reason}`,
          activity,
        });
        return;
      }
      // Medium/low severity: log warning but continue (could be false positive)
      addActivity('charter_warn', `Proceeding despite ${injectionCheck.severity}-severity injection signal`);
    }

    // Scan knowledge content for injection attempts
    if (knowledge && Array.isArray(knowledge)) {
      for (const k of knowledge) {
        if (k.content) {
          const knowledgeCheck = detectPromptInjection(k.content);
          if (!knowledgeCheck.safe && knowledgeCheck.severity === 'high') {
            addActivity('charter_block', `Injection in knowledge "${k.title}": ${knowledgeCheck.reason}`);
            log('warn', `Knowledge injection detected for worker ${worker.name}: ${knowledgeCheck.reason}`);
            await autoPauseWorker(pool, worker.id, executionId, [`Knowledge injection in "${k.title}": ${knowledgeCheck.reason}`]);
            await updateExecution(executionId, {
              status: 'auto_paused',
              completedAt: new Date(),
              error: `Blocked: injection detected in knowledge — ${knowledgeCheck.reason}`,
              activity,
            });
            return;
          }
        }
      }
    }

    // Load relevant memories (scored by recency, frequency, and keyword overlap)
    const taskContext = charter.task || charter.prompt || charter.goal || worker.description || '';
    let workerMemory = [];
    try {
      workerMemory = await loadRelevantMemories(pool, worker.id, worker.tenant_id, taskContext, 20);
    } catch (err) {
      log('warn', `Failed to load memories for worker ${worker.id}: ${err.message}`);
      // Fallback to old method
      workerMemory = await loadWorkerMemory(pool, worker.id, worker.tenant_id);
    }
    if (workerMemory.length > 0) {
      addActivity('memory', `Loaded ${workerMemory.length} memory entries from previous runs`);
      tracer.trace('memory_load', { count: workerMemory.length });
    }
    const workerRuntimePolicyRecord = await getWorkerRuntimePolicy(pool, worker.tenant_id, worker.id, { fresh: true });
    const metadataExecutionPolicy = buildMetadataExecutionPolicy(executionMetadata);
    let verificationPolicyState = { decision: { action: 'allow', anomalies: [] }, policy: null, autoPauseReasons: [] };
    let approvalPolicyState = { decision: { action: 'allow', anomalies: [] }, policy: null, autoPauseReasons: [] };
    let sideEffectPolicyState = { decision: { action: 'allow', anomalies: [] }, policy: null, autoPauseReasons: [] };
    if (!isShadowMode) {
      verificationPolicyState = await resolveCurrentVerificationPolicy(pool, worker, workerRuntimePolicyRecord, { excludeExecutionId: executionId });
      approvalPolicyState = await resolveCurrentApprovalPolicy(pool, worker, workerRuntimePolicyRecord);
      sideEffectPolicyState = await resolveCurrentSideEffectPolicy(pool, worker, workerRuntimePolicyRecord);
    }

    const initialAutoPauseReasons = [
      ...verificationPolicyState.autoPauseReasons,
      ...approvalPolicyState.autoPauseReasons,
      ...sideEffectPolicyState.autoPauseReasons,
    ];
    if (!isShadowMode && initialAutoPauseReasons.length > 0) {
      addActivity('runtime_policy', initialAutoPauseReasons.join('; '));
      await autoPauseWorker(pool, worker.id, executionId, initialAutoPauseReasons);
      await updateExecution(executionId, {
        status: 'auto_paused',
        completedAt: new Date(),
        error: `Auto-paused: ${initialAutoPauseReasons.join('; ')}`,
        activity,
      });
      return;
    }

    const staticExecutionPolicy = mergeExecutionPolicies(
      metadataExecutionPolicy,
      verificationPolicyState.policy,
      approvalPolicyState.policy,
    );
    let executionPolicy = mergeExecutionPolicies(
      staticExecutionPolicy,
      sideEffectPolicyState.policy,
    );
    let lastExecutionPolicySummary = describeExecutionPolicy(executionPolicy);

    // Load BYOK API key from tenant's stored providers (if applicable)
    if ((worker.provider_mode === 'openai' || worker.provider_mode === 'anthropic' || worker.provider_mode === 'byok') && !worker.byok_api_key) {
      try {
        const providerKey = worker.byok_provider || worker.provider_mode;
        const keyResult = await pool.query(
          `SELECT value FROM worker_memory WHERE worker_id = $1 AND scope = 'tenant' AND key = $2`,
          [`tenant:${worker.tenant_id}`, `provider_${providerKey}_key`]
        );
        if (keyResult.rowCount > 0) {
          worker.byok_api_key = decryptCredential(keyResult.rows[0].value);
          worker.provider_mode = 'byok';
          if (!worker.byok_provider) worker.byok_provider = providerKey;
          addActivity('provider', `Using BYOK ${providerKey} key`);
        } else {
          addActivity('provider_warn', `BYOK ${providerKey} key not found — falling back to OpenRouter`);
          worker.provider_mode = 'platform';
        }
      } catch (err) {
        log('warn', `Failed to load BYOK key for worker ${worker.id}: ${err.message}`);
        worker.provider_mode = 'platform';
      }
    }

    const messages = buildMessages(charter, knowledge, worker, workerMemory);

    // Load session context if this execution belongs to a session
    let sessionId = null;
    try {
      const sessionRow = await pool.query('SELECT session_id FROM worker_executions WHERE id = $1', [executionId]);
      sessionId = sessionRow.rows[0]?.session_id || null;
      if (sessionId) {
        const sessionMessages = await loadSessionMessages(pool, sessionId);
        if (sessionMessages.length > 0) {
          messages.push(...sessionMessages);
          addActivity('session', 'Loaded session context');
          tracer.trace('session_update', { sessionId, loaded: true, messageCount: sessionMessages.length });
        }
      }
    } catch (sessionErr) {
      log('warn', `Failed to load session context for execution ${executionId}: ${sessionErr.message}`);
    }

    const executionContextMessages = buildExecutionContextMessages({
      triggerType,
      metadata: executionMetadata,
    });
    if (executionContextMessages.length > 0) {
      messages.push(...executionContextMessages);
      addActivity('execution_context', `Loaded ${executionContextMessages.length} execution context message(s)`);
    }
    if (lastExecutionPolicySummary) {
      addActivity('runtime_policy', lastExecutionPolicySummary);
    }
    if (executionPolicy?.forceApprovalForAllTools) {
      addActivity('approval_gate', executionPolicy.reason);
    }

    addActivity('llm_call', `Calling ${worker.model}${worker.provider_mode === 'byok' ? ' (BYOK ' + (worker.byok_provider || '') + ')' : ''}`);

    // Build tools: merge charter-defined tools with connected integration tools and builtins
    let tools = charter.tools && Array.isArray(charter.tools) ? [...charter.tools] : [];
    try {
      const integrationTools = await getAvailableTools(worker.tenant_id);
      if (integrationTools.length > 0) {
        tools.push(...integrationTools);
        addActivity('tools_loaded', `${integrationTools.length} integration tool(s) available`);
      }
    } catch (toolErr) {
      addActivity('tools_warn', `Failed to load integration tools: ${toolErr.message}`);
    }
    const builtinTools = getBuiltinTools();
    tools.push(...builtinTools);
    addActivity('tools_loaded', `${builtinTools.length} built-in tool(s) available`);

    // Add meta-agent management tools if this is the meta-agent
    if (isMetaAgent(worker)) {
      const metaTools = getMetaAgentTools(pool, worker.tenant_id);
      tools.push(...metaTools);
      addActivity('meta_agent', `Loaded ${metaTools.length} fleet management tools`);
    }

    // Add delegation tool — available to any worker with canDo capabilities
    tools.push({
      type: 'function',
      function: {
        name: '__delegate_task',
        description: 'Delegate a subtask to another worker. The child worker gets a subset of your capabilities.',
        parameters: {
          type: 'object',
          properties: {
            child_worker_id: { type: 'string', description: 'ID of the worker to delegate to' },
            task_description: { type: 'string', description: 'What the child worker should do' },
            capabilities: { type: 'array', items: { type: 'string' }, description: 'Capabilities to grant' },
            max_cost_usd: { type: 'number', description: 'Maximum cost budget' },
          },
          required: ['child_worker_id', 'task_description', 'capabilities'],
        },
      },
    });

    if (tools.length === 0) tools = undefined;

    let result;
    let usage;
    if (isResume) {
      const approvedToolCalls = resumeContext.approvedToolCalls.map((tool, index) => ({
        id: tool.id || `approved_${index + 1}`,
        name: tool.name,
        arguments: tool.args || {},
        __charterVerdict: 'askFirst',
        __approvalDecision: 'approved',
        __matchedRule: tool.matchedRule || null,
      }));
      result = {
        response: resumeContext.priorAssistantResponse || '',
        toolCalls: approvedToolCalls,
      };
      usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
      addActivity('approval_resume', `Replaying ${approvedToolCalls.length} approved tool(s) without re-requesting approval`);
    } else {
      // Rate limit check before calling OpenRouter
      if (!canCallOpenRouter()) {
        addActivity('rate_limited', 'OpenRouter rate limit reached, skipping execution (will retry next poll)');
        log('warn', `Rate limited: skipping execution ${executionId} for worker ${worker.name}`);
        await updateExecution(executionId, {
          status: 'queued',
          completedAt: null,
          error: null,
          activity,
        });
        return;
      }

      // Execute via resolved provider (OpenRouter, Anthropic BYOK, or OpenAI BYOK)
      result = await withSpan('llm.call', { model: worker.model, round: 1 }, () =>
        chatCompletionForWorker(worker, {
          model: worker.model,
          messages,
          tools,
          maxTokens: charter.maxTokens || 4096,
          temperature: charter.temperature ?? 0.2,
        })
      );

      usage = result.usage;
      const llmDurationMs = Date.now() - startedAt.getTime();
      addActivity('llm_response', `Received ${usage.totalTokens} tokens (cost: $${usage.cost.toFixed(6)})`);
      tracer.trace('llm_call', { model: worker.model, tokens: usage.totalTokens, cost: usage.cost, round: 1 }, llmDurationMs);
    }

    // Handle tool calls — single round for scheduled executions
    let finalResponse = result.response;
    let totalPromptTokens = usage.promptTokens;
    let totalCompletionTokens = usage.completionTokens;
    let totalCost = usage.cost;
    let rounds = 1;
    let toolCallCount = 0;
    const toolNames = [];
    const blockedActions = [];
    const approvalsPending = [];
    // Track daily tool call counts for capability constraints
    const dailyToolCounts = {};
    const executedToolResults = [];
    const verificationPlan = charter.verificationPlan || createDefaultVerificationPlan();
    let interruption = null;

    if (result.toolCalls && result.toolCalls.length > 0) {
      toolCallCount = result.toolCalls.length;
      addActivity('tool_calls', `${toolCallCount} tool call(s): ${result.toolCalls.map(tc => tc.name).join(', ')}`);

      // --- Charter enforcement: validate each tool call against canDo/askFirst/neverDo ---
      const blockedTools = [];
      const approvalNeeded = [];

      for (const tc of result.toolCalls) {
        toolNames.push(tc.name);
        dailyToolCounts[tc.name] = (dailyToolCounts[tc.name] || 0) + 1;
        const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : (tc.arguments || {});
        if (isResume) continue;
        const validation = validateToolCall(charter, tc.name, args, charter.worldModel || null, { ...executionPolicy, dailyCounts: dailyToolCounts });

        if (!validation.allowed) {
          if (validation.requiresApproval) {
            approvalNeeded.push({ toolCall: tc, args, validation });
            approvalsPending.push({ tool: tc.name, args, rule: validation.matchedRule || validation.rule });
            addActivity('charter_approval', `Tool "${tc.name}" requires approval: ${validation.reason}`);
            tracer.trace('approval_gate', { tool: tc.name, reason: validation.reason, rule: validation.matchedRule || validation.rule });
          } else {
            blockedTools.push({ toolCall: tc, validation });
            blockedActions.push({ tool: tc.name, args, rule: validation.rule });
            addActivity('charter_block', `Tool "${tc.name}" blocked: ${validation.reason}`);
            tracer.trace('charter_decision', { tool: tc.name, verdict: 'neverDo', reason: validation.reason });
          }
        }
      }

      // If any tool calls were blocked by neverDo, fail the execution
      if (blockedTools.length > 0) {
        const blockReasons = blockedTools.map(b => `${b.toolCall.name}: ${b.validation.reason}`);
        log('warn', `Charter blocked tool calls for worker ${worker.name}: ${blockReasons.join('; ')}`);

        await finalizeExecution(executionId, {
          status: 'charter_blocked',
          completedAt: new Date(),
          error: `Charter enforcement blocked tool calls: ${blockReasons.join('; ')}`,
          activity,
          model: worker.model,
          tokensIn: totalPromptTokens,
          tokensOut: totalCompletionTokens,
          costUsd: totalCost,
          rounds,
          toolCalls: toolCallCount,
          receipt: buildExecutionReceipt({
            worker,
            executionId,
            finalResponse,
            totalPromptTokens,
            totalCompletionTokens,
            totalCost,
            startedAt,
            rounds,
            toolCallCount,
            blockedActions,
            approvalsPending,
            toolResults: executedToolResults,
            verificationPlan,
            interruption: { code: 'charter_blocked', detail: blockReasons.join('; ') },
          }),
        }, worker.tenant_id, totalCost);
        return;
      }

      // If any tool calls need approval, pause and create approval records
      if (approvalNeeded.length > 0) {
        log('info', `Charter requires approval for worker ${worker.name}: ${approvalNeeded.map(a => a.toolCall.name).join(', ')}`);

        let approvalCount = 0;
        for (const { toolCall, args, validation } of approvalNeeded) {
          try {
            const approvalId = await createApprovalRecord(pool, {
              workerId: worker.id,
              tenantId: worker.tenant_id,
              executionId,
              toolName: toolCall.name,
              toolArgs: args,
              action: `Tool call: ${toolCall.name}`,
              matchedRule: validation.matchedRule || validation.rule,
            });
            if (approvalId) approvalCount++;
            else log('warn', `Approval record was not created for ${toolCall.name} on execution ${executionId}`);
          } catch (aprErr) {
            log('warn', `Failed to create approval record: ${aprErr.message}`);
          }
        }

        if (approvalCount === 0) {
          // All approval records failed — don't charge, mark as error
          await updateExecution(executionId, {
            status: 'error',
            completedAt: new Date(),
            error: 'Failed to create approval records. No credits deducted.',
            activity,
          });
          return;
        }

        await finalizeExecution(executionId, {
          status: 'awaiting_approval',
          completedAt: new Date(),
          error: `Paused: ${approvalCount} tool call(s) require approval`,
          activity,
          model: worker.model,
          tokensIn: totalPromptTokens,
          tokensOut: totalCompletionTokens,
          costUsd: totalCost,
          rounds,
          toolCalls: toolCallCount,
          result: result.response?.slice(0, 50000),
          receipt: buildExecutionReceipt({
            worker,
            executionId,
            finalResponse: result.response,
            totalPromptTokens,
            totalCompletionTokens,
            totalCost,
            startedAt,
            rounds,
            toolCallCount,
            blockedActions,
            approvalsPending,
            toolResults: executedToolResults,
            verificationPlan,
            interruption: { code: 'awaiting_approval', detail: `${approvalCount} tool call(s) require approval` },
          }),
        }, worker.tenant_id, totalCost);

        // Notify tenant that approval is needed
        try {
          await deliverNotification({
            pool,
            tenantId: worker.tenant_id,
            event: 'approval.required',
            worker: { id: worker.id, name: worker.name },
            execution: {
              id: executionId,
              action: approvalNeeded[0]?.toolCall?.name || 'unknown action',
              requestId: executionId,
              details: `Rule: ${approvalNeeded[0]?.validation?.matchedRule || approvalNeeded[0]?.validation?.rule || 'ask first'}`,
            },
            log,
          });
        } catch (notifErr) {
          log('warn', `[notifications] Failed to send approval notification: ${notifErr.message}`);
        }

        return;
      }

      // --- AGENTIC LOOP: execute tools and feed results back to LLM ---
      const MAX_ROUNDS = 12;
      let currentMessages = [...messages];
      let lastResult = result;

      // Add assistant's response (with tool calls) to conversation
      currentMessages.push({ role: 'assistant', content: lastResult.response || '', tool_calls: lastResult.toolCalls });

      while (lastResult.toolCalls && lastResult.toolCalls.length > 0 && rounds < MAX_ROUNDS) {
        // Execute tool calls IN PARALLEL for better latency
        const toolCalls = lastResult.toolCalls;
        addActivity('tool_exec', `Executing ${toolCalls.length} tool(s) in parallel: ${toolCalls.map(tc => tc.name).join(', ')}`);

        const toolPromises = toolCalls.map(async (tc) => {
          return withSpan('tool.execute', { 'tool.name': tc.name }, async () => {
            const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : (tc.arguments || {});
            try {
              let toolResult;
              if (isShadowMode) {
                toolResult = { success: true, result: { shadow: true, message: `[Shadow] Would execute ${tc.name} with args: ${JSON.stringify(args).slice(0, 200)}` } };
              } else if (tc.name === '__delegate_task') {
                try {
                  const grant = await createDelegation(
                    pool,
                    worker.id,
                    args.child_worker_id,
                    worker.tenant_id,
                    {
                      capabilities: args.capabilities || [],
                      taskDescription: args.task_description,
                      maxCostUsd: args.max_cost_usd,
                    },
                  );
                  toolResult = { success: true, result: { grant_id: grant.id, granted_capabilities: grant.granted_capabilities, status: grant.status } };
                } catch (delegationErr) {
                  toolResult = { success: false, result: `Delegation failed: ${delegationErr.message}` };
                }
              } else if (tc.name.startsWith('__') && isMetaAgent(worker)) {
                const metaResult = await executeMetaAgentTool(pool, worker.tenant_id, tc.name, args);
                toolResult = metaResult;
              } else {
                const toolPromise = isBuiltinTool(tc.name)
                  ? executeBuiltinTool(tc.name, args, {
                    execution_id: executionId,
                    tool_call_id: tc.id || null,
                    worker_id: worker.id,
                    tenant_id: worker.tenant_id,
                    charter,
                  })
                  : executeTool(worker.tenant_id, tc.name, args);

                toolResult = await Promise.race([
                  toolPromise,
                  new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool ${tc.name} timed out after ${TOOL_TIMEOUT_MS}ms`)), TOOL_TIMEOUT_MS))
                ]);
              }
              return { tc, toolResult, args };
            } catch (err) {
              throw { tc, args, error: err };
            }
          });
        });

        const settledResults = await Promise.allSettled(toolPromises);
        const toolResults = [];
        for (const settled of settledResults) {
          if (settled.status === 'rejected') {
            const rejected = settled.reason || {};
            const tc = rejected.tc || { id: 'unknown', name: 'error' };
            const args = rejected.args || {};
            const err = rejected.error || rejected;
            toolResults.push({ role: 'tool', tool_call_id: tc.id || tc.name || 'unknown', name: tc.name || 'error', content: `Tool execution failed: ${err?.message || String(err)}` });
            executedToolResults.push({
              round: rounds,
              name: tc.name || 'error',
              args,
              success: false,
              error: err?.message || String(err),
              charterVerdict: tc.__charterVerdict || 'canDo',
              approvalDecision: tc.__approvalDecision || null,
              matchedRule: tc.__matchedRule || null,
            });
            addActivity('tool_error', `Tool execution failed: ${err?.message || String(err)}`);
            continue;
          }
          const { tc, toolResult, args } = settled.value;
          let resultStr;
          if (toolResult.success) {
            const raw = typeof toolResult.result === 'string' ? toolResult.result : JSON.stringify(toolResult.result);
            resultStr = raw.length > MAX_TOOL_RESULT_SIZE ? raw.slice(0, MAX_TOOL_RESULT_SIZE) + '...[truncated]' : raw;
          } else {
            resultStr = `Error: ${toolResult.error}`;
          }

          toolResults.push({
            role: 'tool',
            tool_call_id: tc.id || tc.name,
            name: tc.name,
            content: resultStr.slice(0, 20000), // Cap tool output
          });
          executedToolResults.push({
            round: rounds,
            name: tc.name,
            args,
            success: Boolean(toolResult.success),
            error: toolResult.success ? null : toolResult.error,
            charterVerdict: tc.__charterVerdict || 'canDo',
            approvalDecision: tc.__approvalDecision || null,
            matchedRule: tc.__matchedRule || null,
          });

          if (isShadowMode) {
            addActivity('shadow_tool', `Would execute: ${tc.name}`);
          } else {
            addActivity('tool_result', `${tc.name}: ${toolResult.success ? 'success' : 'error: ' + toolResult.error}`);
          }
          tracer.trace('tool_exec', { tool: tc.name, success: Boolean(toolResult.success), round: rounds });
        }

        if (!isShadowMode) {
          sideEffectPolicyState = await resolveCurrentSideEffectPolicy(pool, worker);
          if (sideEffectPolicyState.autoPauseReasons.length > 0) {
            addActivity('runtime_policy', sideEffectPolicyState.autoPauseReasons.join('; '));
            await autoPauseWorker(pool, worker.id, executionId, sideEffectPolicyState.autoPauseReasons);
            await finalizeExecution(executionId, {
              status: 'auto_paused',
              completedAt: new Date(),
              error: `Auto-paused: ${sideEffectPolicyState.autoPauseReasons.join('; ')}`,
              activity,
              model: worker.model,
              tokensIn: totalPromptTokens,
              tokensOut: totalCompletionTokens,
              costUsd: totalCost,
              rounds,
              toolCalls: toolCallCount,
              result: finalResponse?.slice(0, 50000) || '',
              receipt: buildExecutionReceipt({
                worker,
                executionId,
                finalResponse,
                totalPromptTokens,
                totalCompletionTokens,
                totalCost,
                startedAt,
                rounds,
                toolCallCount,
                blockedActions,
                approvalsPending,
                toolResults: executedToolResults,
                verificationPlan,
                interruption: {
                  code: 'runtime_policy_auto_pause',
                  detail: sideEffectPolicyState.autoPauseReasons.join('; '),
                },
              }),
            }, worker.tenant_id, totalCost);
            return;
          }

          executionPolicy = mergeExecutionPolicies(staticExecutionPolicy, sideEffectPolicyState.policy);
          const refreshedExecutionPolicySummary = describeExecutionPolicy(executionPolicy);
          if (refreshedExecutionPolicySummary && refreshedExecutionPolicySummary !== lastExecutionPolicySummary) {
            addActivity('runtime_policy', refreshedExecutionPolicySummary);
          }
          lastExecutionPolicySummary = refreshedExecutionPolicySummary;
        }

        // Feed tool results back to LLM
        currentMessages.push(...toolResults);
        rounds++;

        // Checkpoint: persist current state after each round
        try {
          await pool.query(
            `UPDATE worker_executions SET activity = $2::jsonb, rounds = $3, tokens_in = $4, tokens_out = $5, cost_usd = $6 WHERE id = $1`,
            [executionId, JSON.stringify(activity), rounds, totalPromptTokens, totalCompletionTokens, totalCost]
          );
        } catch (cpErr) {
          log('warn', `Checkpoint failed for ${executionId}: ${cpErr.message}`);
        }

        // Cost cap check — kill execution if it's getting too expensive
        if (totalCost >= EXECUTION_COST_CAP) {
          addActivity('cost_cap', `Execution cost $${totalCost.toFixed(4)} exceeded cap $${EXECUTION_COST_CAP.toFixed(2)}, stopping`);
          log('warn', `Execution ${executionId} hit cost cap: $${totalCost.toFixed(4)} >= $${EXECUTION_COST_CAP}`);
          interruption = {
            code: 'cost_cap',
            detail: `Execution cost $${totalCost.toFixed(4)} exceeded cap $${EXECUTION_COST_CAP.toFixed(2)}`,
          };
          break;
        }

        // Per-execution timeout check (5 minutes)
        if (Date.now() >= executionDeadline) {
          addActivity('error', 'Execution timeout exceeded (5 min)');
          log('warn', `Execution ${executionId} hit 5-minute deadline`);
          await finalizeExecution(executionId, {
            status: 'failed',
            completedAt: new Date(),
            error: 'Execution timeout exceeded',
            activity,
            model: worker.model,
            tokensIn: totalPromptTokens,
            tokensOut: totalCompletionTokens,
            costUsd: totalCost,
            rounds,
            toolCalls: toolCallCount,
            result: finalResponse?.slice(0, 50000),
            receipt: buildExecutionReceipt({
              worker,
              executionId,
              finalResponse,
              totalPromptTokens,
              totalCompletionTokens,
              totalCost,
              startedAt,
              rounds,
              toolCallCount,
              blockedActions,
              approvalsPending,
              toolResults: executedToolResults,
              verificationPlan,
              interruption: { code: 'timeout', detail: 'Execution timeout exceeded' },
            }),
          }, worker.tenant_id, totalCost);
          return;
        }

        // Overspend protection — check tenant balance after each round
        try {
          const roundBalance = await pool.query(
            'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1',
            [worker.tenant_id]
          );
          const currentBalance = parseFloat(roundBalance.rows[0]?.balance_usd ?? 0);
          if (currentBalance < MIN_BALANCE_THRESHOLD) {
            addActivity('error', 'Insufficient balance — execution stopped');
            log('warn', `Execution ${executionId} stopped: tenant ${worker.tenant_id} balance $${currentBalance.toFixed(4)} < $${MIN_BALANCE_THRESHOLD}`);
            interruption = {
              code: 'insufficient_balance',
              detail: `Tenant balance $${currentBalance.toFixed(4)} dropped below $${MIN_BALANCE_THRESHOLD}`,
            };
            break;
          }
        } catch (balErr) {
          log('warn', `Balance check failed during agentic loop: ${balErr.message}`);
          // Fail open — don't kill execution if the check itself fails
        }

        // Rate limit check for subsequent LLM rounds
        if (!canCallOpenRouter()) {
          addActivity('rate_limited', `Round ${rounds}: rate limited, stopping agentic loop`);
          log('warn', `Rate limited during agentic loop round ${rounds} for execution ${executionId}`);
          interruption = {
            code: 'rate_limited',
            detail: `Rate limited during agentic loop round ${rounds}`,
          };
          break;
        }

        addActivity('llm_call', `Round ${rounds}: feeding ${toolResults.length} tool result(s) back to LLM`);

        const nextResult = await withSpan('llm.call', { model: worker.model, round: rounds }, () =>
          chatCompletionForWorker(worker, {
            model: worker.model,
            messages: currentMessages,
            tools,
            maxTokens: charter.maxTokens || 4096,
            temperature: charter.temperature ?? 0.2,
          })
        );

        totalPromptTokens += nextResult.usage.promptTokens;
        totalCompletionTokens += nextResult.usage.completionTokens;
        totalCost += nextResult.usage.cost;
        addActivity('llm_response', `Round ${rounds}: ${nextResult.usage.totalTokens} tokens ($${nextResult.usage.cost.toFixed(6)})`);

        lastResult = nextResult;
        finalResponse = lastResult.response || finalResponse;

        // If LLM returned more tool calls, validate them before continuing
        if (lastResult.toolCalls && lastResult.toolCalls.length > 0) {
          toolCallCount += lastResult.toolCalls.length;
          for (const tc of lastResult.toolCalls) {
            toolNames.push(tc.name);
            dailyToolCounts[tc.name] = (dailyToolCounts[tc.name] || 0) + 1;
            const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : (tc.arguments || {});
            const validation = validateToolCall(charter, tc.name, args, charter.worldModel || null, { ...executionPolicy, dailyCounts: dailyToolCounts });
            if (!validation.allowed && !validation.requiresApproval) {
              addActivity('charter_block', `Round ${rounds}: tool "${tc.name}" blocked: ${validation.reason}`);
              blockedActions.push({ tool: tc.name, args, rule: validation.rule });
              lastResult.toolCalls = []; // Stop the loop
              break;
            }
          }
          // Add assistant message for next round
          currentMessages.push({ role: 'assistant', content: lastResult.response || '', tool_calls: lastResult.toolCalls });
        }
      }

      if (rounds >= MAX_ROUNDS) {
        addActivity('loop_limit', `Agentic loop hit max rounds (${MAX_ROUNDS})`);
        if (lastResult.toolCalls && lastResult.toolCalls.length > 0) {
          interruption = interruption || {
            code: 'max_rounds',
            detail: `Agentic loop hit max rounds (${MAX_ROUNDS})`,
          };
        }
      }
    }

    // --- Charter enforcement: scan LLM response for injection patterns ---
    if (finalResponse) {
      const responseInjection = detectPromptInjection(finalResponse);
      if (!responseInjection.safe && responseInjection.severity === 'high') {
        addActivity('charter_warn', `LLM response contains injection pattern: ${responseInjection.reason}`);
        log('warn', `LLM response injection for worker ${worker.name}: ${responseInjection.reason}`);
      }
    }

    // --- Charter enforcement: anomaly detection ---
    const executionMs = Date.now() - startedAt.getTime();
    const avgCost = await getAvgExecutionCost(pool, worker.id);
    const anomalyResult = detectAnomalies({
      costUsd: totalCost,
      avgCostUsd: avgCost,
      toolCallCount,
      executionMs,
      toolNames,
      charter,
    });

    if (anomalyResult.anomaly) {
      addActivity('anomaly_detected', `Anomalies: ${anomalyResult.reasons.join('; ')}`);
      log('warn', `Anomaly detected for worker ${worker.name} [${executionId}]: ${anomalyResult.reasons.join('; ')}`);

      await autoPauseWorker(pool, worker.id, executionId, anomalyResult.reasons);

      await finalizeExecution(executionId, {
        status: 'auto_paused',
        completedAt: new Date(),
        model: worker.model,
        tokensIn: totalPromptTokens,
        tokensOut: totalCompletionTokens,
        costUsd: totalCost,
        rounds,
        toolCalls: toolCallCount,
        result: finalResponse.slice(0, 50000),
        error: `Auto-paused: ${anomalyResult.reasons.join('; ')}`,
        activity,
        receipt: buildExecutionReceipt({
          worker,
          executionId,
          finalResponse,
          totalPromptTokens,
          totalCompletionTokens,
          totalCost,
          startedAt,
          rounds,
          toolCallCount,
          blockedActions,
          approvalsPending,
          toolResults: executedToolResults,
          verificationPlan,
          interruption: { code: 'auto_paused', detail: anomalyResult.reasons.join('; ') },
        }),
      }, worker.tenant_id, totalCost);

      // Emit learning signals from this execution (auto-pause path)
      try {
        const signals = buildSignalsFromExecution({
          executionId,
          workerId: worker.id,
          tenantId: worker.tenant_id,
          toolResults: executedToolResults.map(tr => ({
            ...tr,
            charterVerdict: tr.charterVerdict || 'canDo',
            approvalDecision: tr.approvalDecision || null,
            matchedRule: tr.matchedRule || null,
          })),
          blockedActions,
          interruptionCode: 'auto_paused',
          executionOutcome: 'failed',
        });
        await persistSignals(pool, signals);
      } catch (sigErr) {
        log('warn', `Failed to persist learning signals for ${executionId}: ${sigErr.message}`);
      }

      return;
    }

    const receipt = buildExecutionReceipt({
      worker,
      executionId,
      finalResponse,
      totalPromptTokens,
      totalCompletionTokens,
      totalCost,
      startedAt,
      rounds,
      toolCallCount,
      blockedActions,
      approvalsPending,
      toolResults: executedToolResults,
      verificationPlan,
      interruption,
    });

    let postRunVerificationPolicyState = { decision: { action: 'allow', anomalies: [] }, policy: null, autoPauseReasons: [] };
    if (!isShadowMode) {
      postRunVerificationPolicyState = await resolveCurrentVerificationPolicy(pool, worker, workerRuntimePolicyRecord, {
        excludeExecutionId: executionId,
        currentReceipt: receipt,
      });
    }

    const runtimeEnforcement = {
      policyVersion: workerRuntimePolicyRecord.version,
      policyContext: {
        tenantUpdatedAt: workerRuntimePolicyRecord.scopes?.tenant?.updatedAt || null,
        tenantUpdatedBy: workerRuntimePolicyRecord.scopes?.tenant?.updatedBy || null,
        workerUpdatedAt: workerRuntimePolicyRecord.scopes?.worker?.updatedAt || null,
        workerUpdatedBy: workerRuntimePolicyRecord.scopes?.worker?.updatedBy || null,
        toolOverrideTools: Object.keys(workerRuntimePolicyRecord.effectiveTools || {}),
      },
      approvals: approvalPolicyState.decision,
      verification: postRunVerificationPolicyState.decision,
      sideEffects: sideEffectPolicyState.decision,
    };
    if (
      approvalPolicyState.decision.action !== 'allow'
      || postRunVerificationPolicyState.decision.action !== 'allow'
      || sideEffectPolicyState.decision.action !== 'allow'
    ) {
      receipt.runtimeEnforcement = runtimeEnforcement;
    }

    if (!isShadowMode && postRunVerificationPolicyState.autoPauseReasons.length > 0) {
      addActivity('runtime_policy', postRunVerificationPolicyState.autoPauseReasons.join('; '));
      await autoPauseWorker(pool, worker.id, executionId, postRunVerificationPolicyState.autoPauseReasons);
      receipt.interruption = {
        code: 'verification_auto_pause',
        detail: postRunVerificationPolicyState.autoPauseReasons.join('; '),
      };
      receipt.success = false;
    }

    // Emit learning signals from this execution
    try {
      const signals = buildSignalsFromExecution({
        executionId,
        workerId: worker.id,
        tenantId: worker.tenant_id,
        toolResults: executedToolResults.map(tr => ({
          ...tr,
          charterVerdict: tr.charterVerdict || 'canDo',
          approvalDecision: tr.approvalDecision || null,
          matchedRule: tr.matchedRule || null,
        })),
        blockedActions,
        interruptionCode: receipt.interruption?.code || null,
        executionOutcome: receipt.businessOutcome === 'passed' && !postRunVerificationPolicyState.autoPauseReasons.length ? 'success' : 'failed',
      });
      await persistSignals(pool, signals);
    } catch (sigErr) {
      log('warn', `Failed to persist learning signals for ${executionId}: ${sigErr.message}`);
    }

    const finalExecutionStatus = isShadowMode
      ? 'shadow_completed'
      : (postRunVerificationPolicyState.autoPauseReasons.length > 0
        ? 'auto_paused'
        : (receipt.success ? 'completed' : 'failed'));
    const finalExecutionError = postRunVerificationPolicyState.autoPauseReasons.length > 0
      ? `Auto-paused: ${postRunVerificationPolicyState.autoPauseReasons.join('; ')}`
      : (receipt.success ? null : `Verification failed: ${receipt.businessOutcome}`);

    // Flush structured trace before finalizing
    await tracer.flush().catch(() => {});

    // Update execution record + deduct credits atomically
    await finalizeExecution(executionId, {
      status: finalExecutionStatus,
      completedAt: new Date(),
      model: worker.model,
      tokensIn: totalPromptTokens,
      tokensOut: totalCompletionTokens,
      costUsd: totalCost,
      rounds,
      toolCalls: toolCallCount,
      result: finalResponse.slice(0, 50000), // cap stored result
      activity,
      error: finalExecutionError,
      receipt,
    }, worker.tenant_id, totalCost);

    // Update session after execution
    if (sessionId) {
      try {
        await updateSessionAfterExecution(pool, sessionId, {
          id: executionId,
          result: finalResponse || '',
          activity,
        });
        const { sessionComplete } = extractSessionUpdates(finalResponse || '');
        if (sessionComplete) {
          log('info', `Session ${sessionId} marked complete by execution ${executionId}`);
        }
      } catch (sessionErr) {
        log('warn', `Failed to update session ${sessionId} after execution ${executionId}: ${sessionErr.message}`);
      }
    }

    // Auto-extract and store episodic memories from this execution
    try {
      const episodicMemories = extractEpisodicMemories(activity, finalResponse || '');
      if (episodicMemories.length > 0) {
        await storeEpisodicMemories(pool, worker.id, worker.tenant_id, executionId, episodicMemories);
        addActivity('memory', `Auto-extracted ${episodicMemories.length} episodic memory/memories`);
      }
    } catch (err) {
      log('warn', `Failed to extract episodic memories for ${executionId}: ${err.message}`);
    }

    // Update competence index
    try {
      const taskType = classifyTaskType(charter, triggerType);
      const durationMs = Date.now() - startedAt.getTime();
      const costUsd = parseFloat(totalCost || 0);
      await updateCompetence(pool, worker.id, worker.tenant_id, taskType, {
        success: true,
        durationMs,
        costUsd,
      });
    } catch (compErr) {
      log('warn', `Failed to update competence for ${worker.id}: ${compErr.message}`);
    }

    // Extract and save memory entries from LLM response
    // REMEMBER: saves to this worker only
    // TEAM_NOTE: saves to shared team memory (all workers can see it)
    // Supports both single-line and multiline (END_REMEMBER / END_TEAM_NOTE) formats
    if (finalResponse) {
      const memoryEntries = parseMemoryEntries(finalResponse);
      for (const entry of memoryEntries) {
        const key = entry.content.slice(0, 80).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
        if (!key) continue;
        await saveWorkerMemory(pool, worker.id, worker.tenant_id, key, entry.content, entry.scope, generateId, log);
        if (entry.scope === 'team') {
          addActivity('memory', `Shared with team: "${key}"`);
        } else {
          addActivity('memory', `Saved memory: "${key}"`);
        }
      }
    }

    const executionSucceeded = finalExecutionStatus === 'completed' || finalExecutionStatus === 'shadow_completed';

    // Complete delegation grant if this was a delegated execution
    if (delegationGrant) {
      try {
        const { completeDelegation } = await import('./delegation.ts');
        await completeDelegation(pool, delegationGrant.id, {
          status: executionSucceeded ? 'completed' : 'failed',
          result: finalResponse || '',
        });
      } catch (err) {
        log('warn', `Failed to complete delegation ${delegationGrant.id}: ${err.message}`);
      }
    }

    // Update worker stats
    await pool.query(`
      UPDATE workers SET
        stats = jsonb_set(
          jsonb_set(
            jsonb_set(stats, '{totalRuns}', to_jsonb((stats->>'totalRuns')::int + 1)),
            ${executionSucceeded ? "'{successfulRuns}'" : "'{failedRuns}'"},
            to_jsonb((stats->>'${executionSucceeded ? 'successfulRuns' : 'failedRuns'}')::int + 1)
          ),
          '{lastRunAt}', to_jsonb($2::text)
        ),
        updated_at = now()
      WHERE id = $1
    `, [worker.id, new Date().toISOString()]);

    log('info', `Execution ${executionId} ${executionSucceeded ? 'completed' : finalExecutionStatus} for worker ${worker.name} (${usage.totalTokens} tokens, $${totalCost.toFixed(6)})`);

    // --- World Runtime bridge: feed execution data into the new modules ---
    if (bridgeEnabled && onExecutionCompleteFn) {
      try {
        await onExecutionCompleteFn(pool, {
          executionId,
          workerId: worker.id,
          workerName: worker.name,
          tenantId: worker.tenant_id,
          triggerType,
          status: executionSucceeded ? 'completed' : 'failed',
          toolCalls: (toolResults || []).map(tr => ({
            tool: tr.toolName || tr.name || 'unknown',
            actionClass: `legacy.${(tr.toolName || tr.name || 'unknown').toLowerCase()}`,
            status: tr.blocked ? 'blocked' : tr.approvalRequired ? 'escrowed' : 'executed',
            targetObjectId: undefined,
            targetObjectType: undefined,
            error: tr.error || undefined,
          })),
          result: finalResponse?.slice(0, 5000),
          tokensUsed: usage.totalTokens || 0,
          costCents: Math.round(totalCost * 100),
          durationMs: Date.now() - startedAt.getTime(),
          receipt,
        });
      } catch (bridgeErr) {
        log('warn', `World Runtime bridge error (non-fatal): ${bridgeErr.message}`);
      }
    }

    if (executionSucceeded) {
      // Deliver completion notification
      try {
        await deliverNotification({
          pool, tenantId: worker.tenant_id,
          event: 'execution.completed',
          worker: { id: worker.id, name: worker.name },
          execution: {
            id: executionId,
            summary: finalResponse.slice(0, 200),
            costUsd: totalCost,
            durationMs: Date.now() - startedAt.getTime(),
          },
          log,
        });
      } catch (notifErr) {
        log('warn', `Notification delivery failed for ${executionId}: ${notifErr.message}`);
      }

      // Execution chaining: trigger the next worker if configured
      try {
        const chain = typeof worker.chain === 'string' ? JSON.parse(worker.chain) : worker.chain;
        if (chain?.onComplete) {
          const nextWorker = await pool.query(
            'SELECT * FROM workers WHERE id = $1 AND tenant_id = $2',
            [chain.onComplete, worker.tenant_id]
          );
          if (nextWorker.rows[0] && nextWorker.rows[0].status !== 'archived' && nextWorker.rows[0].status !== 'paused') {
            const chainExecId = generateId('exec');
            const chainActivity = chain.passResult
              ? [{ ts: new Date().toISOString(), type: 'chain_input', detail: `Chained from ${worker.name}`, data: finalResponse?.slice(0, 10000) }]
              : [{ ts: new Date().toISOString(), type: 'chain_input', detail: `Chained from ${worker.name}` }];
            await pool.query(
              `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at, activity)
               VALUES ($1, $2, $3, 'chain', 'queued', $4, $5, $6::jsonb)`,
              [chainExecId, chain.onComplete, worker.tenant_id, nextWorker.rows[0].model, new Date().toISOString(), JSON.stringify(chainActivity)]
            );
            addActivity('chain', `Chained to worker "${nextWorker.rows[0].name}" (${chainExecId})`);
            log('info', `Chain triggered: ${worker.name} -> ${nextWorker.rows[0].name} (${chainExecId})`);
          } else if (!nextWorker.rows[0]) {
            log('warn', `Chain target worker ${chain.onComplete} not found for worker ${worker.name}`);
          }
        }
      } catch (chainErr) {
        log('warn', `Chain execution failed for worker ${worker.name}: ${chainErr.message}`);
      }
    } else {
      try {
        await deliverNotification({
          pool, tenantId: worker.tenant_id,
          event: 'execution.failed',
          worker: { id: worker.id, name: worker.name },
          execution: { id: executionId, error: finalExecutionError?.slice(0, 500) || finalExecutionStatus },
          log,
        });
      } catch (notifErr) {
        log('warn', `Failure notification delivery failed for ${executionId}: ${notifErr.message}`);
      }
    }

    // Check for low balance and send budget alert
    try {
      const postBalance = await pool.query(
        'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1',
        [worker.tenant_id]
      );
      const remaining = parseFloat(postBalance.rows[0]?.balance_usd ?? 0);
      if (remaining > 0 && remaining < 1.00) {
        await deliverNotification({
          pool, tenantId: worker.tenant_id,
          event: 'budget.low',
          worker: { id: worker.id, name: worker.name },
          execution: { balance: remaining },
          log,
        });
      }
    } catch (budgetErr) {
      log('warn', `Budget alert check failed: ${budgetErr.message}`);
    }
  } catch (err) {
    addActivity('error', err.message);
    tracer.trace('error', { message: err.message });
    log('error', `Execution ${executionId} failed for worker ${worker.name}: ${err.message}`);

    await tracer.flush().catch(() => {});
    await updateExecution(executionId, {
      status: 'failed',
      completedAt: new Date(),
      error: err.message.slice(0, 2000),
      activity,
    });

    // Update worker failure stats
    try {
      await pool.query(`
        UPDATE workers SET
          stats = jsonb_set(
            jsonb_set(stats, '{totalRuns}', to_jsonb((stats->>'totalRuns')::int + 1)),
            '{failedRuns}', to_jsonb((stats->>'failedRuns')::int + 1)
          ),
          updated_at = now()
        WHERE id = $1
      `, [worker.id]);
    } catch (statsErr) {
      log('error', `Failed to update stats for ${worker.id}: ${statsErr.message}`);
    }

    // Update competence index on failure
    try {
      const failCharter = typeof worker.charter === 'string' ? JSON.parse(worker.charter) : (worker.charter || {});
      const taskType = classifyTaskType(failCharter, triggerType);
      const durationMs = Date.now() - startedAt.getTime();
      await updateCompetence(pool, worker.id, worker.tenant_id, taskType, {
        success: false,
        durationMs,
        costUsd: 0,
      });
    } catch (compErr) {
      log('warn', `Failed to update competence for ${worker.id}: ${compErr.message}`);
    }

    // Deliver failure notification
    try {
      await deliverNotification({
        pool, tenantId: worker.tenant_id,
        event: 'execution.failed',
        worker: { id: worker.id, name: worker.name },
        execution: { id: executionId, error: err.message.slice(0, 500) },
        log,
      });
    } catch (notifErr) {
      log('warn', `Failure notification delivery failed for ${executionId}: ${notifErr.message}`);
    }
  }
  }); // end withSpan('worker.execute')
}

/**
 * Update an execution record in Postgres.
 */
async function updateExecution(executionId, data) {
  const sets = ['completed_at = $2', 'status = $3'];
  const values = [executionId, data.completedAt, data.status];
  let idx = 4;
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(data, key);

  if (data.model != null) { sets.push(`model = $${idx}`); values.push(data.model); idx++; }
  if (data.tokensIn != null) { sets.push(`tokens_in = $${idx}`); values.push(data.tokensIn); idx++; }
  if (data.tokensOut != null) { sets.push(`tokens_out = $${idx}`); values.push(data.tokensOut); idx++; }
  if (data.costUsd != null) { sets.push(`cost_usd = $${idx}`); values.push(data.costUsd); idx++; }
  if (data.rounds != null) { sets.push(`rounds = $${idx}`); values.push(data.rounds); idx++; }
  if (data.toolCalls != null) { sets.push(`tool_calls = $${idx}`); values.push(data.toolCalls); idx++; }
  if (hasOwn('result')) { sets.push(`result = $${idx}`); values.push(data.result); idx++; }
  if (hasOwn('activity')) { sets.push(`activity = $${idx}::jsonb`); values.push(JSON.stringify(data.activity)); idx++; }
  if (hasOwn('error')) { sets.push(`error = $${idx}`); values.push(data.error); idx++; }
  if (hasOwn('receipt')) { sets.push(`receipt = $${idx}::jsonb`); values.push(JSON.stringify(data.receipt)); idx++; }

  await pool.query(
    `UPDATE worker_executions SET ${sets.join(', ')} WHERE id = $1`,
    values
  );
}

/**
 * Deduct credits from a tenant's balance and record the transaction.
 */
async function deductCredits(tenantId, costUsd, executionId) {
  if (costUsd <= 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE tenant_credits SET
        balance_usd = balance_usd - $2,
        total_spent_usd = total_spent_usd + $2,
        updated_at = now()
      WHERE tenant_id = $1
    `, [tenantId, costUsd]);

    await client.query(`
      INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, execution_id, created_at)
      VALUES ($1, $2, $3, 'execution_charge', $4, $5, now())
    `, [
      generateId('txn'),
      tenantId,
      -costUsd,
      `Worker execution charge: $${costUsd.toFixed(6)}`,
      executionId,
    ]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', `Failed to deduct credits for tenant ${tenantId}: ${err.message}`);
  } finally {
    client.release();
  }
}

/**
 * Atomically update execution record AND deduct credits in a single transaction.
 * Use this for all final status updates that also need credit deduction.
 */
async function finalizeExecution(executionId, data, tenantId, costUsd) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update execution
    const sets = ['completed_at = $2', 'status = $3'];
    const values = [executionId, data.completedAt, data.status];
    let idx = 4;
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(data, key);
    if (data.model != null) { sets.push(`model = $${idx}`); values.push(data.model); idx++; }
    if (data.tokensIn != null) { sets.push(`tokens_in = $${idx}`); values.push(data.tokensIn); idx++; }
    if (data.tokensOut != null) { sets.push(`tokens_out = $${idx}`); values.push(data.tokensOut); idx++; }
    if (data.costUsd != null) { sets.push(`cost_usd = $${idx}`); values.push(data.costUsd); idx++; }
    if (data.rounds != null) { sets.push(`rounds = $${idx}`); values.push(data.rounds); idx++; }
    if (data.toolCalls != null) { sets.push(`tool_calls = $${idx}`); values.push(data.toolCalls); idx++; }
    if (hasOwn('result')) { sets.push(`result = $${idx}`); values.push(data.result); idx++; }
    if (hasOwn('activity')) { sets.push(`activity = $${idx}::jsonb`); values.push(JSON.stringify(data.activity)); idx++; }
    if (hasOwn('error')) { sets.push(`error = $${idx}`); values.push(data.error); idx++; }
    if (hasOwn('receipt')) { sets.push(`receipt = $${idx}::jsonb`); values.push(JSON.stringify(data.receipt)); idx++; }

    await client.query(`UPDATE worker_executions SET ${sets.join(', ')} WHERE id = $1`, values);

    // Deduct credits atomically — only deducts if sufficient balance exists
    if (costUsd > 0) {
      await client.query(`
        WITH deduction AS (
          UPDATE tenant_credits
          SET balance_usd = balance_usd - $2,
              total_spent_usd = total_spent_usd + $2,
              updated_at = now()
          WHERE tenant_id = $1 AND balance_usd >= $2
          RETURNING balance_usd
        )
        INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, execution_id, created_at)
        SELECT $3, $1, $4, 'execution_charge', $5, $6, now()
        FROM deduction
      `, [tenantId, costUsd, generateId('txn'), -costUsd, `Worker execution charge: $${costUsd.toFixed(6)}`, executionId]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    log('error', `Failed to finalize execution ${executionId}: ${err.message}`);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Scheduler state — poll loop moved to scheduler.ts
// ---------------------------------------------------------------------------

let shuttingDown = false;
const runningExecutions = new Set();
const runningWorkers = new Set();


// Export the main function
export { executeWorker, updateExecution, deductCredits, finalizeExecution };
