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
import { getAuthenticatedTenantId } from './auth.js';
import { encryptCredential } from './crypto-utils.js';
import {
  ACTIVE_STRIPE_SCAN_TIMEOUT_MS,
  DEFAULT_STRIPE_SCAN_LOOKBACK_DAYS,
  createStripeScanId,
  runStripeScan,
} from './stripe-scans.js';
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

async function requireAuthenticatedTenant(req: IncomingMessage): Promise<
  { ok: true; tenantId: string }
  | { ok: false; status: number; message: string }
> {
  const tenantId = await getAuthenticatedTenantId(req);
  if (!tenantId) {
    return { ok: false, status: 401, message: 'Authentication required' };
  }

  const headerTenantId = req.headers['x-tenant-id'];
  if (typeof headerTenantId === 'string' && headerTenantId.trim() && headerTenantId.trim() !== tenantId) {
    return {
      ok: false,
      status: 403,
      message: 'Authenticated tenant does not match x-tenant-id',
    };
  }

  return { ok: true, tenantId };
}

// ---------------------------------------------------------------------------
// Stripe historical data backfill
// ---------------------------------------------------------------------------

export async function backfillStripeData(
  pool: pg.Pool,
  tenantId: string,
  apiKey: string,
  log: (level: string, msg: string) => void,
): Promise<void> {
  const headers = { 'Authorization': `Bearer ${apiKey}` };
  const { onStripeWebhook } = await import('../../src/bridge.js');

  let totalIngested = 0;

  try {
    const makeBackfillEventId = (stripeType: string, objectId: string) =>
      `backfill_${stripeType.replace(/\./g, '_')}_${objectId}`;

    // --- Customers ---
    let hasMore = true;
    let startingAfter: string | undefined;
    while (hasMore) {
      const url = new URL('https://api.stripe.com/v1/customers');
      url.searchParams.set('limit', '100');
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        log('warn', `Stripe backfill: customers fetch failed (${res.status})`);
        break;
      }
      const data = await res.json();

      for (const customer of data.data || []) {
        try {
          await onStripeWebhook(pool, tenantId, {
            id: makeBackfillEventId('customer.created', customer.id),
            type: 'customer.created',
            created: customer.created,
            data: { object: customer },
          });
          totalIngested++;
        } catch (err: any) {
          log('warn', `Backfill customer ${customer.id}: ${err.message}`);
        }
      }

      hasMore = data.has_more;
      startingAfter = data.data?.[data.data.length - 1]?.id;
    }

    // --- Invoices (all statuses) ---
    for (const status of ['open', 'paid', 'uncollectible', 'void']) {
      hasMore = true;
      startingAfter = undefined;
      while (hasMore) {
        const url = new URL('https://api.stripe.com/v1/invoices');
        url.searchParams.set('limit', '100');
        url.searchParams.set('status', status);
        if (startingAfter) url.searchParams.set('starting_after', startingAfter);

        const res = await fetch(url.toString(), { headers });
        if (!res.ok) {
          log('warn', `Stripe backfill: invoices (${status}) fetch failed (${res.status})`);
          break;
        }
        const data = await res.json();

        const eventType = status === 'paid' ? 'invoice.paid'
          : status === 'void' ? 'invoice.voided'
          : 'invoice.created';

        for (const invoice of data.data || []) {
          try {
            await onStripeWebhook(pool, tenantId, {
              id: makeBackfillEventId(eventType, invoice.id),
              type: eventType,
              created: invoice.created,
              data: { object: invoice },
            });
            totalIngested++;
          } catch (err: any) {
            log('warn', `Backfill invoice ${invoice.id}: ${err.message}`);
          }
        }

        hasMore = data.has_more;
        startingAfter = data.data?.[data.data.length - 1]?.id;
      }
    }

    // --- Payment Intents (succeeded only) ---
    hasMore = true;
    startingAfter = undefined;
    while (hasMore) {
      const url = new URL('https://api.stripe.com/v1/payment_intents');
      url.searchParams.set('limit', '100');
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        log('warn', `Stripe backfill: payment_intents fetch failed (${res.status})`);
        break;
      }
      const data = await res.json();

      for (const pi of data.data || []) {
        if (pi.status === 'succeeded') {
          try {
            await onStripeWebhook(pool, tenantId, {
              id: makeBackfillEventId('payment_intent.succeeded', pi.id),
              type: 'payment_intent.succeeded',
              created: pi.created,
              data: { object: pi },
            });
            totalIngested++;
          } catch (err: any) {
            log('warn', `Backfill payment ${pi.id}: ${err.message}`);
          }
        }
      }

      hasMore = data.has_more;
      startingAfter = data.data?.[data.data.length - 1]?.id;
    }

    // --- Disputes (events only — no object materialization) ---
    hasMore = true;
    startingAfter = undefined;
    while (hasMore) {
      const url = new URL('https://api.stripe.com/v1/disputes');
      url.searchParams.set('limit', '100');
      if (startingAfter) url.searchParams.set('starting_after', startingAfter);

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        log('warn', `Stripe backfill: disputes fetch failed (${res.status})`);
        break;
      }
      const data = await res.json();

      for (const dispute of data.data || []) {
        try {
          const eventType = dispute.status === 'won' || dispute.status === 'lost'
            ? 'charge.dispute.closed'
            : 'charge.dispute.created';
          await onStripeWebhook(pool, tenantId, {
            id: makeBackfillEventId(eventType, dispute.id),
            type: eventType,
            created: dispute.created,
            data: { object: dispute },
          });
          totalIngested++;
        } catch (err: any) {
          log('warn', `Backfill dispute ${dispute.id}: ${err.message}`);
        }
      }

      hasMore = data.has_more;
      startingAfter = data.data?.[data.data.length - 1]?.id;
    }

    // Mark backfill as complete
    await pool.query(
      `UPDATE tenant_integrations
       SET metadata = metadata || $2::jsonb, updated_at = now()
       WHERE tenant_id = $1 AND service = 'stripe'`,
      [tenantId, JSON.stringify({ status: 'backfill_complete', lastBackfilledAt: new Date().toISOString(), objectsIngested: totalIngested })],
    );

    log('info', `Stripe backfill complete for ${tenantId}: ${totalIngested} objects ingested`);
  } catch (err) {
    // Reset status so backfill can be retried
    await pool.query(
      `UPDATE tenant_integrations
       SET metadata = metadata || $2::jsonb, updated_at = now()
       WHERE tenant_id = $1 AND service = 'stripe'`,
      [tenantId, JSON.stringify({ status: 'backfill_failed', lastError: (err as Error).message, failedAt: new Date().toISOString() })],
    ).catch(() => {}); // Don't let status update failure mask the real error
    throw err;
  }
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
        res.end(JSON.stringify({ status: 'unhealthy', db: { ok: false, error: 'Database connection failed' } }));
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
            plan: data.plan || 'starter',
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

    // --- Stripe API Key (BYOK) ---
    if (req.method === 'POST' && pathname === '/v1/integrations/stripe/key') {
      try {
        const auth = await requireAuthenticatedTenant(req);
        if (auth.ok === false) {
          res.writeHead(auth.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: auth.message }));
          return;
        }
        const tenantId = auth.tenantId;

        const body = await readBody(req);
        const { apiKey } = JSON.parse(body);

        if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk_')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid Stripe API key. Must start with sk_live_ or sk_test_' }));
          return;
        }

        // Validate key by calling Stripe API
        try {
          const stripeRes = await fetch('https://api.stripe.com/v1/balance', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          if (!stripeRes.ok) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Stripe API key validation failed. Check your key and try again.' }));
            return;
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Could not reach Stripe API. Try again.' }));
          return;
        }

        // Encrypt and store
        let encrypted;
        try {
          encrypted = encryptCredential(apiKey);
        } catch (err: any) {
          log('error', `Stripe key storage blocked: ${err.message}`);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Secure credential storage is not configured' }));
          return;
        }
        const id = `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        await pool.query(
          `INSERT INTO tenant_integrations (id, tenant_id, service, status, credentials_encrypted, metadata, connected_at, updated_at)
           VALUES ($1, $2, 'stripe', 'connected', $3, $4::jsonb, now(), now())
           ON CONFLICT (tenant_id, service) DO UPDATE SET
             credentials_encrypted = EXCLUDED.credentials_encrypted,
             status = 'connected',
             metadata = EXCLUDED.metadata,
             updated_at = now()`,
          [id, tenantId, encrypted, JSON.stringify({ method: 'api_key', keyPrefix: apiKey.slice(0, 7) + '...' })],
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'stripe', status: 'connected' }));
      } catch (err: any) {
        log('error', `Stripe key storage error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to store API key' }));
      }
      return;
    }

    // --- Stripe historical data backfill ---
    if (req.method === 'POST' && pathname === '/v1/integrations/stripe/backfill') {
      try {
        const auth = await requireAuthenticatedTenant(req);
        if (auth.ok === false) {
          res.writeHead(auth.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: auth.message }));
          return;
        }
        const tenantId = auth.tenantId;

        // Get encrypted API key
        const keyResult = await pool.query(
          `SELECT credentials_encrypted FROM tenant_integrations
           WHERE tenant_id = $1 AND service = 'stripe' AND status = 'connected'`,
          [tenantId],
        );
        if (!keyResult.rows[0]?.credentials_encrypted) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No Stripe API key connected' }));
          return;
        }

        const { decryptCredential } = await import('./crypto-utils.js');
        let apiKey;
        try {
          apiKey = decryptCredential(keyResult.rows[0].credentials_encrypted);
        } catch (err: any) {
          log('error', `Stripe backfill blocked: ${err.message}`);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Stored Stripe credential cannot be decrypted securely' }));
          return;
        }

        const leaseResult = await pool.query(
          `UPDATE tenant_integrations
           SET metadata = metadata || '{"status": "backfilling"}'::jsonb, updated_at = now()
           WHERE tenant_id = $1
             AND service = 'stripe'
             AND COALESCE(metadata->>'status', '') != 'backfilling'
           RETURNING id`,
          [tenantId],
        );
        if (leaseResult.rowCount === 0) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Stripe backfill already in progress' }));
          return;
        }

        // Fetch and ingest in background — respond immediately
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'backfill_started' }));

        // Background backfill
        backfillStripeData(pool, tenantId, apiKey, log).catch((err: any) => {
          log('error', `Stripe backfill failed for ${tenantId}: ${err.message}`);
        });
      } catch (err: any) {
        log('error', `Stripe backfill error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to start backfill' }));
      }
      return;
    }

    // --- Stripe diagnostic scans ---
    if (req.method === 'POST' && pathname === '/v1/integrations/stripe/scans') {
      try {
        const auth = await requireAuthenticatedTenant(req);
        if (auth.ok === false) {
          res.writeHead(auth.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: auth.message }));
          return;
        }
        const tenantId = auth.tenantId;

        await pool.query(
          `UPDATE tenant_stripe_scans
           SET status = 'failed',
               error_message = 'Scan timed out before completion',
               completed_at = now(),
               updated_at = now()
           WHERE tenant_id = $1
             AND status IN ('pending', 'processing')
             AND started_at < $2::timestamptz`,
          [tenantId, new Date(Date.now() - ACTIVE_STRIPE_SCAN_TIMEOUT_MS).toISOString()],
        );

        const activeScanResult = await pool.query(
          `SELECT scan_id, status
           FROM tenant_stripe_scans
           WHERE tenant_id = $1
             AND status IN ('pending', 'processing')
           ORDER BY started_at DESC
           LIMIT 1`,
          [tenantId],
        );
        const activeScan = activeScanResult.rows[0] ?? null;
        if (activeScan?.scan_id) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Stripe scan already in progress',
            scanId: activeScan.scan_id,
            status: activeScan.status,
          }));
          return;
        }

        const integrationResult = await pool.query(
          `SELECT credentials_encrypted
           FROM tenant_integrations
           WHERE tenant_id = $1 AND service = 'stripe' AND status = 'connected'`,
          [tenantId],
        );
        const encryptedCredential = integrationResult.rows[0]?.credentials_encrypted ?? null;
        if (!encryptedCredential) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No Stripe API key connected' }));
          return;
        }

        const scanId = createStripeScanId();
        await pool.query(
          `INSERT INTO tenant_stripe_scans (scan_id, tenant_id, status, lookback_days, started_at, updated_at)
           VALUES ($1, $2, 'pending', $3, now(), now())`,
          [scanId, tenantId, DEFAULT_STRIPE_SCAN_LOOKBACK_DAYS],
        );

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ scanId, status: 'pending' }));

        runStripeScan({
          pool,
          scanId,
          tenantId,
          encryptedCredential,
          log,
        }).catch((err: any) => {
          log('error', `Stripe scan execution failed for ${tenantId}/${scanId}: ${err.message}`);
        });
      } catch (err: any) {
        if (err?.code === '23505') {
          const auth = await requireAuthenticatedTenant(req);
          if (auth.ok === false) {
            res.writeHead(auth.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: auth.message }));
            return;
          }

          const activeScanResult = await pool.query(
            `SELECT scan_id, status
             FROM tenant_stripe_scans
             WHERE tenant_id = $1
               AND status IN ('pending', 'processing')
             ORDER BY started_at DESC
             LIMIT 1`,
            [auth.tenantId],
          );
          const activeScan = activeScanResult.rows[0] ?? null;
          if (activeScan?.scan_id) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Stripe scan already in progress',
              scanId: activeScan.scan_id,
              status: activeScan.status,
            }));
            return;
          }
        }
        log('error', `Stripe scan start error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to start Stripe scan' }));
      }
      return;
    }

    const stripeScanMatch = pathname.match(/^\/v1\/integrations\/stripe\/scans\/([^/]+)$/);
    if (req.method === 'GET' && stripeScanMatch) {
      try {
        const auth = await requireAuthenticatedTenant(req);
        if (auth.ok === false) {
          res.writeHead(auth.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: auth.message }));
          return;
        }
        const tenantId = auth.tenantId;
        const scanId = stripeScanMatch[1];

        const scanResult = await pool.query(
          `SELECT scan_id, status, lookback_days, started_at, completed_at, error_message, result_payload
           FROM tenant_stripe_scans
           WHERE tenant_id = $1 AND scan_id = $2`,
          [tenantId, scanId],
        );
        const scan = scanResult.rows[0] ?? null;
        if (!scan) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Stripe scan not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          scan_id: scan.scan_id,
          status: scan.status,
          lookback_days: scan.lookback_days,
          started_at: scan.started_at,
          completed_at: scan.completed_at,
          error_message: scan.error_message,
          result_payload: scan.result_payload,
        }));
      } catch (err: any) {
        log('error', `Stripe scan read error: ${err.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load Stripe scan' }));
      }
      return;
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
      handleIntegrationStatus(req, res, pool);
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
