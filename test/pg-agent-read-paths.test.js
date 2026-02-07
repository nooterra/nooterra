import test from "node:test";
import assert from "node:assert/strict";

import { createApi } from "../src/api/app.js";
import { createPgStore } from "../src/db/store-pg.js";
import { createEd25519Keypair } from "../src/core/crypto.js";
import { request } from "./api-test-harness.js";

const databaseUrl = process.env.DATABASE_URL ?? null;

function makeSchema() {
  return `t_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tenantRequest(api, { tenantId, method, path, headers = null, body = undefined }) {
  return request(api, {
    method,
    path,
    headers: {
      "x-proxy-tenant-id": tenantId,
      ...(headers ?? {})
    },
    body
  });
}

async function registerAgent(api, { tenantId, agentId }) {
  const { publicKeyPem } = createEd25519Keypair();
  const created = await tenantRequest(api, {
    tenantId,
    method: "POST",
    path: "/agents/register",
    headers: { "x-idempotency-key": `register_${tenantId}_${agentId}` },
    body: {
      agentId,
      displayName: agentId,
      owner: { ownerType: "service", ownerId: "svc_pg_read_paths" },
      publicKeyPem
    }
  });
  assert.equal(created.statusCode, 201);
}

(databaseUrl ? test : test.skip)("pg: agent reads are fresh across concurrent stores without refresh", async () => {
  const schema = makeSchema();
  const tenantId = "tenant_agent_reads_pg";
  const agentId = "agt_pg_reads_1";
  const runId = "run_pg_reads_1";

  let writerStore = null;
  let readerStore = null;
  try {
    writerStore = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: false });
    readerStore = await createPgStore({ databaseUrl, schema, dropSchemaOnClose: true });

    const writerApi = createApi({ store: writerStore });
    const readerApi = createApi({ store: readerStore });

    await registerAgent(writerApi, { tenantId, agentId });

    const createdRun = await tenantRequest(writerApi, {
      tenantId,
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs`,
      headers: { "x-idempotency-key": "run_create_pg_reads_1" },
      body: {
        runId,
        taskType: "classification",
        inputRef: "urn:input:pg_reads_1"
      }
    });
    assert.equal(createdRun.statusCode, 201);
    assert.equal(createdRun.json?.run?.status, "created");

    const readerSeesCreatedRun = await tenantRequest(readerApi, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`
    });
    assert.equal(readerSeesCreatedRun.statusCode, 200);
    assert.equal(readerSeesCreatedRun.json?.run?.status, "created");

    const readerListCreated = await tenantRequest(readerApi, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(agentId)}/runs?status=created&limit=10&offset=0`
    });
    assert.equal(readerListCreated.statusCode, 200);
    assert.equal(readerListCreated.json?.total, 1);
    assert.equal(readerListCreated.json?.runs?.[0]?.runId, runId);

    const completed = await tenantRequest(writerApi, {
      tenantId,
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`,
      headers: {
        "x-proxy-expected-prev-chain-hash": createdRun.json?.run?.lastChainHash,
        "x-idempotency-key": "run_complete_pg_reads_1"
      },
      body: {
        type: "RUN_COMPLETED",
        payload: {
          outputRef: "evidence://run_pg_reads_1/output.json"
        }
      }
    });
    assert.equal(completed.statusCode, 201);
    assert.equal(completed.json?.run?.status, "completed");

    const readerSeesCompletedRun = await tenantRequest(readerApi, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`
    });
    assert.equal(readerSeesCompletedRun.statusCode, 200);
    assert.equal(readerSeesCompletedRun.json?.run?.status, "completed");

    const readerRunEvents = await tenantRequest(readerApi, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/events`
    });
    assert.equal(readerRunEvents.statusCode, 200);
    assert.equal(readerRunEvents.json?.events?.length, 2);
    assert.equal(readerRunEvents.json?.events?.[1]?.type, "RUN_COMPLETED");

    const readerListCompleted = await tenantRequest(readerApi, {
      tenantId,
      method: "GET",
      path: `/agents/${encodeURIComponent(agentId)}/runs?status=completed&limit=10&offset=0`
    });
    assert.equal(readerListCompleted.statusCode, 200);
    assert.equal(readerListCompleted.json?.total, 1);
    assert.equal(readerListCompleted.json?.runs?.[0]?.runId, runId);
    assert.equal(readerListCompleted.json?.runs?.[0]?.status, "completed");
  } finally {
    try {
      await readerStore?.close?.();
    } catch {}
    try {
      await writerStore?.close?.();
    } catch {}
  }
});
