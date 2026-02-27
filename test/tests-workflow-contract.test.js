import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const TESTS_WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/tests.yml");

async function readWorkflow() {
  return await fs.readFile(TESTS_WORKFLOW_PATH, "utf8");
}

test("tests workflow contract: protocol drift gate job emits pinned matrix and drift artifacts", async () => {
  const text = await readWorkflow();
  assert.match(text, /protocol_compatibility_matrix:/);
  assert.match(
    text,
    /node scripts\/ci\/run-protocol-compatibility-matrix\.mjs --report artifacts\/gates\/protocol-compatibility-matrix\.json/
  );
  assert.match(text, /node scripts\/ci\/run-protocol-compatibility-drift-gate\.mjs/);
  assert.match(text, /--matrix-report artifacts\/gates\/protocol-compatibility-matrix\.json/);
  assert.match(text, /--report artifacts\/gates\/protocol-compatibility-drift-gate\.json/);
  assert.match(text, /name: protocol-compatibility-matrix-\$\{\{ github\.run_id \}\}/);
  assert.match(text, /artifacts\/gates\/protocol-compatibility-matrix\.json/);
  assert.match(text, /artifacts\/gates\/protocol-compatibility-drift-gate\.json/);
});

test("tests workflow contract: deploy safety readiness gate requires healthz wait and hosted baseline output", async () => {
  const text = await readWorkflow();
  assert.match(text, /deploy_safety_smoke:/);
  assert.match(text, /name: Wait for readiness/);
  assert.match(text, /curl -fsS "http:\/\/127\.0\.0\.1:3000\/healthz"/);
  assert.match(text, /echo "server did not become ready" >&2/);
  assert.match(text, /name: Run hosted baseline evidence gate \(backup\/restore required\)/);
  assert.match(text, /npm run -s ops:hosted-baseline:evidence -- \\/);
  assert.match(text, /--out artifacts\/ops\/hosted-baseline-ci\.json/);
  assert.match(text, /name: deploy-safety-\$\{\{ github\.run_id \}\}/);
  assert.match(text, /artifacts\/ops\/hosted-baseline-ci\.json/);
});
