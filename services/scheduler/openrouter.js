/**
 * OpenRouter API Proxy
 *
 * Unified access to any LLM model via OpenRouter's API.
 * Handles streaming, tool calling, rate limiting with retry/backoff,
 * and token usage tracking. Zero external dependencies beyond Node.js fetch.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// Cache model pricing after first fetch
let modelPricingCache = null;
let modelPricingFetchedAt = 0;
const PRICING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY environment variable is not set');
  return key;
}

function buildHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getApiKey()}`,
    'HTTP-Referer': 'https://nooterra.com',
    'X-Title': 'Nooterra Worker Scheduler',
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retry on 429 and 5xx errors.
 */
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
        const err = new Error(`OpenRouter API error ${res.status}: ${body.slice(0, 500)}`);
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

// ---------------------------------------------------------------------------
// SSE Parser (for streaming responses)
// ---------------------------------------------------------------------------

function createSSEParser() {
  let buffer = '';
  return {
    feed(chunk) {
      buffer += chunk;
      const results = [];
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') {
          if (payload === '[DONE]') results.push({ _done: true });
          continue;
        }
        try {
          results.push(JSON.parse(payload));
        } catch {
          // skip malformed payloads
        }
      }
      return results;
    },
    flush() {
      if (!buffer.trim()) return [];
      const result = this.feed('\n');
      buffer = '';
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Chat Completion (non-streaming)
// ---------------------------------------------------------------------------

/**
 * Call any model via OpenRouter chat completions API.
 *
 * @param {Object} params
 * @param {string} params.model - Model ID (e.g. 'openai/gpt-4o')
 * @param {Array} params.messages - Chat messages array
 * @param {Array} [params.tools] - Tool/function definitions
 * @param {number} [params.maxTokens=4096] - Max output tokens
 * @param {number} [params.temperature=0.2] - Sampling temperature
 * @param {boolean} [params.stream=false] - Enable streaming
 * @returns {Object|AsyncGenerator} Non-streaming: { response, toolCalls, usage }. Streaming: async generator.
 */
async function chatCompletion({ model, messages, tools, maxTokens = 4096, temperature = 0.2, stream = false, signal }) {
  if (!model) throw new Error('model is required');
  if (!messages || !messages.length) throw new Error('messages array is required');

  if (stream) {
    return chatCompletionStream({ model, messages, tools, maxTokens, temperature });
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  const res = await fetchWithRetry(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  }, MAX_RETRIES, signal);

  const data = await res.json();
  const choice = data.choices?.[0];
  const message = choice?.message || {};
  const usage = data.usage || {};

  const toolCalls = message.tool_calls
    ? message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: tc.function?.arguments,
      }))
    : null;

  return {
    response: message.content || '',
    toolCalls,
    finishReason: choice?.finish_reason || 'unknown',
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      cost: typeof data.usage?.total_cost === 'number'
        ? data.usage.total_cost
        : estimateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Chat Completion (streaming)
// ---------------------------------------------------------------------------

async function* chatCompletionStream({ model, messages, tools, maxTokens, temperature }) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  const res = await fetchWithRetry(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  const parser = createSSEParser();
  const decoder = new TextDecoder();
  let content = '';
  const toolCallsMap = new Map();
  let finishReason = 'unknown';
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of res.body) {
    const text = decoder.decode(chunk, { stream: true });
    const events = parser.feed(text);

    for (const event of events) {
      if (event._done) continue;

      const delta = event.choices?.[0]?.delta;
      if (!delta) continue;

      finishReason = event.choices?.[0]?.finish_reason || finishReason;

      // Usage stats in streaming (some providers include them)
      if (event.usage) {
        promptTokens = event.usage.prompt_tokens || promptTokens;
        completionTokens = event.usage.completion_tokens || completionTokens;
      }

      // Content tokens
      if (delta.content) {
        content += delta.content;
        yield { type: 'token', content: delta.content };
      }

      // Tool calls (streamed incrementally)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, { id: tc.id || '', name: '', arguments: '' });
          }
          const existing = toolCallsMap.get(idx);
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        }
      }
    }
  }

  // Flush remaining
  const remaining = parser.flush();
  for (const event of remaining) {
    if (event._done || !event.choices?.[0]?.delta?.content) continue;
    content += event.choices[0].delta.content;
    yield { type: 'token', content: event.choices[0].delta.content };
  }

  const toolCalls = toolCallsMap.size > 0
    ? Array.from(toolCallsMap.values())
    : null;

  const totalTokens = promptTokens + completionTokens;

  yield {
    type: 'done',
    response: content,
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

// ---------------------------------------------------------------------------
// Model Listing & Pricing
// ---------------------------------------------------------------------------

/**
 * List available models with pricing from OpenRouter.
 *
 * @returns {Array<{id: string, name: string, pricing: {prompt: string, completion: string}, context_length: number}>}
 */
async function listModels() {
  const now = Date.now();
  if (modelPricingCache && now - modelPricingFetchedAt < PRICING_CACHE_TTL_MS) {
    return modelPricingCache;
  }

  const res = await fetchWithRetry(`${OPENROUTER_BASE}/models`, {
    method: 'GET',
    headers: buildHeaders(),
  });

  const data = await res.json();
  const models = (data.data || []).map(m => ({
    id: m.id,
    name: m.name || m.id,
    pricing: {
      prompt: m.pricing?.prompt || '0',
      completion: m.pricing?.completion || '0',
    },
    context_length: m.context_length || 0,
  }));

  modelPricingCache = models;
  modelPricingFetchedAt = now;
  return models;
}

/**
 * Get model pricing in USD per 1M tokens.
 *
 * @param {string} modelId
 * @returns {{inputPer1M: number, outputPer1M: number}}
 */
function getModelPricing(modelId) {
  if (!modelPricingCache) {
    // Return defaults if models haven't been fetched yet
    return { inputPer1M: 0, outputPer1M: 0 };
  }

  const model = modelPricingCache.find(m => m.id === modelId);
  if (!model) return { inputPer1M: 0, outputPer1M: 0 };

  // OpenRouter pricing is per-token; convert to per-1M
  const inputPerToken = parseFloat(model.pricing.prompt) || 0;
  const outputPerToken = parseFloat(model.pricing.completion) || 0;

  return {
    inputPer1M: inputPerToken * 1_000_000,
    outputPer1M: outputPerToken * 1_000_000,
  };
}

/**
 * Estimate cost in USD for a given number of tokens.
 */
function estimateCost(modelId, promptTokens, completionTokens) {
  const pricing = getModelPricing(modelId);
  return (
    (promptTokens / 1_000_000) * pricing.inputPer1M +
    (completionTokens / 1_000_000) * pricing.outputPer1M
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  chatCompletion,
  listModels,
  getModelPricing,
  estimateCost,
};
