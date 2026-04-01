/**
 * Charter Evolution — surfaces promotion / demotion proposals for human review.
 *
 * The learning loop analyses recent executions, approvals, and signals to
 * recommend charter changes.  Humans approve or reject; neverDo rules are
 * immutable.
 */

import { analyzePromotionCandidates, summarizeSignals } from "./trust-learning.js";

// ── helpers ────────────────────────────────────────────

function makeId(): string {
  return `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseCharter(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

// ── generateProposals ──────────────────────────────────

export async function generateProposals(
  pool: any,
  workerId: string,
  tenantId: string,
) {
  // 1. Load worker
  const { rows: workerRows } = await pool.query(
    "SELECT charter, trust_level FROM workers WHERE id = $1",
    [workerId],
  );
  if (workerRows.length === 0) throw new Error(`Worker ${workerId} not found`);
  const charter = parseCharter(workerRows[0].charter);

  // 2. Load recent executions
  const { rows: executions } = await pool.query(
    `SELECT * FROM worker_executions WHERE worker_id = $1
       AND started_at > now() - interval '30 days'
     ORDER BY started_at DESC LIMIT 200`,
    [workerId],
  );

  // 3. Load recent approvals
  const { rows: approvals } = await pool.query(
    `SELECT * FROM worker_approvals WHERE worker_id = $1
       AND decided_at > now() - interval '30 days'
     ORDER BY decided_at DESC LIMIT 200`,
    [workerId],
  );

  // 4. Load recent signals
  const { rows: signals } = await pool.query(
    `SELECT * FROM learning_signals WHERE worker_id = $1
       AND created_at > now() - interval '30 days'
     ORDER BY created_at DESC LIMIT 500`,
    [workerId],
  );

  const created: any[] = [];

  // ── Promotion candidates ─────────────────────────────
  const candidates = analyzePromotionCandidates({
    charter,
    executions,
    approvals,
  });

  for (const candidate of candidates) {
    if (candidate.confidence < 0.7) continue;

    const { rows: existing } = await pool.query(
      `SELECT id FROM charter_proposals
       WHERE worker_id = $1 AND rule_text = $2 AND status = 'pending'`,
      [workerId, candidate.action],
    );
    if (existing.length > 0) continue;

    const id = makeId();
    await pool.query(
      `INSERT INTO charter_proposals
         (id, worker_id, tenant_id, status, proposal_type, tool_name,
          from_level, to_level, rule_text, confidence, evidence)
       VALUES ($1,$2,$3,'pending','promote',NULL,'askFirst','canDo',$4,$5,$6)`,
      [id, workerId, tenantId, candidate.action, candidate.confidence, JSON.stringify(candidate.evidence)],
    );
    created.push({ id, proposal_type: "promote", rule_text: candidate.action, confidence: candidate.confidence });
  }

  // ── Demotion candidates ──────────────────────────────
  const canDoRules = Array.isArray(charter.canDo) ? (charter.canDo as string[]) : [];

  // Group signals by tool_name where charter_verdict = 'canDo'
  const failuresByTool = new Map<string, { count: number; tool_name: string }>();
  for (const signal of signals) {
    if (signal.charter_verdict !== "canDo") continue;
    if (signal.tool_success !== false) continue;
    const toolName = signal.tool_name || "unknown";
    const entry = failuresByTool.get(toolName) || { count: 0, tool_name: toolName };
    entry.count += 1;
    failuresByTool.set(toolName, entry);
  }

  for (const [toolName, { count }] of failuresByTool) {
    if (count < 3) continue;

    // Find a matching canDo rule for this tool (use tool_name as rule_text)
    const ruleText = toolName;

    const { rows: existing } = await pool.query(
      `SELECT id FROM charter_proposals
       WHERE worker_id = $1 AND rule_text = $2 AND status = 'pending'`,
      [workerId, ruleText],
    );
    if (existing.length > 0) continue;

    const confidence = Math.min(0.99, 0.6 + count * 0.05);
    const id = makeId();
    await pool.query(
      `INSERT INTO charter_proposals
         (id, worker_id, tenant_id, status, proposal_type, tool_name,
          from_level, to_level, rule_text, confidence, evidence)
       VALUES ($1,$2,$3,'pending','demote',$4,'canDo','askFirst',$5,$6,$7)`,
      [id, workerId, tenantId, toolName, ruleText, confidence, JSON.stringify({ failureCount: count, lookbackDays: 30 })],
    );
    created.push({ id, proposal_type: "demote", rule_text: ruleText, confidence });
  }

  return created;
}

// ── applyProposal ──────────────────────────────────────

export async function applyProposal(
  pool: any,
  proposalId: string,
  decidedBy: string,
) {
  // 1. Load proposal
  const { rows: proposalRows } = await pool.query(
    "SELECT * FROM charter_proposals WHERE id = $1 AND status = 'pending'",
    [proposalId],
  );
  if (proposalRows.length === 0) throw new Error(`Pending proposal ${proposalId} not found`);
  const proposal = proposalRows[0];

  // 2. Immutability check
  if (proposal.from_level === "neverDo" || proposal.to_level === "neverDo") {
    throw new Error("Cannot modify neverDo rules");
  }

  // 3. Load worker charter
  const { rows: workerRows } = await pool.query(
    "SELECT charter FROM workers WHERE id = $1",
    [proposal.worker_id],
  );
  if (workerRows.length === 0) throw new Error(`Worker ${proposal.worker_id} not found`);
  const charter = parseCharter(workerRows[0].charter);

  // 4. Mutate charter
  if (proposal.proposal_type === "promote") {
    // askFirst -> canDo
    const askFirst = Array.isArray(charter.askFirst) ? [...(charter.askFirst as string[])] : [];
    const canDo = Array.isArray(charter.canDo) ? [...(charter.canDo as string[])] : [];
    charter.askFirst = askFirst.filter((r: string) => r !== proposal.rule_text);
    if (!canDo.includes(proposal.rule_text)) canDo.push(proposal.rule_text);
    charter.canDo = canDo;
  } else if (proposal.proposal_type === "demote") {
    // canDo -> askFirst
    const canDo = Array.isArray(charter.canDo) ? [...(charter.canDo as string[])] : [];
    const askFirst = Array.isArray(charter.askFirst) ? [...(charter.askFirst as string[])] : [];
    charter.canDo = canDo.filter((r: string) => r !== proposal.rule_text);
    if (!askFirst.includes(proposal.rule_text)) askFirst.push(proposal.rule_text);
    charter.askFirst = askFirst;
  }

  // 5. Persist
  await pool.query(
    "UPDATE workers SET charter = $2, updated_at = now() WHERE id = $1",
    [proposal.worker_id, JSON.stringify(charter)],
  );
  await pool.query(
    "UPDATE charter_proposals SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1",
    [proposalId, decidedBy],
  );

  return charter;
}

// ── rejectProposal ─────────────────────────────────────

export async function rejectProposal(
  pool: any,
  proposalId: string,
  decidedBy: string,
) {
  const { rowCount } = await pool.query(
    "UPDATE charter_proposals SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1 AND status = 'pending'",
    [proposalId, decidedBy],
  );
  return (rowCount ?? 0) > 0;
}

// ── listPendingProposals ───────────────────────────────

export async function listPendingProposals(pool: any, workerId: string) {
  const { rows } = await pool.query(
    "SELECT * FROM charter_proposals WHERE worker_id = $1 AND status = 'pending' ORDER BY confidence DESC",
    [workerId],
  );
  return rows;
}
