/**
 * Structured execution traces — captures the agent's reasoning chain
 * at key decision points during an execution.
 */

import type { TraceType, TraceEntry } from './types.ts';

// ── Tracer interface ───────────────────────────────────

export interface Tracer {
  trace(type: TraceType, payload: Record<string, unknown>, durationMs?: number): void;
  flush(): Promise<void>;
  /** Exposed for testing only. */
  _buffer: TraceEntry[];
}

const AUTO_FLUSH_THRESHOLD = 50;

/**
 * Factory: create a tracer scoped to a single execution.
 * Batches writes for efficiency; call flush() when the execution completes.
 */
export function createTracer(
  pool: any,
  executionId: string,
  workerId: string,
  tenantId: string,
): Tracer {
  let seq = 0;
  const buffer: TraceEntry[] = [];

  function trace(type: TraceType, payload: Record<string, unknown>, durationMs?: number): void {
    const entry: TraceEntry = {
      id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      execution_id: executionId,
      worker_id: workerId,
      tenant_id: tenantId,
      seq: seq++,
      trace_type: type,
      payload,
      duration_ms: durationMs ?? null,
      created_at: new Date().toISOString(),
    };
    buffer.push(entry);

    if (buffer.length >= AUTO_FLUSH_THRESHOLD) {
      // Fire-and-forget auto-flush; errors are swallowed.
      flush().catch(() => {});
    }
  }

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    if (!pool) return; // null pool = unit-test mode

    // Build a single multi-row INSERT for the batch.
    const values: any[] = [];
    const placeholders: string[] = [];
    let idx = 1;
    for (const e of batch) {
      placeholders.push(
        `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}::jsonb, $${idx + 7}, $${idx + 8})`,
      );
      values.push(
        e.id,
        e.execution_id,
        e.worker_id,
        e.tenant_id,
        e.seq,
        e.trace_type,
        JSON.stringify(e.payload),
        e.duration_ms,
        e.created_at,
      );
      idx += 9;
    }

    const sql = `INSERT INTO execution_traces (id, execution_id, worker_id, tenant_id, seq, trace_type, payload, duration_ms, created_at)
VALUES ${placeholders.join(',\n       ')}`;

    await pool.query(sql, values);
  }

  return { trace, flush, _buffer: buffer };
}

// ── Query helpers ──────────────────────────────────────

/** Load the full trace for an execution, ordered by seq. */
export async function getExecutionTrace(pool: any, executionId: string): Promise<TraceEntry[]> {
  const result = await pool.query(
    `SELECT id, execution_id, worker_id, tenant_id, seq, trace_type, payload, duration_ms, created_at
     FROM execution_traces
     WHERE execution_id = $1
     ORDER BY seq`,
    [executionId],
  );
  return result.rows;
}

/** Load recent trace entries across executions for a worker (dashboard timeline). */
export async function getWorkerRecentTraces(
  pool: any,
  workerId: string,
  limit: number = 100,
): Promise<TraceEntry[]> {
  const result = await pool.query(
    `SELECT id, execution_id, worker_id, tenant_id, seq, trace_type, payload, duration_ms, created_at
     FROM execution_traces
     WHERE worker_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workerId, limit],
  );
  return result.rows;
}
