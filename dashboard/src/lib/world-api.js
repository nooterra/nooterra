/**
 * World Runtime API client for dashboard views.
 *
 * Wraps fetch calls to /v1/world/* endpoints.
 * World-model views should render truthful empty states instead of synthetic demo data.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

function getTenantId() {
  try {
    const runtime = JSON.parse(localStorage.getItem('nooterra_product_runtime_v1') || '{}');
    return runtime.tenantId || null;
  } catch {
    return null;
  }
}

export async function worldApi(path, options = {}) {
  const tenantId = getTenantId();
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Event Ledger
// ---------------------------------------------------------------------------

export async function getEvents(params = {}) {
  const query = new URLSearchParams();
  if (params.types) query.set('types', params.types.join(','));
  if (params.domains) query.set('domains', params.domains.join(','));
  if (params.objectId) query.set('objectId', params.objectId);
  if (params.traceId) query.set('traceId', params.traceId);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return worldApi(`/v1/world/events?${query}`);
}

export async function getEvent(eventId) {
  return worldApi(`/v1/world/events/${eventId}`);
}

// ---------------------------------------------------------------------------
// Object Graph
// ---------------------------------------------------------------------------

export async function getObjects(params = {}) {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.q) query.set('q', params.q);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  return worldApi(`/v1/world/objects?${query}`);
}

export async function getObject(objectId) {
  return worldApi(`/v1/world/objects/${objectId}`);
}

export async function getRelated(objectId, type) {
  const query = type ? `?type=${type}` : '';
  return worldApi(`/v1/world/objects/${objectId}/related${query}`);
}

export async function getObjectHistory(objectId) {
  return worldApi(`/v1/world/objects/${objectId}/history`);
}

export async function getObjectContext(objectId, depth = 1) {
  return worldApi(`/v1/world/objects/${objectId}/context?depth=${depth}`);
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export async function getPredictions(objectId) {
  return worldApi(`/v1/world/objects/${objectId}/predictions`);
}

// ---------------------------------------------------------------------------
// Coverage Map
// ---------------------------------------------------------------------------

export async function getCoverage(agentId) {
  const query = agentId ? `?agentId=${agentId}` : '';
  return worldApi(`/v1/world/coverage${query}`);
}

export async function getCoverageProposals() {
  return worldApi('/v1/world/coverage/proposals');
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export async function getPlan() {
  return worldApi('/v1/world/plan');
}

// ---------------------------------------------------------------------------
// Gateway / Escrow
// ---------------------------------------------------------------------------

export async function getEscrowQueue() {
  return worldApi('/v1/world/escrow');
}

export async function releaseEscrow(actionId, decision) {
  return worldApi(`/v1/world/escrow/${actionId}/release`, {
    method: 'POST',
    body: { decision },
  });
}

// ---------------------------------------------------------------------------
// Optimization
// ---------------------------------------------------------------------------

export async function getOptimizationReport() {
  return worldApi('/v1/world/optimize');
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getWorldStats() {
  return worldApi('/v1/world/stats');
}

export async function getWorldOverview() {
  return worldApi('/v1/world/overview');
}

export async function launchCollectionsRuntime(payload = {}) {
  return worldApi('/v1/world/runtimes/ar-collections', {
    method: 'POST',
    body: payload,
  });
}

// ---------------------------------------------------------------------------
// Policy Runtime
// ---------------------------------------------------------------------------

export async function getRuntimePolicy() {
  return worldApi('/v1/workers/runtime-policy');
}

export async function putRuntimePolicy(policy) {
  return worldApi('/v1/workers/runtime-policy', {
    method: 'PUT',
    body: policy,
  });
}

// ---------------------------------------------------------------------------
// Integration Status
// ---------------------------------------------------------------------------

export async function getIntegrationStatus() {
  return worldApi('/v1/integrations/status');
}
