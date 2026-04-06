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

test('stripe key route rejects x-tenant-id mismatch against authenticated tenant', async () => {
  const pool = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  };
  let stripeCalls = 0;
  const restoreFetch = installFetchMock(async (url) => {
    const href = String(url);
    if (href.includes('/v1/buyer/me')) {
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
    if (href === 'https://api.stripe.com/v1/balance') {
      stripeCalls++;
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq(
      'POST',
      '/v1/integrations/stripe/key',
      { apiKey: 'sk_live_test_123' },
      {
        cookie: 'ml_buyer_session=session_123',
        'x-tenant-id': 'tenant_other',
      },
    );
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 403);
    assert.match(res.body, /Authenticated tenant does not match x-tenant-id/);
    assert.equal(pool.queries.length, 0);
    assert.equal(stripeCalls, 0);
  } finally {
    restoreFetch();
  }
});

test('stripe key route fails closed when secure credential storage is unavailable in production', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const originalAllowInsecure = process.env.ALLOW_INSECURE_CREDENTIALS;
  process.env.NODE_ENV = 'production';
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.ALLOW_INSECURE_CREDENTIALS;

  const pool = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
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
            principal: { tenantId: 'tenant_secure', email: 'owner@example.test', role: 'admin' },
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
    throw new Error(`Unexpected fetch: ${href}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq(
      'POST',
      '/v1/integrations/stripe/key',
      { apiKey: 'sk_live_test_123' },
      { cookie: 'ml_buyer_session=session_123' },
    );
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Secure credential storage is not configured/);
    assert.equal(pool.queries.length, 0);
  } finally {
    restoreFetch();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalEncryptionKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey;
    if (originalAllowInsecure === undefined) delete process.env.ALLOW_INSECURE_CREDENTIALS;
    else process.env.ALLOW_INSECURE_CREDENTIALS = originalAllowInsecure;
  }
});

test('stripe backfill route rejects x-tenant-id mismatch against authenticated tenant', async () => {
  const pool = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
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
            principal: { tenantId: 'tenant_session', email: 'owner@example.test', role: 'admin' },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq(
      'POST',
      '/v1/integrations/stripe/backfill',
      '',
      {
        cookie: 'ml_buyer_session=session_123',
        'x-tenant-id': 'tenant_other',
      },
    );
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 403);
    assert.match(res.body, /Authenticated tenant does not match x-tenant-id/);
    assert.equal(pool.queries.length, 0);
  } finally {
    restoreFetch();
  }
});

test('stripe backfill route returns 409 when a backfill is already in progress', async () => {
  const pool = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (sql.includes('SELECT credentials_encrypted FROM tenant_integrations')) {
        return { rowCount: 1, rows: [{ credentials_encrypted: 'sk_test_existing_key' }] };
      }
      if (sql.includes("metadata->>'status'") && sql.includes("RETURNING id")) {
        return { rowCount: 0, rows: [] };
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
            principal: { tenantId: 'tenant_busy', email: 'owner@example.test', role: 'admin' },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  try {
    const handler = createHandler(pool);
    const req = makeReq(
      'POST',
      '/v1/integrations/stripe/backfill',
      '',
      { cookie: 'ml_buyer_session=session_123' },
    );
    const res = makeRes();

    await handler(req, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /already in progress/);
  } finally {
    restoreFetch();
  }
});
