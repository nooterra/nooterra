import type pg from 'pg';

export async function isExecutionHalted(pool: pg.Pool, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT enabled FROM kill_switch
     WHERE enabled = true
       AND (scope = 'global' OR (scope = 'tenant' AND tenant_id = $1))
     LIMIT 1`,
    [tenantId],
  );
  return result.rows.length > 0;
}

export async function setKillSwitch(
  pool: pg.Pool,
  opts: { enabled: boolean; scope?: 'global' | 'tenant'; tenantId?: string; reason?: string; enabledBy?: string },
): Promise<void> {
  const scope = opts.scope ?? 'global';
  const tenantId = scope === 'tenant' ? opts.tenantId ?? null : null;
  const now = new Date();

  await pool.query(
    `INSERT INTO kill_switch (scope, tenant_id, enabled, reason, enabled_by, enabled_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (scope, COALESCE(tenant_id, '__global__'))
     DO UPDATE SET enabled = $3, reason = $4, enabled_by = $5,
       enabled_at = CASE WHEN $3 = true THEN $6 ELSE kill_switch.enabled_at END,
       updated_at = $6`,
    [scope, tenantId, opts.enabled, opts.reason ?? null, opts.enabledBy ?? null, now],
  );
}

export async function getKillSwitchStatus(pool: pg.Pool): Promise<Array<{
  scope: string;
  tenantId: string | null;
  enabled: boolean;
  reason: string | null;
  enabledAt: Date | null;
}>> {
  const result = await pool.query(
    `SELECT scope, tenant_id, enabled, reason, enabled_at FROM kill_switch ORDER BY scope, tenant_id`,
  );
  return result.rows.map(r => ({
    scope: r.scope,
    tenantId: r.tenant_id,
    enabled: r.enabled,
    reason: r.reason,
    enabledAt: r.enabled_at,
  }));
}
