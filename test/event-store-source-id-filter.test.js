import test from 'node:test';
import assert from 'node:assert/strict';

import { queryEvents } from '../src/ledger/event-store.ts';

// Mock pool that captures the SQL and params passed to pool.query
function makeMockPool(rows = []) {
  const calls = [];
  const pool = {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      return Promise.resolve({ rows });
    },
  };
  return pool;
}

test('event-store: queryEvents includes source_id condition when sourceId filter is set', async () => {
  const pool = makeMockPool([]);
  const filter = {
    tenantId: 'tenant_test',
    sourceId: 'agent_abc',
  };

  await queryEvents(pool, filter);

  assert.equal(pool.calls.length, 1, 'pool.query should be called once');
  const { sql, params } = pool.calls[0];

  assert.ok(
    sql.includes('source_id = $'),
    `SQL should contain source_id condition, got: ${sql}`,
  );
  assert.ok(
    params.includes('agent_abc'),
    `params should include the sourceId value, got: ${JSON.stringify(params)}`,
  );
});

test('event-store: queryEvents omits source_id condition when sourceId filter is not set', async () => {
  const pool = makeMockPool([]);
  const filter = {
    tenantId: 'tenant_test',
  };

  await queryEvents(pool, filter);

  assert.equal(pool.calls.length, 1, 'pool.query should be called once');
  const { sql } = pool.calls[0];

  assert.ok(
    !sql.includes('source_id'),
    `SQL should not contain source_id condition, got: ${sql}`,
  );
});

test('event-store: queryEvents assigns correct positional param index for sourceId alongside other filters', async () => {
  const pool = makeMockPool([]);
  const filter = {
    tenantId: 'tenant_test',
    types: ['payment.created'],
    objectId: 'obj_123',
    sourceId: 'agent_xyz',
    after: new Date('2026-01-01'),
  };

  await queryEvents(pool, filter);

  const { sql, params } = pool.calls[0];

  // tenant_id = $1, type = ANY($2), object_refs @> $3, source_id = $4, timestamp >= $5
  const sourceIdMatch = sql.match(/source_id = \$(\d+)/);
  assert.ok(sourceIdMatch, `SQL should contain source_id = $N, got: ${sql}`);

  const sourceIdParamIndex = parseInt(sourceIdMatch[1], 10) - 1; // 0-based
  assert.equal(
    params[sourceIdParamIndex],
    'agent_xyz',
    `param at source_id position should be 'agent_xyz', got: ${params[sourceIdParamIndex]}`,
  );
});
