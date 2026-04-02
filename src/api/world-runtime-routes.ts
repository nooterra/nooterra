/**
 * World Runtime API Routes — HTTP endpoints for the new modules.
 *
 * These expose the event ledger, object graph, predictions, coverage map,
 * planner, and gateway to the dashboard and external consumers.
 *
 * All routes require x-tenant-id header for tenant isolation.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { queryEvents, countEvents, getObjectHistory } from '../ledger/event-store.js';
import { queryObjects, getObject, getRelated, assembleContext, countObjects } from '../objects/graph.js';
import { predictAll } from '../world-model/ensemble.js';
import { generateReactivePlan } from '../planner/planner.js';
import { coverageMap } from '../bridge.js';
import { generateProposals } from '../eval/coverage.js';
import { generateOptimizationReport } from '../agents/optimizer.js';
import { getPendingEscrow, releaseEscrow } from '../gateway/gateway.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function getTenantId(req: IncomingMessage): string | null {
  return (req.headers['x-tenant-id'] as string) || null;
}

function getSearchParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  return url.searchParams;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Handle world runtime routes. Returns true if the route was handled.
 */
export async function handleWorldRuntimeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pool: pg.Pool,
  pathname: string,
): Promise<boolean> {
  const tenantId = getTenantId(req);
  const params = getSearchParams(req);

  // --- Events ---

  if (req.method === 'GET' && pathname === '/v1/world/events') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    const events = await queryEvents(pool, {
      tenantId,
      types: params.get('types')?.split(',').filter(Boolean),
      domains: params.get('domains')?.split(',').filter(Boolean),
      objectId: params.get('objectId') || undefined,
      after: params.get('after') ? new Date(params.get('after')!) : undefined,
      before: params.get('before') ? new Date(params.get('before')!) : undefined,
      traceId: params.get('traceId') || undefined,
      limit: parseInt(params.get('limit') || '50'),
      offset: parseInt(params.get('offset') || '0'),
    });

    const total = await countEvents(pool, { tenantId });
    json(res, { events, total });
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/v1/world/events/') && pathname.split('/').length === 5) {
    const eventId = pathname.split('/')[4];
    const { getEvent } = await import('../ledger/event-store.js');
    const event = await getEvent(pool, eventId!);
    if (!event) return error(res, 'Event not found', 404), true;
    json(res, event);
    return true;
  }

  // --- Objects ---

  if (req.method === 'GET' && pathname === '/v1/world/objects') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    const type = params.get('type') || undefined;
    const limit = parseInt(params.get('limit') || '100');
    const offset = parseInt(params.get('offset') || '0');

    const objects = await queryObjects(pool, tenantId, type as any, limit, offset);
    const total = await countObjects(pool, tenantId, type as any);
    json(res, { objects, total });
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/v1/world/objects/') && !pathname.includes('/related') && !pathname.includes('/history') && !pathname.includes('/context')) {
    const objectId = pathname.split('/')[4];
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const obj = await getObject(pool, objectId);
    if (!obj) return error(res, 'Object not found', 404), true;
    json(res, obj);
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/related$/)) {
    const objectId = pathname.split('/')[4];
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const relType = params.get('type') || undefined;
    const related = await getRelated(pool, objectId, relType as any);
    json(res, related);
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/history$/)) {
    const objectId = pathname.split('/')[4];
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const history = await getObjectHistory(pool, tenantId!, objectId);
    json(res, history);
    return true;
  }

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/context$/)) {
    const objectId = pathname.split('/')[4];
    if (!objectId) return error(res, 'Missing object ID', 400), true;
    const depth = parseInt(params.get('depth') || '1');
    const context = await assembleContext(pool, objectId, depth);
    if (!context) return error(res, 'Object not found', 404), true;
    json(res, context);
    return true;
  }

  // --- Predictions ---

  if (req.method === 'GET' && pathname.match(/^\/v1\/world\/objects\/[^/]+\/predictions$/)) {
    const objectId = pathname.split('/')[4];
    if (!tenantId || !objectId) return error(res, 'Missing tenant or object ID', 400), true;
    const predictions = await predictAll(pool, tenantId, objectId);
    json(res, predictions);
    return true;
  }

  // --- Coverage Map ---

  if (req.method === 'GET' && pathname === '/v1/world/coverage') {
    const agentId = params.get('agentId');
    const coverage = agentId
      ? coverageMap.getAgentCoverage(agentId)
      : coverageMap.getAllCoverage();
    json(res, coverage);
    return true;
  }

  if (req.method === 'GET' && pathname === '/v1/world/coverage/proposals') {
    const proposals = generateProposals(coverageMap);
    json(res, proposals);
    return true;
  }

  // --- Planner ---

  if (req.method === 'GET' && pathname === '/v1/world/plan') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const plan = await generateReactivePlan(pool, tenantId);
    json(res, plan);
    return true;
  }

  // --- Gateway / Escrow ---

  if (req.method === 'GET' && pathname === '/v1/world/escrow') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;
    const pending = await getPendingEscrow(pool, tenantId);
    json(res, pending);
    return true;
  }

  if (req.method === 'POST' && pathname.match(/^\/v1\/world\/escrow\/[^/]+\/release$/)) {
    const actionId = pathname.split('/')[4];
    if (!actionId) return error(res, 'Missing action ID', 400), true;

    const body = JSON.parse(await readBody(req));
    const decision = body.decision as 'execute' | 'reject';
    const decidedBy = body.decidedBy || 'human';

    if (!decision || !['execute', 'reject'].includes(decision)) {
      return error(res, 'Invalid decision (must be "execute" or "reject")', 400), true;
    }

    const result = await releaseEscrow(pool, actionId, decision, decidedBy);
    json(res, result);
    return true;
  }

  // --- Optimization Report ---

  if (req.method === 'GET' && pathname === '/v1/world/optimize') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    const report = generateOptimizationReport(
      tenantId,
      coverageMap,
      [], // agent configs would come from workers table
      0,  // pending escrow count
    );
    json(res, report);
    return true;
  }

  // --- Stats ---

  if (req.method === 'GET' && pathname === '/v1/world/stats') {
    if (!tenantId) return error(res, 'Missing x-tenant-id', 400), true;

    const [eventCount, objectCount] = await Promise.all([
      countEvents(pool, { tenantId }),
      countObjects(pool, tenantId),
    ]);

    const coverage = coverageMap.getAllCoverage();
    const autonomousCells = coverage.filter(c => c.currentLevel === 'autonomous');

    json(res, {
      eventCount,
      objectCount,
      coverageCells: coverage.length,
      autonomousCells: autonomousCells.length,
      totalExecutionsTracked: coverage.reduce((s, c) => s + c.totalExecutions, 0),
    });
    return true;
  }

  return false; // Route not handled
}
