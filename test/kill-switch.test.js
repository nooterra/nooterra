import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Kill switch', () => {
  it('isExecutionHalted returns false when no kill switch row exists', async () => {
    const { isExecutionHalted } = await import('../src/gateway/kill-switch.ts');
    const pool = { query() { return { rows: [] }; } };
    const halted = await isExecutionHalted(pool, 'tenant_test');
    assert.equal(halted, false);
  });

  it('isExecutionHalted returns true when kill switch is enabled', async () => {
    const { isExecutionHalted } = await import('../src/gateway/kill-switch.ts');
    const pool = {
      query(sql) {
        if (sql.includes('kill_switch')) {
          return { rows: [{ enabled: true, scope: 'global' }] };
        }
        return { rows: [] };
      },
    };
    const halted = await isExecutionHalted(pool, 'tenant_test');
    assert.equal(halted, true);
  });

  it('isExecutionHalted returns true for tenant-specific kill switch', async () => {
    const { isExecutionHalted } = await import('../src/gateway/kill-switch.ts');
    const pool = {
      query(sql, params) {
        if (sql.includes('kill_switch')) {
          return { rows: [{ enabled: true, scope: 'tenant', tenant_id: 'tenant_test' }] };
        }
        return { rows: [] };
      },
    };
    const halted = await isExecutionHalted(pool, 'tenant_test');
    assert.equal(halted, true);
  });

  it('setKillSwitch writes to the database', async () => {
    const { setKillSwitch } = await import('../src/gateway/kill-switch.ts');
    const upserted = [];
    const pool = {
      query(sql, params) {
        if (sql.includes('INSERT') || sql.includes('UPDATE')) {
          upserted.push({ sql, params });
          return { rows: [{ enabled: params[1] ?? params[0] }] };
        }
        return { rows: [] };
      },
    };
    await setKillSwitch(pool, { enabled: true, scope: 'global', reason: 'test drill' });
    assert.equal(upserted.length, 1);
    assert.ok(upserted[0].sql.includes('kill_switch'));
  });
});
