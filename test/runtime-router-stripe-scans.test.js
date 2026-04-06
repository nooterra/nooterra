import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createRequestHandler } from '../services/runtime/router.ts';

function makeReq(method, path, body, headers = {}) {
  const chunks = body == null ? [] : [typeof body === 'string' ? body : JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  req.headers = { host: 'runtime.test', ...headers };
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(payload = '') {
      this.body = String(payload);
      this.ended = true;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

function createHandler(pool) {
  return createRequestHandler({
    pool,
    log: () => {},
    getActiveExecutions: () => 0,
    getRunningWorkers: () => new Set(),
    handleWorkerChat: async () => {},
  });
}

function installFetchMock(fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('stripe scan route rejects x-tenant-id mismatch against authenticated tenant', async () => {
  const pool = {
    async query() {
      throw new Error('query should not run');
    },
  };

  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_session', email: 'owner@example.test', role: 'admin' },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq('POST', '/v1/integrations/stripe/scans', '', {
      cookie: 'ml_buyer_session=session_123',
      'x-tenant-id': 'tenant_other',
    });
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 403);
    assert.match(res.body, /Authenticated tenant does not match x-tenant-id/);
  } finally {
    restoreFetch();
  }
});

test('stripe scan route returns 400 when no Stripe integration is connected', async () => {
  const pool = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (sql.includes('FROM tenant_stripe_scans') && sql.includes("status IN ('pending', 'processing')")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM tenant_integrations')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_scan', email: 'owner@example.test', role: 'admin' },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq('POST', '/v1/integrations/stripe/scans', '', {
      cookie: 'ml_buyer_session=session_123',
    });
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body, /No Stripe API key connected/);
  } finally {
    restoreFetch();
  }
});

test('stripe scan route returns 409 when a scan is already in progress', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM tenant_stripe_scans') && sql.includes("status IN ('pending', 'processing')")) {
        return { rowCount: 1, rows: [{ scan_id: 'scn_existing', status: 'processing' }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_scan', email: 'owner@example.test', role: 'admin' },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq('POST', '/v1/integrations/stripe/scans', '', {
      cookie: 'ml_buyer_session=session_123',
    });
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /already in progress/);
    assert.match(res.body, /scn_existing/);
  } finally {
    restoreFetch();
  }
});

test('stripe scan route returns 202 and creates a pending scan', async () => {
  const pool = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (sql.includes('FROM tenant_stripe_scans') && sql.includes("status IN ('pending', 'processing')")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM tenant_integrations')) {
        return { rowCount: 1, rows: [{ credentials_encrypted: 'sk_test_connected' }] };
      }
      if (sql.startsWith('INSERT INTO tenant_stripe_scans')) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith('UPDATE tenant_stripe_scans')) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const restoreFetch = installFetchMock(async (url) => {
    const href = String(url);
    if (href.includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_scan', email: 'owner@example.test', role: 'admin' },
          };
        },
      };
    }
    if (href === 'https://api.stripe.com/v1/balance') {
      return {
        ok: true,
        async json() {
          return { object: 'balance' };
        },
      };
    }
    return {
      ok: true,
      async json() {
        return { data: [], has_more: false };
      },
    };
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq('POST', '/v1/integrations/stripe/scans', '', {
      cookie: 'ml_buyer_session=session_123',
    });
    const res = makeRes();

    await handler(req, res);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(res.statusCode, 202);
    const payload = JSON.parse(res.body);
    assert.equal(payload.status, 'pending');
    assert.match(payload.scanId, /^scn_[a-f0-9]{16}$/);
    assert.ok(pool.queries.some((entry) => entry.sql.startsWith('INSERT INTO tenant_stripe_scans')));
  } finally {
    restoreFetch();
  }
});

test('stripe scan read route scopes results to the authenticated tenant', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM tenant_stripe_scans')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const restoreFetch = installFetchMock(async (url) => {
    if (String(url).includes('/v1/buyer/me')) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            principal: { tenantId: 'tenant_scan', email: 'owner@example.test', role: 'admin' },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq('GET', '/v1/integrations/stripe/scans/scn_other', '', {
      cookie: 'ml_buyer_session=session_123',
    });
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 404);
    assert.match(res.body, /not found/i);
  } finally {
    restoreFetch();
  }
});
