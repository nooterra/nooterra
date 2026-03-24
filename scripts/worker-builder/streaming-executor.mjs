/**
 * Streaming Execution Engine
 *
 * Wraps the existing daemon execution with real-time token streaming,
 * progress reporting, stall detection, circuit breaking, heartbeats,
 * cancellation support, and detailed execution receipts.
 *
 * Zero external dependencies — uses Node.js EventEmitter and fetch.
 */

import { EventEmitter } from 'events';
import { PROVIDERS, loadProviderCredential } from './provider-auth.mjs';
import { buildSystemPrompt, classifyAction, buildToolDefs, saveReceipt } from './worker-daemon.mjs';
import { ERROR_CODES, createError } from './error-handling.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALL_WARNING_MS = 15_000;
const STALL_RETRY_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const MAX_TOOL_ROUNDS = 25;
const REQUEST_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

class CircuitBreaker {
  constructor() {
    /** @type {Map<string, {failures: number, degradedAt: number|null}>} */
    this.providers = new Map();
  }

  record(provider, success) {
    let state = this.providers.get(provider);
    if (!state) {
      state = { failures: 0, degradedAt: null };
      this.providers.set(provider, state);
    }

    if (success) {
      state.failures = 0;
      state.degradedAt = null;
      return;
    }

    state.failures++;
    if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      state.degradedAt = Date.now();
    }
  }

  canCall(provider) {
    const state = this.providers.get(provider);
    if (!state || !state.degradedAt) return true;

    const elapsed = Date.now() - state.degradedAt;
    if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Cooldown expired — allow one probe
      state.degradedAt = null;
      state.failures = 0;
      return true;
    }

    return false;
  }

  getState(provider) {
    return this.providers.get(provider) || { failures: 0, degradedAt: null };
  }
}

// Shared across executor instances
const circuitBreaker = new CircuitBreaker();

// ---------------------------------------------------------------------------
// SSE line parser
// ---------------------------------------------------------------------------

/**
 * Parse an SSE text chunk into individual data payloads.
 * Handles partial lines across chunks by tracking a buffer.
 */
function createSSEParser() {
  let buffer = '';

  return {
    /**
     * Feed a text chunk in, get back an array of parsed JSON objects.
     * Non-JSON lines (e.g. `[DONE]`) are returned as `{ _raw: string }`.
     */
    feed(chunk) {
      buffer += chunk;
      const results = [];
      const lines = buffer.split(/\r?\n/);

      // Keep last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          results.push({ _done: true });
          continue;
        }
        try {
          results.push(JSON.parse(payload));
        } catch {
          results.push({ _raw: payload });
        }
      }
      return results;
    },

    /** Flush remaining buffer */
    flush() {
      if (!buffer.trim()) return [];
      const result = this.feed('\n');
      buffer = '';
      return result;
    }
  };
}

// ---------------------------------------------------------------------------
// Streaming provider calls
// ---------------------------------------------------------------------------

/**
 * Stream from OpenAI-compatible chat completions endpoint.
 * Yields events through the emitter as tokens arrive.
 */
async function streamOpenAI(apiKey, model, messages, tools, emitter, signal) {
  const body = {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 4096,
    stream: true
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
    signal
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) throw createError(ERROR_CODES.PROVIDER_AUTH_FAILED, { body: text });
    if (response.status === 429) throw createError(ERROR_CODES.PROVIDER_RATE_LIMITED, { body: text });
    throw createError(ERROR_CODES.PROVIDER_UNAVAILABLE, { status: response.status, body: text });
  }

  const parser = createSSEParser();
  let content = '';
  const toolCallsMap = new Map(); // index -> {id, name, args}
  let usage = null;
  let finishReason = 'stop';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = parser.feed(chunk);

      for (const evt of events) {
        if (evt._done) continue;
        if (evt._raw) continue;

        const delta = evt.choices?.[0]?.delta;
        if (!delta) continue;

        // Text token
        if (delta.content) {
          content += delta.content;
          emitter.emit('execution:token', { token: delta.content, accumulated: content });
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsMap.has(idx)) {
              toolCallsMap.set(idx, { id: tc.id || '', name: '', _rawArgs: '' });
            }
            const entry = toolCallsMap.get(idx);
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
            if (tc.function?.arguments) entry._rawArgs += tc.function.arguments;
          }
        }

        // Finish reason
        if (evt.choices?.[0]?.finish_reason) {
          finishReason = evt.choices[0].finish_reason;
        }

        // Usage (some providers send it in the last chunk)
        if (evt.usage) {
          usage = evt.usage;
        }
      }
    }

    // Flush remaining
    const remaining = parser.flush();
    for (const evt of remaining) {
      if (evt.usage) usage = evt.usage;
    }
  } finally {
    reader.releaseLock();
  }

  // Finalize tool calls
  const toolCalls = [];
  for (const [, entry] of [...toolCallsMap.entries()].sort((a, b) => a[0] - b[0])) {
    let args = {};
    if (entry._rawArgs) {
      try { args = JSON.parse(entry._rawArgs); } catch { args = { raw: entry._rawArgs }; }
    }
    toolCalls.push({ id: entry.id, name: entry.name, args });
  }

  return { content, toolCalls, finishReason, usage };
}

/**
 * Stream from Anthropic Messages API.
 */
async function streamAnthropic(apiKey, model, systemPrompt, messages, tools, emitter, signal) {
  const body = {
    model,
    system: systemPrompt,
    messages,
    max_tokens: 4096,
    temperature: 0.2,
    stream: true
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
    signal
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) throw createError(ERROR_CODES.PROVIDER_AUTH_FAILED, { body: text });
    if (response.status === 429) throw createError(ERROR_CODES.PROVIDER_RATE_LIMITED, { body: text });
    throw createError(ERROR_CODES.PROVIDER_UNAVAILABLE, { status: response.status, body: text });
  }

  const parser = createSSEParser();
  let content = '';
  const toolCalls = [];
  let currentToolCall = null;
  let usage = null;
  let finishReason = 'end_turn';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = parser.feed(chunk);

      for (const evt of events) {
        if (evt._done || evt._raw) continue;

        switch (evt.type) {
          case 'content_block_start': {
            const block = evt.content_block;
            if (block?.type === 'tool_use') {
              currentToolCall = { id: block.id, name: block.name, _rawInput: '' };
              emitter.emit('execution:thinking', { message: `Calling tool: ${block.name}` });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = evt.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              content += delta.text;
              emitter.emit('execution:token', { token: delta.text, accumulated: content });
            }
            if (delta?.type === 'input_json_delta' && delta.partial_json && currentToolCall) {
              currentToolCall._rawInput += delta.partial_json;
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolCall) {
              let args = {};
              if (currentToolCall._rawInput) {
                try { args = JSON.parse(currentToolCall._rawInput); } catch { args = { raw: currentToolCall._rawInput }; }
              }
              toolCalls.push({ id: currentToolCall.id, name: currentToolCall.name, args });
              currentToolCall = null;
            }
            break;
          }

          case 'message_delta': {
            if (evt.delta?.stop_reason) finishReason = evt.delta.stop_reason;
            if (evt.usage) usage = { ...usage, ...evt.usage };
            break;
          }

          case 'message_start': {
            if (evt.message?.usage) usage = evt.message.usage;
            break;
          }
        }
      }
    }

    parser.flush();
  } finally {
    reader.releaseLock();
  }

  return { content, toolCalls, finishReason, usage };
}

/**
 * Unified streaming provider call.
 */
async function streamProvider(provider, apiKey, model, systemPrompt, messages, tools, emitter, signal) {
  if (provider === 'anthropic') {
    return streamAnthropic(apiKey, model, systemPrompt, messages, tools, emitter, signal);
  }
  // OpenAI-compatible (openai, openrouter, groq, etc.)
  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  return streamOpenAI(apiKey, model, fullMessages, tools, emitter, signal);
}

// ---------------------------------------------------------------------------
// Timeline tracker
// ---------------------------------------------------------------------------

class ExecutionTimeline {
  constructor() {
    /** @type {Array<{phase: string, startedAt: string, completedAt: string|null, durationMs: number|null, metadata: object}>} */
    this.entries = [];
    this._active = null;
  }

  start(phase, metadata = {}) {
    const entry = {
      phase,
      startedAt: new Date().toISOString(),
      completedAt: null,
      durationMs: null,
      metadata
    };
    this.entries.push(entry);
    this._active = entry;
    return entry;
  }

  complete(metadata = {}) {
    if (!this._active) return;
    this._active.completedAt = new Date().toISOString();
    this._active.durationMs = new Date(this._active.completedAt).getTime() - new Date(this._active.startedAt).getTime();
    Object.assign(this._active.metadata, metadata);
    const completed = this._active;
    this._active = null;
    return completed;
  }

  toJSON() {
    return [...this.entries];
  }
}

// ---------------------------------------------------------------------------
// Streaming Executor
// ---------------------------------------------------------------------------

/**
 * Create a streaming executor for a worker.
 *
 * @param {object} worker  - Worker object with .charter, .provider, .model, .id
 * @param {object} options
 * @param {object} [options.mcpManager]       - MCP connection manager
 * @param {object} [options.notificationBus]  - Notification bus for approvals
 * @param {string} [options.apiKey]           - Pre-loaded API key / access token
 * @param {number} [options.stallWarningMs]   - Override stall warning threshold
 * @param {number} [options.stallRetryMs]     - Override stall retry threshold
 * @param {number} [options.maxToolRounds]    - Override max agentic loop rounds
 *
 * @returns {{ on, start, cancel, getTimeline, getReceipt }}
 */
export function createStreamingExecutor(worker, options = {}) {
  const emitter = new EventEmitter();
  const timeline = new ExecutionTimeline();

  const stallWarningMs = options.stallWarningMs ?? STALL_WARNING_MS;
  const stallRetryMs = options.stallRetryMs ?? STALL_RETRY_MS;
  const maxToolRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;

  let abortController = null;
  let heartbeatTimer = null;
  let stallTimer = null;
  let receipt = null;
  let running = false;
  let currentPhase = 'idle';

  // -- Internal helpers ----------------------------------------------------

  function setPhase(phase) {
    currentPhase = phase;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (!running) return;
      emitter.emit('execution:heartbeat', {
        phase: currentPhase,
        timestamp: new Date().toISOString(),
        timeline: timeline.toJSON()
      });
    }, HEARTBEAT_INTERVAL_MS);
    // Don't block process exit
    if (heartbeatTimer.unref) heartbeatTimer.unref();
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function resetStallDetection() {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  /**
   * Set up stall detection. Returns a promise that rejects if a hard stall
   * is detected (triggering a retry in the caller).
   */
  function armStallDetection() {
    resetStallDetection();

    let warnFired = false;

    return {
      /** Call whenever a token / event arrives to reset the clock */
      poke() {
        warnFired = false;
        if (stallTimer) clearTimeout(stallTimer);

        stallTimer = setTimeout(() => {
          if (!running) return;
          warnFired = true;
          emitter.emit('execution:stall_detected', {
            severity: 'warning',
            elapsedMs: stallWarningMs,
            message: `No tokens received for ${stallWarningMs / 1000}s`
          });

          // Arm the hard-stall timeout
          stallTimer = setTimeout(() => {
            if (!running) return;
            emitter.emit('execution:stall_detected', {
              severity: 'retry',
              elapsedMs: stallRetryMs,
              message: `No tokens received for ${stallRetryMs / 1000}s — triggering retry`
            });
          }, stallRetryMs - stallWarningMs);
          if (stallTimer.unref) stallTimer.unref();
        }, stallWarningMs);
        if (stallTimer.unref) stallTimer.unref();
      },

      clear() {
        resetStallDetection();
      }
    };
  }

  function safeParse(str) {
    if (typeof str !== 'string') return str || {};
    try { return JSON.parse(str); } catch { return { raw: str }; }
  }

  // -- Main execution logic ------------------------------------------------

  async function execute(task) {
    const charter = worker.charter;
    const provider = worker.provider || 'openai';
    const providerDef = PROVIDERS[provider] || PROVIDERS.openai;
    const model = worker.model || providerDef?.defaultModel || 'gpt-4o';
    const executionId = `srun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();

    running = true;
    abortController = new AbortController();

    const toolCallLog = [];
    let totalTokensUsed = { prompt: 0, completion: 0 };
    let totalRounds = 0;
    let finalContent = '';
    let executionError = null;

    try {
      // Check circuit breaker
      if (!circuitBreaker.canCall(provider)) {
        const state = circuitBreaker.getState(provider);
        const remainingMs = CIRCUIT_BREAKER_COOLDOWN_MS - (Date.now() - (state.degradedAt || 0));
        throw createError(ERROR_CODES.PROVIDER_UNAVAILABLE, {
          message: `Provider "${provider}" is degraded after ${CIRCUIT_BREAKER_THRESHOLD} consecutive failures. Retry in ${Math.ceil(remainingMs / 1000)}s.`
        });
      }

      emitter.emit('execution:start', {
        id: executionId,
        workerId: worker.id,
        workerName: charter.name,
        provider,
        model,
        task: task || charter.purpose,
        timestamp: new Date().toISOString()
      });

      startHeartbeat();

      // Phase: build prompt
      timeline.start('build_prompt');
      setPhase('build_prompt');

      let systemPrompt = buildSystemPrompt(charter);

      // Load worker memory
      let memory = {};
      try {
        const { WorkerMemory } = await import('./worker-memory.mjs');
        const mem = new WorkerMemory(worker.id);
        memory = mem.getAll ? mem.getAll() : (mem.memory || {});
      } catch { /* no memory module — fine */ }

      const memoryKeys = Object.keys(memory);
      if (memoryKeys.length > 0) {
        const memoryContext = memoryKeys.map(k => `- ${k}: ${JSON.stringify(memory[k])}`).join('\n');
        systemPrompt += `\n\nYou have memory from previous runs:\n${memoryContext}\n\nUse this context to inform your work.`;
      }

      timeline.complete({ memoryKeys: memoryKeys.length });

      // Phase: discover tools
      timeline.start('discover_tools');
      setPhase('discover_tools');

      const mcpManager = options.mcpManager || null;
      const availableTools = await buildToolDefs(mcpManager, charter);

      // Add memory tool
      availableTools.push({
        name: '__save_memory',
        description: 'Save a key-value pair to persistent memory for future runs.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key' },
            value: { type: 'string', description: 'Value to remember' }
          },
          required: ['key', 'value']
        }
      });

      timeline.complete({ toolCount: availableTools.length });

      // Build initial messages
      const taskPrompt = task || `Execute your purpose: ${charter.purpose}\n\nPerform your scheduled task now.`;
      const messages = [{ role: 'user', content: taskPrompt }];

      // Agentic loop
      for (let round = 0; round < maxToolRounds; round++) {
        if (abortController.signal.aborted) {
          throw new Error('Execution cancelled');
        }

        totalRounds = round + 1;
        timeline.start(`round_${round}`, { type: 'provider_call' });
        setPhase(`round_${round}_streaming`);

        emitter.emit('execution:thinking', {
          round,
          message: round === 0 ? 'Thinking...' : `Round ${round + 1} — processing tool results...`
        });

        const stall = armStallDetection();

        // Listen for tokens to poke stall detector
        const tokenPoke = () => stall.poke();
        emitter.on('execution:token', tokenPoke);
        stall.poke(); // arm initial timeout

        let aiResponse;
        let providerCallSuccess = false;

        try {
          aiResponse = await streamProvider(
            provider, options.apiKey, model, systemPrompt,
            messages, availableTools, emitter, abortController.signal
          );
          providerCallSuccess = true;
          circuitBreaker.record(provider, true);
        } catch (providerErr) {
          circuitBreaker.record(provider, false);
          throw providerErr;
        } finally {
          emitter.removeListener('execution:token', tokenPoke);
          stall.clear();
        }

        finalContent = aiResponse.content;

        // Accumulate usage
        if (aiResponse.usage) {
          totalTokensUsed.prompt += aiResponse.usage.input_tokens || aiResponse.usage.prompt_tokens || 0;
          totalTokensUsed.completion += aiResponse.usage.output_tokens || aiResponse.usage.completion_tokens || 0;
        }

        timeline.complete({
          contentLength: aiResponse.content?.length || 0,
          toolCalls: aiResponse.toolCalls?.length || 0,
          finishReason: aiResponse.finishReason
        });

        // No tool calls => done
        if (!aiResponse.toolCalls || aiResponse.toolCalls.length === 0) {
          break;
        }

        // Process tool calls
        const toolResults = [];
        let needsApproval = false;

        for (const tc of aiResponse.toolCalls) {
          if (abortController.signal.aborted) break;

          const tcStart = Date.now();

          emitter.emit('execution:tool_call', {
            round,
            name: tc.name,
            args: tc.args,
            id: tc.id
          });

          timeline.start(`tool_${tc.name}_r${round}`, { toolName: tc.name });

          // Handle memory save
          if (tc.name === '__save_memory') {
            try {
              const { WorkerMemory } = await import('./worker-memory.mjs');
              const mem = new WorkerMemory(worker.id);
              const key = tc.args?.key || 'default';
              const val = tc.args?.value || '';
              if (mem.set) mem.set(key, val);
              else mem.memory[key] = val;
              if (mem.save) mem.save();
              const result = `Saved to memory: ${key}`;
              toolResults.push({ id: tc.id, name: tc.name, result });
              toolCallLog.push({ name: tc.name, args: tc.args, result, durationMs: Date.now() - tcStart });
              emitter.emit('execution:tool_result', { round, name: tc.name, result, durationMs: Date.now() - tcStart });
            } catch (err) {
              const result = `Memory save failed: ${err.message}`;
              toolResults.push({ id: tc.id, name: tc.name, result });
              toolCallLog.push({ name: tc.name, args: tc.args, result, durationMs: Date.now() - tcStart, error: true });
              emitter.emit('execution:tool_result', { round, name: tc.name, result, error: true, durationMs: Date.now() - tcStart });
            }
            timeline.complete();
            continue;
          }

          // Charter classification
          const classification = classifyAction(tc.name, tc.args, charter);

          if (classification.verdict === 'neverDo') {
            const result = `BLOCKED: Action "${tc.name}" violates charter neverDo rule: "${classification.rule}". NOT executed.`;
            toolResults.push({ id: tc.id, name: tc.name, result, blocked: true });
            toolCallLog.push({ name: tc.name, args: tc.args, result, durationMs: Date.now() - tcStart, blocked: true });
            emitter.emit('execution:tool_result', { round, name: tc.name, result, blocked: true, durationMs: Date.now() - tcStart });
            timeline.complete({ blocked: true });
            continue;
          }

          if (classification.verdict === 'askFirst' || tc.name === '__ask_first__') {
            const action = tc.name === '__ask_first__'
              ? (tc.args?.action || JSON.stringify(tc.args))
              : `${tc.name}(${JSON.stringify(tc.args)})`;

            const notificationBus = options.notificationBus;
            if (notificationBus) {
              try {
                await notificationBus.notify('approval_needed', {
                  workerId: worker.id,
                  workerName: charter.name,
                  action,
                  taskId: executionId
                });
              } catch { /* notification failure is non-fatal */ }
            }

            const result = `PAUSED: "${tc.name}" requires approval (rule: "${classification.rule}"). NOT executed.`;
            toolResults.push({ id: tc.id, name: tc.name, result, paused: true });
            toolCallLog.push({ name: tc.name, args: tc.args, result, durationMs: Date.now() - tcStart, paused: true });
            emitter.emit('execution:tool_result', { round, name: tc.name, result, paused: true, durationMs: Date.now() - tcStart });
            needsApproval = true;
            timeline.complete({ paused: true });
            continue;
          }

          // Execute via MCP
          const toolDef = availableTools.find(t => t.name === tc.name);
          if (toolDef && toolDef._serverId && mcpManager) {
            let lastErr = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                if (attempt > 0) {
                  await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 5000)));
                }
                const mcpResult = await mcpManager.callTool(toolDef._serverId, tc.name, tc.args);
                const resultStr = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult);
                toolResults.push({ id: tc.id, name: tc.name, result: resultStr });
                toolCallLog.push({ name: tc.name, args: tc.args, result: resultStr, durationMs: Date.now() - tcStart });
                emitter.emit('execution:tool_result', { round, name: tc.name, result: resultStr, durationMs: Date.now() - tcStart });
                lastErr = null;
                break;
              } catch (err) {
                lastErr = err;
                if (err.message?.includes('not found') || err.message?.includes('auth')) break;
              }
            }
            if (lastErr) {
              const result = `Tool "${tc.name}" failed: ${lastErr.message}`;
              toolResults.push({ id: tc.id, name: tc.name, result, error: true });
              toolCallLog.push({ name: tc.name, args: tc.args, result, durationMs: Date.now() - tcStart, error: true });
              emitter.emit('execution:tool_result', { round, name: tc.name, result, error: true, durationMs: Date.now() - tcStart });
            }
          } else {
            const result = `Tool "${tc.name}" is not connected. Available: ${availableTools.filter(t => t._serverId).map(t => t.name).join(', ') || 'none'}.`;
            toolResults.push({ id: tc.id, name: tc.name, result, unavailable: true });
            toolCallLog.push({ name: tc.name, args: tc.args, result, durationMs: Date.now() - tcStart, unavailable: true });
            emitter.emit('execution:tool_result', { round, name: tc.name, result, unavailable: true, durationMs: Date.now() - tcStart });
          }

          timeline.complete();
        }

        // Feed tool results back into conversation
        if (provider === 'anthropic') {
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
          messages.push({
            role: 'assistant',
            content: aiResponse.content || null,
            tool_calls: aiResponse.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args) }
            }))
          });
          for (const tr of toolResults) {
            messages.push({
              role: 'tool',
              tool_call_id: tr.id,
              content: tr.result
            });
          }
        }

        if (needsApproval) {
          finalContent += '\n[Execution paused — waiting for human approval.]';
          break;
        }
      }

    } catch (err) {
      executionError = err;
      emitter.emit('execution:error', {
        id: executionId,
        error: err.message,
        code: err.code || 'UNKNOWN',
        timestamp: new Date().toISOString()
      });
    } finally {
      running = false;
      stopHeartbeat();
      resetStallDetection();
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startTime;

    // Cost estimate (rough: $0.01/1K input, $0.03/1K output for GPT-4 class)
    const estimatedCost =
      (totalTokensUsed.prompt / 1000) * 0.01 +
      (totalTokensUsed.completion / 1000) * 0.03;

    // Build receipt
    receipt = {
      schemaVersion: 'StreamingExecutionReceipt.v1',
      id: executionId,
      workerId: worker.id,
      workerName: charter.name,
      provider,
      model: model,
      startedAt: new Date(startTime).toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      rounds: totalRounds,
      toolCalls: toolCallLog,
      tokensUsed: {
        prompt: totalTokensUsed.prompt,
        completion: totalTokensUsed.completion,
        total: totalTokensUsed.prompt + totalTokensUsed.completion
      },
      costEstimate: {
        currency: 'USD',
        amount: Math.round(estimatedCost * 10000) / 10000
      },
      timeline: timeline.toJSON(),
      success: !executionError,
      error: executionError ? executionError.message : null,
      response: finalContent
    };

    // Persist receipt
    try {
      saveReceipt({
        ...receipt,
        taskId: executionId
      });
    } catch { /* non-fatal */ }

    emitter.emit('execution:complete', {
      id: executionId,
      success: receipt.success,
      durationMs,
      rounds: totalRounds,
      toolCalls: toolCallLog.length,
      tokensUsed: receipt.tokensUsed,
      costEstimate: receipt.costEstimate,
      response: finalContent
    });

    return receipt;
  }

  // -- Public API ----------------------------------------------------------

  return {
    /**
     * Register an event listener.
     * Events: execution:start, execution:thinking, execution:tool_call,
     *         execution:tool_result, execution:token, execution:complete,
     *         execution:error, execution:stall_detected, execution:heartbeat
     */
    on(event, handler) {
      emitter.on(event, handler);
      return this;
    },

    once(event, handler) {
      emitter.once(event, handler);
      return this;
    },

    off(event, handler) {
      emitter.removeListener(event, handler);
      return this;
    },

    /**
     * Start streaming execution.
     * @param {string} [task] - Override task prompt (defaults to charter purpose)
     * @returns {Promise<object>} - The execution receipt
     */
    start(task) {
      if (running) {
        const err = new Error('Execution already in progress');
        emitter.emit('execution:error', { error: err.message });
        return Promise.reject(err);
      }
      return execute(task);
    },

    /**
     * Cancel a running execution.
     */
    cancel() {
      if (!running) return;
      if (abortController) {
        abortController.abort();
      }
      running = false;
      stopHeartbeat();
      resetStallDetection();
      emitter.emit('execution:error', {
        error: 'Execution cancelled by user',
        code: 'CANCELLED',
        timestamp: new Date().toISOString()
      });
    },

    /**
     * Get the execution timeline (available during and after execution).
     */
    getTimeline() {
      return timeline.toJSON();
    },

    /**
     * Get the execution receipt (available after completion).
     */
    getReceipt() {
      return receipt;
    },

    /** Whether execution is currently in progress */
    get running() {
      return running;
    }
  };
}

export default { createStreamingExecutor };
