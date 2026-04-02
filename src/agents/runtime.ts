/**
 * Agent Runtime v2 — thin execution loop.
 *
 * context assembly → LLM call → tool routing through gateway → trace capture
 *
 * The intelligence is NOT in this loop — it's in the world model, the planner,
 * and the context assembly pipeline. This loop is an executor.
 */

import type pg from 'pg';
import { ulid } from 'ulid';
import { assembleAgentContext, type MemoryEntry } from './context-assembly/index.js';
import { submit as gatewaySubmit, type GatewayAction, type GatewayResult, type EvidenceBundle, type GatewayConfig } from '../gateway/gateway.js';
import { appendEvent } from '../ledger/event-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  id: string;
  tenantId: string;
  name: string;
  role: string;
  model: string;
  actionClasses: string[];
  domainInstructions?: string;
  playbook?: string;
}

export interface AgentTask {
  targetObjectId: string;
  targetObjectType?: string;
  actionClass: string;
  taskDescription: string;
  traceId: string;
}

export interface ExecutionResult {
  executionId: string;
  status: 'completed' | 'blocked' | 'escrowed' | 'failed';
  response?: string;
  actionsProposed: GatewayResult[];
  traceId: string;
}

export interface LLMProvider {
  chat(params: {
    model: string;
    messages: { role: string; content: string }[];
    tools?: ToolDefinition[];
  }): Promise<LLMResponse>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string | null;
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
  usage: { promptTokens: number; completionTokens: number };
}

// ---------------------------------------------------------------------------
// Tool → ActionClass mapping
// ---------------------------------------------------------------------------

const TOOL_ACTION_MAP: Record<string, string> = {
  'send_email': 'communicate.email',
  'gmail_send': 'communicate.email',
  'GMAIL_SEND_EMAIL': 'communicate.email',
  'send_message': 'communicate.chat',
  'slack_send': 'communicate.chat',
  'SLACK_SEND_MESSAGE': 'communicate.chat',
  'make_call': 'communicate.phone',
  'TWILIO_MAKE_CALL': 'communicate.phone',
  'create_event': 'schedule.create',
  'GOOGLECALENDAR_CREATE_EVENT': 'schedule.create',
  'read_document': 'document.read',
  'create_task': 'task.create',
  'web_search': 'data.read',
  'browse_webpage': 'data.read',
  'make_payment': 'financial.payment.initiate',
  'check_balance': 'financial.payment.read',
};

function toolToActionClass(toolName: string): string {
  return TOOL_ACTION_MAP[toolName] ?? `legacy.${toolName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
}

// ---------------------------------------------------------------------------
// Agent execution loop
// ---------------------------------------------------------------------------

/**
 * Execute a single agent task.
 *
 * 1. Assemble context from the world model
 * 2. Call the LLM with the context + tools
 * 3. Route each tool call through the action gateway
 * 4. Record the execution trace
 */
export async function executeAgentTask(
  pool: pg.Pool,
  agent: AgentConfig,
  task: AgentTask,
  llm: LLMProvider,
  tools: ToolDefinition[],
  gatewayConfig: GatewayConfig = {},
  memories: MemoryEntry[] = [],
): Promise<ExecutionResult> {
  const executionId = ulid();
  const actionsProposed: GatewayResult[] = [];
  let response: string | undefined;

  try {
    // Step 1: Assemble context from world model
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
        executionId,
        status: 'failed',
        response: `Target object not found: ${task.targetObjectId}`,
        actionsProposed: [],
        traceId: task.traceId,
      };
    }

    // Step 2: Call the LLM
    const messages = [
      { role: 'system', content: context.systemContent },
      { role: 'user', content: context.userContent },
    ];

    const llmResponse = await llm.chat({
      model: agent.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    response = llmResponse.content ?? undefined;

    // Step 3: Route each tool call through the action gateway
    for (const toolCall of llmResponse.toolCalls) {
      const actionClass = toolToActionClass(toolCall.name);

      const evidence: EvidenceBundle = {
        policyClauses: [`Agent ${agent.id} has authority for ${actionClass}`],
        factsReliedOn: [task.targetObjectId],
        toolsUsed: [toolCall.name],
        uncertaintyDeclared: 0.1, // Default — agents should declare this
        authorityChain: [agent.id],
      };

      const gatewayAction: GatewayAction = {
        tenantId: agent.tenantId,
        agentId: agent.id,
        executionId,
        traceId: task.traceId,
        actionClass,
        tool: toolCall.name,
        parameters: toolCall.arguments,
        targetObjectId: task.targetObjectId,
        targetObjectType: task.targetObjectType,
        evidence,
      };

      const gatewayResult = await gatewaySubmit(pool, gatewayAction, gatewayConfig);
      actionsProposed.push(gatewayResult);

      // If any action was denied or escrowed, note it
      if (gatewayResult.status === 'denied') {
        response = (response ?? '') + `\n[Action blocked: ${gatewayResult.reason}]`;
      } else if (gatewayResult.status === 'escrowed') {
        response = (response ?? '') + `\n[Action escrowed for approval: ${gatewayResult.reason}]`;
      }
    }

    // Step 4: Record execution trace event
    await appendEvent(pool, {
      tenantId: agent.tenantId,
      type: 'agent.action.executed',
      timestamp: new Date(),
      sourceType: 'agent',
      sourceId: agent.id,
      objectRefs: [{ objectId: task.targetObjectId, objectType: task.targetObjectType || 'unknown', role: 'target' }],
      payload: {
        executionId,
        agentName: agent.name,
        actionClass: task.actionClass,
        toolCalls: llmResponse.toolCalls.length,
        actionsApproved: actionsProposed.filter(a => a.executed).length,
        actionsDenied: actionsProposed.filter(a => a.status === 'denied').length,
        actionsEscrowed: actionsProposed.filter(a => a.status === 'escrowed').length,
        tokensUsed: llmResponse.usage.promptTokens + llmResponse.usage.completionTokens,
      },
      provenance: {
        sourceSystem: 'agent-runtime',
        sourceId: executionId,
        extractionMethod: 'api',
        extractionConfidence: 1.0,
      },
      traceId: task.traceId,
    });

    // Determine overall status
    const anyEscrowed = actionsProposed.some(a => a.status === 'escrowed');
    const anyDenied = actionsProposed.some(a => a.status === 'denied');
    const allExecuted = actionsProposed.every(a => a.executed);

    let status: ExecutionResult['status'] = 'completed';
    if (anyEscrowed) status = 'escrowed';
    else if (anyDenied && !allExecuted) status = 'blocked';

    return { executionId, status, response, actionsProposed, traceId: task.traceId };

  } catch (err: any) {
    // Record failure event
    try {
      await appendEvent(pool, {
        tenantId: agent.tenantId,
        type: 'agent.action.blocked',
        timestamp: new Date(),
        sourceType: 'system',
        sourceId: 'agent-runtime',
        objectRefs: [{ objectId: task.targetObjectId, objectType: task.targetObjectType || 'unknown', role: 'target' }],
        payload: { executionId, error: err.message, agentName: agent.name },
        provenance: { sourceSystem: 'agent-runtime', sourceId: executionId, extractionMethod: 'api', extractionConfidence: 1.0 },
        traceId: task.traceId,
      });
    } catch { /* best effort */ }

    return {
      executionId,
      status: 'failed',
      response: `Execution failed: ${err.message}`,
      actionsProposed,
      traceId: task.traceId,
    };
  }
}
