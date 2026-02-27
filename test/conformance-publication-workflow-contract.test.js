import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/tests.yml");

async function readWorkflow() {
  return await fs.readFile(WORKFLOW_PATH, "utf8");
}

test("tests workflow: conformance publication job runs session/session-stream/federation publication scripts", async () => {
  const text = await readWorkflow();
  assert.match(text, /conformance_publication_artifacts:/);
  assert.match(text, /Build conformance publication artifacts \(session \+ session stream \+ federation\)/);
  assert.match(text, /node scripts\/conformance\/publish-session-conformance-cert\.mjs/);
  assert.match(text, /node scripts\/conformance\/publish-session-stream-conformance-cert\.mjs/);
  assert.match(text, /node scripts\/conformance\/publish-federation-conformance-cert\.mjs/);
});

test("tests workflow: conformance publication job enforces deterministic generatedAt and strict artifact contracts", async () => {
  const text = await readWorkflow();
  assert.match(text, /GENERATED_AT=\"2026-02-27T00:00:00.000Z\"/);
  assert.match(text, /Assert conformance publication artifact contracts/);
  assert.match(text, /strictArtifacts !== true/);
  assert.match(text, /output contract mismatch/);
  assert.match(text, /publication hash mismatch/);
});

test("tests workflow: conformance publication artifacts upload is fail-closed", async () => {
  const text = await readWorkflow();
  assert.match(text, /Upload conformance publication artifacts/);
  assert.match(text, /artifacts\/conformance\/session-v1\/ci-reference-node\//);
  assert.match(text, /artifacts\/conformance\/session-stream-v1\/ci-reference-node\//);
  assert.match(text, /artifacts\/conformance\/federation-v1\/ci-reference-node\//);
  assert.match(text, /if-no-files-found: error/);
});
