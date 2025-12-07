/**
 * Agent Health Service
 * 
 * Periodic health checks and circuit breaker for agents.
 * Monitors agent availability and automatically marks unhealthy agents.
 * 
 * Features:
 * - Periodic health probes (configurable interval)
 * - Circuit breaker pattern (opens after N failures)
 * - Automatic recovery testing
 * - Health history tracking
 */

import { pool } from "../db.js";
import fetch from "node-fetch";

// Configuration
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || "60000"); // 1 minute
const HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || "5000"); // 5 seconds
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || "3");
const CIRCUIT_BREAKER_RESET_MS = parseInt(process.env.CIRCUIT_BREAKER_RESET_MS || "300000"); // 5 minutes
const ENABLE_HEALTH_CHECKS = process.env.ENABLE_HEALTH_CHECKS !== "false";

// Circuit breaker state per agent
const circuitBreakers = new Map<string, {
  failures: number;
  lastFailure: Date | null;
  isOpen: boolean;
  openedAt: Date | null;
}>();

let healthCheckInterval: NodeJS.Timeout | null = null;

/**
 * Log with service prefix
 */
function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    service: "health",
    msg,
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

/**
 * Get or initialize circuit breaker for an agent
 */
function getCircuitBreaker(agentDid: string) {
  if (!circuitBreakers.has(agentDid)) {
    circuitBreakers.set(agentDid, {
      failures: 0,
      lastFailure: null,
      isOpen: false,
      openedAt: null,
    });
  }
  return circuitBreakers.get(agentDid)!;
}

/**
 * Check if circuit is open for an agent
 */
export function isCircuitOpen(agentDid: string): boolean {
  const cb = getCircuitBreaker(agentDid);
  
  if (!cb.isOpen) return false;
  
  // Check if we should attempt reset
  if (cb.openedAt && Date.now() - cb.openedAt.getTime() > CIRCUIT_BREAKER_RESET_MS) {
    // Half-open state - allow one test request
    return false;
  }
  
  return true;
}

/**
 * Record a successful request to an agent
 */
export function recordSuccess(agentDid: string): void {
  const cb = getCircuitBreaker(agentDid);
  cb.failures = 0;
  cb.isOpen = false;
  cb.openedAt = null;
}

/**
 * Record a failed request to an agent
 */
export function recordFailure(agentDid: string): void {
  const cb = getCircuitBreaker(agentDid);
  cb.failures++;
  cb.lastFailure = new Date();
  
  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.isOpen = true;
    cb.openedAt = new Date();
    log("warn", "Circuit breaker opened", { agentDid, failures: cb.failures });
  }
}

/**
 * Probe a single agent's health endpoint
 */
async function probeAgent(agent: { did: string; endpoint: string; name: string }): Promise<{
  healthy: boolean;
  latency_ms: number;
  error?: string;
}> {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  
  try {
    // Special handling for HuggingFace Router - check /v1/models endpoint instead
    if (agent.endpoint.includes("router.huggingface.co")) {
      const hfToken = process.env.HF_TOKEN;
      if (!hfToken) {
        // No token = can't verify, assume healthy (will fail on actual use)
        clearTimeout(timeout);
        return { healthy: true, latency_ms: Date.now() - startTime };
      }
      
      const response = await fetch("https://router.huggingface.co/v1/models", {
        method: "GET",
        signal: controller.signal,
        headers: { 
          "Authorization": `Bearer ${hfToken}`,
          "User-Agent": "Nooterra-Health-Check/1.0",
        },
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        return { healthy: true, latency_ms: Date.now() - startTime };
      }
      
      return {
        healthy: false,
        latency_ms: Date.now() - startTime,
        error: `HF Router HTTP ${response.status}`,
      };
    }
    
    // Try /health endpoint first, fall back to HEAD request
    let healthUrl = agent.endpoint.replace(/\/+$/, "");
    if (!healthUrl.includes("/health")) {
      healthUrl = `${healthUrl}/health`;
    }
    
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "Nooterra-Health-Check/1.0" },
    });
    
    clearTimeout(timeout);
    
    // Any 2xx response is healthy
    if (response.ok) {
      return { healthy: true, latency_ms: Date.now() - startTime };
    }
    
    // 404 on /health - try HEAD on main endpoint
    if (response.status === 404) {
      const mainResponse = await fetch(agent.endpoint, { method: "HEAD" });
      if (mainResponse.ok || mainResponse.status === 405) {
        return { healthy: true, latency_ms: Date.now() - startTime };
      }
    }
    
    return {
      healthy: false,
      latency_ms: Date.now() - startTime,
      error: `HTTP ${response.status}`,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const isTimeout = err.name === "AbortError";
    return {
      healthy: false,
      latency_ms: Date.now() - startTime,
      error: isTimeout ? "Timeout" : err.message,
    };
  }
}

/**
 * Update agent health status in database
 */
async function updateAgentHealth(
  agentDid: string,
  status: "healthy" | "degraded" | "unhealthy",
  latencyMs?: number
): Promise<void> {
  await pool.query(
    `UPDATE agents SET 
       health_status = $2, 
       last_heartbeat = NOW(),
       updated_at = NOW()
     WHERE did = $1`,
    [agentDid, status]
  );
  
  // Also update reputation latency if healthy
  if (status === "healthy" && latencyMs !== undefined) {
    await pool.query(
      `UPDATE agent_reputation SET 
         avg_latency_ms = CASE 
           WHEN avg_latency_ms IS NULL THEN $2
           ELSE ROUND(0.2 * $2 + 0.8 * avg_latency_ms)
         END,
         last_updated = NOW()
       WHERE agent_did = $1`,
      [agentDid, latencyMs]
    );
  }
}

/**
 * Run health checks for all active agents
 */
async function runHealthChecks(): Promise<{
  checked: number;
  healthy: number;
  unhealthy: number;
}> {
  const results = { checked: 0, healthy: 0, unhealthy: 0 };
  
  try {
    // Get all active agents
    const agentsRes = await pool.query(
      `SELECT did, endpoint, name, health_status
       FROM agents
       WHERE is_active = true
       ORDER BY last_heartbeat ASC NULLS FIRST
       LIMIT 100`
    );
    
    for (const agent of agentsRes.rows) {
      results.checked++;
      
      // Skip if circuit is open
      if (isCircuitOpen(agent.did)) {
        log("info", "Skipping health check - circuit open", { agentDid: agent.did });
        continue;
      }
      
      const probe = await probeAgent(agent);
      
      if (probe.healthy) {
        results.healthy++;
        recordSuccess(agent.did);
        
        // Only update if status changed or it's been a while
        if (agent.health_status !== "healthy") {
          await updateAgentHealth(agent.did, "healthy", probe.latency_ms);
          log("info", "Agent recovered", { agentDid: agent.did, latency_ms: probe.latency_ms });
        }
      } else {
        results.unhealthy++;
        recordFailure(agent.did);
        
        // Check if we should mark as unhealthy
        const cb = getCircuitBreaker(agent.did);
        if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
          await updateAgentHealth(agent.did, "unhealthy");
          log("warn", "Agent marked unhealthy", { 
            agentDid: agent.did, 
            error: probe.error,
            consecutiveFailures: cb.failures,
          });
        } else if (cb.failures > 1) {
          await updateAgentHealth(agent.did, "degraded");
        }
      }
    }
  } catch (err: any) {
    log("error", "Health check round failed", { error: err.message });
  }
  
  return results;
}

/**
 * Start the health check loop
 */
export function startHealthChecks(): void {
  if (!ENABLE_HEALTH_CHECKS) {
    log("info", "Health checks disabled");
    return;
  }
  
  if (healthCheckInterval) {
    log("warn", "Health checks already running");
    return;
  }
  
  log("info", "Starting health check loop", { 
    intervalMs: HEALTH_CHECK_INTERVAL_MS,
    timeoutMs: HEALTH_CHECK_TIMEOUT_MS,
    circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
  });
  
  // Run immediately, then on interval
  runHealthChecks().then(results => {
    log("info", "Initial health check complete", results);
  });
  
  healthCheckInterval = setInterval(async () => {
    const results = await runHealthChecks();
    log("info", "Health check round complete", results);
  }, HEALTH_CHECK_INTERVAL_MS);
}

/**
 * Stop the health check loop
 */
export function stopHealthChecks(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    log("info", "Health checks stopped");
  }
}

/**
 * Get health status for all agents
 */
export async function getAgentHealthSummary(): Promise<{
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  unknown: number;
  circuitBreakersOpen: number;
}> {
  const res = await pool.query(
    `SELECT health_status, COUNT(*) as count
     FROM agents
     WHERE is_active = true
     GROUP BY health_status`
  );
  
  const summary = {
    total: 0,
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unknown: 0,
    circuitBreakersOpen: 0,
  };
  
  for (const row of res.rows) {
    const count = parseInt(row.count);
    summary.total += count;
    
    switch (row.health_status) {
      case "healthy": summary.healthy = count; break;
      case "degraded": summary.degraded = count; break;
      case "unhealthy": summary.unhealthy = count; break;
      default: summary.unknown = count; break;
    }
  }
  
  // Count open circuit breakers
  for (const [_, cb] of circuitBreakers) {
    if (cb.isOpen) summary.circuitBreakersOpen++;
  }
  
  return summary;
}

/**
 * Manually trigger a health check for a specific agent
 */
export async function checkAgentHealth(agentDid: string): Promise<{
  healthy: boolean;
  status: string;
  latency_ms?: number;
  error?: string;
  circuitBreakerState: {
    failures: number;
    isOpen: boolean;
  };
}> {
  const agentRes = await pool.query(
    `SELECT did, endpoint, name FROM agents WHERE did = $1`,
    [agentDid]
  );
  
  if (!agentRes.rowCount) {
    throw new Error("Agent not found");
  }
  
  const agent = agentRes.rows[0];
  const probe = await probeAgent(agent);
  const cb = getCircuitBreaker(agentDid);
  
  if (probe.healthy) {
    recordSuccess(agentDid);
    await updateAgentHealth(agentDid, "healthy", probe.latency_ms);
  } else {
    recordFailure(agentDid);
    if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      await updateAgentHealth(agentDid, "unhealthy");
    }
  }
  
  return {
    healthy: probe.healthy,
    status: probe.healthy ? "healthy" : (cb.isOpen ? "unhealthy" : "degraded"),
    latency_ms: probe.latency_ms,
    error: probe.error,
    circuitBreakerState: {
      failures: cb.failures,
      isOpen: cb.isOpen,
    },
  };
}

/**
 * Reset circuit breaker for an agent
 */
export function resetCircuitBreaker(agentDid: string): void {
  circuitBreakers.delete(agentDid);
  log("info", "Circuit breaker reset", { agentDid });
}
