/**
 * Dispatcher Worker
 * 
 * Separate process for dispatching workflow tasks to agents.
 * Can be scaled horizontally independently from the coordinator API.
 * 
 * Run with: node dist/dispatcher.js
 * Or: tsx src/dispatcher.ts
 */

import "dotenv/config";
import { pool } from "./db.js";
import { getRedisClient, dequeueDispatch, enqueueDispatch, closeRedis, QueuedDispatch } from "./redis.js";

// Configuration
const DISPATCH_INTERVAL_MS = parseInt(process.env.DISPATCH_INTERVAL_MS || "1000");
const MAX_CONCURRENT_DISPATCHES = parseInt(process.env.MAX_CONCURRENT_DISPATCHES || "10");
const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "30000");
const MAX_RETRIES = parseInt(process.env.MAX_DISPATCH_RETRIES || "3");
const WORKER_ID = process.env.WORKER_ID || `dispatcher-${process.pid}`;

let isShuttingDown = false;
let activeDispatches = 0;

/**
 * Log with worker prefix
 */
function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    worker: WORKER_ID,
    msg,
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

/**
 * Call an agent endpoint
 */
async function callAgent(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; output?: unknown; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const output = await response.json();
    return { success: true, output };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return { success: false, error: "Agent call timed out" };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Process a single dispatch job
 */
async function processJob(job: QueuedDispatch): Promise<void> {
  activeDispatches++;
  const startTime = Date.now();
  const input = JSON.parse(job.payload);

  try {
    log("info", "Processing dispatch", { 
      workflowId: job.workflowId, 
      nodeName: job.nodeName, 
      agentDid: job.agentDid,
      attempt: job.attempt,
    });

    // Get agent endpoint
    const agentRes = await pool.query(
      `SELECT endpoint, health_status FROM agents WHERE did = $1 AND is_active = true`,
      [job.agentDid]
    );

    if (!agentRes.rowCount) {
      throw new Error(`Agent not found or inactive: ${job.agentDid}`);
    }

    const agent = agentRes.rows[0];
    if (agent.health_status === "unhealthy") {
      throw new Error(`Agent is unhealthy: ${job.agentDid}`);
    }

    // Record agent call
    const callRes = await pool.query(
      `INSERT INTO agent_calls (agent_did, workflow_run_id, node_name, input, status, started_at)
       VALUES ($1, $2, $3, $4, 'running', NOW())
       RETURNING id`,
      [job.agentDid, job.workflowId, job.nodeName, job.payload]
    );
    const callId = callRes.rows[0].id;

    // Call the agent
    const result = await callAgent(agent.endpoint, {
      workflowId: job.workflowId,
      nodeName: job.nodeName,
      input,
    });

    const duration = Date.now() - startTime;

    if (result.success) {
      // Update agent call record
      await pool.query(
        `UPDATE agent_calls SET status = 'completed', output = $1, completed_at = NOW() WHERE id = $2`,
        [JSON.stringify(result.output), callId]
      );

      // Store node result
      await pool.query(
        `UPDATE workflow_runs 
         SET node_results = node_results || $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify({ [job.nodeName]: result.output }), job.workflowId]
      );

      log("info", "Dispatch completed", { 
        workflowId: job.workflowId, 
        nodeName: job.nodeName, 
        durationMs: duration 
      });

      // TODO: Check if workflow is complete and dispatch next nodes
      // This would require reading the DAG and determining next steps
    } else {
      // Update agent call record
      await pool.query(
        `UPDATE agent_calls SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
        [result.error, callId]
      );

      // Retry if under limit
      if (job.attempt < MAX_RETRIES) {
        log("warn", "Dispatch failed, retrying", { 
          workflowId: job.workflowId, 
          nodeName: job.nodeName, 
          error: result.error,
          attempt: job.attempt,
        });
        
        await enqueueDispatch({ ...job, attempt: job.attempt + 1 });
      } else {
        log("error", "Dispatch failed permanently", { 
          workflowId: job.workflowId, 
          nodeName: job.nodeName, 
          error: result.error,
        });

        // Mark workflow run as failed
        await pool.query(
          `UPDATE workflow_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
          [result.error, job.workflowId]
        );
      }
    }
  } catch (err: any) {
    log("error", "Dispatch error", { 
      workflowId: job.workflowId, 
      nodeName: job.nodeName, 
      error: err.message,
    });

    // Retry if under limit
    if (job.attempt < MAX_RETRIES) {
      await enqueueDispatch({ ...job, attempt: job.attempt + 1 });
    } else {
      await pool.query(
        `UPDATE workflow_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
        [err.message, job.workflowId]
      );
    }
  } finally {
    activeDispatches--;
  }
}

/**
 * Main dispatch loop
 */
async function dispatchLoop(): Promise<void> {
  // Initialize Redis
  const redis = getRedisClient();
  if (!redis) {
    log("error", "Redis not configured, cannot start dispatcher");
    process.exit(1);
  }

  while (!isShuttingDown) {
    try {
      // Only process if under concurrency limit
      if (activeDispatches < MAX_CONCURRENT_DISPATCHES) {
        const job = await dequeueDispatch();
        
        if (job) {
          // Process in background (don't await)
          processJob(job).catch((err) => {
            log("error", "Unhandled job error", { error: err.message });
          });
        }
      }

      // Small delay between loop iterations
      await new Promise((resolve) => setTimeout(resolve, DISPATCH_INTERVAL_MS));
    } catch (err: any) {
      log("error", "Dispatch loop error", { error: err.message });
      // Back off on error
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
  log("info", `Received ${signal}, shutting down gracefully...`);
  isShuttingDown = true;

  // Wait for active dispatches to complete (max 30s)
  const maxWait = 30000;
  const started = Date.now();

  while (activeDispatches > 0 && Date.now() - started < maxWait) {
    log("info", `Waiting for ${activeDispatches} active dispatches...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (activeDispatches > 0) {
    log("warn", `Forcing shutdown with ${activeDispatches} active dispatches`);
  }

  // Close connections
  await closeRedis();
  await pool.end();

  log("info", "Dispatcher shutdown complete");
  process.exit(0);
}

// Signal handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Unhandled errors
process.on("uncaughtException", (err) => {
  log("error", "Uncaught exception", { error: err.message, stack: err.stack });
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: any) => {
  log("error", "Unhandled rejection", { reason: String(reason) });
});

// Start
log("info", "Dispatcher starting", {
  dispatchInterval: DISPATCH_INTERVAL_MS,
  maxConcurrent: MAX_CONCURRENT_DISPATCHES,
  agentTimeout: AGENT_TIMEOUT_MS,
  maxRetries: MAX_RETRIES,
});

dispatchLoop();
