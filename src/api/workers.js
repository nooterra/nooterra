import crypto from "node:crypto";
import { readJsonBody, sendError, sendJson } from "./http.js";

function generateWorkerId() {
  return `wrk_${crypto.randomBytes(8).toString("hex")}`;
}

function generateExecutionId() {
  return `exec_${crypto.randomBytes(8).toString("hex")}`;
}

function requireTenant(req, res) {
  const headerVal = req.headers["x-tenant-id"];
  if (typeof headerVal === "string" && headerVal.trim() !== "") {
    return headerVal.trim();
  }
  // Fall back to cookie-based session (parse simple cookie format)
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)tenant_id=([^;]+)/);
  if (match) {
    const decoded = decodeURIComponent(match[1]).trim();
    if (decoded) return decoded;
  }
  sendError(res, 401, "tenant identification required");
  return null;
}

function parsePathParams(pattern, pathname) {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

const VALID_STATUSES = new Set(["ready", "running", "paused", "error", "archived"]);
const UPDATABLE_FIELDS = new Set(["name", "description", "charter", "schedule", "model", "status", "knowledge", "triggers", "provider_mode", "byok_provider"]);

export function mountWorkerRoutes(app, store) {
  const pool = store.pg.pool;

  async function handleRequest(req, res, url) {
    const path = url.pathname;
    const method = req.method;

    // POST /v1/workers — create a worker
    if (method === "POST" && path === "/v1/workers") {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") {
        sendError(res, 400, "JSON body is required");
        return true;
      }

      const { name, description, charter, schedule, model, provider_mode, byok_provider, knowledge, triggers } = body;
      if (typeof name !== "string" || name.trim() === "") {
        sendError(res, 400, "name is required");
        return true;
      }

      const id = generateWorkerId();
      const now = new Date().toISOString();

      const result = await pool.query(
        `INSERT INTO workers (id, tenant_id, name, description, charter, schedule, model, provider_mode, byok_provider, knowledge, triggers, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          id,
          tenantId,
          name.trim(),
          description ?? null,
          JSON.stringify(charter ?? {}),
          schedule ? JSON.stringify(schedule) : null,
          model ?? "google/gemini-2.5-flash",
          provider_mode ?? "platform",
          byok_provider ?? null,
          JSON.stringify(knowledge ?? []),
          JSON.stringify(triggers ?? []),
          now,
          now
        ]
      );

      sendJson(res, 201, { worker: result.rows[0] });
      return true;
    }

    // GET /v1/workers — list workers for tenant
    if (method === "GET" && path === "/v1/workers") {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const status = url.searchParams.get("status");
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
      const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

      let query;
      let params;
      if (status && VALID_STATUSES.has(status)) {
        query = `SELECT * FROM workers WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
        params = [tenantId, status, limit, offset];
      } else {
        query = `SELECT * FROM workers WHERE tenant_id = $1 AND status != 'archived' ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
        params = [tenantId, limit, offset];
      }

      const result = await pool.query(query, params);
      sendJson(res, 200, { workers: result.rows, count: result.rowCount });
      return true;
    }

    // GET /v1/workers/:id
    const getWorkerMatch = method === "GET" ? parsePathParams("/v1/workers/:id", path) : null;
    if (getWorkerMatch && !path.includes("/", "/v1/workers/".length)) {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const result = await pool.query(
        `SELECT * FROM workers WHERE id = $1 AND tenant_id = $2`,
        [getWorkerMatch.id, tenantId]
      );

      if (result.rowCount === 0) {
        sendError(res, 404, "worker not found");
        return true;
      }

      sendJson(res, 200, { worker: result.rows[0] });
      return true;
    }

    // PUT /v1/workers/:id — update worker
    const putWorkerMatch = method === "PUT" ? parsePathParams("/v1/workers/:id", path) : null;
    if (putWorkerMatch && !path.includes("/", "/v1/workers/".length)) {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") {
        sendError(res, 400, "JSON body is required");
        return true;
      }

      if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
        sendError(res, 400, `invalid status: ${body.status}`);
        return true;
      }

      const setClauses = [];
      const values = [];
      let paramIndex = 1;

      for (const field of UPDATABLE_FIELDS) {
        if (body[field] !== undefined) {
          const value = (field === "charter" || field === "schedule" || field === "knowledge" || field === "triggers")
            ? JSON.stringify(body[field])
            : body[field];
          setClauses.push(`${field} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setClauses.length === 0) {
        sendError(res, 400, "no updatable fields provided");
        return true;
      }

      setClauses.push(`updated_at = $${paramIndex}`);
      values.push(new Date().toISOString());
      paramIndex++;

      values.push(putWorkerMatch.id, tenantId);

      const result = await pool.query(
        `UPDATE workers SET ${setClauses.join(", ")} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1} RETURNING *`,
        values
      );

      if (result.rowCount === 0) {
        sendError(res, 404, "worker not found");
        return true;
      }

      sendJson(res, 200, { worker: result.rows[0] });
      return true;
    }

    // DELETE /v1/workers/:id — archive worker
    const deleteWorkerMatch = method === "DELETE" ? parsePathParams("/v1/workers/:id", path) : null;
    if (deleteWorkerMatch) {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const result = await pool.query(
        `UPDATE workers SET status = 'archived', updated_at = $1 WHERE id = $2 AND tenant_id = $3 AND status != 'archived' RETURNING *`,
        [new Date().toISOString(), deleteWorkerMatch.id, tenantId]
      );

      if (result.rowCount === 0) {
        sendError(res, 404, "worker not found");
        return true;
      }

      sendJson(res, 200, { worker: result.rows[0] });
      return true;
    }

    // POST /v1/workers/:id/run — trigger manual execution
    const runMatch = method === "POST" ? parsePathParams("/v1/workers/:id/run", path) : null;
    if (runMatch) {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      // Verify worker exists and is in a runnable state
      const workerResult = await pool.query(
        `SELECT id, model, status FROM workers WHERE id = $1 AND tenant_id = $2`,
        [runMatch.id, tenantId]
      );

      if (workerResult.rowCount === 0) {
        sendError(res, 404, "worker not found");
        return true;
      }

      const worker = workerResult.rows[0];
      if (worker.status === "archived") {
        sendError(res, 409, "cannot run an archived worker");
        return true;
      }
      if (worker.status === "paused") {
        sendError(res, 409, "cannot run a paused worker");
        return true;
      }

      const execId = generateExecutionId();
      const result = await pool.query(
        `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at)
         VALUES ($1, $2, $3, 'manual', 'queued', $4, $5)
         RETURNING *`,
        [execId, runMatch.id, tenantId, worker.model, new Date().toISOString()]
      );

      sendJson(res, 202, { execution: result.rows[0] });
      return true;
    }

    // GET /v1/workers/:id/logs — execution history
    const logsMatch = method === "GET" ? parsePathParams("/v1/workers/:id/logs", path) : null;
    if (logsMatch) {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
      const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
      const status = url.searchParams.get("status");

      let query;
      let params;
      if (status) {
        query = `SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 AND status = $3 ORDER BY started_at DESC LIMIT $4 OFFSET $5`;
        params = [logsMatch.id, tenantId, status, limit, offset];
      } else {
        query = `SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY started_at DESC LIMIT $3 OFFSET $4`;
        params = [logsMatch.id, tenantId, limit, offset];
      }

      const result = await pool.query(query, params);
      sendJson(res, 200, { executions: result.rows, count: result.rowCount });
      return true;
    }

    // POST /v1/workers/:id/trigger — webhook trigger
    const triggerMatch = method === "POST" ? parsePathParams("/v1/workers/:id/trigger", path) : null;
    if (triggerMatch) {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const workerResult = await pool.query(
        `SELECT id, model, status FROM workers WHERE id = $1 AND tenant_id = $2`,
        [triggerMatch.id, tenantId]
      );

      if (workerResult.rowCount === 0) {
        sendError(res, 404, "worker not found");
        return true;
      }

      const worker = workerResult.rows[0];
      if (worker.status === "archived") {
        sendError(res, 409, "cannot trigger an archived worker");
        return true;
      }
      if (worker.status === "paused") {
        sendError(res, 409, "cannot trigger a paused worker");
        return true;
      }

      const execId = generateExecutionId();
      const result = await pool.query(
        `INSERT INTO worker_executions (id, worker_id, tenant_id, trigger_type, status, model, started_at)
         VALUES ($1, $2, $3, 'webhook', 'queued', $4, $5)
         RETURNING *`,
        [execId, triggerMatch.id, tenantId, worker.model, new Date().toISOString()]
      );

      sendJson(res, 202, { execution: result.rows[0] });
      return true;
    }

    // GET /v1/workers/:id/feed — SSE activity feed
    const feedMatch = method === "GET" ? parsePathParams("/v1/workers/:id/feed", path) : null;
    if (feedMatch) {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      // Verify worker exists and belongs to tenant
      const workerResult = await pool.query(
        `SELECT id FROM workers WHERE id = $1 AND tenant_id = $2`,
        [feedMatch.id, tenantId]
      );

      if (workerResult.rowCount === 0) {
        sendError(res, 404, "worker not found");
        return true;
      }

      // Set up SSE connection
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "x-accel-buffering": "no"
      });

      // Send initial snapshot of recent activity
      const recentExecs = await pool.query(
        `SELECT * FROM worker_executions WHERE worker_id = $1 AND tenant_id = $2 ORDER BY started_at DESC LIMIT 10`,
        [feedMatch.id, tenantId]
      );

      res.write(`event: snapshot\ndata: ${JSON.stringify({ executions: recentExecs.rows })}\n\n`);

      // Poll for new activity every 2 seconds
      const lastSeenAt = { value: new Date().toISOString() };
      const interval = setInterval(async () => {
        try {
          const newExecs = await pool.query(
            `SELECT * FROM worker_executions
             WHERE worker_id = $1 AND tenant_id = $2 AND started_at > $3
             ORDER BY started_at ASC`,
            [feedMatch.id, tenantId, lastSeenAt.value]
          );

          for (const exec of newExecs.rows) {
            res.write(`event: execution\ndata: ${JSON.stringify(exec)}\n\n`);
          }

          if (newExecs.rowCount > 0) {
            lastSeenAt.value = newExecs.rows[newExecs.rowCount - 1].started_at;
          }

          // Also check for status updates on running/queued executions
          const updates = await pool.query(
            `SELECT * FROM worker_executions
             WHERE worker_id = $1 AND tenant_id = $2 AND status IN ('running', 'completed', 'failed')
               AND updated_at > $3
             ORDER BY updated_at ASC
             LIMIT 50`,
            [feedMatch.id, tenantId, lastSeenAt.value]
          );

          for (const exec of updates.rows) {
            res.write(`event: update\ndata: ${JSON.stringify(exec)}\n\n`);
          }
        } catch {
          // Connection may have closed; cleanup will happen via req close event
        }
      }, 2000);

      // Send keepalive every 15 seconds
      const keepalive = setInterval(() => {
        try {
          res.write(":keepalive\n\n");
        } catch {
          // ignore
        }
      }, 15000);

      req.on("close", () => {
        clearInterval(interval);
        clearInterval(keepalive);
      });

      return true;
    }

    // Route not matched
    return false;
  }

  // Return the handler for integration into the main app
  return { handleRequest };
}
