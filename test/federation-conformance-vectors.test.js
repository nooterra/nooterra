import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const VECTORS_PATH = path.resolve(process.cwd(), "conformance", "federation-v1", "vectors.json");

test("federation conformance vectors: schema and deterministic case ids", async () => {
  const vectors = JSON.parse(await fs.readFile(VECTORS_PATH, "utf8"));
  assert.equal(vectors.schemaVersion, "FederationConformanceVectors.v1");
  assert.equal(Array.isArray(vectors.cases), true);
  assert.equal(vectors.cases.length > 0, true);

  const ids = vectors.cases.map((row) => String(row?.id ?? ""));
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "case ids must be sorted for deterministic diffs");

  for (const row of vectors.cases) {
    assert.equal(typeof row.endpoint, "string");
    assert.equal(typeof row.envelope, "object");
    assert.equal(typeof row.expected, "object");
  }
});
