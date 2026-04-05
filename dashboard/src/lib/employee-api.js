/**
 * Employee API client for dashboard views.
 *
 * Wraps fetch calls to /v1/employees/* and related endpoints.
 * Follows the same patterns as world-api.js.
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

async function employeeApi(path, options = {}) {
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
// Employees
// ---------------------------------------------------------------------------

/**
 * Hire a new employee (provision a role-scoped agent).
 * @param {{ roleId: string, employeeName: string, boundaries: object }} params
 */
export async function hireEmployee({ roleId, employeeName, boundaries }) {
  return employeeApi('/v1/employees', {
    method: 'POST',
    body: { roleId, employeeName, boundaries },
  });
}

/**
 * Get the employee dashboard summary (actions taken, savings, queue depth, etc.).
 * @param {string} employeeId
 */
export async function getEmployeeSummary(employeeId) {
  return employeeApi(`/v1/employees/${employeeId}/summary`);
}

/**
 * Check if an employee exists for this tenant. Returns null if none found.
 */
export async function getActiveEmployee() {
  try {
    return await employeeApi('/v1/employees/active');
  } catch (err) {
    // 404 means no employee yet — not an error condition for callers
    if (err.message && err.message.includes('404')) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Onboarding / Object Counts
// ---------------------------------------------------------------------------

/**
 * Get object counts for onboarding progress display.
 */
export async function getObjectCounts() {
  return employeeApi('/v1/world/objects/count');
}

// ---------------------------------------------------------------------------
// Stripe Integration
// ---------------------------------------------------------------------------

/**
 * Connect a Stripe API key for this tenant.
 * @param {string} apiKey  — sk_live_ or sk_test_ key
 */
export async function connectStripe(apiKey) {
  return employeeApi('/v1/integrations/stripe/key', {
    method: 'POST',
    body: { apiKey },
  });
}

/**
 * Trigger a historical Stripe data backfill for this tenant.
 */
export async function triggerBackfill() {
  return employeeApi('/v1/integrations/stripe/backfill', {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Escrow / Action Approvals
// ---------------------------------------------------------------------------

/**
 * Approve an escrowed action — execute it.
 * @param {string} actionId
 */
export async function approveAction(actionId) {
  return employeeApi(`/v1/world/escrow/${actionId}/release`, {
    method: 'POST',
    body: { decision: 'execute' },
  });
}

/**
 * Reject an escrowed action — discard it.
 * @param {string} actionId
 */
export async function rejectAction(actionId) {
  return employeeApi(`/v1/world/escrow/${actionId}/release`, {
    method: 'POST',
    body: { decision: 'reject' },
  });
}

// ---------------------------------------------------------------------------
// Object Detail
// ---------------------------------------------------------------------------

/**
 * Get a single object with its related objects and event history.
 * Used by the AR collections account brief view.
 * @param {string} objectId
 */
export async function getAccountBrief(objectId) {
  return employeeApi(`/v1/world/objects/${objectId}?include=related,events`);
}
