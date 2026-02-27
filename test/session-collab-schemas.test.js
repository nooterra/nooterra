import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";
import {
  buildSessionEventPayloadV1,
  buildSessionV1,
  validateSessionEventPayloadV1,
  validateSessionV1
} from "../src/core/session-collab.js";

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    out.push(JSON.parse(await fs.readFile(path.join(base, name), "utf8")));
  }
  return out;
}

test("session collaboration schemas validate canonical fixtures", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }

  const validateSession = ajv.getSchema("https://nooterra.local/schemas/Session.v1.schema.json");
  const validateSessionEvent = ajv.getSchema("https://nooterra.local/schemas/SessionEvent.v1.schema.json");
  const validateSessionEventEnvelope = ajv.getSchema("https://nooterra.local/schemas/SessionEventEnvelope.v1.schema.json");
  const validateProvenance = ajv.getSchema("https://nooterra.local/schemas/SessionEventProvenance.v1.schema.json");
  assert.ok(validateSession);
  assert.ok(validateSessionEvent);
  assert.ok(validateSessionEventEnvelope);
  assert.ok(validateProvenance);

  const session = buildSessionV1({
    sessionId: "sess_schema_collab_1",
    tenantId: "tenant_default",
    visibility: "tenant",
    participants: ["agt_manager_1", "agt_worker_1"],
    policyRef: "policy://acs/default",
    metadata: { lane: "schemas" },
    createdAt: "2026-02-27T00:00:00.000Z"
  });
  assert.equal(validateSession(session), true, JSON.stringify(validateSession.errors ?? [], null, 2));
  assert.equal(validateSessionV1(session), true);

  const eventPayload = buildSessionEventPayloadV1({
    sessionId: session.sessionId,
    eventType: "MESSAGE",
    payload: { text: "hello" },
    provenance: { label: "external" },
    traceId: "trace_schema_collab_1",
    at: "2026-02-27T00:01:00.000Z"
  });
  assert.equal(validateSessionEvent(eventPayload), true, JSON.stringify(validateSessionEvent.errors ?? [], null, 2));
  assert.equal(validateSessionEventPayloadV1(eventPayload), true);
  assert.equal(validateProvenance(eventPayload.provenance), true, JSON.stringify(validateProvenance.errors ?? [], null, 2));

  const eventEnvelope = {
    v: 1,
    id: "evt_schema_collab_1",
    at: "2026-02-27T00:01:00.000Z",
    streamId: session.sessionId,
    type: eventPayload.eventType,
    actor: { type: "agent", id: "agt_manager_1" },
    payload: eventPayload,
    payloadHash: "a".repeat(64),
    prevChainHash: null,
    chainHash: "b".repeat(64),
    signature: null,
    signerKeyId: null
  };
  assert.equal(validateSessionEventEnvelope(eventEnvelope), true, JSON.stringify(validateSessionEventEnvelope.errors ?? [], null, 2));
});

test("session event provenance schema fails closed on invalid label and reason code shape", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }
  const validateProvenance = ajv.getSchema("https://nooterra.local/schemas/SessionEventProvenance.v1.schema.json");
  assert.ok(validateProvenance);

  const invalidProvenance = {
    schemaVersion: "SessionEventProvenance.v1",
    label: "unknown",
    derivedFromEventId: null,
    isTainted: false,
    taintDepth: 0,
    explicitTaint: false,
    reasonCodes: ["bad reason code with spaces"]
  };
  assert.equal(validateProvenance(invalidProvenance), false);
});
