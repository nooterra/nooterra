import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import {
  getDefaultTenantWorkerRuntimePolicy,
  getWorkerRuntimePolicyForTool,
  normalizeTenantWorkerRuntimePolicyOverrides,
  normalizeWorkerRuntimePolicyOverrides,
  resolveTenantWorkerRuntimePolicy,
  resolveWorkerRuntimePolicy,
} from "../services/runtime/runtime-policy-store.js";
import { handleWorkerRoute } from "../services/runtime/workers-api.js";

function makeReq(method, path, body = null, headers = {}) {
  const chunks = body == null ? [] : [typeof body === "string" ? body : JSON.stringify(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  req.headers = headers;
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload = "") {
      this.body = String(payload);
      this.ended = true;
    },
  };
}

function createRuntimePolicyPool() {
  const state = {
    tenantRow: null,
    workerRow: null,
  };

  function normalize(sql) {
    return String(sql).replace(/\s+/g, " ").trim();
  }

  return {
    state,
    async query(sql, params = []) {
      const statement = normalize(sql);
      if (statement === "SELECT policy, updated_at, updated_by FROM tenant_worker_runtime_policies WHERE tenant_id = $1") {
        return state.tenantRow
          ? { rowCount: 1, rows: [state.tenantRow] }
          : { rowCount: 0, rows: [] };
      }
      if (statement === "SELECT policy, updated_at, updated_by FROM worker_runtime_policy_overrides WHERE tenant_id = $1 AND worker_id = $2") {
        return state.workerRow
          ? { rowCount: 1, rows: [state.workerRow] }
          : { rowCount: 0, rows: [] };
      }
      if (statement === "SELECT id FROM workers WHERE id = $1 AND tenant_id = $2") {
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      if (statement.startsWith("INSERT INTO tenant_worker_runtime_policies")) {
        const [tenantId, policyJson, updatedBy] = params;
        state.tenantRow = {
          tenant_id: tenantId,
          policy: JSON.parse(policyJson),
          updated_at: "2026-03-31T12:00:00.000Z",
          updated_by: updatedBy || null,
        };
        return { rowCount: 1, rows: [state.tenantRow] };
      }
      if (statement.startsWith("INSERT INTO worker_runtime_policy_overrides")) {
        const [tenantId, workerId, policyJson, updatedBy] = params;
        state.workerRow = {
          tenant_id: tenantId,
          worker_id: workerId,
          policy: JSON.parse(policyJson),
          updated_at: "2026-03-31T13:00:00.000Z",
          updated_by: updatedBy || null,
        };
        return { rowCount: 1, rows: [state.workerRow] };
      }
      if (statement === "DELETE FROM tenant_worker_runtime_policies WHERE tenant_id = $1") {
        state.tenantRow = null;
        return { rowCount: 1, rows: [] };
      }
      if (statement === "DELETE FROM worker_runtime_policy_overrides WHERE tenant_id = $1 AND worker_id = $2") {
        state.workerRow = null;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unhandled SQL in runtime policy test: ${statement}`);
    },
  };
}

test("scheduler runtime policy store: resolves defaults with validated overrides", () => {
  const overrides = normalizeTenantWorkerRuntimePolicyOverrides({
    sideEffects: {
      autoPauseThreshold: 5,
    },
    approvals: {
      restrictThreshold: 4,
    },
    webhooks: {
      thresholds: {
        signatureFailuresPerProvider: 2,
      },
    },
  });
  const effective = resolveTenantWorkerRuntimePolicy(overrides);
  const defaults = getDefaultTenantWorkerRuntimePolicy();

  assert.equal(effective.sideEffects.autoPauseThreshold, 5);
  assert.equal(effective.approvals.restrictThreshold, 4);
  assert.equal(effective.webhooks.thresholds.signatureFailuresPerProvider, 2);
  assert.equal(effective.verification.autoPauseThreshold, defaults.verification.autoPauseThreshold);
});

test("scheduler runtime policy store: rejects unknown keys", () => {
  assert.throws(
    () => normalizeTenantWorkerRuntimePolicyOverrides({
      sideEffects: {
        nope: 1,
      },
    }),
    /unknown key/i
  );
});

test("scheduler runtime policy store: worker tool overrides win over worker and tenant base", () => {
  const resolved = resolveWorkerRuntimePolicy({
    tenantOverrides: {
      approvals: {
        restrictThreshold: 6,
      },
    },
    workerOverrides: normalizeWorkerRuntimePolicyOverrides({
      approvals: {
        restrictThreshold: 4,
      },
      tools: {
        send_email: {
          approvals: {
            restrictThreshold: 2,
          },
        },
      },
    }),
  });

  const sendEmailPolicy = getWorkerRuntimePolicyForTool(resolved, "send_email");
  const makePaymentPolicy = getWorkerRuntimePolicyForTool(resolved, "make_payment");

  assert.equal(sendEmailPolicy.approvals.restrictThreshold, 2);
  assert.equal(sendEmailPolicy.sources.approvals, "worker_tool");
  assert.equal(makePaymentPolicy.approvals.restrictThreshold, 4);
  assert.equal(makePaymentPolicy.sources.approvals, "worker");
});

test("scheduler runtime policy route: get returns defaults when no tenant override exists", async () => {
  const pool = createRuntimePolicyPool();
  const req = makeReq("GET", "/v1/workers/runtime-policy", null, {
    "x-tenant-id": "tenant_1",
  });
  const res = makeRes();
  const url = new URL(req.url, "http://localhost");

  const handled = await handleWorkerRoute(req, res, pool, url.pathname, url.searchParams);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);

  const payload = JSON.parse(res.body);
  assert.equal(payload.tenantId, "tenant_1");
  assert.deepEqual(payload.overrides, {});
  assert.equal(payload.effective.version, 1);
  assert.equal(payload.effective.webhooks.thresholds.signatureFailuresPerProvider, 3);
});

test("scheduler runtime policy route: put stores validated overrides and get returns effective policy", async () => {
  const pool = createRuntimePolicyPool();

  const putReq = makeReq("PUT", "/v1/workers/runtime-policy", {
    sideEffects: {
      autoPauseThreshold: 5,
    },
    webhooks: {
      thresholds: {
        signatureFailuresPerProvider: 2,
      },
      enforcement: {
        cooldownMinutes: 9,
      },
    },
  }, {
    "x-tenant-id": "tenant_1",
    "x-user-email": "ops@example.com",
  });
  const putRes = makeRes();
  const putUrl = new URL(putReq.url, "http://localhost");

  const putHandled = await handleWorkerRoute(putReq, putRes, pool, putUrl.pathname, putUrl.searchParams);
  assert.equal(putHandled, true);
  assert.equal(putRes.statusCode, 200);

  const putPayload = JSON.parse(putRes.body);
  assert.equal(putPayload.updatedBy, "ops@example.com");
  assert.equal(putPayload.overrides.sideEffects.autoPauseThreshold, 5);
  assert.equal(putPayload.effective.webhooks.thresholds.signatureFailuresPerProvider, 2);
  assert.equal(putPayload.effective.webhooks.enforcement.cooldownMinutes, 9);

  const getReq = makeReq("GET", "/v1/workers/runtime-policy", null, {
    "x-tenant-id": "tenant_1",
  });
  const getRes = makeRes();
  const getUrl = new URL(getReq.url, "http://localhost");
  await handleWorkerRoute(getReq, getRes, pool, getUrl.pathname, getUrl.searchParams);
  const getPayload = JSON.parse(getRes.body);
  assert.equal(getPayload.overrides.webhooks.thresholds.signatureFailuresPerProvider, 2);
  assert.equal(getPayload.effective.sideEffects.autoPauseThreshold, 5);
});

test("scheduler runtime policy route: put with empty object resets tenant overrides", async () => {
  const pool = createRuntimePolicyPool();
  pool.state.tenantRow = {
    tenant_id: "tenant_1",
    policy: {
      version: 1,
      approvals: {
        restrictThreshold: 7,
      },
    },
    updated_at: "2026-03-31T12:00:00.000Z",
    updated_by: "ops@example.com",
  };

  const putReq = makeReq("PUT", "/v1/workers/runtime-policy", {}, {
    "x-tenant-id": "tenant_1",
  });
  const putRes = makeRes();
  const putUrl = new URL(putReq.url, "http://localhost");
  await handleWorkerRoute(putReq, putRes, pool, putUrl.pathname, putUrl.searchParams);
  assert.equal(putRes.statusCode, 200);

  const payload = JSON.parse(putRes.body);
  assert.deepEqual(payload.overrides, {});
  assert.equal(payload.effective.approvals.restrictThreshold, getDefaultTenantWorkerRuntimePolicy().approvals.restrictThreshold);
  assert.equal(pool.state.tenantRow, null);
});

test("scheduler runtime policy route: worker route merges tenant base with worker and tool overrides", async () => {
  const pool = createRuntimePolicyPool();
  pool.state.tenantRow = {
    tenant_id: "tenant_1",
    policy: {
      version: 1,
      approvals: {
        restrictThreshold: 5,
      },
    },
    updated_at: "2026-03-31T11:00:00.000Z",
    updated_by: "tenant-ops@example.com",
  };

  const putReq = makeReq("PUT", "/v1/workers/worker_1/runtime-policy", {
    approvals: {
      restrictThreshold: 4,
    },
    tools: {
      send_email: {
        approvals: {
          restrictThreshold: 2,
        },
      },
    },
  }, {
    "x-tenant-id": "tenant_1",
    "x-user-email": "worker-ops@example.com",
  });
  const putRes = makeRes();
  const putUrl = new URL(putReq.url, "http://localhost");
  await handleWorkerRoute(putReq, putRes, pool, putUrl.pathname, putUrl.searchParams);
  assert.equal(putRes.statusCode, 200);
  const putPayload = JSON.parse(putRes.body);
  assert.equal(putPayload.workerId, "worker_1");
  assert.equal(putPayload.effective.approvals.restrictThreshold, 4);
  assert.equal(putPayload.effectiveTools.send_email.approvals.restrictThreshold, 2);
  assert.equal(putPayload.sources.approvals, "worker");
  assert.equal(putPayload.effectiveTools.send_email.sources.approvals, "worker_tool");

  const getReq = makeReq("GET", "/v1/workers/worker_1/runtime-policy", null, {
    "x-tenant-id": "tenant_1",
  });
  const getRes = makeRes();
  const getUrl = new URL(getReq.url, "http://localhost");
  await handleWorkerRoute(getReq, getRes, pool, getUrl.pathname, getUrl.searchParams);
  assert.equal(getRes.statusCode, 200);
  const getPayload = JSON.parse(getRes.body);
  assert.equal(getPayload.tenantOverrides.approvals.restrictThreshold, 5);
  assert.equal(getPayload.workerOverrides.tools.send_email.approvals.restrictThreshold, 2);
});
