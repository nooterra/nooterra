/**
 * Session-based authentication for runtime services.
 *
 * SECURITY MODEL:
 *   - In production: session cookie is the ONLY source of identity.
 *     x-tenant-id header is IGNORED for auth. It may be used for
 *     cross-checking but never as a primary identity source.
 *   - In development (NODE_ENV !== 'production'): header fallback
 *     is allowed ONLY if DEV_ALLOW_HEADER_AUTH=true is explicitly set.
 *
 * Every authenticated request returns a Principal with tenantId, userId,
 * and email. The userId is the audit-trail identity for all write operations.
 */

const MAGIC_LINK_URL = process.env.MAGIC_LINK_INTERNAL_URL || process.env.MAGIC_LINK_URL || 'http://localhost:3001';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DEV_HEADER_AUTH_ENABLED = !IS_PRODUCTION && process.env.DEV_ALLOW_HEADER_AUTH === 'true';

/**
 * @typedef {{ tenantId: string; userId: string; email: string; role: string; source: 'session' | 'dev_header' }} Principal
 */

/**
 * Validate the session cookie against the magic-link service.
 * Returns the verified principal or null.
 */
export async function validateSession(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie) return null;

  try {
    const res = await fetch(`${MAGIC_LINK_URL}/v1/buyer/me`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok || !data.principal?.tenantId) return null;
    return {
      tenantId: data.principal.tenantId,
      userId: data.principal.userId || data.principal.email || 'unknown',
      email: data.principal.email || '',
      role: data.principal.role || 'member',
      source: 'session',
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the authenticated principal for a request.
 *
 * Production: session-only. No header fallback.
 * Development: session first, then header fallback if DEV_ALLOW_HEADER_AUTH=true.
 *
 * @returns {Promise<Principal | null>}
 */
export async function getAuthenticatedPrincipal(req) {
  // Always try session first
  const session = await validateSession(req);
  if (session) return session;

  // Development-only header fallback (must be explicitly opted in)
  if (DEV_HEADER_AUTH_ENABLED) {
    const h = req.headers['x-tenant-id'];
    if (h && h.trim()) {
      return {
        tenantId: h.trim(),
        userId: req.headers['x-user-email'] || 'dev-header-user',
        email: req.headers['x-user-email'] || '',
        role: 'admin',
        source: 'dev_header',
      };
    }
  }

  return null;
}

/**
 * Legacy compatibility — returns tenantId string or null.
 * Prefer getAuthenticatedPrincipal for new code.
 */
export async function getAuthenticatedTenantId(req) {
  const principal = await getAuthenticatedPrincipal(req);
  return principal?.tenantId || null;
}

/**
 * Extract tenant ID from x-proxy-tenant-id header (for internal service-to-service calls only).
 * This should ONLY be used by the world-runtime route handler when called from
 * the proxy layer, never for direct client requests.
 *
 * @returns {string | null}
 */
export function getProxyTenantId(req) {
  const h = req.headers['x-proxy-tenant-id'] || req.headers['x-tenant-id'];
  return (typeof h === 'string' && h.trim()) ? h.trim() : null;
}
