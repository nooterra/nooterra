/**
 * Provider Fallback & Resilience Layer
 *
 * Circuit breakers, latency-aware routing, automatic fallback chains,
 * cost tracking, and rate-limit backoff for all AI providers.
 *
 * No external dependencies — Node.js built-ins only.
 */

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------

const CIRCUIT_STATES = { CLOSED: 'CLOSED', HALF_OPEN: 'HALF_OPEN', OPEN: 'OPEN' };

const DEFAULT_OPTIONS = {
  windowSize: 20,               // sliding window of recent calls
  failureThreshold: 3,          // consecutive failures to trip breaker
  halfOpenAfterMs: 60_000,      // time before OPEN -> HALF_OPEN
  halfOpenSuccessThreshold: 2,  // consecutive successes in HALF_OPEN to close
  p95LatencyThresholdMs: 10_000,// prefer faster providers above this
  fallbackOrder: ['chatgpt', 'anthropic', 'gemini', 'chatgpt-codex'],
};

// Cost per 1 M tokens (USD)
const PRICING = {
  'chatgpt':       { input: 2.50,  output: 10.00 },
  'gpt-4o':        { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':   { input: 0.15,  output: 0.60  },
  'anthropic':     { input: 3.00,  output: 15.00 },
  'claude-sonnet': { input: 3.00,  output: 15.00 },
  'gemini':        { input: 1.25,  output: 5.00  },
  'chatgpt-codex': { input: 2.50,  output: 10.00 },
};

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function now() { return Date.now(); }

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Compute p95 from an array of numbers. Returns Infinity when empty. */
function p95(values) {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function estimateCost(provider, usage) {
  if (!usage) return 0;
  const pricing = PRICING[provider] || PRICING['chatgpt']; // fallback
  const inputTokens = usage.input_tokens || usage.prompt_tokens || 0;
  const outputTokens = usage.output_tokens || usage.completion_tokens || 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// -------------------------------------------------------------------------
// ProviderTracker — per-provider health / circuit-breaker state
// -------------------------------------------------------------------------

class ProviderTracker {
  constructor(id, windowSize) {
    this.id = id;
    this.windowSize = windowSize;
    this.calls = [];             // sliding window: { ts, ok, latencyMs }
    this.state = CIRCUIT_STATES.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccessesInHalfOpen = 0;
    this.openedAt = null;        // timestamp when circuit opened
    this.rateLimitUntil = null;  // 429 retry-after deadline
  }

  record(ok, latencyMs) {
    this.calls.push({ ts: now(), ok, latencyMs });
    if (this.calls.length > this.windowSize) {
      this.calls.shift();
    }

    if (ok) {
      this.consecutiveFailures = 0;
      if (this.state === CIRCUIT_STATES.HALF_OPEN) {
        this.consecutiveSuccessesInHalfOpen++;
      }
    } else {
      this.consecutiveFailures++;
      this.consecutiveSuccessesInHalfOpen = 0;
    }
  }

  getP95Latency() {
    return p95(this.calls.filter(c => c.ok).map(c => c.latencyMs));
  }

  getSuccessRate() {
    if (this.calls.length === 0) return 1;
    return this.calls.filter(c => c.ok).length / this.calls.length;
  }

  isRateLimited() {
    return this.rateLimitUntil !== null && now() < this.rateLimitUntil;
  }

  setRateLimited(retryAfterMs) {
    this.rateLimitUntil = now() + retryAfterMs;
  }

  clearRateLimit() {
    this.rateLimitUntil = null;
  }
}

// -------------------------------------------------------------------------
// ProviderRouter — the main export
// -------------------------------------------------------------------------

class ProviderRouter {
  constructor(callFn, options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.callFn = callFn; // async (provider, model, systemPrompt, messages, tools) => result
    this.trackers = new Map();   // provider id -> ProviderTracker
    this.costs = new Map();      // "provider:YYYY-MM-DD" -> cumulative USD
    this.workerCosts = new Map();// "workerId:YYYY-MM-DD" -> cumulative USD
  }

  // -- internal -----------------------------------------------------------

  _tracker(provider) {
    if (!this.trackers.has(provider)) {
      this.trackers.set(provider, new ProviderTracker(provider, this.options.windowSize));
    }
    return this.trackers.get(provider);
  }

  /**
   * Evaluate circuit state transitions.
   * Returns true if the provider is available to receive a call.
   */
  _isAvailable(provider) {
    const t = this._tracker(provider);

    // Rate-limited providers are unavailable until the backoff expires
    if (t.isRateLimited()) return false;

    switch (t.state) {
      case CIRCUIT_STATES.CLOSED:
        return true;

      case CIRCUIT_STATES.OPEN: {
        // Check if enough time has passed to transition to HALF_OPEN
        if (now() - t.openedAt >= this.options.halfOpenAfterMs) {
          t.state = CIRCUIT_STATES.HALF_OPEN;
          t.consecutiveSuccessesInHalfOpen = 0;
          return true; // allow one probe
        }
        return false;
      }

      case CIRCUIT_STATES.HALF_OPEN:
        return true; // allow probe calls

      default:
        return true;
    }
  }

  /**
   * After a call completes, update circuit-breaker state.
   */
  _updateCircuit(provider, ok) {
    const t = this._tracker(provider);

    if (!ok) {
      if (t.consecutiveFailures >= this.options.failureThreshold) {
        t.state = CIRCUIT_STATES.OPEN;
        t.openedAt = now();
      }
      // Any failure in HALF_OPEN reopens immediately
      if (t.state === CIRCUIT_STATES.HALF_OPEN) {
        t.state = CIRCUIT_STATES.OPEN;
        t.openedAt = now();
      }
      return;
    }

    // Success
    if (t.state === CIRCUIT_STATES.HALF_OPEN) {
      if (t.consecutiveSuccessesInHalfOpen >= this.options.halfOpenSuccessThreshold) {
        t.state = CIRCUIT_STATES.CLOSED;
      }
    }
  }

  _trackCost(provider, usage, workerId) {
    const cost = estimateCost(provider, usage);
    if (cost <= 0) return;

    const dk = dayKey(now());

    const providerKey = `${provider}:${dk}`;
    this.costs.set(providerKey, (this.costs.get(providerKey) || 0) + cost);

    if (workerId) {
      const workerKey = `${workerId}:${dk}`;
      this.workerCosts.set(workerKey, (this.workerCosts.get(workerKey) || 0) + cost);
    }
  }

  /**
   * Pick the best available provider from the fallback chain.
   * Prefers the requested provider when healthy. Falls back through the
   * chain in order, skipping OPEN and rate-limited providers. If two
   * providers are both available, prefers the one with lower p95 latency
   * when the requested provider's p95 exceeds the threshold.
   */
  _selectProvider(preferred) {
    if (this._isAvailable(preferred)) {
      const t = this._tracker(preferred);
      if (t.getP95Latency() <= this.options.p95LatencyThresholdMs) {
        return preferred;
      }
      // Preferred is slow — look for a faster alternative, but keep it as final fallback
    }

    // Walk fallback order
    const chain = this.options.fallbackOrder.filter(p => p !== preferred);
    for (const candidate of chain) {
      if (this._isAvailable(candidate)) {
        return candidate;
      }
    }

    // Everything else is down — try the preferred provider anyway (best-effort)
    if (this._isAvailable(preferred)) return preferred;

    // Absolute last resort: return preferred and let the call fail naturally
    return preferred;
  }

  // -- public API ---------------------------------------------------------

  /**
   * Route a call with automatic fallback and resilience.
   *
   * @param {string} provider   Preferred provider id
   * @param {string} model      Model id
   * @param {string} systemPrompt
   * @param {Array}  messages
   * @param {Array}  [tools]
   * @param {object} [meta]     Optional { workerId } for cost tracking
   * @returns {object}          The provider response, augmented with { _routed }
   */
  async call(provider, model, systemPrompt, messages, tools, meta = {}) {
    const selected = this._selectProvider(provider);
    const tracker = this._tracker(selected);
    const start = now();
    let ok = false;
    let result;

    try {
      result = await this.callFn(selected, model, systemPrompt, messages, tools);
      ok = true;
    } catch (err) {
      // Handle rate limiting
      if (err?.code === 'PROVIDER_RATE_LIMITED' || err?.status === 429 ||
          (err?.message && /429|rate.limit/i.test(err.message))) {
        const retryAfter = parseRetryAfter(err);
        tracker.setRateLimited(retryAfter);
      }

      const latency = now() - start;
      tracker.record(false, latency);
      this._updateCircuit(selected, false);

      // If we already fell back, don't recurse infinitely — just throw
      if (selected !== provider) {
        throw err;
      }

      // Try one more fallback
      const fallback = this._selectProvider(`${provider}__retry_skip__`);
      if (fallback !== provider && fallback !== `${provider}__retry_skip__` && this._isAvailable(fallback)) {
        return this.call(fallback, model, systemPrompt, messages, tools, meta);
      }

      throw err;
    }

    const latency = now() - start;
    tracker.record(true, latency);
    this._updateCircuit(selected, true);
    this._trackCost(selected, result?.usage, meta?.workerId);

    return { ...result, _routed: { provider: selected, latencyMs: latency } };
  }

  /**
   * Get health / circuit-breaker status for all tracked providers.
   */
  getStatus() {
    const status = {};
    const allProviders = new Set([
      ...this.options.fallbackOrder,
      ...this.trackers.keys(),
    ]);

    for (const id of allProviders) {
      const t = this._tracker(id);
      // Refresh availability check (may transition OPEN -> HALF_OPEN)
      const available = this._isAvailable(id);

      status[id] = {
        id,
        state: t.state,
        available,
        consecutiveFailures: t.consecutiveFailures,
        successRate: Math.round(t.getSuccessRate() * 100),
        p95LatencyMs: t.getP95Latency() === Infinity ? null : Math.round(t.getP95Latency()),
        totalCalls: t.calls.length,
        rateLimited: t.isRateLimited(),
        rateLimitUntil: t.rateLimitUntil,
      };
    }

    return status;
  }

  /**
   * Get cumulative cost data.
   *
   * @returns {{ byProvider: Object, byWorker: Object, todayTotal: number }}
   */
  getCostSummary() {
    const today = dayKey(now());
    const byProvider = {};
    const byWorker = {};
    let todayTotal = 0;

    for (const [key, cost] of this.costs.entries()) {
      const [provider, day] = key.split(':');
      if (!byProvider[provider]) byProvider[provider] = {};
      byProvider[provider][day] = cost;
      if (day === today) todayTotal += cost;
    }

    for (const [key, cost] of this.workerCosts.entries()) {
      const [workerId, day] = key.split(':');
      if (!byWorker[workerId]) byWorker[workerId] = {};
      byWorker[workerId][day] = cost;
    }

    return { byProvider, byWorker, todayTotal: Math.round(todayTotal * 1_000_000) / 1_000_000 };
  }

  /**
   * Manually reset a circuit breaker.
   */
  reset(provider) {
    const t = this._tracker(provider);
    t.state = CIRCUIT_STATES.CLOSED;
    t.consecutiveFailures = 0;
    t.consecutiveSuccessesInHalfOpen = 0;
    t.openedAt = null;
    t.rateLimitUntil = null;
    t.calls = [];
  }
}

// -------------------------------------------------------------------------
// Rate-limit backoff parsing
// -------------------------------------------------------------------------

function parseRetryAfter(err) {
  // Try to extract Retry-After from error metadata
  const headers = err?.headers || err?.response?.headers;
  if (headers) {
    const ra = typeof headers.get === 'function'
      ? headers.get('retry-after')
      : headers['retry-after'];
    if (ra) {
      const seconds = Number(ra);
      if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
      // Could be an HTTP-date, but that's rare for AI APIs
      const date = new Date(ra);
      if (!Number.isNaN(date.getTime())) return Math.max(0, date.getTime() - now());
    }
  }

  // Check for retry_after in body
  const body = err?.body || err?.data;
  if (body) {
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      if (parsed?.error?.retry_after) return parsed.error.retry_after * 1000;
    } catch {}
  }

  // Default: back off 30 seconds
  return 30_000;
}

// -------------------------------------------------------------------------
// Factory
// -------------------------------------------------------------------------

/**
 * Create a provider router with fallback, circuit breakers, and cost tracking.
 *
 * @param {object} options
 * @param {function} options.callFn  - async (provider, model, systemPrompt, messages, tools) => response
 *                                     The actual provider call implementation.
 * @param {string[]} [options.fallbackOrder] - Provider fallback priority
 * @param {number}   [options.windowSize]
 * @param {number}   [options.failureThreshold]
 * @param {number}   [options.halfOpenAfterMs]
 * @param {number}   [options.halfOpenSuccessThreshold]
 * @param {number}   [options.p95LatencyThresholdMs]
 * @returns {ProviderRouter}
 */
export function createProviderRouter(options = {}) {
  const { callFn, ...rest } = options;
  if (typeof callFn !== 'function') {
    throw new Error('createProviderRouter requires options.callFn — the async function that calls the AI provider');
  }
  return new ProviderRouter(callFn, rest);
}

/**
 * Convenience: get provider status from a router instance.
 * Mirrors the shape expected by the TUI dashboard.
 */
export function getProviderStatus(router) {
  if (!router || typeof router.getStatus !== 'function') return {};
  return router.getStatus();
}

export { CIRCUIT_STATES, PRICING, DEFAULT_OPTIONS };

export default { createProviderRouter, getProviderStatus, CIRCUIT_STATES, PRICING };
