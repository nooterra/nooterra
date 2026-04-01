/**
 * Meta-Agent — fleet intelligence module.
 *
 * The meta-agent is a privileged worker that monitors and manages the worker
 * fleet. Its charter is hardcoded and immutable. It runs as a regular worker
 * in the runtime but has special management tools.
 */

import { generateProposals } from "./charter-evolution.ts";
import type { ToolDefinition } from "./types.ts";

// ── Types ─────────────────────────────────────────────

export interface FleetDigest {
  tenantId: string;
  generatedAt: string;
  workers: {
    id: string;
    name: string;
    status: string;
    trustLevel: string;
    competence: { taskType: string; score: number }[];
    last24h: { runs: number; successes: number; failures: number; costUsd: number };
  }[];
  anomalies: {
    workerId: string;
    workerName: string;
    type: string;
    severity: string;
    detail: string;
  }[];
  pendingProposals: number;
  totalDailySpend: number;
}

// ── Charter (immutable) ───────────────────────────────

export const META_AGENT_CHARTER = {
  role: "Nooterra Fleet Manager",
  goal: "Monitor worker fleet health, propose optimizations, manage worker lifecycle within trust boundaries.",
  instructions: "You are the fleet intelligence agent. You monitor worker performance, detect anomalies, and take management actions. You CANNOT modify your own charter. You MUST explain your reasoning for every management action.",
  canDo: [
    "Read worker stats and competence scores",
    "Read fleet health metrics",
    "Generate charter change proposals",
    "Create new workers from templates",
    "Emit operational alerts",
  ],
  askFirst: [
    "Pause underperforming workers",
    "Modify worker charters",
    "Deploy new workers to production",
  ],
  neverDo: [
    "Modify own charter or permissions",
    "Delete workers permanently",
    "Access raw tenant data or credentials",
    "Bypass approval requirements",
  ],
} as const;

// ── Helpers ───────────────────────────────────────────

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── isMetaAgent ───────────────────────────────────────

export function isMetaAgent(worker: any): boolean {
  return worker?.charter?.role === "Nooterra Fleet Manager";
}

// ── buildFleetDigest ──────────────────────────────────

export async function buildFleetDigest(pool: any, tenantId: string): Promise<FleetDigest> {
  // 1. Load all active workers
  const { rows: workers } = await pool.query(
    `SELECT id, name, status, trust_level, trust_score
     FROM workers
     WHERE tenant_id = $1 AND status != 'archived'`,
    [tenantId],
  );

  // 2. For each worker, load competence entries
  const workerDigests = await Promise.all(
    workers.map(async (w: any) => {
      const { rows: competenceRows } = await pool.query(
        `SELECT * FROM worker_competence WHERE worker_id = $1`,
        [w.id],
      );

      return {
        id: w.id,
        name: w.name,
        status: w.status,
        trustLevel: w.trust_level || "unknown",
        competence: competenceRows.map((c: any) => ({
          taskType: c.task_type,
          score: c.score,
        })),
        last24h: { runs: 0, successes: 0, failures: 0, costUsd: 0 },
      };
    }),
  );

  // 3. Load recent executions (last 24h)
  const { rows: executions } = await pool.query(
    `SELECT worker_id, status, cost_usd
     FROM worker_executions
     WHERE tenant_id = $1 AND started_at > now() - interval '24 hours'`,
    [tenantId],
  );

  // Accumulate per-worker stats
  let totalDailySpend = 0;
  for (const exec of executions) {
    const cost = parseFloat(exec.cost_usd) || 0;
    totalDailySpend += cost;
    const wd = workerDigests.find((w) => w.id === exec.worker_id);
    if (wd) {
      wd.last24h.runs++;
      if (exec.status === "completed" || exec.status === "shadow_completed") {
        wd.last24h.successes++;
      } else if (exec.status === "failed") {
        wd.last24h.failures++;
      }
      wd.last24h.costUsd += cost;
    }
  }

  // 4. Load pending proposals
  const { rows: proposals } = await pool.query(
    `SELECT * FROM charter_proposals WHERE tenant_id = $1 AND status = 'pending'`,
    [tenantId],
  );

  // 5. Detect anomalies
  const anomalies: FleetDigest["anomalies"] = [];

  for (const wd of workerDigests) {
    // >50% failure rate in last 24h
    if (wd.last24h.runs > 0 && wd.last24h.failures / wd.last24h.runs > 0.5) {
      anomalies.push({
        workerId: wd.id,
        workerName: wd.name,
        type: "degraded",
        severity: "critical",
        detail: `${wd.last24h.failures}/${wd.last24h.runs} executions failed in the last 24h (${Math.round((wd.last24h.failures / wd.last24h.runs) * 100)}% failure rate)`,
      });
    }

    // Competence score < 30
    for (const c of wd.competence) {
      if (c.score < 30) {
        anomalies.push({
          workerId: wd.id,
          workerName: wd.name,
          type: "underperforming",
          severity: "warning",
          detail: `Competence score for "${c.taskType}" is ${c.score} (threshold: 30)`,
        });
      }
    }
  }

  // Idle workers: active but 0 runs in last 7 days
  const { rows: recentRunners } = await pool.query(
    `SELECT DISTINCT worker_id FROM worker_executions
     WHERE tenant_id = $1 AND started_at > now() - interval '7 days'`,
    [tenantId],
  );
  const recentRunnerIds = new Set(recentRunners.map((r: any) => r.worker_id));
  for (const wd of workerDigests) {
    if (wd.status === "active" && !recentRunnerIds.has(wd.id)) {
      anomalies.push({
        workerId: wd.id,
        workerName: wd.name,
        type: "idle",
        severity: "info",
        detail: "Worker is active but has 0 runs in the last 7 days",
      });
    }
  }

  // Budget warning (threshold: $50/day — configurable later)
  if (totalDailySpend > 50) {
    anomalies.push({
      workerId: "",
      workerName: "",
      type: "budget_warning",
      severity: "warning",
      detail: `Total daily spend is $${totalDailySpend.toFixed(2)} (threshold: $50.00)`,
    });
  }

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    workers: workerDigests,
    anomalies,
    pendingProposals: proposals.length,
    totalDailySpend,
  };
}

// ── getMetaAgentTools ─────────────────────────────────

export function getMetaAgentTools(_pool: any, _tenantId: string): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "__read_fleet_digest",
        description: "Returns a comprehensive fleet health digest including worker stats, anomalies, and pending proposals.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "__read_worker_stats",
        description: "Returns competence scores and recent execution stats for a specific worker.",
        parameters: {
          type: "object",
          properties: {
            worker_id: { type: "string", description: "The worker ID to inspect" },
          },
          required: ["worker_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "__generate_proposals",
        description: "Triggers charter change proposal generation for a specific worker based on its execution history.",
        parameters: {
          type: "object",
          properties: {
            worker_id: { type: "string", description: "The worker ID to generate proposals for" },
          },
          required: ["worker_id"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "__create_worker",
        description: "Creates a new worker with status 'paused' (requires human activation). Returns the new worker record.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Worker name" },
            description: { type: "string", description: "Worker description" },
            charter: { type: "object", description: "Worker charter object" },
            model: { type: "string", description: "Model identifier (default: openai/gpt-4o-mini)" },
          },
          required: ["name", "description", "charter"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "__pause_worker",
        description: "Pauses a worker, preventing it from executing. Requires a reason for audit trail.",
        parameters: {
          type: "object",
          properties: {
            worker_id: { type: "string", description: "The worker ID to pause" },
            reason: { type: "string", description: "Reason for pausing this worker" },
          },
          required: ["worker_id", "reason"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "__emit_alert",
        description: "Emits an operational alert for the fleet dashboard.",
        parameters: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["critical", "warning", "info"], description: "Alert severity level" },
            message: { type: "string", description: "Alert message" },
            worker_id: { type: "string", description: "Optional worker ID this alert relates to" },
          },
          required: ["severity", "message"],
        },
      },
    },
  ];
}

// ── executeMetaAgentTool ──────────────────────────────

export async function executeMetaAgentTool(
  pool: any,
  tenantId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<{ success: boolean; result: unknown }> {
  switch (toolName) {
    case "__read_fleet_digest": {
      const digest = await buildFleetDigest(pool, tenantId);
      return { success: true, result: digest };
    }

    case "__read_worker_stats": {
      const workerId = toolArgs.worker_id as string;
      if (!workerId) return { success: false, result: "worker_id is required" };

      const { rows: workerRows } = await pool.query(
        `SELECT id, name, status, trust_level, trust_score FROM workers WHERE id = $1 AND tenant_id = $2`,
        [workerId, tenantId],
      );
      if (workerRows.length === 0) return { success: false, result: "Worker not found" };

      const { rows: competence } = await pool.query(
        `SELECT * FROM worker_competence WHERE worker_id = $1`,
        [workerId],
      );

      const { rows: recentExecs } = await pool.query(
        `SELECT status, cost_usd, started_at FROM worker_executions
         WHERE worker_id = $1 AND tenant_id = $2 AND started_at > now() - interval '24 hours'
         ORDER BY started_at DESC`,
        [workerId, tenantId],
      );

      const stats = {
        worker: workerRows[0],
        competence,
        recentExecutions: {
          count: recentExecs.length,
          successes: recentExecs.filter((e: any) => e.status === "completed" || e.status === "shadow_completed").length,
          failures: recentExecs.filter((e: any) => e.status === "failed").length,
          totalCost: recentExecs.reduce((sum: number, e: any) => sum + (parseFloat(e.cost_usd) || 0), 0),
        },
      };
      return { success: true, result: stats };
    }

    case "__generate_proposals": {
      const workerId = toolArgs.worker_id as string;
      if (!workerId) return { success: false, result: "worker_id is required" };
      const proposals = await generateProposals(pool, workerId, tenantId);
      return { success: true, result: proposals };
    }

    case "__create_worker": {
      const name = toolArgs.name as string;
      const description = toolArgs.description as string;
      const charter = toolArgs.charter as Record<string, unknown>;
      const model = (toolArgs.model as string) || "openai/gpt-4o-mini";

      if (!name || !charter) return { success: false, result: "name and charter are required" };

      const id = makeId("wrk");
      const now = new Date().toISOString();
      const { rows } = await pool.query(
        `INSERT INTO workers (id, tenant_id, name, description, charter, model, status, provider_mode, knowledge, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'paused', 'platform', '[]', $7, $8) RETURNING *`,
        [id, tenantId, name, description || null, JSON.stringify(charter), model, now, now],
      );
      return { success: true, result: rows[0] };
    }

    case "__pause_worker": {
      const workerId = toolArgs.worker_id as string;
      const reason = toolArgs.reason as string;
      if (!workerId || !reason) return { success: false, result: "worker_id and reason are required" };

      const { rowCount } = await pool.query(
        `UPDATE workers SET status = 'paused', updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [workerId, tenantId],
      );
      if (rowCount === 0) return { success: false, result: "Worker not found" };
      console.log(`[meta-agent] Paused worker ${workerId}: ${reason}`);
      return { success: true, result: { workerId, status: "paused", reason } };
    }

    case "__emit_alert": {
      const severity = toolArgs.severity as string;
      const message = toolArgs.message as string;
      const alertWorkerId = toolArgs.worker_id as string | undefined;
      if (!severity || !message) return { success: false, result: "severity and message are required" };

      const alert = {
        id: makeId("alert"),
        tenantId,
        severity,
        message,
        workerId: alertWorkerId || null,
        createdAt: new Date().toISOString(),
      };
      console.log(`[meta-agent] Alert [${severity}]: ${message}${alertWorkerId ? ` (worker: ${alertWorkerId})` : ""}`);
      return { success: true, result: alert };
    }

    default:
      return { success: false, result: `Unknown meta-agent tool: ${toolName}` };
  }
}

// ── ensureMetaAgent ───────────────────────────────────

export async function ensureMetaAgent(pool: any, tenantId: string): Promise<string> {
  // Check if meta-agent already exists
  const { rows } = await pool.query(
    `SELECT id FROM workers WHERE tenant_id = $1 AND charter->>'role' = 'Nooterra Fleet Manager'`,
    [tenantId],
  );
  if (rows.length > 0) return rows[0].id;

  // Create the meta-agent
  const id = makeId("wrk");
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO workers (id, tenant_id, name, description, charter, model, status, schedule, provider_mode, knowledge, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, 'platform', '[]', $8, $9)`,
    [
      id,
      tenantId,
      "Fleet Manager",
      "Meta-agent that monitors worker fleet health, detects anomalies, and manages worker lifecycle.",
      JSON.stringify(META_AGENT_CHARTER),
      "openai/gpt-4o-mini",
      JSON.stringify({ cron: "0 * * * *" }), // hourly
      now,
      now,
    ],
  );

  return id;
}
