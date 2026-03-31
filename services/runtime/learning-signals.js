import crypto from 'node:crypto';

export function buildSignalId(executionId, toolName, args) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ executionId, toolName, args }))
    .digest('hex')
    .slice(0, 16);
  return `sig_${hash}`;
}

function hashArgs(args) {
  if (!args || typeof args !== 'object') return null;
  return crypto.createHash('sha256')
    .update(JSON.stringify(args))
    .digest('hex')
    .slice(0, 16);
}

export function buildSignalsFromExecution({
  executionId, workerId, tenantId,
  toolResults = [], blockedActions = [],
  executionOutcome = 'success',
  interruptionCode = null,
}) {
  const signals = [];

  for (const tr of toolResults) {
    signals.push({
      id: buildSignalId(executionId, tr.name, tr.args),
      tenant_id: tenantId,
      worker_id: workerId,
      execution_id: executionId,
      tool_name: tr.name,
      args_hash: hashArgs(tr.args),
      charter_verdict: tr.charterVerdict || 'canDo',
      approval_decision: tr.approvalDecision || null,
      matched_rule: tr.matchedRule || null,
      tool_success: tr.success !== false,
      interruption_code: interruptionCode || null,
      execution_outcome: executionOutcome,
    });
  }

  for (const ba of blockedActions) {
    signals.push({
      id: buildSignalId(executionId, ba.tool, ba.args),
      tenant_id: tenantId,
      worker_id: workerId,
      execution_id: executionId,
      tool_name: ba.tool,
      args_hash: hashArgs(ba.args),
      charter_verdict: 'neverDo',
      approval_decision: null,
      matched_rule: ba.rule || null,
      tool_success: false,
      interruption_code: interruptionCode || null,
      execution_outcome: 'blocked',
    });
  }

  return signals;
}

export async function persistSignals(pool, signals) {
  if (!signals.length) return;
  const values = [];
  const params = [];
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const offset = i * 13;
    values.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},$${offset+12},$${offset+13})`);
    params.push(s.id, s.tenant_id, s.worker_id, s.execution_id, s.tool_name,
                s.args_hash, s.charter_verdict, s.approval_decision, s.matched_rule,
                s.tool_success, s.interruption_code, s.execution_outcome, new Date().toISOString());
  }
  await pool.query(
    `INSERT INTO learning_signals (id, tenant_id, worker_id, execution_id, tool_name, args_hash, charter_verdict, approval_decision, matched_rule, tool_success, interruption_code, execution_outcome, created_at)
     VALUES ${values.join(',')}
     ON CONFLICT (id) DO NOTHING`,
    params
  );
}

export async function querySignalsForWorker(pool, workerId, tenantId, { limit = 500, lookbackDays = 30 } = {}) {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await pool.query(
    `SELECT tool_name, args_hash, charter_verdict, approval_decision, matched_rule, tool_success, interruption_code, execution_outcome, created_at
     FROM learning_signals
     WHERE worker_id = $1 AND tenant_id = $2 AND created_at >= $3
     ORDER BY created_at DESC LIMIT $4`,
    [workerId, tenantId, cutoff, limit]
  );
  return result.rows;
}
