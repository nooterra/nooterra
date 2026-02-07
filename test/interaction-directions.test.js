import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import Ajv from "ajv/dist/2020.js";

import {
  INTERACTION_DIRECTION_SCHEMA_VERSION,
  INTERACTION_ENTITY_TYPES,
  buildInteractionDirectionMatrixV1,
  isInteractionDirectionAllowed,
  assertInteractionDirectionAllowed,
  normalizeInteractionDirection,
  validateInteractionDirectionMatrixV1
} from "../src/core/interaction-directions.js";

async function loadSchemas() {
  const base = path.resolve(process.cwd(), "docs/spec/schemas");
  const names = (await fs.readdir(base)).filter((name) => name.endsWith(".json")).sort();
  const out = [];
  for (const name of names) {
    out.push(JSON.parse(await fs.readFile(path.join(base, name), "utf8")));
  }
  return out;
}

test("interaction direction invariant: all 4x4 directions are allowed", () => {
  let pairCount = 0;
  for (const fromType of INTERACTION_ENTITY_TYPES) {
    for (const toType of INTERACTION_ENTITY_TYPES) {
      pairCount += 1;
      assert.equal(isInteractionDirectionAllowed(fromType, toType), true);
      assert.equal(assertInteractionDirectionAllowed(fromType, toType), true);
    }
  }
  assert.equal(pairCount, 16);
});

test("interaction direction invariant: invalid entity types are rejected", () => {
  assert.throws(() => isInteractionDirectionAllowed("service", "agent"), /fromType must be one of/);
  assert.throws(() => assertInteractionDirectionAllowed("agent", "vendor"), /toType must be one of/);
});

test("interaction direction invariant: normalize applies defaults and fallback mode", () => {
  assert.deepEqual(normalizeInteractionDirection({}), { fromType: "agent", toType: "agent" });
  assert.deepEqual(
    normalizeInteractionDirection({ fromType: "  HUMAN  ", toType: "machine" }),
    { fromType: "human", toType: "machine" }
  );
  assert.throws(
    () => normalizeInteractionDirection({ fromType: "vendor", toType: "robot" }),
    /fromType must be one of/
  );
  assert.deepEqual(
    normalizeInteractionDirection({
      fromType: "vendor",
      toType: "robot",
      defaultFromType: "robot",
      defaultToType: "machine",
      onInvalid: "fallback"
    }),
    { fromType: "robot", toType: "machine" }
  );
});

test("InteractionDirectionMatrix.v1: builder + validator enforce fixed matrix", async () => {
  const matrix = buildInteractionDirectionMatrixV1();
  assert.equal(matrix.schemaVersion, INTERACTION_DIRECTION_SCHEMA_VERSION);
  assert.equal(matrix.directionalCount, 16);
  assert.deepEqual(matrix.entityTypes, INTERACTION_ENTITY_TYPES);
  assert.equal(validateInteractionDirectionMatrixV1(matrix), true);

  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const schema of await loadSchemas()) {
    if (schema && typeof schema === "object" && typeof schema.$id === "string") ajv.addSchema(schema, schema.$id);
  }
  const validate = ajv.getSchema("https://settld.local/schemas/InteractionDirectionMatrix.v1.schema.json");
  assert.ok(validate);
  assert.equal(validate(matrix), true);

  const invalid = JSON.parse(JSON.stringify(matrix));
  invalid.directions.agent.robot = false;
  assert.equal(validate(invalid), false);
  assert.throws(() => validateInteractionDirectionMatrixV1(invalid), /must be true/);
});
