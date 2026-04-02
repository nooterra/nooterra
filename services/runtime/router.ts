/**
 * HTTP Request Router
 *
 * Extracted from server.js — dispatches incoming requests to handler modules.
 * No business logic here, just routing and body parsing.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { handleChatRequest } from './chat.js';
import { createCheckoutSession, createCreditPurchase, handleStripeWebhook, getBillingStatus } from './billing.js';
import { deliverNotification, sendSlackTestNotification, getNotificationPreferences } from './notifications.js';
import { handleWorkerRoute } from './workers-api.js';
import { handleAuthorize, handleStatus as handleIntegrationStatus, handleDisconnect } from './integrations.js';
import { handleWorldRuntimeRoute } from '../../src/api/world-runtime-routes.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouterDeps {
  pool: pg.Pool;
  log: (level: string, msg: string) => void;
  getActiveExecutions: () => number;
  getRunningWorkers: () => Set<string>;
  handleWorkerChat: (req: IncomingMessage, res: ServerResponse, workerId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_ORIGINS = ['https://nooterra.ai', 'https://www.nooterra.ai'];

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tenant-id, x-webhook-secret');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// ---------------------------------------------------------------------------
// Body parsing helper
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readBodyRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

export function createRequestHandler(deps: RouterDeps) {
  const { pool, log, getActiveExecutions, getRunningWorkers, handleWorkerChat } = deps;

  return async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    log('info', `${req.method} ${req.url}`);
    setCorsHeaders(req, res);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = (req.url ?? '/').split('?')[0].replace(/\/+$/, '');

    // --- Health ---
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        activeExecutions: getActiveExecutions(),
        uptime: process.uptime(),
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      }));
      return;
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      try {
        const dbStart = Date.now();
        await pool.query('SELECT 1 AS ok');
        const dbLatencyMs = Date.now() - dbStart;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          db: { ok: true, latencyMs: dbLatencyMs },
          uptime: Math.floor(process.uptime()),
          activeExecutions: getActiveExecutions(),
          runningWorkers: getRunningWorkers().size,
        }));
      } catch (err: any) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unhealthy', db: { ok: false, error: err.message } }));
      }
      return;
    }

    // --- Chat ---
    if (req.method === 'POST' && pathname === '/v1/chat') {
      handleChatRequest(req, res, pool);
      return;
    }

    const workerChatMatch = pathname.match(/^\/v1\/workers\/([^/]+)\/chat$/);
    if (req.method === 'POST' && workerChatMatch) {
      handleWorkerChat(req, res, workerChatMatch[1]);
      return;
    }

    // --- Billing ---
    if (req.method === 'POST' && pathname === '/v1/billing/checkout') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const tenantId = req.headers['x-tenant-id'] || data.tenantId;
        if (!tenantId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing tenant ID' }));
          return;
        }
        if (!data.email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing email' }));
          return;
        }

        let result;
        if (data.type === 'credits') {
          result = await createCreditPurchase({
            tenantId,
            email: data.email,
            amount: data.amount,
            successUrl: data.successUrl,
            cancelUrl: data.cancelUrl,
          }, pool);
        } else {
          result = await createCheckoutSession({
            tenantId,
            email: data.email,
            plan: data.plan || 'pro',
            successUrl: data.successUrl,
            cancelUrl: data.cancelUrl,
          }, pool);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        log('error', `Billing checkout error: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/billing/webhook') {
      try {
        const rawBody = await readBodyRaw(req);
        const signature = (req.headers['stripe-signature'] as string) || '';
        const result = await handleStripeWebhook(rawBody.toString('utf8'), signature, pool, log);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        log('error', `Webhook error: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/billing/status') {
      const tenantId = req.headers['x-tenant-id'] as string;
      if (!tenantId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing x-tenant-id header' }));
        return;
      }
      try {
        const status = await getBillingStatus(tenantId, pool);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch (err: any) {
        log('error', `Billing status error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // --- Notification preferences ---
    if (req.method === 'GET' && pathname === '/v1/notifications/preferences') {
      const tenantId = req.headers['x-tenant-id'] as string;
      if (!tenantId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing x-tenant-id header' }));
        return;
      }
      try {
        const prefs = await getNotificationPreferences(pool, tenantId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prefs || {}));
      } catch (err: any) {
        log('error', `Get notification prefs error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'PUT' && pathname === '/v1/notifications/preferences') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        const tenantId = req.headers['x-tenant-id'] as string;
        if (!tenantId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing x-tenant-id header' }));
          return;
        }

        await pool.query(`
          INSERT INTO notification_preferences (tenant_id, preferences, updated_at)
          VALUES ($1, $2::jsonb, now())
          ON CONFLICT (tenant_id)
          DO UPDATE SET preferences = $2::jsonb, updated_at = now()
        `, [tenantId, JSON.stringify(data)]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        log('error', `Save notification prefs error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/notifications/test-slack') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        if (!data.webhookUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing webhookUrl' }));
          return;
        }
        const result = await sendSlackTestNotification(data.webhookUrl);
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        log('error', `Slack test error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // --- Worker CRUD + credits + providers + approvals + search + audit + team ---
    if (pathname.startsWith('/v1/workers') || pathname === '/v1/credits' || pathname.startsWith('/v1/providers')
        || pathname.startsWith('/v1/approvals') || pathname === '/v1/search' || pathname.startsWith('/v1/audit')
        || pathname.startsWith('/v1/team')) {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const handled = await handleWorkerRoute(req, res, pool, pathname, url.searchParams);
      if (handled) return;
    }

    // --- Integration routes (Composio) ---
    const authMatch = pathname.match(/^\/v1\/integrations\/([\w_]+)\/authorize$/);
    if (req.method === 'GET' && authMatch) {
      handleAuthorize(req, res, authMatch[1]);
      return;
    }

    const disconnectMatch = pathname.match(/^\/v1\/integrations\/([\w_]+)\/disconnect$/);
    if (req.method === 'POST' && disconnectMatch) {
      handleDisconnect(req, res, disconnectMatch[1]);
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/integrations/status') {
      handleIntegrationStatus(req, res);
      return;
    }

    // --- World Runtime API routes ---
    if (pathname.startsWith('/v1/world/')) {
      try {
        const handled = await handleWorldRuntimeRoute(req, res, pool, pathname);
        if (handled) return;
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
    }

    // --- 404 ---
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  };
}
