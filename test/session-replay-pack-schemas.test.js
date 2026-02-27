import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";
import { buildSessionEventPayloadV1, buildSessionV1 } from "../src/core/session-collab.js";
import { buildSessionReplayPackV1 } from "../src/core/session-replay-pack.js";

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    out.push(JSON.parse(await fs.readFile(path.join(base, name), "utf8")));
  }
  return out;
}

test("session replay pack schemas validate canonical fixture", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validateReplayPack = ajv.getSchema("https://nooterra.local/schemas/SessionReplayPack.v1.schema.json");
  const validateReplayPackSignature = ajv.getSchema(
    "https://nooterra.local/schemas/SessionReplayPackSignature.v1.schema.json"
  );
  assert.ok(validateReplayPack);
  assert.ok(validateReplayPackSignature);

  const session = buildSessionV1({
    sessionId: "sess_replay_schema_1",
    tenantId: "tenant_default",
    participants: ["agt_replay_manager_1", "agt_replay_worker_1"],
    createdAt: "2026-02-27T00:00:00.000Z"
  });
  const payload = buildSessionEventPayloadV1({
    sessionId: session.sessionId,
    eventType: "TASK_REQUESTED",
    payload: { taskId: "task_replay_schema_1" },
    provenance: { label: "trusted" },
    traceId: "trace_replay_schema_1",
    at: "2026-02-27T00:01:00.000Z"
  });
  const eventEnvelope = {
    v: 1,
    id: "evt_replay_schema_1",
    at: payload.at,
    streamId: session.sessionId,
    type: payload.eventType,
    actor: { type: "agent", id: "agt_replay_manager_1" },
    payload,
    payloadHash: "c".repeat(64),
    prevChainHash: null,
    chainHash: "d".repeat(64),
    signature: null,
    signerKeyId: null
  };

  const replayPack = buildSessionReplayPackV1({
    tenantId: "tenant_default",
    session,
    events: [eventEnvelope],
    verification: {
      chainOk: true,
      verifiedEventCount: 1,
      error: null,
      provenance: {
        ok: true,
        verifiedEventCount: 1,
        taintedEventCount: 0,
        error: null
      }
    }
  });
  assert.equal(validateReplayPack(replayPack), true, JSON.stringify(validateReplayPack.errors ?? [], null, 2));
});

test("session replay pack signing fails closed when payload hash mismatches computed pack hash", () => {
  const session = buildSessionV1({
    sessionId: "sess_replay_schema_fail_1",
    tenantId: "tenant_default",
    participants: ["agt_replay_schema_fail_1"],
    createdAt: "2026-02-27T00:00:00.000Z"
  });
  assert.throws(
    () =>
      buildSessionReplayPackV1({
        tenantId: "tenant_default",
        session,
        events: [],
        verification: {
          chainOk: true,
          verifiedEventCount: 0,
          error: null,
          provenance: null
        },
        signature: {
          schemaVersion: "SessionReplayPackSignature.v1",
          algorithm: "ed25519",
          keyId: "key_replay_schema_1",
          signedAt: "2026-02-27T00:00:00.000Z",
          payloadHash: "e".repeat(64),
          signatureBase64: "ZmFrZV9zaWduYXR1cmU="
        }
      }),
    /signature\.payloadHash must match replay pack hash/
  );
});
