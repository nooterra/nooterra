/**
 * Worker CRUD API
 *
 * Ported from src/api/workers.js into the scheduler service.
 * Handles all /v1/workers/* routes with raw Node.js HTTP.
 */

import crypto from 'node:crypto';

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

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
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
const UPDATABLE = new Set(['name', 'description', 'charter', 'schedule', 'model', 'status', 'knowledge', 'triggers', 'provider_mode', 'byok_provider']);
const JSON_FIELDS = new Set(['charter', 'schedule', 'knowledge', 'triggers']);

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

    const id = generateId('wrk');
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO workers (id, tenant_id, name, description, charter, schedule, model, provider_mode, byok_provider, knowledge, triggers, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [id, tid, body.name.trim(), body.description ?? null,
       JSON.stringify(body.charter ?? {}), body.schedule ? JSON.stringify(body.schedule) : null,
       body.model ?? 'google/gemini-2.5-flash', body.provider_mode ?? 'platform',
       body.byok_provider ?? null, JSON.stringify(body.knowledge ?? []),
       JSON.stringify(body.triggers ?? []), now, now]
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

    const execId = generateId('exec');
    const result = await pool.query(
      `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at) VALUES ($1,$2,$3,'manual','queued',$4,$5) RETURNING *`,
      [execId, runMatch[1], tid, wr.rows[0].model, new Date().toISOString()]
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
  const trigMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/trigger$/);
  if (method === 'POST' && trigMatch) {
    const tid = getTenantId(req);
    if (!tid) return err(res, 401, 'tenant identification required'), true;
    const wr = await pool.query(`SELECT id, model, status FROM workers WHERE id = $1 AND tenant_id = $2`, [trigMatch[1], tid]);
    if (wr.rowCount === 0) return err(res, 404, 'worker not found'), true;
    if (wr.rows[0].status === 'archived') return err(res, 409, 'cannot trigger archived worker'), true;
    if (wr.rows[0].status === 'paused') return err(res, 409, 'cannot trigger paused worker'), true;

    const execId = generateId('exec');
    const result = await pool.query(
      `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at) VALUES ($1,$2,$3,'webhook','queued',$4,$5) RETURNING *`,
      [execId, trigMatch[1], tid, wr.rows[0].model, new Date().toISOString()]
    );
    return json(res, 202, { execution: result.rows[0] }), true;
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

  return false; // Not handled
}
