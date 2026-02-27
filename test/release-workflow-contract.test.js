import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const RELEASE_WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/release.yml");

async function readWorkflow() {
  return await fs.readFile(RELEASE_WORKFLOW_PATH, "utf8");
}

test("release workflow contract: requires deploy safety smoke gate from tests workflow", async () => {
  const text = await readWorkflow();
  assert.match(text, /const requiredJobNames = \[/);
  assert.match(text, /"deploy_safety_smoke"/);
});

test("release workflow contract: asserts production cutover required checks in release_promotion_guard", async () => {
  const text = await readWorkflow();
  assert.match(
    text,
    /Assert production cutover required checks \(collaboration \+ lineage \+ transcript \+ session stream conformance \+ settlement\/dispute lifecycle \+ checkpoint grant binding \+ work order metering durability \+ SDK JS\/PY smoke\)/
  );
  assert.match(text, /node scripts\/ci\/assert-production-cutover-required-checks\.mjs/);
  assert.match(text, /--in artifacts\/gates\/production-cutover-gate\.json/);
  assert.match(text, /--json-out artifacts\/gates\/production-cutover-required-checks\.json/);
});

test("release workflow contract: release artifacts include production cutover required checks report", async () => {
  const text = await readWorkflow();
  assert.match(text, /artifacts\/gates\/production-cutover-required-checks\.json/);
  assert.match(text, /artifacts\/gates\/release-cutover-audit-view\.json/);
});

test("release workflow contract: release body path and notes generator are pinned", async () => {
  const text = await readWorkflow();
  assert.match(text, /node scripts\/release\/build-release-notes-from-gates\.mjs/);
  assert.match(text, /--promotion-guard \/tmp\/release-assets\/release-promotion-guard\.json/);
  assert.match(text, /--required-checks \/tmp\/release-assets\/production-cutover-required-checks\.json/);
  assert.match(text, /--out \/tmp\/release-notes\.md/);
  assert.match(text, /--json-out \/tmp\/release-notes\.json/);
  assert.match(text, /body_path: \/tmp\/release-notes\.md/);
});

test("release workflow contract: required release assets assert production cutover checks artifact", async () => {
  const text = await readWorkflow();
  assert.match(text, /test -f \/tmp\/release-assets\/production-cutover-required-checks\.json/);
  assert.match(text, /test -f \/tmp\/release-assets\/release-cutover-audit-view\.json/);
});

test("release workflow contract: builds release cutover audit view from pinned artifacts", async () => {
  const text = await readWorkflow();
  assert.match(text, /node scripts\/release\/build-cutover-audit-view\.mjs/);
  assert.match(text, /--production-gate artifacts\/gates\/production-cutover-gate\.json/);
  assert.match(text, /--required-checks artifacts\/gates\/production-cutover-required-checks\.json/);
  assert.match(text, /--launch-packet artifacts\/gates\/s13-launch-cutover-packet\.json/);
  assert.match(text, /--out artifacts\/gates\/release-cutover-audit-view\.json/);
});

test("release workflow contract: upload release notes artifact step is present", async () => {
  const text = await readWorkflow();
  assert.match(text, /name: Upload release notes artifact/);
  assert.match(text, /name: release-notes-\$\{\{ steps\.v\.outputs\.version \}\}/);
  assert.match(text, /\/tmp\/release-notes\.md/);
  assert.match(text, /\/tmp\/release-notes\.json/);
});

test("release workflow contract: release gate includes protocol drift gate command and pinned outputs", async () => {
  const text = await readWorkflow();
  assert.match(text, /name: Enforce protocol compatibility drift gate/);
  assert.match(text, /node scripts\/ci\/run-protocol-compatibility-drift-gate\.mjs/);
  assert.match(text, /--matrix-report artifacts\/gates\/protocol-compatibility-matrix-release-gate\.json/);
  assert.match(text, /--report artifacts\/gates\/protocol-compatibility-drift-gate-release-gate\.json/);
  assert.match(text, /name: release-deploy-safety-\$\{\{ github\.run_id \}\}/);
  assert.match(text, /artifacts\/gates\/protocol-compatibility-matrix-release-gate\.json/);
  assert.match(text, /artifacts\/gates\/protocol-compatibility-drift-gate-release-gate\.json/);
});

test("release workflow contract: release gate readiness guard waits for healthz before hosted baseline evidence", async () => {
  const text = await readWorkflow();
  assert.match(text, /name: Wait for readiness/);
  assert.match(text, /curl -fsS "http:\/\/127\.0\.0\.1:3000\/healthz"/);
  assert.match(text, /echo "server did not become ready" >&2/);
  assert.match(text, /name: Run hosted baseline evidence gate \(backup\/restore required\)/);
  assert.match(text, /npm run -s ops:hosted-baseline:evidence -- \\/);
  assert.match(text, /--out artifacts\/ops\/hosted-baseline-release-gate\.json/);
  assert.match(text, /name: Run OpenClaw operator readiness gate/);
  assert.match(text, /node scripts\/ops\/openclaw-operator-readiness-gate\.mjs \\/);
  assert.match(text, /--hosted-evidence artifacts\/ops\/hosted-baseline-release-gate\.json \\/);
  assert.match(text, /--openclaw-plugin artifacts\/ops\/openclaw\.plugin\.release-gate\.json \\/);
  assert.match(text, /--out artifacts\/gates\/openclaw-operator-readiness-gate\.json/);
});

test("release workflow contract: promotion guard enforces openclaw readiness artifact from release gate", async () => {
  const text = await readWorkflow();
  assert.match(text, /name: Assert OpenClaw readiness gate artifact is present and passing/);
  assert.match(text, /\/tmp\/release-upstream\/release-gate\/openclaw-operator-readiness-gate\.json/);
  assert.match(text, /OpenClawOperatorReadinessGateReport\.v1/);
  assert.match(text, /openclaw operator readiness gate verdict must be ok=true/);
  assert.match(text, /artifacts\/gates\/openclaw-operator-readiness-gate\.json/);
});
