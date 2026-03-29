/**
 * Provider Resolution
 *
 * Routes LLM calls to the correct provider based on worker configuration:
 *   - BYOK Anthropic: direct Anthropic API with tenant's own key
 *   - BYOK OpenAI: direct OpenAI API with tenant's own key
 *   - Default: OpenRouter (platform key, any model)
 */

import { anthropicChatCompletion } from './anthropic.js';
import { openaiChatCompletion } from './openai.js';
import { chatCompletion as openrouterChatCompletion } from '../openrouter.js';

/**
 * Resolve which chatCompletion function to use for a given worker.
 *
 * @param {Object} worker - Worker record with optional provider_mode, byok_provider, byok_api_key
 * @returns {Function} The chatCompletion function for this worker's provider
 */
function resolveProvider(worker) {
  if (worker.provider_mode === 'byok') {
    if (worker.byok_provider === 'anthropic') {
      return anthropicChatCompletion;
    }
    if (worker.byok_provider === 'openai') {
      return openaiChatCompletion;
    }
  }
  // Default: OpenRouter
  return openrouterChatCompletion;
}

/**
 * Call the correct provider's chatCompletion for a worker.
 *
 * Automatically injects the worker's BYOK API key if applicable.
 * Accepts the same params as openrouter chatCompletion:
 *   { model, messages, tools, maxTokens, temperature, stream }
 *
 * @param {Object} worker - Worker record
 * @param {Object} params - Chat completion params
 * @returns {Object} { response, toolCalls, finishReason, usage }
 */
async function chatCompletionForWorker(worker, params) {
  const completionFn = resolveProvider(worker);

  // Inject BYOK API key if the worker has one
  if (worker.provider_mode === 'byok' && worker.byok_api_key) {
    params = { ...params, apiKey: worker.byok_api_key };
  }

  return completionFn(params);
}

export { resolveProvider, chatCompletionForWorker };
