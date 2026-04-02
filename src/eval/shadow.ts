/**
 * Shadow Mode — agents propose actions but don't execute them.
 *
 * Shadow mode is mandatory before live execution. New agents or new
 * action classes must build coverage evidence in shadow mode first.
 * Traces are captured and graded exactly like live executions.
 *
 * The gateway receives shadow actions with a flag that prevents execution.
 */

import type pg from 'pg';
import type { AgentConfig, AgentTask, ExecutionResult, LLMProvider, ToolDefinition } from '../agents/runtime.js';
import type { GatewayConfig } from '../gateway/gateway.js';
import { assembleAgentContext, type MemoryEntry } from '../agents/context-assembly/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShadowResult {
  executionId: string;
  agentId: string;
  traceId: string;
  /** What the agent proposed to do */
  proposedActions: ShadowAction[];
  /** The agent's reasoning/response */
  response?: string;
  /** Whether the shadow run completed without errors */
  success: boolean;
  error?: string;
}

export interface ShadowAction {
  actionClass: string;
  tool: string;
  parameters: Record<string, unknown>;
  /** What the gateway WOULD have decided */
  wouldBeDecision: 'allow' | 'deny' | 'require_approval';
  reason: string;
}

// ---------------------------------------------------------------------------
// Shadow execution
// ---------------------------------------------------------------------------

/**
 * Execute an agent task in shadow mode.
 * The agent proposes actions but nothing is executed.
 * Traces are captured for grading and coverage building.
 */
export async function shadowRun(
  pool: pg.Pool,
  agent: AgentConfig,
  task: AgentTask,
  llm: LLMProvider,
  tools: ToolDefinition[],
  memories: MemoryEntry[] = [],
): Promise<ShadowResult> {
  const { ulid } = await import('ulid');
  const executionId = ulid();
  const proposedActions: ShadowAction[] = [];

  try {
    // Step 1: Assemble context (same as live execution)
    const context = await assembleAgentContext(pool, {
      tenantId: agent.tenantId,
      targetObjectId: task.targetObjectId,
      actionClass: task.actionClass,
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      taskDescription: task.taskDescription,
      domainInstructions: agent.domainInstructions,
      playbook: agent.playbook,
      memories,
    });

    if (!context) {
      return {
        executionId, agentId: agent.id, traceId: task.traceId,
        proposedActions: [], success: false,
        error: `Target object not found: ${task.targetObjectId}`,
      };
    }

    // Step 2: Call the LLM (same as live execution)
    const llmResponse = await llm.chat({
      model: agent.model,
      messages: [
        { role: 'system', content: context.systemContent },
        { role: 'user', content: context.userContent },
      ],
      tools: tools.length > 0 ? tools : undefined,
    });

    // Step 3: For each tool call, check what the gateway WOULD decide
    // but do NOT execute
    const { checkAuthorization } = await import('../policy/authority-graph.js');

    for (const toolCall of llmResponse.toolCalls) {
      const TOOL_ACTION_MAP: Record<string, string> = {
        'send_collection_email': 'communicate.email',
        'create_followup_task': 'task.create',
        'log_collection_note': 'data.write',
      };
      const actionClass = TOOL_ACTION_MAP[toolCall.name] ?? `legacy.${toolCall.name}`;

      let decision: 'allow' | 'deny' | 'require_approval' = 'deny';
      let reason = 'No authority grants';

      try {
        const authResult = await checkAuthorization(pool, {
          agentId: agent.id,
          actionClass,
          targetObjectId: task.targetObjectId,
          targetObjectType: task.targetObjectType,
        });
        decision = authResult.decision;
        reason = authResult.reason;
      } catch {
        decision = 'deny';
        reason = 'Authorization check failed';
      }

      proposedActions.push({
        actionClass,
        tool: toolCall.name,
        parameters: toolCall.arguments,
        wouldBeDecision: decision,
        reason,
      });
    }

    return {
      executionId,
      agentId: agent.id,
      traceId: task.traceId,
      proposedActions,
      response: llmResponse.content ?? undefined,
      success: true,
    };
  } catch (err: any) {
    return {
      executionId, agentId: agent.id, traceId: task.traceId,
      proposedActions, success: false, error: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayResult {
  eventsReplayed: number;
  actionsProposed: number;
  actionsMatched: number;     // would have done the same as actual
  actionsDivergent: number;   // would have done something different
  comparison: ReplayComparison[];
}

export interface ReplayComparison {
  eventId: string;
  eventType: string;
  actualAction?: string;       // what actually happened
  proposedAction?: string;     // what the agent would have done
  match: boolean;
}

/**
 * Replay historical events and compare the agent's proposed actions
 * to what actually happened. This measures "would the agent do better?"
 *
 * V1: structural comparison only (did it propose the right action type).
 * V2+: quality comparison (was the agent's proposed email better/worse).
 */
export function compareReplay(
  proposedActions: ShadowAction[],
  actualEvents: { type: string; id: string }[],
): ReplayResult {
  let matched = 0;
  let divergent = 0;
  const comparison: ReplayComparison[] = [];

  for (const event of actualEvents) {
    // Find a proposed action that matches this event type
    const matching = proposedActions.find(a =>
      event.type.includes(a.actionClass.split('.').pop() ?? '')
    );

    if (matching) {
      matched++;
      comparison.push({
        eventId: event.id,
        eventType: event.type,
        actualAction: event.type,
        proposedAction: matching.actionClass,
        match: true,
      });
    } else {
      divergent++;
      comparison.push({
        eventId: event.id,
        eventType: event.type,
        actualAction: event.type,
        match: false,
      });
    }
  }

  return {
    eventsReplayed: actualEvents.length,
    actionsProposed: proposedActions.length,
    actionsMatched: matched,
    actionsDivergent: divergent,
    comparison,
  };
}
