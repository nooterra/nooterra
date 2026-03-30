/**
 * Worker CRUD API
 *
 * Ported from src/api/workers.js into the scheduler service.
 * Handles all /v1/workers/* routes with raw Node.js HTTP.
 */

import crypto from 'node:crypto';
import { validateCharterRules } from './charter-enforcement.js';
import { presignS3Url } from '../../src/core/s3-presign.js';

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function getTenantId(req) {
  const h = req.headers['x-tenant-id'];
  if (h && h.trim()) return h.trim();
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)tenant_id=([^;]+)/);
  if (m) return decodeURIComponent(m[1]).trim() || null;
  return null;
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) {
      req.destroy();
      return null;
    }
  }
  try { return JSON.parse(body); } catch { return null; }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function err(res, status, msg) {
  json(res, status, { error: msg });
}

const VALID_STATUSES = new Set(['ready', 'running', 'paused', 'error', 'archived']);
const UPDATABLE = new Set(['name', 'description', 'charter', 'schedule', 'model', 'status', 'knowledge', 'triggers', 'provider_mode', 'byok_provider', 'chain']);
const JSON_FIELDS = new Set(['charter', 'schedule', 'knowledge', 'triggers', 'chain']);

/**
 * Handle a /v1/workers* request. Returns true if handled, false if not matched.
 */
export async function handleWorkerRoute(req, res, pool, pathname, searchParams) {
  const method = req.method;

  // POST /v1/workers — create
  if (method === 'POST' && pathname === '/v1/workers') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (!body.name?.trim()) return err(res, 400, 'name is required'), true;

    // Validate charter rules for prompt injection
    if (body.charter) {
      const parsedCharter = typeof body.charter === 'string' ? JSON.parse(body.charter) : body.charter;
      const validation = validateCharterRules(parsedCharter);
      if (!validation.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid charter rules', details: validation.errors }));
        return true;
      }
    }

    const id = generateId('wrk');
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO workers (id, tenant_id, name, description, charter, schedule, model, provider_mode, byok_provider, knowledge, triggers, chain, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [id, tid, body.name.trim(), body.description ?? null,
       JSON.stringify(body.charter ?? {}), body.schedule ? JSON.stringify(body.schedule) : null,
       body.model ?? 'google/gemini-2.5-flash', body.provider_mode ?? 'platform',
       body.byok_provider ?? null, JSON.stringify(body.knowledge ?? []),
       JSON.stringify(body.triggers ?? []), body.chain ? JSON.stringify(body.chain) : null, now, now]
    );
    return json(res, 201, { worker: result.rows[0] }), true;
  }

  // GET /v1/workers — list
  if (method === 'GET' && pathname === '/v1/workers') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const status = searchParams.get('status');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50') || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0') || 0, 0);

    let q, p;
    if (status && VALID_STATUSES.has(status)) {
      q = `SELECT * FROM workers WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
      p = [tid, status, limit, offset];
    } else {
      q = `SELECT * FROM workers WHERE tenant_id = $1 AND status != 'archived' ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      p = [tid, limit, offset];
    }
    const result = await pool.query(q, p);
    return json(res, 200, { workers: result.rows, count: result.rowCount }), true;
  }

  // GET /v1/workers/:id
  const idMatch = pathname.match(/^\/v1\/workers\/([^/]+)$/);
  if (method === 'GET' && idMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const result = await pool.query(`SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`, [idMatch[1], tid]);
    if (result.rowCount === 0) return err(res, 404, 'worker not found'), true;
    return json(res, 200, { worker: result.rows[0] }), true;
  }

  // PUT /v1/workers/:id — update
  if (method === 'PUT' && idMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) return err(res, 400, `invalid status: ${body.status}`), true;

    // Save current state as a version before applying updates
    try {
      const current = await pool.query(`SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`, [idMatch[1], tid]);
      if (current.rowCount > 0) {
        const lastVersion = await pool.query(
          `SELECT COALESCE(MAX(version), 0) AS max_v FROM worker_versions WHERE worker_id = $1`, [idMatch[1]]
        );
        const nextVersion = (lastVersion.rows[0].max_v || 0) + 1;
        const row = current.rows[0];
        await pool.query(
          `INSERT INTO worker_versions (id, worker_id, tenant_id, version, config, created_at, created_by)
           VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
          [generateId('wver'), idMatch[1], tid, nextVersion, JSON.stringify(row), tid]
        );
      }
    } catch { /* versioning is best-effort, don't block the update */ }

    const sets = [], vals = [];
    let pi = 1;
    for (const f of UPDATABLE) {
      if (body[f] !== undefined) {
        sets.push(`${f} = $${pi}`);
        vals.push(JSON_FIELDS.has(f) ? JSON.stringify(body[f]) : body[f]);
        pi++;
      }
    }
    if (sets.length === 0) return err(res, 400, 'no updatable fields'), true;
    sets.push(`updated_at = $${pi}`); vals.push(new Date().toISOString()); pi++;
    vals.push(idMatch[1], tid);

    const result = await pool.query(
      `UPDATE workers SET ${sets.join(', ')} WHERE id = $${pi} AND tenant_id = $${pi + 1} RETURNING *`, vals
    );
    if (result.rowCount === 0) return err(res, 404, 'worker not found'), true;
    return json(res, 200, { worker: result.rows[0] }), true;
  }

  // DELETE /v1/workers/:id — archive
  if (method === 'DELETE' && idMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const result = await pool.query(
      `UPDATE workers SET status = 'archived', updated_at = $1 WHERE id = $2 AND tenant_id = $3 AND status != 'archived' RETURNING *`,
      [new Date().toISOString(), idMatch[1], tid]
    );
    if (result.rowCount === 0) return err(res, 404, 'worker not found'), true;
    return json(res, 200, { worker: result.rows[0] }), true;
  }

  // POST /v1/workers/:id/run — manual trigger
  const runMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/run$/);
  if (method === 'POST' && runMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wr = await pool.query(`SELECT id, model, status FROM workers WHERE id = $1 AND tenant_id = $2`, [runMatch[1], tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    if (wr.rows[0].status === 'archived') return err(res, 409, 'cannot run archived worker'), true;
    if (wr.rows[0].status === 'paused') return err(res, 409, 'cannot run paused worker'), true;

    const body = await readBody(req);
    const isShadow = searchParams.get('shadow') === 'true' || body?.shadow === true;
    const triggerType = isShadow ? 'shadow' : 'manual';

    const execId = generateId('exec');
    const result = await pool.query(
      `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at) VALUES ($1,$2,$3,$4,'queued',$5,$6) RETURNING *`,
      [execId, runMatch[1], tid, triggerType, wr.rows[0].model, new Date().toISOString()]
    );
    return json(res, 202, { execution: result.rows[0] }), true;
  }

  // GET /v1/workers/:id/logs — execution history
  const logsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/logs$/);
  if (method === 'GET' && logsMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50') || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0') || 0, 0);
    const status = searchParams.get('status');

    let q, p;
    if (status) {
      q = `SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 AND status = $3 ORDER BY started_at DESC LIMIT $4 OFFSET $5`;
      p = [logsMatch[1], tid, status, limit, offset];
    } else {
      q = `SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY started_at DESC LIMIT $3 OFFSET $4`;
      p = [logsMatch[1], tid, limit, offset];
    }
    const result = await pool.query(q, p);
    return json(res, 200, { executions: result.rows, count: result.rowCount }), true;
  }

  // POST /v1/workers/:id/trigger — webhook trigger
  // POST /v1/workers/:id/trigger/test — manual test trigger
  const trigMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/trigger(\/test)?$/);
  if (method === 'POST' && trigMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const isTest = trigMatch[2] === '/test';
    const wr = await pool.query(`SELECT id, model, status, triggers FROM workers WHERE id = $1 AND tenant_id = $2`, [trigMatch[1], tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    const worker = wr.rows[0];
    if (worker.status !== 'ready' && worker.status !== 'running') {
      return err(res, 409, `cannot trigger worker in '${worker.status}' status`), true;
    }

    // Validate webhook secret if configured
    const triggers = typeof worker.triggers === 'string' ? JSON.parse(worker.triggers) : (worker.triggers || {});
    const webhookSecret = triggers.webhookSecret || (Array.isArray(triggers) ? null : triggers?.webhookSecret);
    if (webhookSecret && !isTest) {
      const providedSecret = req.headers['x-webhook-secret'] || '';
      const expected = webhookSecret || '';
      const secretMatch = providedSecret.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expected));
      if (!secretMatch) {
        return err(res, 403, 'invalid or missing webhook secret'), true;
      }
    }

    const body = await readBody(req);
    const payload = body?.payload || null;
    const triggerType = isTest ? 'manual_test' : 'webhook';

    const execId = generateId('exec');
    const initialActivity = payload
      ? [{ ts: new Date().toISOString(), type: 'webhook_payload', detail: JSON.stringify(payload).slice(0, 10000) }]
      : [];
    const result = await pool.query(
      `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at, activity)
       VALUES ($1,$2,$3,$4,'queued',$5,$6,$7::jsonb) RETURNING *`,
      [execId, trigMatch[1], tid, triggerType, worker.model, new Date().toISOString(), JSON.stringify(initialActivity)]
    );
    return json(res, 202, { ok: true, executionId: execId, execution: result.rows[0] }), true;
  }

  // GET /v1/workers/:id/feed — SSE activity feed
  const feedMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/feed$/);
  if (method === 'GET' && feedMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [feedMatch[1], tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const recent = await pool.query(`SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY started_at DESC LIMIT 10`, [feedMatch[1], tid]);
    res.write(`event: snapshot\ndata: ${JSON.stringify({ executions: recent.rows })}\n\n`);

    const lastSeen = { v: new Date().toISOString() };
    const poll = setInterval(async () => {
      try {
        const nw = await pool.query(`SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 AND started_at > $3 ORDER BY started_at ASC`, [feedMatch[1], tid, lastSeen.v]);
        for (const r of nw.rows) res.write(`event: execution\ndata: ${JSON.stringify(r)}\n\n`);
        if (nw.rowCount > 0) lastSeen.v = nw.rows[nw.rowCount - 1].started_at;
      } catch {}
    }, 2000);
    const ka = setInterval(() => { try { res.write(':keepalive\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(poll); clearInterval(ka); });
    return true;
  }

  // GET /v1/workers/:id/executions/:execId/stream — SSE execution streaming
  const streamMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/executions\/([^/]+)\/stream$/);
  if (method === 'GET' && streamMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const [, workerId, execId] = streamMatch;

    // Validate execution belongs to worker and tenant
    const execResult = await pool.query(
      `SELECT * FROM worker_executions WHERE id = $1 AND worker_id = $2 AND tenant_id = $3`,
      [execId, workerId, tid]
    );
    if (execResult.rowCount === 0) return err(res, 404, 'execution not found'), true;

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send current state immediately
    const exec = execResult.rows[0];
    const currentActivity = typeof exec.activity === 'string' ? JSON.parse(exec.activity) : (exec.activity || []);
    res.write(`data: ${JSON.stringify({ type: 'status', status: exec.status, executionId: execId })}\n\n`);
    for (const entry of currentActivity) {
      res.write(`data: ${JSON.stringify({ type: 'activity', entry })}\n\n`);
    }

    // If already completed, send final event and close
    const TERMINAL_STATUSES = new Set(['completed', 'failed', 'shadow_completed', 'charter_blocked', 'budget_exceeded', 'auto_paused', 'error']);
    if (TERMINAL_STATUSES.has(exec.status)) {
      res.write(`data: ${JSON.stringify({ type: 'complete', status: exec.status, result: exec.result?.slice(0, 10000) || null })}\n\n`);
      res.end();
      return true;
    }

    // Poll for new activity entries and status changes
    let lastActivityCount = currentActivity.length;
    let lastStatus = exec.status;
    let closed = false;

    const pollInterval = setInterval(async () => {
      if (closed) return;
      try {
        const updated = await pool.query(
          `SELECT status, activity, result, error FROM worker_executions WHERE id = $1`,
          [execId]
        );
        if (updated.rowCount === 0) { clearIntervals(); return; }
        const row = updated.rows[0];
        const activity = typeof row.activity === 'string' ? JSON.parse(row.activity) : (row.activity || []);

        // Send status change
        if (row.status !== lastStatus) {
          lastStatus = row.status;
          res.write(`data: ${JSON.stringify({ type: 'status', status: row.status })}\n\n`);
        }

        // Send new activity entries
        if (activity.length > lastActivityCount) {
          const newEntries = activity.slice(lastActivityCount);
          for (const entry of newEntries) {
            res.write(`data: ${JSON.stringify({ type: 'activity', entry })}\n\n`);
          }
          lastActivityCount = activity.length;
        }

        // Check for completion
        if (TERMINAL_STATUSES.has(row.status)) {
          res.write(`data: ${JSON.stringify({ type: 'complete', status: row.status, result: row.result?.slice(0, 10000) || null, error: row.error || null })}\n\n`);
          clearIntervals();
          res.end();
        }
      } catch { /* ignore poll errors */ }
    }, 500);

    // Heartbeat every 15 seconds
    const heartbeatInterval = setInterval(() => {
      if (closed) return;
      try { res.write(`data: ${JSON.stringify({ type: 'heartbeat', ts: new Date().toISOString() })}\n\n`); } catch { /* ignore */ }
    }, 15000);

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify({ type: 'timeout', message: 'Stream timed out after 5 minutes' })}\n\n`);
      } catch { /* ignore */ }
      clearIntervals();
      res.end();
    }, 5 * 60 * 1000);

    function clearIntervals() {
      closed = true;
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
      clearTimeout(timeout);
    }

    req.on('close', () => { clearIntervals(); });
    return true;
  }

  // GET /v1/approvals/feed — SSE feed for approval inbox updates
  if (method === 'GET' && pathname === '/v1/approvals/feed') {
    const tenantId = getTenantId(req);
    if (!tenantId) { res.writeHead(401); res.end('Unauthorized'); return true; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial snapshot
    try {
      const result = await pool.query(
        `SELECT * FROM worker_approvals WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`,
        [tenantId]
      );
      res.write(`event: snapshot\ndata: ${JSON.stringify(result.rows)}\n\n`);
    } catch { res.write(`event: snapshot\ndata: []\n\n`); }

    // Poll for changes
    let lastCount = -1;
    const pollInterval = setInterval(async () => {
      try {
        const result = await pool.query(
          `SELECT COUNT(*)::int as count FROM worker_approvals WHERE tenant_id = $1 AND status = 'pending'`,
          [tenantId]
        );
        const count = result.rows[0]?.count || 0;
        if (count !== lastCount) {
          lastCount = count;
          const pending = await pool.query(
            `SELECT * FROM worker_approvals WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`,
            [tenantId]
          );
          res.write(`event: update\ndata: ${JSON.stringify({ count, items: pending.rows })}\n\n`);
        }
      } catch { /* ignore */ }
    }, 3000);

    // Keepalive
    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(pollInterval);
      clearInterval(keepalive);
    });

    return true;
  }

  // GET /v1/approvals — list pending approvals
  if (method === 'GET' && pathname === '/v1/approvals') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `SELECT wa.*, w.name as worker_name
         FROM worker_approvals wa
         LEFT JOIN workers w ON w.id = wa.worker_id AND w.tenant_id = wa.tenant_id
         WHERE wa.tenant_id = $1
         ORDER BY wa.created_at DESC LIMIT 50`,
        [tid]
      );
      return json(res, 200, { items: result.rows }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to fetch approvals'), true;
    }
  }

  // POST /v1/approvals/:id/approve — approve an action
  if (method === 'POST' && pathname.match(/^\/v1\/approvals\/[^/]+\/approve$/)) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const approvalId = pathname.split('/')[3];
    try {
      const result = await pool.query(
        `UPDATE worker_approvals SET status = 'approved', decided_by = $1, decided_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
         RETURNING id, worker_id, tool_name`,
        [tid, approvalId, tid]
      );
      if (result.rows.length === 0) return err(res, 404, 'approval not found or already decided'), true;
      // The NOTIFY trigger (from migration 035) will signal the scheduler to resume
      return json(res, 200, { ok: true, approval: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to approve'), true;
    }
  }

  // POST /v1/approvals/:id/deny — deny an action
  if (method === 'POST' && pathname.match(/^\/v1\/approvals\/[^/]+\/deny$/)) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const approvalId = pathname.split('/')[3];
    try {
      const result = await pool.query(
        `UPDATE worker_approvals SET status = 'denied', decided_by = $1, decided_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
         RETURNING id, worker_id, tool_name`,
        [tid, approvalId, tid]
      );
      if (result.rows.length === 0) return err(res, 404, 'approval not found or already decided'), true;
      // Mark the paused execution as charter_blocked
      await pool.query(
        `UPDATE worker_executions SET status = 'charter_blocked', completed_at = NOW(),
         error = $1
         WHERE worker_id = $2 AND tenant_id = $3 AND status = 'awaiting_approval'`,
        [`Action denied: ${result.rows[0].tool_name} was denied`, result.rows[0].worker_id, tid]
      );
      return json(res, 200, { ok: true, approval: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to deny'), true;
    }
  }

  // POST /v1/providers/openai/validate — validate OpenAI API key
  if (method === 'POST' && pathname === '/v1/providers/openai/validate') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body?.apiKey) return err(res, 400, 'apiKey is required'), true;
    try {
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${body.apiKey}` },
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        return err(res, 401, e?.error?.message || 'Invalid API key'), true;
      }
      const data = await resp.json();
      const modelCount = data?.data?.length || 0;
      return json(res, 200, { ok: true, models: modelCount }), true;
    } catch (e) {
      return err(res, 502, 'Failed to reach OpenAI API'), true;
    }
  }

  // POST /v1/providers/anthropic/validate — validate Anthropic API key
  if (method === 'POST' && pathname === '/v1/providers/anthropic/validate') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body?.apiKey) return err(res, 400, 'apiKey is required'), true;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': body.apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        return err(res, 401, e?.error?.message || 'Invalid API key'), true;
      }
      return json(res, 200, { ok: true }), true;
    } catch (e) {
      return err(res, 502, 'Failed to reach Anthropic API'), true;
    }
  }

  // POST /v1/providers — store a provider API key
  if (method === 'POST' && pathname === '/v1/providers') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body?.provider || !body?.apiKey) return err(res, 400, 'provider and apiKey are required'), true;
    const allowed = new Set(['openai', 'anthropic']);
    if (!allowed.has(body.provider)) return err(res, 400, `unsupported provider: ${body.provider}`), true;
    // Use a tenant-scoped worker_id to avoid collisions: "tenant:{tid}"
    const systemWorkerId = `tenant:${tid}`;
    const memKey = `provider_${body.provider}_key`;
    try {
      // Delete existing entry then insert (upsert via delete+insert for compatibility)
      await pool.query(
        `DELETE FROM worker_memory WHERE worker_id = $1 AND key = $2`,
        [systemWorkerId, memKey]
      );
      await pool.query(
        `INSERT INTO worker_memory (id, worker_id, tenant_id, scope, key, value, updated_at)
         VALUES ($1, $2, $3, 'tenant', $4, $5, NOW())`,
        [generateId('mem'), systemWorkerId, tid, memKey, body.apiKey]
      );
      return json(res, 200, { ok: true, provider: body.provider }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to store provider key'), true;
    }
  }

  // GET /v1/providers — list connected providers (masked keys)
  if (method === 'GET' && pathname === '/v1/providers') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const systemWorkerId = `tenant:${tid}`;
    try {
      const result = await pool.query(
        `SELECT key, value FROM worker_memory WHERE worker_id = $1 AND scope = 'tenant' AND key LIKE 'provider_%_key'`,
        [systemWorkerId]
      );
      const providers = result.rows.map(row => {
        const provider = row.key.replace('provider_', '').replace('_key', '');
        const masked = row.value ? '****' + row.value.slice(-4) : '';
        return { provider, connected: true, maskedKey: masked };
      });
      return json(res, 200, { providers }), true;
    } catch {
      return json(res, 200, { providers: [] }), true;
    }
  }

  // DELETE /v1/providers/:provider — remove a provider key
  const providerDeleteMatch = pathname.match(/^\/v1\/providers\/(openai|anthropic)$/);
  if (method === 'DELETE' && providerDeleteMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const provider = providerDeleteMatch[1];
    const systemWorkerId = `tenant:${tid}`;
    const memKey = `provider_${provider}_key`;
    try {
      await pool.query(
        `DELETE FROM worker_memory WHERE worker_id = $1 AND key = $2`,
        [systemWorkerId, memKey]
      );
      return json(res, 200, { ok: true }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to remove provider key'), true;
    }
  }

  // GET /v1/credits — credit balance
  if (method === 'GET' && pathname === '/v1/credits') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(`SELECT balance_usd, total_spent_usd FROM tenant_credits WHERE tenant_id = $1`, [tid]);
      const row = result.rows[0] || { balance_usd: 0, total_spent_usd: 0 };
      return json(res, 200, { balance: parseFloat(row.balance_usd), remaining: parseFloat(row.balance_usd), totalSpent: parseFloat(row.total_spent_usd) }), true;
    } catch {
      return json(res, 200, { balance: 0, remaining: 0, totalSpent: 0 }), true;
    }
  }

  // GET /v1/workers/:id/versions — list all versions
  const versionsMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/versions$/);
  if (method === 'GET' && versionsMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `SELECT * FROM worker_versions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY version DESC`,
        [versionsMatch[1], tid]
      );
      return json(res, 200, { versions: result.rows }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to list versions'), true;
    }
  }

  // POST /v1/workers/:id/versions/:version/rollback — restore a previous version
  const rollbackMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/versions\/(\d+)\/rollback$/);
  if (method === 'POST' && rollbackMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const [, workerId, versionNum] = rollbackMatch;
    try {
      const vr = await pool.query(
        `SELECT config FROM worker_versions WHERE worker_id = $1 AND tenant_id = $2 AND version = $3`,
        [workerId, tid, parseInt(versionNum)]
      );
      if (vr.rowCount === 0) return err(res, 404, 'version not found'), true;
      const config = typeof vr.rows[0].config === 'string' ? JSON.parse(vr.rows[0].config) : vr.rows[0].config;

      // Save current state as a new version before rollback
      const current = await pool.query(`SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`, [workerId, tid]);
      if (current.rowCount === 0) return err(res, 404, 'worker not found'), true;
      const lastVersion = await pool.query(
        `SELECT COALESCE(MAX(version), 0) AS max_v FROM worker_versions WHERE worker_id = $1`, [workerId]
      );
      const nextVersion = (lastVersion.rows[0].max_v || 0) + 1;
      await pool.query(
        `INSERT INTO worker_versions (id, worker_id, tenant_id, version, config, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
        [generateId('wver'), workerId, tid, nextVersion, JSON.stringify(current.rows[0]), tid]
      );

      // Apply the old config
      const sets = [], vals = [];
      let pi = 1;
      for (const f of UPDATABLE) {
        if (config[f] !== undefined) {
          sets.push(`${f} = $${pi}`);
          vals.push(JSON_FIELDS.has(f) ? (typeof config[f] === 'string' ? config[f] : JSON.stringify(config[f])) : config[f]);
          pi++;
        }
      }
      sets.push(`updated_at = $${pi}`); vals.push(new Date().toISOString()); pi++;
      vals.push(workerId, tid);
      const result = await pool.query(
        `UPDATE workers SET ${sets.join(', ')} WHERE id = $${pi} AND tenant_id = $${pi + 1} RETURNING *`, vals
      );
      return json(res, 200, { worker: result.rows[0], rolledBackToVersion: parseInt(versionNum) }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'rollback failed'), true;
    }
  }

  // =========================================================================
  // Full-Text Search
  // =========================================================================

  // GET /v1/search?q=...&type=workers|executions|approvals
  if (method === 'GET' && pathname === '/v1/search') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const q = searchParams.get('q');
    if (!q || !q.trim()) return err(res, 400, 'q parameter is required'), true;
    const type = searchParams.get('type');
    const pattern = `%${q.trim()}%`;
    const results = [];

    try {
      if (!type || type === 'workers') {
        const wr = await pool.query(
          `SELECT * FROM workers WHERE tenant_id = $1 AND (name ILIKE $2 OR description ILIKE $2) LIMIT 20`,
          [tid, pattern]
        );
        for (const row of wr.rows) results.push({ type: 'worker', ...row });
      }
      if (!type || type === 'executions') {
        const er = await pool.query(
          `SELECT * FROM worker_executions WHERE tenant_id = $1 AND (result ILIKE $2 OR error ILIKE $2) ORDER BY started_at DESC LIMIT 20`,
          [tid, pattern]
        );
        for (const row of er.rows) results.push({ type: 'execution', ...row });
      }
      if (!type || type === 'approvals') {
        const ar = await pool.query(
          `SELECT * FROM worker_approvals WHERE tenant_id = $1 AND (tool_name ILIKE $2 OR decision ILIKE $2) LIMIT 20`,
          [tid, pattern]
        );
        for (const row of ar.rows) results.push({ type: 'approval', ...row });
      }
      return json(res, 200, { results }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'search failed'), true;
    }
  }

  // =========================================================================
  // Audit Log Export
  // =========================================================================

  // GET /v1/audit/export?format=csv|json&from=ISO&to=ISO
  if (method === 'GET' && pathname === '/v1/audit/export') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const format = searchParams.get('format') || 'json';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!from || !to) return err(res, 400, 'from and to date parameters are required'), true;

    try {
      // Fetch executions with worker name
      const executions = await pool.query(
        `SELECT e.id AS execution_id, w.name AS worker_name, e.started_at, e.completed_at,
                e.status, e.model, e.tokens_in, e.tokens_out, e.cost_usd, e.tool_calls,
                e.trigger_type
         FROM worker_executions e
         LEFT JOIN workers w ON w.id = e.worker_id AND w.tenant_id = e.tenant_id
         WHERE e.tenant_id = $1 AND e.started_at >= $2 AND e.started_at <= $3
         ORDER BY e.started_at DESC`,
        [tid, from, to]
      );

      // Fetch approvals with worker name
      const approvals = await pool.query(
        `SELECT a.id AS approval_id, w.name AS worker_name, a.tool_name, a.decision,
                a.decided_by, a.decided_at
         FROM worker_approvals a
         LEFT JOIN workers w ON w.id = a.worker_id AND w.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.decided_at >= $2 AND a.decided_at <= $3
         ORDER BY a.decided_at DESC`,
        [tid, from, to]
      );

      const rows = [];
      for (const e of executions.rows) {
        rows.push({
          type: 'execution', id: e.execution_id, worker_name: e.worker_name || '',
          started_at: e.started_at, completed_at: e.completed_at || '',
          status: e.status, model: e.model || '', tokens_in: e.tokens_in || 0,
          tokens_out: e.tokens_out || 0, cost_usd: e.cost_usd || 0,
          tool_calls: e.tool_calls || 0, trigger_type: e.trigger_type || '',
          decision: '', decided_by: '', tool_name: '',
        });
      }
      for (const a of approvals.rows) {
        rows.push({
          type: 'approval', id: a.approval_id, worker_name: a.worker_name || '',
          started_at: '', completed_at: '', status: '',
          model: '', tokens_in: 0, tokens_out: 0, cost_usd: 0, tool_calls: 0,
          trigger_type: '', decision: a.decision, decided_by: a.decided_by || '',
          tool_name: a.tool_name,
        });
      }

      const dateStr = new Date().toISOString().split('T')[0];

      if (format === 'csv') {
        const headers = ['type', 'id', 'worker_name', 'started_at', 'completed_at', 'status', 'model',
                         'tokens_in', 'tokens_out', 'cost_usd', 'tool_calls', 'trigger_type',
                         'tool_name', 'decision', 'decided_by'];
        const escapeCsv = (val) => {
          const s = String(val ?? '');
          if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const csvLines = [headers.join(',')];
        for (const row of rows) {
          csvLines.push(headers.map(h => escapeCsv(row[h])).join(','));
        }
        const csvBody = csvLines.join('\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="nooterra-audit-${dateStr}.csv"`,
        });
        res.end(csvBody);
        return true;
      }

      // JSON format
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nooterra-audit-${dateStr}.json"`,
      });
      res.end(JSON.stringify({ rows }));
      return true;
    } catch (e) {
      return err(res, 500, e?.message || 'audit export failed'), true;
    }
  }

  // =========================================================================
  // Team Permissions (RBAC CRUD)
  // =========================================================================

  const VALID_ROLES = new Set(['owner', 'admin', 'member', 'viewer']);

  // GET /v1/team — list team members
  if (method === 'GET' && pathname === '/v1/team') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `SELECT * FROM team_members WHERE tenant_id = $1 ORDER BY joined_at ASC`, [tid]
      );
      return json(res, 200, { members: result.rows, count: result.rowCount }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to list team members'), true;
    }
  }

  // POST /v1/team/invite — invite a team member by email
  if (method === 'POST' && pathname === '/v1/team/invite') {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (!body.email?.trim()) return err(res, 400, 'email is required'), true;
    const role = body.role || 'member';
    if (!VALID_ROLES.has(role)) return err(res, 400, `invalid role: ${role}`), true;
    if (role === 'owner') return err(res, 400, 'cannot invite as owner'), true;
    try {
      const id = generateId('tm');
      const result = await pool.query(
        `INSERT INTO team_members (id, tenant_id, email, role, invited_by, joined_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [id, tid, body.email.trim().toLowerCase(), role, tid]
      );
      return json(res, 201, { member: result.rows[0] }), true;
    } catch (e) {
      if (e?.code === '23505') return err(res, 409, 'member already exists'), true;
      return err(res, 500, e?.message || 'failed to invite member'), true;
    }
  }

  // PUT /v1/team/:memberId/role — change a member's role
  const teamRoleMatch = pathname.match(/^\/v1\/team\/([^/]+)\/role$/);
  if (method === 'PUT' && teamRoleMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const body = await readBody(req);
    if (!body) return err(res, 400, 'JSON body required'), true;
    if (!body.role || !VALID_ROLES.has(body.role)) return err(res, 400, `invalid role: ${body.role}`), true;
    try {
      const result = await pool.query(
        `UPDATE team_members SET role = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [body.role, teamRoleMatch[1], tid]
      );
      if (result.rowCount === 0) return err(res, 404, 'team member not found'), true;
      return json(res, 200, { member: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to update role'), true;
    }
  }

  // DELETE /v1/team/:memberId — remove a team member
  const teamDeleteMatch = pathname.match(/^\/v1\/team\/([^/]+)$/);
  if (method === 'DELETE' && teamDeleteMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    try {
      const result = await pool.query(
        `DELETE FROM team_members WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [teamDeleteMatch[1], tid]
      );
      if (result.rowCount === 0) return err(res, 404, 'team member not found'), true;
      return json(res, 200, { ok: true, member: result.rows[0] }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to remove member'), true;
    }
  }

  // =========================================================================
  // Worker File Uploads (S3 presigned URLs)
  // =========================================================================

  const S3_ENDPOINT = process.env.WORKER_S3_ENDPOINT || process.env.PROXY_EVIDENCE_S3_ENDPOINT || '';
  const S3_REGION = process.env.WORKER_S3_REGION || process.env.PROXY_EVIDENCE_S3_REGION || 'us-east-1';
  const S3_BUCKET = process.env.WORKER_S3_BUCKET || process.env.PROXY_EVIDENCE_S3_BUCKET || '';
  const S3_ACCESS_KEY_ID = process.env.WORKER_S3_ACCESS_KEY_ID || process.env.PROXY_EVIDENCE_S3_ACCESS_KEY_ID || '';
  const S3_SECRET_ACCESS_KEY = process.env.WORKER_S3_SECRET_ACCESS_KEY || process.env.PROXY_EVIDENCE_S3_SECRET_ACCESS_KEY || '';

  // POST /v1/workers/:id/files — generate a presigned upload URL
  const filesUploadMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/files$/);
  if (method === 'POST' && filesUploadMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wid = filesUploadMatch[1];

    // Verify worker belongs to tenant
    const wr = await pool.query(`SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`, [wid, tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;

    const body = await readBody(req);
    if (!body?.filename) return err(res, 400, 'filename is required'), true;

    const ALLOWED_EXTENSIONS = new Set(['pdf', 'csv', 'json', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
    const ext = (body.filename.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return err(res, 400, `Unsupported file type: .${ext}`), true;

    const contentType = body.content_type || 'application/octet-stream';

    if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) {
      return err(res, 503, 'File storage not configured — S3 credentials missing'), true;
    }

    const fileId = generateId('file');
    const s3Key = `workers/${tid}/${wid}/${fileId}.${ext}`;

    try {
      const uploadUrl = presignS3Url({
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        bucket: S3_BUCKET,
        key: s3Key,
        method: 'PUT',
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
        expiresInSeconds: 3600,
      });

      // Store file metadata
      await pool.query(
        `INSERT INTO worker_files (id, worker_id, tenant_id, filename, s3_key, content_type, size_bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [fileId, wid, tid, body.filename, s3Key, contentType, body.size || 0]
      );

      return json(res, 200, { upload_url: uploadUrl, file_id: fileId, s3_key: s3Key }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to generate upload URL'), true;
    }
  }

  // GET /v1/workers/:id/files — list uploaded files for a worker
  if (method === 'GET' && filesUploadMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wid = filesUploadMatch[1];

    try {
      const result = await pool.query(
        `SELECT id, filename, content_type, size_bytes, created_at FROM worker_files
         WHERE worker_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC LIMIT 100`,
        [wid, tid]
      );

      // Generate download URLs for each file
      const files = result.rows.map(f => {
        let download_url = null;
        if (S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET) {
          try {
            const s3Key = `workers/${tid}/${wid}/${f.id}.${(f.filename.split('.').pop() || '').toLowerCase()}`;
            download_url = presignS3Url({
              endpoint: S3_ENDPOINT,
              region: S3_REGION,
              bucket: S3_BUCKET,
              key: s3Key,
              method: 'GET',
              accessKeyId: S3_ACCESS_KEY_ID,
              secretAccessKey: S3_SECRET_ACCESS_KEY,
              expiresInSeconds: 3600,
            });
          } catch { /* ignore presign errors */ }
        }
        return { ...f, download_url };
      });

      return json(res, 200, { files, count: result.rowCount }), true;
    } catch (e) {
      return err(res, 500, e?.message || 'failed to list files'), true;
    }
  }

  return false; // Not handled
}
