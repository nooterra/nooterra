/**
 * Webhook idempotency guard.
 *
 * Prevents replayed webhooks from creating duplicate financial side effects.
 * Every webhook handler should call markProcessed() and check the return
 * before executing side effects.
 *
 * Usage:
 *   const { alreadyProcessed } = await markProcessed(pool, eventId, tenantId, 'stripe_billing', 'checkout.session.completed');
 *   if (alreadyProcessed) return; // skip — already handled
 */

/**
 * Attempt to mark a webhook event as processed.
 * Returns { alreadyProcessed: true } if the event was already in the table.
 * Returns { alreadyProcessed: false } if this is the first time.
 *
 * Uses INSERT ON CONFLICT DO NOTHING for atomicity.
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @param {string} tenantId
 * @param {string} source
 * @param {string} eventType
 * @returns {Promise<{ alreadyProcessed: boolean }>}
 */
export async function markProcessed(pool, eventId, tenantId, source, eventType) {
  const result = await pool.query(
    `INSERT INTO processed_webhook_events (event_id, tenant_id, source, event_type, processed_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, tenantId, source, eventType],
  );
  // rowCount = 1 means inserted (first time), 0 means conflict (already processed)
  return { alreadyProcessed: result.rowCount === 0 };
}

/**
 * Check if an event was already processed (read-only check).
 *
 * @param {import('pg').Pool} pool
 * @param {string} eventId
 * @returns {Promise<boolean>}
 */
export async function wasProcessed(pool, eventId) {
  const result = await pool.query(
    'SELECT 1 FROM processed_webhook_events WHERE event_id = $1',
    [eventId],
  );
  return result.rowCount > 0;
}
