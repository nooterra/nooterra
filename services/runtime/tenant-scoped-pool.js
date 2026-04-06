/**
 * Tenant-scoped database query wrapper.
 *
 * Defense-in-depth for multi-tenancy: every query runs inside a transaction
 * that sets nooterra.current_tenant_id via SET LOCAL, activating Postgres
 * Row-Level Security (RLS) policies.
 *
 * Application-level WHERE tenant_id = $1 stays as the primary filter.
 * RLS is the safety net that catches any query that forgets the filter.
 *
 * Usage:
 *   const result = await tenantQuery(pool, tenantId,
 *     'SELECT * FROM world_objects WHERE tenant_id = $1', [tenantId]
 *   );
 */

/**
 * Execute a query with RLS tenant context set.
 * Acquires a client from the pool, sets the tenant context, runs the query,
 * and releases the client — all within a single transaction.
 *
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function tenantQuery(pool, tenantId, sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('nooterra.current_tenant_id', $1, true)", [tenantId]);
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute multiple queries within a single tenant-scoped transaction.
 *
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function tenantTransaction(pool, tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('nooterra.current_tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Set statement timeout on a pool to prevent runaway queries.
 * Call once at startup.
 *
 * @param {import('pg').Pool} pool
 * @param {number} timeoutMs
 */
export function setPoolStatementTimeout(pool, timeoutMs = 30000) {
  pool.on('connect', (client) => {
    client.query(`SET statement_timeout = ${parseInt(String(timeoutMs), 10)}`).catch(() => {});
  });
}
