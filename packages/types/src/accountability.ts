/**
 * @nooterra/types - Accountability Types
 *
 * Types for audit logs, receipts, and tracing.
 */

/**
 * Audit chain entry - immutable, linked log
 */
export interface AuditEntry {
  id: number;
  prevHash?: string;
  eventType: string;
  actorDid?: string;
  targetType?: string;
  targetId?: string;
  action: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  hash: string;
  createdAt: Date;
}

/**
 * Audit event types
 */
export type AuditEventType =
  | "workflow.created"
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.cancelled"
  | "node.dispatched"
  | "node.completed"
  | "node.failed"
  | "agent.registered"
  | "agent.revoked"
  | "agent.key_rotated"
  | "payment.received"
  | "payment.sent"
  | "dispute.opened"
  | "dispute.resolved";

/**
 * Task receipt - proof of completion for agents
 */
export interface TaskReceipt {
  id: string;
  taskId: string;
  nodeId: string;
  workflowId: string;
  agentDid: string;
  capabilityId: string;
  inputHash: string;
  outputHash: string;
  startedAt: Date;
  completedAt: Date;
  latencyMs?: number;
  creditsEarned?: number;
  coordinatorSignature: string;
  agentSignature?: string;
  createdAt: Date;
}

/**
 * OpenTelemetry-compatible trace span
 */
export interface TraceSpan {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  status?: "ok" | "error" | "unset";
  attributes?: Record<string, unknown>;
  events?: TraceEvent[];
  createdAt: Date;
}

/**
 * Trace event within a span
 */
export interface TraceEvent {
  name: string;
  timestamp: Date;
  attributes?: Record<string, unknown>;
}

/**
 * Audit query filters
 */
export interface AuditQuery {
  eventType?: AuditEventType;
  actorDid?: string;
  targetType?: string;
  targetId?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Trace query filters
 */
export interface TraceQuery {
  traceId?: string;
  serviceName?: string;
  operationName?: string;
  status?: string;
  minDurationMs?: number;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}
