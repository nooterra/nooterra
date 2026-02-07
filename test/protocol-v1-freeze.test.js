import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

test("protocol v1 freeze: schema + vectors hashes are unchanged (unless explicitly overridden)", () => {
  if (process.env.ALLOW_PROTOCOL_V1_MUTATION === "1") return;

  const lock = JSON.parse(fs.readFileSync("test/fixtures/protocol-v1-freeze.json", "utf8"));
  assert.equal(lock.schemaVersion, "ProtocolV1Freeze.v1");
  assert.ok(lock.files && typeof lock.files === "object" && !Array.isArray(lock.files));

  const expectedPaths = Object.keys(lock.files).sort();
  const actualPaths = expectedPaths.filter((p) => fs.existsSync(p));
  assert.deepEqual(actualPaths, expectedPaths, "freeze lock lists missing files");

  const mismatches = [];
  for (const p of expectedPaths) {
    const expected = String(lock.files[p] ?? "");
    const actual = sha256Hex(fs.readFileSync(p));
    if (expected !== actual) mismatches.push({ path: p, expected, actual });
  }
  assert.equal(mismatches.length, 0, `v1 freeze mismatch:\n${JSON.stringify(mismatches, null, 2)}`);
});

