import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/session-conformance-cert.yml");

async function readWorkflow() {
  return await fs.readFile(WORKFLOW_PATH, "utf8");
}

test("session conformance publication workflow: runs publish script with runtime_id input", async () => {
  const text = await readWorkflow();
  assert.match(text, /name:\s+session_conformance_cert/);
  assert.match(text, /workflow_dispatch/);
  assert.match(text, /runtime_id/);
  assert.match(text, /node scripts\/conformance\/publish-session-conformance-cert\.mjs/);
  assert.match(text, /--runtime-id "\$\{\{ inputs\.runtime_id \}\}"/);
  assert.match(text, /--out-dir "artifacts\/conformance\/session-v1\/\$\{\{ inputs\.runtime_id \}\}"/);
});
