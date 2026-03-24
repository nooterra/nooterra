#!/usr/bin/env node

/**
 * Worker Daemon
 * 
 * Runs workers in the background based on their triggers.
 * Integrates with the trigger engine to schedule and execute workers.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

import { listWorkers, recordWorkerRun, loadWorker, saveWorker, WORKER_STATUS } from './worker-persistence.mjs';
import { TriggerEngine, TRIGGER_TYPES } from './trigger-engine.mjs';
import { getNotificationBus, EVENTS } from './notification-bus.mjs';
import { loadApiKey, loadProviderCredential, PROVIDERS } from './provider-auth.mjs';
import { getConnectionManager } from './mcp-integration.mjs';
import { ERROR_CODES, createError, NooteraError } from './error-handling.mjs';

const DAEMON_STATUS_FILE = path.join(os.homedir(), '.nooterra', 'daemon-status.json');
const DAEMON_PID_FILE = path.join(os.homedir(), '.nooterra', 'daemon.pid');
const RUN_HISTORY_DIR = path.join(os.homedir(), '.nooterra', 'runs');
const DEFAULT_INTERVAL_MS = 5000;
const MAX_TOOL_ROUNDS = 25; // Allow complex multi-step workflows

// ---------------------------------------------------------------------------
// Execution Engine
// ---------------------------------------------------------------------------

/**
 * Build a system prompt from a worker charter.
 * The prompt encodes purpose, canDo, askFirst, and neverDo rules so the LLM
 * knows exactly what it is and isn't allowed to do.
 */
function buildSystemPrompt(charter) {
  const lines = [];

  lines.push(`You are a Nooterra worker named "${charter.name}".`);
  lines.push(`Your purpose: ${charter.purpose}`);
  lines.push('');
  lines.push('You MUST obey the following charter rules at all times.');
  lines.push('');

  if (charter.canDo && charter.canDo.length > 0) {
    lines.push('## Actions you CAN take autonomously');
    for (const rule of charter.canDo) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (charter.askFirst && charter.askFirst.length > 0) {
    lines.push('## Actions that REQUIRE human approval (askFirst)');
    lines.push('If your response requires any of these actions, you MUST output a tool_call');
    lines.push('with name "__ask_first__" and an "action" argument describing what you want to do.');
    lines.push('Do NOT proceed with the action until the human approves.');
    for (const rule of charter.askFirst) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (charter.neverDo && charter.neverDo.length > 0) {
    lines.push('## Actions you must NEVER take (neverDo)');
    lines.push('If any request or tool output would lead you to perform one of these, REFUSE and explain why.');
    for (const rule of charter.neverDo) {
      lines.push(`- ${rule}`);
    }
    lines.push('');
  }

  if (charter.budget) {
    lines.push('## Budget');
    lines.push(`Limit: $${charter.budget.amount} ${charter.budget.currency} per ${charter.budget.period}.`);
    if (charter.budget.approvalThreshold < charter.budget.amount) {
      lines.push(`Any single spend above $${charter.budget.approvalThreshold} requires approval.`);
    }
    lines.push('');
  }

  lines.push('## Available capabilities');
  if (charter.capabilities && charter.capabilities.length > 0) {
    for (const cap of charter.capabilities) {
      lines.push(`- ${cap.name}${cap.summary ? ': ' + cap.summary : ''}`);
    }
  } else {
    lines.push('- None (text-only responses).');
  }
  lines.push('');

  lines.push('When using tools, call them by name and provide the required arguments as JSON.');
  lines.push('If you have nothing actionable to do, respond with a brief status message.');

  return lines.join('\n');
}

/**
 * Classify a tool call against charter rules.
 * Returns 'canDo' | 'askFirst' | 'neverDo' | 'unknown'.
 */
function classifyAction(toolName, toolArgs, charter) {
  const actionDesc = `${toolName} ${JSON.stringify(toolArgs)}`.toLowerCase();

  // Built-in read-only tools are always safe — no approval needed
  const SAFE_TOOLS = ['web_fetch', 'web_search', 'read_file', 'send_notification', '__save_memory'];
  if (SAFE_TOOLS.includes(toolName)) {
    return { verdict: 'canDo', rule: `built-in safe tool: ${toolName}` };
  }

  // Check neverDo first — strictest
  for (const rule of charter.neverDo || []) {
    const keywords = rule.toLowerCase().split(/\s+/);
    if (keywords.every(kw => actionDesc.includes(kw))) {
      return { verdict: 'neverDo', rule };
    }
  }

  // Check askFirst
  for (const rule of charter.askFirst || []) {
    const keywords = rule.toLowerCase().split(/\s+/);
    if (keywords.every(kw => actionDesc.includes(kw))) {
      return { verdict: 'askFirst', rule };
    }
  }

  // Check canDo
  for (const rule of charter.canDo || []) {
    const keywords = rule.toLowerCase().split(/\s+/);
    if (keywords.every(kw => actionDesc.includes(kw))) {
      return { verdict: 'canDo', rule };
    }
  }

  // Default: if the tool is in a connected capability, treat as canDo.
  // Otherwise require approval to be safe.
  const capIds = (charter.capabilities || []).map(c => c.id);
  const toolLower = toolName.toLowerCase();
  for (const capId of capIds) {
    if (toolLower.includes(capId)) {
      return { verdict: 'canDo', rule: `implicit capability: ${capId}` };
    }
  }

  return { verdict: 'askFirst', rule: 'no matching charter rule — defaulting to askFirst' };
}

/**
 * Call the OpenAI Chat Completions API.
 * Supports tool_calls in responses.
 */
async function callOpenAI(apiKey, model, messages, tools) {
  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 4096
  };
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} }
      }
    }));
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) throw createError(ERROR_CODES.PROVIDER_AUTH_FAILED, { body: text });
    if (response.status === 429) throw createError(ERROR_CODES.PROVIDER_RATE_LIMITED, { body: text });
    throw createError(ERROR_CODES.PROVIDER_UNAVAILABLE, { status: response.status, body: text });
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw createError(ERROR_CODES.PROVIDER_UNAVAILABLE, { message: 'Empty response from OpenAI' });

  return {
    content: choice.message?.content || '',
    toolCalls: (choice.message?.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function?.name,
      args: safeParse(tc.function?.arguments)
    })),
    finishReason: choice.finish_reason,
    usage: data.usage
  };
}

/**
 * Call the Anthropic Messages API.
 * Supports tool_use content blocks in responses.
 */
async function callAnthropic(apiKey, model, systemPrompt, messages, tools) {
  const body = {
    model,
    system: systemPrompt,
    messages,
    max_tokens: 4096,
    temperature: 0.2
  };
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.parameters || { type: 'object', properties: {} }
    }));
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) throw createError(ERROR_CODES.PROVIDER_AUTH_FAILED, { body: text });
    if (response.status === 429) throw createError(ERROR_CODES.PROVIDER_RATE_LIMITED, { body: text });
    throw createError(ERROR_CODES.PROVIDER_UNAVAILABLE, { status: response.status, body: text });
  }

  const data = await response.json();

  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  const toolBlocks = (data.content || []).filter(b => b.type === 'tool_use');

  return {
    content: textBlocks.map(b => b.text).join('\n'),
    toolCalls: toolBlocks.map(b => ({
      id: b.id,
      name: b.name,
      args: b.input || {}
    })),
    finishReason: data.stop_reason,
    usage: data.usage
  };
}

/**
 * Unified provider call — delegates to OpenAI or Anthropic.
 */
async function callProvider(provider, apiKey, model, systemPrompt, messages, tools) {
  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, systemPrompt, messages, tools);
  }
  if (provider === 'chatgpt') {
    // ChatGPT subscription uses the Codex responses API
    const providerDef = PROVIDERS.chatgpt;
    const baseUrl = providerDef.apiBase || 'https://chatgpt.com/backend-api';
    return callChatGPTCodex(apiKey, model, systemPrompt, messages, tools, baseUrl);
  }
  // Default to OpenAI-compatible API (covers openai, openrouter, groq)
  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  return callOpenAI(apiKey, model, fullMessages, tools);
}

async function callChatGPTCodex(accessToken, model, systemPrompt, messages, tools, baseUrl) {
  // Codex Responses API uses instructions + input (not messages), requires stream: true, store: false
  // Format: user/assistant messages as {role, content}, tool results as {type: 'function_call_output', call_id, output}
  // Assistant tool_calls become {type: 'function_call', name, arguments, call_id}
  const input = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      // Tool result → function_call_output
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output: m.content || ''
      });
    } else if (m.role === 'assistant' && m.tool_calls?.length > 0) {
      // Assistant with tool calls → emit function_call items
      if (m.content) {
        input.push({ role: 'assistant', content: m.content });
      }
      for (const tc of m.tool_calls) {
        input.push({
          type: 'function_call',
          name: tc.function?.name || tc.name,
          arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments || tc.args || {}),
          call_id: tc.id
        });
      }
    } else {
      // Regular user/assistant/system message
      input.push({ role: m.role, content: m.content || '' });
    }
  }
  const body = {
    model: model || 'gpt-5.3-codex',
    instructions: systemPrompt,
    input,
    stream: true,
    store: false
  };
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      name: t.name,
      description: t.description || '',
      parameters: t.parameters || { type: 'object', properties: {} }
    }));
  }

  const response = await fetch(`${baseUrl}/codex/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'codex_cli_rs'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) throw createError(ERROR_CODES.PROVIDER_AUTH_FAILED, { body: text });
    if (response.status === 429) throw createError(ERROR_CODES.PROVIDER_RATE_LIMITED, { body: text });
    throw createError(ERROR_CODES.PROVIDER_UNAVAILABLE, { status: response.status, body: text });
  }

  // Parse SSE stream
  const sseText = await response.text();
  const lines = sseText.split(/\r?\n/).filter(l => l.startsWith('data: '));
  let content = '';
  let toolCalls = [];
  let usage = null;
  let finishReason = 'stop';

  for (const line of lines) {
    const json = line.slice(6);
    if (json === '[DONE]') break;
    try {
      const event = JSON.parse(json);
      if (event.type === 'response.output_text.delta') {
        content += event.delta || '';
      }
      if (event.type === 'response.function_call_arguments.delta') {
        // Accumulate tool call args
        const lastTc = toolCalls[toolCalls.length - 1];
        if (lastTc) lastTc._rawArgs = (lastTc._rawArgs || '') + (event.delta || '');
      }
      if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        toolCalls.push({
          id: event.item.call_id || event.item.id || ('call_' + toolCalls.length),
          name: event.item.name,
          _rawArgs: ''
        });
      }
      if (event.type === 'response.completed') {
        usage = event.response?.usage || null;
        finishReason = event.response?.status || 'stop';
        // Also extract from final response output
        const output = event.response?.output || [];
        for (const o of output) {
          if (o.type === 'function_call' && o.name) {
            const existing = toolCalls.find(tc => tc.id === (o.call_id || o.id));
            if (existing) {
              existing.args = safeParse(o.arguments || existing._rawArgs || '{}');
            } else {
              toolCalls.push({
                id: o.call_id || o.id || ('call_' + toolCalls.length),
                name: o.name,
                args: safeParse(o.arguments || '{}')
              });
            }
          }
        }
      }
    } catch {}
  }

  // Parse any accumulated raw args
  for (const tc of toolCalls) {
    if (!tc.args && tc._rawArgs) tc.args = safeParse(tc._rawArgs);
    delete tc._rawArgs;
  }

  return { content, toolCalls, finishReason, usage };
}

/**
 * Safe JSON parse — returns raw string if parse fails.
 */
function safeParse(str) {
  if (typeof str !== 'string') return str || {};
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}

/**
 * Build a list of tool definitions for this worker.
 *
 * Priority: built-in tools first (always work), then MCP tools (if connected).
 * Built-in tools use direct HTTP calls — no MCP server needed.
 */
async function buildToolDefs(mcpManager, charter) {
  const tools = [];

  // 1. Load built-in tools first — these ALWAYS work
  try {
    const { getAvailableTools } = await import('./built-in-tools.mjs');
    const builtInTools = getAvailableTools(charter.capabilities);
    for (const t of builtInTools) {
      tools.push({
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} },
        _builtIn: true  // Marks this for direct execution (no MCP)
      });
    }
    if (builtInTools.length > 0) {
      console.log(`[exec] Loaded ${builtInTools.length} built-in tools: ${builtInTools.map(t => t.name).join(', ')}`);
    }
  } catch (err) {
    console.log(`[exec] Could not load built-in tools: ${err.message}`);
  }

  // 2. Try MCP tools (optional enhancement on top of built-ins)
  if (mcpManager) {
    const capIds = (charter.capabilities || []).map(c => typeof c === 'string' ? c : c.id).filter(Boolean);

    for (const capId of capIds) {
      try {
        const status = mcpManager.getStatus(capId);
        if (!status || !status.connected) continue;

        const result = await mcpManager.listTools(capId);
        const serverTools = result?.tools || result || [];
        for (const t of serverTools) {
          // Don't add MCP tool if we already have a built-in with the same name
          if (tools.find(existing => existing.name === t.name)) continue;
          tools.push({
            name: t.name,
            description: t.description || `Tool from ${capId}`,
            parameters: t.inputSchema || t.parameters || { type: 'object', properties: {} },
            _serverId: capId
          });
        }
      } catch (err) {
        // MCP not connected — that's fine, we have built-in tools
      }
    }
  }

  return tools;
}

/**
 * Save a receipt (structured run log) to disk.
 */
function saveReceipt(receipt) {
  if (!fs.existsSync(RUN_HISTORY_DIR)) {
    fs.mkdirSync(RUN_HISTORY_DIR, { recursive: true });
  }
  const filename = `${receipt.taskId}.json`;
  fs.writeFileSync(path.join(RUN_HISTORY_DIR, filename), JSON.stringify(receipt, null, 2));
}

/**
 * Execute a worker's task against its charter and AI provider.
 *
 * This is the core execution loop:
 *  1. Load charter and credentials
 *  2. Build system prompt from charter
 *  3. Discover MCP tools
 *  4. Call AI provider in a loop (handling tool calls)
 *  5. Enforce canDo / askFirst / neverDo on every tool call
 *  6. Generate and persist a receipt
 *  7. Return a result object for recordWorkerRun
 */
async function runWorkerExecution(worker, mcpManager, notificationBus, apiKey) {
  const charter = worker.charter;
  const provider = worker.provider || 'openai';
  const providerDef = PROVIDERS[provider] || PROVIDERS.openai;
  const model = worker.model || providerDef.defaultModel;
  const taskId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const startTime = Date.now();

  // Load worker memory — context from previous runs
  let memory = {};
  try {
    const { WorkerMemory } = await import('./worker-memory.mjs');
    const mem = new WorkerMemory(worker.id);
    memory = mem.getAll ? mem.getAll() : (mem.memory || {});
  } catch {}

  // Build system prompt with memory context
  let systemPrompt = buildSystemPrompt(charter);

  // Inject memory into system prompt if worker has prior context
  const memoryKeys = Object.keys(memory);
  if (memoryKeys.length > 0) {
    const memoryContext = memoryKeys.map(k => `- ${k}: ${JSON.stringify(memory[k])}`).join('\n');
    systemPrompt += `\n\nYou have memory from previous runs:\n${memoryContext}\n\nUse this context to inform your work. Update your memory by noting important findings in your response.`;
  }

  // Discover tools from MCP servers
  const availableTools = await buildToolDefs(mcpManager, charter);

  // Add memory tools so the AI can save/retrieve context
  availableTools.push({
    name: '__save_memory',
    description: 'Save a key-value pair to persistent memory for future runs. Use this to remember important findings, state, or context.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key (e.g., "last_checked_email_id", "competitor_prices")' },
        value: { type: 'string', description: 'Value to remember' }
      },
      required: ['key', 'value']
    }
  });

  // Conversation messages (start with the task trigger)
  const messages = [
    {
      role: 'user',
      content: `Execute your purpose: ${charter.purpose}\n\nPerform your scheduled task now. Use your available tools if needed. Save important findings to memory with __save_memory so you remember them next time.`
    }
  ];

  const executionLog = [];
  let finalContent = '';
  let totalToolCalls = 0;
  let blockedActions = [];
  let approvalsPending = [];

  // Agentic loop — keep going while the AI wants to use tools
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const aiResponse = await callProvider(provider, apiKey, model, systemPrompt, messages, availableTools);
    finalContent = aiResponse.content;

    executionLog.push({
      round,
      content: aiResponse.content,
      toolCalls: aiResponse.toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
      finishReason: aiResponse.finishReason,
      usage: aiResponse.usage
    });

    // If no tool calls, we're done
    if (!aiResponse.toolCalls || aiResponse.toolCalls.length === 0) {
      break;
    }

    // Process each tool call
    const toolResults = [];
    let needsApproval = false;

    for (const tc of aiResponse.toolCalls) {
      totalToolCalls++;

      // Handle memory save (internal tool, always allowed)
      if (tc.name === '__save_memory') {
        try {
          const { WorkerMemory } = await import('./worker-memory.mjs');
          const mem = new WorkerMemory(worker.id);
          const key = tc.args?.key || 'default';
          const value = tc.args?.value || '';
          if (mem.set) mem.set(key, value);
          else mem.memory[key] = value;
          if (mem.save) mem.save();
          toolResults.push({ id: tc.id, name: tc.name, result: `Saved to memory: ${key}` });
          console.log(`[exec] Memory saved: ${key}`);
        } catch (memErr) {
          toolResults.push({ id: tc.id, name: tc.name, result: `Memory save failed: ${memErr.message}` });
        }
        continue;
      }

      // Classify against charter
      const classification = classifyAction(tc.name, tc.args, charter);

      if (classification.verdict === 'neverDo') {
        // BLOCKED — log and return error to AI
        const blockMsg = `BLOCKED: Action "${tc.name}" violates charter neverDo rule: "${classification.rule}". This action was NOT executed.`;
        console.log(`[exec] ${blockMsg}`);
        blockedActions.push({ tool: tc.name, args: tc.args, rule: classification.rule });
        toolResults.push({ id: tc.id, name: tc.name, result: blockMsg, blocked: true });
        continue;
      }

      if (classification.verdict === 'askFirst' || tc.name === '__ask_first__') {
        // PAUSE — send approval notification
        const action = tc.name === '__ask_first__'
          ? (tc.args?.action || JSON.stringify(tc.args))
          : `${tc.name}(${JSON.stringify(tc.args)})`;

        console.log(`[exec] Approval required for: ${action}`);
        approvalsPending.push({ tool: tc.name, args: tc.args, rule: classification.rule });

        await notificationBus.notify(EVENTS.APPROVAL_NEEDED, {
          workerId: worker.id,
          workerName: charter.name,
          action,
          taskId
        });

        const pauseMsg = `PAUSED: Action "${tc.name}" requires human approval (askFirst rule: "${classification.rule}"). A notification has been sent. The action was NOT executed.`;
        toolResults.push({ id: tc.id, name: tc.name, result: pauseMsg, paused: true });
        needsApproval = true;
        continue;
      }

      // canDo — execute the tool
      const toolDef = availableTools.find(t => t.name === tc.name);

      if (toolDef && toolDef._builtIn) {
        // BUILT-IN TOOL — execute directly, no MCP needed
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              await new Promise(r => setTimeout(r, delay));
              console.log(`[exec] Retrying ${tc.name} (attempt ${attempt + 1})...`);
            }
            const { executeTool } = await import('./built-in-tools.mjs');
            const result = await executeTool(tc.name, tc.args || {});
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            // Truncate very long results to avoid blowing up context
            const truncated = resultStr.length > 8000 ? resultStr.slice(0, 8000) + '\n\n[... truncated, showing first 8000 chars]' : resultStr;
            toolResults.push({ id: tc.id, name: tc.name, result: truncated });
            console.log(`[exec] Built-in tool ${tc.name} executed (${resultStr.length} chars)`);
            lastErr = null;
            break;
          } catch (toolErr) {
            lastErr = toolErr;
            if (toolErr.message?.includes('not allowed') || toolErr.message?.includes('blocked')) break;
          }
        }
        if (lastErr) {
          const errMsg = `Tool "${tc.name}" failed: ${lastErr.message}. Try a different approach.`;
          toolResults.push({ id: tc.id, name: tc.name, result: errMsg, error: true });
          console.error(`[exec] Built-in tool ${tc.name} failed: ${lastErr.message}`);
        }
      } else if (toolDef && toolDef._serverId) {
        // MCP TOOL — execute via MCP server
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              await new Promise(r => setTimeout(r, delay));
              console.log(`[exec] Retrying ${tc.name} (attempt ${attempt + 1})...`);
            }
            const mcpResult = await mcpManager.callTool(toolDef._serverId, tc.name, tc.args);
            const resultStr = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult);
            toolResults.push({ id: tc.id, name: tc.name, result: resultStr });
            console.log(`[exec] Tool ${tc.name} executed via MCP server ${toolDef._serverId}`);
            lastErr = null;
            break;
          } catch (mcpErr) {
            lastErr = mcpErr;
            if (mcpErr.message?.includes('not found') || mcpErr.message?.includes('auth')) break;
          }
        }
        if (lastErr) {
          const errMsg = `Tool "${tc.name}" failed after retries: ${lastErr.message}. Try a different approach.`;
          toolResults.push({ id: tc.id, name: tc.name, result: errMsg, error: true });
          console.error(`[exec] MCP tool ${tc.name} failed: ${lastErr.message}`);
        }
      } else {
        // Unknown tool — tell the AI what's available
        const available = availableTools.map(t => t.name).join(', ');
        const noToolMsg = `Tool "${tc.name}" not found. Available tools: ${available || 'none'}. Use one of these instead.`;
        toolResults.push({ id: tc.id, name: tc.name, result: noToolMsg, unavailable: true });
      }
    }

    // Feed tool results back into the conversation
    if (provider === 'anthropic') {
      // Anthropic expects assistant message with tool_use blocks, then user message with tool_result blocks
      messages.push({
        role: 'assistant',
        content: [
          ...(aiResponse.content ? [{ type: 'text', text: aiResponse.content }] : []),
          ...aiResponse.toolCalls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.args
          }))
        ]
      });
      messages.push({
        role: 'user',
        content: toolResults.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.id,
          content: tr.result
        }))
      });
    } else {
      // OpenAI / Codex format
      // IMPORTANT: content must be a string (not null) for Codex Responses API
      const assistantMsg = {
        role: 'assistant',
        content: aiResponse.content || '',
        tool_calls: aiResponse.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) }
        }))
      };
      messages.push(assistantMsg);
      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.id,
          content: tr.result || ''
        });
      }
    }

    // If approval is pending, stop the loop — don't keep calling the AI
    if (needsApproval) {
      finalContent += '\n[Execution paused — waiting for human approval on one or more actions.]';
      break;
    }
  }

  const duration = Date.now() - startTime;

  // Build receipt
  const receipt = {
    schemaVersion: 'WorkerRunReceipt.v1',
    taskId,
    workerId: worker.id,
    workerName: charter.name,
    provider,
    model,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    duration,
    success: blockedActions.length === 0 && approvalsPending.length === 0,
    response: finalContent,
    toolCallCount: totalToolCalls,
    blockedActions,
    approvalsPending,
    executionLog
  };

  // Persist receipt
  saveReceipt(receipt);

  return {
    taskId,
    success: receipt.success,
    duration,
    response: finalContent,
    receipt
  };
}

/**
 * Worker Daemon class
 */
export class WorkerDaemon extends EventEmitter {
  constructor(options = {}) {
    super();
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    this.triggerEngine = new TriggerEngine();
    this.notificationBus = getNotificationBus();
    this.mcpManager = getConnectionManager();
    this.running = false;
    this.workers = new Map(); // worker id -> worker state
    this.executionQueue = [];
    this.timer = null;
  }

  /**
   * Start the daemon
   */
  async start() {
    if (this.running) {
      throw createError(ERROR_CODES.WORKER_ALREADY_RUNNING, { message: 'Daemon already running' });
    }

    this.running = true;
    this.startedAt = new Date();
    
    // Write PID file
    await this.writePidFile();
    
    // Load all workers
    await this.loadWorkers();
    
    // Set up triggers for scheduled workers
    await this.setupTriggers();
    
    // Start trigger engine
    await this.triggerEngine.start();
    
    // Start main loop
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    
    // Write status
    await this.writeStatus('running');
    
    this.emit('started');
    console.log(`[daemon] Started with ${this.workers.size} workers`);
  }

  /**
   * Stop the daemon
   */
  async stop() {
    if (!this.running) return;
    
    this.running = false;
    
    // Stop timer
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    // Stop trigger engine
    await this.triggerEngine.stop();
    
    // Disconnect MCP servers
    this.mcpManager.disconnectAll();
    
    // Write status
    await this.writeStatus('stopped');
    
    // Remove PID file
    await this.removePidFile();
    
    this.emit('stopped');
    console.log('[daemon] Stopped');
  }

  /**
   * Load all workers
   */
  async loadWorkers() {
    const workers = listWorkers({ status: WORKER_STATUS.READY });
    
    for (const worker of workers) {
      this.workers.set(worker.id, {
        worker,
        lastRun: null,
        nextRun: null,
        running: false,
        errors: []
      });
    }
    
    console.log(`[daemon] Loaded ${workers.length} workers`);
  }

  /**
   * Set up triggers for all workers
   */
  async setupTriggers() {
    for (const [workerId, state] of this.workers) {
      const worker = state.worker;
      
      for (const trigger of worker.triggers || []) {
        const triggerConfig =
          trigger?.config
          || (trigger?.type === TRIGGER_TYPES.SCHEDULE && trigger?.schedule
            ? { schedule: trigger.schedule }
            : {});
        const triggerId = await this.triggerEngine.addTrigger({
          type: trigger.type,
          workerId,
          config: triggerConfig,
          enabled: trigger.enabled !== false
        });
        
        console.log(`[daemon] Registered trigger ${triggerId} for worker ${worker.charter.name}`);
      }
    }

    this.triggerEngine.on('trigger:fired', ({ workerId }) => {
      this.queueExecution(workerId);
    });
  }

  /**
   * Queue a worker for execution
   */
  queueExecution(workerId) {
    const state = this.workers.get(workerId);
    if (!state) {
      console.error(`[daemon] Unknown worker: ${workerId}`);
      return;
    }
    
    if (state.running) {
      console.log(`[daemon] Worker ${workerId} already running, skipping`);
      return;
    }
    
    this.executionQueue.push({
      workerId,
      queuedAt: new Date()
    });
    
    console.log(`[daemon] Queued worker ${state.worker.charter.name}`);
  }

  /**
   * Main loop tick
   */
  async tick() {
    if (!this.running) return;
    
    // Process execution queue
    while (this.executionQueue.length > 0) {
      const item = this.executionQueue.shift();
      await this.executeWorker(item.workerId);
    }
    
    // Update status
    await this.writeStatus('running');
  }

  /**
   * Execute a worker
   */
  async executeWorker(workerId) {
    const state = this.workers.get(workerId);
    if (!state) return;
    
    state.running = true;
    const startTime = Date.now();
    
    console.log(`[daemon] Executing worker ${state.worker.charter.name}`);
    
    try {
      // Get provider credentials (handles both API keys and OAuth tokens)
      const provider = state.worker.provider || 'openai';
      const credentials = provider === 'local' ? 'local' : await loadProviderCredential(provider);

      if (!credentials) {
        throw createError(ERROR_CODES.PROVIDER_NOT_CONFIGURED, { provider });
      }

      // Connect MCP servers for this worker's capabilities
      const caps = (state.worker.charter?.capabilities || []).map(c => typeof c === 'string' ? c : (c.id || c));
      const { KNOWN_SERVERS } = await import('./mcp-integration.mjs');
      for (const capId of caps) {
        // Map capability names to known MCP server IDs
        const serverMap = {
          'browser': 'browser', 'web browser': 'browser', 'web search': 'fetch',
          'slack': 'slack', 'email': 'fetch', 'email (gmail/imap)': 'fetch',
          'github': 'github', 'google sheets': 'google-drive',
          'file system': 'filesystem', 'database': 'postgres',
          'sms': 'fetch', 'sms (twilio)': 'fetch', 'discord': 'fetch'
        };
        const serverId = serverMap[capId.toLowerCase()] || capId.toLowerCase();
        if (KNOWN_SERVERS[serverId]) {
          try {
            const status = this.mcpManager.getStatus(serverId);
            if (!status || !status.connected) {
              console.log(`[daemon] Connecting MCP server: ${serverId}`);
              await this.mcpManager.connect(serverId);
            }
          } catch (mcpErr) {
            console.log(`[daemon] MCP ${serverId} not available: ${mcpErr.message}`);
          }
        }
      }

      // Run the execution engine
      const result = await runWorkerExecution(
        state.worker,
        this.mcpManager,
        this.notificationBus,
        credentials
      );

      // Record the run
      recordWorkerRun(workerId, result);

      // Send notification
      await this.notificationBus.notify(EVENTS.TASK_COMPLETE, {
        workerId,
        workerName: state.worker.charter.name,
        taskId: result.taskId,
        duration: result.duration
      });
      
      state.lastRun = new Date();
      state.errors = [];
      
      console.log(`[daemon] Worker ${state.worker.charter.name} completed in ${result.duration}ms`);
      
    } catch (err) {
      const error = err instanceof NooteraError ? err : createError(ERROR_CODES.UNKNOWN_ERROR, { message: err.message });
      
      state.errors.push({
        timestamp: new Date().toISOString(),
        code: error.code,
        message: error.message
      });
      
      // Record failed run
      recordWorkerRun(workerId, {
        success: false,
        duration: Date.now() - startTime
      });
      
      // Send error notification
      await this.notificationBus.notify(EVENTS.ERROR, {
        workerId,
        workerName: state.worker.charter.name,
        error: error.message
      });
      
      console.error(`[daemon] Worker ${state.worker.charter.name} failed:`, error.message);
    } finally {
      state.running = false;
    }
  }

  /**
   * Write PID file
   */
  async writePidFile() {
    const dir = path.dirname(DAEMON_PID_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DAEMON_PID_FILE, String(process.pid));
  }

  /**
   * Remove PID file
   */
  async removePidFile() {
    if (fs.existsSync(DAEMON_PID_FILE)) {
      fs.unlinkSync(DAEMON_PID_FILE);
    }
  }

  /**
   * Write status file
   */
  async writeStatus(phase) {
    const status = {
      schemaVersion: 'WorkerDaemonStatus.v1',
      pid: process.pid,
      phase,
      startedAt: this.startedAt?.toISOString(),
      lastHeartbeat: new Date().toISOString(),
      workers: this.workers.size,
      runningWorkers: Array.from(this.workers.values()).filter(s => s.running).length,
      queuedExecutions: this.executionQueue.length,
      triggers: this.triggerEngine.getTriggerCount()
    };
    
    const dir = path.dirname(DAEMON_STATUS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DAEMON_STATUS_FILE, JSON.stringify(status, null, 2));
  }

  /**
   * Get daemon status
   */
  static getStatus() {
    if (!fs.existsSync(DAEMON_STATUS_FILE)) {
      return { running: false };
    }
    
    try {
      const status = JSON.parse(fs.readFileSync(DAEMON_STATUS_FILE, 'utf8'));
      
      // Check if process is actually running
      if (status.pid) {
        try {
          process.kill(status.pid, 0);
          status.running = true;
        } catch (e) {
          status.running = false;
        }
      }
      
      return status;
    } catch (e) {
      return { running: false, error: e.message };
    }
  }

  /**
   * Check if daemon is running
   */
  static isRunning() {
    const status = WorkerDaemon.getStatus();
    return status.running === true;
  }

  /**
   * Stop running daemon
   */
  static async stopRunning() {
    if (!fs.existsSync(DAEMON_PID_FILE)) {
      return { success: false, error: 'No PID file found' };
    }
    
    try {
      const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      return { success: true, pid };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

/**
 * Get singleton daemon instance
 */
let daemonInstance = null;

export function getDaemon() {
  if (!daemonInstance) {
    daemonInstance = new WorkerDaemon();
  }
  return daemonInstance;
}

/**
 * Start daemon
 */
export async function startDaemon(options = {}) {
  const daemon = getDaemon();
  await daemon.start();
  return daemon;
}

/**
 * Stop daemon
 */
export async function stopDaemon() {
  const daemon = getDaemon();
  await daemon.stop();
}

/**
 * Streaming execution wrapper.
 *
 * Drop-in enhancement alongside `runWorkerExecution`. Returns a streaming
 * executor with real-time token events, stall detection, circuit breaking,
 * heartbeats, cancellation, and detailed receipts.
 *
 * Usage:
 *   const executor = await executeWorkerStreaming(worker, mcpManager, notificationBus, apiKey);
 *   executor.on('execution:token', ({ token }) => process.stdout.write(token));
 *   const receipt = await executor.start();
 */
export async function executeWorkerStreaming(worker, mcpManager, notificationBus, apiKey) {
  const { createStreamingExecutor } = await import('./streaming-executor.mjs');
  return createStreamingExecutor(worker, {
    mcpManager,
    notificationBus,
    apiKey
  });
}

// Export execution internals for testing
export {
  buildSystemPrompt,
  classifyAction,
  callOpenAI,
  callAnthropic,
  callProvider,
  runWorkerExecution,
  buildToolDefs,
  saveReceipt
};

export default {
  WorkerDaemon,
  getDaemon,
  startDaemon,
  stopDaemon,
  buildSystemPrompt,
  classifyAction,
  runWorkerExecution,
  executeWorkerStreaming
};

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.includes('--status')) {
    console.log(JSON.stringify(WorkerDaemon.getStatus(), null, 2));
    process.exit(0);
  }
  
  if (args.includes('--stop')) {
    const result = await WorkerDaemon.stopRunning();
    console.log(result.success ? `Stopped daemon (PID ${result.pid})` : `Failed: ${result.error}`);
    process.exit(result.success ? 0 : 1);
  }
  
  // Start daemon
  console.log('[daemon] Starting worker daemon...');
  
  const daemon = await startDaemon();
  
  // Handle shutdown
  process.on('SIGTERM', async () => {
    console.log('[daemon] Received SIGTERM, shutting down...');
    await stopDaemon();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('[daemon] Received SIGINT, shutting down...');
    await stopDaemon();
    process.exit(0);
  });
}
