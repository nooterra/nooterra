/**
 * OpenAI API Provider (BYOK)
 *
 * Direct integration with OpenAI's Chat Completions API using raw fetch.
 * Same format as OpenRouter (OpenAI-compatible), but hits OpenAI directly.
 *
 * Pricing (per 1M tokens):
 *   gpt-4o:       $2.50 input / $10 output
 *   gpt-4o-mini:  $0.15 input / $0.60 output
 *   gpt-4-turbo:  $10 input / $30 output
 */

const OPENAI_BASE = 'https://api.openai.com/v1';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// Pricing per 1M tokens (USD)
const PRICING = {
  'gpt-4o':      { input: 2.50, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10, output: 30 },
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getPricing(model) {
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
        const err = new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`);
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
 * Call OpenAI Chat Completions API.
 *
 * @param {Object} params
 * @param {string} params.model - Model ID (e.g. 'gpt-4o')
 * @param {Array} params.messages - Chat messages array
 * @param {Array} [params.tools] - Tool/function definitions
 * @param {number} [params.maxTokens=4096] - Max output tokens
 * @param {number} [params.temperature=0.2] - Sampling temperature
 * @param {string} [params.apiKey] - BYOK API key (falls back to env)
 * @returns {Object} { response, toolCalls, finishReason, usage: { promptTokens, completionTokens, totalTokens, cost } }
 */
async function openaiChatCompletion({ model, messages, tools, maxTokens = 4096, temperature = 0.2, apiKey, signal }) {
  if (!model) throw new Error('model is required');
  if (!messages || !messages.length) throw new Error('messages array is required');

  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API key is not set (pass apiKey or set OPENAI_API_KEY)');

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

  const res = await fetchWithRetry(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
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
      cost: estimateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    },
  };
}

export { openaiChatCompletion };
