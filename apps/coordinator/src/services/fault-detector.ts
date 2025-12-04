/**
 * Fault Detector Service
 * 
 * Objective fault detection replacing subjective disputes.
 * Implements Q59-Q70, Q904-Q905 from protocol design.
 * 
 * Three objective fault types (no voting, no opinions):
 * 1. Timeout: actual_duration_ms > deadline_ms → automatic refund
 * 2. Error: Agent returns HTTP 5xx or status: error → automatic refund
 * 3. Schema Violation: Output fails JSON schema validation → automatic refund
 * 
 * All else = success = pay the agent
 * 
 * Blame attribution:
 * - If node B fails because node A gave bad input, trace back to find fault origin
 * - Validate A's output against B's input schema to determine blame
 */

import { pool } from "../db.js";
import { recordFault } from "./metrics.js";

// ============================================================================
// Types
// ============================================================================

export type FaultType = "timeout" | "error" | "schema_violation" | "upstream_fault" | "none";

export interface FaultDetectionResult {
  hasFault: boolean;
  faultType: FaultType;
  blamedDid: string | null;
  evidence: Record<string, unknown>;
  shouldRefund: boolean;
  refundAmount?: number;
}

export interface NodeExecutionContext {
  workflowId: string;
  nodeName: string;
  agentDid: string;
  capabilityId: string;
  startedAt: Date;
  finishedAt?: Date;
  deadlineAt: Date;
  httpStatus?: number;
  responseStatus?: string; // 'success' | 'error' from agent response
  output?: unknown;
  outputSchema?: Record<string, unknown>;
  error?: string;
}

// ============================================================================
// Logging
// ============================================================================

function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = {
    level,
    service: "fault-detector",
    msg,
    ...data,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(entry));
}

// ============================================================================
// Fault Detection Functions
// ============================================================================

/**
 * Detect timeout fault
 */
function detectTimeoutFault(ctx: NodeExecutionContext): FaultDetectionResult | null {
  if (!ctx.finishedAt) {
    // Node hasn't finished, check if deadline passed
    if (new Date() > ctx.deadlineAt) {
      return {
        hasFault: true,
        faultType: "timeout",
        blamedDid: ctx.agentDid,
        evidence: {
          deadlineAt: ctx.deadlineAt.toISOString(),
          currentTime: new Date().toISOString(),
          startedAt: ctx.startedAt.toISOString(),
        },
        shouldRefund: true,
      };
    }
    return null;
  }

  // Check if finished after deadline
  if (ctx.finishedAt > ctx.deadlineAt) {
    const actualMs = ctx.finishedAt.getTime() - ctx.startedAt.getTime();
    const deadlineMs = ctx.deadlineAt.getTime() - ctx.startedAt.getTime();
    
    return {
      hasFault: true,
      faultType: "timeout",
      blamedDid: ctx.agentDid,
      evidence: {
        actualMs,
        deadlineMs,
        overageMs: actualMs - deadlineMs,
        finishedAt: ctx.finishedAt.toISOString(),
        deadlineAt: ctx.deadlineAt.toISOString(),
      },
      shouldRefund: true,
    };
  }

  return null;
}

/**
 * Detect error fault (HTTP 5xx or explicit error status)
 */
function detectErrorFault(ctx: NodeExecutionContext): FaultDetectionResult | null {
  // Check HTTP status
  if (ctx.httpStatus && ctx.httpStatus >= 500) {
    return {
      hasFault: true,
      faultType: "error",
      blamedDid: ctx.agentDid,
      evidence: {
        httpStatus: ctx.httpStatus,
        errorMessage: ctx.error || "Server error",
      },
      shouldRefund: true,
    };
  }

  // Check explicit error in response
  if (ctx.responseStatus === "error") {
    return {
      hasFault: true,
      faultType: "error",
      blamedDid: ctx.agentDid,
      evidence: {
        responseStatus: ctx.responseStatus,
        errorMessage: ctx.error || "Agent returned error status",
      },
      shouldRefund: true,
    };
  }

  return null;
}

/**
 * Detect schema violation fault
 * Uses JSON Schema validation against capability output schema
 */
function detectSchemaFault(ctx: NodeExecutionContext): FaultDetectionResult | null {
  if (!ctx.output || !ctx.outputSchema) {
    return null;
  }

  const errors = validateAgainstSchema(ctx.output, ctx.outputSchema);
  
  if (errors.length > 0) {
    return {
      hasFault: true,
      faultType: "schema_violation",
      blamedDid: ctx.agentDid,
      evidence: {
        schemaErrors: errors,
        outputSample: JSON.stringify(ctx.output).substring(0, 500),
        expectedSchema: ctx.outputSchema,
      },
      shouldRefund: true,
    };
  }

  return null;
}

/**
 * Simple JSON Schema validation
 * Returns array of error messages, empty if valid
 */
function validateAgainstSchema(data: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (schema.type) {
    const actualType = getJsonType(data);
    if (schema.type !== actualType) {
      errors.push(`Expected type '${schema.type}', got '${actualType}'`);
      return errors; // Type mismatch, can't continue
    }
  }

  if (schema.type === "object" && typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required || []) as string[];

    // Check required fields
    for (const field of required) {
      if (!(field in obj)) {
        errors.push(`Missing required field: '${field}'`);
      }
    }

    // Validate property types
    for (const [key, value] of Object.entries(obj)) {
      if (properties[key]) {
        const propErrors = validateAgainstSchema(value, properties[key]);
        for (const err of propErrors) {
          errors.push(`${key}: ${err}`);
        }
      }
    }
  }

  if (schema.type === "array" && Array.isArray(data)) {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      for (let i = 0; i < data.length; i++) {
        const itemErrors = validateAgainstSchema(data[i], items);
        for (const err of itemErrors) {
          errors.push(`[${i}]: ${err}`);
        }
      }
    }

    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      errors.push(`Array must have at least ${schema.minItems} items, got ${data.length}`);
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      errors.push(`Array must have at most ${schema.maxItems} items, got ${data.length}`);
    }
  }

  return errors;
}

function getJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect faults in a node execution
 * Checks timeout, error, and schema violations in order
 */
export function detectFault(ctx: NodeExecutionContext): FaultDetectionResult {
  // Check timeout first (objective, based on time)
  const timeoutFault = detectTimeoutFault(ctx);
  if (timeoutFault) {
    log("warn", "Timeout fault detected", {
      workflowId: ctx.workflowId,
      nodeName: ctx.nodeName,
      agentDid: ctx.agentDid,
    });
    return timeoutFault;
  }

  // Check for errors (HTTP or explicit)
  const errorFault = detectErrorFault(ctx);
  if (errorFault) {
    log("warn", "Error fault detected", {
      workflowId: ctx.workflowId,
      nodeName: ctx.nodeName,
      agentDid: ctx.agentDid,
      httpStatus: ctx.httpStatus,
    });
    return errorFault;
  }

  // Check schema violations
  const schemaFault = detectSchemaFault(ctx);
  if (schemaFault) {
    log("warn", "Schema fault detected", {
      workflowId: ctx.workflowId,
      nodeName: ctx.nodeName,
      agentDid: ctx.agentDid,
    });
    return schemaFault;
  }

  // No fault detected
  return {
    hasFault: false,
    faultType: "none",
    blamedDid: null,
    evidence: {},
    shouldRefund: false,
  };
}

// ============================================================================
// Blame Attribution
// ============================================================================

/**
 * Trace blame through DAG when a node fails due to bad input
 * 
 * If node B fails because node A gave bad input:
 * 1. Get A's output
 * 2. Validate against B's input schema
 * 3. If A's output is invalid → A is at fault
 * 4. If A's output is valid but B failed → B is at fault
 */
export async function attributeBlame(
  workflowId: string,
  failedNodeName: string,
  failedAgentDid: string
): Promise<{
  blamedDid: string;
  blamedNodeName: string;
  reason: string;
}> {
  try {
    // Get failed node's dependencies
    const nodeRes = await pool.query(
      `SELECT depends_on, capability_id FROM task_nodes 
       WHERE workflow_id = $1 AND name = $2`,
      [workflowId, failedNodeName]
    );

    if (!nodeRes.rowCount) {
      return {
        blamedDid: failedAgentDid,
        blamedNodeName: failedNodeName,
        reason: "Node not found, blaming executing agent",
      };
    }

    const dependsOn = nodeRes.rows[0].depends_on as string[] | null;
    
    // If no dependencies, the failed agent is at fault
    if (!dependsOn || dependsOn.length === 0) {
      return {
        blamedDid: failedAgentDid,
        blamedNodeName: failedNodeName,
        reason: "No upstream dependencies, blaming executing agent",
      };
    }

    // Get the capability's input schema
    const capId = nodeRes.rows[0].capability_id;
    const capRes = await pool.query(
      `SELECT input_schema FROM capabilities WHERE capability_id = $1`,
      [capId]
    );

    const inputSchema = capRes.rows[0]?.input_schema as Record<string, unknown> | null;
    if (!inputSchema) {
      return {
        blamedDid: failedAgentDid,
        blamedNodeName: failedNodeName,
        reason: "No input schema defined, blaming executing agent",
      };
    }

    // Check each dependency's output
    for (const depName of dependsOn) {
      const depRes = await pool.query(
        `SELECT agent_did, result_payload FROM task_nodes 
         WHERE workflow_id = $1 AND name = $2`,
        [workflowId, depName]
      );

      if (!depRes.rowCount) continue;

      const depOutput = depRes.rows[0].result_payload;
      const depAgentDid = depRes.rows[0].agent_did;

      // Validate dependency output against failed node's input schema
      const errors = validateAgainstSchema(depOutput, inputSchema);
      
      if (errors.length > 0) {
        // Upstream node produced invalid output!
        log("info", "Blame attributed to upstream node", {
          workflowId,
          failedNodeName,
          blamedNodeName: depName,
          blamedDid: depAgentDid,
          schemaErrors: errors,
        });

        return {
          blamedDid: depAgentDid,
          blamedNodeName: depName,
          reason: `Upstream node ${depName} produced invalid output: ${errors.join(", ")}`,
        };
      }
    }

    // All upstream outputs are valid, so the failed agent is at fault
    return {
      blamedDid: failedAgentDid,
      blamedNodeName: failedNodeName,
      reason: "All upstream outputs valid, blaming executing agent",
    };
  } catch (err: any) {
    log("error", "Blame attribution failed", { workflowId, failedNodeName, error: err.message });
    return {
      blamedDid: failedAgentDid,
      blamedNodeName: failedNodeName,
      reason: `Attribution error: ${err.message}`,
    };
  }
}

// ============================================================================
// Fault Recording
// ============================================================================

/**
 * Record a fault trace for auditing and analytics
 */
export async function recordFaultTrace(
  workflowId: string,
  nodeName: string,
  faultType: FaultType,
  blamedDid: string | null,
  evidence: Record<string, unknown>,
  refundAmount?: number,
  refundedTo?: string
): Promise<string | null> {
  try {
    const res = await pool.query(
      `INSERT INTO fault_traces (workflow_id, node_name, fault_type, blamed_did, evidence, refund_amount, refunded_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [workflowId, nodeName, faultType, blamedDid, JSON.stringify(evidence), refundAmount || null, refundedTo || null]
    );

    const traceId = res.rows[0]?.id;
    log("info", "Fault trace recorded", { traceId, workflowId, nodeName, faultType });
    
    // Record metric
    recordFault(faultType, blamedDid);
    
    return traceId;
  } catch (err: any) {
    log("error", "Failed to record fault trace", { workflowId, nodeName, error: err.message });
    return null;
  }
}

/**
 * Get fault statistics for an agent
 */
export async function getAgentFaultStats(agentDid: string): Promise<{
  totalFaults: number;
  timeoutFaults: number;
  errorFaults: number;
  schemaFaults: number;
  upstreamFaults: number;
  totalRefunded: number;
}> {
  try {
    const res = await pool.query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN fault_type = 'timeout' THEN 1 ELSE 0 END) as timeouts,
         SUM(CASE WHEN fault_type = 'error' THEN 1 ELSE 0 END) as errors,
         SUM(CASE WHEN fault_type = 'schema_violation' THEN 1 ELSE 0 END) as schema_violations,
         SUM(CASE WHEN fault_type = 'upstream_fault' THEN 1 ELSE 0 END) as upstream_faults,
         COALESCE(SUM(refund_amount), 0) as total_refunded
       FROM fault_traces
       WHERE blamed_did = $1`,
      [agentDid]
    );

    const row = res.rows[0];
    return {
      totalFaults: Number(row.total || 0),
      timeoutFaults: Number(row.timeouts || 0),
      errorFaults: Number(row.errors || 0),
      schemaFaults: Number(row.schema_violations || 0),
      upstreamFaults: Number(row.upstream_faults || 0),
      totalRefunded: Number(row.total_refunded || 0),
    };
  } catch (err: any) {
    log("error", "Failed to get agent fault stats", { agentDid, error: err.message });
    return {
      totalFaults: 0,
      timeoutFaults: 0,
      errorFaults: 0,
      schemaFaults: 0,
      upstreamFaults: 0,
      totalRefunded: 0,
    };
  }
}
