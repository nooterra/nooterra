/**
 * Bridge — connects the new world runtime modules into the existing execution loop.
 *
 * This is the integration layer. When the existing runtime executes a worker,
 * the bridge feeds data into the event ledger, object graph, state estimator,
 * evaluation engine, and coverage map.
 *
 * The bridge runs ALONGSIDE the existing system, not replacing it. Once all
 * data flows through the bridge, the old paths can be deprecated.
 */

import type pg from 'pg';
import { appendEvent, type AppendEventInput } from './ledger/event-store.js';
import { findBySourceId, updateObject, queryObjects } from './objects/graph.js';
import { processEvents } from './state/estimator.js';
import { gradeTrace, type ExecutionTrace } from './eval/grading.js';
import { CoverageMap, generateProposals } from './eval/coverage.js';
import { createTraceId } from './core/trace.js';
import { recordCoverageObservation } from './eval/autonomy-enforcer.js';
import { withLogContext } from '../services/runtime/lib/log.js';

// ---------------------------------------------------------------------------
// Singleton coverage map (in-memory, persisted to DB periodically)
// ---------------------------------------------------------------------------

export const coverageMap = new CoverageMap();

// ---------------------------------------------------------------------------
// Execution lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * Called AFTER a worker execution completes (success or failure).
 * Feeds execution data into the world runtime.
 */
export async function onExecutionComplete(
  pool: pg.Pool,
  execution: {
    executionId: string;
    workerId: string;
    workerName: string;
    tenantId: string;
    triggerType: string;
    status: 'completed' | 'failed' | 'charter_blocked' | 'rate_limited';
    toolCalls: ToolCallRecord[];
    result?: string;
    tokensUsed: number;
    costCents: number;
    durationMs: number;
    receipt?: any;
  },
): Promise<void> {
  const traceId = createTraceId();

  return withLogContext({ traceId, tenantId: execution.tenantId }, async () => {
  try {
    // 1. Write execution event to the ledger
    const eventType = execution.status === 'completed'
      ? 'agent.action.executed'
      : 'agent.action.blocked';

    await appendEvent(pool, {
      tenantId: execution.tenantId,
      type: eventType,
      timestamp: new Date(),
      sourceType: 'agent',
      sourceId: execution.workerId,
      objectRefs: execution.toolCalls
        .filter(tc => tc.targetObjectId)
        .map(tc => ({
          objectId: tc.targetObjectId!,
          objectType: tc.targetObjectType || 'unknown',
          role: 'target',
        })),
      payload: {
        executionId: execution.executionId,
        workerName: execution.workerName,
        status: execution.status,
        toolCallCount: execution.toolCalls.length,
        tokensUsed: execution.tokensUsed,
        costCents: execution.costCents,
        durationMs: execution.durationMs,
      },
      provenance: {
        sourceSystem: 'runtime',
        sourceId: execution.executionId,
        extractionMethod: 'api',
        extractionConfidence: 1.0,
      },
      traceId,
    });

    // 2. Write individual tool call events
    for (const tc of execution.toolCalls) {
      const toolEventType = tc.status === 'executed'
        ? 'agent.action.executed'
        : tc.status === 'blocked'
        ? 'agent.action.blocked'
        : 'agent.action.escrowed';

      await appendEvent(pool, {
        tenantId: execution.tenantId,
        type: toolEventType,
        timestamp: new Date(),
        sourceType: 'agent',
        sourceId: execution.workerId,
        objectRefs: tc.targetObjectId
          ? [{ objectId: tc.targetObjectId, objectType: tc.targetObjectType || 'unknown', role: 'target' }]
          : [],
        payload: {
          executionId: execution.executionId,
          tool: tc.tool,
          actionClass: tc.actionClass,
          status: tc.status,
          error: tc.error,
        },
        provenance: {
          sourceSystem: 'runtime',
          sourceId: execution.executionId,
          extractionMethod: 'api',
          extractionConfidence: 1.0,
        },
        traceId,
      });
    }

    // 3. Run state estimator on affected objects
    const events = await import('./ledger/event-store.js').then(m =>
      m.queryEvents(pool, { tenantId: execution.tenantId, traceId, limit: 50 })
    );
    if (events.length > 0) {
      await processEvents(pool, events);
    }

    // 4. Grade the execution trace
    const trace: ExecutionTrace = {
      executionId: execution.executionId,
      agentId: execution.workerId,
      tenantId: execution.tenantId,
      actionClass: execution.toolCalls[0]?.actionClass || 'unknown',
      targetObjectId: execution.toolCalls[0]?.targetObjectId || 'unknown',
      actionsProposed: execution.toolCalls.map(tc => ({
        actionClass: tc.actionClass,
        tool: tc.tool,
        status: tc.status as any,
        evidenceComplete: true,
      })),
      actionsExecuted: execution.toolCalls
        .filter(tc => tc.status === 'executed')
        .map(tc => ({ actionClass: tc.actionClass, tool: tc.tool, status: 'executed' as const, evidenceComplete: true })),
      actionsBlocked: execution.toolCalls
        .filter(tc => tc.status === 'blocked')
        .map(tc => ({ actionClass: tc.actionClass, tool: tc.tool, status: 'denied' as const, reason: tc.error, evidenceComplete: false })),
      actionsEscrowed: execution.toolCalls
        .filter(tc => tc.status === 'escrowed')
        .map(tc => ({ actionClass: tc.actionClass, tool: tc.tool, status: 'escrowed' as const, evidenceComplete: true })),
      contextProvided: true,
      authorityChecked: true,
      disclosureAppended: true, // gateway handles this
      tokensUsed: execution.tokensUsed,
      costCents: execution.costCents,
      durationMs: execution.durationMs,
      objectiveAchieved: execution.status === 'completed' ? undefined : false,
    };

    const grade = gradeTrace(trace);

    // 5. Update coverage map
    for (const tc of execution.toolCalls) {
      coverageMap.recordExecution(
        execution.workerId,
        tc.actionClass,
        tc.targetObjectType || 'unknown',
        grade,
        execution.tenantId,
      );
      await recordCoverageObservation(pool, {
        tenantId: execution.tenantId,
        agentId: execution.workerId,
        actionClass: tc.actionClass,
        objectType: tc.targetObjectType || 'unknown',
        grade,
      });
    }

  } catch (err) {
    // Bridge errors should never break the main execution loop
    // Log and continue
    console.error(`[bridge] Error processing execution ${execution.executionId}: ${(err as Error).message}`);
  }
  }); // end withLogContext
}

/**
 * Called when a Stripe webhook is received.
 * Feeds the webhook data into the event ledger and object graph via the connector.
 */
export async function onStripeWebhook(
  pool: pg.Pool,
  tenantId: string,
  stripeEvent: unknown,
): Promise<{ eventCount: number; objectCount: number }> {
  const traceId = createTraceId();

  return withLogContext({ traceId, tenantId }, async () => {
    const { handleStripeWebhook } = await import('./observation/connectors/stripe.js');
    const { applyConnectorResult } = await import('./observation/connector.js');

    const result = await handleStripeWebhook(
      stripeEvent,
      { tenantId, connectorId: 'stripe' },
      traceId,
    );

    // Inject traceId into all events
    for (const evt of result.events) {
      evt.traceId = traceId;
    }

    const applied = await applyConnectorResult(pool, result);

    // Run state estimator on the new events
    const events = await import('./ledger/event-store.js').then(m =>
      m.queryEvents(pool, { tenantId, traceId, limit: 50 })
    );
    if (events.length > 0) {
      await processEvents(pool, events);
    }

    return { eventCount: applied.eventCount, objectCount: applied.objectCount };
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  tool: string;
  actionClass: string;
  status: 'executed' | 'blocked' | 'escrowed';
  targetObjectId?: string;
  targetObjectType?: string;
  error?: string;
}
