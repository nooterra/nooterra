import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { createAjv2020 } from "./helpers/ajv-2020.js";
import { canonicalJsonStringify } from "../src/core/canonical-json.js";
import { deriveSessionPromptRiskSignals } from "../src/core/session-collab.js";

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    out.push(JSON.parse(await fs.readFile(path.join(base, name), "utf8")));
  }
  return out;
}

test("session prompt-risk signals derive deterministic challenge/escalate outputs with taint ancestry", () => {
  const taintedEvent = {
    id: "evt_taint_1",
    chainHash: "a".repeat(64),
    type: "MESSAGE",
    payload: {
      provenance: {
        schemaVersion: "SessionEventProvenance.v1",
        label: "external",
        derivedFromEventId: null,
        isTainted: true,
        taintDepth: 1,
        explicitTaint: false,
        reasonCodes: ["session_provenance_external_input"]
      }
    }
  };
  const events = [taintedEvent];

  const challenge = deriveSessionPromptRiskSignals({
    sessionId: "sess_prompt_risk_1",
    events,
    amountCents: 200,
    escalateAmountCents: 1000
  });
  assert.equal(challenge.suspicious, true);
  assert.equal(challenge.promptContagion, true);
  assert.equal(challenge.forcedMode, "challenge");
  assert.deepEqual(challenge.evidenceRefs, ["session:chain:".concat("a".repeat(64)), "session:event:evt_taint_1"].sort((a, b) => a.localeCompare(b)));
  assert.equal(challenge.source?.sessionId, "sess_prompt_risk_1");
  assert.equal(challenge.source?.eventId, "evt_taint_1");

  const escalate = deriveSessionPromptRiskSignals({
    sessionId: "sess_prompt_risk_1",
    events,
    amountCents: 2500,
    escalateAmountCents: 1000
  });
  assert.equal(escalate.suspicious, true);
  assert.equal(escalate.promptContagion, true);
  assert.equal(escalate.forcedMode, "escalate");

  // Deterministic semantic output for identical inputs.
  assert.equal(canonicalJsonStringify(escalate), canonicalJsonStringify(deriveSessionPromptRiskSignals({
    sessionId: "sess_prompt_risk_1",
    events,
    amountCents: 2500,
    escalateAmountCents: 1000
  })));
});

test("session prompt-risk signals produce non-suspicious baseline when no tainted events exist", () => {
  const signals = deriveSessionPromptRiskSignals({
    sessionId: "sess_prompt_risk_clean_1",
    events: [
      {
        id: "evt_clean_1",
        type: "TASK_REQUESTED",
        payload: {
          provenance: {
            schemaVersion: "SessionEventProvenance.v1",
            label: "trusted",
            derivedFromEventId: null,
            isTainted: false,
            taintDepth: 0,
            explicitTaint: false,
            reasonCodes: []
          }
        }
      }
    ]
  });
  assert.deepEqual(signals, {
    schemaVersion: "SessionPromptRiskSignals.v1",
    suspicious: false,
    promptContagion: false,
    forcedMode: null,
    reasonCodes: [],
    evidenceRefs: [],
    source: null
  });
});

test("session prompt-risk signal schema validates derived runtime shape", async () => {
  const ajv = createAjv2020();
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") {
      ajv.addSchema(schema, schema.$id);
    }
  }
  const validate = ajv.getSchema("https://nooterra.local/schemas/SessionPromptRiskSignals.v1.schema.json");
  assert.ok(validate);

  const signals = deriveSessionPromptRiskSignals({
    sessionId: "sess_prompt_risk_schema_1",
    events: [
      {
        id: "evt_schema_1",
        chainHash: "b".repeat(64),
        type: "MESSAGE",
        payload: {
          provenance: {
            schemaVersion: "SessionEventProvenance.v1",
            label: "external",
            derivedFromEventId: null,
            isTainted: true,
            taintDepth: 1,
            explicitTaint: false,
            reasonCodes: ["session_provenance_external_input"]
          }
        }
      }
    ],
    amountCents: 1500,
    escalateAmountCents: 1000
  });
  assert.equal(validate(signals), true, JSON.stringify(validate.errors ?? [], null, 2));
});
