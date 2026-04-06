import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { handleWorldRuntimeRoute } from '../src/api/world-runtime-routes.ts';

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function makeReq(method, path, headers = {}) {
  const req = Readable.from([]);
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
    },
  };
}

test('scorecard reads retraining status from retraining_state reports', async () => {
  const completedAt = '2026-04-01T00:00:00.000Z';
  const pool = {
    async query(sql, params = []) {
      const statement = normalize(sql);

      if (statement === 'SELECT action_class, COUNT(*)::int AS count FROM gateway_actions WHERE tenant_id = $1 AND created_at >= $2 GROUP BY action_class') {
        return {
          rowCount: 2,
          rows: [
            { action_class: 'communicate.email', count: 4 },
            { action_class: 'strategic.hold', count: 2 },
          ],
        };
      }

      if (statement === 'SELECT observation_status, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE objective_achieved = true)::int AS achieved FROM world_action_outcomes WHERE tenant_id = $1 AND created_at >= $2 GROUP BY observation_status') {
        return {
          rowCount: 2,
          rows: [
            { observation_status: 'observed', count: 3, achieved: 2 },
            { observation_status: 'pending', count: 1, achieved: 0 },
          ],
        };
      }

      if (statement === 'SELECT COUNT(*)::int AS count FROM gateway_actions WHERE tenant_id = $1 AND created_at >= $2 AND status IN (\'denied\', \'escrowed\') AND auth_decision = \'require_approval\'') {
        return { rowCount: 1, rows: [{ count: 1 }] };
      }

      if (statement.includes('COUNT(*)::int AS total') && statement.includes('COUNT(*) FILTER (WHERE status = \'executed\' AND auth_decision = \'require_approval\')')) {
        return { rowCount: 1, rows: [{ total: 3, approved: 2, rejected: 1 }] };
      }

      if (statement.includes('world_autonomy_coverage') && statement.includes('abstained')) {
        return { rowCount: 1, rows: [{ count: 2 }] };
      }

      if (statement === 'SELECT * FROM world_evaluation_reports WHERE tenant_id = $1 AND report_type = $2 AND subject_type = $3 AND subject_id = $4 LIMIT 1') {
        assert.deepEqual(params, ['tenant_scorecard', 'retraining_state', 'scheduler_job', 'weekly_retraining']);
        return {
          rowCount: 1,
          rows: [{
            report_id: 'eval_retraining',
            tenant_id: 'tenant_scorecard',
            report_type: 'retraining_state',
            subject_type: 'scheduler_job',
            subject_id: 'weekly_retraining',
            status: 'completed',
            schema_version: 'world.eval.retraining-state.v1',
            metrics: {},
            artifact: { lastCompletedAt: completedAt },
            created_at: new Date(completedAt),
            updated_at: new Date(completedAt),
          }],
        };
      }

      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };

  const req = makeReq('GET', '/v1/world/scorecard', { 'x-tenant-id': 'tenant_scorecard' });
  const res = makeRes();
  const handled = await handleWorldRuntimeRoute(req, res, pool, '/v1/world/scorecard');

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.summary.totalActions, 6);
  assert.equal(body.summary.totalHolds, 2);
  assert.equal(body.retraining.status, 'active');
  assert.equal(body.retraining.lastRetrainedAt, completedAt);
});
