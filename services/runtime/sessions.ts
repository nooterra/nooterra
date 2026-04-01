/**
 * Sessions — persistent multi-execution context for agent tasks.
 *
 * Pure functions (buildSessionMessages, extractSessionUpdates, summarizeExecution)
 * are exported alongside DB helpers so they can be tested without a database.
 */

import type { Pool } from "pg";
import type { Session, SessionHistoryEntry, ActivityEntry } from "./types.ts";
import crypto from "node:crypto";

// ── Message type returned by buildSessionMessages ──────

export interface Message {
  role: "system";
  content: string;
}

// ── Pure helpers ───────────────────────────────────────

/**
 * Build system messages that inject session context into an LLM prompt.
 * Returns an empty array when the session carries no meaningful state.
 */
export function buildSessionMessages(session: {
  id: string;
  goal: string | null;
  context: Record<string, unknown>;
  history: SessionHistoryEntry[];
}): Message[] {
  const hasGoal = !!session.goal;
  const hasContext = Object.keys(session.context).length > 0;
  const hasHistory = session.history.length > 0;

  if (!hasGoal && !hasContext && !hasHistory) return [];

  const lines: string[] = ["--- Active Session ---"];

  if (hasGoal) {
    lines.push(`Session goal: ${session.goal}`);
  }

  if (hasContext) {
    lines.push("Session context:");
    for (const [k, v] of Object.entries(session.context)) {
      lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  if (hasHistory) {
    lines.push("Prior steps in this session:");
    for (const entry of session.history) {
      lines.push(`  [${entry.ts}] ${entry.summary}`);
    }
  }

  lines.push("");
  lines.push(
    "To update session context, include lines like: SESSION_CONTEXT: key=value"
  );
  lines.push(
    "When the session goal is fully achieved, include: SESSION_COMPLETE"
  );

  return [{ role: "system", content: lines.join("\n") }];
}

/**
 * Parse LLM output for session-control signals.
 */
export function extractSessionUpdates(output: string): {
  contextUpdates: Record<string, string>;
  sessionComplete: boolean;
} {
  const contextUpdates: Record<string, string> = {};
  let sessionComplete = false;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();

    const ctxMatch = trimmed.match(/^SESSION_CONTEXT:\s*(.+?)=(.+)$/);
    if (ctxMatch) {
      contextUpdates[ctxMatch[1].trim()] = ctxMatch[2].trim();
    }

    if (trimmed === "SESSION_COMPLETE") {
      sessionComplete = true;
    }
  }

  return { contextUpdates, sessionComplete };
}

/**
 * Produce a short (≤500 char) summary of an execution for session history.
 */
export function summarizeExecution(
  activity: ActivityEntry[],
  result: string
): string {
  const parts: string[] = [];

  // Extract first 3 tool_call / tool_result entries
  const relevant = activity
    .filter((a) => a.type === "tool_call" || a.type === "tool_result")
    .slice(0, 3);

  for (const entry of relevant) {
    parts.push(`${entry.type}: ${entry.detail}`);
  }

  // First sentence of result
  if (result) {
    const firstSentence = result.split(/[.\n]/)[0].trim();
    if (firstSentence) parts.push(firstSentence);
  }

  const summary = parts.join(" | ");
  return summary.length > 500 ? summary.slice(0, 497) + "..." : summary;
}

// ── DB helpers ─────────────────────────────────────────

/**
 * Load an existing session or create a new one.
 * Returns null when neither sessionId nor goal are provided.
 */
export async function getOrCreateSession(
  pool: Pool,
  workerId: string,
  tenantId: string,
  opts?: { sessionId?: string; goal?: string }
): Promise<Session | null> {
  if (opts?.sessionId) {
    const { rows } = await pool.query(
      "SELECT * FROM worker_sessions WHERE id = $1",
      [opts.sessionId]
    );
    return (rows[0] as Session) ?? null;
  }

  if (opts?.goal) {
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO worker_sessions (id, worker_id, tenant_id, goal)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, workerId, tenantId, opts.goal]
    );
    return rows[0] as Session;
  }

  return null;
}

/**
 * Load a session from the DB and return prompt messages.
 */
export async function loadSessionMessages(
  pool: Pool,
  sessionId: string
): Promise<Message[]> {
  const { rows } = await pool.query(
    "SELECT * FROM worker_sessions WHERE id = $1",
    [sessionId]
  );
  if (!rows[0]) return [];
  return buildSessionMessages(rows[0] as Session);
}

/**
 * Update session state after an execution completes.
 */
export async function updateSessionAfterExecution(
  pool: Pool,
  sessionId: string,
  execution: { id: string; result: string; activity: ActivityEntry[] }
): Promise<void> {
  const { contextUpdates, sessionComplete } = extractSessionUpdates(
    execution.result
  );
  const historyEntry: SessionHistoryEntry = {
    execution_id: execution.id,
    ts: new Date().toISOString(),
    summary: summarizeExecution(execution.activity, execution.result),
  };

  const setClauses = [
    "context = context || $2::jsonb",
    "history = history || $3::jsonb",
    "updated_at = now()",
  ];
  const params: unknown[] = [
    sessionId,
    JSON.stringify(contextUpdates),
    JSON.stringify(historyEntry),
  ];

  if (sessionComplete) {
    setClauses.push("status = 'completed'");
  }

  await pool.query(
    `UPDATE worker_sessions SET ${setClauses.join(", ")} WHERE id = $1`,
    params
  );
}

/**
 * List active sessions for a worker.
 */
export async function listActiveSessions(
  pool: Pool,
  workerId: string
): Promise<Session[]> {
  const { rows } = await pool.query(
    "SELECT * FROM worker_sessions WHERE worker_id = $1 AND status = 'active' ORDER BY updated_at DESC",
    [workerId]
  );
  return rows as Session[];
}

/**
 * Mark a session as completed.
 */
export async function completeSession(
  pool: Pool,
  sessionId: string
): Promise<void> {
  await pool.query(
    "UPDATE worker_sessions SET status = 'completed', updated_at = now() WHERE id = $1",
    [sessionId]
  );
}
