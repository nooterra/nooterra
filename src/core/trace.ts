/**
 * trace_id propagation — every operation gets a ULID that flows through all 12 layers.
 *
 * Usage:
 *   const traceId = createTraceId();
 *   // Pass traceId through every function call, DB write, and event emission
 *   // The trace viewer in the dashboard lets you follow any event from source to action
 */

import { ulid } from 'ulid';

/** Create a new trace ID (ULID — time-ordered, sortable, unique) */
export function createTraceId(): string {
  return ulid();
}

/** Create a new entity ID with optional prefix */
export function createId(prefix?: string): string {
  const id = ulid();
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Trace context that propagates through all layers.
 * Every function in the pipeline receives this.
 */
export interface TraceContext {
  /** Unique trace ID for this operation chain */
  traceId: string;
  /** Tenant this operation belongs to */
  tenantId: string;
  /** What initiated this trace (connector sync, agent execution, human action, system tick) */
  source: TraceSource;
  /** Timestamp when the trace started */
  startedAt: Date;
  /** Parent trace ID if this is a sub-operation */
  parentTraceId?: string;
}

export interface TraceSource {
  type: 'connector' | 'agent' | 'human' | 'system';
  id: string;
  method: string;
}

/** Create a new trace context */
export function createTraceContext(
  tenantId: string,
  source: TraceSource,
  parentTraceId?: string,
): TraceContext {
  return {
    traceId: createTraceId(),
    tenantId,
    source,
    startedAt: new Date(),
    parentTraceId,
  };
}
