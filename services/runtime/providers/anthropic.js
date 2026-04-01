/**
 * Anthropic API Provider (BYOK)
 *
 * Direct integration with Anthropic's Messages API using raw fetch.
 * Supports tool_use natively. Maps OpenAI-style messages to Anthropic format.
 *
 * Pricing (per 1M tokens):
 *   claude-haiku-4.5:  $1 input / $5 output
 *   claude-sonnet-4.6: $3 input / $15 output
 *   claude-opus-4.6:   $15 input / $75 output
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// Pricing per 1M tokens (USD)
const PRICING = {
  'claude-haiku-4.5':  { input: 1, output: 5 },
  'claude-sonnet-4.6': { input: 3, output: 15 },
  'claude-opus-4.6':   { input: 15, output: 75 },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getPricing(model) {
  // Try exact match first, then partial match
  if (PRICING[model]) return PRICING[model];
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.includes(key)) return pricing;
  }
  return { input: 0, output: 0 };
}

function estimateCost(model, promptTokens, completionTokens) {
  const pricing = getPricing(model);
  return (
    (promptTokens / 1_000_000) * pricing.input +
    (completionTokens / 1_000_000) * pricing.output
  );
}

/**
 * Convert OpenAI-style messages to Anthropic format.
 * Anthropic requires:
 *   - system as a top-level parameter (not in messages)
 *   - messages must alternate user/assistant
 *   - tool results go inside user messages as tool_result content blocks
 */
function convertMessages(openaiMessages) {
  let system = '';
  const messages = [];

  for (const msg of openaiMessages) {
    if (msg.role === 'system') {
      system += (system ? '\n\n' : '') + msg.content;
      continue;
    }

    if (msg.role === 'assistant') {
      const content = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }
      // Convert tool_calls to tool_use content blocks
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let input;
          try {
            input = typeof tc.arguments === 'string'
              ? JSON.parse(tc.arguments || '{}')
              : (tc.arguments || {});
          } catch {
            input = {};
          }
          content.push({
            type: 'tool_use',
            id: tc.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: tc.name,
            input,
          });
        }
      }
      messages.push({ role: 'assistant', content });
      continue;
    }

    if (msg.role === 'tool') {
      // Anthropic expects tool_result inside a user message
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || msg.name || 'unknown',
        content: msg.content || '',
      };

      // If the last message is already a user message, append to it
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(toolResultBlock);
      } else {
        messages.push({ role: 'user', content: [toolResultBlock] });
      }
      continue;
    }

    // Regular user message
    messages.push({ role: 'user', content: msg.content || '' });
  }

  // Anthropic requires messages to start with a user message
  if (messages.length > 0 && messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: 'Hello.' });
  }

  // Ensure alternating roles by merging consecutive same-role messages
  const merged = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      // Merge content
      if (typeof last.content === 'string' && typeof msg.content === 'string') {
        last.content += '\n\n' + msg.content;
      } else {
        // Convert to array form and merge
        const lastArr = Array.isArray(last.content)
          ? last.content
          : [{ type: 'text', text: last.content || '' }];
        const msgArr = Array.isArray(msg.content)
          ? msg.content
          : [{ type: 'text', text: msg.content || '' }];
        last.content = [...lastArr, ...msgArr];
      }
    } else {
      merged.push({ ...msg });
    }
  }

  return { system, messages: merged };
}

/**
 * Convert tool definitions from our format to Anthropic's format.
 */
function convertTools(tools) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    name: t.name,
    description: t.description || '',
    input_schema: t.parameters || { type: 'object', properties: {} },
  }));
}

/**
 * Extract tool calls from Anthropic response content blocks.
 * Returns array of { id, name, arguments } or null.
 */
function extractToolCalls(content) {
  if (!Array.isArray(content)) return null;
  const toolUses = content.filter(block => block.type === 'tool_use');
  if (toolUses.length === 0) return null;
  return toolUses.map(tu => ({
    id: tu.id,
    name: tu.name,
    arguments: JSON.stringify(tu.input || {}),
  }));
}

/**
 * Extract text content from Anthropic response.
 */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES, signal = null) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fetchOpts = signal ? { ...options, signal } : options;
      const res = await fetch(url, fetchOpts);

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < retries) {
          const retryAfter = res.headers.get('retry-after');
          const backoff = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(Math.min(backoff, 30000));
          continue;
        }
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
        err.status = res.status;
        err.body = body;
        throw err;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (err.status && err.status !== 429 && err.status < 500) throw err;
      if (attempt < retries) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Call Anthropic Messages API.
 *
 * @param {Object} params
 * @param {string} params.model - Model ID (e.g. 'claude-sonnet-4.6')
 * @param {Array} params.messages - OpenAI-style messages array
 * @param {Array} [params.tools] - Tool definitions
 * @param {number} [params.maxTokens=4096] - Max output tokens
 * @param {number} [params.temperature=0.2] - Sampling temperature
 * @param {string} [params.apiKey] - BYOK API key (falls back to env)
 * @returns {Object} { response, toolCalls, finishReason, usage: { promptTokens, completionTokens, totalTokens, cost } }
 */
async function anthropicChatCompletion({ model, messages, tools, maxTokens = 4096, temperature = 0.2, apiKey, signal }) {
  if (!model) throw new Error('model is required');
  if (!messages || !messages.length) throw new Error('messages array is required');

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Anthropic API key is not set (pass apiKey or set ANTHROPIC_API_KEY)');

  const { system, messages: anthropicMessages } = convertMessages(messages);
  const anthropicTools = convertTools(tools);

  const body = {
    model,
    messages: anthropicMessages,
    max_tokens: maxTokens,
    temperature,
  };

  if (system) {
    body.system = system;
  }

  if (anthropicTools) {
    body.tools = anthropicTools;
  }

  const res = await fetchWithRetry(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  }, MAX_RETRIES, signal);

  const data = await res.json();

  const response = extractText(data.content);
  const toolCalls = extractToolCalls(data.content);

  const promptTokens = data.usage?.input_tokens || 0;
  const completionTokens = data.usage?.output_tokens || 0;
  const totalTokens = promptTokens + completionTokens;

  // Map Anthropic stop_reason to OpenAI-style finish_reason
  let finishReason = 'unknown';
  if (data.stop_reason === 'end_turn') finishReason = 'stop';
  else if (data.stop_reason === 'tool_use') finishReason = 'tool_calls';
  else if (data.stop_reason === 'max_tokens') finishReason = 'length';
  else if (data.stop_reason) finishReason = data.stop_reason;

  return {
    response,
    toolCalls,
    finishReason,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      cost: estimateCost(model, promptTokens, completionTokens),
    },
  };
}

export { anthropicChatCompletion };
