/**
 * Session-based authentication for scheduler services.
 * Validates the magic-link session cookie by calling the magic-link service.
 */

const MAGIC_LINK_URL = process.env.MAGIC_LINK_INTERNAL_URL || process.env.MAGIC_LINK_URL || 'http://localhost:3001';

export async function validateSession(req) {
  const cookie = req.headers.cookie || '';
  if (!cookie) return { ok: false };

  try {
    const res = await fetch(`${MAGIC_LINK_URL}/v1/buyer/me`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (!data.ok || !data.principal?.tenantId) return { ok: false };
    return { ok: true, tenantId: data.principal.tenantId, email: data.principal.email, role: data.principal.role };
  } catch {
    return { ok: false };
  }
}

export async function getAuthenticatedTenantId(req) {
  // Session-based auth (browser callers with ml_buyer_session cookie)
  const session = await validateSession(req);
  if (session.ok) return session.tenantId;

  // Header-based auth only in non-production or when explicitly allowed
  if (process.env.NODE_ENV !== 'production' || process.env.SCHEDULER_ALLOW_HEADER_AUTH === 'true') {
    const h = req.headers['x-tenant-id'];
    if (h && h.trim()) return h.trim();
    const cookieHeader = req.headers.cookie || '';
    const m = cookieHeader.match(/(?:^|;\s*)tenant_id=([^;]+)/);
    if (m) return decodeURIComponent(m[1]).trim() || null;
  }

  return null;
}
