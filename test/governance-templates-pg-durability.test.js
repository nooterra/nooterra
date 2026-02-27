import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgPool, quoteIdent } from "../src/db/pg.js";
import { createPgStore } from "../src/db/store-pg.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tenantRequest(api, { tenantId, method, path, token, headers = null, body = undefined }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(token ? { "x-proxy-ops-token": token } : {}),
      ...(headers ?? {})
    },
    body
  });
}

(databaseUrl ? test : test.skip)("pg: governance template snapshots hydrate across restart for create/list/get/apply", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_gov_tpl_pg_durable";
  const templateId = "ops.safe-default";
  const templateVersion = 1;
  const effectiveFrom = "2026-01-01T00:00:00.000Z";

  let storeA = null;
  let storeB = null;
  try {
    storeA = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiA = createApi({ store: storeA, opsTokens: "tok_finw:finance_write;tok_finr:finance_read" });

    const created = await tenantRequest(apiA, {
      tenantId,
      token: "tok_finw",
      method: "POST",
      path: "/ops/governance/templates",
      headers: { "x-idempotency-key": "idem_gov_tpl_pg_create_1" },
      body: {
        templateId,
        templateVersion,
        name: "Ops Safe Default",
        description: "Baseline hold policy",
        policy: { finance: { monthCloseHoldPolicy: "ALLOW_WITH_DISCLOSURE" } },
        metadata: { owner: "ops" }
      }
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json?.template?.schemaVersion, "GovernanceTemplate.v1");
    assert.equal(created.json?.template?.templateId, templateId);
    assert.equal(created.json?.template?.templateVersion, templateVersion);
    const createdTemplateHash = created.json?.template?.templateHash ?? null;
    assert.ok(createdTemplateHash);

    await storeA.close();
    storeA = null;

    storeB = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    const apiB = createApi({ store: storeB, opsTokens: "tok_finw:finance_write;tok_finr:finance_read" });

    const createdAfterRestart = await tenantRequest(apiB, {
      tenantId,
      token: "tok_finw",
      method: "POST",
      path: "/ops/governance/templates",
      headers: { "x-idempotency-key": "idem_gov_tpl_pg_create_2" },
      body: {
        templateId,
        templateVersion,
        name: "Ops Safe Default",
        description: "Baseline hold policy",
        policy: { finance: { monthCloseHoldPolicy: "ALLOW_WITH_DISCLOSURE" } },
        metadata: { owner: "ops" }
      }
    });
    assert.equal(createdAfterRestart.statusCode, 200, createdAfterRestart.body);
    assert.equal(createdAfterRestart.json?.alreadyExists, true);
    assert.equal(createdAfterRestart.json?.template?.templateHash, createdTemplateHash);

    const listed = await tenantRequest(apiB, {
      tenantId,
      token: "tok_finr",
      method: "GET",
      path: "/ops/governance/templates?latest=true"
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json?.total, 1);
    assert.equal(listed.json?.templates?.[0]?.templateId, templateId);
    assert.equal(listed.json?.templates?.[0]?.templateVersion, templateVersion);
    assert.equal(listed.json?.templates?.[0]?.templateHash, createdTemplateHash);

    const fetched = await tenantRequest(apiB, {
      tenantId,
      token: "tok_finr",
      method: "GET",
      path: `/ops/governance/templates/${encodeURIComponent(templateId)}?templateVersion=${templateVersion}`
    });
    assert.equal(fetched.statusCode, 200, fetched.body);
    assert.equal(fetched.json?.template?.templateHash, createdTemplateHash);
    assert.deepEqual(fetched.json?.template?.policy, { finance: { monthCloseHoldPolicy: "ALLOW_WITH_DISCLOSURE" } });

    const notFound = await tenantRequest(apiB, {
      tenantId,
      token: "tok_finr",
      method: "GET",
      path: "/ops/governance/templates/ops.unknown-template?templateVersion=1"
    });
    assert.equal(notFound.statusCode, 404, notFound.body);
    assert.equal(notFound.json?.code, "NOT_FOUND");

    const invalidApply = await tenantRequest(apiB, {
      tenantId,
      token: "tok_finw",
      method: "POST",
      path: `/ops/governance/templates/${encodeURIComponent(templateId)}/apply`,
      headers: {
        "x-proxy-expected-prev-chain-hash": "null",
        "x-idempotency-key": "idem_gov_tpl_pg_apply_invalid_1"
      },
      body: {
        templateVersion,
        effectiveFrom: "not-an-iso-time"
      }
    });
    assert.equal(invalidApply.statusCode, 400, invalidApply.body);
    assert.equal(invalidApply.json?.code, "SCHEMA_INVALID");

    const applied = await tenantRequest(apiB, {
      tenantId,
      token: "tok_finw",
      method: "POST",
      path: `/ops/governance/templates/${encodeURIComponent(templateId)}/apply`,
      headers: {
        "x-proxy-expected-prev-chain-hash": "null",
        "x-idempotency-key": "idem_gov_tpl_pg_apply_1"
      },
      body: {
        templateVersion,
        effectiveFrom
      }
    });
    assert.equal(applied.statusCode, 201, applied.body);
    assert.equal(applied.json?.event?.type, "TENANT_POLICY_UPDATED");
    assert.equal(applied.json?.template?.templateHash, createdTemplateHash);
    assert.deepEqual(applied.json?.event?.payload?.policy, { finance: { monthCloseHoldPolicy: "ALLOW_WITH_DISCLOSURE" } });

    const snapshotCount = await storeB.pg.pool.query(
      "SELECT COUNT(*)::int AS c FROM snapshots WHERE tenant_id = $1 AND aggregate_type = 'governance_template' AND aggregate_id = $2",
      [tenantId, `${templateId}::${templateVersion}`]
    );
    assert.equal(Number(snapshotCount.rows[0]?.c ?? 0), 1);
  } finally {
    try {
      await storeB?.close?.();
    } catch {}
    try {
      await storeA?.close?.();
    } catch {}
    const adminPool = await createPgPool({ databaseUrl, schema: "public" });
    try {
      await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`);
    } finally {
      await adminPool.end();
    }
  }
});
